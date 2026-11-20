// ขายหน้าร้าน: หน้ารวมโต๊ะ และหน้าจอรับออเดอร์
import {
  api, esc, baht, num, icon, toast, toastError, modal, confirmDialog,
  elapsed, fmtTime, orderNo, orderLabel, storage, busy, r2, serial,
} from '../lib.js';
import { store, flag } from '../store.js';
import { printKitchenTicket, printBill } from '../print.js';
import { openPayment } from '../payment.js';

const NOTE_CHIPS = ['ไม่เผ็ด', 'เผ็ดน้อย', 'เผ็ดมาก', 'ไม่ใส่ผัก', 'ไม่ใส่ผงชูรส', 'พิเศษ', 'แยกน้ำ', 'ใส่กล่อง'];

export default {
  render(root, params, ctx) {
    const [kind, id] = params;
    return kind ? renderOrder(root, ctx, kind, id) : renderHome(root, ctx);
  },
};

// =====================================================================
// หน้ารวมโต๊ะ
// =====================================================================
async function renderHome(root, ctx) {
  root.innerHTML = `
    <div class="page">
      <header class="page-head">
        <div><h1>ขายหน้าร้าน</h1><p class="sub" data-sub>&nbsp;</p></div>
        <div class="head-actions">
          <a class="btn btn-primary btn-lg" href="#/pos/takeaway">${icon('bag')} สั่งกลับบ้าน</a>
        </div>
      </header>
      <div data-alert></div>
      <h2 class="section-title">โต๊ะ</h2>
      <div class="tgrid" data-tables></div>
      <h2 class="section-title">กลับบ้าน / รอรับ</h2>
      <div class="tgrid" data-takeaways></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  let data = null;

  const load = serial(async () => {
    try {
      data = await api.get('/pos/overview');
      draw();
    } catch (e) {
      toastError(e);
    }
  });

  function draw() {
    if (!data || !ctx.alive) return;
    const busyCount = data.tables.filter((t) => t.order).length;
    $('[data-sub]').textContent = `มีลูกค้า ${busyCount}/${data.tables.length} โต๊ะ · กลับบ้านรอรับ ${data.takeaways.length} ออเดอร์`;
    $('[data-alert]').innerHTML = data.lowStock
      ? `<a class="alert alert-warn" href="#/stock">${icon('alert')}<span>วัตถุดิบใกล้หมด ${data.lowStock} รายการ — แตะเพื่อดูสต็อก</span></a>`
      : '';
    $('[data-tables]').innerHTML = data.tables.length
      ? data.tables.map(tableCard).join('')
      : `<div class="empty small">ยังไม่มีโต๊ะ — <a href="#/settings">เพิ่มโต๊ะที่หน้าตั้งค่า</a></div>`;
    const newDraft = (storage.get('draft:new') || []).length;
    $('[data-takeaways]').innerHTML =
      (newDraft ? `<a class="tcard free" href="#/pos/takeaway"><div class="tcard-name">กลับบ้าน (ใหม่)</div><div class="tcard-meta"><span class="chip chip-info">มีรายการยังไม่ส่ง</span></div></a>` : '') +
      (data.takeaways.length
        ? data.takeaways.map(takeawayCard).join('')
        : newDraft ? '' : `<div class="empty small">ไม่มีออเดอร์กลับบ้านที่รอรับ</div>`);
  }

  ctx.on('orders', load);
  ctx.on('kitchen', load);
  ctx.on('store:tables', load);
  ctx.on('store:stock', load);
  ctx.every(30000, draw);
  await load();
}

function statusChips(o, hasDraft) {
  return `<div class="tcard-chips">
    ${o.cooking ? `<span class="chip chip-warn">${icon('clock')} รอครัว ${o.cooking}</span>` : `<span class="chip chip-ok">${icon('check')} อาหารครบ</span>`}
    ${hasDraft ? '<span class="chip chip-info">มีรายการยังไม่ส่ง</span>' : ''}
  </div>`;
}

function tableCard(t) {
  const o = t.order;
  const hasDraft = (storage.get(`draft:t${t.id}`) || []).length > 0;
  if (!o) {
    return `<a class="tcard free" href="#/pos/table/${t.id}">
      <div class="tcard-name">${esc(t.name)}</div>
      <div class="tcard-meta">${hasDraft ? '<span class="chip chip-info">มีรายการยังไม่ส่ง</span>' : 'ว่าง'}</div>
    </a>`;
  }
  return `<a class="tcard busy" href="#/pos/table/${t.id}">
    <div class="tcard-top"><span class="tcard-name">${esc(t.name)}</span><span class="tcard-no">${orderNo(o.order_no)}</span></div>
    <div class="tcard-total">${baht(o.total)}</div>
    <div class="tcard-meta">${o.item_count} รายการ · ${elapsed(o.created_at)}</div>
    ${statusChips(o, hasDraft)}
  </a>`;
}

function takeawayCard(o) {
  const hasDraft = (storage.get(`draft:o${o.id}`) || []).length > 0;
  return `<a class="tcard busy takeaway" href="#/pos/order/${o.id}">
    <div class="tcard-top"><span class="tcard-name">${orderNo(o.order_no)}</span><span class="tcard-no">${icon('bag')}</span></div>
    ${o.customer_name ? `<div class="tcard-customer">${esc(o.customer_name)}</div>` : ''}
    <div class="tcard-total">${baht(o.total)}</div>
    <div class="tcard-meta">${o.item_count} รายการ · ${elapsed(o.created_at)}</div>
    ${statusChips(o, hasDraft)}
  </a>`;
}

// =====================================================================
// หน้าจอรับออเดอร์
// =====================================================================
async function renderOrder(root, ctx, kind, id) {
  const st = {
    type: null, table: null, order: null, drafts: [],
    cat: 'all', search: '', soldOut: false, customer: '', paying: false, sending: null,
  };
  root.innerHTML = '<div class="page-loading">กำลังโหลด…</div>';
  try {
    if (kind === 'table') {
      const d = await api.get(`/pos/table/${id}`);
      Object.assign(st, { type: 'dine_in', table: d.table, order: d.order });
    } else if (kind === 'order') {
      const o = await api.get(`/orders/${id}`);
      if (o.status !== 'open') {
        toast('ออเดอร์นี้ปิดไปแล้ว');
        location.hash = '#/pos';
        return;
      }
      Object.assign(st, { type: o.type, order: o, table: o.type === 'dine_in' ? { id: o.table_id, name: o.table_name } : null });
    } else if (kind === 'takeaway') {
      st.type = 'takeaway';
    } else {
      location.hash = '#/pos';
      return;
    }
  } catch (e) {
    toastError(e);
    location.hash = '#/pos';
    return;
  }
  if (!ctx.alive) return;

  const draftKey = () => (st.type === 'dine_in' ? `draft:t${st.table.id}` : st.order ? `draft:o${st.order.id}` : 'draft:new');
  const saveDrafts = () => (st.drafts.length ? storage.set(draftKey(), st.drafts) : storage.remove(draftKey()));
  st.drafts = storage.get(draftKey(), []);
  syncDrafts();

  root.innerHTML = `
    <div class="pos">
      <section class="pos-left">
        <div class="pos-bar">
          <a class="icon-btn" href="#/pos" aria-label="กลับหน้ารวมโต๊ะ">${icon('back')}</a>
          <div class="pos-title"><strong data-title></strong></div>
          <label class="search">${icon('search')}<input class="input" type="search" placeholder="ค้นหาเมนู" data-search aria-label="ค้นหาเมนู"></label>
          <button class="btn btn-ghost" data-act="soldout" aria-pressed="false">${icon('ban')} <span data-soldout-label>ของหมด</span></button>
        </div>
        <div class="chips" data-cats></div>
        <div class="soldout-hint" data-soldout-hint hidden>${icon('alert')}<span>โหมดปิดเมนู: แตะเมนูเพื่อสลับ “หมด / มีขาย” แล้วกด “เสร็จ”</span></div>
        <div class="menu-grid" data-grid></div>
      </section>
      <aside class="pos-cart" data-cart aria-label="รายการสั่ง"></aside>
      <div class="cart-bar" data-cartbar></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const title = () => (st.type === 'dine_in' ? st.table.name : st.order ? `กลับบ้าน ${orderNo(st.order.order_no)}` : 'สั่งกลับบ้าน');

  // ---------- เมนู ----------
  const catKey = (m) => (store.categories.some((c) => c.id === m.category_id) ? String(m.category_id) : 'none');
  function draftCounts() {
    const counts = {};
    for (const d of st.drafts) counts[d.menu_item_id] = (counts[d.menu_item_id] || 0) + d.qty;
    return counts;
  }
  function drawMenu() {
    $('[data-title]').textContent = title();
    const used = new Set(store.menu.map(catKey));
    const cats = store.categories.filter((c) => used.has(String(c.id)));
    if (st.cat !== 'all' && !used.has(st.cat)) st.cat = 'all';
    $('[data-cats]').innerHTML = [
      `<button class="chip-btn ${st.cat === 'all' ? 'active' : ''}" data-cat="all">ทั้งหมด</button>`,
      ...cats.map((c) => `<button class="chip-btn ${st.cat === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`),
      used.has('none') ? `<button class="chip-btn ${st.cat === 'none' ? 'active' : ''}" data-cat="none">อื่นๆ</button>` : '',
    ].join('');
    const s = st.search.trim().toLowerCase();
    const items = store.menu.filter((m) => (s ? m.name.toLowerCase().includes(s) : st.cat === 'all' || catKey(m) === st.cat));
    const counts = draftCounts();
    const grid = $('[data-grid]');
    grid.classList.toggle('soldout-mode', st.soldOut);
    grid.innerHTML = items.length
      ? items.map((m) => `
        <button class="mi ${m.available ? '' : 'out'}" data-item="${m.id}" aria-label="${esc(m.name)} ${num(m.price)} บาท${m.available ? '' : ' (หมด)'}">
          <span class="mi-name">${esc(m.name)}</span>
          <span class="mi-price">${baht(m.price)}</span>
          ${m.available ? '' : '<span class="mi-out">หมด</span>'}
          ${counts[m.id] ? `<span class="mi-count">${counts[m.id]}</span>` : ''}
        </button>`).join('')
      : `<div class="empty">${store.menu.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนู — <a href="#/menu">เพิ่มเมนู</a>'}</div>`;
  }

  // ---------- ตะกร้า ----------
  const sentLine = (i) => `
    <div class="cline ${i.status === 'void' ? 'is-void' : ''}">
      <div class="cline-qty">${i.qty}×</div>
      <div class="cline-main">
        <div class="cline-name">${esc(i.name)}${i.status === 'void' ? ' <span class="chip chip-danger">ยกเลิก</span>' : ''}</div>
        ${i.note ? `<div class="cline-note">${esc(i.note)}</div>` : ''}
      </div>
      <div class="cline-price">${num(i.price * i.qty)}</div>
      ${i.status === 'active'
        ? `<button class="icon-btn sm" data-void="${i.id}" aria-label="ยกเลิก ${esc(i.name)}" title="ยกเลิกรายการ">${icon('x')}</button>`
        : '<span class="icon-spacer"></span>'}
    </div>`;
  const draftLine = (d) => `
    <div class="cline is-draft">
      <div class="cline-main">
        <div class="cline-name">${esc(d.name)}</div>
        <button class="cline-notebtn ${d.note ? 'has-note' : ''}" data-note="${d.key}">${icon('note')} ${d.note ? esc(d.note) : 'หมายเหตุ'}</button>
      </div>
      <div class="stepper">
        <button data-dec="${d.key}" aria-label="ลดจำนวน ${esc(d.name)}">${icon(d.qty > 1 ? 'minus' : 'trash')}</button>
        <span>${d.qty}</span>
        <button data-inc="${d.key}" aria-label="เพิ่มจำนวน ${esc(d.name)}">${icon('plus')}</button>
      </div>
      <div class="cline-price">${num(d.price * d.qty)}</div>
    </div>`;

  function drawCart() {
    const sent = st.order ? st.order.items : [];
    const active = sent.filter((i) => i.status === 'active');
    const sentTotal = active.reduce((s, i) => s + i.price * i.qty, 0);
    const draftTotal = st.drafts.reduce((s, d) => s + d.price * d.qty, 0);
    const total = r2(sentTotal + draftTotal);
    const draftCount = st.drafts.reduce((s, d) => s + d.qty, 0);
    const itemCount = active.reduce((s, i) => s + i.qty, 0) + draftCount;
    const customer = st.order ? st.order.customer_name || '' : st.customer;
    $('[data-cart]').innerHTML = `
      <div class="cart-head">
        <div>
          <h2>${esc(title())}</h2>
          <div class="muted small">${st.order ? `ออเดอร์ ${orderNo(st.order.order_no)} · เปิดเมื่อ ${fmtTime(st.order.created_at)}` : 'ออเดอร์ใหม่'}</div>
        </div>
        ${st.order ? `<button class="icon-btn" data-act="more" aria-label="ตัวเลือกเพิ่มเติม">${icon('more')}</button>` : ''}
      </div>
      ${st.type === 'takeaway' ? `<div class="cart-customer"><input class="input" data-customer maxlength="60" placeholder="ชื่อลูกค้า / เบอร์โทร (ไม่บังคับ)" value="${esc(customer)}"></div>` : ''}
      <div class="cart-body">
        ${!sent.length && !st.drafts.length ? `<div class="empty">${icon('inbox')}<p>แตะเมนูเพื่อเพิ่มรายการ</p></div>` : ''}
        ${sent.length ? `<div class="cart-group">ส่งครัวแล้ว</div>${sent.map(sentLine).join('')}` : ''}
        ${st.drafts.length ? `<div class="cart-group is-new">รายการใหม่ · ยังไม่ส่งครัว</div>${st.drafts.map(draftLine).join('')}` : ''}
      </div>
      <div class="cart-foot">
        <div class="cart-total"><span>รวมทั้งหมด</span><strong>${baht(total)}</strong></div>
        <div class="cart-actions">
          <button class="btn btn-lg btn-primary" data-act="send" ${draftCount ? '' : 'disabled'}>${icon('send')} ส่งครัว${draftCount ? ` (${draftCount})` : ''}</button>
          <button class="btn btn-lg btn-success" data-act="pay" ${total > 0 ? '' : 'disabled'}>${icon('card')} ชำระเงิน</button>
        </div>
        <button class="btn btn-ghost btn-block" data-act="bill" ${st.order && sentTotal > 0 ? '' : 'disabled'}>${icon('print')} พิมพ์ใบแจ้งยอด</button>
      </div>`;
    $('[data-cartbar]').innerHTML = itemCount
      ? `<button class="cart-bar-btn" data-act="tocart"><span>${itemCount} รายการ${draftCount ? ` · ยังไม่ส่ง ${draftCount}` : ''}</span><strong>${baht(total)}</strong>${icon('down')}</button>`
      : '';
  }

  // ปรับชื่อ/ราคาในรายการที่ยังไม่ส่ง ให้ตรงกับเมนูล่าสุด และตัดเมนูที่ถูกลบออก
  function syncDrafts() {
    const before = st.drafts.length;
    st.drafts = st.drafts.filter((d) => {
      const m = store.menu.find((x) => x.id === d.menu_item_id);
      if (!m) return false;
      d.name = m.name;
      d.price = m.price;
      return true;
    });
    if (st.drafts.length !== before) saveDrafts();
  }

  // ---------- actions ----------
  // ระหว่างกำลังส่งครัว ห้ามแก้รายการที่ยังไม่ส่ง ไม่อย่างนั้นสิ่งที่แก้จะถูกล้างทิ้งตอนส่งเสร็จ
  function draftsLocked() {
    if (st.sending) toast('กำลังส่งครัว รอสักครู่', 'warn');
    return Boolean(st.sending);
  }

  async function onItem(id, el) {
    const m = store.menu.find((x) => x.id === id);
    if (!m) return;
    if (st.soldOut) {
      try {
        await api.patch(`/menu/${id}/available`, { available: !m.available });
        m.available = m.available ? 0 : 1;
        drawMenu();
        toast(m.available ? `เปิดขาย “${m.name}” แล้ว` : `ปิด “${m.name}” แล้ว (ของหมด)`, m.available ? 'success' : 'warn');
      } catch (e) {
        toastError(e);
      }
      return;
    }
    if (!m.available) {
      toast(`“${m.name}” หมดแล้ว`, 'warn');
      return;
    }
    if (draftsLocked()) return;
    const d = st.drafts.find((x) => x.menu_item_id === id && !x.note);
    if (d) d.qty++;
    else st.drafts.push({ key: Math.random().toString(36).slice(2, 10), menu_item_id: id, name: m.name, price: m.price, qty: 1, note: '' });
    saveDrafts();
    drawCart();
    const count = draftCounts()[id];
    let badge = el.querySelector('.mi-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'mi-count';
      el.appendChild(badge);
    }
    badge.textContent = count;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function changeQty(key, delta) {
    const d = st.drafts.find((x) => x.key === key);
    if (!d || draftsLocked()) return;
    d.qty += delta;
    if (d.qty <= 0) st.drafts = st.drafts.filter((x) => x !== d);
    saveDrafts();
    drawCart();
    drawMenu();
  }

  function editNote(key) {
    const d = st.drafts.find((x) => x.key === key);
    if (!d || draftsLocked()) return;
    const m = modal({
      title: `หมายเหตุ · ${d.name}`,
      size: 'sm',
      body: `
        <div class="chips wrap">${NOTE_CHIPS.map((c) => `<button type="button" class="chip-btn" data-chip="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <textarea class="input" rows="2" data-text maxlength="200" placeholder="พิมพ์หมายเหตุเพิ่มเติม" autofocus>${esc(d.note)}</textarea>
        ${d.qty > 1 ? `<label class="check"><input type="checkbox" data-split> ใช้กับ 1 จานเท่านั้น (อีก ${d.qty - 1} จานไม่มีหมายเหตุ)</label>` : ''}`,
      footer: `<button class="btn" data-clear>ล้าง</button><button class="btn btn-primary" data-save>บันทึก</button>`,
    });
    const text = m.el.querySelector('[data-text]');
    m.el.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-chip]');
      if (chip) {
        const parts = text.value.split(',').map((s) => s.trim()).filter(Boolean);
        const i = parts.indexOf(chip.dataset.chip);
        if (i >= 0) parts.splice(i, 1);
        else parts.push(chip.dataset.chip);
        text.value = parts.join(', ');
        text.focus();
      }
      if (e.target.closest('[data-clear]')) text.value = '';
      if (e.target.closest('[data-save]')) {
        const note = text.value.trim();
        if (m.el.querySelector('[data-split]')?.checked && note) {
          d.qty--;
          st.drafts.splice(st.drafts.indexOf(d) + 1, 0, { ...d, key: Math.random().toString(36).slice(2, 10), qty: 1, note });
        } else {
          d.note = note;
        }
        saveDrafts();
        drawCart();
        m.close();
      }
    });
  }

  function customerValue() {
    return root.querySelector('[data-customer]')?.value.trim() || '';
  }

  // กันส่งซ้ำด้วย promise ใน st ไม่ใช่สถานะปุ่ม: ระหว่างรอ drawCart() อาจสร้างปุ่มใหม่
  // และ send() ถูกเรียกได้จากหลายปุ่ม (ส่งครัว / ชำระเงิน / ใบแจ้งยอด)
  function send(btn) {
    if (!st.sending) {
      if (!st.drafts.length) return Promise.resolve(st.order);
      st.sending = busy(btn, postDrafts).finally(() => { st.sending = null; });
    }
    return st.sending;
  }

  async function postDrafts() {
    try {
      const res = await api.post('/orders/send', {
        order_id: st.order?.id,
        type: st.type,
        table_id: st.table?.id,
        customer_name: customerValue(),
        items: st.drafts.map((d) => ({ menu_item_id: d.menu_item_id, qty: d.qty, note: d.note })),
      });
      storage.remove(draftKey());
      st.drafts = [];
      const wasNew = !st.order;
      st.order = res.order;
      if (wasNew && st.type === 'takeaway') history.replaceState(null, '', `#/pos/order/${st.order.id}`);
      drawMenu();
      drawCart();
      toast(`ส่งเข้าครัวแล้ว · ${orderLabel(st.order)}`, 'success');
      if (flag('print_kitchen_on_send')) printKitchenTicket(res.ticket);
      return res.order;
    } catch (e) {
      toastError(e);
      return null;
    }
  }

  async function pay(btn) {
    if (st.drafts.length) {
      const ok = await send(btn);
      if (!ok) return;
    }
    if (!st.order) return;
    st.paying = true;
    const paid = await openPayment(st.order);
    st.paying = false;
    if (paid) location.hash = '#/pos';
    else reload();
  }

  async function bill(btn) {
    if (st.drafts.length) {
      const go = await confirmDialog('มีรายการที่ยังไม่ส่งครัว ต้องการส่งครัวก่อนพิมพ์ใบแจ้งยอดหรือไม่?', { ok: 'ส่งครัวแล้วพิมพ์' });
      if (!go || !(await send(btn))) return;
    }
    printBill(st.order);
  }

  async function voidItem(itemId) {
    const it = st.order?.items.find((i) => i.id === itemId);
    if (!it) return;
    let qty = it.qty;
    const m = modal({
      title: 'ยกเลิกรายการ',
      size: 'sm',
      body: `
        <p class="confirm-text">ยกเลิก “${esc(it.name)}”${it.note ? ` (${esc(it.note)})` : ''} ที่ส่งครัวแล้ว? ครัวจะเห็นว่ารายการนี้ถูกยกเลิก</p>
        ${it.qty > 1 ? `<div class="field-inline"><span>จำนวนที่ยกเลิก</span>
          <div class="stepper"><button data-q="-1" aria-label="ลด">${icon('minus')}</button><span data-qv>${qty}</span><button data-q="1" aria-label="เพิ่ม">${icon('plus')}</button></div>
          <span class="muted">จาก ${it.qty}</span></div>` : ''}`,
      footer: `<button class="btn" data-close>ไม่ยกเลิก</button><button class="btn btn-danger" data-ok>ยกเลิกรายการ</button>`,
    });
    m.el.addEventListener('click', async (e) => {
      const step = e.target.closest('[data-q]');
      if (step) {
        qty = Math.min(Math.max(qty + Number(step.dataset.q), 1), it.qty);
        m.el.querySelector('[data-qv]').textContent = qty;
      }
      const ok = e.target.closest('[data-ok]');
      if (ok) {
        await busy(ok, async () => {
          try {
            st.order = await api.post(`/order-items/${it.id}/void`, { qty });
            drawCart();
            m.close();
            toast('ยกเลิกรายการแล้ว');
          } catch (err) {
            toastError(err);
          }
        });
      }
    });
  }

  function moreMenu() {
    const m = modal({
      title: `${title()} · ${orderNo(st.order.order_no)}`,
      size: 'sm',
      body: `
        <div class="action-list">
          <button class="btn btn-block" data-a="move">${icon('move')} ${st.type === 'dine_in' ? 'ย้ายโต๊ะ' : 'ย้ายไปนั่งที่โต๊ะ'}</button>
          <button class="btn btn-block" data-a="bill">${icon('print')} พิมพ์ใบแจ้งยอด</button>
          <button class="btn btn-block btn-danger-ghost" data-a="cancel">${icon('trash')} ยกเลิกออเดอร์ทั้งหมด</button>
        </div>`,
    });
    m.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      m.close();
      if (a === 'move') moveTable();
      if (a === 'bill') bill(null);
      if (a === 'cancel') cancelOrder();
    });
  }

  async function moveTable() {
    let overview;
    try {
      overview = await api.get('/pos/overview');
    } catch (e) {
      return toastError(e);
    }
    const free = overview.tables.filter((t) => !t.order);
    const m = modal({
      title: 'ย้ายไปโต๊ะ',
      body: free.length
        ? `<div class="tgrid small">${free.map((t) => `<button class="tcard free" data-t="${t.id}"><div class="tcard-name">${esc(t.name)}</div><div class="tcard-meta">ว่าง</div></button>`).join('')}</div>`
        : '<div class="empty small">ไม่มีโต๊ะว่าง</div>',
    });
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      try {
        const oldKey = draftKey();
        const o = await api.post(`/orders/${st.order.id}/move`, { table_id: Number(b.dataset.t) });
        if (st.drafts.length) {
          storage.remove(oldKey);
          storage.set(`draft:t${o.table_id}`, st.drafts);
        }
        m.close();
        toast(`ย้ายไป ${o.table_name} แล้ว`, 'success');
        location.hash = `#/pos/table/${o.table_id}`;
      } catch (err) {
        toastError(err);
      }
    });
  }

  async function cancelOrder() {
    const m = modal({
      title: 'ยกเลิกออเดอร์',
      size: 'sm',
      body: `
        <p class="confirm-text">ยกเลิก ${esc(title())} ${orderNo(st.order.order_no)} ทั้งออเดอร์? ยอดนี้จะไม่ถูกนับเป็นยอดขาย</p>
        <label class="field"><span>เหตุผล (ไม่บังคับ)</span><input class="input" data-reason maxlength="200" placeholder="เช่น ลูกค้ายกเลิก"></label>`,
      footer: `<button class="btn" data-close>ไม่ยกเลิก</button><button class="btn btn-danger" data-ok>ยกเลิกออเดอร์</button>`,
    });
    m.el.querySelector('[data-ok]').addEventListener('click', async (e) => {
      await busy(e.currentTarget, async () => {
        try {
          await api.post(`/orders/${st.order.id}/cancel`, { reason: m.el.querySelector('[data-reason]').value });
          storage.remove(draftKey());
          st.paying = true; // กันไม่ให้ reload แจ้งเตือนซ้ำ
          m.close();
          toast('ยกเลิกออเดอร์แล้ว');
          location.hash = '#/pos';
        } catch (err) {
          toastError(err);
        }
      });
    });
  }

  const reload = serial(async () => {
    if (!ctx.alive || st.paying) return;
    try {
      if (st.type === 'dine_in') {
        const d = await api.get(`/pos/table/${st.table.id}`);
        if (st.order && (!d.order || d.order.id !== st.order.id)) {
          const o = await api.get(`/orders/${st.order.id}`);
          if (!ctx.alive || st.paying) return;
          if (o.status !== 'open') {
            toast(o.status === 'paid' ? 'ออเดอร์นี้ชำระเงินแล้ว' : 'ออเดอร์นี้ถูกยกเลิกแล้ว');
            location.hash = '#/pos';
          } else {
            toast(`ออเดอร์ถูกย้ายไป ${o.table_name}`);
            location.hash = `#/pos/table/${o.table_id}`;
          }
          return;
        }
        st.order = d.order;
      } else if (st.order) {
        const o = await api.get(`/orders/${st.order.id}`);
        if (!ctx.alive || st.paying) return;
        if (o.status !== 'open') {
          toast(o.status === 'paid' ? 'ออเดอร์นี้ชำระเงินแล้ว' : 'ออเดอร์นี้ถูกยกเลิกแล้ว');
          location.hash = '#/pos';
          return;
        }
        st.order = o;
      }
      drawCart();
    } catch (e) {
      console.error(e);
    }
  });

  // ---------- events ----------
  root.addEventListener('click', (e) => {
    const t = e.target;
    const item = t.closest('[data-item]');
    if (item) return onItem(Number(item.dataset.item), item);
    const cat = t.closest('[data-cat]');
    if (cat) {
      st.cat = cat.dataset.cat;
      st.search = '';
      $('[data-search]').value = '';
      return drawMenu();
    }
    const inc = t.closest('[data-inc]');
    if (inc) return changeQty(inc.dataset.inc, 1);
    const dec = t.closest('[data-dec]');
    if (dec) return changeQty(dec.dataset.dec, -1);
    const note = t.closest('[data-note]');
    if (note) return editNote(note.dataset.note);
    const v = t.closest('[data-void]');
    if (v) return voidItem(Number(v.dataset.void));
    const actBtn = t.closest('[data-act]');
    if (!actBtn) return;
    switch (actBtn.dataset.act) {
      case 'soldout':
        st.soldOut = !st.soldOut;
        actBtn.setAttribute('aria-pressed', String(st.soldOut));
        actBtn.classList.toggle('btn-warn', st.soldOut);
        $('[data-soldout-label]').textContent = st.soldOut ? 'เสร็จ' : 'ของหมด';
        $('[data-soldout-hint]').hidden = !st.soldOut;
        drawMenu();
        break;
      case 'send': send(actBtn); break;
      case 'pay': pay(actBtn); break;
      case 'bill': bill(actBtn); break;
      case 'more': moreMenu(); break;
      case 'tocart': $('[data-cart]').scrollIntoView({ behavior: 'smooth' }); break;
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-search]')) {
      st.search = e.target.value;
      drawMenu();
    }
    if (e.target.matches('[data-customer]') && !st.order) st.customer = e.target.value;
  });
  root.addEventListener('change', async (e) => {
    if (e.target.matches('[data-customer]') && st.order) {
      try {
        st.order = await api.put(`/orders/${st.order.id}`, { customer_name: e.target.value });
      } catch (err) {
        toastError(err);
      }
    }
  });

  ctx.on('orders', reload);
  ctx.on('store:menu', () => {
    syncDrafts();
    drawMenu();
    drawCart();
  });
  drawMenu();
  drawCart();
}
