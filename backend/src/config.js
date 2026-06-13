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
  jwtTtlSeconds: Number(env.JWT_TTL || 60 * 60 * 24 * 7), // 7 days
  publicOrigin: env.PUBLIC_ORIGIN || 'http://localhost:8080',

  admin: {
    username: env.ADMIN_USERNAME || 'admin',
    email: env.ADMIN_EMAIL || 'admin@jnote.local',
    password: env.ADMIN_PASSWORD || '',
  },

  google: {
    enabled: bool(env.GOOGLE_CLIENT_ID) && bool(env.GOOGLE_CLIENT_SECRET),
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: env.GOOGLE_CALLBACK_URL || 'http://localhost:8080/api/auth/google/callback',
  },
};
