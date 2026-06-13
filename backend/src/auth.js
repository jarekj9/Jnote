import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { getStorage } from './storage/index.js';
import { db } from './db.js';

const COOKIE_NAME = 'jnote_token';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}
export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtTtlSeconds }
  );
}
export function verifyToken(token) {
  try { return jwt.verify(token, config.jwtSecret); } catch { return null; }
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // set true behind HTTPS
    path: '/',
    maxAge: config.jwtTtlSeconds * 1000,
  });
}
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  const user = getStorage().getUserById(payload.sub);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, email: u.email, role: u.role, status: u.status };
}

// ---------- routes ----------
export function authRoutes(app) {
  const storage = getStorage();

  app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    if (storage.getUserByUsername(username)) return res.status(409).json({ error: 'username taken' });
    if (email && storage.getUserByEmail(email)) return res.status(409).json({ error: 'email taken' });
    const user = storage.createUser({
      username,
      email: email || null,
      passwordHash: hashPassword(password),
      status: 'pending',
    });
    res.status(201).json({ user: publicUser(user), message: 'awaiting admin approval' });
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const user = username ? storage.getUserByUsername(username) || storage.getUserByEmail(username) : null;
    if (!user || !user.password_hash || !verifyPassword(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'account not active' });
    setAuthCookie(res, signToken(user));
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (_req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

  app.get('/api/auth/me', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    const payload = token ? verifyToken(token) : null;
    const user = payload ? storage.getUserById(payload.sub) : null;
    // Treat any non-active user (pending / disabled) as logged out and clear
    // their stale cookie so the frontend doesn't get stuck on the app shell.
    if (!user || user.status !== 'active') {
      clearAuthCookie(res);
      return res.json({ user: null, googleEnabled: config.google.enabled });
    }
    res.json({ user: publicUser(user), googleEnabled: config.google.enabled });
  });

  // ---- Google OAuth (only if configured) ----
  if (config.google.enabled) {
    app.get('/api/auth/google', (req, res) => {
      const state = crypto.randomBytes(16).toString('hex');
      res.cookie('jnote_oauth_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600000 });
      const params = new URLSearchParams({
        client_id: config.google.clientId,
        redirect_uri: config.google.callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'online',
        prompt: 'select_account',
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    });

    app.get('/api/auth/google/callback', async (req, res) => {
      const { code, state } = req.query;
      const expected = req.cookies?.jnote_oauth_state;
      res.clearCookie('jnote_oauth_state', { path: '/' });
      if (!code || !state || state !== expected) return res.redirect('/?oauth_error=bad_state');

      try {
        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: String(code),
            client_id: config.google.clientId,
            client_secret: config.google.clientSecret,
            redirect_uri: config.google.callbackUrl,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) return res.redirect('/?oauth_error=token');
        const tokens = await tokenRes.json();

        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!profileRes.ok) return res.redirect('/?oauth_error=profile');
        const profile = await profileRes.json();

        let user = storage.getUserByGoogleId(profile.id);
        if (!user && profile.email) user = storage.getUserByEmail(profile.email);

        if (user) {
          // Link google id if missing on an existing account.
          if (!user.google_id) db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(profile.id, user.id);
        } else {
          user = storage.createUser({
            username: profile.email?.split('@')[0] || `user${Date.now()}`,
            email: profile.email,
            googleId: profile.id,
            status: 'pending',
          });
        }

        if (user.status !== 'active') return res.redirect('/?oauth_error=pending');
        setAuthCookie(res, signToken(user));
        res.redirect('/');
      } catch (e) {
        res.redirect('/?oauth_error=server');
      }
    });
  }
}

// One-time admin bootstrap. Logs a random password to console unless env provided.
export function bootstrapAdmin() {
  const storage = getStorage();
  const existing = storage.getUserByUsername(config.admin.username);
  if (existing) {
    if (existing.status !== 'active') storage.setUserStatus(existing.id, 'active');
    if (existing.role !== 'admin') storage.setUserRole(existing.id, 'admin');
    return;
  }
  const password = config.admin.password || crypto.randomBytes(9).toString('base64url');
  const user = storage.createUser({
    username: config.admin.username,
    email: config.admin.email,
    passwordHash: hashPassword(password),
    role: 'admin',
    status: 'active',
  });
  // eslint-disable-next-line no-console
  console.log('\n========================================');
  console.log(`[Jnote] Admin user created`);
  console.log(`  username: ${user.username}`);
  console.log(`  password: ${password}`);
  console.log('========================================\n');
}
