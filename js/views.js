'use strict';
/* =====================================================================
   Kassza – views (each returns HTML; events are handled in app.js via data-act)
   ===================================================================== */

const UI = {
  route: 'home', param: null, history: [],
  month: thisYm(),
  txf: { q: '', account: '', category: '', type: '', tag: '' }, txMode: 'list', calDay: null,
  rRange: 'month', rMonth: thisYm(), rTable: false,
  showSettledDebts: false, showArchived: false,
};

/* ---------- shared bits ---------- */
const amountClass = v => v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '';
function accIcon(a) { return (ACCOUNT_TYPES[a.type] || ACCOUNT_TYPES.bank).emoji; }
function monthNav(act, ym) {
  return `<div class="month-nav"><button data-act="${act}" data-d="-1" aria-label="Előző hónap">‹</button>
    <div class="m">${esc(fmtMonth(ym))}</div><button data-act="${act}" data-d="1" aria-label="Következő hónap">›</button></div>`;
}
function emptyBox(emoji, text, btn = '') { return `<div class="empty"><div class="big">${emoji}</div><div>${text}</div>${btn ? `<div class="btns" style="justify-content:center">${btn}</div>` : ''}</div>`; }
function txTitle(t) {
  if (t.type === 'transfer') return t.payee || `${(acc(t.accountId) || {}).name || '?'} → ${(acc(t.toAccountId) || {}).name || '?'}`;
  if (t.payee) return t.payee;
  if (t.splits && t.splits.length) return 'Megosztott tétel';
  return (cat(t.categoryId) || {}).name || 'Kategória nélkül';
}
function txRow(t, { showDate = false, runBal = null } = {}) {
  const c = cat(t.categoryId), a = acc(t.accountId), cur = txCurrency(t);
  let icon = c ? c.emoji : '❔', bg = c ? `background:color-mix(in srgb, ${catColor(c)} 18%, transparent)` : '';
  if (t.type === 'transfer') { icon = '↔️'; bg = ''; }
  if (t.splits && t.splits.length) icon = '✂️';
  const sign = t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0;
  const sub = [];
  if (showDate) sub.push(fmtDate(t.date));
  if (t.type === 'transfer') sub.push(`${a ? a.name : '?'} → ${(acc(t.toAccountId) || {}).name || '?'}`);
  else {
    if (t.splits && t.splits.length) sub.push(t.splits.map(s => (cat(s.categoryId) || {}).name).filter(Boolean).join(', '));
    else if (t.payee && c) sub.push(c.name);
    if (a) sub.push(a.name);
  }
  if (t.tags && t.tags.length) sub.push(t.tags.map(x => '#' + x).join(' '));
  if (t.recurringId) sub.push('🔁');
  if (t.note) sub.push(t.note);
  return `<li class="item click" data-act="editTx" data-id="${t.id}">
    <div class="ico" style="${bg}">${icon}</div>
    <div class="grow"><div class="t1 ellipsis">${esc(txTitle(t))}</div><div class="t2 ellipsis">${esc(sub.join(' · '))}</div></div>
    <div class="right"><div class="amt num ${sign > 0 ? 'pos' : sign < 0 ? '' : 'muted'}">${sign > 0 ? '+' : sign < 0 ? '−' : ''}${money(t.amount, cur)}</div>
    ${runBal != null ? `<div class="t2 num">${money(runBal, cur)}</div>` : ''}</div></li>`;
}
function catOptions(kind = 'expense', selected = '', withEmpty = true) {
  let h = withEmpty ? '<option value="">– Kategória –</option>' : '';
  for (const g of S.groups.filter(g => kind === 'all' || (kind === 'income' ? g.income : !g.income))) {
    const cs = S.categories.filter(c => c.groupId === g.id && (kind === 'all' || c.kind === kind));
    if (!cs.length) continue;
    h += `<optgroup label="${esc(g.name)}">` + cs.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('') + '</optgroup>';
  }
  const orphan = S.categories.filter(c => !grp(c.groupId) && (kind === 'all' || c.kind === kind));
  h += orphan.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
  return h;
}
function accOptions(selected = '', withEmpty = false, label = '– Számla –') {
  return (withEmpty ? `<option value="">${label}</option>` : '') +
    S.accounts.filter(a => !a.archived || a.id === selected).map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${accIcon(a)} ${esc(a.name)}${a.currency !== S.settings.currency ? ' (' + a.currency + ')' : ''}</option>`).join('');
}

/* =========================== WELCOME =========================== */
function viewWelcome() {
  return { title: 'Kassza', html: `<div class="welcome">
    <div class="big">💰</div><h2>Üdv a Kasszában!</h2>
    <p>Ingyenes, reklámmentes költségkövető és borítékos költségvetés. <b>Minden adat csak ezen az eszközön van</b>, internet nélkül is működik.</p>
    <ul class="feature-list">
      <li>✉️ Borítékos költségvetés – minden forintnak legyen feladata</li>
      <li>📒 Kiadások, bevételek, átvezetések, megosztott tételek, címkék</li>
      <li>🔁 Ismétlődő tételek és előfizetések – automatikus rögzítéssel</li>
      <li>🎯 Megtakarítási célok · 🤝 Kölcsönök és tartozások</li>
      <li>📊 Kimutatások: kategóriák, havi trend, nettó vagyon, partnerek</li>
      <li>💱 Több pénznem · 🏦 Banki CSV import · 💾 Mentés és visszaállítás</li>
      <li>🔒 PIN kódos zár · 🌙 Sötét mód</li>
    </ul>
    <div class="field" style="max-width:300px;margin:14px auto"><span>Fő pénznem</span>
      <select class="input" id="welcomeCur">${CURRENCIES.map(c => `<option ${c === S.settings.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="btns" style="max-width:420px;margin:12px auto"><button class="btn primary" data-act="startEmpty">Kezdjük!</button>
    <button class="btn" data-act="startDemo">Kipróbálom demó adatokkal</button></div></div>` };
}

/* =========================== HOME =========================== */
function viewHome() {
  const bal = balances(), nw = netWorth(bal), m = thisYm(), a = rangeAgg(m, m), b = budgetMonth(m);
  const accs = activeAccounts();
  let accHtml = accs.map(x => {
    const v = bal[x.id] || 0;
    return `<li class="item click" data-act="openAccount" data-id="${x.id}"><div class="ico">${accIcon(x)}</div>
      <div class="grow"><div class="t1 ellipsis">${esc(x.name)}</div><div class="t2">${ACCOUNT_TYPES[x.type].name}</div></div>
      <div class="right"><div class="amt num ${v < 0 ? 'neg' : ''}">${money(v, x.currency)}</div>
      ${x.currency !== S.settings.currency ? `<div class="t2 num">≈ ${money(toMain(v, x.currency))}</div>` : ''}</div></li>`;
  }).join('');
  const up = upcoming(14).slice(0, 5);
  const upHtml = up.length ? up.map(u => `<li class="item click" data-act="editRecurring" data-id="${u.r.id}">
      <div class="ico">${u.r.type === 'income' ? '💰' : (cat(u.r.categoryId) || {}).emoji || '🔁'}</div>
      <div class="grow"><div class="t1 ellipsis">${esc(u.r.name)}</div><div class="t2">${fmtDate(u.date)} · ${relDay(u.date)}${u.r.auto ? ' · automatikus' : ''}</div></div>
      <div class="right"><div class="amt num">${u.r.type === 'income' ? '+' : '−'}${money(u.r.amount, (acc(u.r.accountId) || {}).currency)}</div>
      ${!u.r.auto && u.date <= today() ? `<button class="btn sm primary" data-act="postRecurring" data-id="${u.r.id}">Rögzít</button>` : ''}</div></li>`).join('')
    : '<li class="empty small">Nincs esedékes tétel a következő 2 hétben.</li>';
  const over = expenseCats().map(c => ({ c, r: b.rows[c.id] })).filter(x => x.r && x.r.available < -0.004);
  const near = expenseCats().map(c => ({ c, r: b.rows[c.id] })).filter(x => x.r && x.r.available > 0.004 && (x.r.carry + x.r.assigned) > 0 && x.r.spent / (x.r.carry + x.r.assigned) >= 0.9);
  const warn = over.length || near.length ? `<div class="card"><h2>⚠️ Figyelem</h2><div class="row wrap">
      ${over.map(x => `<span class="chip bad">⛔ ${x.c.emoji} ${esc(x.c.name)}: ${money(x.r.available)}</span>`).join('')}
      ${near.map(x => `<span class="chip warn">⚠ ${x.c.emoji} ${esc(x.c.name)}: ${Math.round(x.r.spent / (x.r.carry + x.r.assigned) * 100)}%</span>`).join('')}
    </div></div>` : '';
  const top = Object.entries(a.spend).sort((x, y) => y[1] - x[1]).slice(0, 5);
  const topHtml = top.length ? top.map(([id, v]) => {
    const c = cat(id) || { name: 'Kategória nélkül', emoji: '❔' }, r = b.rows[id];
    const lim = r ? r.carry + r.assigned : 0, p = lim > 0 ? Math.min(100, v / lim * 100) : 0;
    return `<div style="margin-bottom:10px"><div class="row between small"><span>${c.emoji} ${esc(c.name)}</span>
      <span class="num"><b>${money(v)}</b>${lim > 0 ? ` <span class="muted">/ ${money(lim)}</span>` : ''}</span></div>
      ${lim > 0 ? `<div class="bar ${v > lim ? 'over' : p > 90 ? 'warn' : ''}"><i style="width:${p}%"></i></div>` : ''}</div>`;
  }).join('') : '<div class="empty small">Ebben a hónapban még nincs kiadás.</div>';
  const recent = S.txs.slice(0, 6).map(t => txRow(t, { showDate: true })).join('');
  return { title: 'Áttekintés', html: `
    <div class="card hero"><div class="label">Nettó vagyon</div><div class="value num ${nw < 0 ? 'neg' : ''}">${money(nw)}</div>
      <div class="tiles" style="margin-top:12px">
        <div class="tile"><div class="v num pos">${money(a.income)}</div><div class="l">Bevétel (hó)</div></div>
        <div class="tile"><div class="v num">${money(a.expense)}</div><div class="l">Kiadás (hó)</div></div>
        <div class="tile click" data-act="go" data-route="budget" style="cursor:pointer"><div class="v num ${amountClass(b.toAssign)}">${money(b.toAssign)}</div><div class="l">Kiosztható</div></div>
      </div></div>
    ${reviewBanner()}
    ${insightsCard(thisYm(), { limit: 3, compact: true })}
    ${warn}
    <div class="card"><div class="card-head"><h2>Számlák</h2><button class="link" data-act="newAccount">+ Új számla</button></div>
      <ul class="list">${accHtml || '<li class="empty small">Még nincs számlád.</li>'}</ul></div>
    <div class="card"><div class="card-head"><h2>Hamarosan esedékes</h2><button class="link" data-act="go" data-route="recurring">Mind</button></div><ul class="list">${upHtml}</ul></div>
    <div class="card"><div class="card-head"><h2>Költés e hónapban</h2><button class="link" data-act="go" data-route="reports">Kimutatás</button></div>${topHtml}</div>
    <div class="card"><div class="card-head"><h2>Legutóbbi tételek</h2><button class="link" data-act="go" data-route="tx">Mind</button></div>
      <ul class="list">${recent || '<li class="empty small">Még nincs tétel. Nyomd meg a ＋ gombot!</li>'}</ul></div>` };
}

/* =========================== TRANSACTIONS =========================== */
function filteredTxs() {
  const f = UI.txf, q = f.q.trim().toLowerCase();
  return S.txs.filter(t => {
    if (!q && ymOf(t.date) !== UI.month) return false;
    if (f.account && t.accountId !== f.account && t.toAccountId !== f.account) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.category && !txParts(t).some(p => p.categoryId === f.category)) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    if (q) {
      const hay = [t.payee, t.note, (cat(t.categoryId) || {}).name, (acc(t.accountId) || {}).name, (t.tags || []).join(' '), String(t.amount)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function viewTx() {
  const list = filteredTxs(), f = UI.txf;
  let inc = 0, exp = 0;
  for (const t of list) { const v = toMain(t.amount, txCurrency(t)); if (t.type === 'income') inc += v; else if (t.type === 'expense') exp += v; }
  const tags = allTags();
  const filters = `<div class="toolbar">${f.q ? '<b class="small">Keresés minden hónapban</b>' : monthNav('txMonth', UI.month)}
      <div class="seg" style="margin:0;margin-left:auto"><button data-act="txMode" data-v="list" class="${UI.txMode === 'list' ? 'on' : ''}">☰ Lista</button>
      <button data-act="txMode" data-v="cal" class="${UI.txMode === 'cal' ? 'on' : ''}">📅 Naptár</button></div></div>
    <div class="toolbar"><input class="input grow" type="search" placeholder="🔍 Keresés (partner, megjegyzés, összeg…)" data-input="txq" value="${esc(f.q)}" style="min-width:180px">
      <select class="input" data-input="txacc" style="width:auto">${accOptions(f.account, true, 'Minden számla')}</select>
      <select class="input" data-input="txcat" style="width:auto">${catOptions('all', f.category).replace('– Kategória –', 'Minden kategória')}</select>
      <select class="input" data-input="txtype" style="width:auto"><option value="">Minden típus</option>
        ${[['expense', 'Kiadás'], ['income', 'Bevétel'], ['transfer', 'Átvezetés']].map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${tags.length ? `<select class="input" data-input="txtag" style="width:auto"><option value="">Minden címke</option>${tags.map(x => `<option ${f.tag === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}
    </div>`;
  const summary = `<div class="tiles" style="margin-bottom:12px"><div class="tile"><div class="v num pos">${money(inc)}</div><div class="l">Bevétel</div></div>
    <div class="tile"><div class="v num">${money(exp)}</div><div class="l">Kiadás</div></div>
    <div class="tile"><div class="v num ${amountClass(inc - exp)}">${money(inc - exp, undefined, true)}</div><div class="l">Egyenleg · ${list.length} db</div></div></div>`;
  let body;
  if (UI.txMode === 'cal' && !f.q) body = calendarView(list);
  else body = groupedList(list);
  return { title: 'Tranzakciók', actions: `<button class="top-btn" data-act="exportCsv">⤓ CSV</button>`, html: filters + summary + `<div class="card">${body}</div>` };
}
function groupedList(list) {
  if (!list.length) return emptyBox('🧾', 'Nincs találat ebben a nézetben.', '<button class="btn primary" data-act="newTx">＋ Új tétel</button>');
  let h = '', curDay = null, buf = [];
  const flush = () => {
    if (!curDay) return;
    const net = buf.reduce((s, t) => s + (t.type === 'income' ? 1 : t.type === 'expense' ? -1 : 0) * toMain(t.amount, txCurrency(t)), 0);
    h += `<div class="day-head"><span>${esc(fmtDay(curDay))}</span><span class="num ${amountClass(net)}">${money(net, undefined, true)}</span></div><ul class="list">${buf.map(t => txRow(t)).join('')}</ul>`;
  };
  for (const t of list) { if (t.date !== curDay) { flush(); curDay = t.date; buf = []; } buf.push(t); }
  flush();
  return h;
}
function calendarView(list) {
  const [y, m] = UI.month.split('-').map(Number), dim = daysInMonth(y, m);
  const first = (new Date(y, m - 1, 1).getDay() + 7 - S.settings.weekStart) % 7;
  const by = {};
  for (const t of list) { const d = by[t.date] || (by[t.date] = { e: 0, i: 0 }); const v = toMain(t.amount, txCurrency(t)); if (t.type === 'expense') d.e += v; else if (t.type === 'income') d.i += v; }
  const dows = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];
  let h = '<div class="cal">' + [0, 1, 2, 3, 4, 5, 6].map(i => `<div class="dow">${dows[(i + S.settings.weekStart) % 7]}</div>`).join('');
  for (let i = 0; i < first; i++) h += '<div class="d blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const iso = `${UI.month}-${pad(d)}`, x = by[iso];
    h += `<button class="d ${iso === today() ? 'today' : ''} ${iso === UI.calDay ? 'sel' : ''}" data-act="calDay" data-d="${iso}"><div class="n">${d}</div>
      ${x && x.e ? `<div class="e num">−${moneyShort(x.e)}</div>` : ''}${x && x.i ? `<div class="i num">+${moneyShort(x.i)}</div>` : ''}</button>`;
  }
  h += '</div>';
  if (UI.calDay && ymOf(UI.calDay) === UI.month) {
    const dl = list.filter(t => t.date === UI.calDay);
    h += `<div class="day-head" style="margin-top:8px"><span>${esc(fmtDay(UI.calDay))}</span></div>` +
      (dl.length ? `<ul class="list">${dl.map(t => txRow(t)).join('')}</ul>` : '<div class="empty small">Nincs tétel ezen a napon.</div>');
  } else h += '<p class="small muted center">Koppints egy napra a tételeihez.</p>';
  return h;
}

/* =========================== BUDGET =========================== */
function viewBudget() {
  const m = UI.month, b = budgetMonth(m);
  const cls = b.toAssign > 0.5 ? 'pos' : b.toAssign < -0.5 ? 'neg' : 'zero';
  const msg = cls === 'pos' ? 'Ennyi pénznek még nincs feladata – oszd ki a borítékokba!'
    : cls === 'neg' ? 'Több pénzt osztottál ki, mint amennyid van. Vegyél vissza valahonnan.'
    : 'Minden forintnak van feladata. 👏';
  let h = `<div class="toolbar">${monthNav('budgetMonth', m)}<button class="btn sm" data-act="autoAssign" style="margin-left:auto">⚡ Automatikus kiosztás</button></div>
    <div class="to-assign ${cls}"><div class="small">Kiosztható</div><div class="v num">${money(b.toAssign)}</div><div class="small">${msg}</div></div>
    <div class="tiles" style="margin-bottom:12px"><div class="tile"><div class="v num">${money(b.assignedTotal)}</div><div class="l">Kiosztva</div></div>
    <div class="tile"><div class="v num">${money(b.spentTotal)}</div><div class="l">Elköltve</div></div>
    <div class="tile"><div class="v num pos">${money(b.income)}</div><div class="l">Bevétel</div></div></div>`;
  if (b.overspent < -0.5) h += `<div class="card" style="border-color:var(--bad)"><b class="neg">⛔ Túlköltés: ${money(b.overspent)}</b><div class="small muted">Csoportosíts át pénzt egy másik borítékból, különben a következő havi kiosztható összegből vonódik le.</div></div>`;
  h += '<div class="card">';
  for (const g of S.groups.filter(g => !g.income)) {
    const cs = expenseCats().filter(c => c.groupId === g.id);
    if (!cs.length) continue;
    const gs = cs.reduce((s, c) => s + (b.rows[c.id] ? b.rows[c.id].available : 0), 0);
    h += `<div class="bgroup"><span>${esc(g.name)}</span><span class="num">${money(gs)}</span></div>`;
    for (const c of cs) {
      const r = b.rows[c.id] || { assigned: 0, spent: 0, carry: 0, available: 0 };
      const lim = r.carry + r.assigned, p = lim > 0 ? Math.min(100, r.spent / lim * 100) : (r.spent > 0 ? 100 : 0);
      const ac = r.available > 0.004 ? 'pos' : r.available < -0.004 ? 'neg' : 'zero';
      let hint = '';
      if (c.target > 0 && r.assigned < c.target) hint = `<span class="chip warn">🎯 még ${money(c.target - r.assigned)} kell a ${money(c.target)}/hó célhoz</span>`;
      else if (c.target > 0) hint = `<span class="chip good">🎯 havi cél teljesítve</span>`;
      h += `<div class="brow"><div class="top"><span>${c.emoji}</span><span class="name ellipsis">${esc(c.name)}</span>
          <span class="avail num ${ac}">${money(r.available)}</span></div>
        <div class="cols"><label>Kiosztva<input class="assign-input num" inputmode="decimal" data-assign="${c.id}" value="${r.assigned ? round2(r.assigned) : ''}" placeholder="0"></label>
          <div>Költés<b class="num">${money(r.spent)}</b></div><div>Előző hóról<b class="num">${money(r.carry)}</b></div></div>
        <div class="bar ${r.available < -0.004 ? 'over' : p > 90 ? 'warn' : ''}"><i style="width:${p}%"></i></div>${hint ? `<div style="margin-top:6px">${hint}</div>` : ''}</div>`;
    }
  }
  h += `</div><p class="small muted">💡 <b>Hogyan működik?</b> A bevételed a „Kiosztható” kasszába kerül. Oszd szét borítékokba (kategóriákba). Ami egy borítékban megmarad, átkerül a következő hónapra. Ha túlköltesz, azt a következő havi kiosztható összeg fedezi. Összeget is beírhatsz számolással, pl. <code>12000+3500</code>.</p>`;
  return { title: 'Költségvetés', html: h };
}

/* =========================== REPORTS =========================== */
function reportRange() {
  const end = UI.rMonth;
  const n = { month: 1, q: 3, half: 6, year: 12 }[UI.rRange];
  return { from: addMonthsYm(end, -(n - 1)), to: end, n };
}
function netWorthSeries(months) {
  // net worth at the end of each month
  const ends = months.map(m => addMonthsYm(m, 1) + '-01');
  const sorted = [...S.txs].sort((a, b) => a.date.localeCompare(b.date));
  const bal = {}; for (const a of S.accounts) bal[a.id] = a.start || 0;
  const out = []; let i = 0;
  for (let k = 0; k < months.length; k++) {
    while (i < sorted.length && sorted[i].date < ends[k]) {
      const t = sorted[i++];
      if (t.type === 'income') bal[t.accountId] += t.amount;
      else if (t.type === 'expense') bal[t.accountId] -= t.amount;
      else { bal[t.accountId] -= t.amount; if (bal[t.toAccountId] != null) bal[t.toAccountId] += (t.toAmount != null ? t.toAmount : t.amount); }
    }
    out.push({ label: fmtMonthShort(months[k]), title: fmtMonth(months[k]), value: S.accounts.reduce((s, a) => s + toMain(bal[a.id] || 0, a.currency), 0) });
  }
  return out;
}
function viewReports() {
  const { from, to, n } = reportRange(), a = rangeAgg(from, to);
  const save = a.income - a.expense, rateP = a.income > 0 ? save / a.income * 100 : 0;
  let days = 0; for (let m = from; m <= to; m = addMonthsYm(m, 1)) { const [y, mo] = m.split('-').map(Number); days += m === thisYm() ? new Date().getDate() : daysInMonth(y, mo); }
  // categories: top 7 + other
  const entries = Object.entries(a.spend).sort((x, y) => y[1] - x[1]);
  const segs = entries.slice(0, 7).map(([id, v]) => { const c = cat(id); return { id, label: c ? `${c.emoji} ${c.name}` : 'Kategória nélkül', value: v, color: catColor(c) }; });
  const rest = entries.slice(7).reduce((s, e) => s + e[1], 0);
  if (rest > 0) segs.push({ id: '', label: 'Egyéb', value: rest, color: 'var(--other)' });
  const legend = segs.map(s => `<li class="item ${s.id ? 'click' : ''}" ${s.id ? `data-act="filterCat" data-id="${s.id}"` : ''}><span class="sw" style="background:${s.color}"></span>
      <span class="grow ellipsis">${esc(s.label)}</span><span class="num muted small">${a.expense ? (s.value / a.expense * 100).toFixed(0) : 0}%</span><b class="num">${money(s.value)}</b></li>`).join('');
  // trend months
  const tm = UI.rRange === 'year' ? 12 : 6, months = [];
  for (let k = tm - 1; k >= 0; k--) months.push(addMonthsYm(to, -k));
  const agg = monthAgg();
  const groups = months.map(m => { const x = agg[m] || { income: 0, expense: 0 }; return { label: fmtMonthShort(m), title: fmtMonth(m), values: [x.income, x.expense], extra: { name: 'Különbség', value: money(x.income - x.expense, undefined, true) } }; });
  const series = [{ name: 'Bevétel', color: 'var(--s1)' }, { name: 'Kiadás', color: 'var(--s2)' }];
  const nwMonths = []; for (let k = 11; k >= 0; k--) nwMonths.push(addMonthsYm(to, -k));
  const nw = netWorthSeries(nwMonths);
  // payees
  const pay = {};
  for (const t of S.txs) if (t.type === 'expense' && t.date.slice(0, 7) >= from && t.date.slice(0, 7) <= to) { const k = t.payee || '(nincs megadva)'; pay[k] = (pay[k] || 0) + toMain(t.amount, txCurrency(t)); }
  const payTop = Object.entries(pay).sort((x, y) => y[1] - x[1]).slice(0, 8);
  const incTop = Object.entries(a.incomeBy).sort((x, y) => y[1] - x[1]);
  // previous period comparison
  const prev = rangeAgg(addMonthsYm(from, -n), addMonthsYm(from, -1));
  const diff = prev.expense ? (a.expense - prev.expense) / prev.expense * 100 : null;
  const rangeSeg = [['month', 'Hónap'], ['q', '3 hó'], ['half', '6 hó'], ['year', '12 hó']].map(([v, l]) => `<button data-act="rRange" data-v="${v}" class="${UI.rRange === v ? 'on' : ''}">${l}</button>`).join('');
  const html = `<div class="seg">${rangeSeg}</div>
    <div class="toolbar">${monthNav('rMonth', UI.rMonth)}<span class="small muted">${n > 1 ? esc(fmtMonth(from)) + ' – ' + esc(fmtMonth(to)) : ''}</span></div>
    <div class="tiles four" style="margin-bottom:12px">
      <div class="tile"><div class="v num pos">${money(a.income)}</div><div class="l">Bevétel</div></div>
      <div class="tile"><div class="v num">${money(a.expense)}</div><div class="l">Kiadás${diff != null ? ` · ${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(0)}%` : ''}</div></div>
      <div class="tile"><div class="v num ${amountClass(save)}">${money(save, undefined, true)}</div><div class="l">Megtakarítás · ${rateP.toFixed(0)}%</div></div>
      <div class="tile"><div class="v num">${money(days ? a.expense / days : 0)}</div><div class="l">Napi átlag költés</div></div></div>
    <div class="card"><h2>Kiadások kategóriánként</h2>${segs.length ? `<div class="donut-wrap"><div class="chart-wrap">${donutChart(segs, { centerLabel: 'Összes kiadás', centerValue: moneyShort(a.expense) })}</div>
      <ul class="list cat-legend">${legend}</ul></div>` : emptyBox('📭', 'Ebben az időszakban nincs kiadás.')}</div>
    <div class="card"><div class="card-head"><h2>Bevétel és kiadás havonta</h2><button class="link" data-act="rTable">${UI.rTable ? 'Grafikon' : 'Táblázat'}</button></div>
      ${UI.rTable ? `<table class="table num"><tr><th>Hónap</th><th>Bevétel</th><th>Kiadás</th><th>Különbség</th></tr>${months.map((m, i) => `<tr><td>${esc(fmtMonth(m))}</td><td>${money(groups[i].values[0])}</td><td>${money(groups[i].values[1])}</td><td class="${amountClass(groups[i].values[0] - groups[i].values[1])}">${money(groups[i].values[0] - groups[i].values[1], undefined, true)}</td></tr>`).join('')}</table>`
        : `<div class="chart-wrap">${barChart(groups, series)}</div>`}</div>
    <div class="card"><h2>Nettó vagyon alakulása</h2><div class="chart-wrap">${lineChart(nw, { name: 'Nettó vagyon' })}</div>
      <p class="small muted">Utolsó 12 hónap, hónap végi állapot, minden számla (fő pénznemre átváltva).</p></div>
    <div class="card"><h2>Legtöbbet itt költöttél</h2>${payTop.length ? `<ul class="list">${payTop.map(([p, v]) => `<li class="item"><div class="ico">🏪</div><div class="grow ellipsis t1">${esc(p)}</div><b class="num">${money(v)}</b></li>`).join('')}</ul>` : emptyBox('🏪', 'Nincs adat.')}</div>
    <div class="card"><h2>Bevételek forrásai</h2>${incTop.length ? `<ul class="list">${incTop.map(([id, v]) => { const c = cat(id); return `<li class="item"><div class="ico">${c ? c.emoji : '❔'}</div><div class="grow ellipsis t1">${esc(c ? c.name : 'Kategória nélkül')}</div><b class="num pos">${money(v)}</b></li>`; }).join('')}</ul>` : emptyBox('💼', 'Nincs bevétel ebben az időszakban.')}</div>`;
  return { title: 'Elemzés', html: insightsCard(UI.rMonth) + offersCard() + html };
}

/* =========================== MORE =========================== */
function viewMore() {
  const tiles = [
    ['accounts', '🏦', 'Számlák', 'Egyenlegek, egyeztetés'],
    ['goals', '🎯', 'Megtakarítási célok', 'Malacperselyek, határidővel'],
    ['recurring', '🔁', 'Ismétlődő & előfizetések', 'Számlák, bérlet, Netflix…'],
    ['debts', '🤝', 'Kölcsönök & tartozások', 'Ki kinek mennyivel tartozik'],
    ['categories', '🏷️', 'Kategóriák', 'Borítékok, havi célok'],
    ['rules', '⚙️', 'Automatikus szabályok', 'Partner → kategória'],
    ['data', '💾', 'Import / Export', 'CSV, biztonsági mentés'],
    ['settings', '🛠️', 'Beállítások', 'Pénznem, téma, PIN'],
  ];
  return { title: 'Több', html: `<div class="menu-grid">${tiles.map(([r, e, t, d]) => `<button class="menu-tile" data-act="go" data-route="${r}"><b>${e}</b><div class="t">${t}</div><div class="d">${d}</div></button>`).join('')}</div>
    <p class="small muted center" style="margin-top:18px">Kassza · ingyenes, nyílt forrású · az adataid csak ezen az eszközön vannak.</p>` };
}

/* =========================== ACCOUNTS =========================== */
function viewAccounts() {
  const bal = balances();
  const list = S.accounts.filter(a => UI.showArchived || !a.archived);
  let h = '';
  for (const [type, info] of Object.entries(ACCOUNT_TYPES)) {
    const as = list.filter(a => a.type === type); if (!as.length) continue;
    const sum = as.reduce((s, a) => s + toMain(bal[a.id] || 0, a.currency), 0);
    h += `<div class="bgroup"><span>${info.emoji} ${info.name}</span><span class="num">${money(sum)}</span></div><ul class="list">` + as.map(a => `
      <li class="item click" data-act="openAccount" data-id="${a.id}"><div class="ico">${accIcon(a)}</div>
      <div class="grow"><div class="t1 ellipsis">${esc(a.name)}${a.archived ? ' <span class="chip">archivált</span>' : ''}</div><div class="t2">${a.currency}</div></div>
      <b class="num ${bal[a.id] < 0 ? 'neg' : ''}">${money(bal[a.id] || 0, a.currency)}</b></li>`).join('') + '</ul>';
  }
  const archived = S.accounts.filter(a => a.archived).length;
  return { title: 'Számlák', back: true, actions: `<button class="top-btn" data-act="newAccount">＋ Új</button>`,
    html: `<div class="card hero"><div class="label">Nettó vagyon</div><div class="value num">${money(netWorth(bal))}</div></div>
      <div class="card">${h || emptyBox('🏦', 'Még nincs számlád.')}</div>
      ${archived ? `<button class="btn block" data-act="toggleArchived">${UI.showArchived ? 'Archiváltak elrejtése' : `Archivált számlák mutatása (${archived})`}</button>` : ''}` };
}
function viewAccount(id) {
  const a = acc(id); if (!a) return viewAccounts();
  const bal = balances()[id] || 0;
  const txs = S.txs.filter(t => t.accountId === id || t.toAccountId === id);
  let run = bal;
  const rows = txs.slice(0, 300).map(t => { const r = txRow(t, { showDate: true, runBal: run }); run -= signedAmount(t, id); return r; }).join('');
  return { title: a.name, back: true, actions: `<button class="top-btn" data-act="editAccount" data-id="${id}">Szerkeszt</button>`,
    html: `<div class="card hero"><div class="label">${accIcon(a)} ${ACCOUNT_TYPES[a.type].name} egyenleg</div><div class="value num ${bal < 0 ? 'neg' : ''}">${money(bal, a.currency)}</div>
      ${a.currency !== S.settings.currency ? `<div class="muted num">≈ ${money(toMain(bal, a.currency))}</div>` : ''}
      <div class="btns"><button class="btn" data-act="reconcile" data-id="${id}">⚖️ Egyenleg egyeztetése</button><button class="btn primary" data-act="newTx" data-acc="${id}">＋ Tétel</button></div></div>
      <div class="card"><h2>Tételek (${txs.length})</h2>${rows ? `<ul class="list">${rows}</ul>` : emptyBox('🧾', 'Ezen a számlán még nincs tétel.')}</div>` };
}

/* =========================== GOALS =========================== */
function viewGoals() {
  const total = S.goals.reduce((s, g) => s + goalSaved(g), 0), target = S.goals.reduce((s, g) => s + g.target, 0);
  const cards = S.goals.map(g => {
    const saved = goalSaved(g), p = g.target ? Math.min(100, saved / g.target * 100) : 0, mon = goalMonthly(g), done = saved >= g.target;
    return `<div class="card"><div class="row"><div class="ico" style="font-size:24px">${g.emoji || '🎯'}</div>
      <div class="grow"><div class="t1" style="font-weight:700">${esc(g.name)}</div>
      <div class="small muted">${g.date ? 'Határidő: ' + fmtDate(g.date) : 'Nincs határidő'}</div></div>
      <button class="link" data-act="editGoal" data-id="${g.id}">Szerkeszt</button></div>
      <div class="row between" style="margin-top:10px"><b class="num">${money(saved)}</b><span class="num muted">${money(g.target)}</span></div>
      <div class="bar"><i style="width:${p}%;background:${done ? 'var(--good)' : 'var(--brand)'}"></i></div>
      <div class="row between small" style="margin-top:6px"><span>${p.toFixed(0)}%</span>
      <span>${done ? '<span class="chip good">✔ Elérted!</span>' : mon ? `Havonta <b class="num">${money(mon)}</b> kell` : `Még <b class="num">${money(g.target - saved)}</b>`}</span></div>
      <div class="btns"><button class="btn sm" data-act="goalMove" data-id="${g.id}" data-dir="-1">− Kivét</button><button class="btn sm primary" data-act="goalMove" data-id="${g.id}" data-dir="1">＋ Befizetés</button></div></div>`;
  }).join('');
  return { title: 'Megtakarítási célok', back: true, actions: `<button class="top-btn" data-act="newGoal">＋ Új</button>`,
    html: (S.goals.length ? `<div class="card hero"><div class="label">Összesen félretéve</div><div class="value num">${money(total)}</div><div class="muted small">a ${money(target)} célból</div></div>` : '') +
      (cards || `<div class="card">${emptyBox('🎯', 'Tűzz ki egy célt: nyaralás, új telefon, vésztartalék…', '<button class="btn primary" data-act="newGoal">＋ Új cél</button>')}</div>`) +
      '<p class="small muted">💡 A célok „virtuális malacperselyek”: azt mutatják, mennyit tettél félre egy adott dologra. A pénz közben bármelyik számládon lehet.</p>' };
}

/* =========================== RECURRING =========================== */
function viewRecurring() {
  const subs = S.recurring.filter(r => r.type === 'expense' && !r.paused);
  const monthly = subs.reduce((s, r) => s + monthlyCost(r), 0);
  const onlySubs = subs.filter(r => r.sub).reduce((s, r) => s + monthlyCost(r), 0);
  const up = upcoming(30);
  const upHtml = up.length ? up.slice(0, 12).map(u => `<li class="item"><div class="ico">${u.r.type === 'income' ? '💰' : (cat(u.r.categoryId) || {}).emoji || '🔁'}</div>
      <div class="grow"><div class="t1 ellipsis">${esc(u.r.name)}</div><div class="t2">${fmtDate(u.date)} · ${relDay(u.date)}</div></div>
      <div class="right"><div class="amt num">${u.r.type === 'income' ? '+' : '−'}${money(u.r.amount, (acc(u.r.accountId) || {}).currency)}</div>
      ${!u.r.auto && u.date <= today() && u.date === u.r.next ? `<div class="row" style="gap:4px;margin-top:4px"><button class="btn sm" data-act="skipRecurring" data-id="${u.r.id}">Kihagy</button><button class="btn sm primary" data-act="postRecurring" data-id="${u.r.id}">Rögzít</button></div>` : ''}</div></li>`).join('')
    : '<li class="empty small">Nincs esedékes tétel 30 napon belül.</li>';
  const all = [...S.recurring].sort((a, b) => a.next.localeCompare(b.next)).map(r => `<li class="item click" data-act="editRecurring" data-id="${r.id}">
      <div class="ico">${r.type === 'income' ? '💰' : r.type === 'transfer' ? '↔️' : (cat(r.categoryId) || {}).emoji || '🔁'}</div>
      <div class="grow"><div class="t1 ellipsis">${esc(r.name)} ${r.sub ? '<span class="chip">előfizetés</span>' : ''} ${r.paused ? '<span class="chip warn">szünetel</span>' : ''}</div>
      <div class="t2">${r.interval > 1 ? r.interval + ' ' : ''}${FREQS[r.freq]} · következő: ${fmtDate(r.next)} · ${r.auto ? 'automatikus' : 'emlékeztető'}</div></div>
      <div class="right"><div class="amt num">${money(r.amount, (acc(r.accountId) || {}).currency)}</div>${r.type === 'expense' ? `<div class="t2 num">${money(monthlyCost(r))}/hó</div>` : ''}</div></li>`).join('');
  return { title: 'Ismétlődő tételek', back: true, actions: `<button class="top-btn" data-act="newRecurring">＋ Új</button>`,
    html: `<div class="tiles" style="margin-bottom:12px"><div class="tile"><div class="v num">${money(monthly)}</div><div class="l">Fix kiadás / hó</div></div>
      <div class="tile"><div class="v num">${money(onlySubs)}</div><div class="l">Előfizetések / hó</div></div>
      <div class="tile"><div class="v num">${money(onlySubs * 12)}</div><div class="l">Előfizetések / év</div></div></div>
      <div class="card"><h2>Következő 30 nap</h2><ul class="list">${upHtml}</ul></div>
      <div class="card"><h2>Összes ismétlődő (${S.recurring.length})</h2>${all ? `<ul class="list">${all}</ul>` : emptyBox('🔁', 'Add hozzá a rendszeres tételeidet (albérlet, rezsi, Netflix, fizetés…). Az automatikusakat a Kassza magától rögzíti.', '<button class="btn primary" data-act="newRecurring">＋ Új ismétlődő</button>')}</div>` };
}

/* =========================== DEBTS =========================== */
function viewDebts() {
  const open = S.debts.filter(d => !d.settled), settled = S.debts.filter(d => d.settled);
  const lent = open.filter(d => d.direction === 'lent'), bor = open.filter(d => d.direction === 'borrowed');
  const sum = l => l.reduce((s, d) => s + debtLeft(d), 0);
  const row = d => {
    const left = debtLeft(d), p = d.amount ? Math.min(100, debtPaid(d) / d.amount * 100) : 0;
    return `<li class="item" style="display:block"><div class="row"><div class="ico">${d.direction === 'lent' ? '📤' : '📥'}</div>
      <div class="grow"><div class="t1">${esc(d.person)}</div><div class="t2">${esc(d.note || '')}${d.due ? ` · határidő: ${fmtDate(d.due)} (${relDay(d.due)})` : ''}</div></div>
      <div class="right"><b class="num">${money(left)}</b><div class="t2 num">/ ${money(d.amount)}</div></div></div>
      <div class="bar"><i style="width:${p}%"></i></div>
      <div class="btns">${d.settled ? `<button class="btn sm" data-act="reopenDebt" data-id="${d.id}">Újranyitás</button>` : `<button class="btn sm" data-act="editDebt" data-id="${d.id}">Szerkeszt</button>
      <button class="btn sm" data-act="debtPay" data-id="${d.id}">Részlet</button><button class="btn sm primary" data-act="settleDebt" data-id="${d.id}">✔ Rendezve</button>`}</div></li>`;
  };
  return { title: 'Kölcsönök & tartozások', back: true, actions: `<button class="top-btn" data-act="newDebt">＋ Új</button>`,
    html: `<div class="tiles" style="margin-bottom:12px;grid-template-columns:1fr 1fr"><div class="tile"><div class="v num pos">${money(sum(lent))}</div><div class="l">Nekem tartoznak</div></div>
      <div class="tile"><div class="v num neg">${money(sum(bor))}</div><div class="l">Én tartozom</div></div></div>
      <div class="card"><h2>📤 Nekem tartoznak</h2>${lent.length ? `<ul class="list">${lent.map(row).join('')}</ul>` : '<div class="empty small">Senki nem tartozik neked.</div>'}</div>
      <div class="card"><h2>📥 Én tartozom</h2>${bor.length ? `<ul class="list">${bor.map(row).join('')}</ul>` : '<div class="empty small">Nincs tartozásod. 🎉</div>'}</div>
      ${settled.length ? `<button class="btn block" data-act="toggleSettled">${UI.showSettledDebts ? 'Rendezettek elrejtése' : `Rendezett tételek (${settled.length})`}</button>
        ${UI.showSettledDebts ? `<div class="card" style="margin-top:12px"><ul class="list">${settled.map(row).join('')}</ul></div>` : ''}` : ''}` };
}

/* =========================== CATEGORIES =========================== */
function viewCategories() {
  let h = '';
  for (const g of S.groups) {
    const cs = S.categories.filter(c => c.groupId === g.id);
    h += `<div class="card"><div class="card-head"><h2>${esc(g.name)}</h2><button class="link" data-act="editGroup" data-id="${g.id}">Átnevez</button></div><ul class="list">` +
      cs.map(c => `<li class="item click" data-act="editCategory" data-id="${c.id}"><div class="ico" style="background:color-mix(in srgb, ${catColor(c)} 22%, transparent)">${c.emoji}</div>
        <div class="grow"><div class="t1">${esc(c.name)}</div>${c.target ? `<div class="t2">Havi cél: ${money(c.target)}</div>` : ''}</div><span class="muted">›</span></li>`).join('') +
      `</ul><button class="btn sm block" style="margin-top:8px" data-act="newCategory" data-group="${g.id}">＋ Kategória ide</button></div>`;
  }
  return { title: 'Kategóriák', back: true, actions: `<button class="top-btn" data-act="newGroup">＋ Csoport</button>`, html: h };
}

/* =========================== RULES =========================== */
function viewRules() {
  const rows = S.rules.map(r => { const c = cat(r.categoryId); return `<li class="item click" data-act="editRule" data-id="${r.id}"><div class="ico">⚙️</div>
    <div class="grow"><div class="t1">Ha a partner tartalmazza: „${esc(r.text)}”</div><div class="t2">→ ${c ? c.emoji + ' ' + esc(c.name) : '(törölt kategória)'}</div></div></li>`; }).join('');
  return { title: 'Automatikus szabályok', back: true, actions: `<button class="top-btn" data-act="newRule">＋ Új</button>`,
    html: `<div class="card">${rows ? `<ul class="list">${rows}</ul>` : emptyBox('⚙️', 'Még nincs szabály.')}</div>
      <div class="btns"><button class="btn" data-act="applyRules">Alkalmazás a kategória nélküli tételekre</button></div>
      <p class="small muted">💡 A Kassza magától is tanul: ha egy partnert (pl. „Lidl”) egyszer kategorizáltál, legközelebb ugyanazt ajánlja. A szabályok ennél erősebbek, és a banki CSV importnál is működnek.</p>` };
}

/* =========================== DATA (import/export) =========================== */
function viewData() {
  const size = (localStorage.getItem(STORE_KEY) || '').length;
  return { title: 'Import / Export', back: true, html: `
    <div class="card"><h2>💾 Biztonsági mentés</h2><p class="small muted">Az adataid csak ezen az eszközön vannak. Ments rendszeresen, és tedd el a fájlt (pl. Google Drive, iCloud, e-mail). Ebből a fájlból egy másik telefonon is visszaállíthatod.</p>
      <div class="btns"><button class="btn primary" data-act="backup">⤓ Mentés letöltése (JSON)</button><button class="btn" data-act="restore">⤒ Visszaállítás fájlból</button></div></div>
    <div class="card"><h2>🟦 Revolut</h2><p class="small muted">Revolut kivonat (CSV) beolvasása egy lépésben: számlák, átváltások, díjak és kategóriák automatikusan. Androidon a Revolut appból közvetlenül megoszthatod a Kasszával.</p>
      <div class="btns"><button class="btn primary" data-act="revolut">🟦 Revolut import</button></div></div>
    <div class="card"><h2>🏦 Banki kivonat importálása (CSV)</h2><p class="small muted">Töltsd le a bankod netbankjából a tranzakciókat CSV formátumban, és itt beolvashatod. Az oszlopokat te választod ki, a kategóriákat a szabályok és a korábbi tételek alapján automatikusan kitölti.</p>
      <div class="btns"><button class="btn" data-act="importCsv">⤒ CSV importálása</button></div></div>
    <div class="card"><h2>📄 Export táblázatba</h2><p class="small muted">Minden tétel CSV fájlban, Excelben vagy Google Táblázatokban megnyitható.</p>
      <div class="btns"><button class="btn" data-act="exportCsv">⤓ CSV export</button></div></div>
    <div class="card"><h2>🧪 Egyéb</h2><div class="btns"><button class="btn" data-act="startDemo">Demó adatok betöltése</button><button class="btn danger" data-act="wipe">Minden adat törlése</button></div>
      <p class="small muted">Tárolt adat: kb. ${(size / 1024).toFixed(0)} KB · ${S.txs.length} tétel</p></div>` };
}

/* =========================== SETTINGS =========================== */
function viewSettings() {
  const s = S.settings;
  const others = CURRENCIES.filter(c => c !== 'HUF');
  const usedCur = new Set(S.accounts.map(a => a.currency).concat([s.currency]));
  return { title: 'Beállítások', back: true, html: `
    <div class="card"><h2>Általános</h2>
      <label class="field"><span>Fő pénznem (ebben látod az összesítéseket)</span><select class="input" data-setting="currency">${CURRENCIES.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      <label class="field"><span>Téma</span><select class="input" data-setting="theme">${[['auto', 'Rendszer szerint'], ['light', 'Világos'], ['dark', 'Sötét']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>A hét első napja</span><select class="input" data-setting="weekStart"><option value="1" ${s.weekStart == 1 ? 'selected' : ''}>Hétfő</option><option value="0" ${s.weekStart == 0 ? 'selected' : ''}>Vasárnap</option></select></label></div>
    <div class="card"><h2>💱 Árfolyamok</h2><p class="small muted">1 egység = ennyi forint. Kézzel frissítheted (internet nélkül nincs automatikus árfolyam).</p>
      <div class="two">${others.map(c => `<label class="field"><span>1 ${c} ${usedCur.has(c) ? '•' : ''}</span><input class="input num" inputmode="decimal" data-rate="${c}" value="${s.rates[c] || ''}"></label>`).join('')}</div></div>
    <div class="card"><h2>🔎 Csomag- és kedvezménykereső</h2><p class="small muted">Bankjaid: ${(s.banks || []).map(b => esc(b.bank + (b.product ? " – " + b.product : ""))).join(", ") || "még nincs megadva"}. A Claude Pro előfizetéseddel nézi át, van-e jobb csomag, kártya vagy kedvezmény.</p>
      <label class="row small" style="margin-bottom:8px"><input type="checkbox" data-setting-bool="reviewRemind" ${s.reviewRemind !== false ? "checked" : ""}> Heti emlékeztető, amikor Wi-Fi-n vagyok</label>
      <div class="btns"><button class="btn" data-act="aiClaude">🤖 Átnézetem a Claude-dal</button><button class="btn" data-act="aiSetup">Haladó (API)</button></div></div>
    <div class="card"><h2>🔒 PIN kód</h2><p class="small muted">${s.pin ? 'A PIN kód be van kapcsolva. Az app megnyitásakor kéri.' : 'Állíts be 4 jegyű PIN kódot, hogy más ne lássa a pénzügyeidet.'}</p>
      <div class="btns">${s.pin ? '<button class="btn" data-act="setPin">PIN módosítása</button><button class="btn danger" data-act="removePin">PIN kikapcsolása</button>' : '<button class="btn primary" data-act="setPin">PIN beállítása</button>'}</div></div>
    <div class="card"><h2>ℹ️ Névjegy</h2><p class="small muted">Kassza – ingyenes, offline költségkövető. Nincs reklám, nincs regisztráció, nincs adatgyűjtés. Telefonon: nyisd meg a böngészőben, majd „Főképernyőhöz adás” / „Alkalmazás telepítése”.</p></div>` };
}
