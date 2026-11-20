'use strict';
process.env.TZ = process.env.TZ || 'Asia/Bangkok';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const express = require('express');
const QRCode = require('qrcode');
const { db, q, tx, nowLocal, localDate, r2, r3, getSettings, DEFAULT_SETTINGS } = require('./db');
const { promptPayPayload, normalizeTarget } = require('./promptpay');

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- validation helpers ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function fail(message, status = 400) {
  throw new HttpError(status, message);
}
function num(v, label = 'ตัวเลข') {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (v === '' || v == null || !Number.isFinite(n)) fail(`${label}ไม่ถูกต้อง`);
  return n;
}
function optNum(v, label) {
  return v === '' || v == null ? null : num(v, label);
}
function int(v, label = 'รหัส') {
  const n = Number(v);
  if (!Number.isInteger(n)) fail(`${label}ไม่ถูกต้อง`);
  return n;
}
function str(v, max = 200) {
  return v == null ? '' : String(v).trim().slice(0, max);
}
function reqStr(v, label, max = 100) {
  const s = str(v, max);
  if (!s) fail(`กรุณากรอก${label}`);
  return s;
}
function dateParam(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
const todayLocal = () => localDate();
const body = (req) => req.body || {};

// ---------- กันเว็บไซต์อื่นสั่งแก้ข้อมูลผ่านเบราว์เซอร์ของเครื่องในร้าน (CSRF) ----------
// เบราว์เซอร์แนบ Origin มากับทุก request ที่ไม่ใช่ GET/HEAD: ถ้ามาจากหน้าอื่นที่ไม่ใช่ระบบนี้ให้ปฏิเสธ
function originHost(origin) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null; // เช่น Origin: null จาก iframe แบบ sandbox
  }
}
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (origin && originHost(origin) !== String(req.get('host')).toLowerCase()) fail('ไม่อนุญาตคำสั่งจากเว็บไซต์อื่น', 403);
  next();
});

// ---------- real-time updates (Server-Sent Events) ----------
const clients = new Set();
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});
function broadcast(...topics) {
  const msg = `data: ${JSON.stringify(topics)}\n\n`;
  for (const c of clients) c.write(msg);
}

// ---------- shared queries ----------
const listTables = () => q('SELECT id, name, sort FROM dining_tables WHERE active = 1 ORDER BY sort, id').all();
const listCategories = () => q('SELECT id, name, sort FROM categories ORDER BY sort, id').all();
const listMenu = () =>
  q(
    `SELECT m.id, m.name, m.price, m.category_id, m.available, m.sort FROM menu_items m
     LEFT JOIN categories c ON c.id = m.category_id
     WHERE m.deleted = 0 ORDER BY c.sort IS NULL, c.sort, c.id, m.sort, m.id`
  ).all();
const lowStockCount = () =>
  q('SELECT COUNT(*) AS n FROM ingredients WHERE deleted = 0 AND quantity <= min_quantity').get().n;

function lanUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}`);
  }
  return urls;
}

function sumItems(orderId) {
  return q(
    `SELECT COALESCE(SUM(price * qty), 0) AS subtotal, COALESCE(SUM(qty), 0) AS item_count
     FROM order_items WHERE order_id = ? AND status = 'active'`
  ).get(orderId);
}
function refreshTotals(orderId) {
  const o = q('SELECT discount FROM orders WHERE id = ?').get(orderId);
  const subtotal = r2(sumItems(orderId).subtotal);
  const discount = Math.min(o.discount || 0, subtotal);
  q('UPDATE orders SET subtotal = ?, discount = ?, total = ? WHERE id = ?').run(subtotal, discount, r2(subtotal - discount), orderId);
}
function getOrder(id) {
  const order = q('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) fail('ไม่พบออเดอร์', 404);
  order.items = q('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id);
  return order;
}
function createOrder({ type, table = null, customerName = '' }) {
  const now = nowLocal();
  const no = q('SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM orders WHERE substr(created_at, 1, 10) = ?').get(now.slice(0, 10)).n;
  const id = q(
    `INSERT INTO orders (order_no, type, table_id, table_name, customer_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`
  ).run(no, type, table ? table.id : null, table ? table.name : null, customerName, now).lastInsertRowid;
  return q('SELECT * FROM orders WHERE id = ?').get(id);
}

const TICKET_SELECT = `
  SELECT k.*, o.order_no, o.type, o.table_name, o.customer_name, o.status AS order_status,
    (SELECT COUNT(*) FROM kitchen_tickets k2 WHERE k2.order_id = k.order_id AND k2.id < k.id) AS prior_tickets
  FROM kitchen_tickets k JOIN orders o ON o.id = k.order_id`;
function attachTicketItems(tickets) {
  if (!tickets.length) return tickets;
  const ids = tickets.map((t) => t.id);
  const items = db
    .prepare(`SELECT * FROM order_items WHERE ticket_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(...ids);
  for (const t of tickets) t.items = items.filter((i) => i.ticket_id === t.id);
  return tickets;
}
function getTicket(id) {
  const t = q(`${TICKET_SELECT} WHERE k.id = ?`).get(id);
  if (!t) fail('ไม่พบใบสั่งครัว', 404);
  return attachTicketItems([t])[0];
}

// ---------- bootstrap & settings ----------
app.get('/api/bootstrap', (req, res) => {
  res.json({
    settings: getSettings(),
    tables: listTables(),
    categories: listCategories(),
    menu: listMenu(),
    lowStock: lowStockCount(),
    lanUrls: lanUrls(),
  });
});

app.get('/api/settings', (req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => {
  const b = body(req);
  tx(() => {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (!(key in b)) continue;
      const value = str(b[key], 500);
      if (key === 'promptpay_id' && value && !normalizeTarget(value)) {
        fail('หมายเลขพร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก หรือเลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก');
      }
      if (key === 'paper_width' && !['58', '80'].includes(value)) fail('ขนาดกระดาษไม่ถูกต้อง');
      q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    }
  });
  broadcast('settings');
  res.json(getSettings());
});

// ---------- tables ----------
app.get('/api/tables', (req, res) => res.json(listTables()));
app.post('/api/tables', (req, res) => {
  const b = body(req);
  const count = Math.min(Math.max(Number(b.count) || 1, 1), 50);
  tx(() => {
    let sort = q('SELECT COALESCE(MAX(sort), 0) AS m FROM dining_tables').get().m;
    if (count === 1) {
      q('INSERT INTO dining_tables (name, sort) VALUES (?, ?)').run(reqStr(b.name, 'ชื่อโต๊ะ', 40), ++sort);
    } else {
      const prefix = str(b.prefix, 30) || 'โต๊ะ';
      const start = Number(b.start) || 1;
      for (let i = 0; i < count; i++) q('INSERT INTO dining_tables (name, sort) VALUES (?, ?)').run(`${prefix} ${start + i}`, ++sort);
    }
  });
  broadcast('tables');
  res.json(listTables());
});
app.put('/api/tables/:id', (req, res) => {
  const id = int(req.params.id);
  const name = reqStr(body(req).name, 'ชื่อโต๊ะ', 40);
  q('UPDATE dining_tables SET name = ? WHERE id = ?').run(name, id);
  q("UPDATE orders SET table_name = ? WHERE table_id = ? AND status = 'open'").run(name, id);
  broadcast('tables', 'orders');
  res.json(listTables());
});
app.delete('/api/tables/:id', (req, res) => {
  const id = int(req.params.id);
  if (q("SELECT 1 FROM orders WHERE table_id = ? AND status = 'open'").get(id)) fail('โต๊ะนี้ยังมีออเดอร์ค้างอยู่');
  q('UPDATE dining_tables SET active = 0 WHERE id = ?').run(id);
  broadcast('tables');
  res.json(listTables());
});

// ---------- categories & menu ----------
app.get('/api/categories', (req, res) => res.json(listCategories()));
app.post('/api/categories', (req, res) => {
  const name = reqStr(body(req).name, 'ชื่อหมวดหมู่', 60);
  const sort = q('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM categories').get().s;
  q('INSERT INTO categories (name, sort) VALUES (?, ?)').run(name, sort);
  broadcast('menu');
  res.json(listCategories());
});
app.put('/api/categories/:id', (req, res) => {
  q('UPDATE categories SET name = ? WHERE id = ?').run(reqStr(body(req).name, 'ชื่อหมวดหมู่', 60), int(req.params.id));
  broadcast('menu');
  res.json(listCategories());
});
app.post('/api/categories/reorder', (req, res) => {
  const ids = Array.isArray(body(req).ids) ? body(req).ids : [];
  tx(() => ids.forEach((id, i) => q('UPDATE categories SET sort = ? WHERE id = ?').run(i + 1, int(id))));
  broadcast('menu');
  res.json(listCategories());
});
app.delete('/api/categories/:id', (req, res) => {
  q('DELETE FROM categories WHERE id = ?').run(int(req.params.id));
  broadcast('menu');
  res.json(listCategories());
});

function menuInput(b) {
  const name = reqStr(b.name, 'ชื่อเมนู', 80);
  const price = r2(num(b.price, 'ราคา'));
  if (price < 0) fail('ราคาต้องไม่ติดลบ');
  const categoryId = b.category_id === '' || b.category_id == null ? null : int(b.category_id, 'หมวดหมู่');
  return { name, price, categoryId };
}
app.get('/api/menu', (req, res) => res.json(listMenu()));
app.post('/api/menu', (req, res) => {
  const { name, price, categoryId } = menuInput(body(req));
  const sort = q('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM menu_items WHERE category_id IS ?').get(categoryId).s;
  const id = q('INSERT INTO menu_items (name, price, category_id, sort, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, price, categoryId, sort, nowLocal()).lastInsertRowid;
  broadcast('menu');
  res.json(q('SELECT * FROM menu_items WHERE id = ?').get(id));
});
app.put('/api/menu/:id', (req, res) => {
  const id = int(req.params.id);
  const { name, price, categoryId } = menuInput(body(req));
  q('UPDATE menu_items SET name = ?, price = ?, category_id = ? WHERE id = ? AND deleted = 0').run(name, price, categoryId, id);
  broadcast('menu');
  res.json(q('SELECT * FROM menu_items WHERE id = ?').get(id));
});
app.patch('/api/menu/:id/available', (req, res) => {
  const id = int(req.params.id);
  q('UPDATE menu_items SET available = ? WHERE id = ?').run(body(req).available ? 1 : 0, id);
  broadcast('menu');
  res.json(q('SELECT * FROM menu_items WHERE id = ?').get(id));
});
app.delete('/api/menu/:id', (req, res) => {
  q('UPDATE menu_items SET deleted = 1 WHERE id = ?').run(int(req.params.id));
  broadcast('menu');
  res.json({ ok: true });
});

// ---------- POS / orders ----------
app.get('/api/pos/overview', (req, res) => {
  const orders = q(
    `SELECT o.id, o.order_no, o.type, o.table_id, o.table_name, o.customer_name, o.created_at, o.total,
       (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id AND i.status = 'active') AS item_count,
       (SELECT COUNT(*) FROM kitchen_tickets k WHERE k.order_id = o.id AND k.status = 'new') AS cooking
     FROM orders o WHERE o.status = 'open' ORDER BY o.id`
  ).all();
  const tables = listTables().map((t) => ({
    ...t,
    order: orders.find((o) => o.type === 'dine_in' && o.table_id === t.id) || null,
  }));
  res.json({ tables, takeaways: orders.filter((o) => o.type === 'takeaway'), lowStock: lowStockCount() });
});

app.get('/api/pos/table/:id', (req, res) => {
  const table = q('SELECT id, name FROM dining_tables WHERE id = ? AND active = 1').get(int(req.params.id));
  if (!table) fail('ไม่พบโต๊ะ', 404);
  const open = q("SELECT id FROM orders WHERE status = 'open' AND type = 'dine_in' AND table_id = ?").get(table.id);
  res.json({ table, order: open ? getOrder(open.id) : null });
});

app.get('/api/orders/:id', (req, res) => res.json(getOrder(int(req.params.id))));

// รายการบิลของวัน (ชำระแล้ว/ยกเลิก)
app.get('/api/orders', (req, res) => {
  const date = dateParam(req.query.date) || todayLocal();
  const rows = q(
    `SELECT o.*, (SELECT COALESCE(SUM(qty), 0) FROM order_items i WHERE i.order_id = o.id AND i.status = 'active') AS item_count
     FROM orders o
     WHERE (o.status = 'paid' AND o.biz_date = ?)
        OR (o.status = 'cancelled' AND substr(COALESCE(o.paid_at, o.created_at), 1, 10) = ?)
     ORDER BY COALESCE(o.paid_at, o.cancelled_at, o.created_at) DESC`
  ).all(date, date);
  res.json(rows);
});

// สร้างออเดอร์ (ถ้ายังไม่มี) + เพิ่มรายการ + ส่งเข้าครัวในครั้งเดียว
app.post('/api/orders/send', (req, res) => {
  const b = body(req);
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) fail('ยังไม่มีรายการอาหาร');
  const result = tx(() => {
    let order;
    if (b.order_id) {
      order = q('SELECT * FROM orders WHERE id = ?').get(int(b.order_id));
      if (!order) fail('ไม่พบออเดอร์', 404);
      if (order.status !== 'open') fail('ออเดอร์นี้ปิดไปแล้ว');
    } else if (b.type === 'dine_in') {
      const table = q('SELECT id, name FROM dining_tables WHERE id = ? AND active = 1').get(int(b.table_id, 'โต๊ะ'));
      if (!table) fail('ไม่พบโต๊ะ');
      order =
        q("SELECT * FROM orders WHERE status = 'open' AND type = 'dine_in' AND table_id = ?").get(table.id) ||
        createOrder({ type: 'dine_in', table });
    } else if (b.type === 'takeaway') {
      order = createOrder({ type: 'takeaway', customerName: str(b.customer_name, 60) });
    } else {
      fail('ประเภทออเดอร์ไม่ถูกต้อง');
    }
    const now = nowLocal();
    const ticketId = q("INSERT INTO kitchen_tickets (order_id, status, created_at) VALUES (?, 'new', ?)").run(order.id, now).lastInsertRowid;
    for (const it of items) {
      const m = q('SELECT * FROM menu_items WHERE id = ? AND deleted = 0').get(int(it.menu_item_id, 'เมนู'));
      if (!m) fail('ไม่พบเมนูบางรายการ (อาจถูกลบไปแล้ว)');
      if (!m.available) fail(`"${m.name}" หมดแล้ว`);
      const qty = int(it.qty, 'จำนวน');
      if (qty < 1 || qty > 999) fail('จำนวนไม่ถูกต้อง');
      q(
        `INSERT INTO order_items (order_id, menu_item_id, name, price, qty, note, ticket_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`
      ).run(order.id, m.id, m.name, m.price, qty, str(it.note, 200), ticketId, now);
    }
    refreshTotals(order.id);
    return { orderId: order.id, ticketId };
  });
  broadcast('orders', 'kitchen');
  res.json({ order: getOrder(result.orderId), ticket: getTicket(result.ticketId) });
});

app.put('/api/orders/:id', (req, res) => {
  const id = int(req.params.id);
  const o = getOrder(id);
  if (o.status !== 'open') fail('ออเดอร์นี้ปิดไปแล้ว');
  q('UPDATE orders SET customer_name = ? WHERE id = ?').run(str(body(req).customer_name, 60), id);
  broadcast('orders');
  res.json(getOrder(id));
});

app.post('/api/orders/:id/move', (req, res) => {
  const id = int(req.params.id);
  tx(() => {
    const o = getOrder(id);
    if (o.status !== 'open') fail('ออเดอร์นี้ปิดไปแล้ว');
    const table = q('SELECT id, name FROM dining_tables WHERE id = ? AND active = 1').get(int(body(req).table_id, 'โต๊ะ'));
    if (!table) fail('ไม่พบโต๊ะ');
    if (q("SELECT 1 FROM orders WHERE status = 'open' AND type = 'dine_in' AND table_id = ? AND id <> ?").get(table.id, id)) {
      fail(`${table.name} มีลูกค้าอยู่แล้ว`);
    }
    q("UPDATE orders SET type = 'dine_in', table_id = ?, table_name = ? WHERE id = ?").run(table.id, table.name, id);
  });
  broadcast('orders', 'kitchen');
  res.json(getOrder(id));
});

app.post('/api/orders/:id/pay', (req, res) => {
  const id = int(req.params.id);
  const b = body(req);
  tx(() => {
    const o = q('SELECT * FROM orders WHERE id = ?').get(id);
    if (!o) fail('ไม่พบออเดอร์', 404);
    if (o.status !== 'open') fail('ออเดอร์นี้ชำระเงินหรือยกเลิกไปแล้ว');
    const { subtotal, item_count } = sumItems(id);
    if (item_count <= 0) fail('ออเดอร์นี้ยังไม่มีรายการ');
    const sub = r2(subtotal);
    const discount = r2(Math.min(Math.max(optNum(b.discount, 'ส่วนลด') || 0, 0), sub));
    const total = r2(sub - discount);
    if (!['cash', 'promptpay'].includes(b.method)) fail('วิธีชำระเงินไม่ถูกต้อง');
    let received = null;
    let change = null;
    if (b.method === 'cash') {
      received = optNum(b.cash_received, 'จำนวนเงินที่รับ');
      received = received == null ? total : r2(received);
      if (received < total) fail('รับเงินมาไม่พอ');
      change = r2(received - total);
    }
    const now = nowLocal();
    q(
      `UPDATE orders SET status = 'paid', subtotal = ?, discount = ?, total = ?, payment_method = ?,
         cash_received = ?, change_amount = ?, paid_at = ?, biz_date = ? WHERE id = ?`
    ).run(sub, discount, total, b.method, received, change, now, now.slice(0, 10), id);
  });
  broadcast('orders', 'sales');
  res.json(getOrder(id));
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const id = int(req.params.id);
  const b = body(req);
  const o = getOrder(id);
  if (o.status === 'cancelled') fail('ออเดอร์นี้ถูกยกเลิกไปแล้ว');
  // บิลที่รับเงินแล้วยกเลิกได้เฉพาะเมื่อขอมาโดยตั้งใจ (ปุ่ม "ยกเลิกบิล" หน้ารายรับรายจ่าย)
  // กันหน้าขายที่ข้อมูลยังไม่อัปเดตไปยกเลิกบิลที่อีกเครื่องเพิ่งรับเงิน
  if (o.status === 'paid' && !b.void_paid) fail('ออเดอร์นี้ชำระเงินแล้ว — ถ้าต้องการยกเลิกบิล ให้ทำที่หน้ารายรับรายจ่าย');
  q("UPDATE orders SET status = 'cancelled', cancelled_at = ?, cancel_reason = ? WHERE id = ?").run(nowLocal(), str(b.reason, 200), id);
  broadcast('orders', 'kitchen', 'sales');
  res.json(getOrder(id));
});

// ยกเลิกรายการที่ส่งครัวแล้ว (ทั้งหมดหรือบางจำนวน)
app.post('/api/order-items/:id/void', (req, res) => {
  const id = int(req.params.id);
  const orderId = tx(() => {
    const it = q('SELECT i.*, o.status AS order_status FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.id = ?').get(id);
    if (!it) fail('ไม่พบรายการ', 404);
    if (it.order_status !== 'open') fail('แก้ไขได้เฉพาะออเดอร์ที่ยังไม่ชำระเงิน');
    if (it.status !== 'active') fail('รายการนี้ถูกยกเลิกแล้ว');
    const voidQty = body(req).qty == null ? it.qty : Math.min(Math.max(int(body(req).qty, 'จำนวน'), 1), it.qty);
    const now = nowLocal();
    if (voidQty >= it.qty) {
      q("UPDATE order_items SET status = 'void', voided_at = ? WHERE id = ?").run(now, id);
    } else {
      q('UPDATE order_items SET qty = qty - ? WHERE id = ?').run(voidQty, id);
      q(
        `INSERT INTO order_items (order_id, menu_item_id, name, price, qty, note, ticket_id, status, created_at, voided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'void', ?, ?)`
      ).run(it.order_id, it.menu_item_id, it.name, it.price, voidQty, it.note, it.ticket_id, it.created_at, now);
    }
    refreshTotals(it.order_id);
    return it.order_id;
  });
  broadcast('orders', 'kitchen');
  res.json(getOrder(orderId));
});

// ---------- kitchen ----------
app.get('/api/kitchen/tickets', (req, res) => {
  const tickets =
    req.query.status === 'done'
      ? q(`${TICKET_SELECT} WHERE k.status = 'done' ORDER BY k.done_at DESC LIMIT 40`).all()
      : q(`${TICKET_SELECT} WHERE k.status = 'new' ORDER BY k.id`).all();
  res.json(attachTicketItems(tickets));
});
app.post('/api/kitchen/tickets/:id/done', (req, res) => {
  q("UPDATE kitchen_tickets SET status = 'done', done_at = ? WHERE id = ?").run(nowLocal(), int(req.params.id));
  broadcast('kitchen');
  res.json({ ok: true });
});
app.post('/api/kitchen/tickets/:id/reopen', (req, res) => {
  q("UPDATE kitchen_tickets SET status = 'new', done_at = NULL WHERE id = ?").run(int(req.params.id));
  broadcast('kitchen');
  res.json({ ok: true });
});

// ---------- PromptPay QR ----------
app.get('/api/promptpay/qr', async (req, res) => {
  const id = req.query.id != null ? str(req.query.id, 20) : getSettings().promptpay_id;
  if (!id) fail('ยังไม่ได้ตั้งค่าหมายเลขพร้อมเพย์ (ไปที่ ตั้งค่า)');
  if (!normalizeTarget(id)) fail('หมายเลขพร้อมเพย์ไม่ถูกต้อง');
  const amount = req.query.amount ? r2(num(req.query.amount, 'ยอดเงิน')) : null;
  const payload = promptPayPayload(id, amount);
  const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  res.json({ payload, svg, amount });
});

// QR ทั่วไป (ใช้แสดงลิงก์ให้แท็บเล็ตสแกนเปิดระบบ)
app.get('/api/qr.svg', async (req, res) => {
  const text = str(req.query.text, 300);
  if (!/^https?:\/\//.test(text)) fail('ข้อความไม่ถูกต้อง');
  res.type('image/svg+xml').send(await QRCode.toString(text, { type: 'svg', margin: 1 }));
});

// ---------- stock ----------
const listIngredients = () => q('SELECT * FROM ingredients WHERE deleted = 0 ORDER BY name').all();
function ingredientInput(b) {
  const name = reqStr(b.name, 'ชื่อวัตถุดิบ', 60);
  const unit = str(b.unit, 20);
  const min = r3(optNum(b.min_quantity, 'จุดแจ้งเตือน') || 0);
  if (min < 0) fail('จุดแจ้งเตือนต้องไม่ติดลบ');
  return { name, unit, min };
}
app.get('/api/ingredients', (req, res) => res.json(listIngredients()));
app.post('/api/ingredients', (req, res) => {
  const { name, unit, min } = ingredientInput(body(req));
  const qty = r3(optNum(body(req).quantity, 'จำนวนคงเหลือ') || 0);
  q('INSERT INTO ingredients (name, unit, quantity, min_quantity, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, unit, qty, min, nowLocal());
  broadcast('stock');
  res.json(listIngredients());
});
app.put('/api/ingredients/:id', (req, res) => {
  const { name, unit, min } = ingredientInput(body(req));
  q('UPDATE ingredients SET name = ?, unit = ?, min_quantity = ?, updated_at = ? WHERE id = ?').run(name, unit, min, nowLocal(), int(req.params.id));
  broadcast('stock');
  res.json(listIngredients());
});
app.delete('/api/ingredients/:id', (req, res) => {
  q('UPDATE ingredients SET deleted = 1 WHERE id = ?').run(int(req.params.id));
  broadcast('stock');
  res.json(listIngredients());
});

app.post('/api/ingredients/:id/receive', (req, res) => {
  const b = body(req);
  const id = int(req.params.id);
  const qty = r3(num(b.quantity, 'จำนวน'));
  if (qty <= 0) fail('จำนวนต้องมากกว่า 0');
  const cost = r2(optNum(b.cost, 'ราคา') || 0);
  if (cost < 0) fail('ราคาต้องไม่ติดลบ');
  const note = str(b.note, 200);
  const date = dateParam(b.date) || todayLocal();
  const payMethod = b.payment_method === 'transfer' ? 'transfer' : 'cash';
  tx(() => {
    const ing = q('SELECT * FROM ingredients WHERE id = ? AND deleted = 0').get(id);
    if (!ing) fail('ไม่พบวัตถุดิบ', 404);
    const now = nowLocal();
    let expenseId = null;
    if (b.record_expense && cost > 0) {
      const desc = `ซื้อ${ing.name} ${qty} ${ing.unit}`.trim() + (note ? ` (${note})` : '');
      expenseId = q(
        `INSERT INTO expenses (biz_date, category, amount, note, payment_method, source, created_at)
         VALUES (?, 'วัตถุดิบ', ?, ?, ?, 'stock', ?)`
      ).run(date, cost, desc, payMethod, now).lastInsertRowid;
    }
    const after = r3(ing.quantity + qty);
    q(
      `INSERT INTO stock_movements (ingredient_id, type, quantity, before_qty, after_qty, cost, note, expense_id, created_at)
       VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, qty, ing.quantity, after, cost || null, note, expenseId, now);
    q('UPDATE ingredients SET quantity = ?, updated_at = ? WHERE id = ?').run(after, now, id);
  });
  broadcast('stock', 'expenses');
  res.json(listIngredients());
});

app.post('/api/stock/count', (req, res) => {
  const counts = Array.isArray(body(req).counts) ? body(req).counts : [];
  const note = str(body(req).note, 200);
  let changed = 0;
  tx(() => {
    const now = nowLocal();
    for (const c of counts) {
      if (c.quantity === '' || c.quantity == null) continue;
      const qty = r3(num(c.quantity, 'จำนวนที่นับได้'));
      if (qty < 0) fail('จำนวนที่นับได้ต้องไม่ติดลบ');
      const ing = q('SELECT * FROM ingredients WHERE id = ? AND deleted = 0').get(int(c.ingredient_id));
      if (!ing) continue;
      q(
        `INSERT INTO stock_movements (ingredient_id, type, quantity, before_qty, after_qty, note, created_at)
         VALUES (?, 'count', ?, ?, ?, ?, ?)`
      ).run(ing.id, qty, ing.quantity, qty, note, now);
      q('UPDATE ingredients SET quantity = ?, updated_at = ?, last_counted_at = ? WHERE id = ?').run(qty, now, now, ing.id);
      changed++;
    }
  });
  if (!changed) fail('ยังไม่ได้กรอกจำนวนที่นับได้');
  broadcast('stock');
  res.json(listIngredients());
});

app.get('/api/stock/movements', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(
    q(
      `SELECT m.*, i.name AS ingredient_name, i.unit FROM stock_movements m
       JOIN ingredients i ON i.id = m.ingredient_id ORDER BY m.id DESC LIMIT ?`
    ).all(limit)
  );
});

// ---------- expenses ----------
function expenseInput(b) {
  const date = dateParam(b.biz_date) || fail('วันที่ไม่ถูกต้อง');
  const category = reqStr(b.category, 'หมวดค่าใช้จ่าย', 40);
  const amount = r2(num(b.amount, 'จำนวนเงิน'));
  if (amount <= 0) fail('จำนวนเงินต้องมากกว่า 0');
  return { date, category, amount, note: str(b.note, 200), method: b.payment_method === 'transfer' ? 'transfer' : 'cash' };
}
app.get('/api/expenses', (req, res) => {
  const from = dateParam(req.query.from) || '0000-01-01';
  const to = dateParam(req.query.to) || '9999-12-31';
  res.json(q('SELECT * FROM expenses WHERE biz_date BETWEEN ? AND ? ORDER BY biz_date DESC, id DESC').all(from, to));
});
app.post('/api/expenses', (req, res) => {
  const e = expenseInput(body(req));
  const id = q(
    'INSERT INTO expenses (biz_date, category, amount, note, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(e.date, e.category, e.amount, e.note, e.method, nowLocal()).lastInsertRowid;
  broadcast('expenses');
  res.json(q('SELECT * FROM expenses WHERE id = ?').get(id));
});
app.put('/api/expenses/:id', (req, res) => {
  const id = int(req.params.id);
  const e = expenseInput(body(req));
  q('UPDATE expenses SET biz_date = ?, category = ?, amount = ?, note = ?, payment_method = ? WHERE id = ?').run(e.date, e.category, e.amount, e.note, e.method, id);
  broadcast('expenses');
  res.json(q('SELECT * FROM expenses WHERE id = ?').get(id));
});
app.delete('/api/expenses/:id', (req, res) => {
  const id = int(req.params.id);
  q('UPDATE stock_movements SET expense_id = NULL WHERE expense_id = ?').run(id);
  q('DELETE FROM expenses WHERE id = ?').run(id);
  broadcast('expenses');
  res.json({ ok: true });
});

// ---------- daily summary & cash closing ----------
function salesForDate(date) {
  const s = q(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(discount), 0) AS discount,
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total END), 0) AS cash,
       COALESCE(SUM(CASE WHEN payment_method = 'promptpay' THEN total END), 0) AS promptpay
     FROM orders WHERE status = 'paid' AND biz_date = ?`
  ).get(date);
  return { bills: s.bills, total: r2(s.total), discount: r2(s.discount), cash: r2(s.cash), promptpay: r2(s.promptpay) };
}
function expensesForDate(date) {
  const e = q(
    `SELECT COALESCE(SUM(amount), 0) AS total,
       COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN amount END), 0) AS cash
     FROM expenses WHERE biz_date = ?`
  ).get(date);
  return { total: r2(e.total), cash: r2(e.cash) };
}

app.get('/api/finance/day', (req, res) => {
  const date = dateParam(req.query.date) || todayLocal();
  res.json({
    date,
    sales: salesForDate(date),
    expenses: expensesForDate(date),
    closing: q('SELECT * FROM cash_closings WHERE biz_date = ?').get(date) || null,
  });
});

app.get('/api/cash-closing', (req, res) => {
  const date = dateParam(req.query.date) || todayLocal();
  const sales = salesForDate(date);
  const exp = expensesForDate(date);
  const saved = q('SELECT * FROM cash_closings WHERE biz_date = ?').get(date) || null;
  const opening = saved ? saved.opening_cash : Number(getSettings().default_opening_cash) || 0;
  const openOrders = q("SELECT COUNT(*) AS n FROM orders WHERE status = 'open'").get().n;
  res.json({ date, opening_cash: opening, cash_sales: sales.cash, promptpay_sales: sales.promptpay, bills: sales.bills, cash_expenses: exp.cash, saved, open_orders: openOrders });
});

app.post('/api/cash-closing', (req, res) => {
  const b = body(req);
  const date = dateParam(b.biz_date) || fail('วันที่ไม่ถูกต้อง');
  const opening = r2(num(b.opening_cash, 'เงินทอนตั้งต้น'));
  const counted = r2(num(b.counted_cash, 'เงินสดที่นับได้'));
  const sales = salesForDate(date);
  const exp = expensesForDate(date);
  const expected = r2(opening + sales.cash - exp.cash);
  q(
    `INSERT INTO cash_closings (biz_date, opening_cash, cash_sales, promptpay_sales, cash_expenses, expected_cash, counted_cash, difference, note, closed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(biz_date) DO UPDATE SET opening_cash = excluded.opening_cash, cash_sales = excluded.cash_sales,
       promptpay_sales = excluded.promptpay_sales, cash_expenses = excluded.cash_expenses, expected_cash = excluded.expected_cash,
       counted_cash = excluded.counted_cash, difference = excluded.difference, note = excluded.note, closed_at = excluded.closed_at`
  ).run(date, opening, sales.cash, sales.promptpay, exp.cash, expected, counted, r2(counted - expected), str(b.note, 300), nowLocal());
  broadcast('closing');
  res.json(q('SELECT * FROM cash_closings WHERE biz_date = ?').get(date));
});

app.get('/api/cash-closings', (req, res) => {
  res.json(q('SELECT * FROM cash_closings ORDER BY biz_date DESC LIMIT 60').all());
});

// ---------- reports ----------
function enumeratePeriods(from, to, group) {
  const out = [];
  if (group === 'month') {
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    const end = to.slice(0, 7);
    for (let i = 0; i < 120; i++) {
      const p = `${y}-${String(m).padStart(2, '0')}`;
      out.push(p);
      if (p >= end) break;
      if (++m > 12) { m = 1; y++; }
    }
  } else {
    const d = new Date(`${from}T00:00:00`);
    for (let i = 0; i < 400; i++) {
      const p = localDate(d);
      if (p > to) break;
      out.push(p);
      d.setDate(d.getDate() + 1);
    }
  }
  return out;
}

app.get('/api/reports', (req, res) => {
  const from = dateParam(req.query.from);
  const to = dateParam(req.query.to);
  if (!from || !to || from > to) fail('ช่วงวันที่ไม่ถูกต้อง');
  const group = req.query.group === 'month' ? 'month' : 'day';
  const len = group === 'month' ? 7 : 10;
  const sales = q(
    `SELECT substr(biz_date, 1, ${len}) AS period, COUNT(*) AS bills, SUM(total) AS sales, SUM(discount) AS discount,
       SUM(CASE WHEN payment_method = 'cash' THEN total ELSE 0 END) AS cash,
       SUM(CASE WHEN payment_method = 'promptpay' THEN total ELSE 0 END) AS promptpay
     FROM orders WHERE status = 'paid' AND biz_date BETWEEN ? AND ? GROUP BY period`
  ).all(from, to);
  const exps = q(
    `SELECT substr(biz_date, 1, ${len}) AS period, SUM(amount) AS expenses
     FROM expenses WHERE biz_date BETWEEN ? AND ? GROUP BY period`
  ).all(from, to);
  const sMap = new Map(sales.map((s) => [s.period, s]));
  const eMap = new Map(exps.map((e) => [e.period, e]));
  const series = enumeratePeriods(from, to, group).map((p) => {
    const s = sMap.get(p) || {};
    const e = eMap.get(p) || {};
    const salesV = r2(s.sales || 0);
    const expV = r2(e.expenses || 0);
    return {
      period: p, bills: s.bills || 0, sales: salesV, cash: r2(s.cash || 0), promptpay: r2(s.promptpay || 0),
      discount: r2(s.discount || 0), expenses: expV, profit: r2(salesV - expV),
    };
  });
  const totals = series.reduce(
    (t, s) => {
      for (const k of ['bills', 'sales', 'cash', 'promptpay', 'discount', 'expenses', 'profit']) t[k] = r2(t[k] + s[k]);
      return t;
    },
    { bills: 0, sales: 0, cash: 0, promptpay: 0, discount: 0, expenses: 0, profit: 0 }
  );
  const topItems = q(
    `SELECT COALESCE(m.name, MAX(i.name)) AS name, SUM(i.qty) AS qty, SUM(i.qty * i.price) AS revenue
     FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN menu_items m ON m.id = i.menu_item_id
     WHERE o.status = 'paid' AND i.status = 'active' AND o.biz_date BETWEEN ? AND ?
     GROUP BY i.menu_item_id ORDER BY qty DESC, revenue DESC LIMIT 10`
  ).all(from, to);
  const expensesByCategory = q(
    `SELECT category, SUM(amount) AS amount FROM expenses WHERE biz_date BETWEEN ? AND ?
     GROUP BY category ORDER BY amount DESC`
  ).all(from, to);
  res.json({ from, to, group, series, totals, topItems, expensesByCategory });
});

// ---------- backup ----------
app.get('/api/backup', (req, res) => {
  const file = path.join(os.tmpdir(), `pos-backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.download(file, `pos-backup-${todayLocal()}.db`, () => fs.unlink(file, () => {}));
});

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'ไม่พบ API ที่เรียก' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ระบบร้านอาหารพร้อมใช้งานแล้ว');
  console.log(`  เครื่องนี้:            http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  แท็บเล็ต/มือถือในร้าน:  ${u}`);
  console.log('  (กด Ctrl+C เพื่อปิดระบบ)');
  console.log('');
});

// ปิดฐานข้อมูลให้เรียบร้อยเมื่อปิดระบบ (Ctrl+C หรือปิดหน้าต่าง) เพื่อรวม pos.db-wal เข้า pos.db
function shutdown() {
  try { db.close(); } catch { /* ปิดไปแล้ว */ }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, shutdown);
