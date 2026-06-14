import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { getStorage } from './storage/index.js';
import { db } from './db.js';
import {
  validateUsername,
  validateEmail,
  validatePassword,
} from './validation.js';

const COOKIE_NAME = 'jnote_token';
const TOKEN_PREFIX = 'jnote_pat_';

// Dummy bcrypt hash used to flatten login timing when the user does not
// exist. Pre-computed once at module load.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-just-for-timing', 10);

// --- Personal access token helpers ---
export function generateApiToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}
export function hashApiToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}
export function tokenPrefix(plaintext) {
  return plaintext.slice(0, TOKEN_PREFIX.length + 8) + '…';
}

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
    secure: config.cookieSecure,   // set COOKIE_SECURE=1 behind HTTPS
    path: '/',
    maxAge: config.jwtTtlSeconds * 1000,
  });
}
function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function requireAuth(req, res, next) {
  // Bearer token takes precedence over cookie — it's the canonical
  // programmatic-auth path. If a Bearer header is present and valid, use
  // it. If it's present but invalid, fail closed (don't fall through to
  // the cookie, which would let a stale cookie authenticate an
  // otherwise-unauthorized API call).
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token.startsWith(TOKEN_PREFIX)) {
      return res.status(401).json({ error: 'invalid token' });
    }
    const storage = getStorage();
    const apiToken = storage.getApiTokenByHash(hashApiToken(token));
    if (!apiToken) return res.status(401).json({ error: 'invalid token' });
    if (apiToken.expires_at && new Date(apiToken.expires_at) < new Date()) {
      return res.status(401).json({ error: 'token expired' });
    }
    const user = storage.getUserById(apiToken.user_id);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = user;
    // Update last_used_at out-of-band; never block the response on it.
    setImmediate(() => { try { storage.touchApiToken(apiToken.id); } catch {} });
    return next();
  }

  // Fall back to the cookie-based session (the browser path).
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

// ---- OIDC helpers --------------------------------------------------------
// OIDC discovery documents (authorization_endpoint, token_endpoint,
// userinfo_endpoint, ...) are fetched once per process and cached.
const discoveryCache = new Map();
async function getDiscovery(provider) {
  if (discoveryCache.has(provider.id)) return discoveryCache.get(provider.id);
  const res = await fetch(provider.discoveryUrl);
  if (!res.ok) throw new Error(`OIDC discovery failed for ${provider.id} (HTTP ${res.status})`);
  const doc = await res.json();
  discoveryCache.set(provider.id, doc);
  return doc;
}

function oidcStateCookieName(providerId) {
  return `jnote_oidc_state_${providerId.replace(/[^a-z0-9]/gi, '_')}`;
}

function listEnabledProviders() {
  return Object.values(config.oidc.providers).map(p => ({ id: p.id, name: p.name }));
}

// Rate limiters — applied to the relevant routes. max=0 disables.
function makeLimiter(name, def) {
  if (!def.max) return (req, _res, next) => next();
  return rateLimit({
    windowMs: def.windowMs,
    max: def.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many requests, try again later' },
  });
}

const loginLimiter    = makeLimiter('login',    config.rateLimit.login);
const registerLimiter = makeLimiter('register', config.rateLimit.register);

// ---------- routes ----------
export function authRoutes(app) {
  const storage = getStorage();

  // Registration: uniform response — does not reveal whether the username
  // or email is already taken. Validation errors are still surfaced so the
  // user can fix them.
  app.post('/api/auth/register', registerLimiter, (req, res) => {
    const { username, email, password } = req.body || {};
    const GENERIC = { message: 'if the details are valid, your account is awaiting admin approval' };

    const u = validateUsername(username);
    if (u) return res.status(400).json({ error: u });
    const e = email ? validateEmail(email) : null;
    if (e) return res.status(400).json({ error: e });
    const p = validatePassword(password, config.passwordMinLength);
    if (p) return res.status(400).json({ error: p });

    // Silent on duplicates — prevents account enumeration.
    if (storage.getUserByUsername(username)) return res.status(200).json(GENERIC);
    if (email && storage.getUserByEmail(email)) return res.status(200).json(GENERIC);

    try {
      storage.createUser({
        username,
        email: email || null,
        passwordHash: hashPassword(password),
        status: 'pending',
      });
    } catch (err) {
      return res.status(500).json({ error: 'registration failed' });
    }
    return res.status(200).json(GENERIC);
  });

  // Login: uniform response + uniform timing (dummy bcrypt on missing users).
  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'invalid input' });
    }
    if (username.length > 254 || password.length > 1000) {
      return res.status(400).json({ error: 'invalid input' });
    }

    const user = storage.getUserByUsername(username) || storage.getUserByEmail(username);

    if (!user) {
      // Flatten timing — run a real bcrypt against the dummy hash.
      bcrypt.compareSync(password, DUMMY_HASH);
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (!user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    if (user.status !== 'active') {
      // Don't reveal that the account exists but is pending/disabled.
      return res.status(401).json({ error: 'invalid credentials' });
    }
    setAuthCookie(res, signToken(user));
    res.json({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', (_req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

  // ---- Personal access tokens (API keys) ----
  // These allow programmatic access to the API. Cookie auth still works
  // for the SPA; these endpoints let a user mint a long-lived token to
  // use from curl, scripts, third-party tools, etc.
  app.post('/api/auth/tokens', requireAuth, (req, res) => {
    const { name, expiresInDays } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name required' });
    if (name.length > 100) return res.status(400).json({ error: 'name too long (max 100)' });
    if (/[\x00-\x1F\x7F]/.test(name)) return res.status(400).json({ error: 'name contains invalid characters' });

    let expiresAt = null;
    if (expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== '') {
      const days = Number(expiresInDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return res.status(400).json({ error: 'expiresInDays must be an integer 1-3650' });
      }
      expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    }

    const plaintext = generateApiToken();
    const apiToken = storage.createApiToken({
      userId: req.user.id,
      name: name.trim(),
      tokenHash: hashApiToken(plaintext),
      prefix: tokenPrefix(plaintext),
      expiresAt,
    });
    // Return the plaintext token ONCE. It is never stored and cannot be
    // recovered from the hash later.
    res.status(201).json({
      id: apiToken.id,
      name: apiToken.name,
      prefix: apiToken.prefix,
      created_at: apiToken.created_at,
      expires_at: apiToken.expires_at,
      token: plaintext,
    });
  });

  app.get('/api/auth/tokens', requireAuth, (req, res) => {
    res.json(storage.listApiTokens(req.user.id));
  });

  app.delete('/api/auth/tokens/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id invalid' });
    const ok = storage.deleteApiToken(id, req.user.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const token = req.cookies?.[COOKIE_NAME];
    const payload = token ? verifyToken(token) : null;
    const user = payload ? storage.getUserById(payload.sub) : null;
    if (!user || user.status !== 'active') {
      clearAuthCookie(res);
      return res.json({ user: null, providers: listEnabledProviders() });
    }
    res.json({ user: publicUser(user), providers: listEnabledProviders() });
  });

  // ---- Generic OIDC client (per enabled provider in config.oidc.providers) ----
  // Each provider gets two routes: /api/auth/oidc/<id> (start the flow)
  // and /api/auth/oidc/<id>/callback. The provider's discovery doc is fetched
  // and cached, then the standard Authorization Code flow runs. We never
  // link by email — a new OIDC login always creates a fresh pending user.
  for (const provider of Object.values(config.oidc.providers)) {
    // Start: build the authorize URL, set state cookie, redirect.
    app.get(`/api/auth/oidc/${provider.id}`, (req, res) => {
      const state = crypto.randomBytes(16).toString('hex');
      res.cookie(oidcStateCookieName(provider.id), state, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600000,
      });
      getDiscovery(provider).then(discovery => {
        const url = new URL(discovery.authorization_endpoint);
        url.searchParams.set('client_id', provider.clientId);
        url.searchParams.set('redirect_uri', provider.callbackUrl);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', provider.scopes);
        url.searchParams.set('state', state);
        for (const [k, v] of Object.entries(provider.authParams || {})) {
          url.searchParams.set(k, v);
        }
        res.redirect(url.toString());
      }).catch(() => {
        res.redirect(`/?oidc_error=discovery_${encodeURIComponent(provider.id)}`);
      });
    });

    // Callback: exchange code, fetch userinfo, look up / create user.
    app.get(`/api/auth/oidc/${provider.id}/callback`, async (req, res) => {
      const { code, state } = req.query;
      const expected = req.cookies?.[oidcStateCookieName(provider.id)];
      res.clearCookie(oidcStateCookieName(provider.id), { path: '/' });
      if (!code || !state || state !== expected) {
        return res.redirect('/?oidc_error=bad_state');
      }

      try {
        const discovery = await getDiscovery(provider);

        const tokenRes = await fetch(discovery.token_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: String(code),
            client_id: provider.clientId,
            client_secret: provider.clientSecret,
            redirect_uri: provider.callbackUrl,
            grant_type: 'authorization_code',
          }),
        });
        if (!tokenRes.ok) return res.redirect('/?oidc_error=token');
        const tokens = await tokenRes.json();

        const profileRes = await fetch(discovery.userinfo_endpoint, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (!profileRes.ok) return res.redirect('/?oidc_error=profile');
        const profile = await profileRes.json();

        const sub = profile.sub;
        if (!sub) return res.redirect('/?oidc_error=no_sub');
        // We trust the configured issuer — discovery + token exchange were
        // already against it, so iss here is necessarily that issuer.
        const iss = provider.issuer;

        // SECURITY: do NOT link by email. Same posture as the old Google
        // flow — a fresh OIDC login always gets a brand-new pending user.
        let user = storage.getUserByOidc(iss, sub);
        if (!user) {
          const base = (profile.email?.split('@')[0] || 'user')
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '_')
            .slice(0, 45) || 'user';
          let username = base;
          for (let i = 1; storage.getUserByUsername(username); i++) {
            username = `${base}_${i}`.slice(0, 50);
            if (i > 9999) return res.redirect('/?oidc_error=server');
          }
          try {
            user = storage.createUser({
              username,
              email: profile.email || null,
              oidcIss: iss,
              oidcSub: sub,
              status: 'pending',
            });
          } catch (e) {
            return res.redirect('/?oidc_error=server');
          }
        }

        if (user.status !== 'active') {
          return res.redirect(`/?oidc_error=pending&provider=${encodeURIComponent(provider.id)}`);
        }
        setAuthCookie(res, signToken(user));
        res.redirect('/');
      } catch (e) {
        res.redirect('/?oidc_error=server');
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
