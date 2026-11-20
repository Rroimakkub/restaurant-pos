import { api, icon, esc, connectEvents, onTopic } from './lib.js';
import { store, loadStore, wireStore } from './store.js';
import pos from './pages/pos.js';
import kitchen from './pages/kitchen.js';
import menu from './pages/menu.js';
import stock from './pages/stock.js';
import finance from './pages/finance.js';
import reports from './pages/reports.js';
import settings from './pages/settings.js';

const PAGES = [
  { key: 'pos', label: 'ขายหน้าร้าน', short: 'ขาย', icon: 'pos', page: pos },
  { key: 'kitchen', label: 'ครัว', short: 'ครัว', icon: 'kitchen', page: kitchen },
  { key: 'menu', label: 'เมนู', short: 'เมนู', icon: 'menu', page: menu },
  { key: 'stock', label: 'สต็อก', short: 'สต็อก', icon: 'stock', page: stock },
  { key: 'finance', label: 'รายรับรายจ่าย', short: 'รับ-จ่าย', icon: 'finance', page: finance },
  { key: 'reports', label: 'รายงาน', short: 'รายงาน', icon: 'reports', page: reports },
  { key: 'settings', label: 'ตั้งค่า', short: 'ตั้งค่า', icon: 'settings', page: settings },
];

const nav = document.getElementById('nav');
const view = document.getElementById('view');
const badges = { kitchen: 0, stock: 0 };
let online = true;

function renderNav() {
  const active = currentKey();
  nav.innerHTML = `
    <a class="nav-brand" href="#/pos" title="${esc(store.settings.shop_name)}">
      <span class="nav-logo"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path d="M9 7v8a3 3 0 0 0 6 0V7M12 7v18M21 25V7c-2.5 1-4 3.5-4 7v3h4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </a>
    ${PAGES.map((p) => `
      <a class="nav-link ${p.key === active ? 'active' : ''}" href="#/${p.key}" ${p.key === active ? 'aria-current="page"' : ''}>
        ${icon(p.icon)}
        <span class="nav-label nav-label-full">${p.label}</span>
        <span class="nav-label nav-label-short">${p.short}</span>
        ${badges[p.key] ? `<span class="nav-badge">${badges[p.key]}</span>` : ''}
      </a>`).join('')}
    <div class="nav-status ${online ? 'is-online' : 'is-offline'}" title="${online ? 'เชื่อมต่อแล้ว' : 'ขาดการเชื่อมต่อ'}">
      <span class="dot"></span><span>${online ? 'ออนไลน์' : 'ออฟไลน์'}</span>
    </div>`;
}

function currentKey() {
  const key = location.hash.replace(/^#\/?/, '').split('/')[0];
  return PAGES.some((p) => p.key === key) ? key : 'pos';
}

async function refreshKitchenBadge() {
  try {
    badges.kitchen = (await api.get('/kitchen/tickets?status=new')).length;
    renderNav();
  } catch { /* ignore */ }
}

// ---------- router ----------
let ctx = null;
function makeCtx() {
  const disposers = [];
  let alive = true;
  return {
    get alive() { return alive; },
    on(topic, fn) { disposers.push(onTopic(topic, () => (alive ? fn() : undefined))); },
    every(ms, fn) {
      const t = setInterval(() => alive && fn(), ms);
      disposers.push(() => clearInterval(t));
    },
    cleanup(fn) { disposers.push(fn); },
    dispose() {
      alive = false;
      for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    },
  };
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const def = PAGES.find((p) => p.key === parts[0]) || PAGES[0];
  ctx?.dispose();
  ctx = makeCtx();
  const myCtx = ctx;
  renderNav();
  document.title = `${def.label} · ${store.settings.shop_name || 'POS'}`;
  const root = document.createElement('div');
  root.className = 'view-root';
  view.replaceChildren(root);
  window.scrollTo(0, 0);
  try {
    await def.page.render(root, parts.slice(1), myCtx);
  } catch (err) {
    console.error(err);
    if (myCtx.alive) {
      root.innerHTML = `<div class="page"><div class="empty">${icon('alert')}<p>${esc(err.message)}</p>
        <button class="btn" onclick="location.reload()">ลองใหม่</button></div></div>`;
    }
  }
}

async function init() {
  try {
    await loadStore();
  } catch (err) {
    view.innerHTML = `<div class="page"><div class="empty">${icon('alert')}<p>${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">ลองใหม่</button></div></div>`;
    return;
  }
  badges.stock = store.lowStock;
  wireStore();
  connectEvents((ok) => {
    if (ok !== online) {
      online = ok;
      renderNav();
    }
  });
  onTopic('kitchen', refreshKitchenBadge);
  onTopic('store:stock', () => {
    badges.stock = store.lowStock;
    renderNav();
  });
  onTopic('store:settings', renderNav);
  window.addEventListener('hashchange', route);
  refreshKitchenBadge();
  route();
}

init();
