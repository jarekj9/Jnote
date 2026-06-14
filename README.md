# Jnote

Markdown notes app. Vanilla JS SPA + Node/Express API + SQLite, packaged as two containers.

## Run

```
cp .env.example .env       # set JWT_SECRET
docker compose up -d --build
open http://localhost:8080
```

The first admin password is printed in the backend container logs on first start:

```
docker compose logs jnote_backend | grep password
```

Override with `ADMIN_PASSWORD` in `.env`. All other settings live in `.env` too — see `.env.example` for the full list.

## Services

- `jnote_backend` — Node 20 API, port 3000 (internal). SQLite state in the `jnote_data` volume.
- `jnote_frontend` — nginx, port 80, mapped to `HOST_PORT` (default 8080). Proxies `/api/` to the backend.

## More

- Product spec: [app_specification.md](app_specification.md)
- For AI agents: [AGENTS.md](AGENTS.md)
