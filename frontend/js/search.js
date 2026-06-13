// Live search: debounce, support "tag:foo" and "#foo" syntax, and render
// results in the sidebar. Empty query reverts to the normal folder/notes view.
import { api } from './api.js';
import { state, setState } from './state.js';
import { renderSidebar } from './sidebar.js';
import { openNote } from './editor.js';

let timer;

export function initSearch() {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', (e) => {
    clearTimeout(timer);
    const v = e.target.value;
    timer = setTimeout(() => runSearch(v), 150);
  });
  // Enter focuses first result / opens it.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = state.searchResults?.[0];
      if (r) {
        api.get('/api/notes/' + r.id).then(openNote);
      }
    } else if (e.key === 'Escape') {
      input.value = '';
      runSearch('');
    }
  });
}

async function runSearch(raw) {
  const v = (raw || '').trim();
  if (!v) {
    setState({ searchQuery: '', searchResults: null });
    renderSidebar();                       // direct re-render (don't rely on the change event)
    return;
  }
  setState({ searchQuery: v });
  // Tag-only shortcut: only when the user explicitly opts in with "#" or
  // "tag:" prefix. Otherwise a bare word (e.g. "723") would silently become
  // a tag query and miss content matches.
  const tagOnly = v.match(/^(?:#|tag:)([\w-]+)$/);
  let results;
  if (tagOnly) {
    const tag = tagOnly[1].toLowerCase();
    results = await api.get('/api/search?tag=' + encodeURIComponent(tag));
  } else {
    results = await api.get('/api/search?q=' + encodeURIComponent(v));
  }
  setState({ searchResults: results });
  renderSidebar();                         // direct re-render
}
