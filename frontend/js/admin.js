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
        el('div', {}, [
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
    if (u.status === 'pending') {
      acts.push(el('button', { class: 'primary', onclick: async () => {
        await api.post(`/api/users/${u.id}/approve`, {}); toast('Approved', 'success'); refresh();
      }}, 'Approve'));
    }
    if (u.status === 'active' && u.role !== 'admin') {
      acts.push(el('button', { onclick: async () => {
        await api.post(`/api/users/${u.id}/role`, { role: 'admin' }); toast('Promoted to admin', 'success'); refresh();
      }}, 'Make admin'));
    }
    if (u.role === 'admin' && u.status === 'active') {
      acts.push(el('button', { onclick: async () => {
        await api.post(`/api/users/${u.id}/role`, { role: 'user' }); toast('Demoted to user', 'success'); refresh();
      }}, 'Demote'));
    }
    acts.push(el('button', { onclick: async () => {
      const pw = prompt('New password (min 4 chars)'); if (!pw) return;
      await api.post(`/api/users/${u.id}/password`, { password: pw }); toast('Password updated', 'success');
    }}, 'Set password'));
    if (u.status !== 'disabled') {
      acts.push(el('button', { class: 'danger', onclick: async () => {
        if (!confirm(`Disable ${u.username}?`)) return;
        await api.post(`/api/users/${u.id}/disable`, {}); toast('Disabled', 'success'); refresh();
      }}, 'Disable'));
    }
    return acts;
  }
}
