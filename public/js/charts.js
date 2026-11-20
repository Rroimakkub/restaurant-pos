// กราฟแท่งแบบเบา ๆ (HTML/CSS) ไม่ต้องพึ่งไลบรารีภายนอก ใช้งานได้แม้ไม่มีอินเทอร์เน็ต
import { esc, compact } from './lib.js';

function niceScale(max, ticks = 4) {
  if (!(max > 0)) return { top: 100, step: 25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { top: Math.ceil(max / step) * step, step };
}

// กราฟแท่งแนวตั้ง 1 ชุดข้อมูล: points = [{ short, label, value, lines: [..] }]
export function columnChart(el, points, { format = String, ariaLabel = '' } = {}) {
  const max = Math.max(0, ...points.map((p) => p.value));
  const { top, step } = niceScale(max);
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  const every = Math.max(1, Math.ceil(points.length / 12));
  el.innerHTML = `
    <div class="cc" role="img" aria-label="${esc(ariaLabel)}">
      <div class="cc-plot">
        ${ticks.map((v) => `<div class="cc-grid" style="bottom:${(v / top) * 100}%"><span>${compact(v)}</span></div>`).join('')}
        <div class="cc-cols">
          ${points.map((p, i) => `
            <div class="cc-col" tabindex="0" data-i="${i}" aria-label="${esc(p.label)} ${esc(format(p.value))}">
              <div class="cc-bar" style="height:${top ? (p.value / top) * 100 : 0}%"></div>
            </div>`).join('')}
        </div>
      </div>
      <div class="cc-x">${points.map((p, i) => `<span>${i % every === 0 ? esc(p.short) : ''}</span>`).join('')}</div>
      <div class="cc-tip" hidden></div>
    </div>`;
  const tip = el.querySelector('.cc-tip');
  const wrap = el.querySelector('.cc');
  const show = (col) => {
    const p = points[Number(col.dataset.i)];
    tip.replaceChildren();
    const v = document.createElement('strong');
    v.textContent = format(p.value);
    const l = document.createElement('div');
    l.textContent = p.label;
    tip.append(v, l);
    for (const line of p.lines || []) {
      const d = document.createElement('div');
      d.className = 'cc-tip-sub';
      d.textContent = line;
      tip.append(d);
    }
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    const x = cr.left - wr.left + cr.width / 2;
    tip.style.left = `${Math.min(Math.max(x, 70), wr.width - 70)}px`;
    col.classList.add('is-hover');
  };
  const hide = (col) => {
    tip.hidden = true;
    col?.classList.remove('is-hover');
  };
  wrap.addEventListener('pointerover', (e) => { const c = e.target.closest('.cc-col'); if (c) show(c); });
  wrap.addEventListener('pointerout', (e) => { const c = e.target.closest('.cc-col'); if (c) hide(c); });
  wrap.addEventListener('focusin', (e) => { const c = e.target.closest('.cc-col'); if (c) show(c); });
  wrap.addEventListener('focusout', (e) => { const c = e.target.closest('.cc-col'); if (c) hide(c); });
}

// แถบแนวนอนสำหรับจัดอันดับ: rows = [{ label, value, display, sub }]
export function barList(el, rows, { empty = 'ไม่มีข้อมูล' } = {}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  el.innerHTML = rows.length
    ? `<ol class="bl">${rows.map((r, i) => `
        <li class="bl-row" title="${esc(r.label)}: ${esc(r.display)}${r.sub ? ` · ${esc(r.sub)}` : ''}">
          <div class="bl-label"><span class="bl-rank">${i + 1}</span><span class="bl-name">${esc(r.label)}</span>${r.sub ? `<span class="bl-sub">${esc(r.sub)}</span>` : ''}</div>
          <div class="bl-track"><div class="bl-bar" style="--w:${max ? r.value / max : 0}"></div><span class="bl-value">${esc(r.display)}</span></div>
        </li>`).join('')}</ol>`
    : `<div class="empty small">${esc(empty)}</div>`;
}
