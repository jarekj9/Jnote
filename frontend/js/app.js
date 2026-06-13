// Application entry. Decides between auth screen and the main app, and
// wires the modules together.
import { state, setState, on } from './state.js';
import { fetchMe, renderAuth, bindAuthForms } from './auth.js';
import { initTheme } from './theme.js';
import { initTopbar } from './topbar.js';
import { initSearch } from './search.js';
import { initSidebar, loadFolders, loadNotesForCurrentFolder, loadTags } from './sidebar.js';
import { initEditor } from './editor.js';

// Switches the UI to the authenticated app shell. Safe to call multiple
// times — the one-time event listeners are wired in bootstrap().
export function enterApp() {
  document.getElementById('auth').hidden = true;
  document.getElementById('topbar').hidden = false;
  document.getElementById('app').hidden = false;
  document.getElementById('userMenuName').textContent =
    `${state.user.username}${state.user.role === 'admin' ? ' (admin)' : ''}`;
  document.getElementById('adminLink').hidden = state.user.role !== 'admin';

  // Initial data load.
  Promise.all([loadFolders(), loadNotesForCurrentFolder(), loadTags()])
    .catch(err => console.error('initial load', err));

  // Sidebar toggle on mobile.
  if (window.matchMedia('(max-width: 720px)').matches) {
    setState({ sidebarOpen: false });
  }
}

async function bootstrap() {
  bindAuthForms();
  initTheme();
  initTopbar();
  initSearch();
  initSidebar();
  initEditor();

  // One-time wiring: after any note mutation, refresh the sidebar.
  on(['note:created', 'note:updated', 'note:deleted'], async () => {
    await loadNotesForCurrentFolder();
    await loadTags();
  });
  on(['folder:changed'], async () => {
    await loadFolders();
    await loadNotesForCurrentFolder();
  });

  try {
    const user = await fetchMe();
    if (!user) { renderAuth(); return; }
  } catch (e) { renderAuth(); return; }

  enterApp();
}

document.addEventListener('DOMContentLoaded', bootstrap);
