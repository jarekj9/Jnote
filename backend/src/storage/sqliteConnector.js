import { StorageConnector } from './connector.js';
import { db } from '../db.js';

// Normalize tag names: lowercase, trimmed, no '#', no spaces.
function normTag(s) {
  return String(s || '').trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-');
}

const SORT_SQL = {
  name:        'LOWER(title) ASC',
  name_desc:   'LOWER(title) DESC',
  updated:     'updated_at DESC',
  updated_asc: 'updated_at ASC',
  created:     'created_at DESC',
  created_asc: 'created_at ASC',
};

export class SqliteConnector extends StorageConnector {
  // -------- users --------
  createUser({ username, email, passwordHash = null, googleId = null, role = 'user', status = 'pending' }) {
    const info = db.prepare(`
      INSERT INTO users (username, email, password_hash, google_id, role, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(username, email ?? null, passwordHash, googleId, role, status);
    return this.getUserById(info.lastInsertRowid);
  }
  getUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null; }
  getUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email = ?').get(email) || null; }
  getUserByUsername(username) { return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null; }
  getUserByGoogleId(googleId) { return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) || null; }
  listUsers() { return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all(); }
  listPendingUsers() { return db.prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at ASC").all(); }
  setUserStatus(id, status) { db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id); return this.getUserById(id); }
  setUserRole(id, role) { db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id); return this.getUserById(id); }
  setUserPassword(id, passwordHash) { db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id); }
  clearUserPassword(id) { db.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').run(id); }
  deleteUser(id) {
    // ON DELETE CASCADE on folders/note_tags and ON DELETE CASCADE on
    // tags/note_tags clean up all owned data. notes.folder_id has
    // ON DELETE SET NULL, so a note whose folder is deleted survives as
    // a root-level note — except the note itself is removed by the
    // user_id CASCADE, so this is moot.
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }
  countAdmins() {
    const row = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'active'").get();
    return row.c;
  }

  // -------- folders --------
  listFolders(userId, { parentId = null } = {}) {
    if (parentId === null) {
      return db.prepare('SELECT * FROM folders WHERE user_id = ? AND parent_id IS NULL ORDER BY LOWER(name) ASC').all(userId);
    }
    return db.prepare('SELECT * FROM folders WHERE user_id = ? AND parent_id = ? ORDER BY LOWER(name) ASC').all(userId, parentId);
  }
  createFolder({ userId, parentId = null, name }) {
    const info = db.prepare(`
      INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)
    `).run(userId, parentId, name);
    return db.prepare('SELECT * FROM folders WHERE id = ?').get(info.lastInsertRowid);
  }
  getFolder(id) { return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) || null; }
  renameFolder(id, name) {
    db.prepare(`UPDATE folders SET name = ?, updated_at = datetime('now') WHERE id = ?`).run(name, id);
    return this.getFolder(id);
  }
  deleteFolder(id) {
    db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  }
  moveFolder(id, parentId) {
    if (parentId === id) throw new Error('cannot move folder into itself');
    // Refuse moves that would create a cycle.
    let p = parentId;
    while (p) {
      if (p === id) throw new Error('cycle detected');
      const row = db.prepare('SELECT parent_id AS p FROM folders WHERE id = ?').get(p);
      p = row ? row.p : null;
    }
    db.prepare(`UPDATE folders SET parent_id = ?, updated_at = datetime('now') WHERE id = ?`).run(parentId, id);
    return this.getFolder(id);
  }

  // -------- notes --------
  getNote(id) { return db.prepare('SELECT * FROM notes WHERE id = ?').get(id) || null; }
  listNotes(userId, { folderId = null, sort = 'name' } = {}) {
    const orderBy = SORT_SQL[sort] || SORT_SQL.name;
    if (folderId === null) {
      return db.prepare(`SELECT * FROM notes WHERE user_id = ? AND folder_id IS NULL ORDER BY ${orderBy}`).all(userId);
    }
    return db.prepare(`SELECT * FROM notes WHERE user_id = ? AND folder_id = ? ORDER BY ${orderBy}`).all(userId, folderId);
  }
  listAllNotes(userId) {
    return db.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY folder_id, LOWER(title)').all(userId);
  }
  createNote({ userId, folderId = null, title, content = '' }) {
    const info = db.prepare(`
      INSERT INTO notes (user_id, folder_id, title, content) VALUES (?, ?, ?, ?)
    `).run(userId, folderId, title, content);
    return this.getNote(info.lastInsertRowid);
  }
  updateNote(id, { title, content, folderId }) {
    const cur = this.getNote(id);
    if (!cur) return null;
    const t = title ?? cur.title;
    const c = content ?? cur.content;
    const f = folderId === undefined ? cur.folder_id : folderId;
    db.prepare(`UPDATE notes SET title = ?, content = ?, folder_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(t, c, f, id);
    return this.getNote(id);
  }
  deleteNote(id) { db.prepare('DELETE FROM notes WHERE id = ?').run(id); }

  // FTS5 search with snippet. If query is empty, return notes optionally filtered by tag.
  searchNotes(userId, { query = '', tag = null, limit = 50 } = {}) {
    const params = [userId];
    let where = 'n.user_id = ?';
    let join = '';
    if (tag) {
      join = `JOIN note_tags nt ON nt.note_id = n.id JOIN tags t ON t.id = nt.tag_id AND t.name = ?`;
      params.unshift(tag);
    }
    if (query && query.trim()) {
      const q = sanitizeFtsQuery(query);
      if (q) {
        const sql = `
          SELECT n.id, n.title, n.folder_id, n.created_at, n.updated_at,
                 snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet
          FROM notes_fts
          JOIN notes n ON n.id = notes_fts.rowid
          ${join}
          WHERE ${where} AND notes_fts MATCH ?
          ORDER BY rank
          LIMIT ?`;
        return db.prepare(sql).all(...params, q, limit);
      }
    }
    const sql = `
      SELECT n.id, n.title, n.folder_id, n.created_at, n.updated_at,
             substr(n.content, 1, 120) AS snippet
      FROM notes n
      ${join}
      WHERE ${where}
      ORDER BY n.updated_at DESC
      LIMIT ?`;
    return db.prepare(sql).all(...params, limit);
  }

  // -------- tags --------
  listTags(userId) {
    return db.prepare(`
      SELECT t.name, COUNT(nt.note_id) AS count
      FROM tags t LEFT JOIN note_tags nt ON nt.tag_id = t.id
      WHERE t.user_id = ?
      GROUP BY t.id ORDER BY LOWER(t.name) ASC
    `).all(userId);
  }
  setNoteTags(noteId, tagNames) {
    const note = this.getNote(noteId);
    if (!note) return;
    const tx = db.transaction((userId, names) => {
      db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId);
      for (const raw of names) {
        const n = normTag(raw);
        if (!n) continue;
        let row = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, n);
        if (!row) row = db.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?) RETURNING id').get(userId, n);
        db.prepare('INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, row.id);
      }
    });
    tx(note.user_id, tagNames);
  }
  getNoteTags(noteId) {
    return db.prepare(`
      SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name
    `).all(noteId).map(r => r.name);
  }

  // -------- import --------
  // tree = [{ name, notes: [{title, content}], folders: [tree...] }]
  importTree(userId, tree, parentId = null) {
    let folderCount = 0, noteCount = 0;
    const tx = db.transaction((entries) => {
      for (const entry of entries) {
        const folder = this.createFolder({ userId, parentId, name: entry.name });
        folderCount++;
        for (const n of entry.notes || []) {
          this.createNote({ userId, folderId: folder.id, title: n.title, content: n.content || '' });
          noteCount++;
        }
        if (entry.folders?.length) {
          const sub = this.importTree(userId, entry.folders, folder.id);
          folderCount += sub.folders;
          noteCount += sub.notes;
        }
      }
    });
    tx(tree);
    return { folders: folderCount, notes: noteCount };
  }
}

// FTS5 query sanitizer: escape special chars, append '*' for prefix match on the last token.
function sanitizeFtsQuery(input) {
  const tokens = String(input).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const safe = tokens.map(t => {
    const cleaned = t.replace(/["()*:^]/g, ' ');
    return cleaned.length ? `"${cleaned}"*` : '';
  }).filter(Boolean);
  return safe.join(' ');
}
