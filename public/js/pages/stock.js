// สต็อกวัตถุดิบแบบง่าย: บันทึกของเข้า, นับสต็อกด้วยมือ, แจ้งเตือนของใกล้หมด
import { api, esc, baht, qty, icon, toast, toastError, modal, confirmDialog, formValues, busy, fmtDate, fmtDateTime, today, parseDT } from '../lib.js';

const status = (i) =>
  i.quantity <= 0 ? { cls: 'chip-danger', text: 'หมด', icon: 'ban' }
  : i.quantity <= i.min_quantity ? { cls: 'chip-warn', text: 'ใกล้หมด', icon: 'alert' }
  : { cls: 'chip-ok', text: 'ปกติ', icon: 'check' };

export default {
  async render(root, params, ctx) {
    const st = { tab: 'list', list: [], moves: [], counting: false };
    root.innerHTML = `
      <div class="page">
        <header class="page-head">
          <div><h1>สต็อกวัตถุดิบ</h1><p class="sub" data-sub>&nbsp;</p></div>
          <div class="head-actions">
            <button class="btn" data-act="count">${icon('clipboard')} นับสต็อก</button>
            <button class="btn btn-primary" data-act="receive">${icon('download')} รับของเข้า</button>
          </div>
        </header>
        <div data-alerts></div>
        <div class="tabs" role="tablist">
          <button role="tab" data-tab="list">วัตถุดิบ</button>
          <button role="tab" data-tab="history">ประวัติของเข้า / การนับ</button>
        </div>
        <div data-content></div>
      </div>`;
    const $ = (s) => root.querySelector(s);

    async function load() {
      try {
        st.list = await api.get('/ingredients');
        if (st.tab === 'history') st.moves = await api.get('/stock/movements?limit=200');
        draw();
      } catch (e) {
        toastError(e);
      }
    }

    function draw() {
      if (!ctx.alive) return;
      const low = st.list.filter((i) => i.quantity <= i.min_quantity);
      const counted = st.list.map((i) => i.last_counted_at).filter(Boolean).sort();
      const lastCount = counted.length ? counted[counted.length - 1] : null;
      const daysSince = lastCount ? Math.floor((Date.now() - parseDT(lastCount)) / 86400000) : null;
      $('[data-sub]').textContent = `${st.list.length} รายการ · นับสต็อกล่าสุด ${lastCount ? fmtDate(lastCount) : '— ยังไม่เคยนับ'}`;

      $('[data-alerts]').innerHTML = `
        ${low.length ? `<div class="alert alert-warn">${icon('alert')}<div><strong>ของใกล้หมด ${low.length} รายการ:</strong> ${low.map((i) => `${esc(i.name)} (เหลือ ${qty(i.quantity)} ${esc(i.unit)})`).join(', ')}</div></div>` : ''}
        ${!st.counting && st.list.length && (daysSince === null || daysSince >= 7) ? `<div class="alert alert-info">${icon('clipboard')}<div>${daysSince === null ? 'ยังไม่เคยนับสต็อก' : `ไม่ได้นับสต็อกมา ${daysSince} วันแล้ว`} — แนะนำให้นับสัปดาห์ละครั้ง <button class="btn btn-sm" data-act="count">เริ่มนับ</button></div></div>` : ''}`;

      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === st.tab));
      if (st.counting) return drawCount();
      if (st.tab === 'history') return drawHistory();
      $('[data-content]').innerHTML = `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>วัตถุดิบ</th><th class="num">คงเหลือ</th><th class="num">แจ้งเตือนเมื่อเหลือ</th><th>สถานะ</th><th>นับล่าสุด</th><th></th></tr></thead>
            <tbody>
              ${st.list.map((i) => {
                const s = status(i);
                return `<tr>
                  <td><strong>${esc(i.name)}</strong></td>
                  <td class="num"><strong>${qty(i.quantity)}</strong> ${esc(i.unit)}</td>
                  <td class="num muted">${qty(i.min_quantity)} ${esc(i.unit)}</td>
                  <td><span class="chip ${s.cls}">${icon(s.icon)} ${s.text}</span></td>
                  <td class="muted nowrap">${i.last_counted_at ? fmtDate(i.last_counted_at) : '—'}</td>
                  <td class="row-actions">
                    <button class="btn btn-sm" data-recv="${i.id}">${icon('plus')} รับเข้า</button>
                    <button class="icon-btn" data-edit="${i.id}" aria-label="แก้ไข ${esc(i.name)}">${icon('edit')}</button>
                    <button class="icon-btn danger" data-del="${i.id}" aria-label="ลบ ${esc(i.name)}">${icon('trash')}</button>
                  </td>
                </tr>`;
              }).join('') || `<tr><td colspan="6"><div class="empty small">ยังไม่มีวัตถุดิบ</div></td></tr>`}
            </tbody>
          </table>
        </div>
        <button class="btn mt" data-act="add">${icon('plus')} เพิ่มวัตถุดิบ</button>`;
    }

    function drawHistory() {
      $('[data-content]').innerHTML = `
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>วันที่</th><th>วัตถุดิบ</th><th>รายการ</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th class="num">ค่าใช้จ่าย</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              ${st.moves.map((m) => {
                const used = m.before_qty - m.after_qty;
                return `<tr>
                  <td class="nowrap muted">${fmtDateTime(m.created_at)}</td>
                  <td><strong>${esc(m.ingredient_name)}</strong></td>
                  <td>${m.type === 'in' ? `<span class="chip chip-ok">${icon('download')} รับเข้า</span>` : `<span class="chip chip-info">${icon('clipboard')} นับสต็อก</span>`}</td>
                  <td class="num">${m.type === 'in' ? `+${qty(m.quantity)}` : `นับได้ ${qty(m.quantity)}`} ${esc(m.unit)}
                    ${m.type === 'count' && used > 0 ? `<div class="muted small">ใช้ไป ${qty(used)} ${esc(m.unit)}</div>` : ''}
                    ${m.type === 'count' && used < 0 ? `<div class="muted small">มากกว่าในระบบ ${qty(-used)} ${esc(m.unit)}</div>` : ''}</td>
                  <td class="num muted nowrap">${qty(m.before_qty)} → <strong>${qty(m.after_qty)}</strong></td>
                  <td class="num">${m.cost ? baht(m.cost) : '—'}</td>
                  <td class="muted">${esc(m.note || '')}</td>
                </tr>`;
              }).join('') || `<tr><td colspan="7"><div class="empty small">ยังไม่มีประวัติ</div></td></tr>`}
            </tbody>
          </table>
        </div>`;
    }

    function drawCount() {
      $('[data-content]').innerHTML = `
        <div class="card">
          <div class="card-head">
            <div><h2>นับสต็อก</h2><p class="muted small">กรอกจำนวนที่นับได้จริง ช่องที่เว้นว่างจะไม่ถูกเปลี่ยน — ระบบจะคำนวณว่าใช้ไปเท่าไรตั้งแต่ครั้งก่อน</p></div>
          </div>
          <form data-count-form>
            <div class="table-wrap flat">
              <table class="data">
                <thead><tr><th>วัตถุดิบ</th><th class="num">ในระบบ</th><th>นับได้จริง</th><th class="num">ใช้ไป</th></tr></thead>
                <tbody>
                  ${st.list.map((i) => `<tr>
                    <td><strong>${esc(i.name)}</strong></td>
                    <td class="num muted">${qty(i.quantity)} ${esc(i.unit)}</td>
                    <td><div class="input-unit"><input class="input input-num" name="c${i.id}" data-cnt="${i.id}" inputmode="decimal" placeholder="${qty(i.quantity)}" aria-label="จำนวนที่นับได้ของ ${esc(i.name)}"><span>${esc(i.unit)}</span></div></td>
                    <td class="num muted" data-used="${i.id}">—</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <label class="field mt"><span>หมายเหตุ (ไม่บังคับ)</span><input class="input" name="note" maxlength="200" placeholder="เช่น นับประจำสัปดาห์"></label>
            <div class="form-actions">
              <button type="button" class="btn" data-act="cancel-count">ยกเลิก</button>
              <button class="btn btn-primary" data-save-count>${icon('check')} บันทึกการนับ</button>
            </div>
          </form>
        </div>`;
      const form = $('[data-count-form]');
      form.addEventListener('input', (e) => {
        const id = e.target.dataset.cnt;
        if (!id) return;
        const ing = st.list.find((i) => i.id === Number(id));
        const v = e.target.value.trim();
        const cell = root.querySelector(`[data-used="${id}"]`);
        if (v === '' || !Number.isFinite(Number(v))) cell.textContent = '—';
        else {
          const used = ing.quantity - Number(v);
          cell.textContent = used >= 0 ? `${qty(used)} ${ing.unit}` : `+${qty(-used)} ${ing.unit}`;
        }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await busy(form.querySelector('[data-save-count]'), async () => {
          const counts = st.list.map((i) => ({ ingredient_id: i.id, quantity: form[`c${i.id}`].value.trim() }));
          try {
            st.list = await api.post('/stock/count', { counts, note: form.note.value });
            st.counting = false;
            toast('บันทึกการนับสต็อกแล้ว', 'success');
            draw();
          } catch (err) {
            toastError(err);
          }
        });
      });
    }

    function editIngredient(item) {
      const m = modal({
        title: item ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ',
        size: 'sm',
        body: `
          <form class="form-stack" data-form>
            <label class="field"><span>ชื่อวัตถุดิบ</span><input class="input" name="name" maxlength="60" value="${esc(item?.name)}" placeholder="เช่น หมูสับ" autofocus></label>
            <label class="field"><span>หน่วย</span><input class="input" name="unit" maxlength="20" value="${esc(item?.unit)}" placeholder="เช่น กก., ฟอง, ขวด" list="unit-list">
              <datalist id="unit-list"><option value="กก."><option value="กรัม"><option value="ฟอง"><option value="ลิตร"><option value="ขวด"><option value="ถุง"><option value="แพ็ค"><option value="กำ"><option value="ถัง"><option value="ชิ้น"></datalist></label>
            ${item ? '' : '<label class="field"><span>จำนวนคงเหลือตอนนี้</span><input class="input" name="quantity" inputmode="decimal" placeholder="0"></label>'}
            <label class="field"><span>แจ้งเตือนเมื่อเหลือไม่เกิน</span><input class="input" name="min_quantity" inputmode="decimal" value="${item ? item.min_quantity : ''}" placeholder="0"></label>
            ${item ? '<p class="muted small">ต้องการแก้จำนวนคงเหลือ ให้ใช้ “นับสต็อก” หรือ “รับของเข้า”</p>' : ''}
          </form>`,
        footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-save>บันทึก</button>`,
      });
      const save = async () => {
        await busy(m.el.querySelector('[data-save]'), async () => {
          try {
            const v = formValues(m.el.querySelector('[data-form]'));
            st.list = item ? await api.put(`/ingredients/${item.id}`, v) : await api.post('/ingredients', v);
            m.close();
            toast('บันทึกแล้ว', 'success');
            draw();
          } catch (e) {
            toastError(e);
          }
        });
      };
      m.el.querySelector('[data-save]').addEventListener('click', save);
      m.el.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); save(); });
    }

    function receive(preselect) {
      if (!st.list.length) {
        toast('เพิ่มวัตถุดิบก่อน แล้วจึงรับของเข้า', 'warn');
        return editIngredient(null);
      }
      const m = modal({
        title: 'รับของเข้า',
        body: `
          <form class="form-grid" data-form>
            <label class="field span-2"><span>วัตถุดิบ</span>
              <select class="input" name="ingredient">
                ${st.list.map((i) => `<option value="${i.id}" ${preselect === i.id ? 'selected' : ''}>${esc(i.name)} (เหลือ ${qty(i.quantity)} ${esc(i.unit)})</option>`).join('')}
              </select>
            </label>
            <label class="field"><span>จำนวนที่ซื้อ</span><div class="input-unit"><input class="input" name="quantity" inputmode="decimal" placeholder="เช่น 5" autofocus><span data-unit></span></div></label>
            <label class="field"><span>ราคารวม (บาท)</span><input class="input" name="cost" inputmode="decimal" placeholder="ไม่บังคับ"></label>
            <label class="field"><span>วันที่ซื้อ</span><input class="input" type="date" name="date" value="${today()}"></label>
            <label class="field"><span>จ่ายเงินจาก</span>
              <select class="input" name="payment_method"><option value="cash">เงินสดในลิ้นชัก</option><option value="transfer">โอน / เงินส่วนตัว</option></select>
            </label>
            <label class="check span-2"><input type="checkbox" name="record_expense" checked> บันทึกเป็นค่าใช้จ่าย “วัตถุดิบ” ด้วย (เมื่อกรอกราคา)</label>
            <label class="field span-2"><span>หมายเหตุ</span><input class="input" name="note" maxlength="200" placeholder="เช่น ซื้อจากตลาด"></label>
          </form>`,
        footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-save>${icon('check')} บันทึกของเข้า</button>`,
      });
      const form = m.el.querySelector('[data-form]');
      const setUnit = () => (m.el.querySelector('[data-unit]').textContent = st.list.find((i) => i.id === Number(form.ingredient.value))?.unit || '');
      setUnit();
      form.ingredient.addEventListener('change', setUnit);
      const save = async () => {
        await busy(m.el.querySelector('[data-save]'), async () => {
          const v = formValues(form);
          try {
            st.list = await api.post(`/ingredients/${v.ingredient}/receive`, v);
            const ing = st.list.find((i) => i.id === Number(v.ingredient));
            m.close();
            toast(`รับ${ing.name}เข้าแล้ว · คงเหลือ ${qty(ing.quantity)} ${ing.unit}`, 'success');
            draw();
          } catch (e) {
            toastError(e);
          }
        });
      };
      m.el.querySelector('[data-save]').addEventListener('click', save);
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    }

    root.addEventListener('click', async (e) => {
      const t = e.target;
      const tab = t.closest('[data-tab]');
      if (tab) {
        st.tab = tab.dataset.tab;
        st.counting = false;
        return load();
      }
      const byId = (attr) => st.list.find((i) => i.id === Number(t.closest(`[${attr}]`).getAttribute(attr)));
      if (t.closest('[data-recv]')) return receive(byId('data-recv').id);
      if (t.closest('[data-edit]')) return editIngredient(byId('data-edit'));
      if (t.closest('[data-del]')) {
        const ing = byId('data-del');
        if (await confirmDialog(`ลบ “${ing.name}” ออกจากรายการสต็อก?`, { danger: true, ok: 'ลบ' })) {
          try {
            st.list = await api.del(`/ingredients/${ing.id}`);
            draw();
          } catch (err) {
            toastError(err);
          }
        }
        return;
      }
      const a = t.closest('[data-act]')?.dataset.act;
      if (a === 'receive') receive(null);
      if (a === 'add') editIngredient(null);
      if (a === 'count') {
        st.tab = 'list';
        st.counting = true;
        draw();
      }
      if (a === 'cancel-count') {
        st.counting = false;
        draw();
      }
    });

    ctx.on('stock', () => { if (!st.counting) load(); });
    await load();
  },
};
