import { requireAuth } from '../auth.js';
import { getStorage } from '../storage/index.js';

export function searchRoutes(app) {
  const storage = getStorage();

  app.get('/api/search', requireAuth, (req, res) => {
    const q = String(req.query.q || '');
    const tag = req.query.tag ? String(req.query.tag) : null;
    const results = storage.searchNotes(req.user.id, { query: q, tag, limit: 50 });
    res.json(results);
  });
}
