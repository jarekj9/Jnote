// Folder + note + tag routes. All require auth.
import { requireAuth } from '../auth.js';
import { getStorage } from '../storage/index.js';
import {
  validateFolderName,
  validateNoteTitle,
  validateNoteContent,
  validateTagName,
  validatePositiveId,
} from '../validation.js';

function bad(res, msg) { return res.status(400).json({ error: msg }); }

export function noteRoutes(app) {
  const storage = getStorage();

  // ---- folders ----
  app.get('/api/folders', requireAuth, (req, res) => {
    const parentId = req.query.parentId ? Number(req.query.parentId) : null;
    if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
      return bad(res, 'parentId invalid');
    }
    res.json(storage.listFolders(req.user.id, { parentId }));
  });

  app.post('/api/folders', requireAuth, (req, res) => {
    const { name, parentId = null } = req.body || {};
    const e = validateFolderName(name);
    if (e) return bad(res, e);
    const pidErr = validatePositiveId(parentId);
    if (pidErr) return bad(res, pidErr);
    if (parentId) {
      const p = storage.getFolder(parentId);
      if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'parent not found' });
    }
    const f = storage.createFolder({ userId: req.user.id, parentId, name: name.trim() });
    res.status(201).json(f);
  });

  app.patch('/api/folders/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'id invalid');
    const f = storage.getFolder(id);
    if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    if (req.body.name !== undefined) {
      const e = validateFolderName(req.body.name);
      if (e) return bad(res, e);
      storage.renameFolder(f.id, String(req.body.name).trim());
    }
    if (req.body.parentId !== undefined) {
      const pidErr = validatePositiveId(req.body.parentId);
      if (pidErr) return bad(res, pidErr);
      try { storage.moveFolder(f.id, req.body.parentId ?? null); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    res.json(storage.getFolder(f.id));
  });

  app.delete('/api/folders/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'id invalid');
    const f = storage.getFolder(id);
    if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    storage.deleteFolder(f.id);
    res.json({ ok: true });
  });

  // ---- notes ----
  app.get('/api/notes', requireAuth, (req, res) => {
    let folderId;
    if (req.query.folderId === undefined) folderId = null;
    else if (req.query.folderId === '') folderId = null;
    else folderId = Number(req.query.folderId);
    if (folderId !== null && (!Number.isInteger(folderId) || folderId <= 0)) {
      return bad(res, 'folderId invalid');
    }
    const sort = String(req.query.sort || 'name');
    res.json(storage.listNotes(req.user.id, { folderId, sort }));
  });

  app.get('/api/notes/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'id invalid');
    const n = storage.getNote(id);
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    res.json({ ...n, tags: storage.getNoteTags(n.id) });
  });

  app.post('/api/notes', requireAuth, (req, res) => {
    const { title, content = '', folderId = null, tags = [] } = req.body || {};
    const e = validateNoteTitle(title);
    if (e) return bad(res, e);
    const c = validateNoteContent(content);
    if (c) return bad(res, c);
    const fidErr = validatePositiveId(folderId);
    if (fidErr) return bad(res, fidErr);
    if (!Array.isArray(tags)) return bad(res, 'tags must be an array');
    for (const t of tags) {
      const te = validateTagName(t);
      if (te) return bad(res, te);
    }
    if (folderId) {
      const f = storage.getFolder(folderId);
      if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'folder not found' });
    }
    const n = storage.createNote({ userId: req.user.id, folderId, title: title.trim(), content });
    storage.setNoteTags(n.id, tags);
    res.status(201).json({ ...n, tags: storage.getNoteTags(n.id) });
  });

  app.patch('/api/notes/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'id invalid');
    const n = storage.getNote(id);
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if (req.body.title !== undefined) {
      const e = validateNoteTitle(req.body.title);
      if (e) return bad(res, e);
      patch.title = String(req.body.title).trim() || n.title;
    }
    if (req.body.content !== undefined) {
      const c = validateNoteContent(req.body.content);
      if (c) return bad(res, c);
      patch.content = String(req.body.content);
    }
    if (req.body.folderId !== undefined) {
      const fidErr = validatePositiveId(req.body.folderId);
      if (fidErr) return bad(res, fidErr);
      if (req.body.folderId !== null) {
        const f = storage.getFolder(req.body.folderId);
        if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'folder not found' });
      }
      patch.folderId = req.body.folderId;
    }
    const updated = storage.updateNote(n.id, patch);
    if (Array.isArray(req.body.tags)) {
      for (const t of req.body.tags) {
        const te = validateTagName(t);
        if (te) return bad(res, te);
      }
      storage.setNoteTags(n.id, req.body.tags);
    }
    res.json({ ...updated, tags: storage.getNoteTags(n.id) });
  });

  app.delete('/api/notes/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return bad(res, 'id invalid');
    const n = storage.getNote(id);
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    storage.deleteNote(n.id);
    res.json({ ok: true });
  });

  // ---- tags ----
  app.get('/api/tags', requireAuth, (_req, res) => {
    res.json(storage.listTags(_req.user.id));
  });
}
