import path from 'node:path';

// All config is read from env. Defaults are local-dev friendly.
const env = process.env;

function bool(v, def = false) {
  if (v === undefined || v === '') return def;
  return v === '1' || v.toLowerCase() === 'true';
}

// Build the OIDC provider list from env vars. Each provider is a config
// entry; the callback URLs are derived from PUBLIC_ORIGIN. To add a new
// provider, add an entry here and the matching env vars.
function parseOidcProviders() {
  const providers = {};
  const origin = (env.PUBLIC_ORIGIN || 'http://localhost:8080').replace(/\/+$/, '');

  // Google
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      id: 'google',
      name: 'Google',
      issuer: 'https://accounts.google.com',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      callbackUrl: `${origin}/api/auth/oidc/google/callback`,
      scopes: 'openid email profile',
      authParams: { prompt: 'select_account', access_type: 'online' },
    };
  }

  // Authelia — operator provides the issuer URL (base URL of the Authelia
  // instance), plus a client id/secret they generated there.
  if (env.AUTHELIA_CLIENT_ID && env.AUTHELIA_CLIENT_SECRET && env.AUTHELIA_ISSUER) {
    const issuer = env.AUTHELIA_ISSUER.replace(/\/+$/, '');
    providers.authelia = {
      id: 'authelia',
      name: env.AUTHELIA_NAME || 'Authelia',
      issuer,
      clientId: env.AUTHELIA_CLIENT_ID,
      clientSecret: env.AUTHELIA_CLIENT_SECRET,
      discoveryUrl: `${issuer}/.well-known/openid-configuration`,
      callbackUrl: `${origin}/api/auth/oidc/authelia/callback`,
      scopes: 'openid email profile',
      authParams: {},
    };
  }

  return providers;
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

  // Generic OIDC client list. The login UI and /api/auth/me list all
  // providers from here. Add a new provider by extending parseOidcProviders().
  oidc: {
    providers: parseOidcProviders(),
  },
};
