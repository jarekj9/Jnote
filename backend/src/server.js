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
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

// Permissive CORS only for /api in case the frontend is served from a
// different origin during development. The cookie still needs
// sameSite=lax; in production everything is on the same nginx origin.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
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
  res.status(500).json({ error: err.message || 'server error' });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[jnote] api listening on :${config.port}`);
});
