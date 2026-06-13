// Simple pub/sub store. Modules subscribe to changes they care about.
const subs = new Map();
let timer = null;
function emit(event, payload) {
  // batch within a microtask to avoid duplicate renders
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const [ev, fns] of subs.entries()) {
      if (ev === '*' || ev === event) for (const fn of fns) try { fn(payload); } catch (e) { console.error(e); }
    }
  }, 0);
}
export function on(events, fn) {
  for (const ev of [].concat(events)) {
    if (!subs.has(ev)) subs.set(ev, new Set());
    subs.get(ev).add(fn);
  }
  return () => { for (const ev of [].concat(events)) subs.get(ev)?.delete(fn); };
}

export const state = {
  user: null,
  googleEnabled: false,

  // Folder tree as a flat list of all folders the user owns.
  // sidebar.js manages expansion state in a separate Set.
  folders: [],          // [{id, parent_id, name}]
  notes: [],            // notes for the currently selected folder (or root)
  tags: [],             // [{name, count}]
  activeTag: null,

  // Note currently open in the editor.
  openNote: null,       // {id, title, content, tags, ...}

  // UI state
  searchQuery: '',
  searchResults: null,  // array of hits or null when not searching
  sort: 'name',
  sidebarOpen: window.matchMedia('(max-width: 720px)').matches, // mobile: closed by default
  expanded: new Set(),  // expanded folder ids
  selectedFolderId: null,
};

export function setState(patch) { Object.assign(state, patch); emit('change', patch); }
export function emit_(event) { emit(event); }
