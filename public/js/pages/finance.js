// รายรับรายจ่าย: สรุปรายวัน, บันทึกค่าใช้จ่าย, ปิดยอดเงินสดสิ้นวัน
import {
  api, esc, baht, num, r2, icon, toast, toastError, modal, confirmDialog, formValues, busy,
  today, addDays, fmtDate, fmtTime, fmtDateTime, orderNo, orderLabel, PAY_LABEL,
} from '../lib.js';
import { printReceipt, printClosing } from '../print.js';

export const EXPENSE_CATEGORIES = ['วัตถุดิบ', 'ค่าแก๊ส', 'ค่าเช่า', 'ค่าแรง', 'ค่าน้ำ/ค่าไฟ', 'บรรจุภัณฑ์', 'อื่นๆ'];
const TABS = [
  { key: 'day', label: 'สรุปรายวัน' },
  { key: 'expenses', label: 'ค่าใช้จ่าย' },
  { key: 'closing', label: 'ปิดยอดเงินสด' },
];
const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

export default {
  async render(root, params, ctx) {
    const tab = TABS.some((t) => t.key === params[0]) ? params[0] : 'day';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params[1] || '') ? params[1] : today();
    root.innerHTML = `
      <div class="page">
        <header class="page-head"><div><h1>รายรับรายจ่าย</h1></div></header>
        <div class="tabs" role="tablist">
          ${TABS.map((t) => `<a role="tab" href="#/finance/${t.key}${t.key !== 'expenses' ? '/' + date : ''}" class="${t.key === tab ? 'active' : ''}">${t.label}</a>`).join('')}
        </div>
        <div data-content></div>
      </div>`;
    const el = root.querySelector('[data-content]');
    if (tab === 'day') return dayTab(el, ctx, date);
    if (tab === 'expenses') return expensesTab(el, ctx);
    return closingTab(el, ctx, date);
  },
};

function dateNav(base, date) {
  return `
    <div class="date-nav">
      <a class="icon-btn" href="#/finance/${base}/${addDays(date, -1)}" aria-label="วันก่อนหน้า">${icon('back')}</a>
      <input class="input" type="date" value="${date}" data-date max="${today()}" aria-label="เลือกวันที่">
      <a class="icon-btn" href="#/finance/${base}/${addDays(date, 1)}" aria-label="วันถัดไป" ${date >= today() ? 'aria-disabled="true" tabindex="-1" style="visibility:hidden"' : ''}>${icon('next')}</a>
      ${date !== today() ? `<a class="btn btn-sm" href="#/finance/${base}/${today()}">วันนี้</a>` : ''}
      <span class="date-nav-label">${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
    </div>`;
}
function wireDateNav(el, base) {
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-date]') && e.target.value) location.hash = `#/finance/${base}/${e.target.value}`;
  });
}

// ยอดเงินสดเปลี่ยนหลังบันทึกปิดยอด (เช่น มีบิลเพิ่มหรือยกเลิกบิล) → ควรปิดยอดใหม่
const closingStale = (c, cashSales, cashExpenses) => r2(c.cash_sales) !== r2(cashSales) || r2(c.cash_expenses) !== r2(cashExpenses);

const kpi = (label, value, extra = '', cls = '') =>
  `<div class="kpi ${cls}"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${extra ? `<div class="kpi-extra">${extra}</div>` : ''}</div>`;

// =====================================================================
// สรุปรายวัน
// =====================================================================
async function dayTab(el, ctx, date) {
  el.innerHTML = `${dateNav('day', date)}<div data-body><div class="page-loading">กำลังโหลด…</div></div>`;
  wireDateNav(el, 'day');
  const body = el.querySelector('[data-body]');
  let bills = [];

  async function load() {
    try {
      const [sum, list, exps] = await Promise.all([
        api.get(`/finance/day?date=${date}`),
        api.get(`/orders?date=${date}`),
        api.get(`/expenses?from=${date}&to=${date}`),
      ]);
      if (!ctx.alive) return;
      bills = list;
      const s = sum.sales;
      const profit = r2(s.total - sum.expenses.total);
      body.innerHTML = `
        <div class="kpi-grid">
          ${kpi('ยอดขาย', baht(s.total), `${s.bills} บิล${s.discount ? ` · ส่วนลด ${baht(s.discount)}` : ''}`, 'kpi-hero')}
          ${kpi('เงินสด', baht(s.cash))}
          ${kpi('พร้อมเพย์', baht(s.promptpay))}
          ${kpi('ค่าใช้จ่าย', baht(sum.expenses.total), sum.expenses.cash ? `จ่ายจากลิ้นชัก ${baht(sum.expenses.cash)}` : '')}
          ${kpi('กำไรคร่าวๆ', baht(profit), 'ยอดขาย − ค่าใช้จ่าย', profit >= 0 ? 'kpi-good' : 'kpi-bad')}
        </div>
        ${!sum.closing
          ? `<div class="alert alert-info">${icon('clock')}<div>ยังไม่ได้ปิดยอดเงินสดของวันนี้ <a class="btn btn-sm" href="#/finance/closing/${date}">ปิดยอด</a></div></div>`
          : closingStale(sum.closing, s.cash, sum.expenses.cash)
            ? `<div class="alert alert-warn">${icon('alert')}<div>มีบิลหรือค่าใช้จ่ายเงินสดเปลี่ยนหลังปิดยอดเมื่อ ${fmtTime(sum.closing.closed_at)} <a class="btn btn-sm" href="#/finance/closing/${date}">ปิดยอดใหม่</a></div></div>`
            : `<div class="alert alert-ok">${icon('check')}<div>ปิดยอดแล้วเมื่อ ${fmtTime(sum.closing.closed_at)} · เงินสด${sum.closing.difference === 0 ? 'ตรงพอดี' : sum.closing.difference > 0 ? `เกิน ${baht(sum.closing.difference)}` : `ขาด ${baht(-sum.closing.difference)}`} <a href="#/finance/closing/${date}">ดูรายละเอียด</a></div></div>`}
        <div class="two-col">
          <section class="card">
            <div class="card-head"><h2>บิลขาย</h2><span class="muted small">${list.length} รายการ</span></div>
            ${list.length ? `
              <div class="table-wrap flat">
                <table class="data">
                  <thead><tr><th>เวลา</th><th>เลขที่</th><th>โต๊ะ / ประเภท</th><th>ชำระ</th><th class="num">ยอด</th><th></th></tr></thead>
                  <tbody>${list.map((o) => `
                    <tr class="${o.status === 'cancelled' ? 'is-cancelled' : ''}">
                      <td class="nowrap">${fmtTime(o.paid_at || o.cancelled_at)}</td>
                      <td>${orderNo(o.order_no)}</td>
                      <td>${esc(orderLabel(o))}</td>
                      <td>${o.status === 'cancelled' ? `<span class="chip chip-danger">${icon('ban')} ยกเลิก</span>` : PAY_LABEL[o.payment_method]}</td>
                      <td class="num">${baht(o.total)}</td>
                      <td><button class="btn btn-sm" data-bill="${o.id}">ดู</button></td>
                    </tr>`).join('')}
                  </tbody>
                </table>
              </div>` : '<div class="empty small">ยังไม่มีบิลขายในวันนี้</div>'}
          </section>
          <section class="card">
            <div class="card-head"><h2>ค่าใช้จ่ายวันนี้</h2><button class="btn btn-sm btn-primary" data-add-exp>${icon('plus')} เพิ่ม</button></div>
            ${exps.length ? `<ul class="exp-list">${exps.map((x) => `
              <li><div><strong>${esc(x.category)}</strong>${x.note ? `<div class="muted small">${esc(x.note)}</div>` : ''}</div>
                <div class="num">${baht(x.amount)}<div class="muted small">${x.payment_method === 'cash' ? 'จากลิ้นชัก' : 'โอน/อื่นๆ'}</div></div></li>`).join('')}</ul>`
              : '<div class="empty small">ยังไม่มีค่าใช้จ่าย</div>'}
          </section>
        </div>`;
    } catch (e) {
      toastError(e);
    }
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bill]');
    if (b) return showBill(Number(b.dataset.bill));
    if (e.target.closest('[data-add-exp]')) editExpense(null, date);
  });

  async function showBill(id) {
    let o;
    try {
      o = await api.get(`/orders/${id}`);
    } catch (e) {
      return toastError(e);
    }
    const active = o.items.filter((i) => i.status === 'active');
    const m = modal({
      title: `บิล ${orderNo(o.order_no)} · ${orderLabel(o)}`,
      body: `
        <div class="bill-view">
          <div class="muted small">${o.paid_at ? `ชำระเมื่อ ${fmtDateTime(o.paid_at)} · ${PAY_LABEL[o.payment_method]}` : `เปิดเมื่อ ${fmtDateTime(o.created_at)}`}</div>
          ${o.status === 'cancelled' ? `<div class="alert alert-danger">${icon('ban')}<div>ยกเลิกเมื่อ ${fmtDateTime(o.cancelled_at)}${o.cancel_reason ? ` · ${esc(o.cancel_reason)}` : ''}</div></div>` : ''}
          <table class="data compact">
            <tbody>${o.items.map((i) => `<tr class="${i.status === 'void' ? 'is-cancelled' : ''}"><td>${i.qty} × ${esc(i.name)}${i.note ? `<div class="muted small">${esc(i.note)}</div>` : ''}${i.status === 'void' ? ' <span class="chip chip-danger">ยกเลิก</span>' : ''}</td><td class="num">${num(i.price * i.qty)}</td></tr>`).join('')}</tbody>
            <tfoot>
              <tr><td>รวม</td><td class="num">${num(active.reduce((s, i) => s + i.price * i.qty, 0))}</td></tr>
              ${o.discount ? `<tr><td>ส่วนลด</td><td class="num">-${num(o.discount)}</td></tr>` : ''}
              <tr class="strong"><td>ยอดสุทธิ</td><td class="num">${baht(o.total)}</td></tr>
              ${o.payment_method === 'cash' ? `<tr><td class="muted">รับเงิน / เงินทอน</td><td class="num muted">${num(o.cash_received)} / ${num(o.change_amount)}</td></tr>` : ''}
            </tfoot>
          </table>
        </div>`,
      footer: o.status === 'paid'
        ? `<button class="btn btn-danger-ghost" data-void-bill>${icon('ban')} ยกเลิกบิล</button><button class="btn btn-primary" data-reprint>${icon('print')} พิมพ์ใบเสร็จซ้ำ</button>`
        : '<button class="btn" data-close>ปิด</button>',
    });
    m.el.querySelector('[data-reprint]')?.addEventListener('click', () => printReceipt(o));
    m.el.querySelector('[data-void-bill]')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`ยกเลิกบิล ${orderNo(o.order_no)} ยอด ${baht(o.total)}? ยอดนี้จะถูกหักออกจากยอดขาย (เช่น คืนเงินลูกค้า)`, { danger: true, ok: 'ยกเลิกบิล' }))) return;
      try {
        await api.post(`/orders/${o.id}/cancel`, { reason: 'ยกเลิกบิลหลังชำระเงิน', void_paid: true });
        m.close();
        toast('ยกเลิกบิลแล้ว');
      } catch (err) {
        toastError(err);
      }
    });
  }

  ctx.on('sales', load);
  ctx.on('expenses', load);
  ctx.on('closing', load);
  await load();
}

// =====================================================================
// ค่าใช้จ่าย
// =====================================================================
export function editExpense(item, defaultDate) {
  const cats = [...new Set([...EXPENSE_CATEGORIES, ...(item ? [item.category] : [])])];
  const m = modal({
    title: item ? 'แก้ไขค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่าย',
    body: `
      <form class="form-grid" data-form>
        <div class="field span-2"><span>หมวด</span>
          <div class="chips wrap" data-cats>${cats.map((c) => `<label class="chip-radio"><input type="radio" name="category" value="${esc(c)}" ${(item ? item.category === c : c === 'วัตถุดิบ') ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
        </div>
        <label class="field"><span>จำนวนเงิน (บาท)</span><input class="input input-xl" name="amount" inputmode="decimal" value="${item ? item.amount : ''}" placeholder="0" autofocus></label>
        <label class="field"><span>วันที่</span><input class="input" type="date" name="biz_date" value="${item ? item.biz_date : defaultDate || today()}"></label>
        <label class="field span-2"><span>รายละเอียด</span><input class="input" name="note" maxlength="200" value="${esc(item?.note)}" placeholder="เช่น แก๊ส 1 ถัง, ค่าแรงพนักงาน 2 คน"></label>
        <div class="field span-2"><span>จ่ายเงินจาก</span>
          <div class="seg">
            <label><input type="radio" name="payment_method" value="cash" ${!item || item.payment_method === 'cash' ? 'checked' : ''}><span>เงินสดในลิ้นชัก</span></label>
            <label><input type="radio" name="payment_method" value="transfer" ${item?.payment_method === 'transfer' ? 'checked' : ''}><span>โอน / เงินส่วนตัว</span></label>
          </div>
          <span class="muted small">“เงินสดในลิ้นชัก” จะถูกหักตอนปิดยอดเงินสดของวันนั้น</span>
        </div>
      </form>`,
    footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-save>บันทึก</button>`,
  });
  const form = m.el.querySelector('[data-form]');
  const save = async () => {
    await busy(m.el.querySelector('[data-save]'), async () => {
      try {
        const v = formValues(form);
        if (item) await api.put(`/expenses/${item.id}`, v);
        else await api.post('/expenses', v);
        m.close();
        toast('บันทึกค่าใช้จ่ายแล้ว', 'success');
      } catch (e) {
        toastError(e);
      }
    });
  };
  m.el.querySelector('[data-save]').addEventListener('click', save);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

async function expensesTab(el, ctx) {
  const month = sessionStorage.getItem('fin.month') || today().slice(0, 7);
  el.innerHTML = `
    <div class="toolbar">
      <label class="field-inline"><span>เดือน</span><input class="input" type="month" value="${month}" data-month></label>
      <button class="btn btn-primary" data-add>${icon('plus')} เพิ่มค่าใช้จ่าย</button>
    </div>
    <div data-body></div>`;
  const body = el.querySelector('[data-body]');
  let list = [];

  async function load() {
    const mVal = el.querySelector('[data-month]').value || today().slice(0, 7);
    const [y, mo] = mVal.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    try {
      list = await api.get(`/expenses?from=${mVal}-01&to=${mVal}-${String(last).padStart(2, '0')}`);
      if (!ctx.alive) return;
      const total = list.reduce((s, x) => s + x.amount, 0);
      const byCat = {};
      for (const x of list) byCat[x.category] = (byCat[x.category] || 0) + x.amount;
      body.innerHTML = `
        <div class="kpi-grid">
          ${kpi('ค่าใช้จ่ายทั้งเดือน', baht(total), `${list.length} รายการ`, 'kpi-hero')}
          ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => kpi(esc(c), baht(v))).join('')}
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>วันที่</th><th>หมวด</th><th>รายละเอียด</th><th>จ่ายจาก</th><th class="num">จำนวนเงิน</th><th></th></tr></thead>
            <tbody>
              ${list.map((x) => `<tr>
                <td class="nowrap">${fmtDate(x.biz_date)}</td>
                <td><strong>${esc(x.category)}</strong>${x.source === 'stock' ? ' <span class="chip chip-info">จากสต็อก</span>' : ''}</td>
                <td class="muted">${esc(x.note || '')}</td>
                <td class="nowrap">${x.payment_method === 'cash' ? 'ลิ้นชัก' : 'โอน/อื่นๆ'}</td>
                <td class="num">${baht(x.amount)}</td>
                <td class="row-actions">
                  <button class="icon-btn" data-edit="${x.id}" aria-label="แก้ไข">${icon('edit')}</button>
                  <button class="icon-btn danger" data-del="${x.id}" aria-label="ลบ">${icon('trash')}</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="6"><div class="empty small">ยังไม่มีค่าใช้จ่ายในเดือนนี้</div></td></tr>'}
            </tbody>
          </table>
        </div>`;
    } catch (e) {
      toastError(e);
    }
  }

  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-month]')) {
      sessionStorage.setItem('fin.month', e.target.value);
      load();
    }
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) return editExpense(null);
    const ed = e.target.closest('[data-edit]');
    if (ed) return editExpense(list.find((x) => x.id === Number(ed.dataset.edit)));
    const del = e.target.closest('[data-del]');
    if (del) {
      const x = list.find((i) => i.id === Number(del.dataset.del));
      if (await confirmDialog(`ลบค่าใช้จ่าย “${x.category}” ${baht(x.amount)}?`, { danger: true, ok: 'ลบ' })) {
        try {
          await api.del(`/expenses/${x.id}`);
          toast('ลบแล้ว');
        } catch (err) {
          toastError(err);
        }
      }
    }
  });
  ctx.on('expenses', load);
  await load();
}

// =====================================================================
// ปิดยอดเงินสด
// =====================================================================
async function closingTab(el, ctx, date) {
  el.innerHTML = `${dateNav('closing', date)}<div data-body><div class="page-loading">กำลังโหลด…</div></div>`;
  wireDateNav(el, 'closing');
  const body = el.querySelector('[data-body]');
  let data = null;

  async function load() {
    try {
      const [d, history] = await Promise.all([api.get(`/cash-closing?date=${date}`), api.get('/cash-closings')]);
      if (!ctx.alive) return;
      data = d;
      const saved = d.saved;
      body.innerHTML = `
        ${d.open_orders && date === today() ? `<div class="alert alert-warn">${icon('alert')}<div>ยังมีออเดอร์ที่ยังไม่ชำระเงิน ${d.open_orders} ออเดอร์ — ยอดเหล่านี้ยังไม่ถูกนับ</div></div>` : ''}
        ${saved && closingStale(saved, d.cash_sales, d.cash_expenses)
          ? `<div class="alert alert-warn">${icon('alert')}<div>ยอดเงินสดเปลี่ยนไปหลังปิดยอดเมื่อ ${fmtDateTime(saved.closed_at)} (ตอนปิด: ขาย ${baht(saved.cash_sales)} จ่าย ${baht(saved.cash_expenses)}) — นับเงินแล้วบันทึกใหม่</div></div>`
          : saved ? `<div class="alert alert-ok">${icon('check')}<div>ปิดยอดแล้วเมื่อ ${fmtDateTime(saved.closed_at)} — แก้ไขแล้วกดบันทึกใหม่ได้</div></div>` : ''}
        <div class="two-col">
          <section class="card">
            <form data-form class="closing">
              <div class="cl-row"><label for="opening">เงินทอนตั้งต้น</label><input class="input input-num" id="opening" name="opening_cash" inputmode="decimal" value="${d.opening_cash}"></div>
              <div class="cl-row"><span>+ ขายได้เป็นเงินสด <span class="muted small">(${d.bills} บิลทั้งหมด)</span></span><strong>${baht(d.cash_sales)}</strong></div>
              <div class="cl-row"><span>− ค่าใช้จ่ายที่จ่ายจากลิ้นชัก</span><strong>${baht(d.cash_expenses)}</strong></div>
              <div class="cl-row cl-total"><span>เงินสดที่ควรมีในลิ้นชัก</span><strong data-expected></strong></div>
              <div class="cl-row"><label for="counted">เงินสดที่นับได้จริง</label><input class="input input-num input-xl" id="counted" name="counted_cash" inputmode="decimal" value="${saved ? saved.counted_cash : ''}" placeholder="0" autofocus></div>
              <details class="denoms">
                <summary>ช่วยนับแบงก์ / เหรียญ</summary>
                <div class="denom-grid">${DENOMS.map((v) => `<label><span>${num(v)}</span><input class="input input-num" data-denom="${v}" inputmode="numeric" placeholder="0" aria-label="จำนวน ${v} บาท"></label>`).join('')}</div>
              </details>
              <div class="cl-row cl-diff" data-diff></div>
              <label class="field"><span>หมายเหตุ</span><input class="input" name="note" maxlength="300" value="${esc(saved?.note)}" placeholder="เช่น ทอนเงินผิด, หยิบไปซื้อน้ำแข็ง"></label>
              <div class="form-actions">
                ${saved ? `<button type="button" class="btn" data-print>${icon('print')} พิมพ์สรุป</button>` : ''}
                <button class="btn btn-primary btn-lg" data-save>${icon('lock')} ${saved ? 'บันทึกใหม่' : 'บันทึกปิดยอด'}</button>
              </div>
            </form>
            <p class="muted small">ยอดพร้อมเพย์วันนี้ ${baht(d.promptpay_sales)} เข้าบัญชีโดยตรง ไม่อยู่ในลิ้นชัก</p>
          </section>
          <section class="card">
            <div class="card-head"><h2>ประวัติการปิดยอด</h2></div>
            ${history.length ? `<div class="table-wrap flat"><table class="data">
              <thead><tr><th>วันที่</th><th class="num">ควรมี</th><th class="num">นับได้</th><th class="num">ผลต่าง</th></tr></thead>
              <tbody>${history.map((h) => `<tr>
                <td><a href="#/finance/closing/${h.biz_date}">${fmtDate(h.biz_date)}</a></td>
                <td class="num">${num(h.expected_cash)}</td>
                <td class="num">${num(h.counted_cash)}</td>
                <td class="num ${h.difference < 0 ? 'text-danger' : h.difference > 0 ? 'text-warn' : 'text-ok'}">${h.difference === 0 ? 'ตรง' : (h.difference > 0 ? '+' : '') + num(h.difference)}</td>
              </tr>`).join('')}</tbody></table></div>` : '<div class="empty small">ยังไม่เคยปิดยอด</div>'}
          </section>
        </div>`;
      update();
    } catch (e) {
      toastError(e);
    }
  }

  function update() {
    const form = body.querySelector('[data-form]');
    if (!form) return;
    const opening = Number(form.opening_cash.value.replace(/,/g, '')) || 0;
    const expected = r2(opening + data.cash_sales - data.cash_expenses);
    body.querySelector('[data-expected]').textContent = baht(expected);
    const raw = form.counted_cash.value.replace(/,/g, '').trim();
    const diffEl = body.querySelector('[data-diff]');
    if (raw === '' || !Number.isFinite(Number(raw))) {
      diffEl.innerHTML = '<span class="muted">กรอกเงินสดที่นับได้เพื่อดูผลต่าง</span>';
      diffEl.className = 'cl-row cl-diff';
      return;
    }
    const diff = r2(Number(raw) - expected);
    diffEl.className = `cl-row cl-diff ${diff === 0 ? 'is-ok' : diff > 0 ? 'is-over' : 'is-short'}`;
    diffEl.innerHTML = diff === 0
      ? `<span>${icon('check')} เงินสดตรงพอดี</span><strong>${baht(0)}</strong>`
      : `<span>${icon('alert')} เงินสด${diff > 0 ? 'เกิน' : 'ขาด'}</span><strong>${baht(Math.abs(diff))}</strong>`;
  }

  body.addEventListener('input', (e) => {
    if (e.target.matches('[data-denom]')) {
      const total = [...body.querySelectorAll('[data-denom]')].reduce((s, i) => s + (Number(i.value) || 0) * Number(i.dataset.denom), 0);
      body.querySelector('[name=counted_cash]').value = total;
    }
    update();
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    await busy(form.querySelector('[data-save]'), async () => {
      try {
        const saved = await api.post('/cash-closing', { biz_date: date, ...formValues(form) });
        toast('บันทึกปิดยอดแล้ว', 'success');
        await load();
        if (await confirmDialog('ต้องการพิมพ์สรุปปิดยอดหรือไม่?', { ok: 'พิมพ์', cancel: 'ไม่ต้อง' })) printClosing(saved);
      } catch (err) {
        toastError(err);
      }
    });
  });
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-print]') && data?.saved) printClosing(data.saved);
  });

  const reloadIfIdle = () => { if (!body.contains(document.activeElement)) load(); };
  ctx.on('closing', reloadIfIdle);
  ctx.on('sales', reloadIfIdle);
  ctx.on('expenses', reloadIfIdle);
  await load();
}

