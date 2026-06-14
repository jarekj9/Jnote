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

## API (curl)

Authenticate with a personal access token (mint one from the user menu → **API tokens** in the web UI):

```bash
TOKEN="jnote_pat_..."   # from the API tokens panel
HOST="http://localhost:8080"

# list notes
curl -s "$HOST/api/notes" -H "Authorization: Bearer $TOKEN"

# read one note
curl -s "$HOST/api/notes/42" -H "Authorization: Bearer $TOKEN"

# update (rename a note)
curl -s -X PATCH "$HOST/api/notes/42" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"New title"}'

# delete
curl -s -X DELETE "$HOST/api/notes/42" -H "Authorization: Bearer $TOKEN"

# search
curl -s "$HOST/api/search?q=hello" -H "Authorization: Bearer $TOKEN"
```

Every other route (`/api/folders`, `/api/tags`, `/api/export/all`, `/api/import`, …) accepts the same `Authorization: Bearer …` header.

## More

- Product spec: [app_specification.md](app_specification.md)
- For AI agents: [AGENTS.md](AGENTS.md)
