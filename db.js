'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.POS_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'pos.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS dining_tables (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_items (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  price       REAL NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  available   INTEGER NOT NULL DEFAULT 1,
  deleted     INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY,
  order_no       INTEGER NOT NULL,
  type           TEXT NOT NULL,              -- dine_in | takeaway
  table_id       INTEGER,
  table_name     TEXT,
  customer_name  TEXT,
  status         TEXT NOT NULL DEFAULT 'open', -- open | paid | cancelled
  subtotal       REAL NOT NULL DEFAULT 0,
  discount       REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL DEFAULT 0,
  payment_method TEXT,                        -- cash | promptpay
  cash_received  REAL,
  change_amount  REAL,
  biz_date       TEXT,                        -- วันที่นับยอดขาย (วันที่ชำระเงิน)
  created_at     TEXT NOT NULL,
  paid_at        TEXT,
  cancelled_at   TEXT,
  cancel_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_biz_date ON orders(biz_date);
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  status     TEXT NOT NULL DEFAULT 'new',     -- new | done
  created_at TEXT NOT NULL,
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON kitchen_tickets(status);
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  menu_item_id INTEGER,
  name         TEXT NOT NULL,
  price        REAL NOT NULL,
  qty          INTEGER NOT NULL,
  note         TEXT,
  ticket_id    INTEGER REFERENCES kitchen_tickets(id),
  status       TEXT NOT NULL DEFAULT 'active', -- active | void
  created_at   TEXT NOT NULL,
  voided_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_ticket ON order_items(ticket_id);
CREATE TABLE IF NOT EXISTS ingredients (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT '',
  quantity        REAL NOT NULL DEFAULT 0,
  min_quantity    REAL NOT NULL DEFAULT 0,
  deleted         INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT,
  last_counted_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id            INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  type          TEXT NOT NULL,                -- in | count
  quantity      REAL NOT NULL,                -- in: จำนวนที่รับเข้า / count: จำนวนที่นับได้
  before_qty    REAL NOT NULL,
  after_qty     REAL NOT NULL,
  cost          REAL,
  note          TEXT,
  expense_id    INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moves_ing ON stock_movements(ingredient_id);
CREATE TABLE IF NOT EXISTS expenses (
  id             INTEGER PRIMARY KEY,
  biz_date       TEXT NOT NULL,
  category       TEXT NOT NULL,
  amount         REAL NOT NULL,
  note           TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash', -- cash (จ่ายจากลิ้นชัก) | transfer
  source         TEXT NOT NULL DEFAULT 'manual', -- manual | stock
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(biz_date);
CREATE TABLE IF NOT EXISTS cash_closings (
  id            INTEGER PRIMARY KEY,
  biz_date      TEXT NOT NULL UNIQUE,
  opening_cash  REAL NOT NULL,
  cash_sales    REAL NOT NULL,
  promptpay_sales REAL NOT NULL,
  cash_expenses REAL NOT NULL,
  expected_cash REAL NOT NULL,
  counted_cash  REAL NOT NULL,
  difference    REAL NOT NULL,
  note          TEXT,
  closed_at     TEXT NOT NULL
);
`);

// ---------- helpers ----------
const stmtCache = new Map();
function q(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const pad = (n) => String(n).padStart(2, '0');
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nowLocal(d = new Date()) {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

const DEFAULT_SETTINGS = {
  shop_name: 'ร้านของฉัน',
  shop_address: '',
  shop_phone: '',
  tax_id: '',
  receipt_footer: 'ขอบคุณที่ใช้บริการ',
  promptpay_id: '',
  promptpay_name: '',
  paper_width: '80',
  auto_print_receipt: '0',
  print_kitchen_on_send: '0',
  bill_show_qr: '1',
  default_opening_cash: '1000',
};

function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of q('SELECT key, value FROM settings').all()) out[row.key] = row.value ?? '';
  return out;
}

// ---------- ข้อมูลตัวอย่างสำหรับการเปิดใช้ครั้งแรก ----------
function seedIfEmpty() {
  const hasTables = q('SELECT COUNT(*) AS n FROM dining_tables').get().n > 0;
  const hasMenu = q('SELECT COUNT(*) AS n FROM categories').get().n > 0;
  const hasStock = q('SELECT COUNT(*) AS n FROM ingredients').get().n > 0;
  if (hasTables || hasMenu || hasStock) return;
  const now = nowLocal();
  tx(() => {
    for (let i = 1; i <= 10; i++) q('INSERT INTO dining_tables(name, sort) VALUES (?, ?)').run(`โต๊ะ ${i}`, i);

    const menu = {
      'อาหารจานเดียว': [
        ['ข้าวกะเพราหมูสับ', 50], ['ข้าวผัดหมู', 50], ['ข้าวไข่เจียวหมูสับ', 45],
        ['ข้าวหมูกระเทียม', 50], ['ผัดไทยกุ้งสด', 70], ['ผัดซีอิ๊วหมู', 55],
      ],
      'กับข้าว': [
        ['ต้มยำกุ้ง', 120], ['แกงเขียวหวานไก่', 90], ['ผัดผักบุ้งไฟแดง', 60], ['ไข่เจียว', 40],
      ],
      'ก๋วยเตี๋ยว': [['ก๋วยเตี๋ยวน้ำใส', 45], ['ก๋วยเตี๋ยวต้มยำ', 50], ['เย็นตาโฟ', 50]],
      'เครื่องดื่ม': [['น้ำเปล่า', 10], ['ชาเย็น', 35], ['กาแฟเย็น', 40], ['โค้ก', 20]],
      'เพิ่มเติม': [['ข้าวสวย', 10], ['ไข่ดาว', 10], ['พิเศษ (เพิ่มเนื้อ)', 10]],
    };
    let cs = 0;
    for (const [cat, items] of Object.entries(menu)) {
      const catId = q('INSERT INTO categories(name, sort) VALUES (?, ?)').run(cat, ++cs).lastInsertRowid;
      items.forEach(([name, price], i) => {
        q('INSERT INTO menu_items(name, price, category_id, sort, created_at) VALUES (?, ?, ?, ?, ?)').run(name, price, catId, i, now);
      });
    }

    const ingredients = [
      ['หมูสับ', 'กก.', 5, 2], ['ไก่', 'กก.', 3, 1], ['กุ้ง', 'กก.', 2, 1],
      ['ไข่ไก่', 'ฟอง', 60, 30], ['ข้าวสาร', 'กก.', 15, 5], ['เส้นก๋วยเตี๋ยว', 'กก.', 4, 2],
      ['ผักบุ้ง', 'กำ', 10, 5], ['น้ำมันพืช', 'ลิตร', 3, 2], ['แก๊สหุงต้ม', 'ถัง', 1, 1],
    ];
    for (const [name, unit, qty, min] of ingredients) {
      q('INSERT INTO ingredients(name, unit, quantity, min_quantity, updated_at) VALUES (?, ?, ?, ?, ?)').run(name, unit, qty, min, now);
    }
  });
}
seedIfEmpty();

// รวมข้อมูลจาก pos.db-wal กลับเข้า pos.db ตอนเปิดระบบและทุก 5 นาที
// ให้ไฟล์ pos.db มีข้อมูลล่าสุดเสมอ แม้ระบบถูกปิดแบบไม่ปกติ (ไฟดับ, ปิดเครื่อง)
const checkpoint = () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
checkpoint();
setInterval(checkpoint, 5 * 60 * 1000).unref();

module.exports = { db, q, tx, nowLocal, localDate, r2, r3, getSettings, DEFAULT_SETTINGS, DATA_DIR, DB_PATH };
