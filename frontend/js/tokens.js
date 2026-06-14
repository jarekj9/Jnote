// Personal access tokens panel. Lets the signed-in user mint a long-lived
// API key, see existing tokens, and revoke them. The plaintext token is
// shown exactly once at creation; only its prefix is stored in the list.
import { api } from './api.js';
import { toast } from './toast.js';

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

export async function openTokensPanel() {
  const tpl = document.getElementById('tokensTpl').content.cloneNode(true);
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  root.appendChild(tpl);
  root.querySelector('[data-close]').addEventListener('click', () => { root.innerHTML = ''; });

  const listEl    = root.querySelector('#tokensList');
  const newBox    = root.querySelector('#newTokenBox');
  const newVal    = root.querySelector('#newTokenValue');
  const copyBtn   = root.querySelector('#copyTokenBtn');
  const form      = root.querySelector('#createTokenForm');

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(newVal.textContent);
      toast('Token copied', 'success');
    } catch {
      // Fallback: select the text so the user can copy manually.
      const r = document.createRange();
      r.selectNodeContents(newVal);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      toast('Press Ctrl+C / Cmd+C to copy', 'success');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const expRaw = String(fd.get('expiresInDays') || '').trim();
    if (!name) { toast('Name required', 'error'); return; }
    try {
      const body = { name };
      if (expRaw) body.expiresInDays = Number(expRaw);
      const token = await api.post('/api/auth/tokens', body);
      newVal.textContent = token.token;
      newBox.hidden = false;
      form.reset();
      toast('Token created — copy it now', 'success');
      await refresh();
    } catch (err) {
      toast('Create failed: ' + err.message, 'error');
    }
  });

  await refresh();

  async function refresh() {
    const tokens = await api.get('/api/auth/tokens');
    listEl.innerHTML = '';
    if (!tokens.length) {
      listEl.appendChild(el('li', { class: 'muted' }, 'No tokens yet.'));
      return;
    }
    for (const t of tokens) {
      const li = el('li', {}, [
        el('div', {}, [
          el('div', {}, [t.name]),
          el('div', { class: 'meta' }, [
            `${escapeHtml(t.prefix)} · created ${formatDate(t.created_at)}`,
            t.last_used_at ? ` · last used ${formatDate(t.last_used_at)}` : ' · never used',
            t.expires_at ? ` · expires ${formatDate(t.expires_at)}` : '',
          ]),
        ]),
        el('div', { class: 'actions' }, [
          el('button', { class: 'danger', onclick: async () => {
            if (!confirm(`Revoke token "${t.name}"? Any script using it will stop working immediately.`)) return;
            try {
              await api.del(`/api/auth/tokens/${t.id}`);
              toast('Token revoked', 'success');
              refresh();
            } catch (err) {
              toast('Revoke failed: ' + err.message, 'error');
            }
          }}, 'Revoke'),
        ]),
      ]);
      listEl.appendChild(li);
    }
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}
