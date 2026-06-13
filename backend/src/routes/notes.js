// Folder + note + tag routes. All require auth.
import { requireAuth } from '../auth.js';
import { getStorage } from '../storage/index.js';

export function noteRoutes(app) {
  const storage = getStorage();

  // ---- folders ----
  app.get('/api/folders', requireAuth, (req, res) => {
    const parentId = req.query.parentId ? Number(req.query.parentId) : null;
    res.json(storage.listFolders(req.user.id, { parentId }));
  });

  app.post('/api/folders', requireAuth, (req, res) => {
    const { name, parentId = null } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'name required' });
    if (parentId) {
      const p = storage.getFolder(parentId);
      if (!p || p.user_id !== req.user.id) return res.status(404).json({ error: 'parent not found' });
    }
    const f = storage.createFolder({ userId: req.user.id, parentId, name: name.trim() });
    res.status(201).json(f);
  });

  app.patch('/api/folders/:id', requireAuth, (req, res) => {
    const f = storage.getFolder(Number(req.params.id));
    if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    if (req.body.name !== undefined) storage.renameFolder(f.id, String(req.body.name).trim());
    if (req.body.parentId !== undefined) {
      try { storage.moveFolder(f.id, req.body.parentId ?? null); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    res.json(storage.getFolder(f.id));
  });

  app.delete('/api/folders/:id', requireAuth, (req, res) => {
    const f = storage.getFolder(Number(req.params.id));
    if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    storage.deleteFolder(f.id);
    res.json({ ok: true });
  });

  // ---- notes ----
  app.get('/api/notes', requireAuth, (req, res) => {
    const folderId = req.query.folderId === undefined ? null : (req.query.folderId ? Number(req.query.folderId) : null);
    const sort = String(req.query.sort || 'name');
    res.json(storage.listNotes(req.user.id, { folderId, sort }));
  });

  app.get('/api/notes/:id', requireAuth, (req, res) => {
    const n = storage.getNote(Number(req.params.id));
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    res.json({ ...n, tags: storage.getNoteTags(n.id) });
  });

  app.post('/api/notes', requireAuth, (req, res) => {
    const { title, content = '', folderId = null, tags = [] } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });
    if (folderId) {
      const f = storage.getFolder(folderId);
      if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'folder not found' });
    }
    const n = storage.createNote({ userId: req.user.id, folderId, title: title.trim(), content });
    if (Array.isArray(tags)) storage.setNoteTags(n.id, tags);
    res.status(201).json({ ...n, tags: storage.getNoteTags(n.id) });
  });

  app.patch('/api/notes/:id', requireAuth, (req, res) => {
    const n = storage.getNote(Number(req.params.id));
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).trim() || n.title;
    if (req.body.content !== undefined) patch.content = String(req.body.content);
    if (req.body.folderId !== undefined) {
      if (req.body.folderId !== null) {
        const f = storage.getFolder(req.body.folderId);
        if (!f || f.user_id !== req.user.id) return res.status(404).json({ error: 'folder not found' });
      }
      patch.folderId = req.body.folderId;
    }
    const updated = storage.updateNote(n.id, patch);
    if (Array.isArray(req.body.tags)) storage.setNoteTags(n.id, req.body.tags);
    res.json({ ...updated, tags: storage.getNoteTags(n.id) });
  });

  app.delete('/api/notes/:id', requireAuth, (req, res) => {
    const n = storage.getNote(Number(req.params.id));
    if (!n || n.user_id !== req.user.id) return res.status(404).json({ error: 'not found' });
    storage.deleteNote(n.id);
    res.json({ ok: true });
  });

  // ---- tags ----
  app.get('/api/tags', requireAuth, (req, res) => {
    res.json(storage.listTags(req.user.id));
  });
}
