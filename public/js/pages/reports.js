// รายงาน: ยอดขายรายวัน/รายเดือน, เมนูขายดี, ค่าใช้จ่ายตามหมวด, กำไรคร่าวๆ
import { api, esc, baht, num, icon, toastError, today, fmtDate, storage } from '../lib.js';
import { columnChart, barList } from '../charts.js';

const pad = (n) => String(n).padStart(2, '0');

export default {
  async render(root, params, ctx) {
    const now = today();
    const st = {
      mode: storage.get('rep.mode', 'day'),
      month: now.slice(0, 7),
      year: Number(now.slice(0, 4)),
      data: null,
    };
    root.innerHTML = `
      <div class="page">
        <header class="page-head">
          <div><h1>รายงาน</h1><p class="sub">ยอดขายนับตามวันที่ชำระเงิน · กำไรคร่าวๆ = ยอดขาย − ค่าใช้จ่ายที่บันทึกไว้</p></div>
          <div class="head-actions"><button class="btn" data-csv>${icon('download')} ดาวน์โหลด CSV</button></div>
        </header>
        <div class="toolbar">
          <div class="seg" role="tablist">
            <button role="tab" data-mode="day">รายวัน</button>
            <button role="tab" data-mode="month">รายเดือน</button>
          </div>
          <div class="period-nav">
            <button class="icon-btn" data-step="-1" aria-label="ก่อนหน้า">${icon('back')}</button>
            <span class="period-label" data-period></span>
            <button class="icon-btn" data-step="1" aria-label="ถัดไป">${icon('next')}</button>
          </div>
        </div>
        <div data-body><div class="page-loading">กำลังโหลด…</div></div>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const body = $('[data-body]');

    function range() {
      if (st.mode === 'month') return { from: `${st.year}-01-01`, to: `${st.year}-12-31` };
      const [y, m] = st.month.split('-').map(Number);
      return { from: `${st.month}-01`, to: `${st.month}-${pad(new Date(y, m, 0).getDate())}` };
    }
    const periodLabel = () => (st.mode === 'month' ? `ปี ${st.year + 543}` : fmtDate(`${st.month}-01`, { month: 'long', year: 'numeric' }));
    const rowLabel = (p) => (st.mode === 'month' ? fmtDate(`${p}-01`, { month: 'long', year: 'numeric' }) : fmtDate(p, { weekday: 'short', day: 'numeric', month: 'short' }));

    async function load() {
      root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === st.mode));
      $('[data-period]').textContent = periodLabel();
      const atLatest = st.mode === 'month' ? st.year >= Number(now.slice(0, 4)) : st.month >= now.slice(0, 7);
      $('[data-step="1"]').disabled = atLatest;
      body.classList.add('is-loading');
      try {
        const { from, to } = range();
        st.data = await api.get(`/reports?from=${from}&to=${to}&group=${st.mode}`);
        if (ctx.alive) draw();
      } catch (e) {
        toastError(e);
      } finally {
        body.classList.remove('is-loading');
      }
    }

    function draw() {
      const d = st.data;
      const t = d.totals;
      const avg = t.bills ? t.sales / t.bills : 0;
      const limit = st.mode === 'month' ? now.slice(0, 7) : now;
      const rows = d.series.filter((s) => s.period <= limit);
      body.innerHTML = `
        <div class="kpi-grid">
          <div class="kpi kpi-hero"><div class="kpi-label">ยอดขาย</div><div class="kpi-value">${baht(t.sales)}</div><div class="kpi-extra">เงินสด ${baht(t.cash)} · พร้อมเพย์ ${baht(t.promptpay)}</div></div>
          <div class="kpi"><div class="kpi-label">ค่าใช้จ่าย</div><div class="kpi-value">${baht(t.expenses)}</div></div>
          <div class="kpi ${t.profit >= 0 ? 'kpi-good' : 'kpi-bad'}"><div class="kpi-label">กำไรคร่าวๆ</div><div class="kpi-value">${baht(t.profit)}</div><div class="kpi-extra">${t.sales && Math.abs(t.profit) <= t.sales ? `${num((t.profit / t.sales) * 100)}% ของยอดขาย` : '&nbsp;'}</div></div>
          <div class="kpi"><div class="kpi-label">จำนวนบิล</div><div class="kpi-value">${num(t.bills)}</div></div>
          <div class="kpi"><div class="kpi-label">เฉลี่ยต่อบิล</div><div class="kpi-value">${baht(avg)}</div></div>
        </div>

        <section class="card">
          <div class="card-head"><h2>ยอดขาย${st.mode === 'month' ? 'รายเดือน' : 'รายวัน'} · ${esc(periodLabel())}</h2></div>
          <div data-chart></div>
        </section>

        <div class="two-col">
          <section class="card">
            <div class="card-head"><h2>เมนูขายดี</h2><span class="muted small">ตามจำนวนที่ขายได้</span></div>
            <div data-top></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>ค่าใช้จ่ายตามหมวด</h2></div>
            <div data-exp></div>
          </section>
        </div>

        <section class="card">
          <div class="card-head"><h2>ตาราง${st.mode === 'month' ? 'รายเดือน' : 'รายวัน'}</h2></div>
          <div class="table-wrap flat">
            <table class="data">
              <thead><tr><th>${st.mode === 'month' ? 'เดือน' : 'วันที่'}</th><th class="num">บิล</th><th class="num">ยอดขาย</th><th class="num">เงินสด</th><th class="num">พร้อมเพย์</th><th class="num">ค่าใช้จ่าย</th><th class="num">กำไรคร่าวๆ</th></tr></thead>
              <tbody>
                ${rows.slice().reverse().map((s) => `
                  <tr class="${s.bills || s.expenses ? '' : 'is-empty'}">
                    <td class="nowrap">${st.mode === 'day' ? `<a href="#/finance/day/${s.period}">${rowLabel(s.period)}</a>` : rowLabel(s.period)}</td>
                    <td class="num">${s.bills || '—'}</td>
                    <td class="num">${s.sales ? num(s.sales) : '—'}</td>
                    <td class="num">${s.cash ? num(s.cash) : '—'}</td>
                    <td class="num">${s.promptpay ? num(s.promptpay) : '—'}</td>
                    <td class="num">${s.expenses ? num(s.expenses) : '—'}</td>
                    <td class="num ${s.profit < 0 ? 'text-danger' : ''}">${s.sales || s.expenses ? num(s.profit) : '—'}</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot><tr class="strong"><td>รวม</td><td class="num">${num(t.bills)}</td><td class="num">${num(t.sales)}</td><td class="num">${num(t.cash)}</td><td class="num">${num(t.promptpay)}</td><td class="num">${num(t.expenses)}</td><td class="num ${t.profit < 0 ? 'text-danger' : ''}">${num(t.profit)}</td></tr></tfoot>
            </table>
          </div>
        </section>`;

      columnChart(
        body.querySelector('[data-chart]'),
        d.series.map((s) => ({
          short: st.mode === 'month' ? fmtDate(`${s.period}-01`, { month: 'short' }) : String(Number(s.period.slice(8))),
          label: rowLabel(s.period),
          value: s.sales,
          lines: [`${s.bills} บิล`, `ค่าใช้จ่าย ${baht(s.expenses)}`, `กำไรคร่าวๆ ${baht(s.profit)}`],
        })),
        { format: baht, ariaLabel: `กราฟยอดขาย ${periodLabel()}` }
      );
      barList(
        body.querySelector('[data-top]'),
        d.topItems.map((i) => ({ label: i.name, value: i.qty, display: `ขาย ${num(i.qty)}`, sub: baht(i.revenue) })),
        { empty: 'ยังไม่มียอดขายในช่วงนี้' }
      );
      barList(
        body.querySelector('[data-exp]'),
        d.expensesByCategory.map((e) => ({ label: e.category, value: e.amount, display: baht(e.amount) })),
        { empty: 'ยังไม่มีค่าใช้จ่ายในช่วงนี้' }
      );
    }

    function downloadCsv() {
      if (!st.data) return;
      const head = [st.mode === 'month' ? 'เดือน' : 'วันที่', 'จำนวนบิล', 'ยอดขาย', 'เงินสด', 'พร้อมเพย์', 'ส่วนลด', 'ค่าใช้จ่าย', 'กำไรคร่าวๆ'];
      const lines = [head, ...st.data.series.map((s) => [s.period, s.bills, s.sales, s.cash, s.promptpay, s.discount, s.expenses, s.profit])];
      lines.push([], ['เมนูขายดี', 'จำนวน', 'ยอดขาย'], ...st.data.topItems.map((i) => [i.name, i.qty, i.revenue]));
      const csv = '﻿' + lines.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `report-${st.mode === 'month' ? st.year : st.month}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    root.addEventListener('click', (e) => {
      const mode = e.target.closest('[data-mode]');
      if (mode) {
        st.mode = mode.dataset.mode;
        storage.set('rep.mode', st.mode);
        return load();
      }
      const step = e.target.closest('[data-step]');
      if (step && !step.disabled) {
        const n = Number(step.dataset.step);
        if (st.mode === 'month') st.year += n;
        else {
          const [y, m] = st.month.split('-').map(Number);
          const d = new Date(y, m - 1 + n, 1);
          st.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
        }
        return load();
      }
      if (e.target.closest('[data-csv]')) downloadCsv();
    });

    ctx.on('sales', load);
    ctx.on('expenses', load);
    await load();
  },
};
