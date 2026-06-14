import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { authRoutes, bootstrapAdmin } from './auth.js';
import { noteRoutes } from './routes/notes.js';
import { userRoutes } from './routes/users.js';
import { searchRoutes } from './routes/search.js';
import { ioRoutes } from './routes/io.js';

bootstrapAdmin();

const app = express();
app.set('trust proxy', config.trustProxyHops);  // so rate-limit sees real client IP behind nginx
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// CORS: only set the ACAO header for an allowlisted origin (env PUBLIC_ORIGIN).
// The frontend is normally served by the same nginx origin, so CORS is a no-op;
// this exists only for split-origin dev setups. We never reflect arbitrary
// origins or send Access-Control-Allow-Credentials together with it.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin === config.publicOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

authRoutes(app);
noteRoutes(app);
userRoutes(app);
searchRoutes(app);
ioRoutes(app);

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('[jnote] error:', err);
  res.status(500).json({ error: 'server error' });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[jnote] api listening on :${config.port}`);
});
