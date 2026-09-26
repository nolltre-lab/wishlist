# Wishlist — Claude Context

A self-hosted wishlist app. Users register things they wish for (birthday, Christmas, etc.) with an
optional link to an example and an optional price, and rank them in priority order. Other users can
be granted access to view specific people's lists and reserve/buy an item — a reservation is hidden
from the list's own owner, so buying stays a surprise. Node.js/Express backend, React 18 + Vite
frontend. No database — data is plain JSON files. Structurally a close copy of `family-calendar`'s
architecture (same dual auth modes, same JSON-file persistence pattern, same deploy shape).

---

## File layout

```
backend/
  server.js          — Express app: all API routes, auth, JSON persistence
  data/              — Runtime JSON files (never modify these)
    wishlist-items.json
    users.json
    feature-requests.json
frontend/
  src/
    App.jsx              — Root component: state, data loading, tab switching
    App.css              — All styles (CSS variables + component styles)
    components/
      WishlistView.jsx        — Renders one list (own = editable/reorderable; others' = read-only + reserve)
      ItemModal.jsx            — Create/edit item form
      AdminPanel.jsx           — User profile + per-user "can view whose list" sharing control
      LocalUserPicker.jsx      — No-password household login screen
      FeatureRequestButton.jsx — Floating feedback button + admin queue (copied from family-calendar as-is)
  vite.config.js     — Builds to ../backend/public/; proxies /api → :3000 in dev
Dockerfile           — Multi-stage: builds frontend, then runs backend
.githooks/           — pre-commit (shows flagged backlog), post-commit (reminds to set commitRef)
```

---

## Data model

### WishlistItem (`wishlist-items.json`, flat array — every item carries its own `owner`)

```js
{
  id: string,             // uuid
  owner: string,           // username whose wish this is
  title: string,
  description: string,
  link: string|null,       // link to an example/product
  price: number|null,      // approximate price, SEK
  order: number,            // 0-based position within the owner's own list (drag/reorder target)
  reservedBy: string|null,  // username of whoever claimed it — NEVER sent to the owner (see below)
  reservedAt: string|null,
  createdAt: string,
  updatedAt: string,
}
```

### User (`users.json`)

```js
{ username, role: 'admin'|'user', allowedWishlistUsers: string[], displayName?, color?, syncedAt }
```

`allowedWishlistUsers` is the sharing mechanism — the *viewer's* record lists which other usernames'
lists they may open, admin-controlled via the Admin panel (mirrors `allowedCalendarIds` in
family-calendar, except the shared unit here is a person's list, not a separate calendar entity).
Admins can view every list without being listed anywhere.

---

## The core privacy invariant: reservations are hidden from the owner

The entire point of a wishlist is that the owner registers what they want without knowing who's
buying what. `sanitizeItem()` in `server.js` strips `reservedBy`/`reservedAt` from any item response
**whenever the viewer is that item's own owner** — this check is by ownership, not by role, so even
an admin viewing their own list never sees their own items' reservation state. Every route that
returns item data goes through this function. Do not add a code path that returns raw item objects
to a request where `req.user.username === item.owner`.

A non-owner can reserve an unreserved item (`PUT /api/wishlist/:id/reserve`), see who else already
reserved it (to avoid double-buying), and cancel only their own reservation (or an admin can cancel
any reservation, e.g. to fix a mistake).

---

## Backend patterns

### Adding an API route

All routes live in `backend/server.js`, same `readJSON`/`writeJSON` pattern as family-calendar:

```js
app.get('/api/my-thing', requireAuth, (req, res) => {
  const data = readJSON('my-thing.json', []);
  res.json(data);
});
```

`requireAdmin` middleware: add after `requireAuth` to restrict to admins.
`req.user` is `{ username, role }` — available in any route after `requireAuth`.

### Access control helpers

- `hasAccess(user, targetUsername)` — true if viewing own list, or admin, or `targetUsername` is in
  the viewer's `allowedWishlistUsers`.
- `getAllowedWishlistUsers(user)` — resolves the full list of usernames a user may view (all other
  users for admins).
- `sanitizeItem(item, viewerUsername)` — strips reservation fields when `item.owner === viewerUsername`.

### Auth (identical to family-calendar)

Three-tier `getUser(req)`: forwarded `X-Forwarded-User`/`X-Forwarded-Role` headers (production, behind
Caddy `forward_auth`) → signed `local_user` cookie when `LOCAL_USERS` env var is set (household,
no-password login via `LocalUserPicker`) → dev fallback (`LOCAL_USER`/`LOCAL_ROLE` env vars, defaults
to `dev`/`admin`) when not in production and `LOCAL_USERS` is unset. New users are synced into
`users.json` on first sight (`syncUser`), starting with an empty `allowedWishlistUsers`.

---

## Frontend patterns

### Tabs

`App.jsx` keeps `activeTab` as either `'mine'` or another user's username. The tab bar renders "Min
lista" plus one pill per entry in `GET /api/wishlist/accessible-users` (the caller's own
`allowedWishlistUsers`, resolved to `{username, displayName, color}`; all other users if admin).
Switching tabs re-fetches `GET /api/wishlist/:username`.

### WishlistView modes

`mode="own"` — editable: add/edit/delete, plus ↑/↓ buttons that swap adjacent items and PUT the full
new order to `/api/wishlist/reorder`. No drag-and-drop library — plain up/down buttons, works
identically on touch and desktop, no new dependency.

`mode="view"` — read-only item details plus a reserve/unreserve control, driven entirely by whether
`item.reservedBy` matches the current viewer (see the privacy invariant above for why the owner never
receives this field at all).

### apiFetch

```js
await apiFetch('/api/path', { method: 'POST', body: JSON.stringify(data) });
// Throws on non-2xx. Returns null for 204.
```

---

## Build

```bash
# Frontend only (run from frontend/)
npm run build      # outputs to ../backend/public/

# Docker (run from repo root) — builds frontend inside Docker, then packages backend
docker build --build-arg VITE_BASE_PATH=/wishlist/ -t wishlist:latest .

# Dev mode (two terminals)
cd backend && node server.js          # port 3000
cd frontend && npm run dev            # port 5173, proxies /api → :3000
```

The Dockerfile handles `npm install` for both backend and frontend — do not run npm install manually
unless needed for local verification.

## Deploy

```bash
./deploy.sh                                    # deploys to the shared Lightsail host (default IP baked in)
./deploy.sh --host <ip> [--user] [--key]        # override target, same flags as investmentoptimizer/system-controller
```

`REMOTE_HOST` defaults to the same Lightsail IP the other apps use (`${REMOTE_HOST:-13.60.148.85}`,
overridable via env var or `--host`) — matching `investmentoptimizer/docker-build-invest.sh` and
`system-controller/deploy.sh`, neither of which require `--host` every time either.

### Data reconciliation — per-file, not one blanket policy

`deploy.sh` treats each data file differently depending on who legitimately writes it:

- **`wishlist-items.json`** — remote wins, no prompt, no merge (`reconcile_remote_authoritative`).
  Real wishlist data is created by people using the live app; the only way local data would ever
  differ is a local dev/test run, and that must never leak into production (this is the same failure
  mode as investmentoptimizer's 2026-08-29 SAMPO snapshot incident — see that app's CLAUDE.md). A
  timestamped local backup is still taken first (`data/backup/<timestamp>/`), so local is never
  silently lost, just never trusted as the source of truth by default.

  ```bash
  PREFER_LOCAL=1 ./deploy.sh   # explicit override: push local to remote instead
                                 # (e.g. you've done a manual data clean-up locally and want it live)
  ```

- **`feature-requests.json`** — bidirectional ID-keyed merge (`merge_json`), same scheme as
  investmentoptimizer/family-calendar: records on either side only are kept, records on both sides
  resolved by `updatedAt`/`createdAt` (local wins on conflict, remote wins on exact tie). Unlike
  wishlist items, admin triage (status/flagged/adminNote) is realistic to do locally as well as live in
  the app, so a plain remote-wins pull would silently drop those edits — this file needs the merge,
  wishlist-items.json does not. `PREFER_LOCAL`/`PREFER_REMOTE` are not consulted by `merge_json`.

- **`users.json`** — plain pull-only, no override at all. Written exclusively by `syncUser()` and the
  live Admin panel, so there's never a legitimate local edit to push.

Don't default new data files to one of these blindly — ask *who writes this file* first: only the live
app (→ remote-authoritative, `wishlist-items.json`'s pattern), the live app and occasionally a local
script/session (→ merge, `feature-requests.json`'s pattern), or only the server internally (→ pull-only,
`users.json`'s pattern).

### Shrink/missing-remote guard (added 2026-09-26)

`wishlist-items.json` and `users.json` — the two remote-authoritative files above — both route their
pull through `guarded_pull()` → `guard_remote_size()` before ever overwriting the local backup copy.
This exists because "remote wins by default" is dangerous on its own: a wiped Docker volume, a bad
restart, or a wrong `DATA_DIR` on the remote would otherwise silently blow away a good local backup with
an empty or corrupted file, and nobody would notice until someone asks where their wishlist went.

The guard compares record counts (not byte size — JSON pretty-printing makes byte size a worse proxy
than array length here): if the local file is empty there's nothing to protect, so first-time setup
proceeds untouched. Otherwise, if remote is missing entirely or has fewer than `local_count /
SHRINK_GUARD_FACTOR` records (factor is `2`, i.e. remote lost more than half), it stops and asks. In a
non-interactive shell (`[[ ! -t 0 ]]`) it aborts the *entire* deploy immediately via `die()` — there's no
one present to confirm the loss is expected, so refusing outright beats guessing. Interactively, it
offers **[P]** pull the smaller remote anyway, **[K]** push local up instead (treat remote as the thing
that's actually wrong), or **[A]** abort.

`feature-requests.json`'s `merge_json` doesn't go through this guard — a bidirectional merge can't lose
records the same way a remote-wins pull can, by construction.

Covered by a standalone unit test during development (fixture files at varying record counts, run
outside the real script) rather than committed as a test file — re-derive the same cases (same-size,
remote-bigger, local-empty, missing-remote, shrunk-remote, borderline-at-factor) if this logic changes;
they're cheap to write inline with a throwaway `guard_remote_size` copy and fixture JSON files in `/tmp`.

The container joins the same external `iqe-proxy-net` Docker network as the other apps but publishes no
port of its own — it's reached only through Caddy, same as family-calendar.

### Auth wiring — a second, separate deploy step in `apps-home`

Route-level auth (SSO login, `X-Forwarded-User`/`X-Forwarded-Role` header injection) is **not**
configured by this repo's `deploy.sh` — it's centrally generated by `apps-home/deploy.sh`, which
writes the shared Caddyfile for every app on the host. `wishlist:0:wishlist:3000` is already added to
that script's `DEFAULT_APPS` array, matching family-calendar's entry exactly (`ext_port=0` → path-based
only, reachable at `https://<domain>/wishlist/`, no dedicated port block). This is what makes Caddy
`forward_auth` to apps-home and copy `X-Forwarded-User`/`X-Forwarded-Role` onto every request — the
same mechanism `getUser()` in `server.js` already expects (see "Auth" above).

**This only takes effect once `apps-home/deploy.sh` itself is re-run** — that redeploy touches the
live Caddy config for every app on the host, so treat it as a separate, deliberate step, not something
to fire off as a side effect of a wishlist-only change. Until that redeploy happens, `NODE_ENV=production`
with no `X-Forwarded-User` header means `getUser()` returns `null` and every request 401s — i.e. this
app's own `deploy.sh` alone is not sufficient to make it reachable/authenticated in production.

New users need **no manual setup on either side**: the first time apps-home forwards a not-yet-seen
username to this app, `syncUser()` creates their record in *this app's own* `users.json` (role synced
from the header, `allowedWishlistUsers: []`) — exactly the same mechanism family-calendar uses, verified
by smoke test (login → `[syncUser] created user: <name> (<role>)` in the server log, then a `GET
/api/admin/users` entry appears for an admin to grant sharing). An admin then decides whose lists that
new user may see, same as granting calendar access in family-calendar.

---

## Share-to-wishlist (iOS Shortcuts, added 2026-09-26)

No in-app browser — most shopping sites block being loaded in an iframe, so it'd fail on exactly the
pages people want to save. Instead: `App.jsx` checks `?link=<url>&title=<page title>` on load (after
`user` resolves) and opens the "new item" modal pre-filled via `ItemModal`'s `initial` prop (kept
separate from the `item` prop, which still exclusively controls edit-vs-new mode/the delete button —
don't conflate the two when touching this code), then scrubs the query string with
`history.replaceState` so a refresh doesn't reopen the modal.

The other half — getting a URL into that query string with one tap — lives entirely on the phone as an
iOS Shortcut (Share Sheet action: "Get Details of Safari Web Page" → "Open URLs" with
`https://iqe.duckdns.org/wishlist/?link=[URL]&title=[Name]`), not in this repo. iOS does not support the
Web Share Target API that Android/Chrome PWAs get for free, hence the Shortcuts workaround instead of a
native share-sheet entry.

**Known gap, not fixed here:** apps-home's `GET /api/auth/verify` returns a bare 401 on an expired
session (8h `maxAge`) rather than redirecting to login, and Caddy's `forward_auth` just relays that 401
verbatim — so a Shortcut tap after the session has lapsed lands on a raw 401 page with the shared link
lost, instead of a login prompt that resumes the deep link afterward. Same limitation applies to any
deep link into any app behind this gateway, not just this feature; fixing it means changing
`apps-home`'s auth-verify/Caddy config, out of scope for a wishlist-only change.

---

## Feature requests

Copied wholesale from family-calendar (`data/feature-requests.json`, `GET/POST /api/feature-requests`,
admin-only `PATCH /api/feature-requests/:id`, `FeatureRequestButton.jsx` floating FAB — same component,
unmodified except it isn't page-specific here). Lifecycle: `open → in-progress → implemented → done`
(or `wont-fix`), `flagged` marks admin-approved work-queue items. `.githooks/pre-commit` shows the
flagged backlog and can abort a commit; `.githooks/post-commit` reminds you to set `commitRef` on any
`done` request still missing one. Install once: `cp .githooks/pre-commit .githooks/post-commit
.git/hooks/ && chmod +x .git/hooks/pre-commit .git/hooks/post-commit`.

---

## Key conventions

- **No database** — every entity is read/written via `readJSON`/`writeJSON` in `server.js`
- **Auth** — always add `requireAuth` to protected routes; `requireAdmin` for admin-only
- **IDs** — always `uuidv4()` for new records
- **Timestamps** — `new Date().toISOString()` for `createdAt`/`updatedAt`
- **Do not touch** `data/` directory contents — these are live data files
- **Language** — UI strings are in Swedish
- **No TypeScript** — plain JS throughout
- **Never let a reservation leak to its own owner** — see the privacy invariant section above before
  touching any route or component that reads `reservedBy`/`reservedAt`

## What NOT to do

- Do not add new npm dependencies without a strong reason — check if the stdlib or existing deps cover it
- Do not add comments explaining what code does — only add comments for non-obvious WHY
- Do not return raw (non-sanitized) item objects from any route reachable by the item's own owner
