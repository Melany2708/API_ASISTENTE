const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const push = require('web-push');
const { createDrive, documentSteps, fileId } = require('./drive');

const data = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(data, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(data, 'agenda.sqlite'));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS notices (id TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY);
`);
function read(table) {
  return db.prepare('SELECT value FROM ' + table).all().map(row => JSON.parse(row.value));
}
function save(table, id, value) {
  db.prepare('INSERT OR REPLACE INTO ' + table + ' VALUES (?, ?)').run(id, JSON.stringify(value));
}
function setting(key, create) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return JSON.parse(row.value);
  db.prepare('INSERT INTO settings VALUES (?, ?)').run(key, JSON.stringify(create()));
  return setting(key, create);
}
const drive = createDrive(db);
const password = process.env.AGENDA_PASSWORD || setting('password', () => crypto.randomBytes(18).toString('base64url'));
const signingKey = setting('signing-key', () => crypto.randomBytes(32).toString('hex'));
const keys = setting('vapid', () => push.generateVAPIDKeys());
const pushSubject = process.env.VAPID_SUBJECT || 'https://example.com';
push.setVapidDetails(pushSubject, keys.publicKey, keys.privateKey);
const day = 86400000;
const minute = 60000;
const allowedKinds = ['task', 'meeting', 'class', 'gym', 'birthday', 'anniversary', 'event', 'document'];
const timedKinds = ['meeting', 'class', 'gym', 'event'];
const validDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value) &&
  Number.isFinite(Date.parse(value + 'Z')) && new Date(value + 'Z').toISOString().slice(0, 16) === value;
const dateMs = value => Date.parse(value + '-05:00');
const trim = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
function slots(item, from, to) {
  if (!item.start) return [];
  const base = dateMs(item.start);
  if (item.repeat === 'weekly') {
    const interval = 7 * day;
    const hits = [];
    for (let time = base + Math.max(0, Math.ceil((from - base) / interval)) * interval; time <= to; time += interval) hits.push(time);
    return hits;
  }
  if (item.repeat === 'annual') {
    const hits = [];
    for (let year = Math.max(Number(item.start.slice(0, 4)), new Date(from).getUTCFullYear() - 1); year <= new Date(to).getUTCFullYear(); year++) {
      const value = String(year).padStart(4, '0') + item.start.slice(4);
      const time = dateMs(value);
      if (validDate(value) && time >= from && time <= to) hits.push(time);
    }
    return hits;
  }
  return base >= from && base <= to ? [base] : [];
}
function overlap(a, b) {
  const aStart = dateMs(a.start);
  const bStart = dateMs(b.start);
  const once = a.repeat === 'none' ? aStart : b.repeat === 'none' ? bStart : null;
  const anchor = once ?? Math.max(Date.now(), aStart, bStart);
  const start = anchor - day;
  const end = anchor + (once === null ? (a.repeat === 'annual' || b.repeat === 'annual' ? 2922 : 7) : 1) * day;
  return slots(a, start, end).some(time =>
    slots(b, time - b.duration * minute, time + a.duration * minute)
      .some(other => other < time + a.duration * minute && other + b.duration * minute > time));
}
function itemFrom(input, old) {
  const kind = input.kind;
  const title = trim(input.title, 150);
  const start = input.start || '';
  const duration = Number(input.duration ?? 60);
  const repeat = input.repeat || 'none';
  const reminder = Number(input.reminder ?? 30);
  if (!title || !allowedKinds.includes(kind) || (kind !== 'document' && !start) || (start && !validDate(start)) ||
    !Number.isInteger(duration) || duration < 5 || duration > 720 || !['none','weekly','annual'].includes(repeat) ||
    ![0, 5, 15, 30, 60, 1440, 10080].includes(reminder)) throw new Error('Revisa el título, la fecha y la duración.');
  const link = trim(input.link, 2000);
  if (link && (!URL.canParse(link) || !/^https?:\/\//i.test(link))) throw new Error('El enlace debe empezar con https:// o http://.');
  return { id: old?.id || crypto.randomUUID(), kind, title, start, duration, repeat, reminder, link,
    notes: trim(input.notes, 24000), done: Boolean(input.done),
    watchDrive: kind === 'document' && input.watchDrive === true && Boolean(fileId(link)),
    checkedAt: old?.link === link ? old.checkedAt : null };
}
const signatures = value => crypto.createHmac('sha256', signingKey).update(value).digest('hex');
function equals(a, b) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
}
function authenticated(req) {
  const token = req.headers.cookie?.match(/(?:^|; )agenda=([^;]+)/)?.[1] || '';
  const [expiry, sig] = token.split('.');
  return Number(expiry) > Date.now() && equals(sig, signatures(expiry));
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Se requiere JSON.');
  let value = '';
  for await (const chunk of req) {
    value += chunk;
    if (value.length > 100000) throw new Error('El contenido es demasiado largo.');
  }
  return JSON.parse(value);
}
function recentNotices() {
  return read('notices').sort((a,b) => b.created - a.created).slice(0, 50);
}
const files = { '/': ['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css'], '/sw.js':['sw.js','text/javascript'], '/manifest.webmanifest':['manifest.webmanifest','application/manifest+json'], '/icon.png':['icon.png','image/png'] };
let failures = 0;
let loginUntil = 0;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  try {
    if (req.method === 'GET' && files[route]) {
      const [file, type] = files[route];
      res.writeHead(200, { 'Content-Type': type });
      return res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
    }
    if (route === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (!['GET','HEAD'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { error: 'Origen no permitido.' });
    if (route === '/api/login' && req.method === 'POST') {
      const input = await body(req);
      if (Date.now() >= loginUntil) failures = 0;
      if (failures >= 12) return json(res, 429, { error: 'Espera un minuto antes de volver a intentar.' });
      if (!equals(input.password, password)) {
        failures++;
        loginUntil = Date.now() + minute;
        return json(res, 401, { error: 'La clave no coincide.' });
      }
      failures = 0;
      const expiry = String(Date.now() + 30 * day);
      const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
      return json(res, 200, { ok: true }, { 'Set-Cookie': 'agenda=' + expiry + '.' + signatures(expiry) + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '') });
    }
    if (route === '/api/drive/callback' && req.method === 'GET') {
      let result = 'connected';
      try { await drive.callback(url.searchParams); }
      catch { result = 'error'; }
      res.writeHead(303, { Location: '/?drive=' + result, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!authenticated(req)) return json(res, 401, { error: 'Ingresa la clave de tu agenda.' });
    if (route === '/api/drive/connect' && req.method === 'POST') return json(res, 200, { url: drive.authorize() });
    if (/^\/api\/drive\/items\/[\w-]+$/.test(route) && req.method === 'POST') {
      const item = read('items').find(item => item.id === route.split('/')[4] && item.kind === 'document');
      if (!item) return json(res, 404, { error: 'El documento no está en tu agenda.' });
      return json(res, 200, await reviewDocument(item));
    }
    if (route === '/api/logout' && req.method === 'POST') return json(res, 200, { ok:true }, { 'Set-Cookie':'agenda=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' });
    if (route === '/api/notices' && req.method === 'GET') {
      return json(res, 200, { notices: recentNotices() });
    }
    if (route === '/api/state' && req.method === 'GET') {
      const now = Date.now();
      const from = Number(url.searchParams.get('from')) || now - day;
      const to = Number(url.searchParams.get('to')) || now + 35 * day;
      if (to < from || to - from > 367 * day || Math.abs(from - now) > 36525 * day || Math.abs(to - now) > 36525 * day) return json(res, 400, { error: 'Periodo inválido.' });
      const items = read('items');
      const occurrences = items.flatMap(item => slots(item, from, to).map(at => ({ id:item.id, at }))).sort((a,b) => a.at - b.at);
      const notices = recentNotices();
      return json(res, 200, { items, occurrences, notices, publicKey: keys.publicKey, drive: drive.status() });
    }
    if (route === '/api/subscriptions' && req.method === 'POST') {
      const sub = await body(req);
      const endpoint = new URL(sub.endpoint);
      const providers = ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','notify.windows.com','push.services.mozilla.com'];
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port ||
        !providers.some(host => endpoint.hostname === host || endpoint.hostname.endsWith('.' + host)) ||
        !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Suscripción de navegador inválida.');
      save('subscriptions', sub.endpoint, sub);
      return json(res, 201, { ok: true });
    }
    if (route === '/api/items' && req.method === 'POST' || /^\/api\/items\/[\w-]+$/.test(route) && ['PATCH','DELETE'].includes(req.method)) {
      const id = route.split('/')[3];
      const input = req.method === 'DELETE' ? null : await body(req);
      const items = read('items');
      const old = id && items.find(item => item.id === id);
      if (id && !old) return json(res, 404, { error: 'El elemento ya no está en la agenda.' });
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM items WHERE id = ?').run(id);
        return json(res, 200, { ok: true });
      }
      const item = itemFrom({ ...old, ...input }, old);
      if (timedKinds.includes(item.kind) && !item.done) {
        const conflict = items.find(other => other.id !== item.id && !other.done && timedKinds.includes(other.kind) && overlap(item, other));
        if (conflict) return json(res, 409, { error: 'No se puede agendar. El horario se cruza con «' + conflict.title + '».', conflict: conflict.title });
      }
      save('items', item.id, item);
      return json(res, id ? 200 : 201, item);
    }
    json(res, 404, { error: 'Ruta desconocida.' });
  } catch (error) {
    json(res, 400, { error: error instanceof SyntaxError ? 'El contenido no es válido.' : error.message });
  }
});

async function deliverNotice(notice, subscriptions = read('subscriptions')) {
  if (!db.prepare('SELECT 1 FROM notices WHERE id = ?').get(notice.id)) save('notices', notice.id, notice);
  await Promise.all(subscriptions.map(async sub => {
    const delivery = notice.id + '|' + sub.endpoint;
    if (db.prepare('SELECT 1 FROM deliveries WHERE id = ?').get(delivery)) return;
    try {
      await push.sendNotification(sub, JSON.stringify(notice), { TTL: 3600, timeout: 8000, proxy: process.env.HTTPS_PROXY || process.env.https_proxy });
      db.prepare('INSERT OR IGNORE INTO deliveries VALUES (?)').run(delivery);
    } catch (error) {
      if ([404,410].includes(error.statusCode)) db.prepare('DELETE FROM subscriptions WHERE id = ?').run(sub.endpoint);
      else console.warn('Entrega push pendiente:', error.statusCode || error.code || 'error de red');
    }
  }));
}
const reviews = new Map();
function reviewDocument(item) {
  if (reviews.has(item.id)) return reviews.get(item.id);
  const review = drive.read(item.link).then(async notes => {
    const current = read('items').find(other => other.id === item.id);
    if (!current || current.link !== item.link || current.notes !== item.notes) throw new Error('El documento cambió durante la revisión. Intenta de nuevo.');
    const updated = { ...current, notes, checkedAt:Date.now() };
    save('items',item.id,updated);
    const previous = new Set(documentSteps(current.notes));
    const added = documentSteps(notes).filter(step => !previous.has(step));
    if (added.length) {
      const id = 'drive:' + item.id + ':' + updated.checkedAt;
      await deliverNotice({ id, title:item.title, created:updated.checkedAt,
        message:added.length + (added.length === 1 ? ' pendiente nuevo en Drive. ' : ' pendientes nuevos en Drive. ') + added[0].slice(0,120) });
    }
    return updated;
  }).finally(() => reviews.delete(item.id));
  reviews.set(item.id,review);
  return review;
}
let lastDriveScan = 0;
function scanDrive() {
  if (!drive.status().connected || Date.now() - lastDriveScan < 15 * minute) return;
  lastDriveScan = Date.now();
  for (const item of read('items').filter(item => item.watchDrive && !item.done)) {
    reviewDocument(item).catch(error => console.warn('Revisión de Drive:', error.message));
  }
}

let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const now = Date.now();
    const subscriptions = read('subscriptions');
    for (const item of read('items')) {
      if (item.done || !item.start) continue;
      for (const at of slots(item, now - (item.kind === 'task' ? 8 : 1) * day, now + 7 * day)) {
        const offsets = new Set([item.reminder, 0, ...(item.kind === 'task' ? [-1440, -2880, -4320, -5760, -7200, -8640, -10080] : [])]);
        for (const offset of offsets) {
          const due = at - offset * minute;
          if (due > now || due < now - day / 2) continue;
          const id = [item.id, at, offset].join(':');
          const message = offset < 0 ? 'Esta tarea sigue pendiente. Revisa qué falta para terminarla.' :
            offset === 0 ? 'Es la hora que marcaste en tu agenda.' : 'Tienes un recordatorio próximo en tu agenda.';
          await deliverNotice({ id, title: item.title, message, created: due }, subscriptions);
        }
      }
    }
  } finally { scanning = false; }
}
const runScan = () => {
  scan().catch(error => console.error('Recordatorios:', error.message));
  scanDrive();
};
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
  console.log('Agenda en el puerto ' + server.address().port);
  if (!process.env.AGENDA_PASSWORD) console.log('Clave de acceso local: ' + password);
  runScan();
});
setInterval(runScan, 15000);
