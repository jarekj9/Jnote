// Markdown rendering using marked + DOMPurify.
export function renderMarkdown(md) {
  if (!window.marked || !window.DOMPurify) return escapeHtml(md || '');
  const html = window.marked.parse(md || '');
  return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
