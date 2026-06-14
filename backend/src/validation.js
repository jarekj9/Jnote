// Input validation helpers. Every validator returns null on success or an
// error message string on failure. Use as:
//   const err = validateUsername(req.body.username);
//   if (err) return res.status(400).json({ error: err });
//
// Conventions:
// - Reject any string with ASCII control characters (excludes \t and \n for
//   note content only, where newlines are part of markdown).
// - Enforce hard length caps so a single user cannot bloat the database.
// - Folder/note/tag names additionally reject path separators and "." / "..".

// All ASCII control characters. Used for fields where \t and \n are also
// forbidden (usernames, emails, folder/note/tag names, passwords).
const CTRL_ALL = /[\x00-\x1F\x7F]/;
// Control chars excluding \t (0x09) and \n (0x0A). Used for note content
// where newlines are valid markdown.
const CTRL_SAFE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateUsername(s) {
  if (typeof s !== 'string') return 'username must be a string';
  const t = s.trim();
  if (!t) return 'username required';
  if (t.length > 50) return 'username too long (max 50)';
  if (CTRL_ALL.test(t)) return 'username contains invalid characters';
  return null;
}

export function validateEmail(s) {
  if (s == null || s === '') return null;  // optional
  if (typeof s !== 'string') return 'email must be a string';
  const t = s.trim();
  if (t.length > 254) return 'email too long';
  if (CTRL_ALL.test(t)) return 'email contains invalid characters';
  if (!EMAIL_RE.test(t)) return 'invalid email format';
  return null;
}

export function validatePassword(s, minLength = 8) {
  if (typeof s !== 'string') return 'password must be a string';
  if (s.length < minLength) return `password must be at least ${minLength} characters`;
  if (s.length > 1000) return 'password too long';
  if (CTRL_ALL.test(s)) return 'password contains invalid control characters';
  return null;
}

export function validateNoteTitle(s) {
  if (typeof s !== 'string') return 'title must be a string';
  const t = s.trim();
  if (!t) return 'title required';
  if (t.length > 200) return 'title too long (max 200)';
  if (CTRL_ALL.test(t)) return 'title contains invalid characters';
  return null;
}

export function validateNoteContent(s) {
  if (typeof s !== 'string') return 'content must be a string';
  if (s.length > 500 * 1024) return 'content too large (max 500KB)';
  if (CTRL_SAFE.test(s)) return 'content contains invalid control characters';
  return null;
}

export function validateFolderName(s) {
  if (typeof s !== 'string') return 'name must be a string';
  const t = s.trim();
  if (!t) return 'name required';
  if (t.length > 100) return 'name too long (max 100)';
  if (CTRL_ALL.test(t)) return 'name contains invalid characters';
  if (t === '.' || t === '..' || t.includes('/') || t.includes('\\')) {
    return 'name contains invalid path characters';
  }
  return null;
}

export function validateTagName(s) {
  if (typeof s !== 'string') return 'tag must be a string';
  if (s.length === 0) return 'tag cannot be empty';
  if (s.length > 50) return 'tag too long (max 50)';
  if (CTRL_ALL.test(s)) return 'tag contains invalid characters';
  return null;
}

export function validatePositiveId(v) {
  if (v === null || v === undefined) return null;  // optional
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return 'id must be a positive integer';
  return null;
}

export function validateSearchQuery(s) {
  if (typeof s !== 'string') return 'query must be a string';
  if (s.length > 200) return 'query too long (max 200)';
  if (CTRL_SAFE.test(s)) return 'query contains invalid control characters';
  return null;
}

// Validate an entry path inside an uploaded zip. Reject:
// - absolute paths (/foo, C:\foo)
// - path traversal segments (., ..)
// - control characters
// - path components longer than 100 chars
export function validateZipPath(p) {
  if (typeof p !== 'string') return 'invalid path';
  if (p.length > 1000) return 'path too long';
  if (p.includes('\0')) return 'invalid path';
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return 'absolute paths not allowed';
  const parts = p.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    if (part === '.' || part === '..') return 'path traversal not allowed';
    if (part.length > 100) return 'path component too long';
    if (CTRL_ALL.test(part)) return 'path contains control characters';
  }
  return null;
}
