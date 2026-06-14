// Abstract storage contract.
// To add a new backend (Postgres, S3, Notion, etc.) implement this class
// and register it in storage/index.js. Keep the surface small and stable.
export class StorageConnector {
  // ---------- users ----------
  createUser({ username, email, passwordHash, googleId, role = 'user', status = 'pending' }) {
    throw new Error('not implemented');
  }
  getUserById(id) { throw new Error('not implemented'); }
  getUserByEmail(email) { throw new Error('not implemented'); }
  getUserByUsername(username) { throw new Error('not implemented'); }
  getUserByGoogleId(googleId) { throw new Error('not implemented'); }
  listUsers() { throw new Error('not implemented'); }
  listPendingUsers() { throw new Error('not implemented'); }
  setUserStatus(id, status) { throw new Error('not implemented'); }
  setUserRole(id, role) { throw new Error('not implemented'); }
  setUserPassword(id, passwordHash) { throw new Error('not implemented'); }
  clearUserPassword(id) { throw new Error('not implemented'); }
  deleteUser(id) { throw new Error('not implemented'); }
  countAdmins() { throw new Error('not implemented'); }

  // ---------- folders ----------
  listFolders(userId, { parentId = null } = {}) { throw new Error('not implemented'); }
  createFolder({ userId, parentId = null, name }) { throw new Error('not implemented'); }
  getFolder(id) { throw new Error('not implemented'); }
  renameFolder(id, name) { throw new Error('not implemented'); }
  deleteFolder(id) { throw new Error('not implemented'); }
  // Move folder to a new parent (or root when null). Refuses cycles.
  moveFolder(id, parentId) { throw new Error('not implemented'); }

  // ---------- notes ----------
  getNote(id) { throw new Error('not implemented'); }
  listNotes(userId, { folderId = null, sort = 'name' } = {}) { throw new Error('not implemented'); }
  listAllNotes(userId) { throw new Error('not implemented'); } // for export
  createNote({ userId, folderId = null, title, content = '' }) { throw new Error('not implemented'); }
  updateNote(id, { title, content, folderId }) { throw new Error('not implemented'); }
  deleteNote(id) { throw new Error('not implemented'); }
  // Returns array of { id, title, snippet, folder_id, updated_at, created_at }
  searchNotes(userId, { query = '', tag = null, limit = 50 } = {}) { throw new Error('not implemented'); }

  // ---------- tags ----------
  listTags(userId) { throw new Error('not implemented'); }
  setNoteTags(noteId, tagNames) { throw new Error('not implemented'); }
  getNoteTags(noteId) { throw new Error('not implemented'); }

  // ---------- bulk import ----------
  // Creates folder tree + notes in one go. Returns counts.
  importTree(userId, tree) { throw new Error('not implemented'); }

  // ---------- personal access tokens ----------
  createApiToken({ userId, name, tokenHash, prefix, expiresAt = null }) { throw new Error('not implemented'); }
  listApiTokens(userId) { throw new Error('not implemented'); }
  getApiTokenByHash(hash) { throw new Error('not implemented'); }
  deleteApiToken(id, userId) { throw new Error('not implemented'); }
  touchApiToken(id) { throw new Error('not implemented'); }
}
