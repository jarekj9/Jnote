import path from 'node:path';

// All config is read from env. Defaults are local-dev friendly.
const env = process.env;

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
}

export const config = {
  port: Number(env.PORT || 3000),
  dbPath: env.DB_PATH || path.resolve(process.cwd(), 'data', 'jnote.sqlite'),
  jwtSecret: env.JWT_SECRET || 'dev-secret-change-me',
  jwtTtlSeconds: Number(env.JWT_TTL || 60 * 60 * 24 * 7), // 7 days; set JWT_TTL to override
  publicOrigin: env.PUBLIC_ORIGIN || 'http://localhost:8080',
  cookieSecure: bool(env.COOKIE_SECURE, false),   // set true behind HTTPS
  trustProxyHops: Number(env.TRUST_PROXY_HOPS || 1),
  passwordMinLength: Number(env.PASSWORD_MIN_LENGTH || 8),

  // Per-route rate limit knobs. Set to 0 to disable a limiter.
  rateLimit: {
    login:    { windowMs: 15 * 60 * 1000, max: Number(env.RATE_LIMIT_LOGIN    || 10) },
    register: { windowMs: 60 * 60 * 1000, max: Number(env.RATE_LIMIT_REGISTER || 5)  },
    import:   { windowMs: 60 * 1000,      max: Number(env.RATE_LIMIT_IMPORT   || 5)  },
  },

  admin: {
    username: env.ADMIN_USERNAME || 'admin',
    email: env.ADMIN_EMAIL || 'admin@jnote.local',
    password: env.ADMIN_PASSWORD || '',
  },

  google: {
    // Truthy check, not bool() — client id/secret are long opaque strings,
    // not the "0"/"1"/"true"/"false" values that bool() understands.
    enabled: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: env.GOOGLE_CALLBACK_URL || 'http://localhost:8080/api/auth/google/callback',
  },
};
