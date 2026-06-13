// Editor: a plain textarea with a toolbar that wraps / unwraps the selection
// in the correct markdown syntax. Also supports keyboard shortcuts and an
// auto-save to the server.
import { api } from './api.js';
import { state, setState, on, emit_ } from './state.js';
import { renderMarkdown } from './markdown.js';
import { toast } from './toast.js';

let saveTimer = null;
let preview = false;
let lastSaved = { title: '', content: '', tags: '' };

export function initEditor() {
  const editor = document.getElementById('editor');
  const title  = document.getElementById('noteTitle');
  const tags   = document.getElementById('noteTags');
  const previewEl = document.getElementById('preview');
  const previewBtn = document.getElementById('previewToggle');

  // Toolbar actions
  document.getElementById('toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    applyAction(btn.dataset.act);
    editor.focus();
  });

  // Keyboard shortcuts (Ctrl/Cmd+B/I/K)
  editor.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === 'b') { e.preventDefault(); applyAction('bold'); }
    else if (e.key === 'i') { e.preventDefault(); applyAction('italic'); }
    else if (e.key === 'k') { e.preventDefault(); applyAction('link'); }
  });
  // Tab inserts two spaces instead of changing focus.
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, t = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(t);
      editor.selectionStart = editor.selectionEnd = s + 2;
      scheduleSave();
    }
  });

  // Save on input (debounced).
  [editor, title, tags].forEach(el => el.addEventListener('input', scheduleSave));
  tags.addEventListener('change', flushSave);

  previewBtn.addEventListener('click', () => {
    preview = !preview;
    previewEl.hidden = !preview;
    editor.hidden = preview;
    if (preview) renderPreview();
    previewBtn.classList.toggle('active', preview);
  });

  document.getElementById('deleteNoteBtn').addEventListener('click', deleteCurrentNote);
  document.getElementById('exportNoteBtn').addEventListener('click', exportCurrentNote);
}

function scheduleSave() {
  if (!state.openNote) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

async function flushSave() {
  if (!state.openNote) return;
  const title  = document.getElementById('noteTitle').value;
  const content = document.getElementById('editor').value;
  const tagsRaw = document.getElementById('noteTags').value;
  const tags = parseTags(tagsRaw);
  const same = title === lastSaved.title && content === lastSaved.content
    && tags.join(',') === lastSaved.tags;
  if (same) return;
  try {
    const updated = await api.patch(`/api/notes/${state.openNote.id}`, { title, content, tags });
    lastSaved = { title, content, tags: tags.join(',') };
    setState({ openNote: updated });
    emit_('note:updated');   // tell sidebar / search to refresh
    if (preview) renderPreview();
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

function renderPreview() {
  const md = document.getElementById('editor').value;
  document.getElementById('preview').innerHTML = renderMarkdown(md);
}

export function parseTags(s) {
  return (s || '').split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean);
}

export function openNote(note) {
  flushSave(); // persist previous edits before swapping
  setState({ openNote: note });
  document.getElementById('empty').hidden = true;
  document.getElementById('noteContainer').hidden = false;

  const title = document.getElementById('noteTitle');
  const editor = document.getElementById('editor');
  const tags = document.getElementById('noteTags');
  const dates = document.getElementById('noteDates');

  title.value = note.title;
  editor.value = note.content;
  tags.value = (note.tags || []).join(', ');
  dates.textContent = `modified ${formatDate(note.updated_at)} • created ${formatDate(note.created_at)}`;

  lastSaved = { title: note.title, content: note.content, tags: (note.tags || []).join(',') };
  if (preview) renderPreview();
  document.getElementById('preview').hidden = !preview;
  document.getElementById('editor').hidden = preview;
}

export function closeNote() {
  flushSave();
  setState({ openNote: null });
  document.getElementById('empty').hidden = false;
  document.getElementById('noteContainer').hidden = true;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString();
}

async function deleteCurrentNote() {
  if (!state.openNote) return;
  if (!confirm('Delete this note?')) return;
  const id = state.openNote.id;
  try {
    await api.del(`/api/notes/${id}`);
    closeNote();
    emit_('note:deleted');
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

function exportCurrentNote() {
  if (!state.openNote) return;
  location.href = `/api/export/note/${state.openNote.id}`;
}

// --------------------- Toolbar actions ---------------------
// Each action manipulates the textarea selection and replaces it in place.
function applyAction(act) {
  const ed = document.getElementById('editor');
  const s = ed.selectionStart, t = ed.selectionEnd;
  const sel = ed.value.slice(s, t);
  const before = ed.value.slice(0, s);
  const after = ed.value.slice(t);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEndRel = after.indexOf('\n');
  const lineEnd = lineEndRel === -1 ? ed.value.length : t + lineEndRel;
  const line = ed.value.slice(lineStart, lineEnd);

  let newSelStart = s, newSelEnd = t, replacement = sel;
  switch (act) {
    case 'bold':       replacement = toggleWrap(sel, '**'); break;
    case 'italic':     replacement = toggleWrap(sel, '*'); break;
    case 'strike':     replacement = toggleWrap(sel, '~~'); break;
    case 'code':       replacement = sel ? toggleWrap(sel, '`') : '`code`'; break;
    case 'codeblock':  replacement = sel ? `\`\`\`\n${sel}\n\`\`\`` : '```\ncode\n```'; break;
    case 'quote':      return transformLines(lineStart, lineEnd, line => (line.startsWith('> ') ? line.slice(2) : '> ' + line));
    case 'ul':         return transformLines(lineStart, lineEnd, line => (/^[-*] /.test(line) ? line : '- ' + line));
    case 'ol':         return transformLines(lineStart, lineEnd, line => (/^\d+\. /.test(line) ? line : '1. ' + line));
    case 'link': {
      const url = prompt('URL', sel.startsWith('http') ? sel : 'https://');
      if (!url) return;
      replacement = sel ? `[${sel}](${url})` : `[text](${url})`;
      break;
    }
    case 'h1': return setHeadingLevel(1);
    case 'h2': return setHeadingLevel(2);
    case 'h3': return setHeadingLevel(3);
    case 'h-up':   return shiftHeading(-1);
    case 'h-down': return shiftHeading(+1);
    default: return;
  }
  ed.value = before + replacement + after;
  ed.selectionStart = s;
  ed.selectionEnd = s + replacement.length;
  ed.dispatchEvent(new Event('input'));
}

// Generic helpers -----------------------------------------------------
function toggleWrap(sel, marker) {
  if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= 2 * marker.length) {
    return sel.slice(marker.length, -marker.length);
  }
  return marker + sel + marker;
}
// Apply `fn` to each line that intersects the current selection, replacing
// that range in the textarea and re-firing input. Used by ul/ol/quote actions.
function transformLines(lineStart, lineEnd, fn) {
  const ed = document.getElementById('editor');
  const block = ed.value.slice(lineStart, lineEnd);
  const out = block.split('\n').map(fn).join('\n');
  ed.value = ed.value.slice(0, lineStart) + out + ed.value.slice(lineEnd);
  ed.selectionStart = lineStart;
  ed.selectionEnd = lineStart + out.length;
  ed.dispatchEvent(new Event('input'));
}

function headingLevel(line) {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : 0;
}
function setHeadingLevel(n) {
  const ed = document.getElementById('editor');
  const s = ed.selectionStart;
  const before = ed.value.slice(0, s);
  const lineStart = before.lastIndexOf('\n') + 1;
  const after = ed.value.slice(s);
  const lineEnd = (after.indexOf('\n') === -1) ? ed.value.length : s + after.indexOf('\n');
  const line = ed.value.slice(lineStart, lineEnd);
  const stripped = line.replace(/^#{1,6}\s/, '');
  const prefix = '#'.repeat(n) + ' ';
  const newLine = prefix + stripped;
  ed.value = ed.value.slice(0, lineStart) + newLine + ed.value.slice(lineEnd);
  ed.selectionStart = ed.selectionEnd = lineStart + newLine.length;
  ed.dispatchEvent(new Event('input'));
}
function shiftHeading(delta) {
  const ed = document.getElementById('editor');
  const s = ed.selectionStart;
  const before = ed.value.slice(0, s);
  const lineStart = before.lastIndexOf('\n') + 1;
  const after = ed.value.slice(s);
  const lineEnd = (after.indexOf('\n') === -1) ? ed.value.length : s + after.indexOf('\n');
  const line = ed.value.slice(lineStart, lineEnd);
  const lvl = headingLevel(line);
  if (lvl === 0) return setHeadingLevel(delta > 0 ? 2 : 1);
  const newLvl = Math.max(0, Math.min(6, lvl + delta));
  const stripped = line.replace(/^#{1,6}\s/, '');
  const prefix = newLvl ? '#'.repeat(newLvl) + ' ' : '';
  const newLine = prefix + stripped;
  ed.value = ed.value.slice(0, lineStart) + newLine + ed.value.slice(lineEnd);
  ed.selectionStart = ed.selectionEnd = lineStart + newLine.length;
  ed.dispatchEvent(new Event('input'));
}
