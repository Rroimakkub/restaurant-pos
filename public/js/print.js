// พิมพ์ใบเสร็จ / ใบแจ้งยอด / ใบสั่งครัว / สรุปปิดยอด สำหรับเครื่องพิมพ์ความร้อน 58 หรือ 80 มม.
import { api, esc, num, baht, fmtDate, fmtTime, fmtDateTime, localDate, orderNo, PAY_LABEL, toastError } from './lib.js';
import { store, flag } from './store.js';

function printCss(width) {
  const w = width === 58 ? 58 : 80;
  const content = w === 58 ? 48 : 72;
  return `
    @page { size: ${w}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: ${w}mm; padding: 3mm ${(w - content) / 2}mm 6mm; color: #000;
      font-family: Tahoma, "Leelawadee UI", "Noto Sans Thai", sans-serif; font-size: ${w === 58 ? 11 : 12.5}px; line-height: 1.4; }
    .c { text-align: center; }
    .b { font-weight: bold; }
    .lg { font-size: 1.3em; }
    .xl { font-size: 1.9em; line-height: 1.2; }
    .muted { color: #333; font-size: .92em; }
    hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; }
    .row > span:last-child { text-align: right; white-space: nowrap; }
    .item { margin: 3px 0; }
    .note { padding-left: 1.2em; font-size: .92em; }
    .qr { display: block; width: ${w === 58 ? 40 : 52}mm; margin: 4px auto; }
    .qr svg { width: 100%; height: auto; display: block; }
    .k-item { display: flex; gap: 8px; font-size: 1.35em; margin: 6px 0; font-weight: bold; }
    .k-item .q { min-width: 2.2em; }
    .k-item .note { font-size: .8em; font-weight: normal; padding-left: 0; }
    .void { text-decoration: line-through; }
  `;
}

export function printHtml(html) {
  const width = Number(store.settings.paper_width) || 80;
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>print</title><style>${printCss(width)}</style></head><body>${html}</body></html>`);
  doc.close();
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  }, 200);
}

// รวมรายการที่ชื่อ ราคา และหมายเหตุเหมือนกัน (เช่นสั่งเพิ่มหลายรอบ) ให้เป็นบรรทัดเดียวบนใบเสร็จ
function mergedItems(items) {
  const map = new Map();
  for (const it of items) {
    if (it.status !== 'active') continue;
    const key = `${it.name}|${it.price}|${it.note || ''}`;
    const row = map.get(key);
    if (row) row.qty += it.qty;
    else map.set(key, { name: it.name, price: it.price, note: it.note, qty: it.qty });
  }
  return [...map.values()];
}

function shopHeader() {
  const s = store.settings;
  return `
    <div class="c b lg">${esc(s.shop_name)}</div>
    ${s.shop_address ? `<div class="c muted">${esc(s.shop_address)}</div>` : ''}
    ${s.shop_phone ? `<div class="c muted">โทร ${esc(s.shop_phone)}</div>` : ''}
    ${s.tax_id ? `<div class="c muted">เลขประจำตัวผู้เสียภาษี ${esc(s.tax_id)}</div>` : ''}`;
}

function orderWhere(o) {
  return o.type === 'dine_in' ? esc(o.table_name || '') : 'กลับบ้าน' + (o.customer_name ? ` · ${esc(o.customer_name)}` : '');
}

function receiptBody(order, { isBill = false, qrSvg = '' } = {}) {
  const items = mergedItems(order.items);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const when = isBill ? nowLocalString() : order.paid_at;
  return `
    ${shopHeader()}
    <hr>
    <div class="c b">${isBill ? 'ใบแจ้งรายการอาหาร' : 'ใบเสร็จรับเงิน'}</div>
    <div class="row"><span>เลขที่ ${orderNo(order.order_no)}</span><span>${orderWhere(order)}</span></div>
    <div class="row muted"><span>${fmtDate(when)}</span><span>${fmtTime(when)}</span></div>
    <hr>
    ${items.map((i) => `
      <div class="item">
        <div class="row"><span>${i.qty} x ${esc(i.name)}</span><span>${num(i.price * i.qty)}</span></div>
        ${i.note ? `<div class="note">- ${esc(i.note)}</div>` : ''}
      </div>`).join('')}
    <hr>
    <div class="row"><span>รวม ${items.reduce((s, i) => s + i.qty, 0)} รายการ</span><span>${num(subtotal)}</span></div>
    ${!isBill && order.discount > 0 ? `<div class="row"><span>ส่วนลด</span><span>-${num(order.discount)}</span></div>` : ''}
    <div class="row b lg"><span>${isBill ? 'ยอดที่ต้องชำระ' : 'ยอดสุทธิ'}</span><span>${baht(isBill ? subtotal : order.total)}</span></div>
    ${!isBill ? `
      <div class="row"><span>ชำระโดย</span><span>${PAY_LABEL[order.payment_method] || '-'}</span></div>
      ${order.payment_method === 'cash' ? `
        <div class="row"><span>รับเงิน</span><span>${num(order.cash_received)}</span></div>
        <div class="row"><span>เงินทอน</span><span>${num(order.change_amount)}</span></div>` : ''}` : ''}
    ${qrSvg ? `<hr><div class="c b">สแกนจ่ายด้วยพร้อมเพย์</div><div class="qr">${qrSvg}</div>
      ${store.settings.promptpay_name ? `<div class="c muted">${esc(store.settings.promptpay_name)}</div>` : ''}` : ''}
    <hr>
    ${store.settings.receipt_footer ? `<div class="c">${esc(store.settings.receipt_footer)}</div>` : ''}
  `;
}

export function printReceipt(order) {
  printHtml(receiptBody(order));
}

export async function printBill(order) {
  let qrSvg = '';
  if (flag('bill_show_qr') && store.settings.promptpay_id && order.total > 0) {
    try {
      qrSvg = (await api.get(`/promptpay/qr?amount=${order.total}`)).svg;
    } catch (e) {
      toastError(e);
    }
  }
  printHtml(receiptBody(order, { isBill: true, qrSvg }));
}

export function printKitchenTicket(t) {
  const where = t.type === 'dine_in' ? esc(t.table_name || '') : 'กลับบ้าน';
  printHtml(`
    <div class="c b xl">${where}</div>
    <div class="c">ออเดอร์ ${orderNo(t.order_no)}${t.prior_tickets > 0 ? ' · สั่งเพิ่ม' : ''}${t.customer_name ? ` · ${esc(t.customer_name)}` : ''}</div>
    <div class="c muted">${fmtDateTime(t.created_at)}</div>
    ${t.order_status === 'cancelled' ? '<div class="c b lg">*** ออเดอร์ถูกยกเลิก ***</div>' : ''}
    <hr>
    ${t.items.map((i) => `
      <div class="k-item ${i.status === 'void' ? 'void' : ''}">
        <span class="q">${i.qty}x</span>
        <span>${esc(i.name)}${i.status === 'void' ? ' (ยกเลิก)' : ''}${i.note ? `<div class="note">** ${esc(i.note)}</div>` : ''}</span>
      </div>`).join('')}
    <hr>
  `);
}

export function printClosing(c) {
  printHtml(`
    ${shopHeader()}
    <hr>
    <div class="c b">สรุปปิดยอดเงินสด</div>
    <div class="c">${fmtDate(c.biz_date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
    <hr>
    <div class="row"><span>เงินทอนตั้งต้น</span><span>${num(c.opening_cash)}</span></div>
    <div class="row"><span>+ ขายเงินสด</span><span>${num(c.cash_sales)}</span></div>
    <div class="row"><span>- จ่ายจากลิ้นชัก</span><span>${num(c.cash_expenses)}</span></div>
    <div class="row b"><span>เงินสดที่ควรมี</span><span>${num(c.expected_cash)}</span></div>
    <div class="row b"><span>นับได้จริง</span><span>${num(c.counted_cash)}</span></div>
    <div class="row b lg"><span>${c.difference >= 0 ? 'เกิน' : 'ขาด'}</span><span>${num(Math.abs(c.difference))}</span></div>
    <hr>
    <div class="row"><span>ยอดพร้อมเพย์ (ไม่อยู่ในลิ้นชัก)</span><span>${num(c.promptpay_sales)}</span></div>
    ${c.note ? `<div class="muted">หมายเหตุ: ${esc(c.note)}</div>` : ''}
    <div class="muted">ปิดยอดเมื่อ ${fmtDateTime(c.closed_at)}</div>
  `);
}

function nowLocalString() {
  const d = new Date();
  return `${localDate(d)} ${d.toTimeString().slice(0, 8)}`;
}
