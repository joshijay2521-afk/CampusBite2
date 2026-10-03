const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = __dirname;
const DATA = process.env.CAMPUSBITE_DATA_DIR || path.join(BASE, 'data');
const PUB = path.join(BASE, 'public');
const PORT = Number(process.env.PORT) || 3001;
const MAX_BODY = 4 * 1024 * 1024;
const SESSION_TTL = 8 * 60 * 60 * 1000;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '*').trim() || '*';
const PRODUCT_CACHE_TTL = 15 * 1000;
const SETTINGS_CACHE_TTL = 10 * 1000;
let productCache = null;
let settingsCache = null;

const files = {
  products: path.join(DATA, 'products.json'),
  orders: path.join(DATA, 'orders.json'),
  chats: path.join(DATA, 'chats.json'),
  settings: path.join(DATA, 'settings.json')
};

const BOOTSTRAP_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const BOOTSTRAP_ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '').trim();
const DEFAULT_SETTINGS = {
  admin: { username: BOOTSTRAP_ADMIN_USERNAME, password: BOOTSTRAP_ADMIN_PASSWORD },
  commerce: { deliveryEnabled: true, deliveryFee: 20, freeDeliveryThreshold: 199, coupons: [] },
  banner: {
    image: '', showText: true,
    eyebrow: '⚡ QUICK CAMPUS DELIVERY',
    title: 'Your cravings.\nCampus delivered.',
    subtitle: 'Biscuits, chips, chocolates, drinks & everyday student essentials — just a few taps away.',
    buttonText: 'Shop now →', imageVersion: ''
  }
};

const sessions = new Map();
let sql = null;

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function ensureLocalFiles() {
  fs.mkdirSync(DATA, { recursive: true });
  const defaults = { products: [], orders: [], chats: [], settings: DEFAULT_SETTINGS };
  for (const [key, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(defaults[key], null, 2));
  }
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!String(stored).startsWith('scrypt:')) return String(password) === String(stored);
  const [, salt, expected] = String(stored).split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function normalizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
  out.commerce = { ...DEFAULT_SETTINGS.commerce, ...(s?.commerce || {}) };
  out.commerce.deliveryEnabled = out.commerce.deliveryEnabled !== false;
  out.commerce.deliveryFee = Math.max(0, safeNumber(out.commerce.deliveryFee, 20, 100000));
  out.commerce.freeDeliveryThreshold = Math.max(0, safeNumber(out.commerce.freeDeliveryThreshold, 199, 10000000));
  out.commerce.coupons = Array.isArray(out.commerce.coupons) ? out.commerce.coupons : [];
  out.commerce.coupons = out.commerce.coupons.map(c => ({...c, code: String(c.code||'').trim().toUpperCase(), type: c.type === 'fixed' ? 'fixed' : 'percent', value: Math.max(0, safeNumber(c.value,0,1000000)), minOrder: Math.max(0,safeNumber(c.minOrder,0,10000000)), maxDiscount: Math.max(0,safeNumber(c.maxDiscount,0,10000000)), usageLimit: Math.max(0,Math.floor(safeNumber(c.usageLimit,0,10000000))), usedCount: Math.max(0,Math.floor(safeNumber(c.usedCount,0,10000000))), active: c.active !== false, expiresAt: c.expiresAt ? String(c.expiresAt) : ''})).filter(c=>c.code);
  out.banner = { ...DEFAULT_SETTINGS.banner, ...(s?.banner || {}) };
  if (out.banner.image && !out.banner.imageVersion) out.banner.imageVersion = crypto.createHash('sha1').update(String(out.banner.image)).digest('hex').slice(0, 16);
  out.admin = { ...DEFAULT_SETTINGS.admin, ...(s?.admin || {}) };
  if (out.admin.password && !String(out.admin.password).startsWith('scrypt:')) out.admin.password = hashPassword(out.admin.password);
  return out;
}

async function initStore() {
  if (!DATABASE_URL) {
    ensureLocalFiles();
    const raw = readJson(files.settings);
    const s = normalizeSettings(raw);
    if (BOOTSTRAP_ADMIN_USERNAME && BOOTSTRAP_ADMIN_PASSWORD && !s.admin?.bootstrapMigrated) {
      s.admin = { username: BOOTSTRAP_ADMIN_USERNAME, password: hashPassword(BOOTSTRAP_ADMIN_PASSWORD), bootstrapMigrated: true };
    }
    writeJson(files.settings, s);
    console.log('Storage: local JSON files');
    return;
  }
  try {
    const postgres = require('postgres');
    sql = postgres(DATABASE_URL, { prepare: false, max: 5, connect_timeout: 10 });
    await sql`
      CREATE TABLE IF NOT EXISTS cb_products (
        id text PRIMARY KEY,
        data jsonb NOT NULL
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS cb_orders (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS cb_chats (
        id text PRIMARY KEY,
        order_id text NOT NULL,
        data jsonb NOT NULL,
        at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS cb_settings (
        id integer PRIMARY KEY,
        data jsonb NOT NULL
      )`;
    await sql`CREATE INDEX IF NOT EXISTS cb_orders_phone_idx ON cb_orders ((regexp_replace(COALESCE(data->'customer'->>'phone',''), '[^0-9]', '', 'g')))`;
    await sql`CREATE INDEX IF NOT EXISTS cb_chats_order_id_idx ON cb_chats (order_id)`;
    await sql`CREATE INDEX IF NOT EXISTS cb_orders_created_at_idx ON cb_orders (created_at DESC)`;
    const [{ count: pc }] = await sql`SELECT count(*)::int AS count FROM cb_products`;
    if (pc === 0) {
      ensureLocalFiles();
      for (const p of readJson(files.products)) await sql`INSERT INTO cb_products (id,data) VALUES (${p.id},${sql.json(p)}) ON CONFLICT (id) DO NOTHING`;
    }
    const [{ count: oc }] = await sql`SELECT count(*)::int AS count FROM cb_orders`;
    if (oc === 0) {
      ensureLocalFiles();
      for (const o of readJson(files.orders)) await sql`INSERT INTO cb_orders (id,data,created_at) VALUES (${o.id},${sql.json(o)},${o.createdAt || new Date().toISOString()}) ON CONFLICT (id) DO NOTHING`;
    }
    const [{ count: cc }] = await sql`SELECT count(*)::int AS count FROM cb_chats`;
    if (cc === 0) {
      ensureLocalFiles();
      for (const c of readJson(files.chats)) await sql`INSERT INTO cb_chats (id,order_id,data,at) VALUES (${c.id},${c.orderId},${sql.json(c)},${c.at || new Date().toISOString()}) ON CONFLICT (id) DO NOTHING`;
    }
    const [{ count: sc }] = await sql`SELECT count(*)::int AS count FROM cb_settings`;
    if (sc === 0) {
      ensureLocalFiles();
      const s = normalizeSettings(readJson(files.settings));
      await sql`INSERT INTO cb_settings (id,data) VALUES (1,${sql.json(s)})`;
    } else {
      const rows = await sql`SELECT data FROM cb_settings WHERE id=1`;
      if (rows[0]) {
        const raw = rows[0].data || {};
        const s = normalizeSettings(raw);
        // One-time admin bootstrap from Render environment variables.
        // It does not overwrite later changes made in Admin -> Security.
        if (BOOTSTRAP_ADMIN_USERNAME && BOOTSTRAP_ADMIN_PASSWORD && !s.admin?.bootstrapMigrated) {
          s.admin = { username: BOOTSTRAP_ADMIN_USERNAME, password: hashPassword(BOOTSTRAP_ADMIN_PASSWORD), bootstrapMigrated: true };
          await sql`UPDATE cb_settings SET data=${sql.json(s)} WHERE id=1`;
        } else if (JSON.stringify(s) !== JSON.stringify(raw)) {
          await sql`UPDATE cb_settings SET data=${sql.json(s)} WHERE id=1`;
        }
      }
    }
    console.log('Storage: PostgreSQL database');
  } catch (e) {
    console.error('DATABASE_URL is set but PostgreSQL could not be initialized:', e.message);
    process.exit(1);
  }
}

async function getProducts(options = {}) {
  const fresh = options.fresh === true;
  if (!fresh && productCache && productCache.expiresAt > Date.now()) return clone(productCache.value);
  const products = !sql ? readJson(files.products) : (await sql`SELECT data FROM cb_products ORDER BY id`).map(r => r.data);
  productCache = { value: clone(products), expiresAt: Date.now() + PRODUCT_CACHE_TTL };
  return products;
}
async function saveProducts(products) {
  productCache = null;
  if (!sql) return writeJson(files.products, products);
  await sql.begin(async tx => {
    for (const p of products) await tx`INSERT INTO cb_products (id,data) VALUES (${p.id},${tx.json(p)}) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
  });
}
async function getOrders() {
  if (!sql) return readJson(files.orders);
  return (await sql`SELECT data FROM cb_orders ORDER BY created_at DESC`).map(r => r.data);
}
async function saveOrder(order) {
  if (!sql) {
    const orders = readJson(files.orders); const i = orders.findIndex(x => x.id === order.id);
    if (i >= 0) orders[i] = order; else orders.unshift(order);
    return writeJson(files.orders, orders);
  }
  await sql`INSERT INTO cb_orders (id,data,created_at) VALUES (${order.id},${sql.json(order)},${order.createdAt || new Date().toISOString()}) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}
async function getChats() {
  if (!sql) return readJson(files.chats);
  return (await sql`SELECT data FROM cb_chats ORDER BY at ASC`).map(r => r.data);
}
async function saveChat(message) {
  if (!sql) { const chats = readJson(files.chats); chats.push(message); return writeJson(files.chats, chats); }
  await sql`INSERT INTO cb_chats (id,order_id,data,at) VALUES (${message.id},${message.orderId},${sql.json(message)},${message.at})`;
}
async function getSettings(options = {}) {
  const fresh = options.fresh === true;
  if (!fresh && settingsCache && settingsCache.expiresAt > Date.now()) return clone(settingsCache.value);
  const settings = !sql ? normalizeSettings(readJson(files.settings)) : normalizeSettings((await sql`SELECT data FROM cb_settings WHERE id=1`)[0]?.data || DEFAULT_SETTINGS);
  settingsCache = { value: clone(settings), expiresAt: Date.now() + SETTINGS_CACHE_TTL };
  return settings;
}
function publicSettings(settings) {
  const out = clone(normalizeSettings(settings));
  delete out.admin;
  if (out.banner?.image) {
    out.banner.imageUrl = `/api/banner?v=${encodeURIComponent(out.banner.imageVersion || '')}`;
    delete out.banner.image;
  } else if (out.banner) {
    out.banner.imageUrl = '';
    delete out.banner.image;
  }
  return out;
}

async function getBannerAsset() {
  const s = await getSettings();
  const image = String(s.banner?.image || '');
  const match = image.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { type: match[1], body: Buffer.from(match[2], 'base64'), version: s.banner.imageVersion || '' };
}

async function saveSettings(settings) {
  settings = normalizeSettings(settings);
  settingsCache = null;
  if (!sql) return writeJson(files.settings, settings);
  await sql`INSERT INTO cb_settings (id,data) VALUES (1,${sql.json(settings)}) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`;
}

function cleanPhone(x) { return String(x || '').replace(/\D/g, ''); }
function nextOrderId(os) { const max = os.reduce((m, o) => Math.max(m, Number(String(o.id || '').replace(/\D/g, '')) || 1000), 1000); return 'CB-' + String(max + 1).padStart(4, '0'); }
async function nextOrderIdFromStore() {
  if (!sql) return nextOrderId(await getOrders());
  const rows = await sql`SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '[^0-9]', '', 'g'), '')::int), 1000) AS max_id FROM cb_orders`;
  return 'CB-' + String(Number(rows[0]?.max_id || 1000) + 1).padStart(4, '0');
}
function addTimeline(o, status, extra = {}) { const now = new Date().toISOString(); o.status = status; o.timeline = o.timeline || []; o.timeline.push({ status, at: now, ...extra }); o.updatedAt = now; if (status === 'Delivered') o.deliveredAt = now; if (status === 'Cancelled') o.cancelledAt = now; }
function tokenFrom(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }
function isAuthed(req) {
  const token = tokenFrom(req), exp = sessions.get(token);
  if (!token || !exp) return false;
  if (Date.now() > exp) { sessions.delete(token); return false; }
  sessions.set(token, Date.now() + SESSION_TTL);
  return true;
}
function clientIp(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim(); }
const loginAttempts = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now(); let a = loginAttempts.get(key) || [];
  a = a.filter(t => now - t < windowMs);
  if (a.length >= limit) return false;
  a.push(now); loginAttempts.set(key, a); return true;
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('Request is too large')); req.destroy(); return; } raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function staticFile(res, file) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': (path.extname(file) === '.html' ? 'no-cache' : 'public, max-age=86400, stale-while-revalidate=604800'), 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': CORS_ORIGIN });
  fs.createReadStream(file).pipe(res);
}
function safeText(x, max = 500) { return String(x ?? '').trim().slice(0, max); }
function safeNumber(x, min = 0, max = 1000000) { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }

function getCommerceCoupon(settings, code, subtotal) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return { coupon: null, discount: 0 };
  const item = (settings.commerce?.coupons || []).find(x => x.code === c);
  if (!item || !item.active) return { error: 'Coupon is invalid or inactive' };
  if (item.expiresAt && Date.now() > new Date(item.expiresAt).getTime()) return { error: 'Coupon has expired' };
  if (item.usageLimit > 0 && item.usedCount >= item.usageLimit) return { error: 'Coupon usage limit reached' };
  if (subtotal < item.minOrder) return { error: `Minimum order for this coupon is ₹${item.minOrder}` };
  let discount = item.type === 'percent' ? Math.round(subtotal * item.value / 100) : Math.round(item.value);
  if (item.maxDiscount > 0) discount = Math.min(discount, item.maxDiscount);
  discount = Math.min(Math.max(0, discount), subtotal);
  return { coupon: item, discount };
}

async function handle(req, res) {
  try {
    const u = new URL(req.url, 'http://localhost');
    const p = u.pathname, m = req.method;
    if (m === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '86400' }); return res.end(); }
    if (m === 'GET' && p === '/api/health') return json(res, 200, { ok: true, service: 'CampusBite', storage: sql ? 'postgres' : 'local-json', uptimeSeconds: Math.floor(process.uptime()), node: process.version });

    if (m === 'GET' && p === '/api/products') {
      const q = (u.searchParams.get('q') || '').trim().toLowerCase();
      let products = (await getProducts()).filter(x => x.active && x.stock > 0);
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        products = products.filter(x => terms.every(t => `${x.name} ${x.category} ${x.unit || ''}`.toLowerCase().includes(t)));
      }
      return json(res, 200, products);
    }
    if (m === 'GET' && p === '/api/settings') return json(res, 200, publicSettings(await getSettings()));
    if (m === 'GET' && p === '/api/banner') { const asset = await getBannerAsset(); if (!asset) return json(res, 404, { error: 'Banner image not configured' }); res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', 'ETag': `"${asset.version}"`, 'Access-Control-Allow-Origin': CORS_ORIGIN }); return res.end(asset.body); }
    if (m === 'POST' && p === '/api/coupons/validate') { const b=await readBody(req), s=await getSettings(), subtotal=Math.max(0,safeNumber(b.subtotal,0,10000000)), r=getCommerceCoupon(s,b.code,subtotal); return r.error ? json(res,400,{error:r.error}) : json(res,200,{code:r.coupon.code,discount:r.discount,type:r.coupon.type,value:r.coupon.value}); }

    if (m === 'POST' && p === '/api/admin/login') {
      if (!rateLimit('login:' + clientIp(req), 8, 10 * 60 * 1000)) return json(res, 429, { error: 'Too many login attempts. Please try again later.' });
      const b = await readBody(req), s = await getSettings(), a = s.admin || DEFAULT_SETTINGS.admin;
      const enteredUser = safeText(b.username, 100);
      const enteredPass = String(b.password || '');
      let valid = enteredUser === a.username && verifyPassword(enteredPass, a.password);
      // One-time recovery: if bootstrapMigrated is false, Render credentials can
      // safely repair the existing Supabase admin record. After syncing, the
      // database hash becomes the normal source of truth again.
      if (!valid && BOOTSTRAP_ADMIN_PASSWORD && enteredUser === BOOTSTRAP_ADMIN_USERNAME &&
          enteredPass === BOOTSTRAP_ADMIN_PASSWORD && !a.bootstrapMigrated) {
        s.admin = { username: BOOTSTRAP_ADMIN_USERNAME, password: hashPassword(BOOTSTRAP_ADMIN_PASSWORD), bootstrapMigrated: true };
        await saveSettings(s);
        valid = true;
      }
      if (valid) {
        loginAttempts.delete('login:' + clientIp(req));
        const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, Date.now() + SESSION_TTL); return json(res, 200, { token: t, expiresIn: SESSION_TTL });
      }
      return json(res, 401, { error: 'Wrong username or password' });
    }

    if (m === 'GET' && p === '/api/admin/orders') { if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' }); return json(res, 200, { orders: await getOrders() }); }
    if (m === 'GET' && p === '/api/admin/products') { if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' }); return json(res, 200, { products: await getProducts() }); }

    if (m === 'GET' && p === '/api/orders/history') {
      const phone = cleanPhone(u.searchParams.get('phone')); if (phone.length < 10) return json(res, 400, { error: 'Enter the mobile number used for the order' });
      const rows = sql ? await sql`SELECT data FROM cb_orders WHERE regexp_replace(COALESCE(data->'customer'->>'phone',''), '[^0-9]', '', 'g') = ${phone} ORDER BY created_at DESC` : (await getOrders()).filter(x => cleanPhone(x.customer?.phone) === phone).map(x => ({ data: x }));
      const orders = rows.map(r => { const x = r.data; return { ...x, customer: { ...x.customer, phone: '******' + cleanPhone(x.customer?.phone).slice(-4) } }; });
      return json(res, 200, { orders });
    }
    if (m === 'GET' && p === '/api/orders/track') {
      const id = safeText(u.searchParams.get('id'), 40), phone = cleanPhone(u.searchParams.get('phone'));
      const rows = sql ? await sql`SELECT data FROM cb_orders WHERE id=${id} AND regexp_replace(COALESCE(data->'customer'->>'phone',''), '[^0-9]', '', 'g') = ${phone} LIMIT 1` : [];
      const o = sql ? rows[0]?.data : (await getOrders()).find(x => x.id === id && cleanPhone(x.customer?.phone) === phone);
      return o ? json(res, 200, { order: o }) : json(res, 404, { error: 'Order not found' });
    }

    if (m === 'POST' && p === '/api/orders') {
      if (!rateLimit('order:' + clientIp(req), 20, 10 * 60 * 1000)) return json(res, 429, { error: 'Too many requests. Please try again later.' });
      const b = await readBody(req), ps = await getProducts({fresh:true}), os = sql ? null : await getOrders();
      if (!b.customer?.name || !b.customer?.phone || !b.customer?.location || !Array.isArray(b.items) || !b.items.length) return json(res, 400, { error: 'Please fill all required details' });
      const phone = cleanPhone(b.customer.phone); if (phone.length < 10 || phone.length > 15) return json(res, 400, { error: 'Enter a valid mobile number' });
      const items = []; let sub = 0;
      for (const x of b.items) {
        const prod = ps.find(z => z.id === x.productId && z.active);
        const n = Math.floor(safeNumber(x.qty, 1, 100));
        if (!prod || n > prod.stock) return json(res, 400, { error: 'Product unavailable or insufficient stock' });
        items.push({ productId: prod.id, name: safeText(prod.name, 150), price: safeNumber(prod.price), qty: n, emoji: safeText(prod.emoji, 10) });
        sub += safeNumber(prod.price) * n;
      }
      const settings = await getSettings();
      const couponResult = getCommerceCoupon(settings, b.coupon, sub);
      if (couponResult.error) return json(res, 400, { error: couponResult.error });
      const freeDelivery = settings.commerce.deliveryEnabled && settings.commerce.freeDeliveryThreshold > 0 && sub >= settings.commerce.freeDeliveryThreshold;
      const delivery = settings.commerce.deliveryEnabled && !freeDelivery ? settings.commerce.deliveryFee : 0;
      const discount = couponResult.discount || 0;
      for (const item of items) {
        const prod = ps.find(z => z.id === item.productId);
        if (prod) prod.stock -= item.qty;
      }
      const total = Math.max(0, sub + delivery - discount), id = await nextOrderIdFromStore(), now = new Date(), eta = new Date(now.getTime() + 30 * 60000).toISOString();
      if (couponResult.coupon) { const used = settings.commerce.coupons.find(x => x.code === couponResult.coupon.code); if (used) used.usedCount = (used.usedCount || 0) + 1; }
      const o = { id, createdAt: now.toISOString(), updatedAt: now.toISOString(), estimatedDeliveryAt: eta, status: 'New', payment: 'Cash on Delivery', customer: { name: safeText(b.customer.name, 100), phone: safeText(b.customer.phone, 20), location: safeText(b.customer.location, 200) }, items, subtotal: sub, delivery, coupon: couponResult.coupon?.code || '', discount, total, note: safeText(b.note, 500), timeline: [{ status: 'New', at: now.toISOString() }] };
      await saveProducts(ps); await saveSettings(settings); await saveOrder(o); return json(res, 201, { order: o });
    }

    if (m === 'GET' && p === '/api/chat') {
      const id = safeText(u.searchParams.get('orderId'), 40), phone = cleanPhone(u.searchParams.get('phone'));
      const o = sql ? (await sql`SELECT data FROM cb_orders WHERE id=${id} AND regexp_replace(COALESCE(data->'customer'->>'phone',''), '[^0-9]', '', 'g') = ${phone} LIMIT 1`)[0]?.data : (await getOrders()).find(x => x.id === id && cleanPhone(x.customer?.phone) === phone); if (!o) return json(res, 404, { error: 'Order not found' });
      const messages = sql ? (await sql`SELECT data FROM cb_chats WHERE order_id=${id} ORDER BY at ASC`).map(r => r.data) : (await getChats()).filter(x => x.orderId === id);
      return json(res, 200, { orderId: id, messages });
    }
    if (m === 'POST' && p === '/api/chat') {
      const b = await readBody(req), id = safeText(b.orderId, 40), phone = cleanPhone(b.phone), text = safeText(b.text, 1000);
      const o = (await getOrders()).find(x => x.id === id && cleanPhone(x.customer?.phone) === phone); if (!o) return json(res, 404, { error: 'Order not found' });
      if (!text) return json(res, 400, { error: 'Message is empty' });
      const msg = { id: 'm' + Date.now() + crypto.randomBytes(4).toString('hex'), orderId: id, sender: 'user', text, at: new Date().toISOString() }; await saveChat(msg); return json(res, 201, { message: msg });
    }
    if (m === 'GET' && p === '/api/admin/chats') {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const orders = await getOrders(), msgs = await getChats();
      const chats = orders.map(o => { const messages = msgs.filter(x => x.orderId === o.id); return { orderId: o.id, customer: o.customer, status: o.status, lastMessage: messages[messages.length - 1] || null, messages }; }).filter(x => x.messages.length);
      return json(res, 200, { chats });
    }
    if (m === 'POST' && p.startsWith('/api/admin/chats/')) {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const id = safeText(p.split('/').pop(), 40), b = await readBody(req), text = safeText(b.text, 1000); if (!text) return json(res, 400, { error: 'Message is empty' });
      const o = (await getOrders()).find(x => x.id === id); if (!o) return json(res, 404, { error: 'Order not found' });
      const msg = { id: 'm' + Date.now() + crypto.randomBytes(4).toString('hex'), orderId: id, sender: 'admin', text, at: new Date().toISOString() }; await saveChat(msg); return json(res, 201, { message: msg });
    }
    if (m === 'DELETE' && p.startsWith('/api/admin/orders/')) {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const id = safeText(p.split('/').pop(), 40);
      if (!id) return json(res, 400, { error: 'Order id is required' });
      const existingOrders = await getOrders();
      const existingOrder = existingOrders.find(x => x.id === id);
      if (!existingOrder) return json(res, 404, { error: 'Order not found' });
      if (!['Delivered', 'Cancelled'].includes(existingOrder.status)) return json(res, 400, { error: 'Only Delivered or Cancelled orders can be permanently deleted' });
      if (!sql) {
        const orders = readJson(files.orders);
        const next = orders.filter(x => x.id !== id);
        if (next.length === orders.length) return json(res, 404, { error: 'Order not found' });
        writeJson(files.orders, next);
        return json(res, 200, { deleted: true, id });
      }
      const deleted = await sql`DELETE FROM cb_orders WHERE id=${id} RETURNING id`;
      if (!deleted.length) return json(res, 404, { error: 'Order not found' });
      return json(res, 200, { deleted: true, id });
    }
    if (m === 'PATCH' && p.startsWith('/api/admin/orders/')) {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const b = await readBody(req), id = safeText(p.split('/').pop(), 40), os = await getOrders(), o = os.find(x => x.id === id); if (!o) return json(res, 404, { error: 'Order not found' });
      const allowed = ['New', 'Confirmed', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled']; if (b.status && allowed.includes(b.status) && b.status !== o.status) addTimeline(o, b.status); await saveOrder(o); return json(res, 200, { order: o });
    }
    if (m === 'PATCH' && p === '/api/admin/settings') {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const b = await readBody(req), s = await getSettings();
      if (b.commerce) {
        const c = b.commerce;
        if (c.deliveryEnabled !== undefined) s.commerce.deliveryEnabled = !!c.deliveryEnabled;
        if (c.deliveryFee !== undefined) s.commerce.deliveryFee = safeNumber(c.deliveryFee, 0, 100000);
        if (c.freeDeliveryThreshold !== undefined) s.commerce.freeDeliveryThreshold = safeNumber(c.freeDeliveryThreshold, 0, 10000000);
        if (Array.isArray(c.coupons)) {
          const existing = new Map((s.commerce.coupons || []).map(x => [x.code, x]));
          s.commerce.coupons = c.coupons.map(x => ({...x, code: safeText(x.code,40).toUpperCase(), type: x.type === 'fixed' ? 'fixed' : 'percent', value: safeNumber(x.value,0,1000000), minOrder: safeNumber(x.minOrder,0,10000000), maxDiscount: safeNumber(x.maxDiscount,0,10000000), usageLimit: Math.floor(safeNumber(x.usageLimit,0,10000000)), usedCount: Math.floor(safeNumber(existing.get(String(x.code||'').toUpperCase())?.usedCount || x.usedCount,0,10000000)), active: x.active !== false, expiresAt: safeText(x.expiresAt || '',40)})).filter(x=>x.code && x.value > 0);
        }
      }
      if (b.banner) { s.banner = { ...s.banner, ...b.banner }; if (b.banner.image !== undefined) s.banner.imageVersion = crypto.createHash('sha1').update(String(s.banner.image || '')).digest('hex').slice(0, 16); for (const k of ['image', 'eyebrow', 'title', 'subtitle', 'buttonText']) if (s.banner[k] !== undefined) s.banner[k] = safeText(s.banner[k], k === 'image' ? 2200000 : 5000); if (s.banner.showText !== undefined) s.banner.showText = !!s.banner.showText; }
      if (b.admin) {
        const current = s.admin || DEFAULT_SETTINGS.admin;
        if (safeText(b.admin.currentUsername, 100) !== current.username || !verifyPassword(String(b.admin.currentPassword || ''), current.password)) return json(res, 400, { error: 'Current admin username or password is incorrect' });
        const nu = safeText(b.admin.username, 100), np = String(b.admin.password || ''); if (nu.length < 3 || np.length < 6) return json(res, 400, { error: 'New username must be 3+ characters and password 6+ characters' });
        s.admin = { username: nu, password: hashPassword(np) }; await saveSettings(s); sessions.clear(); return json(res, 200, { changed: true });
      }
      await saveSettings(s); return json(res, 200, s);
    }
    if (m === 'DELETE' && p.startsWith('/api/admin/products/')) {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const id = safeText(p.split('/').pop(), 80);
      if (!id) return json(res, 400, { error: 'Product id is required' });
      if (!sql) {
        const products = readJson(files.products);
        const next = products.filter(x => x.id !== id);
        if (next.length === products.length) return json(res, 404, { error: 'Product not found' });
        writeJson(files.products, next); productCache = null;
        return json(res, 200, { deleted: true, id });
      }
      const deleted = await sql`DELETE FROM cb_products WHERE id=${id} RETURNING id`;
      if (!deleted.length) return json(res, 404, { error: 'Product not found' });
      productCache = null;
      return json(res, 200, { deleted: true, id });
    }
    if (m === 'PATCH' && p.startsWith('/api/admin/products/')) {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const b = await readBody(req), ps = await getProducts(), x = ps.find(z => z.id === p.split('/').pop()); if (!x) return json(res, 404, { error: 'Product not found' });
      for (const k of ['name', 'category', 'emoji', 'unit', 'image']) if (b[k] !== undefined) x[k] = safeText(b[k], k === 'image' ? 1800000 : 300);
      if (b.price !== undefined) x.price = safeNumber(b.price, 0, 1000000);
      if (b.mrp !== undefined) x.mrp = Math.max(x.price, safeNumber(b.mrp, 0, 1000000));
      if (b.stock !== undefined) x.stock = Math.floor(safeNumber(b.stock, 0, 100000));
      if (b.active !== undefined) x.active = !!b.active;
      await saveProducts(ps); return json(res, 200, { product: x });
    }
    if (m === 'POST' && p === '/api/admin/products') {
      if (!isAuthed(req)) return json(res, 401, { error: 'Unauthorized' });
      const b = await readBody(req), ps = await getProducts(), price = safeNumber(b.price, 0, 1000000);
      const x = { id: 'p' + Date.now(), name: safeText(b.name, 150), category: safeText(b.category || 'Other', 80), price, mrp: safeNumber(b.mrp || price, 0, 1000000), stock: Math.floor(safeNumber(b.stock, 0, 100000)), unit: safeText(b.unit || '1 pack', 80), emoji: safeText(b.emoji || '🛍️', 10), image: safeText(b.image || '', 1800000), active: true };
      if (!x.name) return json(res, 400, { error: 'Product name is required' }); ps.push(x); await saveProducts(ps); return json(res, 201, { product: x });
    }

    const requested = p === '/' || p === '/index.html' ? 'index.html' : (p === '/admin.html' || p === '/admin' ? 'admin.html' : p.replace(/^\/+/, ''));
    const file = path.resolve(PUB, requested), root = path.resolve(PUB);
    if (!file.startsWith(root + path.sep)) return json(res, 404, { error: 'Not found' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return staticFile(res, file);
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'Server error. Please try again.' });
  }
}

(async () => {
  await initStore();
  const server = http.createServer(handle);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  server.on('clientError', (_, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} });
  server.listen(PORT, '0.0.0.0', () => console.log(`CampusBite running on 0.0.0.0:${PORT}`));
})();
