// Sidebar: renders folder tree + notes for the selected folder, plus the
// tag list at the bottom. Clicking a folder reveals its notes in the same
// sidebar; clicking a note opens it in the editor.
import { api } from './api.js';
import { state, setState, on, emit_ } from './state.js';
import { openNote } from './editor.js';
import { sanitizeHtml } from './markdown.js';
import { toast } from './toast.js';

let allFolders = []; // full list of folders for the user (re-fetched after changes)

export async function loadFolders() {
  // Walk the tree by repeatedly listing children. Cheap for typical note apps.
  allFolders = [];
  const stack = [null];
  while (stack.length) {
    const parent = stack.pop();
    const list = await api.get('/api/folders' + (parent ? `?parentId=${parent}` : ''));
    for (const f of list) { allFolders.push(f); stack.push(f.id); }
  }
  return allFolders;
}

export async function loadNotesForCurrentFolder() {
  const id = state.selectedFolderId;
  const qs = id ? `?folderId=${id}&sort=${state.sort}` : `?folderId=&sort=${state.sort}`;
  const notes = await api.get('/api/notes' + qs);
  setState({ notes });
  renderTree();
  renderTagList();
}

export async function loadTags() {
  const tags = await api.get('/api/tags');
  setState({ tags });
  renderTagList();
}

// Single entry point that decides what the sidebar shows. Exported so other
// modules (search, tag click) can trigger a re-render without relying on
// the debounced 'change' event in state.js.
export function renderSidebar() {
  try {
    if (state.searchResults !== null) {
      renderSearchResults();
      return;
    }
    renderTree();
    renderTagList();
  } catch (e) {
    console.error('[jnote] sidebar render failed', e);
  }
}

export function initSidebar() {
  document.getElementById('sortSelect').value = state.sort;
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    setState({ sort: e.target.value });
    if (!state.searchQuery) loadNotesForCurrentFolder();
  });

  document.getElementById('newFolderBtn').addEventListener('click', createFolderHere);
  document.getElementById('newNoteBtn').addEventListener('click', createNoteHere);

  // Backup listener: if any of these events fire, re-render.
  on(['change', 'note:created', 'note:updated', 'note:deleted', 'folder:changed', 'tag:selected'], () => {
    renderSidebar();
  });
}

function renderTree() {
  const root = document.getElementById('tree');
  const children = (parentId) => allFolders
    .filter(f => (f.parent_id || null) === parentId)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const build = (parentId) => {
    const list = children(parentId);
    if (!list.length) return null;
    const wrap = document.createElement('div');
    wrap.className = 'node-children';
    for (const f of list) {
      const node = document.createElement('div');
      node.className = 'node';
      const row = document.createElement('div');
      row.className = 'node-row';
      if (state.selectedFolderId === f.id) row.classList.add('active');
      const open = state.expanded.has(f.id);
      row.innerHTML = `
        <span class="twist">${open ? '▾' : '▸'}</span>
        <span class="icon">📁</span>
        <span class="name" title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span>
        <span class="actions">
          <button data-act="add-sub" title="New subfolder">+📁</button>
          <button data-act="rename" title="Rename">✎</button>
          <button data-act="delete" title="Delete">🗑</button>
        </span>`;
      row.addEventListener('click', (e) => {
        const act = e.target.closest('button[data-act]')?.dataset.act;
        if (act === 'add-sub') { e.stopPropagation(); createFolderIn(f.id); return; }
        if (act === 'rename')   { e.stopPropagation(); renameFolder(f); return; }
        if (act === 'delete')   { e.stopPropagation(); deleteFolder(f); return; }
        if (state.selectedFolderId === f.id) {
          state.expanded.has(f.id) ? state.expanded.delete(f.id) : state.expanded.add(f.id);
        } else {
          state.expanded.add(f.id);
        }
        setState({ selectedFolderId: f.id, searchQuery: '', searchResults: null });
        document.getElementById('searchInput').value = '';
        loadNotesForCurrentFolder().then(renderSidebar);
      });
      node.appendChild(row);
      if (open) {
        const sub = build(f.id);
        if (sub) node.appendChild(sub);
        if (state.selectedFolderId === f.id) {
          // Notes for this folder
          const notesEl = renderNotesBlock(f.id);
          node.appendChild(notesEl);
        }
      }
      wrap.appendChild(node);
    }
    return wrap;
  };

  root.innerHTML = '';
  // Top section: "All notes" pseudo-folder
  const allRow = document.createElement('div');
  allRow.className = 'node-row';
  if (state.selectedFolderId === null && !state.searchQuery) allRow.classList.add('active');
  allRow.innerHTML = `<span class="twist"></span><span class="icon">🗂</span><span class="name">All notes</span>`;
  allRow.addEventListener('click', () => {
    setState({ selectedFolderId: null, searchQuery: '', searchResults: null });
    document.getElementById('searchInput').value = '';
    loadNotesForCurrentFolder().then(renderSidebar);
  });
  root.appendChild(allRow);

  // Root-level notes (folder_id IS NULL)
  if (state.selectedFolderId === null && !state.searchQuery) {
    root.appendChild(renderNotesBlock(null));
  }

  const built = build(null);
  if (built) root.appendChild(built);
}

function renderNotesBlock(folderId) {
  const wrap = document.createElement('div');
  wrap.className = 'node-children';
  const notes = state.notes.filter(n => (n.folder_id || null) === folderId);
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'node-row muted';
    empty.style.paddingLeft = '20px';
    empty.textContent = '— no notes —';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const n of notes) {
    const row = document.createElement('div');
    row.className = 'node-row';
    if (state.openNote?.id === n.id) row.classList.add('active');
    row.innerHTML = `<span class="twist"></span><span class="icon">📄</span><span class="name" title="${escapeAttr(n.title)}">${escapeHtml(n.title || 'Untitled')}</span>`;
    row.addEventListener('click', async () => {
      try {
        const full = await api.get('/api/notes/' + n.id);
        openNote(full);
        emit_('note:opened');
        // On mobile, close the sidebar overlay so the user sees the note.
        if (window.matchMedia('(max-width: 720px)').matches) {
          setState({ sidebarOpen: false });
          document.getElementById('app').classList.remove('sidebar-open');
        }
      } catch (e) { toast('Open failed: ' + e.message, 'error'); }
    });
    wrap.appendChild(row);
  }
  return wrap;
}

function renderSearchResults() {
  const root = document.getElementById('tree');
  root.innerHTML = '';
  if (!state.searchResults) return;
  if (!state.searchResults.length) {
    const empty = document.createElement('div');
    empty.className = 'node-row muted';
    empty.textContent = 'No matches.';
    root.appendChild(empty);
    return;
  }
  for (const r of state.searchResults) {
    const row = document.createElement('div');
    row.className = 'node-row';
    row.innerHTML = `<span class="twist"></span><span class="icon">📄</span><span class="name">${escapeHtml(r.title || 'Untitled')}</span>`;
    row.addEventListener('click', async () => {
      const full = await api.get('/api/notes/' + r.id);
      openNote(full);
      emit_('note:opened');
      if (window.matchMedia('(max-width: 720px)').matches) {
        setState({ sidebarOpen: false });
        document.getElementById('app').classList.remove('sidebar-open');
      }
    });
    root.appendChild(row);
    if (r.snippet) {
      const snip = document.createElement('div');
      snip.className = 'muted';
      snip.style.padding = '2px 28px 4px';
      snip.style.fontSize = '12px';
      // FTS5 snippet() wraps matches in <mark> but otherwise emits the raw
      // note text. Sanitize before innerHTML so a note containing
      // <img onerror=...> can't run script via the sidebar.
      snip.innerHTML = sanitizeHtml(r.snippet, ['mark']);
      root.appendChild(snip);
    }
  }
}

function renderTagList() {
  const root = document.getElementById('tagList');
  if (state.searchResults) { root.innerHTML = ''; return; }
  root.innerHTML = '<h4>Tags</h4>';
  if (!state.tags.length) {
    const e = document.createElement('div');
    e.className = 'muted';
    e.style.padding = '0 8px';
    e.textContent = '— no tags —';
    root.appendChild(e);
    return;
  }
  for (const t of state.tags) {
    const el = document.createElement('div');
    el.className = 'tag' + (state.activeTag === t.name ? ' active' : '');
    el.innerHTML = `<span>#${escapeHtml(t.name)}</span><span class="count">${t.count}</span>`;
    el.addEventListener('click', () => {
      const next = state.activeTag === t.name ? null : t.name;
      setState({ activeTag: next });
      // Fetch notes for tag
      api.get('/api/search?tag=' + encodeURIComponent(next || '')).then(results => {
        setState({ searchResults: next ? results : null });
        renderSidebar();
      });
    });
    root.appendChild(el);
  }
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

async function createFolderHere() { createFolderIn(state.selectedFolderId); }
async function createFolderIn(parentId) {
  const name = prompt('Folder name');
  if (!name?.trim()) return;
  try {
    await api.post('/api/folders', { name: name.trim(), parentId });
    await loadFolders();
    emit_('folder:changed');
  } catch (e) { toast(e.message, 'error'); }
}
async function renameFolder(f) {
  const name = prompt('Rename folder', f.name);
  if (!name?.trim() || name === f.name) return;
  try { await api.patch(`/api/folders/${f.id}`, { name: name.trim() }); await loadFolders(); emit_('folder:changed'); }
  catch (e) { toast(e.message, 'error'); }
}
async function deleteFolder(f) {
  if (!confirm(`Delete folder "${f.name}"? Notes inside will be moved to root.`)) return;
  try { await api.del(`/api/folders/${f.id}`); await loadFolders(); if (state.selectedFolderId === f.id) setState({ selectedFolderId: null }); loadNotesForCurrentFolder(); }
  catch (e) { toast(e.message, 'error'); }
}

async function createNoteHere() {
  try {
    const created = await api.post('/api/notes', {
      title: 'Untitled',
      content: '',
      folderId: state.selectedFolderId,
    });
    await loadNotesForCurrentFolder();
    openNote(created);
  } catch (e) { toast(e.message, 'error'); }
}
