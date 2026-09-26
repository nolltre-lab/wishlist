const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SESSION_SECRET = process.env.SESSION_SECRET || 'wishlist-dev-secret';

// LOCAL_USERS=Magnus:admin,Helena:user,Lovisa:user,Vilhelm:user
const LOCAL_USERS = (process.env.LOCAL_USERS || '')
  .split(',')
  .map(part => {
    const [username, role] = part.trim().split(':');
    return username ? { username: username.trim(), role: (role || 'user').trim() } : null;
  })
  .filter(Boolean);

app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

app.use((req, res, next) => {
  const user = req.headers['x-forwarded-user'] || '(no header)';
  const role = req.headers['x-forwarded-role'] || '(no header)';
  if (req.path.startsWith('/api/')) {
    console.log(`${req.method} ${req.path} | user=${user} role=${role}`);
  }
  next();
});

// ── Static frontend ───────────────────────────────────────────────────────────

const FRONTEND_DIST = path.join(__dirname, 'public');
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
}

// ── JSON file helpers ─────────────────────────────────────────────────────────

function readJSON(file, defaultValue) {
  const fullPath = path.join(DATA_DIR, file);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJSON(file, data) {
  const fullPath = path.join(DATA_DIR, file);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function getUser(req) {
  // 1. Proxy auth (production: Caddy/SSO injects these headers)
  const forwarded = req.headers['x-forwarded-user'];
  if (forwarded) {
    const role = req.headers['x-forwarded-role'] || 'user';
    syncUser(forwarded, role);
    return { username: forwarded, role };
  }

  // 2. Local user mode (LOCAL_USERS env var set)
  if (LOCAL_USERS.length > 0) {
    const raw = req.signedCookies?.local_user;
    if (!raw) return null;
    try {
      const { username, role } = JSON.parse(raw);
      const valid = LOCAL_USERS.find(u => u.username === username && u.role === role);
      if (!valid) return null;
      syncUser(username, role);
      return { username, role };
    } catch {
      return null;
    }
  }

  // 3. Dev fallback (no LOCAL_USERS, not production)
  if (process.env.NODE_ENV !== 'production') {
    const devUser = process.env.LOCAL_USER || 'dev';
    const devRole = process.env.LOCAL_ROLE || 'admin';
    return { username: devUser, role: devRole };
  }

  return null;
}

function requireAuth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  next();
}

// ── User sync ─────────────────────────────────────────────────────────────────

function syncUser(username, role) {
  try {
    const users = readJSON('users.json', []);
    if (!users.find(u => u.username === username)) {
      users.push({ username, role, allowedWishlistUsers: [], syncedAt: new Date().toISOString() });
      writeJSON('users.json', users);
      console.log(`[syncUser] created user: ${username} (${role})`);
    }
  } catch (err) {
    console.error(`[syncUser] failed for ${username}:`, err.message);
  }
}

// ── Access control ────────────────────────────────────────────────────────────

function getUserRecord(username) {
  return readJSON('users.json', []).find(u => u.username === username) || null;
}

// Usernames whose wishlist `user` is allowed to view (excludes their own — that's the "mine" tab).
function getAllowedWishlistUsers(user) {
  const allUsernames = readJSON('users.json', []).map(u => u.username).filter(u => u !== user.username);
  if (user.role === 'admin') return allUsernames;
  const record = getUserRecord(user.username);
  const allowed = record?.allowedWishlistUsers || [];
  return allUsernames.filter(u => allowed.includes(u));
}

function hasAccess(user, targetUsername) {
  if (user.username === targetUsername) return true;
  if (user.role === 'admin') return true;
  return getAllowedWishlistUsers(user).includes(targetUsername);
}

// Strips reservation fields when the viewer is the item's own owner — the whole
// point of reservations is to stay hidden from the person who'd be surprised by them.
function sanitizeItem(item, viewerUsername) {
  if (item.owner === viewerUsername) {
    const { reservedBy, reservedAt, ...rest } = item;
    return rest;
  }
  return item;
}

// ── Local user auth endpoints ─────────────────────────────────────────────────

app.get('/api/local-users', (req, res) => {
  res.json(LOCAL_USERS.map(u => ({ username: u.username, role: u.role })));
});

app.post('/api/local-login', (req, res) => {
  if (LOCAL_USERS.length === 0) {
    return res.status(404).json({ error: 'Local user mode not enabled' });
  }
  const { username } = req.body;
  const match = LOCAL_USERS.find(u => u.username === username);
  if (!match) return res.status(400).json({ error: 'Unknown user' });

  const cookieVal = JSON.stringify({ username: match.username, role: match.role });
  res.cookie('local_user', cookieVal, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
  syncUser(match.username, match.role);
  res.json({ username: match.username, role: match.role });
});

app.post('/api/local-logout', (req, res) => {
  res.clearCookie('local_user');
  res.status(204).end();
});

app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

// ── Members (derived from users) ──────────────────────────────────────────────

app.get('/api/members', requireAuth, (req, res) => {
  const users = readJSON('users.json', []);
  res.json(users.map(u => ({
    username: u.username,
    displayName: u.displayName || u.username,
    color: u.color || '#94a3b8',
    role: u.role || 'user',
    allowedWishlistUsers: u.allowedWishlistUsers || [],
  })));
});

// Users whose wishlist the caller may open, for the tab bar.
app.get('/api/wishlist/accessible-users', requireAuth, (req, res) => {
  const allowedUsernames = getAllowedWishlistUsers(req.user);
  const users = readJSON('users.json', []);
  const result = allowedUsernames.map(username => {
    const u = users.find(x => x.username === username);
    return { username, displayName: u?.displayName || username, color: u?.color || '#94a3b8' };
  });
  res.json(result);
});

// ── Wishlist items ────────────────────────────────────────────────────────────

app.get('/api/wishlist/:username', requireAuth, (req, res) => {
  const { username } = req.params;
  if (!hasAccess(req.user, username)) return res.status(403).json({ error: 'Forbidden' });
  const items = readJSON('wishlist-items.json', [])
    .filter(i => i.owner === username)
    .sort((a, b) => a.order - b.order)
    .map(i => sanitizeItem(i, req.user.username));
  res.json(items);
});

app.post('/api/wishlist', requireAuth, (req, res) => {
  const { title, description, link, price } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  const items = readJSON('wishlist-items.json', []);
  const mine = items.filter(i => i.owner === req.user.username);
  const item = {
    id: uuidv4(),
    owner: req.user.username,
    title: title.trim(),
    description: description?.trim() || '',
    link: link?.trim() || null,
    price: price === '' || price === undefined || price === null ? null : Number(price),
    order: mine.length,
    reservedBy: null,
    reservedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  writeJSON('wishlist-items.json', items);
  res.status(201).json(sanitizeItem(item, req.user.username));
});

// Literal routes ('/reorder', '/:id/reserve') must be registered before the
// generic '/api/wishlist/:id' below — otherwise Express matches ':id' first
// (e.g. id="reorder") and this handler 404s before the real one is ever reached.

app.put('/api/wishlist/reorder', requireAuth, (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds required' });
  const items = readJSON('wishlist-items.json', []);
  const mineIds = new Set(items.filter(i => i.owner === req.user.username).map(i => i.id));
  if (orderedIds.length !== mineIds.size || !orderedIds.every(id => mineIds.has(id))) {
    return res.status(400).json({ error: 'orderedIds must match your own item ids exactly' });
  }
  orderedIds.forEach((id, pos) => {
    const item = items.find(i => i.id === id);
    item.order = pos;
    item.updatedAt = new Date().toISOString();
  });
  writeJSON('wishlist-items.json', items);
  res.json(
    items.filter(i => i.owner === req.user.username)
      .sort((a, b) => a.order - b.order)
      .map(i => sanitizeItem(i, req.user.username))
  );
});

app.put('/api/wishlist/:id/reserve', requireAuth, (req, res) => {
  const items = readJSON('wishlist-items.json', []);
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = items[idx];
  if (item.owner === req.user.username) return res.status(403).json({ error: 'Cannot reserve your own item' });
  if (!hasAccess(req.user, item.owner)) return res.status(403).json({ error: 'Forbidden' });

  const { reserved } = req.body;
  if (reserved) {
    if (item.reservedBy && item.reservedBy !== req.user.username) {
      return res.status(409).json({ error: 'Already reserved by someone else' });
    }
    item.reservedBy = req.user.username;
    item.reservedAt = new Date().toISOString();
  } else {
    if (item.reservedBy && item.reservedBy !== req.user.username && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the person who reserved this (or an admin) can cancel it' });
    }
    item.reservedBy = null;
    item.reservedAt = null;
  }
  items[idx] = item;
  writeJSON('wishlist-items.json', items);
  res.json(sanitizeItem(item, req.user.username));
});

app.put('/api/wishlist/:id', requireAuth, (req, res) => {
  const items = readJSON('wishlist-items.json', []);
  const idx = items.findIndex(i => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (items[idx].owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
  const { title, description, link, price } = req.body;
  if (title !== undefined) items[idx].title = title.trim();
  if (description !== undefined) items[idx].description = description.trim();
  if (link !== undefined) items[idx].link = link?.trim() || null;
  if (price !== undefined) items[idx].price = price === '' || price === null ? null : Number(price);
  items[idx].updatedAt = new Date().toISOString();
  writeJSON('wishlist-items.json', items);
  res.json(sanitizeItem(items[idx], req.user.username));
});

app.delete('/api/wishlist/:id', requireAuth, (req, res) => {
  const items = readJSON('wishlist-items.json', []);
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.owner !== req.user.username) return res.status(403).json({ error: 'Forbidden' });
  const remaining = items.filter(i => i.id !== req.params.id);
  // Re-sequence the owner's remaining items so order stays a clean 0..n-1 run.
  const mine = remaining.filter(i => i.owner === req.user.username).sort((a, b) => a.order - b.order);
  mine.forEach((i, pos) => { i.order = pos; });
  writeJSON('wishlist-items.json', remaining);
  res.status(204).end();
});

// ── Admin: users ──────────────────────────────────────────────────────────────

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json(readJSON('users.json', []));
});

app.put('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  const users = readJSON('users.json', []);
  const idx = users.findIndex(u => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  if (Array.isArray(req.body.allowedWishlistUsers)) users[idx].allowedWishlistUsers = req.body.allowedWishlistUsers;
  if (req.body.displayName !== undefined) users[idx].displayName = req.body.displayName.trim();
  if (req.body.color !== undefined) users[idx].color = req.body.color;
  writeJSON('users.json', users);
  res.json(users[idx]);
});

app.delete('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  const users = readJSON('users.json', []);
  writeJSON('users.json', users.filter(u => u.username !== req.params.username));
  res.status(204).end();
});

// ── Feature requests ──────────────────────────────────────────────────────────

app.get('/api/feature-requests', requireAuth, (req, res) => {
  const all = readJSON('feature-requests.json', []);
  if (req.user.role === 'admin') return res.json(all);
  res.json(all.filter(r => r.user === req.user.username));
});

app.post('/api/feature-requests', requireAuth, (req, res) => {
  const { text, page, url } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const all = readJSON('feature-requests.json', []);
  const fr = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    user: req.user.username,
    text: text.trim(),
    page: page || null,
    url: url || null,
    status: 'open',
    flagged: false,
    commitRef: null,
    resolvedAt: null,
    adminNote: null,
  };
  all.push(fr);
  writeJSON('feature-requests.json', all);
  res.status(201).json(fr);
});

app.patch('/api/feature-requests/:id', requireAuth, requireAdmin, (req, res) => {
  const all = readJSON('feature-requests.json', []);
  const idx = all.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const allowed = ['status', 'flagged', 'adminNote', 'commitRef', 'resolvedAt'];
  allowed.forEach(k => { if (req.body[k] !== undefined) all[idx][k] = req.body[k]; });
  all[idx].updatedAt = new Date().toISOString();
  writeJSON('feature-requests.json', all);
  res.json(all[idx]);
});

// ── SPA fallback ──────────────────────────────────────────────────────────────

if (fs.existsSync(FRONTEND_DIST)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });
}

app.listen(PORT, () => console.log(`wishlist on :${PORT}`));
