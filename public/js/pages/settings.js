// ตั้งค่าร้าน: ข้อมูลร้าน, พร้อมเพย์, โต๊ะ, การพิมพ์, เงินทอนตั้งต้น, เชื่อมต่ออุปกรณ์, สำรองข้อมูล
import { api, esc, icon, toast, toastError, modal, confirmDialog, formValues, busy } from '../lib.js';
import { store, flag } from '../store.js';
import { printHtml } from '../print.js';

export default {
  async render(root, params, ctx) {
    root.innerHTML = '<div class="page" data-page></div>';
    const page = root.querySelector('[data-page]');

    function draw() {
      const s = store.settings;
      const field = (name, label, attrs = '') =>
        `<label class="field"><span>${label}</span><input class="input" name="${name}" value="${esc(s[name])}" ${attrs}></label>`;
      const toggle = (name, label, hint = '') => `
        <label class="toggle-row">
          <span><strong>${label}</strong>${hint ? `<span class="muted small">${hint}</span>` : ''}</span>
          <span class="switch"><input type="checkbox" data-toggle="${name}" ${flag(name) ? 'checked' : ''}><span class="slider"></span></span>
        </label>`;
      const kitchenUrls = store.lanUrls.map((u) => `${u}/#/kitchen`);

      page.innerHTML = `
        <header class="page-head"><div><h1>ตั้งค่า</h1></div></header>
        <div class="settings-grid">
          <section class="card">
            <div class="card-head"><h2>ข้อมูลร้าน</h2><span class="muted small">แสดงบนใบเสร็จ</span></div>
            <form class="form-stack" data-form="shop">
              ${field('shop_name', 'ชื่อร้าน', 'maxlength="80" required')}
              ${field('shop_phone', 'เบอร์โทร', 'maxlength="40"')}
              <label class="field"><span>ที่อยู่</span><textarea class="input" name="shop_address" rows="2" maxlength="300">${esc(s.shop_address)}</textarea></label>
              ${field('tax_id', 'เลขประจำตัวผู้เสียภาษี (ถ้ามี)', 'maxlength="20" inputmode="numeric"')}
              ${field('receipt_footer', 'ข้อความท้ายใบเสร็จ', 'maxlength="120"')}
              <div class="form-actions"><button class="btn btn-primary">บันทึก</button></div>
            </form>
          </section>

          <section class="card">
            <div class="card-head"><h2>รับเงินด้วยพร้อมเพย์</h2></div>
            <form class="form-stack" data-form="promptpay">
              ${field('promptpay_id', 'หมายเลขพร้อมเพย์', 'maxlength="20" inputmode="numeric" placeholder="เบอร์มือถือ 10 หลัก หรือเลข 13 หลัก"')}
              ${field('promptpay_name', 'ชื่อบัญชี (แสดงให้ลูกค้าเห็น)', 'maxlength="80" placeholder="เช่น นายสมชาย ใจดี"')}
              <p class="muted small">QR จะใส่ยอดเงินให้อัตโนมัติ ลูกค้าสแกนแล้วจ่ายได้ทันที — เงินเข้าบัญชีพร้อมเพย์ของร้านโดยตรง</p>
              <div class="form-actions">
                <button type="button" class="btn" data-test-qr>${icon('eye')} ทดสอบ QR</button>
                <button class="btn btn-primary">บันทึก</button>
              </div>
            </form>
          </section>

          <section class="card">
            <div class="card-head"><h2>โต๊ะ</h2><span class="muted small">${store.tables.length} โต๊ะ</span></div>
            <div class="table-list">
              ${store.tables.map((t) => `
                <div class="cat-row">
                  <input class="input" data-tname="${t.id}" value="${esc(t.name)}" maxlength="40" aria-label="ชื่อโต๊ะ">
                  <button class="icon-btn danger" data-tdel="${t.id}" aria-label="ลบ ${esc(t.name)}">${icon('trash')}</button>
                </div>`).join('') || '<div class="empty small">ยังไม่มีโต๊ะ</div>'}
            </div>
            <form class="cat-add" data-table-add>
              <input class="input" name="name" maxlength="40" placeholder="ชื่อโต๊ะใหม่ เช่น โต๊ะ 11, บาร์ 1" required>
              <button class="btn btn-primary">${icon('plus')} เพิ่ม</button>
            </form>
            <button class="btn btn-ghost btn-sm mt" data-table-bulk>${icon('plus')} เพิ่มหลายโต๊ะพร้อมกัน</button>
          </section>

          <section class="card">
            <div class="card-head"><h2>การพิมพ์</h2></div>
            <div class="field"><span>ขนาดกระดาษเครื่องพิมพ์ใบเสร็จ</span>
              <div class="seg">
                <label><input type="radio" name="paper_width" value="58" ${s.paper_width === '58' ? 'checked' : ''} data-paper><span>58 มม.</span></label>
                <label><input type="radio" name="paper_width" value="80" ${s.paper_width !== '58' ? 'checked' : ''} data-paper><span>80 มม.</span></label>
              </div>
            </div>
            ${toggle('auto_print_receipt', 'พิมพ์ใบเสร็จอัตโนมัติ', 'หลังรับเงินเสร็จ')}
            ${toggle('print_kitchen_on_send', 'พิมพ์ใบสั่งครัวจากเครื่องที่กดส่ง', 'ใช้เมื่อเครื่องพิมพ์ครัวต่อกับเครื่องแคชเชียร์')}
            ${toggle('bill_show_qr', 'แสดง QR พร้อมเพย์บนใบแจ้งยอด', 'ลูกค้าสแกนจ่ายจากใบที่โต๊ะได้')}
            <button class="btn mt" data-test-print>${icon('print')} พิมพ์ทดสอบ</button>
            <p class="muted small">ถ้าไม่อยากให้มีหน้าต่างยืนยันทุกครั้งที่พิมพ์ ดูวิธีตั้งค่าใน README (Chrome โหมด kiosk-printing)</p>
          </section>

          <section class="card">
            <div class="card-head"><h2>เงินสด</h2></div>
            <form class="form-stack" data-form="cash">
              ${field('default_opening_cash', 'เงินทอนตั้งต้นในลิ้นชักทุกวัน (บาท)', 'inputmode="decimal"')}
              <div class="form-actions"><button class="btn btn-primary">บันทึก</button></div>
            </form>
          </section>

          <section class="card">
            <div class="card-head"><h2>เปิดจากแท็บเล็ต / มือถือ</h2></div>
            ${store.lanUrls.length ? `
              <p class="muted small">เชื่อม Wi‑Fi เดียวกับเครื่องนี้ แล้วเปิดลิงก์ หรือสแกน QR</p>
              <div class="connect-list">
                ${store.lanUrls.map((u, i) => `
                  <div class="connect">
                    <img src="/api/qr.svg?text=${encodeURIComponent(kitchenUrls[i])}" alt="QR สำหรับเปิดจอครัว" width="112" height="112">
                    <div>
                      <div class="muted small">หน้าขาย</div><code>${esc(u)}</code>
                      <div class="muted small mt-sm">จอครัว</div><code>${esc(kitchenUrls[i])}</code>
                    </div>
                  </div>`).join('')}
              </div>` : '<p class="muted">ไม่พบเครือข่าย Wi‑Fi/LAN ของเครื่องนี้</p>'}
          </section>

          <section class="card">
            <div class="card-head"><h2>สำรองข้อมูล</h2></div>
            <p class="muted small">ข้อมูลทั้งหมดอยู่ในไฟล์ <code>data/pos.db</code> บนเครื่องหลัก ควรดาวน์โหลดสำรองเก็บไว้สัปดาห์ละครั้ง</p>
            <a class="btn" href="/api/backup" download>${icon('download')} ดาวน์โหลดไฟล์สำรองข้อมูล</a>
          </section>
        </div>`;
    }

    async function save(values, msg = 'บันทึกแล้ว') {
      try {
        store.settings = await api.put('/settings', values);
        toast(msg, 'success');
        return true;
      } catch (e) {
        toastError(e);
        return false;
      }
    }

    page.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      if (form.matches('[data-form]')) {
        await busy(form.querySelector('.btn-primary'), () => save(formValues(form)));
      }
      if (form.matches('[data-table-add]')) {
        try {
          store.tables = await api.post('/tables', { name: form.name.value });
          toast('เพิ่มโต๊ะแล้ว', 'success');
          draw();
        } catch (err) {
          toastError(err);
        }
      }
    });

    page.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.toggle) {
        if (!(await save({ [t.dataset.toggle]: t.checked ? '1' : '0' }))) t.checked = !t.checked;
      }
      if (t.matches('[data-paper]')) save({ paper_width: t.value }, `ตั้งกระดาษ ${t.value} มม. แล้ว`);
      if (t.dataset.tname) {
        try {
          store.tables = await api.put(`/tables/${t.dataset.tname}`, { name: t.value });
          toast('เปลี่ยนชื่อโต๊ะแล้ว', 'success');
        } catch (err) {
          toastError(err);
        }
      }
    });

    page.addEventListener('click', async (e) => {
      const t = e.target;
      const del = t.closest('[data-tdel]');
      if (del) {
        const table = store.tables.find((x) => x.id === Number(del.dataset.tdel));
        if (await confirmDialog(`ลบ “${table.name}”?`, { danger: true, ok: 'ลบโต๊ะ' })) {
          try {
            store.tables = await api.del(`/tables/${table.id}`);
            draw();
          } catch (err) {
            toastError(err);
          }
        }
        return;
      }
      if (t.closest('[data-table-bulk]')) {
        const m = modal({
          title: 'เพิ่มหลายโต๊ะ',
          size: 'sm',
          body: `<form class="form-grid" data-f>
            <label class="field"><span>คำนำหน้า</span><input class="input" name="prefix" value="โต๊ะ" maxlength="30"></label>
            <label class="field"><span>เริ่มที่เลข</span><input class="input" name="start" inputmode="numeric" value="${store.tables.length + 1}"></label>
            <label class="field span-2"><span>จำนวนโต๊ะ</span><input class="input" name="count" inputmode="numeric" value="5" autofocus></label>
          </form>`,
          footer: '<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-ok>เพิ่ม</button>',
        });
        m.el.querySelector('[data-ok]').addEventListener('click', async () => {
          try {
            const v = formValues(m.el.querySelector('[data-f]'));
            store.tables = await api.post('/tables', { ...v, count: Math.max(2, Number(v.count) || 0) });
            m.close();
            toast('เพิ่มโต๊ะแล้ว', 'success');
            draw();
          } catch (err) {
            toastError(err);
          }
        });
        return;
      }
      if (t.closest('[data-test-qr]')) {
        const id = page.querySelector('[name=promptpay_id]').value.trim();
        try {
          const qr = await api.get(`/promptpay/qr?id=${encodeURIComponent(id)}&amount=1`);
          modal({
            title: 'ทดสอบ QR พร้อมเพย์ (1 บาท)',
            size: 'sm',
            body: `<div class="qr-box"><div class="qr-img">${qr.svg}</div><div class="qr-amount">฿1</div>
              <p class="hint">ลองสแกนด้วยแอปธนาคาร ควรเห็นชื่อบัญชีของร้านและยอด 1 บาท (ไม่ต้องโอนจริง)</p></div>`,
          });
        } catch (err) {
          toastError(err);
        }
        return;
      }
      if (t.closest('[data-test-print]')) {
        printHtml(`<div class="c b lg">${esc(store.settings.shop_name)}</div><hr><div class="c">ทดสอบการพิมพ์</div>
          <div class="c">กระดาษ ${esc(store.settings.paper_width)} มม.</div><div class="row"><span>ข้าวผัดหมู</span><span>50</span></div>
          <div class="row b lg"><span>รวม</span><span>฿50</span></div><hr><div class="c">ภาษาไทยแสดงถูกต้อง ✓</div>`);
      }
    });

    ctx.on('store:tables', draw);
    draw();
  },
};
