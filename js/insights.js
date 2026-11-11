'use strict';
/* =====================================================================
   Kassza – spending analyst ("Elemzés"). Runs fully on the device:
   explains where the money goes, spots spikes, habits, subscriptions,
   fees and envelope run-outs, and estimates how much could be saved.
   ===================================================================== */

const SEV_ORDER = { bad: 0, warn: 1, tip: 2, good: 3, info: 4 };
const SEV_ICON = { bad: '⛔', warn: '⚠️', tip: '💡', good: '✅', info: 'ℹ️' };

/** Thresholds are written in forint and scaled to the main currency. */
const T = huf => S.settings.currency === 'HUF' ? huf : huf / (S.settings.rates[S.settings.currency] || 1);
const normPayee = p => String(p || '').toLowerCase().replace(/\d{3,}|[#*]/g, '').replace(/\s+/g, ' ').trim();
const catLabel = id => { const c = cat(id); return c ? `${c.emoji} ${esc(c.name)}` : 'Kategória nélkül'; };
const isFixedCat = id => { const c = cat(id); return !!c && c.groupId === 'g_fix'; };
const pct = v => `${Math.round(v * 100)}%`;

function monthEnd(m) { return addMonthsYm(m, 1) + '-01'; }
function expensesBetween(from, to) { // from inclusive, to exclusive (ISO dates)
  return S.txs.filter(t => t.type === 'expense' && t.date >= from && t.date < to);
}

function computeInsights(m = thisYm()) {
  const agg = monthAgg();
  const cur = agg[m] || { income: 0, expense: 0, spend: {}, incomeBy: {} };
  const isCur = m === thisYm();
  const [y, mo] = m.split('-').map(Number), dim = daysInMonth(y, mo);
  const elapsed = isCur ? new Date().getDate() : dim, left = dim - elapsed;
  const hist = [1, 2, 3, 4, 5, 6].map(k => addMonthsYm(m, -k)).filter(k => agg[k] && agg[k].expense > 0);
  const avg = {}; let avgExp = 0, avgInc = 0;
  for (const k of hist) {
    for (const c in agg[k].spend) avg[c] = (avg[c] || 0) + agg[k].spend[c] / hist.length;
    avgExp += agg[k].expense / hist.length; avgInc += agg[k].income / hist.length;
  }
  const income = cur.income || avgInc;
  const items = [];
  const add = o => items.push(o);
  const endISO = isCur ? addDays(today(), 1) : monthEnd(m);

  /* ---- 1. projection for the current month ---- */
  let projected = cur.expense;
  if (isCur && elapsed >= 3 && left > 0) {
    let fixedSpent = 0; for (const c in cur.spend) if (isFixedCat(c)) fixedSpent += cur.spend[c];
    const varDaily = (cur.expense - fixedSpent) / elapsed;
    const recLeft = upcoming(left).filter(u => u.r.type === 'expense' && ymOf(u.date) === m && u.date > today())
      .reduce((s, u) => s + toMain(u.r.amount, (acc(u.r.accountId) || {}).currency), 0);
    projected = cur.expense + varDaily * left + recLeft;
    const vsAvg = avgExp ? (projected - avgExp) / avgExp : 0;
    if (income > 0 && projected > income * 1.02) add({ sev: 'bad', title: 'Ebben a hónapban többet költesz, mint amennyi bejön',
      text: `A mostani tempóval a hónap végére kb. <b>${money(projected)}</b> lesz a kiadás, a bevétel ${money(income)}. A különbséget a megtakarításodból vagy hitelből fedezed.`, saving: projected - income });
    else add({ sev: Math.abs(vsAvg) < 0.1 ? 'info' : vsAvg > 0 ? 'warn' : 'good', title: 'Előrejelzés a hónap végére',
      text: `Ha így folytatod, kb. <b>${money(projected)}</b> lesz az e havi kiadásod${avgExp ? ` – ez ${vsAvg > 0 ? pct(vsAvg) + '-kal több' : pct(-vsAvg) + '-kal kevesebb'}, mint az átlagod (${money(avgExp)})` : ''}. Még ${left} nap van hátra.` });
  }

  /* ---- 2. category spikes and wins (pace-adjusted) ---- */
  const catIds = new Set([...Object.keys(cur.spend), ...Object.keys(avg)]);
  for (const id of catIds) {
    const actual = cur.spend[id] || 0, a = avg[id] || 0;
    if (!cat(id)) continue;
    const fixed = isFixedCat(id);
    const expectedNow = fixed || !isCur ? a : a * elapsed / dim;
    const projectedCat = fixed || !isCur ? actual : actual / Math.max(elapsed, 1) * dim;
    if (a > 0 && actual > expectedNow * 1.3 && actual - expectedNow > T(5000)) {
      const merch = topPayees(expensesBetween(m + '-01', endISO).filter(t => txParts(t).some(p => p.categoryId === id)), 2);
      add({ sev: 'warn', title: `${catLabel(id)}: a szokásosnál több`, catId: id,
        text: `${isCur ? 'Eddig' : 'Ebben a hónapban'} <b>${money(actual)}</b>, ez ${pct((actual - expectedNow) / expectedNow)}-kal több, mint a megszokott tempód (havi átlag ${money(a)}).` +
          (isCur && !fixed ? ` Ha így marad, a hónap végére ~${money(projectedCat)}.` : '') + (merch.length ? `<br><span class="muted">Legtöbb: ${merch.map(x => `${esc(x.name)} ${money(x.sum)}`).join(', ')}</span>` : ''),
        saving: Math.max(0, projectedCat - a) });
    } else if (!isCur && a > T(10000) && actual < a * 0.75) {
      add({ sev: 'good', title: `${catLabel(id)}: szép spórolás`, text: `${money(a - actual)}-tal kevesebbet költöttél rá, mint átlagosan (${pct((a - actual) / a)}).` });
    } else if (a === 0 && actual > T(25000) && hist.length >= 2) {
      add({ sev: 'info', title: `${catLabel(id)}: új nagy tétel`, text: `Az előző hónapokban nem költöttél erre, most ${money(actual)}.`, catId: id });
    }
  }

  /* ---- 3. small, frequent purchases (the "latte factor") ---- */
  const from30 = addDays(isCur ? today() : addDays(monthEnd(m), -1), -29);
  const last30 = expensesBetween(from30, endISO);
  const byPayee = {};
  for (const t of last30) {
    const k = normPayee(t.payee); if (!k) continue;
    const v = toMain(t.amount, txCurrency(t));
    (byPayee[k] = byPayee[k] || { name: t.payee, n: 0, sum: 0, catId: t.categoryId }); byPayee[k].n++; byPayee[k].sum += v;
  }
  Object.values(byPayee).filter(p => p.n >= 6 && p.sum / p.n <= T(4500)).sort((a, b) => b.sum - a.sum).slice(0, 3).forEach(p => add({
    sev: 'tip', title: `Apró, de gyakori: ${esc(p.name)}`, catId: p.catId,
    text: `${p.n}× az elmúlt 30 napban, átlag ${money(p.sum / p.n)} – ez évente kb. <b>${money(p.sum * 365 / 30)}</b>. Ha a felére csökkented, havonta ~${money(p.sum / 2)} marad.`,
    saving: p.sum / 2,
  }));
  // eating out vs income
  const eat = S.categories.find(c => c.name === 'Étterem & kávé');
  if (eat && income > 0) {
    const e = hist.length ? (avg[eat.id] || 0) : (cur.spend[eat.id] || 0);
    if (e > income * 0.12) add({ sev: 'tip', title: '🍔 Sok megy étteremre és kiszállításra', catId: eat.id,
      text: `Havonta átlag ${money(e)} (a bevételed ${pct(e / income)}-a). Ha hetente 2 alkalommal otthon főzöl helyette, kb. ${money(e * 0.3)}-ot spórolsz havonta.`, saving: e * 0.3 });
  }

  /* ---- 4. recurring charges not yet tracked (subscription detection) ---- */
  const months4 = [0, 1, 2, 3].map(k => addMonthsYm(m, -k));
  const seen = {};
  for (const t of S.txs) {
    if (t.type !== 'expense' || !months4.includes(ymOf(t.date))) continue;
    const k = normPayee(t.payee); if (!k || k.length < 3) continue;
    const e = seen[k] || (seen[k] = { name: t.payee, months: {}, accountId: t.accountId, categoryId: t.categoryId, cur: txCurrency(t), day: parseISO(t.date).getDate() });
    e.months[ymOf(t.date)] = (e.months[ymOf(t.date)] || []).concat(t.amount);
  }
  const tracked = S.recurring.map(r => normPayee(r.name));
  for (const e of Object.values(seen)) {
    const ms = Object.keys(e.months); if (ms.length < 3) continue;
    const per = ms.map(k => e.months[k]); if (per.some(a => a.length > 2)) continue;
    const vals = per.flat().sort((a, b) => a - b), med = vals[Math.floor(vals.length / 2)];
    if (!vals.every(v => Math.abs(v - med) <= med * 0.15)) continue;
    const k = normPayee(e.name);
    if (tracked.some(r => r && (k.includes(r) || r.includes(k)))) continue;
    add({ sev: 'tip', title: `Rendszeres terhelés: ${esc(e.name)}`, catId: e.categoryId,
      text: (cat(e.categoryId) || {}).name === 'Előfizetések'
        ? `Előfizetésnek tűnik: havonta ~${money(med, e.cur)} (${ms.length} hónapja). Ha nem használod, a lemondással évente ${money(toMain(med * 12, e.cur))} marad nálad.`
        : `Havonta ~${money(med, e.cur)} megy el rá (${ms.length} hónapja). Vedd fel ismétlődőként, így előre látod, és beleszámít az előrejelzésbe.`,
      action: { act: 'insAddRec', label: '🔁 Felveszem ismétlődőként', data: { name: e.name, amount: med, acc: e.accountId, cat: e.categoryId, day: e.day, sub: (cat(e.categoryId) || {}).name === 'Előfizetések' ? 1 : 0 } } });
  }
  const subs = S.recurring.filter(r => r.sub && !r.paused && r.type === 'expense');
  const subMonthly = subs.reduce((s, r) => s + monthlyCost(r), 0);
  if (subs.length >= 3 || subMonthly > T(12000)) add({ sev: 'tip', title: `${subs.length} előfizetésed van`,
    text: `Havonta ${money(subMonthly)}, évente <b>${money(subMonthly * 12)}</b>. Nézd át, melyiket használtad az elmúlt hónapban – egy lemondott 4 000 Ft-os előfizetés évi 48 000 Ft.`,
    action: { act: 'go', label: 'Előfizetések', data: { route: 'recurring' } } });

  /* ---- 5. bank fees ---- */
  const from90 = addDays(today(), -90);
  const fees = S.txs.filter(t => t.type === 'expense' && t.date >= from90 && ((cat(t.categoryId) || {}).name === 'Banki díjak' || /\b(díj|fee|jutalék|kezelési költség|zárlati)\b/i.test(t.payee || '')));
  const feeSum = fees.reduce((s, t) => s + toMain(t.amount, txCurrency(t)), 0);
  if (feeSum > T(500)) add({ sev: 'tip', title: '🏦 Banki díjak', text: `Az elmúlt 3 hónapban ${money(feeSum)} ment el díjakra (${fees.length} tétel). Gyakori okok: hétvégi devizaváltás felára, ATM-limit feletti felvétel, drágább számlacsomag – ezek többnyire elkerülhetők.`, saving: feeSum / 3 });

  /* ---- 6. savings rate and the 50/30/20 rule ---- */
  const base = hist.length ? hist.slice(0, 3) : (isCur ? [] : [m]);
  if (base.length) {
    const inc = base.reduce((s, k) => s + agg[k].income, 0) / base.length, exp = base.reduce((s, k) => s + agg[k].expense, 0) / base.length;
    if (inc > 0) {
      const rate = (inc - exp) / inc;
      if (rate < 0) add({ sev: 'bad', title: 'Mínuszban vagy', text: `Az elmúlt ${base.length} hónapban átlag ${money(exp)} volt a kiadás és ${money(inc)} a bevétel. Havonta ${money(exp - inc)} hiányzik.`, saving: exp - inc });
      else if (rate < 0.1) add({ sev: 'warn', title: `Megtakarítási ráta: ${pct(rate)}`, text: `A bevételed ${pct(rate)}-át tudod félretenni. Jó cél a 20% – ez nálad havi ${money(inc * 0.2)} lenne.`, saving: inc * 0.2 - (inc - exp) });
      else add({ sev: rate >= 0.2 ? 'good' : 'info', title: `Megtakarítási ráta: ${pct(rate)}`, text: rate >= 0.2 ? `Ügyes! Havonta átlag ${money(inc - exp)}-ot tudsz félretenni.` : `Havonta átlag ${money(inc - exp)} marad. A 20%-hoz még ${money(inc * 0.2 - (inc - exp))} kellene.` });
      let needs = 0, wants = 0;
      for (const k of base) for (const c in agg[k].spend) { const v = agg[k].spend[c] / base.length; if (isFixedCat(c)) needs += v; else wants += v; }
      if (wants > inc * 0.3) add({ sev: 'tip', title: 'Szabadon elkölthető pénz: több mint 30%', text: `Az 50/30/20 szabály szerint a bevétel kb. 30%-a menjen „élvezetekre”. Nálad ez ${pct(wants / inc)} (${money(wants)}/hó). A 30%-hoz ${money(wants - inc * 0.3)}-tal kevesebb kellene.`, saving: wants - inc * 0.3 });
      if (needs > inc * 0.55) add({ sev: 'info', title: `Kötelező kiadások: a bevétel ${pct(needs / inc)}-a`, text: 'Ez magas (50% körül ideális). Itt a nagy tételek számítanak: lakhatás, autó/közlekedés, biztosítás, rezsicsomag – egy jobb ajánlat évente sokat hozhat.' });
    }
  }

  /* ---- 7. envelopes that will run out / are overspent ---- */
  const usesBudget = Object.values(S.budget).some(mb => Object.values(mb).some(v => v > 0));
  if (isCur && !usesBudget && hist.length) add({ sev: 'tip', title: '✉️ Állíts be havi kereteket', text: 'Még nincs költségvetésed. A Költségvetés oldalon az „Automatikus kiosztás → 3 havi átlag” egy kattintással kiosztja a kereteket a szokásaid alapján, és onnantól szól, ha valami elszalad.', action: { act: 'go', label: 'Költségvetés', data: { route: 'budget' } } });
  if (isCur && usesBudget) {
    const b = budgetMonth(m), overs = [];
    for (const c of expenseCats()) {
      const r = b.rows[c.id]; if (!r) continue;
      if (r.available < -0.5) overs.push({ c, r });
      else if (r.available > 0 && r.spent > 0 && !isFixedCat(c.id) && left > 0) {
        const pace = r.spent / elapsed, days = r.available / pace;
        if (days < left * 0.8) add({ sev: 'warn', title: `${catLabel(c.id)}: kb. ${Math.max(1, Math.round(days))} nap múlva elfogy`, catId: c.id, text: `Maradt ${money(r.available)}, napi ${money(pace)} tempóval. Napi ${money(r.available / left)} alatt kitart a hónap végéig.` });
      }
    }
    if (overs.length) add({ sev: 'bad', title: overs.length === 1 ? `${catLabel(overs[0].c.id)}: túlköltve` : `${overs.length} boríték túlköltve`,
      text: overs.map(o => `${catLabel(o.c.id)} <b>${money(-o.r.available)}</b>`).join(', ') + ' – ennyivel több ment el, mint amennyi a borítékban volt. Csoportosíts át egy másik borítékból, vagy használd az „Automatikus kiosztás → Túlköltések fedezése” gombot.',
      action: { act: 'go', label: 'Költségvetés', data: { route: 'budget' } } });
  }

  /* ---- 8. unusual single transactions ---- */
  const monthTx = S.txs.filter(t => t.type === 'expense' && ymOf(t.date) === m);
  const histTx = S.txs.filter(t => t.type === 'expense' && hist.includes(ymOf(t.date)));
  for (const t of monthTx) {
    const v = toMain(t.amount, txCurrency(t)); if (v < T(15000)) continue;
    const same = histTx.filter(x => x.categoryId === t.categoryId).map(x => toMain(x.amount, txCurrency(x))).sort((a, b) => a - b);
    if (same.length < 3) continue;
    const med = same[Math.floor(same.length / 2)];
    if (v > med * 3 && !isFixedCat(t.categoryId)) add({ sev: 'info', title: `Szokatlanul nagy tétel: ${esc(t.payee || catLabel(t.categoryId))}`, text: `${fmtDate(t.date)}: ${money(v)} – ebben a kategóriában általában ~${money(med)} szokott lenni.` });
  }

  /* ---- 9. weekend spending ---- */
  const from60 = addDays(today(), -60);
  let we = 0, all = 0;
  for (const t of S.txs) if (t.type === 'expense' && t.date >= from60 && !isFixedCat(t.categoryId)) { const v = toMain(t.amount, txCurrency(t)); all += v; const d = parseISO(t.date).getDay(); if (d === 0 || d === 6) we += v; }
  if (all > T(30000) && we / all > 0.5) add({ sev: 'tip', title: `A szabad költésed ${pct(we / all)}-a hétvégén megy el`, text: 'A hétvége csak a napok 29%-a. Egy előre eldöntött hétvégi keret (pl. készpénzben) sokat segít.' });

  /* ---- 10. data quality ---- */
  const other = S.categories.find(c => c.name === 'Egyéb' && c.kind === 'expense');
  if (other && cur.expense > 0 && (cur.spend[other.id] || 0) / cur.expense > 0.15) add({ sev: 'tip', title: 'Sok tétel van az „Egyéb” kategóriában', catId: other.id,
    text: `Az e havi kiadás ${pct((cur.spend[other.id] || 0) / cur.expense)}-a. Sorold be őket – a Kassza megjegyzi, és legközelebb magától tudja, így pontosabb lesz az elemzés.`, action: { act: 'filterCat', label: 'Megnézem', data: { id: other.id } } });

  /* ---- 11. goals vs. what is left each month ---- */
  const goalNeed = S.goals.filter(g => goalSaved(g) < g.target).reduce((s, g) => s + goalMonthly(g), 0);
  if (goalNeed > 0 && avgInc > 0) {
    const surplus = avgInc - avgExp;
    add(surplus >= goalNeed
      ? { sev: 'good', title: 'A céljaid elérhetők', text: `Havi ${money(goalNeed)} kell a céljaidhoz, átlagosan ${money(surplus)} marad – belefér.` }
      : { sev: 'warn', title: 'A célokhoz kevés marad havonta', text: `Havi ${money(goalNeed)} kellene a határidőkhöz, de átlag csak ${money(Math.max(0, surplus))} marad. Vagy tolj ki egy határidőt, vagy faragj ${money(goalNeed - Math.max(0, surplus))}-ot a kiadásokból.`, saving: goalNeed - Math.max(0, surplus) });
  }

  items.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || (b.saving || 0) - (a.saving || 0));
  // potential saving: count each category once, take the biggest suggestion per category, ignore "info"
  const perKey = {};
  for (const it of items) if (it.saving > 0 && it.sev !== 'info' && it.sev !== 'good') { const k = it.catId || it.title; perKey[k] = Math.max(perKey[k] || 0, it.saving); }
  const savingTotal = Math.min(Object.values(perKey).reduce((s, v) => s + v, 0), (income || avgExp) * 0.5);

  // plain-language summary of where the money went
  const top = Object.entries(cur.spend).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const summary = cur.expense > 0
    ? `${isCur ? 'Ebben a hónapban eddig' : esc(fmtMonth(m)) + ' során'} <b>${money(cur.expense)}</b> ment el${isCur ? ` (${elapsed}/${dim} nap)` : ''}. ` +
      `A legtöbb: ${top.map(([id, v]) => `${catLabel(id)} <b>${money(v)}</b> (${pct(v / cur.expense)})`).join(', ')}.` +
      (cur.income ? ` Bevétel: ${money(cur.income)}.` : '')
    : 'Ebben a hónapban még nincs kiadás.';
  return { items, summary, savingTotal, projected, hasHistory: hist.length > 0 };
}

function topPayees(txs, n) {
  const m = {};
  for (const t of txs) { const k = t.payee || '–'; m[k] = (m[k] || 0) + toMain(t.amount, txCurrency(t)); }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, sum]) => ({ name, sum }));
}

function insightItemHtml(it) {
  const a = it.action;
  const data = a ? Object.entries(a.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ') : '';
  return `<li class="ins ${it.sev}"><div class="ins-ico">${SEV_ICON[it.sev]}</div><div class="grow">
    <div class="ins-t">${it.title}</div><div class="ins-x">${it.text}</div>
    <div class="row wrap" style="margin-top:6px;gap:6px">${it.saving > T(500) && it.sev !== 'good' ? `<span class="chip good">💰 ~${money(it.saving)}/hó</span>` : ''}
    ${a ? `<button class="btn sm" data-act="${a.act}" ${data}>${a.label}</button>` : ''}</div></div></li>`;
}

function insightsCard(m, { limit = 0, compact = false } = {}) {
  if (!S.txs.length) return `<div class="card"><h2>🧠 Elemzés</h2>${emptyBox('📥', 'Még nincs mit elemezni. Húzd be a Revolut tételeidet, és megmutatom, mire megy el a pénzed.', '<button class="btn primary" data-act="revolut">🟦 Revolut import</button>')}</div>`;
  const r = computeInsights(m);
  const list = (limit ? r.items.filter(i => i.sev !== 'info').slice(0, limit) : r.items);
  return `<div class="card"><div class="card-head"><h2>🧠 ${compact ? 'Tippek' : 'Hová megy a pénz?'}</h2>${compact ? '<button class="link" data-act="go" data-route="reports">Teljes elemzés</button>' : ''}</div>
    ${compact ? '' : `<p style="margin:0 0 10px;line-height:1.5">${r.summary}</p>`}
    ${r.savingTotal > T(1000) ? `<div class="save-box"><div class="small">Lehetséges megtakarítás</div><div class="v num">~${money(r.savingTotal)}/hó</div><div class="small">ez évente kb. ${money(r.savingTotal * 12)}</div></div>` : ''}
    ${list.length ? `<ul class="list ins-list">${list.map(insightItemHtml).join('')}</ul>` : '<div class="empty small">Nincs különösebb észrevétel – minden a megszokott mederben. 👍</div>'}
    ${!r.hasHistory && !compact ? '<p class="small muted">Minél több hónapnyi adat van, annál pontosabbak az összehasonlítások.</p>' : ''}</div>`;
}
