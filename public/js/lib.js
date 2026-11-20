// ===== ฟังก์ชันพื้นฐานที่ใช้ร่วมกันทุกหน้า =====

// ---------- API ----------
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่าเครื่องหลักเปิดอยู่');
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) throw new Error((data && data.error) || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}
api.get = (p) => api(p);
api.post = (p, body = {}) => api(p, { method: 'POST', body });
api.put = (p, body = {}) => api(p, { method: 'PUT', body });
api.patch = (p, body = {}) => api(p, { method: 'PATCH', body });
api.del = (p) => api(p, { method: 'DELETE' });

// ---------- format ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const nf0 = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfq = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 });
export function num(n) {
  const v = r2(n || 0);
  return Number.isInteger(v) ? nf0.format(v) : nf2.format(v);
}
export const baht = (n) => (Number(n) < 0 ? '-฿' + num(-n) : '฿' + num(n));
export const qty = (n) => nfq.format(Number(n) || 0);
export function compact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return r2(n / 1e6).toString().replace(/\.?0+$/, '') + 'M';
  if (a >= 1e3) return (Math.round((n / 1e3) * 10) / 10).toString() + 'K';
  return String(Math.round(n));
}

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => localDate();
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localDate(d);
}
export const parseDT = (s) => (s ? new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T')) : null);
export function fmtDate(s, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = parseDT(s);
  return d ? d.toLocaleDateString('th-TH', opts) : '';
}
export function fmtTime(s) {
  const d = parseDT(s);
  return d ? d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
}
export const fmtDateTime = (s) => `${fmtDate(s)} ${fmtTime(s)}`;
export const minutesSince = (s) => Math.max(0, Math.floor((Date.now() - parseDT(s)) / 60000));
export function elapsed(s) {
  const m = minutesSince(s);
  if (m < 1) return 'เมื่อสักครู่';
  if (m < 60) return `${m} นาที`;
  return `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
}
export const orderNo = (n) => '#' + String(n).padStart(3, '0');
export function orderLabel(o) {
  if (o.type === 'dine_in') return o.table_name || 'โต๊ะ';
  return `กลับบ้าน ${orderNo(o.order_no)}` + (o.customer_name ? ` · ${o.customer_name}` : '');
}
export const PAY_LABEL = { cash: 'เงินสด', promptpay: 'พร้อมเพย์' };

// ---------- local storage (อาจใช้ไม่ได้ในบางโหมด) ----------
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// ---------- icons (Feather icons, MIT) ----------
const ICONS = {
  pos: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  kitchen: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  menu: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  stock: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  finance: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  reports: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  next: '<polyline points="9 18 15 12 9 6"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  note: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  move: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  bag: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  undo: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};
export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ---------- toast ----------
export function toast(message, type = 'info', ms = 2600) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, ms);
}
export const toastError = (err) => toast(err?.message || String(err), 'error', 4000);

// ---------- modal ----------
export function modal({ title, body = '', footer = '', size = '', dismissible = true, onClose } = {}) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close aria-label="ปิด">${icon('x')}</button>
      </div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div>
    </div>`;
  const bodyEl = wrap.querySelector('.modal-body');
  const footEl = wrap.querySelector('.modal-foot');
  const fill = (el, content) => (typeof content === 'string' ? (el.innerHTML = content) : el.append(content));
  fill(bodyEl, body);
  fill(footEl, footer);
  if (!footer) footEl.hidden = true;
  if (!dismissible) wrap.querySelector('[data-close]').hidden = true;

  let closed = false;
  const prevFocus = document.activeElement;
  const close = (result) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.classList.remove('show');
    setTimeout(() => wrap.remove(), 150);
    prevFocus?.focus?.();
    onClose?.(result);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible && root.lastElementChild === wrap) close();
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === wrap && dismissible)) close();
  });
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  setTimeout(() => {
    const f = wrap.querySelector('[autofocus]');
    if (f) { f.focus(); f.select?.(); }
  }, 60);
  return { el: wrap.querySelector('.modal'), body: bodyEl, foot: footEl, close, setTitle: (t) => (wrap.querySelector('h2').textContent = t) };
}

export function confirmDialog(message, { title = 'ยืนยัน', ok = 'ตกลง', cancel = 'ยกเลิก', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      size: 'sm',
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button class="btn" data-close>${esc(cancel)}</button>
               <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button>`,
      onClose: (r) => resolve(r === true),
    });
    const okBtn = m.foot.querySelector('[data-ok]');
    okBtn.addEventListener('click', () => m.close(true));
    setTimeout(() => okBtn.focus(), 60);
  });
}

// อ่านค่าจาก form เป็น object
export function formValues(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

// ปุ่มที่กำลังทำงาน: กันกดซ้ำระหว่างรอเซิร์ฟเวอร์
export async function busy(btn, fn) {
  if (btn?.disabled) return;
  btn?.classList.add('is-busy');
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }
}

// ให้ฟังก์ชันโหลดข้อมูลทำงานทีละครั้ง: ถ้าถูกเรียกซ้ำระหว่างโหลด จะโหลดใหม่อีกรอบหลังรอบนี้เสร็จ
export function serial(fn) {
  let running = null;
  let again = false;
  return async function run() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await fn();
      } while (again);
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  };
}

// ---------- real-time events ----------
const listeners = new Map();
export function onTopic(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic)?.delete(fn);
}
export function emit(topic) {
  for (const fn of listeners.get(topic) || []) {
    Promise.resolve().then(fn).catch((e) => console.error(e));
  }
}
const ALL_TOPICS = ['orders', 'kitchen', 'menu', 'tables', 'stock', 'settings', 'expenses', 'sales', 'closing'];
export function connectEvents(onStatus) {
  let es;
  let wasDown = false;
  const open = () => {
    es = new EventSource('/api/events');
    es.onopen = () => {
      onStatus?.(true);
      if (wasDown) {
        wasDown = false;
        ALL_TOPICS.forEach(emit);
      }
    };
    es.onmessage = (e) => {
      let topics;
      try { topics = JSON.parse(e.data); } catch { return; }
      new Set(topics).forEach(emit);
    };
    es.onerror = () => {
      wasDown = true;
      onStatus?.(false);
    };
  };
  open();
}
