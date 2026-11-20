// หน้าต่างชำระเงิน: เงินสด (คำนวณเงินทอน) หรือ QR พร้อมเพย์
import { api, esc, baht, r2, icon, modal, toastError, orderLabel, busy } from './lib.js';
import { store, flag } from './store.js';
import { printReceipt } from './print.js';

function quickCash(total) {
  const out = [total];
  for (const step of [20, 50, 100, 500, 1000]) {
    const v = Math.ceil(total / step) * step;
    if (v > total && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 5);
}

// คืน Promise ที่ได้ออเดอร์ที่ชำระแล้ว หรือ null ถ้ายกเลิก
export function openPayment(order) {
  return new Promise((resolve) => {
    const subtotal = r2(order.items.filter((i) => i.status === 'active').reduce((s, i) => s + i.price * i.qty, 0));
    const itemCount = order.items.filter((i) => i.status === 'active').reduce((s, i) => s + i.qty, 0);
    const st = { method: 'cash', discount: 0, paid: null };
    const qrCache = new Map();
    let qrTimer;

    const m = modal({
      title: `ชำระเงิน · ${orderLabel(order)}`,
      size: 'lg',
      body: `
        <div class="pay">
          <div class="pay-summary">
            <div class="pay-row"><span>${itemCount} รายการ</span><span>${baht(subtotal)}</span></div>
            <label class="pay-row pay-discount">
              <span>ส่วนลด (บาท)</span>
              <input class="input input-num" name="discount" inputmode="decimal" placeholder="0">
            </label>
            <div class="pay-total"><span>ยอดที่ต้องชำระ</span><strong data-total></strong></div>
          </div>
          <div class="pay-method">
            <div class="seg seg-lg" role="tablist">
              <button type="button" role="tab" data-method="cash" class="active">${icon('card')} เงินสด</button>
              <button type="button" role="tab" data-method="promptpay">${icon('clipboard')} พร้อมเพย์</button>
            </div>
            <div data-pane="cash">
              <label class="field">
                <span>รับเงินมา</span>
                <input class="input input-xl" name="received" inputmode="decimal" placeholder="พอดี" autofocus>
              </label>
              <div class="quick-cash" data-quick></div>
              <div class="change-box"><span>เงินทอน</span><strong data-change>฿0</strong></div>
            </div>
            <div data-pane="promptpay" hidden>
              <div class="qr-box" data-qr><div class="qr-loading">กำลังสร้าง QR…</div></div>
            </div>
          </div>
        </div>`,
      footer: `
        <button class="btn btn-lg" data-close>ยกเลิก</button>
        <button class="btn btn-lg btn-success" data-confirm>${icon('check')} <span data-confirm-label>ยืนยันรับเงิน</span></button>`,
      onClose: () => resolve(st.paid),
    });

    const $ = (s) => m.el.querySelector(s);
    const total = () => r2(Math.max(0, subtotal - st.discount));
    const received = () => {
      const v = $('[name=received]').value.replace(/,/g, '').trim();
      return v === '' ? total() : Number(v);
    };

    function update() {
      const t = total();
      $('[data-total]').textContent = baht(t);
      $('[data-quick]').innerHTML = quickCash(t)
        .map((v, i) => `<button type="button" class="btn" data-cash="${v}">${i === 0 ? 'พอดี ' : ''}${baht(v)}</button>`)
        .join('');
      const rec = received();
      const change = r2(rec - t);
      const short = !Number.isFinite(rec) || change < 0;
      $('[data-change]').textContent = short ? 'เงินไม่พอ' : baht(change);
      $('.change-box').classList.toggle('is-short', short);
      $('[data-confirm]').disabled = st.method === 'cash' && short;
      $('[data-confirm-label]').textContent = `ยืนยันรับเงิน ${baht(t)}`;
      if (st.method === 'promptpay') {
        clearTimeout(qrTimer);
        qrTimer = setTimeout(loadQr, 250);
      }
    }

    async function loadQr() {
      const box = $('[data-qr]');
      const t = total();
      if (!store.settings.promptpay_id) {
        box.innerHTML = `<div class="empty small">${icon('alert')}<p>ยังไม่ได้ตั้งค่าหมายเลขพร้อมเพย์</p><a class="btn btn-sm" href="#/settings" data-close>ไปที่ตั้งค่า</a></div>`;
        return;
      }
      try {
        if (!qrCache.has(t)) qrCache.set(t, await api.get(`/promptpay/qr?amount=${t}`));
        if (t !== total()) return;
        const qr = qrCache.get(t);
        box.innerHTML = `
          <div class="qr-head">พร้อมเพย์ · PromptPay</div>
          <div class="qr-img">${qr.svg}</div>
          <div class="qr-amount">${baht(t)}</div>
          ${store.settings.promptpay_name ? `<div class="qr-name">${esc(store.settings.promptpay_name)}</div>` : ''}
          <p class="hint">ให้ลูกค้าสแกน แล้วตรวจสอบยอดเงินเข้าก่อนกดยืนยัน</p>`;
      } catch (e) {
        box.innerHTML = `<div class="empty small">${icon('alert')}<p>${esc(e.message)}</p></div>`;
      }
    }

    function setMethod(method) {
      st.method = method;
      m.el.querySelectorAll('[data-method]').forEach((b) => b.classList.toggle('active', b.dataset.method === method));
      $('[data-pane=cash]').hidden = method !== 'cash';
      $('[data-pane=promptpay]').hidden = method !== 'promptpay';
      update();
      if (method === 'cash') $('[name=received]').focus();
    }

    async function confirm() {
      await busy($('[data-confirm]'), async () => {
        try {
          const paid = await api.post(`/orders/${order.id}/pay`, {
            method: st.method,
            discount: st.discount,
            cash_received: st.method === 'cash' ? received() : null,
          });
          st.paid = paid;
          showDone(paid);
        } catch (e) {
          toastError(e);
        }
      });
    }

    function showDone(paid) {
      m.setTitle('ชำระเงินเรียบร้อย');
      m.body.innerHTML = `
        <div class="pay-done">
          <div class="pay-done-icon">${icon('check')}</div>
          <div class="pay-done-total">${baht(paid.total)} · ${paid.payment_method === 'cash' ? 'เงินสด' : 'พร้อมเพย์'}</div>
          ${paid.payment_method === 'cash' ? `
            <div class="pay-done-change"><span>เงินทอน</span><strong>${baht(paid.change_amount)}</strong></div>
            <div class="muted">รับเงินมา ${baht(paid.cash_received)}</div>` : ''}
        </div>`;
      m.foot.innerHTML = `
        <button class="btn btn-lg" data-print>${icon('print')} พิมพ์ใบเสร็จ</button>
        <button class="btn btn-lg btn-primary" data-close autofocus>เสร็จสิ้น</button>`;
      m.foot.querySelector('[data-print]').addEventListener('click', () => printReceipt(paid));
      m.foot.querySelector('[data-close]').focus();
      if (flag('auto_print_receipt')) printReceipt(paid);
    }

    m.el.addEventListener('click', (e) => {
      const methodBtn = e.target.closest('[data-method]');
      if (methodBtn) return setMethod(methodBtn.dataset.method);
      const cashBtn = e.target.closest('[data-cash]');
      if (cashBtn) {
        $('[name=received]').value = cashBtn.dataset.cash;
        return update();
      }
      if (e.target.closest('[data-confirm]')) confirm();
    });
    $('[name=discount]').addEventListener('input', (e) => {
      const v = Number(e.target.value.replace(/,/g, ''));
      st.discount = Number.isFinite(v) ? Math.min(Math.max(v, 0), subtotal) : 0;
      update();
    });
    $('[name=received]').addEventListener('input', update);
    m.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input') && !$('[data-confirm]').disabled && !st.paid) {
        e.preventDefault();
        confirm();
      }
    });
    update();
  });
}
