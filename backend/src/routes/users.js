import { requireAuth, requireAdmin } from '../auth.js';
import { hashPassword } from '../auth.js';
import { config } from '../config.js';
import { getStorage } from '../storage/index.js';
import { validatePassword } from '../validation.js';

// Map an OIDC issuer URL to the configured provider's display name
// (e.g. "https://accounts.google.com" → "Google"). Falls back to the
// raw issuer if no provider matches.
function oidcLabel(iss) {
  if (!iss) return null;
  for (const p of Object.values(config.oidc.providers)) {
    if (p.issuer === iss) return p.name;
  }
  return iss;
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role,
    status: u.status,
    has_password: !!u.password_hash,
    oidc_issuer: u.oidc_iss || null,
    oidc_label: oidcLabel(u.oidc_iss),
    created_at: u.created_at,
  };
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
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    res.json(publicUser(storage.setUserStatus(id, 'active')));
  });

  app.post('/api/users/:id/disable', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.role === 'admin' && storage.countAdmins() <= 1) {
      return res.status(400).json({ error: 'cannot disable the only active admin' });
    }
    res.json(publicUser(storage.setUserStatus(id, 'disabled')));
  });

  // Re-enable a previously disabled user. The user keeps their role and
  // data; they just become login-eligible again. The user will need to log
  // back in (their existing JWTs are still valid; requireAuth re-checks
  // status on every request).
  app.post('/api/users/:id/enable', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.status === 'active') return res.status(400).json({ error: 'user is already active' });
    res.json(publicUser(storage.setUserStatus(id, 'active')));
  });

  app.post('/api/users/:id/role', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
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
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const err = validatePassword(req.body.password, config.passwordMinLength);
    if (err) return res.status(400).json({ error: err });
    storage.setUserPassword(id, hashPassword(req.body.password));
    res.json({ ok: true });
  });

  // Clear a user's password. The user will then be unable to log in via
  // username/password — they can only use Google (if linked) or have an
  // admin set a new password for them. This is the way to revert a
  // Google-only user back to Google-only after an admin set a password
  // for them.
  app.delete('/api/users/:id/password', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (!u.password_hash) return res.status(400).json({ error: 'user has no password to clear' });
    // Safety: don't let the only active admin clear their own password
    // unless they have at least one OIDC identity linked, to avoid lock-out.
    if (id === req.user.id && !u.oidc_iss) {
      return res.status(400).json({ error: 'cannot clear your own password without an OIDC identity linked' });
    }
    storage.clearUserPassword(id);
    res.json({ ok: true });
  });

  // Permanently delete a user and all their data. Safety checks:
  // - cannot delete yourself
  // - cannot delete the last active admin
  // - CASCADE on the schema cleans up folders, notes, tags, note_tags
  app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    if (id === req.user.id) return res.status(400).json({ error: 'cannot delete your own account from the admin panel' });
    const u = storage.getUserById(id);
    if (!u) return res.status(404).json({ error: 'not found' });
    if (u.role === 'admin' && storage.countAdmins() <= 1) {
      return res.status(400).json({ error: 'cannot delete the only active admin' });
    }
    storage.deleteUser(id);
    res.json({ ok: true });
  });
}
