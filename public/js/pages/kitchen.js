// จอครัว: แสดงใบสั่งอาหารแบบเรียลไทม์ สำหรับแท็บเล็ตในครัว (หรือพิมพ์อัตโนมัติ)
import { api, esc, icon, toastError, elapsed, minutesSince, fmtTime, orderNo, storage, serial } from '../lib.js';
import { printKitchenTicket } from '../print.js';

let audioCtx = null;
function ensureAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* ไม่รองรับเสียง */ }
  return audioCtx;
}
function beep() {
  const ac = ensureAudio();
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime;
  [0, 0.2, 0.4].forEach((d, i) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'sine';
    o.frequency.value = i === 2 ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.35, t + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16);
    o.connect(g).connect(ac.destination);
    o.start(t + d);
    o.stop(t + d + 0.18);
  });
}

const signature = (t) => t.order_status + '|' + t.items.map((i) => `${i.id}:${i.status}:${i.qty}`).join(',');

export default {
  async render(root, params, ctx) {
    document.body.classList.add('kitchen-mode');
    const onFs = () => { if (!document.fullscreenElement) document.body.classList.remove('kiosk'); };
    document.addEventListener('fullscreenchange', onFs);
    ctx.cleanup(() => {
      document.body.classList.remove('kitchen-mode', 'kiosk');
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    });

    const prefs = { sound: storage.get('kds.sound', true), autoPrint: storage.get('kds.autoPrint', false) };
    const st = {
      tab: 'new', fresh: [], done: [], seen: null, sigs: new Map(),
      flash: new Set(), struck: new Set(storage.get('kds.struck', [])),
    };

    root.innerHTML = `
      <div class="kds">
        <header class="kds-head">
          <h1>${icon('kitchen')} ครัว</h1>
          <div class="seg" role="tablist">
            <button role="tab" data-tab="new">รอทำ <span class="seg-count" data-count>0</span></button>
            <button role="tab" data-tab="done">เสร็จแล้ว</button>
          </div>
          <div class="kds-tools">
            <button class="btn btn-ghost" data-act="sound"></button>
            <label class="toggle-inline" title="พิมพ์ใบสั่งอาหารอัตโนมัติจากเครื่องนี้เมื่อมีออเดอร์ใหม่">
              <span class="switch"><input type="checkbox" data-act="autoprint" ${prefs.autoPrint ? 'checked' : ''}><span class="slider"></span></span>
              พิมพ์อัตโนมัติ
            </label>
            <button class="btn btn-ghost" data-act="full">${icon('maximize')} เต็มจอ</button>
          </div>
        </header>
        <div class="kds-grid" data-grid></div>
      </div>`;
    const $ = (s) => root.querySelector(s);

    function drawSound() {
      const ready = audioCtx && audioCtx.state === 'running';
      const btn = $('[data-act=sound]');
      btn.innerHTML = prefs.sound
        ? `${icon('volume')} ${ready ? 'เสียงเปิด' : 'แตะเพื่อเปิดเสียง'}`
        : `${icon('mute')} ปิดเสียง`;
      btn.classList.toggle('btn-warn', prefs.sound && !ready);
    }

    function ticketCard(t) {
      const isNew = st.tab === 'new';
      const mins = minutesSince(t.created_at);
      const age = !isNew ? 'is-done' : mins >= 20 ? 'age-late' : mins >= 10 ? 'age-warn' : '';
      const cancelled = t.order_status === 'cancelled';
      return `
        <article class="ticket ${age} ${st.flash.has(t.id) ? 'is-fresh' : ''} ${cancelled ? 'is-cancelled' : ''}">
          <header class="ticket-head">
            <div>
              <div class="ticket-where">${t.type === 'dine_in' ? esc(t.table_name) : `${icon('bag')} กลับบ้าน`}</div>
              <div class="ticket-sub">${orderNo(t.order_no)}${t.customer_name ? ` · ${esc(t.customer_name)}` : ''}${t.prior_tickets ? ' · <b>สั่งเพิ่ม</b>' : ''}</div>
            </div>
            <div class="ticket-time">
              <div>${fmtTime(t.created_at)}</div>
              <div class="ticket-elapsed">${isNew ? elapsed(t.created_at) : `เสร็จ ${fmtTime(t.done_at)}`}</div>
            </div>
          </header>
          ${cancelled ? `<div class="ticket-banner">${icon('alert')} ออเดอร์ถูกยกเลิก — ไม่ต้องทำ</div>` : ''}
          <ul class="ticket-items">
            ${t.items.map((i) => `
              <li class="${i.status === 'void' ? 'is-void' : ''} ${st.struck.has(i.id) ? 'is-struck' : ''}" ${i.status === 'active' && isNew ? `data-strike="${i.id}"` : ''}>
                <span class="ti-qty">${i.qty}</span>
                <div class="ti-main">
                  <div class="ti-name">${esc(i.name)}${i.status === 'void' ? ' <span class="chip chip-danger">ยกเลิก</span>' : ''}</div>
                  ${i.note ? `<div class="ti-note">${esc(i.note)}</div>` : ''}
                </div>
              </li>`).join('')}
          </ul>
          <footer class="ticket-foot">
            <button class="btn btn-ghost" data-print="${t.id}" aria-label="พิมพ์ใบสั่งครัว">${icon('print')}</button>
            ${isNew
              ? `<button class="btn btn-lg btn-success" data-done="${t.id}">${icon('check')} ${cancelled ? 'รับทราบ' : 'เสร็จแล้ว'}</button>`
              : `<button class="btn" data-reopen="${t.id}">${icon('undo')} ย้อนกลับ</button>`}
          </footer>
        </article>`;
    }

    function draw() {
      if (!ctx.alive) return;
      $('[data-count]').textContent = st.fresh.length;
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === st.tab));
      const list = st.tab === 'new' ? st.fresh : st.done;
      $('[data-grid]').innerHTML = list.length
        ? list.map(ticketCard).join('')
        : `<div class="empty kds-empty">${icon(st.tab === 'new' ? 'check' : 'inbox')}<p>${st.tab === 'new' ? 'ไม่มีออเดอร์ค้าง' : 'ยังไม่มีออเดอร์ที่ทำเสร็จ'}</p></div>`;
      drawSound();
    }

    const load = serial(async () => {
      try {
        const fresh = await api.get('/kitchen/tickets?status=new');
        if (!ctx.alive) return;
        const incoming = [];
        const changed = [];
        for (const t of fresh) {
          const sig = signature(t);
          if (st.seen && !st.seen.has(t.id)) incoming.push(t);
          else if (st.sigs.has(t.id) && st.sigs.get(t.id) !== sig) changed.push(t);
          st.sigs.set(t.id, sig);
        }
        if (incoming.length || changed.length) {
          if (prefs.sound) beep();
          const ids = [...incoming, ...changed].map((t) => t.id);
          ids.forEach((id) => st.flash.add(id));
          setTimeout(() => { ids.forEach((id) => st.flash.delete(id)); draw(); }, 8000);
          if (prefs.autoPrint) incoming.forEach(printKitchenTicket);
        }
        st.seen = new Set([...(st.seen || []), ...fresh.map((t) => t.id)]);
        st.fresh = fresh;
        if (st.tab === 'done') st.done = await api.get('/kitchen/tickets?status=done');
        draw();
      } catch (e) {
        console.error(e);
      }
    });

    async function act(path) {
      try {
        await api.post(path);
        await load();
      } catch (e) {
        toastError(e);
      }
    }

    root.addEventListener('click', (e) => {
      ensureAudio();
      const t = e.target;
      const tab = t.closest('[data-tab]');
      if (tab) {
        st.tab = tab.dataset.tab;
        draw();
        load();
        return;
      }
      const done = t.closest('[data-done]');
      if (done) {
        done.disabled = true;
        return act(`/kitchen/tickets/${done.dataset.done}/done`);
      }
      const reopen = t.closest('[data-reopen]');
      if (reopen) return act(`/kitchen/tickets/${reopen.dataset.reopen}/reopen`);
      const pr = t.closest('[data-print]');
      if (pr) {
        const ticket = [...st.fresh, ...st.done].find((x) => x.id === Number(pr.dataset.print));
        if (ticket) printKitchenTicket(ticket);
        return;
      }
      const strike = t.closest('[data-strike]');
      if (strike) {
        const id = Number(strike.dataset.strike);
        if (st.struck.has(id)) st.struck.delete(id);
        else st.struck.add(id);
        storage.set('kds.struck', [...st.struck].slice(-300));
        strike.classList.toggle('is-struck');
        return;
      }
      const a = t.closest('[data-act]')?.dataset.act;
      if (a === 'sound') {
        const ready = audioCtx && audioCtx.state === 'running';
        if (prefs.sound && !ready) {
          ensureAudio();
          setTimeout(() => { beep(); drawSound(); }, 100);
        } else {
          prefs.sound = !prefs.sound;
          storage.set('kds.sound', prefs.sound);
          if (prefs.sound) beep();
        }
        drawSound();
      }
      if (a === 'full') {
        if (document.body.classList.contains('kiosk')) {
          document.body.classList.remove('kiosk');
          if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        } else {
          document.body.classList.add('kiosk');
          document.documentElement.requestFullscreen?.().catch(() => {});
        }
      }
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-act=autoprint]')) {
        prefs.autoPrint = e.target.checked;
        storage.set('kds.autoPrint', prefs.autoPrint);
      }
    });

    ctx.on('kitchen', load);
    ctx.on('orders', load);
    ctx.every(20000, load); // สำรองกรณีการแจ้งเตือนแบบเรียลไทม์หลุด
    ctx.every(30000, draw); // อัปเดตเวลาที่รอ
    await load();
  },
};
