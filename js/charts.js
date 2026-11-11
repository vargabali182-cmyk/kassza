'use strict';
/* =====================================================================
   Kassza – small dependency-free SVG charts with hover tooltips
   (donut, grouped bars, line). Thin marks, rounded data ends, recessive grid.
   ===================================================================== */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- tooltip layer ---------- */
const tipRegistry = {};
let tipSeq = 0;
function regTip(html) { const id = 't' + (++tipSeq); tipRegistry[id] = html; return id; }
function showTip(html, x, y) {
  const el = document.getElementById('tooltip');
  el.innerHTML = html; el.classList.add('show');
  const r = el.getBoundingClientRect();
  let left = x + 14, top = y - r.height - 10;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top < 8) top = y + 16;
  el.style.left = Math.max(8, left) + 'px'; el.style.top = top + 'px';
}
function hideTip() { document.getElementById('tooltip').classList.remove('show'); }
document.addEventListener('pointermove', e => {
  const t = e.target.closest && e.target.closest('[data-tipid]');
  if (t && tipRegistry[t.dataset.tipid]) showTip(tipRegistry[t.dataset.tipid], e.clientX, e.clientY);
  else if (!(e.target.closest && e.target.closest('[data-cross]'))) hideTip();
});
document.addEventListener('pointerdown', e => {
  const t = e.target.closest && e.target.closest('[data-tipid]');
  if (t && tipRegistry[t.dataset.tipid]) showTip(tipRegistry[t.dataset.tipid], e.clientX, e.clientY);
});
window.addEventListener('scroll', hideTip, { passive: true });

function tipRows(title, rows) {
  return `<div class="tt">${esc(title)}</div>` + rows.map(r =>
    `<div class="tr"><span>${r.color ? `<i style="background:${r.color}"></i>` : ''}${esc(r.name)}</span><b class="num">${esc(r.value)}</b></div>`).join('');
}

/* ---------- scales ---------- */
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const ticks = []; for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/* ---------- donut ---------- */
function donutChart(segments, { size = 180, centerLabel = '', centerValue = '' } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = size / 2, r = R * 0.62, cx = R, cy = R;
  if (!total) return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--surface-2)" stroke-width="${R - r}"/></svg>`;
  let a0 = -Math.PI / 2, paths = '';
  const pt = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  for (const s of segments) {
    const frac = s.value / total; if (frac <= 0) continue;
    const a1 = a0 + frac * Math.PI * 2 - (frac >= 0.9999 ? 0.0001 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`;
    const tid = regTip(tipRows(s.label, [{ name: 'Összeg', value: money(s.value) }, { name: 'Arány', value: (frac * 100).toFixed(1) + '%' }]));
    paths += `<path d="${d}" fill="${s.color}" stroke="var(--surface)" stroke-width="2" data-tipid="${tid}" style="cursor:pointer"/>`;
    a0 = a1;
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(centerLabel)}">${paths}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="12" fill="var(--text-2)">${esc(centerLabel)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="16" font-weight="800" fill="var(--text)">${esc(centerValue)}</text></svg>`;
}

/* ---------- grouped bars (e.g. income vs expense per month) ---------- */
function barChart(groups, seriesDefs, { height = 200 } = {}) {
  const W = 600, H = height, padL = 44, padB = 24, padT = 8, padR = 6;
  const max = Math.max(1, ...groups.flatMap(g => g.values));
  const ticks = niceTicks(max), top = ticks[ticks.length - 1];
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  const gw = (W - padL - padR) / groups.length, n = seriesDefs.length;
  const bw = Math.min(26, (gw * 0.7 - (n - 1) * 2) / n);
  let grid = '', bars = '', hits = '', labels = '';
  for (const t of ticks) grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${moneyShort(t)}</text>`;
  groups.forEach((g, i) => {
    const gx = padL + gw * i + (gw - (n * bw + (n - 1) * 2)) / 2;
    g.values.forEach((v, j) => {
      if (v <= 0) return;
      const x = gx + j * (bw + 2), yt = y(v), h = y(0) - yt, rr = Math.min(4, h, bw / 2);
      bars += `<path d="M${x},${y(0)} V${yt + rr} Q${x},${yt} ${x + rr},${yt} H${x + bw - rr} Q${x + bw},${yt} ${x + bw},${yt + rr} V${y(0)} Z" fill="${seriesDefs[j].color}"/>`;
    });
    const tid = regTip(tipRows(g.title || g.label, g.values.map((v, j) => ({ name: seriesDefs[j].name, value: money(v), color: seriesDefs[j].color }))
      .concat(g.extra ? [{ name: g.extra.name, value: g.extra.value }] : [])));
    hits += `<rect x="${padL + gw * i}" y="${padT}" width="${gw}" height="${H - padT - padB}" fill="transparent" data-tipid="${tid}"/>`;
    labels += `<text x="${padL + gw * i + gw / 2}" y="${H - 6}" text-anchor="middle">${esc(g.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img"><g class="grid axis">${grid}</g>
    <line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--border)"/>${bars}<g class="axis">${labels}</g>${hits}</svg>
    <div class="legend">${seriesDefs.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

/* ---------- line chart with crosshair ---------- */
const lineData = {};
function lineChart(points, { height = 190, color = 'var(--s1)', name = '' } = {}) {
  const W = 600, H = height, padL = 52, padB = 24, padT = 10, padR = 10;
  const vals = points.map(p => p.value);
  let min = Math.min(0, ...vals), max = Math.max(1, ...vals);
  const span = max - min || 1; const tickStep = niceTicks(span)[1] || span;
  min = Math.floor(min / tickStep) * tickStep; max = Math.ceil(max / tickStep) * tickStep;
  const ticks = []; for (let v = min; v <= max + tickStep / 1000; v += tickStep) ticks.push(v);
  const x = i => padL + (W - padL - padR) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min || 1));
  let grid = '';
  for (const t of ticks) grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${moneyShort(t)}</text>`;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const step = Math.ceil(points.length / 7);
  const labels = points.map((p, i) => i % step === 0 || i === points.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : '').join('');
  const id = 'ln' + (++tipSeq);
  lineData[id] = { points, x, y, W, H, padL, padR, color, name };
  const lastI = points.length - 1;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" id="${id}"><g class="grid axis">${grid}</g>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(lastI)}" cy="${y(points[lastI].value)}" r="4" fill="${color}" stroke="var(--surface)" stroke-width="2"/>
    <g class="axis">${labels}</g>
    <line class="xh" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--text-2)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>
    <circle class="xm" r="5" fill="${color}" stroke="var(--surface)" stroke-width="2" opacity="0"/>
    <rect x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent" data-cross="${id}"/></svg>`;
}
function crossMove(e) {
  const t = e.target.closest && e.target.closest('[data-cross]');
  if (!t) return;
  const L = lineData[t.dataset.cross]; if (!L) return;
  const svg = t.ownerSVGElement, rect = svg.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (L.W / rect.width);
  let best = 0, bd = Infinity;
  L.points.forEach((p, i) => { const dd = Math.abs(L.x(i) - sx); if (dd < bd) { bd = dd; best = i; } });
  const p = L.points[best];
  const xh = svg.querySelector('.xh'), xm = svg.querySelector('.xm');
  xh.setAttribute('x1', L.x(best)); xh.setAttribute('x2', L.x(best)); xh.setAttribute('opacity', 1);
  xm.setAttribute('cx', L.x(best)); xm.setAttribute('cy', L.y(p.value)); xm.setAttribute('opacity', 1);
  showTip(tipRows(p.title || p.label, [{ name: L.name, value: money(p.value), color: L.color }]), e.clientX, e.clientY);
}
document.addEventListener('pointermove', crossMove);
document.addEventListener('pointerdown', crossMove);
document.addEventListener('pointerout', e => {
  const t = e.target.closest && e.target.closest('[data-cross]');
  if (!t) return;
  const svg = t.ownerSVGElement;
  svg.querySelector('.xh').setAttribute('opacity', 0); svg.querySelector('.xm').setAttribute('opacity', 0); hideTip();
});
