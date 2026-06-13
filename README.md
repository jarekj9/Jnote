# Jnote

Markdown notes app. Vanilla JS SPA + Node/Express API + SQLite. Runs in two containers.

## Run

```
cp .env.example .env       # set JWT_SECRET
docker compose up -d --build
open http://localhost:8080
```

Admin credentials are printed in the backend container logs the first time it starts:

```
docker compose logs jnote_backend | grep password
```

Override with `ADMIN_PASSWORD` in `.env`.

## Layout

```
backend/   Node/Express API, SQLite, auth
frontend/  Static SPA, nginx serves it and proxies /api → backend
docker-compose.yml
```

Two services, both with `restart: unless-stopped`:

- `jnote_backend` — Node 20, port 3000 (internal). State: `jnote_data` volume at `/data/jnote.sqlite`.
- `jnote_frontend` — nginx, port 80, mapped to `HOST_PORT` (default 8080). Proxies `/api/` to `jnote_backend:3000`.

## Architecture (for AI editing)

### Backend
- `src/server.js` — Express bootstrap, mounts route groups.
- `src/config.js` — env reader, single source of truth for env vars.
- `src/db.js` — better-sqlite3 init + schema. FTS5 is enabled on `notes(title, content)`.
- `src/auth.js` — bcryptjs + JWT in httpOnly cookie. `bootstrapAdmin()` runs on boot. Google OAuth is conditional on `GOOGLE_CLIENT_ID/SECRET`.
- `src/storage/connector.js` — abstract `StorageConnector` class. **All persistence flows through this interface.**
- `src/storage/sqliteConnector.js` — SQLite implementation.
- `src/storage/index.js` — `getStorage()` factory. Add a new backend by importing another connector and switching on env (e.g. `STORAGE=postgres`).
- `src/routes/notes.js` — folders, notes, tags.
- `src/routes/users.js` — admin user management.
- `src/routes/search.js` — full-text + tag search.
- `src/routes/io.js` — export (single .md / full .zip) and import (.md / .zip) with `multer` and `adm-zip`.

### Frontend
- `index.html` — single page shell, links vendored `marked` and `dompurify`.
- `css/style.css` — topbar / sidebar / editor layout, light+dark, responsive.
- `js/app.js` — entry, picks auth screen vs. main app.
- `js/state.js` — single state object + tiny pub/sub.
- `js/api.js` — fetch wrapper, same-origin cookie auth.
- `js/auth.js`, `js/theme.js`, `js/topbar.js`, `js/search.js`, `js/sidebar.js`, `js/editor.js`, `js/admin.js` — one module per UI area.

### User model
- All new accounts (`/api/auth/register` or Google) start as `status='pending'` and cannot log in.
- An active admin must approve them via the admin panel (top-right user menu → "Admin panel").
- Admin can promote/demote any user, set passwords, disable accounts. Last active admin cannot demote/disable themselves.

### Adding a storage backend
1. Create `src/storage/<name>Connector.js` extending `StorageConnector`.
2. Implement every method listed in `connector.js`.
3. Switch on `process.env.STORAGE` in `storage/index.js`.
4. The rest of the backend (routes, auth) does not change.

### Adding OAuth providers
Mirror the Google block in `auth.js`. The state-cookie pattern already prevents CSRF.

### Vendored libraries
- `frontend/vendor/marked.min.js` — markdown parser.
- `frontend/vendor/dompurify.min.js` — sanitizer for rendered HTML.

To upgrade: download new min builds into `frontend/vendor/` and bump the `<script>` tags in `index.html` if the global name changes.

## Notes
- First admin password is logged once. Save it. Reset by deleting the volume (`docker compose down -v`) or manually updating the DB.
- Search is FTS5-backed; snippets include `<mark>` tags. FTS triggers keep the index in sync.
- Exports use YAML frontmatter (`title: …`) so re-import preserves titles.
- Tags are case-insensitive; `#` prefix and spaces are stripped on input.
