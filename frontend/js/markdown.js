// Markdown rendering using marked + DOMPurify. Also exports a generic HTML
// sanitizer used for non-markdown HTML fragments (e.g. FTS5 search snippets
// that contain <mark> tags).
export function renderMarkdown(md) {
  if (!window.marked || !window.DOMPurify) return escapeHtml(md || '');
  const html = window.marked.parse(md || '');
  return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
}

// Sanitize an arbitrary HTML string. Used for HTML fragments produced by
// non-markdown sources (e.g. FTS5 snippet() output) so user-controlled
// content cannot inject scripts or event handlers via innerHTML.
export function sanitizeHtml(html, allowedTags = ['mark']) {
  if (!window.DOMPurify) return escapeHtml(String(html || ''));
  return window.DOMPurify.sanitize(String(html || ''), { ALLOWED_TAGS: allowedTags });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
