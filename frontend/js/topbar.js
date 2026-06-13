// Topbar: theme, account menu, sidebar toggle, import.
import { state, setState, on, emit_ } from './state.js';
import { api } from './api.js';
import { logout } from './auth.js';
import { toast } from './toast.js';
import { loadFolders, loadNotesForCurrentFolder, loadTags } from './sidebar.js';
import { openAdminPanel } from './admin.js';

export function initTopbar() {
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    setState({ sidebarOpen: !state.sidebarOpen });
    document.getElementById('app').classList.toggle('sidebar-open', state.sidebarOpen);
  });

  // Account menu
  const btn = document.getElementById('userBtn');
  const menu = document.getElementById('userMenu');
  btn.addEventListener('click', () => { menu.hidden = !menu.hidden; });
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    location.reload();
  });

  document.getElementById('adminLink').addEventListener('click', (e) => {
    e.preventDefault();
    openAdminPanel();
  });

  document.getElementById('importInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const res = await api.uploadFiles(files);
      toast(`Imported ${res.tree?.notes || 0} notes and ${res.tree?.folders || 0} folders.`, 'success');
      await loadFolders();
      await loadNotesForCurrentFolder();
      await loadTags();
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
    e.target.value = '';
  });

  on('change', updateUserMenu);
}

function updateUserMenu() {
  const u = state.user;
  document.getElementById('userMenuName').textContent = u ? `${u.username}${u.role === 'admin' ? ' (admin)' : ''}` : '';
  document.getElementById('adminLink').hidden = !(u && u.role === 'admin');
}
