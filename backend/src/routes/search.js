import { requireAuth } from '../auth.js';
import { getStorage } from '../storage/index.js';
import { validateSearchQuery } from '../validation.js';

export function searchRoutes(app) {
  const storage = getStorage();

  app.get('/api/search', requireAuth, (req, res) => {
    const qErr = validateSearchQuery(req.query.q);
    if (qErr) return res.status(400).json({ error: qErr });
    if (req.query.tag !== undefined && req.query.tag !== null) {
      if (typeof req.query.tag !== 'string' || req.query.tag.length > 50) {
        return res.status(400).json({ error: 'tag invalid' });
      }
    }
    const q = String(req.query.q || '');
    const tag = req.query.tag ? String(req.query.tag) : null;
    const results = storage.searchNotes(req.user.id, { query: q, tag, limit: 50 });
    res.json(results);
  });
}
