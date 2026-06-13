import { requireAuth, requireAdmin } from '../auth.js';
import { getStorage } from '../storage/index.js';
import { hashPassword } from '../auth.js';

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, role: u.role, status: u.status, created_at: u.created_at };
}

export function userRoutes(app) {
  const storage = getStorage();

  // Admin: list all users
  app.get('/api/users', requireAuth, requireAdmin, (_req, res) => {
    res.json(storage.listUsers().map(publicUser));
  });

  app.get('/api/users/pending', requireAuth, requireAdmin, (_req, res) => {
    res.json(storage.listPendingUsers().map(publicUser));
  });

  app.post('/api/users/:id/approve', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json(publicUser(storage.setUserStatus(id, 'active')));
  });

  app.post('/api/users/:id/disable', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.role === 'admin' && storage.countAdmins() <= 1) {
      return res.status(400).json({ error: 'cannot disable the only active admin' });
    }
    res.json(publicUser(storage.setUserStatus(id, 'disabled')));
  });

  app.post('/api/users/:id/role', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const role = String(req.body.role || '');
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (role === 'user' && u.role === 'admin' && storage.countAdmins() <= 1) {
      return res.status(400).json({ error: 'cannot demote the only active admin' });
    }
    if (role === 'admin' && u.status !== 'active') storage.setUserStatus(id, 'active');
    res.json(publicUser(storage.setUserRole(id, role)));
  });

  app.post('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const password = String(req.body.password || '');
    if (password.length < 4) return res.status(400).json({ error: 'password too short' });
    storage.setUserPassword(id, hashPassword(password));
    res.json({ ok: true });
  });
}
