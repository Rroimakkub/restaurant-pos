// จัดการเมนู: เพิ่ม ลบ แก้ราคา และเปิด/ปิดเมนูที่ของหมด
import { api, esc, baht, icon, toast, toastError, modal, confirmDialog, formValues, busy } from '../lib.js';
import { store } from '../store.js';

export default {
  render(root, params, ctx) {
    const st = { cat: 'all', search: '' };
    root.innerHTML = `
      <div class="page">
        <header class="page-head">
          <div><h1>เมนูอาหาร</h1><p class="sub" data-sub></p></div>
          <div class="head-actions">
            <button class="btn" data-act="cats">${icon('menu')} จัดการหมวดหมู่</button>
            <button class="btn btn-primary" data-act="add">${icon('plus')} เพิ่มเมนู</button>
          </div>
        </header>
        <div class="toolbar">
          <label class="search">${icon('search')}<input class="input" type="search" placeholder="ค้นหาเมนู" data-search aria-label="ค้นหาเมนู"></label>
          <div class="chips" data-cats></div>
        </div>
        <div data-list></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const validCat = (m) => store.categories.some((c) => c.id === m.category_id);

    function draw() {
      const out = store.menu.filter((m) => !m.available).length;
      $('[data-sub]').innerHTML = `${store.menu.length} เมนู${out ? ` · <span class="text-danger">ปิดขาย (หมด) ${out}</span>` : ''}`;
      $('[data-cats]').innerHTML = [
        `<button class="chip-btn ${st.cat === 'all' ? 'active' : ''}" data-cat="all">ทั้งหมด</button>`,
        `<button class="chip-btn ${st.cat === 'out' ? 'active' : ''}" data-cat="out">หมดอยู่</button>`,
        ...store.categories.map((c) => `<button class="chip-btn ${st.cat === String(c.id) ? 'active' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`),
      ].join('');

      const s = st.search.trim().toLowerCase();
      const items = store.menu.filter((m) => {
        if (s && !m.name.toLowerCase().includes(s)) return false;
        if (st.cat === 'out') return !m.available;
        if (st.cat !== 'all') return String(m.category_id) === st.cat;
        return true;
      });
      const groups = [
        ...store.categories.map((c) => ({ name: c.name, items: items.filter((m) => m.category_id === c.id) })),
        { name: 'ไม่มีหมวดหมู่', items: items.filter((m) => !validCat(m)) },
      ].filter((g) => g.items.length);

      $('[data-list]').innerHTML = groups.length
        ? groups.map((g) => `
          <section class="card list-card">
            <h2 class="list-card-title">${esc(g.name)} <span class="muted">(${g.items.length})</span></h2>
            ${g.items.map((m) => `
              <div class="mrow ${m.available ? '' : 'is-out'}">
                <div class="mrow-name">${esc(m.name)}</div>
                <button class="mrow-price" data-price="${m.id}" title="แก้ราคา">${baht(m.price)} ${icon('edit')}</button>
                <label class="mrow-avail">
                  <span class="switch"><input type="checkbox" data-avail="${m.id}" ${m.available ? 'checked' : ''} aria-label="มีขาย ${esc(m.name)}"><span class="slider"></span></span>
                  <span class="mrow-status">${m.available ? 'มีขาย' : 'หมด'}</span>
                </label>
                <div class="mrow-actions">
                  <button class="icon-btn" data-edit="${m.id}" aria-label="แก้ไข ${esc(m.name)}">${icon('edit')}</button>
                  <button class="icon-btn danger" data-del="${m.id}" aria-label="ลบ ${esc(m.name)}">${icon('trash')}</button>
                </div>
              </div>`).join('')}
          </section>`).join('')
        : `<div class="empty">${icon('menu')}<p>${store.menu.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนู กด “เพิ่มเมนู” เพื่อเริ่มต้น'}</p></div>`;
    }

    function editItem(item) {
      const m = modal({
        title: item ? 'แก้ไขเมนู' : 'เพิ่มเมนู',
        size: 'sm',
        body: `
          <form class="form-stack" data-form>
            <label class="field"><span>ชื่อเมนู</span><input class="input" name="name" required maxlength="80" value="${esc(item?.name)}" autofocus></label>
            <label class="field"><span>ราคา (บาท)</span><input class="input" name="price" required inputmode="decimal" value="${item ? item.price : ''}" placeholder="0"></label>
            <label class="field"><span>หมวดหมู่</span>
              <select class="input" name="category_id">
                <option value="">— ไม่มีหมวดหมู่ —</option>
                ${store.categories.map((c) => `<option value="${c.id}" ${item?.category_id === c.id || (!item && st.cat === String(c.id)) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </label>
            ${item ? '' : '<label class="check"><input type="checkbox" name="again" checked> บันทึกแล้วเพิ่มเมนูต่อ</label>'}
          </form>`,
        footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-save>บันทึก</button>`,
      });
      const form = m.el.querySelector('[data-form]');
      const save = async () => {
        await busy(m.el.querySelector('[data-save]'), async () => {
          const v = formValues(form);
          try {
            if (item) await api.put(`/menu/${item.id}`, v);
            else await api.post('/menu', v);
            toast(item ? 'บันทึกแล้ว' : `เพิ่ม “${v.name}” แล้ว`, 'success');
            if (!item && v.again) {
              form.name.value = '';
              form.price.value = '';
              form.name.focus();
            } else m.close();
          } catch (e) {
            toastError(e);
          }
        });
      };
      m.el.querySelector('[data-save]').addEventListener('click', save);
      form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); } });
    }

    function editPrice(item) {
      const m = modal({
        title: `แก้ราคา · ${item.name}`,
        size: 'sm',
        body: `<label class="field"><span>ราคาใหม่ (บาท)</span><input class="input input-xl" data-v inputmode="decimal" value="${item.price}" autofocus></label>`,
        footer: `<button class="btn" data-close>ยกเลิก</button><button class="btn btn-primary" data-save>บันทึก</button>`,
      });
      const save = async () => {
        try {
          await api.put(`/menu/${item.id}`, { name: item.name, category_id: item.category_id, price: m.el.querySelector('[data-v]').value });
          toast('แก้ราคาแล้ว', 'success');
          m.close();
        } catch (e) {
          toastError(e);
        }
      };
      m.el.querySelector('[data-save]').addEventListener('click', save);
      m.el.querySelector('[data-v]').addEventListener('keydown', (e) => e.key === 'Enter' && save());
    }

    function manageCategories() {
      const m = modal({ title: 'จัดการหมวดหมู่', body: '<div data-cl></div>', footer: '<button class="btn btn-primary" data-close>เสร็จ</button>' });
      const drawList = () => {
        m.el.querySelector('[data-cl]').innerHTML = `
          <div class="cat-list">
            ${store.categories.map((c, i) => `
              <div class="cat-row">
                <input class="input" data-rename="${c.id}" value="${esc(c.name)}" maxlength="60" aria-label="ชื่อหมวดหมู่">
                <span class="muted small nowrap">${store.menu.filter((x) => x.category_id === c.id).length} เมนู</span>
                <button class="icon-btn" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="เลื่อนขึ้น">${icon('up')}</button>
                <button class="icon-btn" data-down="${i}" ${i === store.categories.length - 1 ? 'disabled' : ''} aria-label="เลื่อนลง">${icon('down')}</button>
                <button class="icon-btn danger" data-delcat="${c.id}" aria-label="ลบหมวดหมู่">${icon('trash')}</button>
              </div>`).join('') || '<div class="empty small">ยังไม่มีหมวดหมู่</div>'}
          </div>
          <form class="cat-add" data-add>
            <input class="input" name="name" placeholder="ชื่อหมวดหมู่ใหม่" maxlength="60" required>
            <button class="btn btn-primary">${icon('plus')} เพิ่ม</button>
          </form>`;
      };
      drawList();
      ctx.on('store:menu', () => m.el.isConnected && drawList()); // วาดใหม่เมื่อหมวดหมู่เปลี่ยน
      m.el.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api.post('/categories', { name: e.target.name.value });
          e.target.name.value = '';
        } catch (err) {
          toastError(err);
        }
      });
      m.el.addEventListener('change', async (e) => {
        const id = e.target.dataset.rename;
        if (!id) return;
        try {
          await api.put(`/categories/${id}`, { name: e.target.value });
          toast('บันทึกชื่อหมวดหมู่แล้ว', 'success');
        } catch (err) {
          toastError(err);
        }
      });
      m.el.addEventListener('click', async (e) => {
        const up = e.target.closest('[data-up]');
        const down = e.target.closest('[data-down]');
        const del = e.target.closest('[data-delcat]');
        try {
          if (up || down) {
            const i = Number((up || down).dataset[up ? 'up' : 'down']);
            const ids = store.categories.map((c) => c.id);
            const j = up ? i - 1 : i + 1;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            await api.post('/categories/reorder', { ids });
          }
          if (del) {
            const c = store.categories.find((x) => x.id === Number(del.dataset.delcat));
            const n = store.menu.filter((x) => x.category_id === c.id).length;
            if (await confirmDialog(`ลบหมวดหมู่ “${c.name}”?${n ? ` เมนู ${n} รายการในหมวดนี้จะย้ายไป “ไม่มีหมวดหมู่”` : ''}`, { danger: true, ok: 'ลบ' })) {
              await api.del(`/categories/${c.id}`);
            }
          }
        } catch (err) {
          toastError(err);
        }
      });
    }

    root.addEventListener('click', async (e) => {
      const t = e.target;
      const find = (attr) => store.menu.find((m) => m.id === Number(t.closest(`[${attr}]`)?.getAttribute(attr)));
      const cat = t.closest('[data-cat]');
      if (cat) {
        st.cat = cat.dataset.cat;
        return draw();
      }
      if (t.closest('[data-price]')) return editPrice(find('data-price'));
      if (t.closest('[data-edit]')) return editItem(find('data-edit'));
      if (t.closest('[data-del]')) {
        const item = find('data-del');
        if (await confirmDialog(`ลบเมนู “${item.name}”? (ประวัติการขายเดิมยังอยู่ครบ)`, { danger: true, ok: 'ลบเมนู' })) {
          try {
            await api.del(`/menu/${item.id}`);
            toast('ลบเมนูแล้ว');
          } catch (err) {
            toastError(err);
          }
        }
        return;
      }
      const a = t.closest('[data-act]')?.dataset.act;
      if (a === 'add') editItem(null);
      if (a === 'cats') manageCategories();
    });
    root.addEventListener('change', async (e) => {
      const id = e.target.dataset.avail;
      if (!id) return;
      const item = store.menu.find((m) => m.id === Number(id));
      try {
        await api.patch(`/menu/${id}/available`, { available: e.target.checked });
        item.available = e.target.checked ? 1 : 0;
        toast(e.target.checked ? `เปิดขาย “${item.name}” แล้ว` : `ปิด “${item.name}” แล้ว (ของหมด)`, e.target.checked ? 'success' : 'warn');
        draw();
      } catch (err) {
        e.target.checked = !e.target.checked;
        toastError(err);
      }
    });
    root.addEventListener('input', (e) => {
      if (e.target.matches('[data-search]')) {
        st.search = e.target.value;
        draw();
      }
    });

    ctx.on('store:menu', draw);
    draw();
  },
};
