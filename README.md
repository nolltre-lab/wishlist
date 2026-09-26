# Wishlist

A self-hosted wishlist app built with Node.js/Express and React. No database required — data is stored in plain JSON files. Designed for gift-giving among family or friends: everyone keeps their own list, an admin decides who can see whose list, and reservations stay hidden from the list's own owner so buying stays a surprise.

## Features

- **Personal wishlists** — title, optional description, optional link to an example/product, optional approximate price
- **Priority ordering** — reorder your own list with simple ↑/↓ controls (no drag-and-drop dependency)
- **Admin-controlled sharing** — an admin grants each user access to specific other people's lists; nobody sees a list they haven't been granted
- **Surprise-safe reservations** — anyone with access to a list can reserve an item so others don't buy the same gift; the reservation (and who made it) is never shown to the list's own owner, even if that owner is an admin
- **Feature request system** — floating button lets users submit ideas; admin review queue included
- **Git hooks** — pre-commit shows the flagged feature-request backlog; post-commit reminds you to stamp a `commitRef`

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express |
| Frontend | React 18, Vite |
| Persistence | JSON files (no database) |
| Containerisation | Docker (multi-stage build) |
| Auth | `X-Forwarded-User` header (proxy) or local-user mode (see below) |

## Quick start — local development

```bash
# 1. Install backend dependencies
cd backend && npm install && cd ..

# 2. Install and build frontend
cd frontend && npm install && npm run build && cd ..

# 3. Run
cd backend && node server.js
```

Open [http://localhost:3000](http://localhost:3000). Without any auth headers the server falls back to a single `dev` admin user — enough to explore all features immediately.

To run the frontend in hot-reload dev mode alongside the backend:

```bash
# Terminal 1 — backend
cd backend && node server.js

# Terminal 2 — frontend dev server (proxies /api to :3000)
cd frontend && npm run dev
```

The Vite dev server starts on port 5173 by default.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `backend/data` | Directory for JSON data files |
| `NODE_ENV` | — | Set to `production` to disable the dev-user fallback |

## Data files

All data lives in `DATA_DIR` (default: `backend/data/`). The server creates missing files automatically on first write.

| File | Contents |
|---|---|
| `wishlist-items.json` | Every wishlist item, flat array, each carrying its own `owner` |
| `users.json` | User profiles synced from the auth layer, plus each user's sharing grants |
| `feature-requests.json` | Feature requests submitted in-app |

Back up `DATA_DIR` to preserve your data. No migrations required — the schema is append-only JSON.

## Docker

Build and run with Docker:

```bash
docker build -t wishlist .
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e NODE_ENV=production \
  wishlist
```

Or with Docker Compose:

```yaml
services:
  wishlist:
    image: wishlist:latest
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
```

## Authentication

The app is designed to sit behind a reverse proxy that injects user identity via headers.

| Header | Example | Description |
|---|---|---|
| `X-Forwarded-User` | `magnus` | Username (required for auth) |
| `X-Forwarded-Role` | `admin` | Role — `admin` or `user` (default: `user`) |

When `NODE_ENV` is not `production` and no `X-Forwarded-User` header is present, the server falls back to `{ username: 'dev', role: 'admin' }`. This makes local development frictionless.

New users need no manual setup: the first time a username is seen (via the forwarded header, or a local login), it's created automatically in `users.json` with no sharing grants — an admin then decides whose lists that person may view.

### Multi-user SSO

If you run multiple apps, you can front them all with a shared SSO gateway that handles login once and injects `X-Forwarded-User` + `X-Forwarded-Role` into every sub-app. This is how the app is deployed in production.

## Running without a proxy

The app ships with a built-in user-picker mode for running locally — no reverse proxy, no passwords, no extra setup.

### User picker mode

Set `LOCAL_USERS` to a comma-separated list of `name:role` pairs and the app shows a "who are you?" screen on first visit. Tapping a name logs you in for a year (signed cookie). Tapping your name in the header switches back to the picker.

```bash
LOCAL_USERS=Magnus:admin,Helena:user,Lovisa:user node server.js
```

Or with Docker:

```bash
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e NODE_ENV=production \
  -e LOCAL_USERS="Magnus:admin,Helena:user,Lovisa:user" \
  -e SESSION_SECRET="change-me-to-something-random" \
  wishlist
```

The first user listed with role `admin` can grant sharing access between users from the Admin panel inside the app.

No passwords required — suitable for a household or friend group where trust is implicit and the app runs on a home network or a private server that isn't exposed to the internet.

### Single fixed user (simplest)

If only one person manages things locally, use `LOCAL_USER` instead:

```bash
LOCAL_USER=Magnus LOCAL_ROLE=admin node server.js
```

This skips the picker entirely and always logs in as that user.

### Changing the session secret

`SESSION_SECRET` signs the login cookie. The default is a fixed dev string — fine for local use, but set it to something random for any shared or internet-facing deployment:

```bash
SESSION_SECRET=$(openssl rand -hex 32)
```

## How reservations stay hidden from the owner

This is the core privacy guarantee of the app: a reservation (`reservedBy`/`reservedAt` on a wishlist item) is stripped out of every API response whenever the viewer is that item's own owner — checked by identity, not by role, so even an admin viewing their own list never sees it. One function in `server.js` (`sanitizeItem`) enforces this for every route that returns item data. If you extend the API, route any new item-returning endpoint through it.

## Deploy

`deploy.sh` builds the Docker image, reconciles data files against a remote host over SSH, and restarts the container there. Data reconciliation defaults to **remote-wins**: real wishlist items and feature requests are created by people using the live app, so a local dev/test run's data file is never allowed to silently overwrite production — local is always backed up first. Pass `PREFER_LOCAL=1` to push local data instead, for a deliberate cleanup.

```bash
./deploy.sh --host <ip> [--user <ssh-user>] [--key <path-to-pem>]
```

## Customisation

### Language

The UI is in Swedish. To change the locale, update the UI strings in `App.jsx` and the components under `frontend/src/components/`.

## Contributing

Pull requests welcome. For larger changes, open an issue first to discuss the approach.

## License

MIT
