// Admin panel modal. Approve accounts, set roles, change passwords, disable.
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

export async function openAdminPanel() {
  const tpl = document.getElementById('adminTpl').content.cloneNode(true);
  const root = document.getElementById('modalRoot');
  root.innerHTML = '';
  root.appendChild(tpl);
  root.querySelector('[data-close]').addEventListener('click', () => root.innerHTML = '');

  await refresh();
  async function refresh() {
    const [pending, all] = await Promise.all([api.get('/api/users/pending'), api.get('/api/users')]);
    render(root.querySelector('#pendingList'), pending, true);
    render(root.querySelector('#allUsersList'), all, false);
  }

  function render(list, users, isPending) {
    list.innerHTML = '';
    if (!users.length) {
      list.appendChild(el('li', { class: 'muted' }, isPending ? 'No pending accounts.' : 'No users.'));
      return;
    }
    for (const u of users) {
      const li = el('li', {}, [
        el('div', { class: 'info' }, [
          el('div', {}, [u.username, u.email ? ` <${u.email}>` : '']),
          el('div', { class: 'meta' }, `role: ${u.role} • status: ${u.status} • created: ${u.created_at}`),
        ]),
        el('div', { class: 'actions' }, buildActions(u, refresh)),
      ]);
      list.appendChild(li);
    }
  }

  function buildActions(u, refresh) {
    const acts = [];
    const me = refresh;  // alias; the action callbacks just need to call refresh()
    const sep = () => el('span', { class: 'sep', 'aria-hidden': 'true' });

    // --- primary / role-management group ---
    if (u.status === 'pending') {
      acts.push(el('button', { class: 'primary', onclick: async () => {
        await api.post(`/api/users/${u.id}/approve`, {}); toast('Approved', 'success'); me();
      }}, 'Approve'));
    }
    // Re-enable a previously disabled user. Sits in the role-management
    // group because it restores the user to active — it is the natural
    // counterpart of Disable, which lives in the destructive group.
    if (u.status === 'disabled') {
      acts.push(el('button', { class: 'primary', onclick: async () => {
        if (!confirm(`Re-enable "${u.username}"? They will be able to log in again.`)) return;
        try {
          await api.post(`/api/users/${u.id}/enable`, {});
          toast('Enabled', 'success');
          me();
        } catch (err) {
          toast('Enable failed: ' + err.message, 'error');
        }
      }}, 'Enable'));
    }
    if (u.status === 'active' && u.role !== 'admin') {
      acts.push(el('button', { onclick: async () => {
        await api.post(`/api/users/${u.id}/role`, { role: 'admin' }); toast('Promoted to admin', 'success'); me();
      }}, 'Make admin'));
    }
    if (u.role === 'admin' && u.status === 'active') {
      acts.push(el('button', { onclick: async () => {
        await api.post(`/api/users/${u.id}/role`, { role: 'user' }); toast('Demoted to user', 'success'); me();
      }}, 'Demote'));
    }

    // --- secondary / account actions ---
    acts.push(el('button', { onclick: async () => {
      const pw = prompt('New password'); if (!pw) return;
      try {
        await api.post(`/api/users/${u.id}/password`, { password: pw });
        toast('Password updated', 'success');
      } catch (err) {
        toast('Password update failed: ' + err.message, 'error');
      }
    }}, 'Set password'));

    // Only offer "Clear password" if the user currently has one.
    // After clearing, they can only log in via Google (if linked) or by
    // having an admin set a new password.
    if (u.has_password) {
      acts.push(el('button', { onclick: async () => {
        if (!confirm(
          `Clear password for "${u.username}"?\n\n` +
          `They will NO LONGER be able to log in with a password.\n` +
          (u.email ? '' : 'This user has no Google link — they will be locked out.')
        )) return;
        try {
          await api.del(`/api/users/${u.id}/password`);
          toast('Password cleared', 'success');
          me();
        } catch (err) {
          toast('Clear failed: ' + err.message, 'error');
        }
      }}, 'Clear password'));
    }

    // --- destructive group, separated visually ---
    const destructive = [];
    if (u.status !== 'disabled') {
      destructive.push(el('button', { class: 'danger', onclick: async () => {
        if (!confirm(`Disable ${u.username}?`)) return;
        await api.post(`/api/users/${u.id}/disable`, {}); toast('Disabled', 'success'); me();
      }}, 'Disable'));
    }
    destructive.push(el('button', { class: 'danger', onclick: async () => {
      const ok = confirm(
        `PERMANENTLY delete "${u.username}"?\n\n` +
        `  • deletes the user account\n` +
        `  • deletes ALL their notes and folders\n` +
        `  • logs them out from every session\n` +
        `  • cannot be undone`
      );
      if (!ok) return;
      const typed = prompt(`Type "${u.username}" to confirm deletion:`);
      if (typed !== u.username) {
        toast('Username did not match — deletion cancelled', 'error');
        return;
      }
      try {
        await api.del(`/api/users/${u.id}`);
        toast(`Deleted ${u.username}`, 'success');
        me();
      } catch (err) {
        toast('Delete failed: ' + err.message, 'error');
      }
    }}, 'Delete'));

    if (acts.length && destructive.length) acts.push(sep());
    acts.push(...destructive);
    return acts;
  }
}
