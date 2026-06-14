# AGENTS.md

Repo rules and architecture for AI agents working on this codebase. Humans: see [README.md](README.md). Product spec: [app_specification.md](app_specification.md).

> **Do not deploy, start, or run docker/app commands.** Leave all runtime operations to the human. You may read and edit files and run static checks only.

## Stack

- Frontend: vanilla JS, ES modules. No framework, no bundler, no package manager. Vendored libs in `frontend/vendor/`.
- Backend: Node 20, Express 4, better-sqlite3 (FTS5), bcryptjs, JWT in httpOnly cookie, `adm-zip`, `multer`, `express-rate-limit`.
- Deployment: two containers via `docker compose` (**v2**, not `docker-compose` v1).

## Layout

```
backend/src/
  server.js, config.js, db.js, auth.js, validation.js
  storage/{connector.js, sqliteConnector.js, index.js}
  routes/{notes,users,search,io}.js
frontend/
  index.html, css/style.css
  js/{app,state,api,auth,theme,topbar,search,sidebar,editor,admin,markdown,toast,tokens}.js
  vendor/{marked,dompurify}.min.js
docker-compose.yml · .env.example
```

Persistence details: `StorageConnector` in `backend/src/storage/connector.js` is the single persistence interface — all DB calls go through it. Swap backends in `storage/index.js`.

## Rules

- All persistence via `StorageConnector`. To add a backend, implement that interface and switch on `STORAGE` in `src/storage/index.js`.
- No SQL string interpolation. Use `db.prepare(...).all/run/get()` with placeholders.
- Any HTML written via `innerHTML` goes through `DOMPurify.sanitize`. Use `js/markdown.js` `sanitizeHtml`. FTS5 snippets in `js/sidebar.js` sanitize with `ALLOWED_TAGS: ['mark']` only.
- Validate every user-supplied string via `src/validation.js` (control chars, lengths, paths, IDs). Reject early in the route handler.
- No frontend framework, bundler, or package manager. Vanilla on purpose.
- Never log secrets (passwords, JWT secret, OAuth client secret).

## Constraints — don't break these

- `docker compose` v2. Service/container/hostname names: `jnote_frontend`, `jnote_backend`.
- All settings live in the root `.env` (loaded via `env_file: .env`); `PORT` and `DB_PATH` are the only container-specific overrides in the compose `environment:` block.
- `bootstrapAdmin()` is one-time — only creates the admin if missing; it does **not** reset the password on subsequent boots.
- `JWT_SECRET` has a dev fallback if unset. **Do not add a startup validator** — the human removed it intentionally.
- Register/login use uniform responses + dummy bcrypt for timing. Don't reintroduce per-failure leaks (e.g. `"username taken"`, `"account not active"`) — all collapse to `401 {error: "invalid credentials"}`.
- Google OAuth does **not** link by email — always creates a brand-new pending user with a derived username; admin must approve. This closes the email-takeover path.
- `requireAuth` is dual-mode: cookie JWT for the browser, `Authorization: Bearer jnote_pat_…` for programmatic clients. An invalid Bearer header fails closed (no fall-through to the cookie). See `src/auth.js`.
- FTS5 queries go through `sanitizeFtsQuery` in `sqliteConnector.js`. Don't bypass.
- Import (.zip) validates every entry path (no absolute, no `..`, no control chars, length cap). Skipped entries are reported as `skipped` in the response.
- Event handler gotcha: `e.currentTarget` becomes `null` after the first `await`. Capture it: `const form = e.currentTarget` *before* any `await`.
- `js/state.js`'s `emit` is debounced via `setTimeout(0)`. The sidebar's `renderSidebar()` must be called **directly** from event handlers (search, tag click) — don't rely on the change event to deliver the latest state.

## Common tasks

- **Add a storage backend** → new `src/storage/<name>Connector.js` implementing `StorageConnector`; switch on `STORAGE` in `src/storage/index.js`.
- **Add an OAuth provider** → mirror the Google block in `src/auth.js`. Use the state-cookie CSRF pattern.
- **Upgrade a vendored lib** → replace `frontend/vendor/<lib>.min.js`; bump the `<script>` tag in `index.html` if the global name changed.
- **Add an admin user action** → route in `src/routes/users.js`, button in `js/admin.js` `buildActions()` grouped with the matching existing buttons (role-management vs. destructive).
- **Add a new env var** → add it to `.env.example` (with sane default + comment), read it in `backend/src/config.js`, and the container picks it up via `env_file: .env` automatically.

## Maintaining this file

When you change something that's worth keeping in this file (new constraint, new gotcha, changed stack entry, new common task, etc.), update it in the same change. Keep it **concise** — short bullets, link to source instead of explaining, drop stale items. Don't let it grow into a re-narration of the codebase.
