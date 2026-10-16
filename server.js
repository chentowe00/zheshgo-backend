/* ============================================================
   ZheshGo — minimal admin backend (zero-dependency Node.js)
   ------------------------------------------------------------
   - Serves the existing static visitor site (web root + /app/)
   - Dynamically compiles data/content.json -> /js/data/content.js
     (visitor pages keep loading the same path; no frontend change)
   - /admin/ protected management UI + /api/v1/admin/* JSON API
   - Server-side sessions (HttpOnly cookie) + scrypt password
     hashing + RBAC: owner > admin > editor
   - First owner via single-use bootstrap token (auto-generated,
     stored server-side only; never a default password)
   - All secrets: server filesystem (data/) or env vars. Never in
     the repository, never in the browser bundle.

   Run:  node server.js   (listens on process.env.PORT or 8080)
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const ADMIN_DIR = path.join(ROOT, "admin");
const SESSION_COOKIE = "zshg_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const BOOTSTRAP_TTL_MS = 24 * 3600 * 1000;
const MAX_BODY = 1 * 1024 * 1024; // 1 MB

const ROLES = { owner: 3, admin: 2, editor: 1 };
const ENTITY_TYPES = ["city", "route", "place", "faq", "photoGuide"];
const ENTITY_PLURAL = { city: "cities", route: "routes", place: "places", faq: "faqs", photoGuide: "photoGuides" };

/* ---------------- data store ---------------- */
function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch (e) {
    return typeof fallback === "function" ? fallback() : fallback;
  }
}
function writeJson(file, obj) {
  const target = path.join(DATA_DIR, file);
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, target);
}
function dataFiles() {
  return fs.readdirSync(DATA_DIR).filter((f) => /\.json$/.test(f));
}

/* ---------------- audit log ---------------- */
function audit(action, actor, detail) {
  const log = readJson("audit.json", []);
  log.push({ ts: Date.now(), actor: actor || null, action, detail: detail || null });
  if (log.length > 2000) log.splice(0, log.length - 2000);
  writeJson("audit.json", log);
}

/* ---------------- secrets & bootstrap ---------------- */
function getSessionSecret() {
  if (process.env.ZSHG_SESSION_SECRET) return process.env.ZSHG_SESSION_SECRET;
  const f = path.join(DATA_DIR, "secret.key");
  try {
    const s = fs.readFileSync(f, "utf8").trim();
    if (s) return s;
  } catch (e) { /* not created yet */ }
  const s = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(":");
    const calc = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), calc);
  } catch (e) {
    return false;
  }
}

function ownerExists() {
  const users = readJson("users.json", []);
  return users.some((u) => u.role === "owner" && !u.disabled);
}
function getBootstrapToken() {
  const b = readJson("bootstrap.json", null);
  if (!b) return null;
  if (Date.now() - b.createdAt > BOOTSTRAP_TTL_MS) {
    try { fs.unlinkSync(path.join(DATA_DIR, "bootstrap.json")); } catch (e) {}
    return null;
  }
  return b.token;
}
function ensureBootstrap() {
  if (ownerExists()) return;
  if (getBootstrapToken()) return;
  const token = process.env.ZSHG_BOOTSTRAP_TOKEN || crypto.randomBytes(24).toString("hex");
  writeJson("bootstrap.json", { token, createdAt: Date.now() });
  if (!process.env.ZSHG_BOOTSTRAP_TOKEN) {
    try {
      fs.writeFileSync(path.join(DATA_DIR, "bootstrap-token.txt"),
        "ZheshGo admin bootstrap token (single use, expires in 24h):\n" + token + "\n", { mode: 0o600 });
    } catch (e) {}
    // eslint-disable-next-line no-console
    console.log("\n=== ZheshGo admin setup ===");
    // eslint-disable-next-line no-console
    console.log("No owner account yet. Bootstrap token (also in data/bootstrap-token.txt):");
    // eslint-disable-next-line no-console
    console.log("  " + token);
    // eslint-disable-next-line no-console
    console.log("Open /admin/ and use 'Initialize owner account' with this token.\n");
  }
}

/* ---------------- sessions & auth ---------------- */
function loadSessions() {
  let s = readJson("sessions.json", {});
  if (!s || Array.isArray(s) || typeof s !== "object") s = {}; // corrupt/legacy shape -> reset
  // prune
  let changed = false;
  Object.keys(s).forEach((t) => {
    if (Date.now() - s[t].createdAt > SESSION_TTL_MS) { delete s[t]; changed = true; }
  });
  if (changed) writeJson("sessions.json", s);
  return s;
}
function createSession(userId) {
  const sessions = loadSessions();
  const token = crypto.randomBytes(32).toString("hex");
  sessions[token] = { userId, createdAt: Date.now() };
  writeJson("sessions.json", sessions);
  return token;
}
function destroySession(token) {
  const sessions = loadSessions();
  delete sessions[token];
  writeJson("sessions.json", sessions);
}
function getUserById(id) {
  return readJson("users.json", []).find((u) => u.id === id && !u.disabled) || null;
}
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || "";
  raw.split(";").forEach((pair) => {
    const i = pair.indexOf("=");
    if (i > -1) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}
function isHttps(req) {
  return req.headers["x-forwarded-proto"] === "https" || (req.socket && req.socket.encrypted);
}
function sessionCookieHeader(token, req, maxAge) {
  const parts = [
    SESSION_COOKIE + "=" + token,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isHttps(req)) parts.push("Secure");
  if (maxAge) parts.push("Max-Age=" + maxAge);
  return parts.join("; ");
}
function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const sessions = loadSessions();
  const s = sessions[token];
  if (!s) return null;
  return getUserById(s.userId);
}

/* ---------------- rate limiting (in-memory) ---------------- */
const rateBuckets = {};
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = rateBuckets[key] || { count: 0, reset: now + windowMs };
  if (now > b.reset) { b.count = 0; b.reset = now + windowMs; }
  b.count++;
  rateBuckets[key] = b;
  return b.count <= max;
}
function ip(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
}

/* ---------------- CORS (cross-origin assistant only) ----------------
   The static visitor site (WorkBuddy host) calls the assistant endpoints
   cross-origin. Allow ONLY those origins — never "*". Allowed origins come
   from CORS_ORIGINS (comma-separated env) merged with safe defaults. */
function allowedOrigins() {
  const fromEnv = String(process.env.CORS_ORIGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const defaults = [
    "https://zheshgo-travel.app.workbuddy.host", // production site
    "http://localhost:8080",                     // local Node dev
    "http://127.0.0.1:8080",
  ];
  const seen = {};
  return fromEnv.concat(defaults).filter((o) => {
    if (seen[o]) return false;
    seen[o] = true;
    return true;
  });
}
/* Returns true if the request may proceed. Sets CORS headers for allowed
   browser origins. No Origin header (non-browser / same-origin) is allowed
   without CORS headers. A disallowed Origin returns false (caller rejects). */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (allowedOrigins().indexOf(origin) === -1) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

/* ---------------- http helpers ---------------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}
function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}
function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!raw) return cb({});
    try { cb(JSON.parse(raw)); } catch (e) { cb(null); }
  });
  req.on("error", () => cb(null));
}

/* ---------------- static file serving ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};
const DENY_PATH = ["/data/", "/.git", ".key", ".genie", ".tmp", ".env"];
function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/admin" || urlPath === "/admin/") urlPath = "/admin/index.html";

  // path traversal + sensitive file guard
  const resolved = path.normalize(path.join(ROOT, urlPath));
  if (!resolved.startsWith(ROOT) || resolved.includes(path.sep + "data" + path.sep) ||
      DENY_PATH.some((d) => resolved.includes(d))) {
    res.writeHead(404); res.end("Not found"); return;
  }
  fs.stat(resolved, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "same-origin",
      "Cache-Control": ext === ".html" || urlPath.startsWith("/admin/") ? "no-cache" : "public, max-age=3600",
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

/* ---------------- dynamic content.js generator ---------------- */
function buildContentJs() {
  const doc = readJson("content.json", null);
  const bootstrap = fs.readFileSync(path.join(ROOT, "js", "data", "content.js"), "utf8");
  if (!doc) return bootstrap;

  // filter: remove archived + unpublished entities
  const visible = {};
  ENTITY_TYPES.forEach((t) => {
    const list = Array.isArray(doc[ENTITY_PLURAL[t]]) ? doc[ENTITY_PLURAL[t]] : [];
    visible[ENTITY_PLURAL[t]] = list.filter((e) => !e.archived && e.published !== false);
  });

  const out = {
    meta: doc.meta || {},
    cities: visible.cities,
    routes: visible.routes,
    places: visible.places,
    faqs: visible.faqs,
    photoGuides: visible.photoGuides,
    themes: Array.isArray(doc.themes) ? doc.themes : [],
    assumptions: Array.isArray(doc.assumptions) ? doc.assumptions : [],
    ui: doc.ui || {},
  };

  const json = JSON.stringify(out).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return [
    "/* Generated by ZheshGo server from CMS data — do not edit manually. */",
    "(function () {",
    '  "use strict";',
    "  var ZW = (window.ZW = window.ZW || {});",
    "  var IS_APP = typeof location !== 'undefined' && location.pathname.split('/').indexOf('app') !== -1;",
    "  function asset(p) { if (!p) return p; return IS_APP ? p.replace(/^assets\\//, '../assets/') : p; }",
    "  var CONTENT = " + json + ";",
    "  var T = {};",
    "  CONTENT.themes.forEach(function (t) { T[t.id] = t.name; });",
    "  [CONTENT.cities, CONTENT.routes, CONTENT.places, CONTENT.faqs, CONTENT.photoGuides].forEach(function (list) {",
    "    list.forEach(function (e) {",
    "      if (e.status === undefined) e.status = e.verified ? 'verified' : 'needs-verification';",
    "      if (e.lastVerifiedDate === undefined) e.lastVerifiedDate = e.verified ? CONTENT.meta.lastUpdated : null;",
    "      if (e.source === undefined) e.source = e.verified ? 'Official source (link to be added)' : 'Demo seed content (unverified)';",
    "    });",
    "  });",
    "  CONTENT.cities.forEach(function (c) { c.art = asset(c.art); });",
    "  CONTENT.themes.forEach(function (t) { t.art = asset(t.art); });",
    "  CONTENT.photoGuides.forEach(function (g) { g.sampleImage = asset(g.sampleImage); });",
    "  ZW.CONTENT = CONTENT;",
    "  ZW.THEMES = T;",
    "})();",
    "",
  ].join("\n");
}

/* ---------------- validation helpers ---------------- */
function cleanString(v, max) {
  if (typeof v !== "string") return "";
  return v.slice(0, max).trim();
}
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
function newId(type, name, doc) {
  const base = slugify(name) || type;
  let id = base;
  let n = 2;
  const list = doc[ENTITY_PLURAL[type]] || [];
  while (list.some((e) => e.id === id)) { id = base + "-" + n++; }
  return id;
}

function sanitizeEntity(type, body) {
  const e = {};
  const text = (k, max) => { if (body[k] !== undefined) e[k] = cleanString(body[k], max || 4000); };
  text("name", 160);
  text("zh", 8);
  if (type === "city") {
    text("role", 120); text("tagline", 300); text("intro", 4000);
    e.gateway = !!body.gateway;
    e.preview = !!body.preview;
    if (Array.isArray(body.facts)) {
      e.facts = body.facts.slice(0, 12).map((f) => ({
        k: cleanString(f && f.k, 80), v: cleanString(f && f.v, 500),
        s: f && f.s ? cleanString(f.s, 200) : undefined,
      })).filter((f) => f.k && f.v);
    }
    if (Array.isArray(body.places)) e.places = body.places.slice(0, 30).map((x) => cleanString(x, 60)).filter(Boolean);
    if (Array.isArray(body.routes)) e.routes = body.routes.slice(0, 20).map((x) => cleanString(x, 60)).filter(Boolean);
    e.art = cleanString(body.art, 200) || "assets/img/hero-art.svg";
  } else if (type === "route") {
    text("title", 200);
    e.city = cleanString(body.city, 60);
    e.cities = Array.isArray(body.cities) ? body.cities.slice(0, 6).map((x) => cleanString(x, 60)).filter(Boolean) : [];
    e.theme = cleanString(body.theme, 80);
    e.themes = Array.isArray(body.themes) ? body.themes.slice(0, 6).map((x) => cleanString(x, 80)).filter(Boolean) : [];
    e.days = Math.max(1, Math.min(30, parseInt(body.days, 10) || 1));
    e.pace = ["Gentle", "Relaxed", "Moderate"].indexOf(body.pace) !== -1 ? body.pace : "Moderate";
    e.groups = Array.isArray(body.groups) ? body.groups.slice(0, 5).map((x) => cleanString(x, 30)).filter(Boolean) : [];
    text("summary", 800); text("why", 2000); text("notFor", 1500);
    e.sellable = !!body.sellable; // default false; a demo route must never default to a sellable product
    if (Array.isArray(body.dayByDay)) {
      e.dayByDay = body.dayByDay.slice(0, 30).map((d) => ({
        day: Math.max(1, Math.min(30, parseInt(d && d.day, 10) || 1)),
        title: cleanString(d && d.title, 160),
        stops: Array.isArray(d && d.stops) ? d.stops.slice(0, 20).map((s) => ({
          name: cleanString(s && s.name, 160),
          placeId: cleanString(s && s.placeId, 60) || undefined,
          note: cleanString(s && s.note, 600),
        })).filter((s) => s.name) : [],
      })).filter((d) => d.title || d.stops.length);
    }
    if (Array.isArray(body.transportNotes)) e.transportNotes = body.transportNotes.slice(0, 10).map((x) => cleanString(x, 400)).filter(Boolean);
    if (Array.isArray(body.confirmBefore)) e.confirmBefore = body.confirmBefore.slice(0, 12).map((x) => cleanString(x, 300)).filter(Boolean);
    if (Array.isArray(body.highlights)) e.highlights = body.highlights.slice(0, 12).map((x) => cleanString(x, 300)).filter(Boolean);
    e.status = body.status;
  } else if (type === "place") {
    text("type", 120); text("blurb", 3000);
    e.city = cleanString(body.city, 60);
    e.theme = cleanString(body.theme, 80);
    e.practical = {
      hours: cleanString(body.hours, 300),
      ticket: cleanString(body.ticket, 300),
      transport: cleanString(body.transport, 400),
    };
    text("verifyNote", 500);
  } else if (type === "faq") {
    text("q", 300); text("a", 4000);
    e.tags = Array.isArray(body.tags) ? body.tags.slice(0, 10).map((x) => cleanString(x, 30)).filter(Boolean) : [];
  } else if (type === "photoGuide") {
    text("facility", 120); text("scenario", 200); text("verifyNote", 500);
    e.sampleImage = cleanString(body.sampleImage, 200);
    e.confidence = ["high", "mid", "low"].indexOf(body.confidence) !== -1 ? body.confidence : "mid";
    if (Array.isArray(body.steps)) {
      e.steps = body.steps.slice(0, 20).map((s) => ({
        title: cleanString(s && s.title, 200),
        detail: cleanString(s && s.detail, 1000),
        tip: cleanString(s && s.tip, 400) || undefined,
      })).filter((s) => s.title);
    }
  }
  // trust fields (schema)
  e.status = body.status || e.status || "needs-verification";
  e.verified = e.status === "verified";
  if (body.lastVerifiedDate !== undefined) e.lastVerifiedDate = /^\d{4}-\d{2}-\d{2}$/.test(body.lastVerifiedDate) ? body.lastVerifiedDate : null;
  e.source = cleanString(body.source, 300) || "Demo seed content (unverified)";
  if (body.verifyNote !== undefined && type !== "place") text("verifyNote", 500);
  return e;
}

/* ---------------- overview aggregates (anonymized) ---------------- */
function buildOverview() {
  const doc = readJson("content.json", {});
  const consults = readJson("consults.json", []);
  const submissions = readJson("submissions.json", []);
  const events = readJson("events.json", { recent: [], aggregates: {} });
  const users = readJson("users.json", []);
  const auditLog = readJson("audit.json", []);
  const by = (arr, key) => arr.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});

  const content = {};
  ENTITY_TYPES.forEach((t) => {
    const list = (doc[ENTITY_PLURAL[t]] || []).filter((e) => !e.archived);
    content[t] = {
      total: list.length,
      published: list.filter((e) => e.published !== false).length,
      drafts: list.filter((e) => e.published === false).length,
      verified: list.filter((e) => e.verified).length,
      needsVerification: list.filter((e) => !e.verified).length,
    };
  });

  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    trend.push({ date: key, events: (events.aggregates && events.aggregates[key]) || {} });
  }

  return {
    content,
    consults: { total: consults.length, byStatus: by(consults, "status") },
    submissions: { total: submissions.length, byStatus: by(submissions, "status") },
    events: { recent7d: trend },
    users: users.filter((u) => !u.disabled).length,
    auditEntries: auditLog.length,
    generatedAt: Date.now(),
  };
}

/* ---------------- admin API handlers ---------------- */
function requireAuth(req, res, minRole, cb) {
  const user = currentUser(req);
  if (!user) return sendError(res, 401, "UNAUTHENTICATED", "Please log in.");
  if (ROLES[user.role] < ROLES[minRole]) return sendError(res, 403, "FORBIDDEN", "Your role cannot perform this action.");
  cb(user);
}
function requireCsrf(req, res) {
  // state-changing admin requests must carry this custom header (SameSite=Lax cookie adds CSRF depth)
  if (req.method !== "GET" && req.headers["x-zshg-admin"] !== "1") {
    return sendError(res, 403, "CSRF", "Missing admin header.");
  }
  return null;
}

function handleAdminApi(req, res, pathParts, user) {
  const [a, b, c, d, e] = pathParts; // /api/v1/admin/<a>/<b>/<c>...
  const method = req.method;

  // ---- auth ----
  if (a === "auth") {
    if (b === "setup" && method === "POST") {
      if (ownerExists()) return sendError(res, 403, "OWNER_EXISTS", "An owner account already exists.");
      readBody(req, (body) => {
        const token = cleanString(body && body.token, 200);
        const current = getBootstrapToken();
        if (!token || !current || token !== current) return sendError(res, 403, "BAD_TOKEN", "Invalid or expired bootstrap token.");
        const name = cleanString(body.name, 80);
        const email = cleanString(body.email, 160).toLowerCase();
        const password = body && body.password ? String(body.password) : "";
        if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendError(res, 400, "BAD_INPUT", "A name and valid email are required.");
        if (password.length < 10) return sendError(res, 400, "WEAK_PASSWORD", "Password must be at least 10 characters.");
        const users = readJson("users.json", []);
        if (users.some((u) => u.email === email)) return sendError(res, 409, "EMAIL_TAKEN", "That email is already in use.");
        const user = { id: "u_" + crypto.randomBytes(8).toString("hex"), name, email, role: "owner", passwordHash: hashPassword(password), createdAt: Date.now(), disabled: false };
        users.push(user);
        writeJson("users.json", users);
        try { fs.unlinkSync(path.join(DATA_DIR, "bootstrap.json")); } catch (e) {}
        audit("auth.setup", user.id, { email });
        const tokenS = createSession(user.id);
        res.setHeader("Set-Cookie", sessionCookieHeader(tokenS, req, SESSION_TTL_MS / 1000));
        sendJson(res, 200, { ok: true, user: publicUser(user) });
      });
      return;
    }
    if (b === "login" && method === "POST") {
      if (!rateLimit("login:" + ip(req), 10, 15 * 60000)) return sendError(res, 429, "RATE_LIMITED", "Too many attempts. Try again later.");
      readBody(req, (body) => {
        const email = cleanString(body && body.email, 160).toLowerCase();
        const password = body && body.password ? String(body.password) : "";
        const user = readJson("users.json", []).find((u) => u.email === email && !u.disabled);
        if (!user || !verifyPassword(password, user.passwordHash)) {
          audit("auth.login_failed", null, { email });
          return sendError(res, 401, "BAD_CREDENTIALS", "Incorrect email or password.");
        }
        const token = createSession(user.id);
        audit("auth.login", user.id, {});
        res.setHeader("Set-Cookie", sessionCookieHeader(token, req, SESSION_TTL_MS / 1000));
        sendJson(res, 200, { ok: true, user: publicUser(user) });
      });
      return;
    }
    if (b === "logout" && method === "POST") {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) destroySession(token);
      if (user) audit("auth.logout", user.id, {});
      res.setHeader("Set-Cookie", sessionCookieHeader("", req, 0));
      return sendJson(res, 200, { ok: true });
    }
    if (b === "me" && method === "GET") {
      return sendJson(res, 200, { user: user ? publicUser(user) : null, needsSetup: !ownerExists() });
    }
    return sendError(res, 404, "NOT_FOUND", "Unknown auth endpoint.");
  }

  // everything below requires auth
  if (!user) return sendError(res, 401, "UNAUTHENTICATED", "Please log in.");

  // ---- overview ----
  if (a === "overview" && method === "GET") {
    requireAuth(req, res, "editor", () => sendJson(res, 200, buildOverview()));
    return;
  }

  // ---- content entities ----
  if (a === "entities") {
    const type = b; // city | route | place | faq | photoGuide
    if (ENTITY_TYPES.indexOf(type) === -1) return sendError(res, 404, "BAD_TYPE", "Unknown entity type.");
    const doc = readJson("content.json", {});
    const listKey = ENTITY_PLURAL[type];
    if (!Array.isArray(doc[listKey])) doc[listKey] = [];

    if (!c && method === "GET") {
      return sendJson(res, 200, {
        items: doc[listKey].filter((e) => !e.archived).map((e) => ({
          id: e.id, name: e.name || e.title || e.q || e.facility,
          status: e.status || "needs-verification", published: e.published !== false,
          verified: !!e.verified, updatedAt: e.updatedAt || null,
        })),
      });
    }
    if (!c && method === "POST") {
      requireAuth(req, res, "editor", () => {
        if (requireCsrf(req, res)) return;
        readBody(req, (body) => {
          if (!body || body === null) return sendError(res, 400, "BAD_JSON", "Invalid JSON body.");
          const name = cleanString(body.name || body.title || body.q || body.facility, 160);
          if (!name) return sendError(res, 400, "BAD_INPUT", "A name/title is required.");
          const entity = sanitizeEntity(type, body);
          entity.id = newId(type, name, doc);
          entity.published = false; // always start as draft
          entity.sellable = type === "route" ? !!body.sellable : undefined;
          entity.createdAt = Date.now();
          entity.updatedAt = Date.now();
          doc[listKey].push(entity);
          doc.version = (doc.version || 0) + 1;
          doc.updatedAt = Date.now();
          writeJson("content.json", doc);
          audit("content.create", user.id, { type, id: entity.id });
          sendJson(res, 201, { item: entity });
        });
      });
      return;
    }
    const id = cleanString(c, 80);
    const idx = doc[listKey].findIndex((e) => e.id === id && !e.archived);
    if (idx === -1) return sendError(res, 404, "NOT_FOUND", "Entity not found.");

    if (d === "publish" && method === "POST") {
      requireAuth(req, res, "admin", () => {
        if (requireCsrf(req, res)) return;
        doc[listKey][idx].published = true;
        doc[listKey][idx].updatedAt = Date.now();
        doc.version = (doc.version || 0) + 1;
        doc.updatedAt = Date.now();
        writeJson("content.json", doc);
        audit("content.publish", user.id, { type, id });
        sendJson(res, 200, { ok: true });
      });
      return;
    }
    if (d === "unpublish" && method === "POST") {
      requireAuth(req, res, "admin", () => {
        if (requireCsrf(req, res)) return;
        doc[listKey][idx].published = false;
        doc[listKey][idx].updatedAt = Date.now();
        doc.version = (doc.version || 0) + 1;
        doc.updatedAt = Date.now();
        writeJson("content.json", doc);
        audit("content.unpublish", user.id, { type, id });
        sendJson(res, 200, { ok: true });
      });
      return;
    }

    if (method === "GET") return sendJson(res, 200, { item: doc[listKey][idx] });

    if (method === "PUT") {
      requireAuth(req, res, "editor", () => {
        if (requireCsrf(req, res)) return;
        readBody(req, (body) => {
          if (!body || body === null) return sendError(res, 400, "BAD_JSON", "Invalid JSON body.");
          const merged = Object.assign({}, doc[listKey][idx], sanitizeEntity(type, body));
          merged.id = doc[listKey][idx].id;
          merged.published = doc[listKey][idx].published; // editors edit content, not visibility
          merged.createdAt = doc[listKey][idx].createdAt;
          merged.updatedAt = Date.now();
          doc[listKey][idx] = merged;
          doc.version = (doc.version || 0) + 1;
          doc.updatedAt = Date.now();
          writeJson("content.json", doc);
          audit("content.update", user.id, { type, id });
          sendJson(res, 200, { item: merged });
        });
      });
      return;
    }
    if (method === "DELETE") {
      requireAuth(req, res, "owner", () => {
        if (requireCsrf(req, res)) return;
        doc[listKey][idx].archived = true; // soft delete keeps audit trail & restore ability
        doc[listKey][idx].updatedAt = Date.now();
        doc.version = (doc.version || 0) + 1;
        doc.updatedAt = Date.now();
        writeJson("content.json", doc);
        audit("content.delete", user.id, { type, id });
        sendJson(res, 200, { ok: true });
      });
      return;
    }
    return sendError(res, 405, "BAD_METHOD", "Unsupported method.");
  }

  // ---- UI config (safe copy fields only; no HTML/JS) ----
  if (a === "uiconfig") {
    const doc = readJson("content.json", {});
    if (method === "GET") return sendJson(res, 200, { ui: doc.ui || {} });
    if (method === "PUT") {
      requireAuth(req, res, "editor", () => {
        if (requireCsrf(req, res)) return;
        readBody(req, (body) => {
          if (!body || body === null) return sendError(res, 400, "BAD_JSON", "Invalid JSON body.");
          const ui = Object.assign({}, doc.ui || {});
          ["heroEyebrow", "heroTitle", "heroSub"].forEach((k) => {
            if (body[k] !== undefined) ui[k] = cleanString(body[k], 300);
          });
          if (Array.isArray(body.featuredRouteIds)) {
            ui.featuredRouteIds = body.featuredRouteIds.slice(0, 6).map((x) => cleanString(x, 80)).filter(Boolean);
          }
          doc.ui = ui;
          doc.version = (doc.version || 0) + 1;
          doc.updatedAt = Date.now();
          writeJson("content.json", doc);
          audit("uiconfig.update", user.id, { keys: Object.keys(ui) });
          sendJson(res, 200, { ui });
        });
      });
      return;
    }
    return sendError(res, 405, "BAD_METHOD", "Unsupported method.");
  }

  // ---- consults ----
  if (a === "consults") {
    const consults = readJson("consults.json", []);
    if (b === "export" && method === "GET") {
      requireAuth(req, res, "admin", () => {
        audit("consult.export", user.id, { count: consults.length });
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="zheshgo-consults-' + new Date().toISOString().slice(0, 10) + '.json"',
        });
        res.end(JSON.stringify({ exportedAt: new Date().toISOString(), count: consults.length, consults }, null, 2));
      });
      return;
    }
    if (!b && method === "GET") {
      requireAuth(req, res, "editor", () => {
        const status = cleanString(new URL(req.url, "http://x").searchParams.get("status"), 30);
        const list = status ? consults.filter((c) => c.status === status) : consults;
        sendJson(res, 200, { items: list.slice(-200).reverse() });
      });
      return;
    }
    if (b && method === "GET") {
      requireAuth(req, res, "editor", () => {
        const c = consults.find((x) => x.id === b);
        if (!c) return sendError(res, 404, "NOT_FOUND", "Consult not found.");
        sendJson(res, 200, { item: c });
      });
      return;
    }
    if (b && method === "PUT") {
      requireAuth(req, res, "editor", () => {
        if (requireCsrf(req, res)) return;
        const c = consults.find((x) => x.id === b);
        if (!c) return sendError(res, 404, "NOT_FOUND", "Consult not found.");
        readBody(req, (body) => {
          if (!body || body === null) return sendError(res, 400, "BAD_JSON", "Invalid JSON body.");
          const statuses = ["new", "pending", "followup", "done", "closed"];
          if (body.status !== undefined) {
            if (statuses.indexOf(body.status) === -1) return sendError(res, 400, "BAD_STATUS", "Unknown status.");
            c.status = body.status;
          }
          if (body.assignee !== undefined) c.assignee = cleanString(body.assignee, 80) || null;
          if (body.note !== undefined && cleanString(body.note, 1000)) {
            c.notes = c.notes || [];
            c.notes.push({ ts: Date.now(), by: user.name, text: cleanString(body.note, 1000) });
          }
          c.updatedAt = Date.now();
          writeJson("consults.json", consults);
          audit("consult.update", user.id, { id: c.id, status: c.status });
          sendJson(res, 200, { item: c });
        });
      });
      return;
    }
    return sendError(res, 405, "BAD_METHOD", "Unsupported method.");
  }

  // ---- submissions moderation ----
  if (a === "submissions") {
    const submissions = readJson("submissions.json", []);
    if (b === "moderate" && method === "POST") {
      requireAuth(req, res, "editor", () => {
        if (requireCsrf(req, res)) return;
        readBody(req, (body) => {
          const targetId = cleanString(body && body.id, 80) || cleanString(c, 80);
          const s = submissions.find((x) => x.id === targetId);
          if (!s) return sendError(res, 404, "NOT_FOUND", "Submission not found.");
          const actions = ["approve", "hide", "reject"];
          if (actions.indexOf(body && body.action) === -1) return sendError(res, 400, "BAD_ACTION", "Unknown action.");
          const reason = cleanString(body && body.reason, 500);
          s.status = body.action === "approve" ? "published" : body.action === "hide" ? "hidden" : "rejected";
          s.reason = reason || null;
          s.moderatedBy = user.name;
          s.moderatedAt = Date.now();
          writeJson("submissions.json", submissions);
          audit("submission.moderate", user.id, { id: s.id, status: s.status, reason });
          sendJson(res, 200, { item: s });
        });
      });
      return;
    }
    if (!b && method === "GET") {
      requireAuth(req, res, "editor", () => sendJson(res, 200, { items: submissions.slice(-200).reverse() }));
      return;
    }
    return sendError(res, 405, "BAD_METHOD", "Unsupported method.");
  }

  // ---- users & roles (owner only) ----
  if (a === "users") {
    if (!b && method === "GET") {
      requireAuth(req, res, "admin", () => {
        sendJson(res, 200, {
          items: readJson("users.json", []).map((u) => ({
            id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, disabled: !!u.disabled,
          })),
        });
      });
      return;
    }
    if (!b && method === "POST") {
      requireAuth(req, res, "owner", () => {
        if (requireCsrf(req, res)) return;
        readBody(req, (body) => {
          const name = cleanString(body && body.name, 80);
          const email = cleanString(body && body.email, 160).toLowerCase();
          const role = body && body.role;
          const password = body && body.password ? String(body.password) : "";
          if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendError(res, 400, "BAD_INPUT", "Name and valid email required.");
          if (["admin", "editor"].indexOf(role) === -1) return sendError(res, 400, "BAD_ROLE", "Role must be admin or editor.");
          if (password.length < 10) return sendError(res, 400, "WEAK_PASSWORD", "Password must be at least 10 characters.");
          const users = readJson("users.json", []);
          if (users.some((u) => u.email === email)) return sendError(res, 409, "EMAIL_TAKEN", "Email already in use.");
          const u = { id: "u_" + crypto.randomBytes(8).toString("hex"), name, email, role, passwordHash: hashPassword(password), createdAt: Date.now(), disabled: false };
          users.push(u);
          writeJson("users.json", users);
          audit("user.create", user.id, { id: u.id, role });
          sendJson(res, 201, { user: publicUser(u) });
        });
      });
      return;
    }
    if (b && method === "PUT") {
      requireAuth(req, res, "owner", () => {
        if (requireCsrf(req, res)) return;
        readBody(req, (body) => {
          const users = readJson("users.json", []);
          const target = users.find((u) => u.id === b);
          if (!target) return sendError(res, 404, "NOT_FOUND", "User not found.");
          if (d === "role" && body && body.role) {
            if (target.role === "owner" || body.role === "owner") return sendError(res, 403, "OWNER_ROLE", "Owner role can only be created via bootstrap.");
            if (["admin", "editor"].indexOf(body.role) === -1) return sendError(res, 400, "BAD_ROLE", "Bad role.");
            const before = target.role;
            target.role = body.role;
            writeJson("users.json", users);
            audit("user.role_change", user.id, { id: target.id, from: before, to: body.role });
            return sendJson(res, 200, { user: publicUser(target) });
          }
          if (d === "password" && body && body.password) {
            if (String(body.password).length < 10) return sendError(res, 400, "WEAK_PASSWORD", "Password must be at least 10 characters.");
            target.passwordHash = hashPassword(String(body.password));
            writeJson("users.json", users);
            audit("user.password_reset", user.id, { id: target.id });
            return sendJson(res, 200, { ok: true });
          }
          return sendError(res, 400, "BAD_ACTION", "Unknown user action.");
        });
      });
      return;
    }
    if (b && method === "DELETE") {
      requireAuth(req, res, "owner", () => {
        if (requireCsrf(req, res)) return;
        const users = readJson("users.json", []);
        const target = users.find((u) => u.id === b);
        if (!target) return sendError(res, 404, "NOT_FOUND", "User not found.");
        if (target.role === "owner") return sendError(res, 403, "OWNER_ROLE", "The owner account cannot be deleted.");
        target.disabled = true; // soft delete preserves audit history
        writeJson("users.json", users);
        audit("user.delete", user.id, { id: target.id });
        sendJson(res, 200, { ok: true });
      });
      return;
    }
    return sendError(res, 405, "BAD_METHOD", "Unsupported method.");
  }

  // ---- audit log ----
  if (a === "audit" && method === "GET") {
    requireAuth(req, res, "admin", () => {
      sendJson(res, 200, { items: readJson("audit.json", []).slice(-300).reverse() });
    });
    return;
  }

  // ---- backup / restore (owner only) ----
  if (a === "backup" && method === "GET") {
    requireAuth(req, res, "owner", () => {
      const backup = { exportedAt: new Date().toISOString(), kind: "zheshgo-backup-v1" };
      dataFiles().forEach((f) => { backup[f] = readJson(f, null); });
      audit("backup.export", user.id, {});
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="zheshgo-backup-' + new Date().toISOString().slice(0, 10) + '.json"',
      });
      res.end(JSON.stringify(backup, null, 2));
    });
    return;
  }
  if (a === "restore" && method === "POST") {
    requireAuth(req, res, "owner", () => {
      if (requireCsrf(req, res)) return;
      readBody(req, (body) => {
        if (!body || body.kind !== "zheshgo-backup-v1") return sendError(res, 400, "BAD_BACKUP", "Not a valid ZheshGo backup file.");
        const allowed = ["content.json", "consults.json", "submissions.json", "users.json", "ui.json", "events.json"];
        allowed.forEach((f) => { if (body[f] !== undefined && body[f] !== null) writeJson(f, body[f]); });
        // never restore sessions/audit/secret from backup by default
        audit("backup.restore", user.id, { files: allowed.filter((f) => body[f] !== undefined) });
        sendJson(res, 200, { ok: true });
      });
    });
    return;
  }

  return sendError(res, 404, "NOT_FOUND", "Unknown admin endpoint.");
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, needsSetup: false };
}

/* ---------------- public visitor API ---------------- */
function handlePublicApi(req, res, parts) {
  const [a, b] = parts;
  const method = req.method;

  if (a === "health" && method === "GET") {
    return sendJson(res, 200, { ok: true, service: "zheshgo", time: new Date().toISOString() });
  }

  if (a === "consult" && method === "POST") {
    if (!rateLimit("consult:" + ip(req), 5, 3600000)) return sendError(res, 429, "RATE_LIMITED", "Too many requests. Please try later.");
    readBody(req, (body) => {
      if (!body || body === null) return sendError(res, 400, "BAD_JSON", "Invalid request.");
      const allowed = ["dates", "duration", "group", "arrive", "cities", "pace", "needs", "budget", "contact", "note", "from"];
      const fields = {};
      allowed.forEach((k) => {
        if (body[k] !== undefined) {
          const v = typeof body[k] === "string" ? cleanString(body[k], k === "contact" ? 200 : 500) : (Array.isArray(body[k]) ? body[k].slice(0, 10).map((x) => cleanString(x, 80)).filter(Boolean) : undefined);
          if (v !== undefined && (typeof v !== "string" || v)) fields[k] = v;
        }
      });
      // contact is optional; never require it to browse
      const consult = {
        id: "c_" + crypto.randomBytes(8).toString("hex"),
        createdAt: Date.now(),
        status: "new",
        fields,
        assignee: null,
        notes: [],
        updatedAt: Date.now(),
      };
      const consults = readJson("consults.json", []);
      consults.push(consult);
      if (consults.length > 5000) consults.splice(0, consults.length - 5000);
      writeJson("consults.json", consults);
      audit("consult.received", null, { id: consult.id, hasContact: !!fields.contact });
      sendJson(res, 201, { ok: true, id: consult.id });
    });
    return;
  }

  if (a === "submissions" && method === "POST") {
    if (!rateLimit("sub:" + ip(req), 5, 3600000)) return sendError(res, 429, "RATE_LIMITED", "Too many requests. Please try later.");
    readBody(req, (body) => {
      const question = cleanString(body && body.question, 1000);
      if (!question) return sendError(res, 400, "BAD_INPUT", "Question text is required.");
      const s = { id: "s_" + crypto.randomBytes(8).toString("hex"), question, status: "pending", reason: null, createdAt: Date.now(), moderatedBy: null, moderatedAt: null };
      const submissions = readJson("submissions.json", []);
      submissions.push(s);
      if (submissions.length > 2000) submissions.splice(0, submissions.length - 2000);
      writeJson("submissions.json", submissions);
      sendJson(res, 201, { ok: true, id: s.id });
    });
    return;
  }
  if (a === "submissions" && b === "published" && method === "GET") {
    const items = readJson("submissions.json", []).filter((s) => s.status === "published").slice(-50).reverse();
    return sendJson(res, 200, { items });
  }

  if (a === "events" && method === "POST") {
    // anonymized: only task names, no payload, no session ids
    readBody(req, (body) => {
      const tasks = Array.isArray(body && body.tasks)
        ? body.tasks.slice(0, 50)
        : (body && body.task ? [body.task] : []);
      const clean = tasks.map((t) => cleanString(t, 50)).filter((t) => /^[a-z0-9_]{2,40}$/i.test(t));
      if (!clean.length) return sendError(res, 400, "BAD_INPUT", "Invalid event.");
      const ev = readJson("events.json", { recent: [], aggregates: {} });
      const date = new Date().toISOString().slice(0, 10);
      ev.aggregates[date] = ev.aggregates[date] || {};
      clean.forEach((task) => { ev.aggregates[date][task] = (ev.aggregates[date][task] || 0) + 1; });
      Object.keys(ev.aggregates).sort().slice(0, -90).forEach((k) => delete ev.aggregates[k]); // keep 90 days
      writeJson("events.json", ev);
      sendJson(res, 200, { ok: true });
    });
    return;
  }

  if (a === "assistant" && b === "status" && method === "GET") {
    if (!applyCors(req, res)) return sendError(res, 403, "CORS_DENIED", "Origin not allowed.");
    const cfg = getAiConfig();
    return sendJson(res, 200, {
      configured: aiConfigured(cfg),
      provider: cfg.provider || null,
      model: cfg.model || null,
      // never return the API key or base URL internals
    });
  }
  if (a === "assistant" && b === "chat" && method === "POST") {
    if (!applyCors(req, res)) return sendError(res, 403, "CORS_DENIED", "Origin not allowed.");
    if (!rateLimit("ai:" + ip(req), 15, 60000)) {
      return sendError(res, 429, "AI_RATE_LIMITED", "Too many requests — please wait a minute and try again.");
    }
    const cfg = getAiConfig();
    if (!aiConfigured(cfg)) {
      return sendError(res, 503, "AI_NOT_CONFIGURED", "AI assistant is not configured on this server yet.");
    }
    readBody(req, (body) => {
      if (!body || body === null) return sendError(res, 400, "BAD_JSON", "Invalid request.");
      const raw = Array.isArray(body.messages) ? body.messages : [];
      const locale = body.locale === undefined ? "en" : body.locale;
      if (!["en", "ja", "ko"].includes(locale)) return sendError(res, 400, "UNSUPPORTED_LOCALE", "Supported page languages: en, ja, ko.");
      // The server supplies the system instruction. Client history is untrusted
      // and cannot supply system, developer or tool messages.
      const conversation = raw
        .filter((m) => m && ["user", "assistant"].includes(m.role))
        .map((m) => ({ role: m.role, content: cleanString(m.content, 2000) }))
        .filter((m) => m.content)
        .slice(-16);
      if (!conversation.some((m) => m.role === "user")) return sendError(res, 400, "BAD_INPUT", "No message content.");
      const languageInstruction = locale === "ja"
        ? "Gather evidence across source languages, consolidate the facts and trade-offs in English internally, then translate the final answer into natural Japanese. Show only the Japanese answer unless the traveler asks otherwise. Use concise, friendly desu/masu prose and preserve original Chinese place names where useful for navigation."
        : locale === "ko"
        ? "Gather evidence across source languages, consolidate the facts and trade-offs in English internally, then translate the final answer into natural Korean. Show only the Korean answer unless the traveler asks otherwise. Use concise, friendly haeyo-style polite Korean and practical travel terms such as itinerary, walking route and pre-trip checks. Use established Korean place names where known (Shanghai: 상하이, Hangzhou: 항저우, Ningbo: 닝보, West Lake: 서호, Tianyi Pavilion: 천일각), and preserve original Chinese names where useful for maps. Do not assume a Korean-speaking traveler holds a Korean passport."
        : "Answer in clear English by default.";
      const messages = [{ role: "system", content: AI_SYSTEM + " " + languageInstruction + " Follow an explicit language change requested by the user in the conversation, including subsequent turns.\n\n" + buildContextDigest(conversation) }]
        .concat(conversation);
      const t0 = Date.now();
      callQwen(cfg, messages, (err, data) => {
        const ms = Date.now() - t0;
        if (err) {
          aiLog(cfg, err.code, err.http, ms, err.detail);
          return sendError(res, err.http, err.code, {
            AI_AUTH_ERROR: "The AI service rejected our credentials — please contact the site owner.",
            AI_RATE_LIMITED: "The AI service is rate-limited right now — please retry in a moment.",
            AI_TIMEOUT: "The AI service took too long to answer — please retry.",
            AI_MODEL_ERROR: "The AI service returned an error — please retry.",
          }[err.code] || "AI service error — please retry.");
        }
        aiLog(cfg, "OK", 200, ms, data.usage && data.usage.total_tokens ? "tokens=" + data.usage.total_tokens : null);
        // NOTE: full conversations are NOT persisted anywhere by design.
        sendJson(res, 200, { code: "OK", data: {
          reply: data.reply, model: data.model, provider: "qwen",
          sources: data.sources, checkedAt: data.checkedAt,
        } });
      });
    });
    return;
  }

  return sendError(res, 404, "NOT_FOUND", "Unknown endpoint.");
}

/* ---------------- minimal .env loader (dev convenience) ---------------- */
function loadDotEnv() {
  const f = path.join(ROOT, ".env");
  try {
    const text = fs.readFileSync(f, "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      const i = t.indexOf("=");
      if (i < 1) return;
      const key = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim();
      if (process.env[key] === undefined) process.env[key] = val; // real env wins
    });
  } catch (e) { /* no .env — fine */ }
}

/* ---------------- AI assistant (server-side Qwen adapter) ----------------
   - Config comes ONLY from server env: AI_PROVIDER / QWEN_API_KEY /
     QWEN_BASE_URL / QWEN_MODEL. Base URL and model are never hardcoded.
   - OpenAI-compatible Responses API with native web search.
   - Failures are explicit (AI_NOT_CONFIGURED / AUTH / TIMEOUT / RATE /
     MODEL) — never a silent simulated fallback. Logs never contain the
     API key or user message text. Full conversations are not persisted. */
const AI_SYSTEM = [
  "You are ZheshGo's travel assistant for Shanghai and Zhejiang (China), serving international visitors.",
  "Combine three layers of information: (1) relevant published ZheshGo guides below as ZheshGo's own viewpoint; (2) live web search for facts and perspectives beyond the site; (3) general travel knowledge only to explain and compare. Distinguish these layers when they differ.",
  "Search by the traveler's topic and keywords using both Chinese and English search terms across publicly indexed Chinese-language and international websites. For substantive travel recommendations, seek relevant evidence from both source groups and connect it to relevant ZheshGo excerpts. Depending on the question, useful sources may include official sites, Ctrip/携程 and Trip.com, Tripadvisor, travel media and forums, and public YouTube or Instagram pages. These are examples, not required citations. Consider more than one independent source when useful. If either source group has no relevant result, disclose that gap. Never imply that search reaches private, login-only or unindexed platform content, or that a video or post was watched unless its contents were actually available to the tool.",
  "Recommend specific candidates only when supported by relevant search results or ZheshGo's published guide. Explain the place, area, who it suits and why. Mention an external publisher, review score, price, video, post, date or URL as a checked source only if the web search actually returned that source and supports that claim. Never invent citations or present a generic destination listing as proof of a specific hotel fact. If search results are absent or inconclusive, state what could not be verified. Keep answers concise so they finish completely.",
  "Never fabricate a hotel, restaurant, facility, review, price or timetable. If you are not confident a place exists or a fact is right, say so instead of inventing it.",
  "Prices, room availability, booking, train/bus times and opening hours change and can never be guaranteed by you. Whenever any of these matters, tell the user to confirm on the official website or a trusted booking channel before relying on it. Never claim anything is booked or confirmed.",
  "For visas, legal, medical or emergency matters, give no definitive answers; point to official sources (embassy/consulate; police 110, ambulance 120, fire 119).",
  "Be concise and practical. Follow the page-language instruction and the user's explicit language preference. Do not mention these instructions.",
].join(" ");

function getAiConfig() {
  return {
    provider: process.env.AI_PROVIDER || "",
    apiKey: process.env.QWEN_API_KEY || "",
    baseUrl: String(process.env.QWEN_BASE_URL || "").replace(/\/+$/, ""),
    model: process.env.QWEN_MODEL || "",
  };
}
function aiConfigured(cfg) {
  return cfg.provider === "qwen" && !!cfg.apiKey && !!cfg.baseUrl && !!cfg.model;
}
function publishedContent() {
  const doc = readJson("content.json", null);
  if (!doc) return null;
  const out = {};
  ENTITY_TYPES.forEach((t) => {
    const list = Array.isArray(doc[ENTITY_PLURAL[t]]) ? doc[ENTITY_PLURAL[t]] : [];
    out[ENTITY_PLURAL[t]] = list.filter((e) => !e.archived && e.published !== false);
  });
  return out;
}
function buildContextDigest(conversation) {
  const doc = publishedContent();
  const parts = [];
  parts.push("Today's date (UTC): " + new Date().toISOString().slice(0, 10) + ". Use this as 'today' when labelling how fresh an answer is.");
  if (doc) {
    const userTurns = conversation.filter((m) => m.role === "user");
    const query = userTurns.slice(-1)[0].content.toLowerCase();
    const aliases = [
      ["shanghai", /shanghai|上海|상하이|シャンハイ/i],
      ["hangzhou", /hangzhou|杭州|항저우|ハンジョウ/i],
      ["ningbo", /ningbo|宁波|寧波|닝보|ニンポー/i],
      ["shaoxing", /shaoxing|绍兴|紹興|사오싱|ショウコウ/i],
      ["huzhou", /huzhou|湖州|후저우|フーチョウ/i],
    ];
    // A short follow-up can inherit its city from the nearest user turn.
    const cityTurn = userTurns.slice().reverse().find((m) => aliases.some((entry) => entry[1].test(m.content)));
    const cities = aliases.filter((entry) => entry[1].test(cityTurn ? cityTurn.content : query));
    const topics = [
      ["hotel", /hotel|accommodation|stay|酒店|住宿|ホテル|숙박|호텔/i],
      ["food", /food|restaurant|dining|美食|餐厅|餐廳|レストラン|グルメ|맛집|음식|식당/i],
      ["train", /train|rail|铁路|鐵路|火车|火車|高铁|高鐵|鉄道|列車|기차|철도/i],
      ["history", /history|historic|heritage|历史|歷史|歴史|역사/i],
      ["walking", /walk|stroll|步行|散步|街歩き|산책|도보/i],
      ["payment", /pay|alipay|wechat|支付|付款|支払|결제/i],
    ];
    const stop = new Set("the and for with from what about your you are can how please recommend tell places place first visit trip travel".split(" "));
    const tokens = [...new Set((query.match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 2 && !stop.has(t)))].slice(0, 40);
    const candidates = [];
    const add = (kind, item, excerpt) => {
      const text = JSON.stringify(item).toLowerCase();
      const matchedCities = cities.filter(([name, pattern]) => text.includes(name) || pattern.test(text));
      // Keep city-neutral practical FAQs as candidates, but exclude other-city guides.
      if (cities.length && !matchedCities.length && kind !== "FAQ") return;
      let score = matchedCities.length * 5;
      tokens.forEach((token) => { if (text.includes(token)) score += 2; });
      topics.forEach(([name, pattern]) => { if (pattern.test(query) && (text.includes(name) || pattern.test(text))) score += 4; });
      if (score || !cities.length) candidates.push({ score, excerpt });
    };
    parts.push("ZheshGo published guide excerpts (site content, not live web verification):");
    const short = (value, limit) => String(value || "").slice(0, limit);
    (doc.cities || []).forEach((c) => add("City", c, "- City " + short(c.name, 80) + ": " + short(c.tagline, 120) + ". " + short(c.intro, 180)));
    (doc.routes || []).forEach((r) => add("Route", r,
      '- Route "' + short(r.title, 100) + '" (' + (r.days || 1) + "d): " + short(r.summary, 180) + ". " + short(r.why, 100) + "\n" +
      (r.dayByDay || []).slice(0, 3).map((d) => "  Day" + (d.day || "") + " " + short(d.title, 60) + ": " + (d.stops || []).slice(0, 4).map((s) => short(s.name, 50)).join(", ")).join("\n")));
    (doc.places || []).forEach((p) => add("Place", p, "- Place " + short(p.name, 100) + ": " + short(p.blurb, 240)));
    (doc.faqs || []).forEach((f) => add("FAQ", f, "- FAQ " + short(f.q, 120) + ": " + short(f.a, 280)));
    let remaining = 4000 - parts.join("\n").length;
    let selected = 0;
    for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
      if (candidate.excerpt.length + 1 > remaining) continue;
      parts.push(candidate.excerpt);
      remaining -= candidate.excerpt.length + 1;
      if (++selected >= 16) break;
    }
    if (!selected) parts.push("No relevant published guide excerpt matched this question.");
  } else {
    parts.push("No published content is available yet.");
  }
  return parts.join("\n").slice(0, 4000);
}
function responseSources(data) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(data.output) ? data.output : []) {
    if (item.type !== "web_search_call") continue;
    for (const source of Array.isArray(item.action && item.action.sources) ? item.action.sources : []) {
      const raw = typeof source === "string" ? source : source && source.url;
      try {
        const url = new URL(raw);
        if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) continue;
        seen.add(url.href);
        result.push({ url: url.href, title: String(source && source.title || url.hostname).slice(0, 120) });
      } catch (_) { /* Ignore malformed upstream source URLs. */ }
      if (result.length >= 32) return result;
    }
  }
  return result;
}
function responseText(data) {
  return (Array.isArray(data.output) ? data.output : [])
    .filter((item) => item.type === "message")
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text).join("\n");
}
function callQwen(cfg, messages, cb) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  const started = Date.now();
  // The configured base flash model does not expose the Responses web-search
  // tool. Keep the existing env setting compatible by selecting the agent
  // variant only for this search-backed request.
  const requestModel = cfg.model === "qwen3.8-flash" ? "qwen3.8-omni-flash" : cfg.model;
  fetch(cfg.baseUrl + "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.apiKey },
    body: JSON.stringify({ model: requestModel, input: messages, tools: [{ type: "web_search" }],
      tool_choice: "required", stream: false, store: false, reasoning: { effort: "low" }, max_output_tokens: 2400 }),
    signal: controller.signal,
  }).then((up) => {
    if (up.status === 401 || up.status === 403) return cb({ code: "AI_AUTH_ERROR", http: 502, detail: "upstream auth " + up.status });
    if (up.status === 429) return cb({ code: "AI_RATE_LIMITED", http: 429, detail: "upstream rate limited" });
    if (!up.ok) return cb({ code: "AI_MODEL_ERROR", http: 502, detail: "upstream " + up.status });
    return up.json().then((data) => {
      const reply = responseText(data);
      if (!reply || reply.length > 20000 || (data.status && data.status !== "completed") ||
          (data.output || []).some((item) => item.type === "message" && item.status && item.status !== "completed")) {
        return cb({ code: "AI_MODEL_ERROR", http: 502, detail: "empty, oversized or unfinished reply" });
      }
      const sources = responseSources(data);
      cb(null, { reply, model: requestModel, usage: data.usage || null,
        sources, checkedAt: sources.length ? new Date().toISOString() : null });
    }).catch(() => cb({ code: "AI_MODEL_ERROR", http: 502, detail: "bad upstream json" }));
  }).catch((err) => {
    if (err && err.name === "AbortError") return cb({ code: "AI_TIMEOUT", http: 504, detail: "upstream timeout" });
    return cb({ code: "AI_MODEL_ERROR", http: 502, detail: "network" });
  }).finally(() => clearTimeout(timer));
  // eslint-disable-next-line no-unused-vars
  return started;
}
function aiLog(cfg, code, http, durationMs, detail) {
  // No API key, no user text — status telemetry only.
  // eslint-disable-next-line no-console
  console.log("[assistant] provider=" + cfg.provider + " model=" + cfg.model +
    " status=" + code + " http=" + http + " ms=" + durationMs + (detail ? " (" + detail + ")" : ""));
}

/* ---------------- main server ---------------- */
const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  // dynamic content feed for the visitor site
  if (url === "/js/data/content.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(buildContentJs());
  }

  // CORS preflight for cross-origin assistant calls (browser sends OPTIONS
  // before the JSON POST because Content-Type: application/json is non-simple).
  if (req.method === "OPTIONS" && url.startsWith("/api/v1/assistant/")) {
    if (!applyCors(req, res)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Origin not allowed");
    }
    res.writeHead(204, { "Content-Length": "0" });
    return res.end();
  }

  if (url.startsWith("/api/v1/admin/")) {
    const parts = url.replace("/api/v1/admin/", "").split("/").filter(Boolean);
    return handleAdminApi(req, res, parts, currentUser(req));
  }
  if (url.startsWith("/api/v1/")) {
    const parts = url.replace("/api/v1/", "").split("/").filter(Boolean);
    return handlePublicApi(req, res, parts);
  }

  return serveStatic(req, res);
});

function start() {
  loadDotEnv();
  ensureDataDir();
  // seed default empty stores if missing
  ["users.json", "consults.json", "submissions.json", "audit.json"].forEach((f) => {
    if (!fs.existsSync(path.join(DATA_DIR, f))) writeJson(f, []);
  });
  if (!fs.existsSync(path.join(DATA_DIR, "sessions.json"))) writeJson("sessions.json", {});
  if (!fs.existsSync(path.join(DATA_DIR, "events.json"))) writeJson("events.json", { recent: [], aggregates: {} });
  ensureBootstrap();

  const port = parseInt(process.env.PORT, 10) || 8080;
  server.listen(port, "0.0.0.0", () => {
    // eslint-disable-next-line no-console
    console.log("ZheshGo server listening on 0.0.0.0:" + port);
    // eslint-disable-next-line no-console
    console.log("Admin console: /admin/  · Visitor site: /  · App: /app/");
  });
}

start();
