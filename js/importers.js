'use strict';
/* =====================================================================
   Kassza – bank importers (Revolut statement CSV) and merchant auto-categorizer
   ===================================================================== */

/* ---------- merchant keyword → default category name ----------
   Used when no user rule and no earlier transaction tells the category. */
const MERCHANTS = [
  ['Élelmiszer', ['lidl', 'aldi', 'tesco', 'spar', 'auchan', 'penny', 'coop', 'cba', 'príma', 'prima ', 'reál', 'interspar', 'kifli', 'rossmann food', 'carrefour', 'billa', 'kaufland', 'albert heijn', 'sainsbury', 'asda', 'mercadona', 'pékség', 'bakery', 'hentes', 'piac']],
  ['Étterem & kávé', ['mcdonald', 'burger king', 'kfc', 'starbucks', 'costa', 'cafe', 'café', 'kávé', 'coffee', 'pizza', 'wolt', 'foodora', 'foodpanda', 'netpincér', 'bistro', 'étterem', 'restaurant', 'subway', 'sushi', 'kebab', 'gyros', 'bar ', 'pub', 'cukrászda', 'espresso', 'bakers']],
  ['Közlekedés', ['mol ', 'mol-', 'omv', 'shell', 'orlen', 'bkk', 'bkv', 'máv', 'mav-start', 'volán', 'volanbusz', 'bolt.eu', 'bolt ', 'uber', 'taxi', 'parkol', 'parking', 'nemzeti mobilfizetési', 'autópálya', 'e-matrica', 'flixbus', 'lime', 'tier ']],
  ['Előfizetések', ['netflix', 'spotify', 'hbo', 'max.com', 'disney', 'youtube', 'apple.com/bill', 'icloud', 'google one', 'google storage', 'amazon prime', 'prime video', 'skyshowtime', 'chatgpt', 'openai', 'claude.ai', 'anthropic', 'microsoft 365', 'adobe', 'dropbox', 'patreon', 'twitch', 'duolingo', 'tidal', 'deezer']],
  ['Telefon & internet', ['telekom', 'yettel', 'telenor', 'vodafone', 'digi', 'one hungary', '4ig', 'invitel', 'upc']],
  ['Rezsi', ['elmű', 'emász', 'mvm', 'eon', 'e.on', 'főgáz', 'fővárosi vízművek', 'vízmű', 'díjbeszedő', 'fkf', 'nkm', 'távhő', 'főtáv']],
  ['Egészség', ['patika', 'gyógyszer', 'pharmacy', 'benu', 'dental', 'fogorvos', 'orvos', 'klinika', 'medicover', 'optika', 'synlab']],
  ['Szépségápolás', ['dm ', 'dm-drogerie', 'drogerie', 'rossmann', 'müller', 'douglas', 'notino', 'fodrász', 'barber', 'kozmetik', 'sephora']],
  ['Háztartás', ['ikea', 'obi', 'praktiker', 'bauhaus', 'jysk', 'pepco', 'tedi', 'action ', 'mediamarkt', 'media markt', 'euronics', 'emag', 'alza']],
  ['Ruházat', ['h&m', 'zara', 'reserved', 'c&a', 'primark', 'bershka', 'pull&bear', 'mango', 'deichmann', 'about you', 'zalando', 'shein', 'new yorker', 'humanic']],
  ['Sport', ['decathlon', 'gym', 'fitness', 'edzőterem', 'sportsdirect', 'intersport', 'myprotein', 'aqua', 'uszoda']],
  ['Szórakozás', ['cinema city', 'mozi', 'cinema', 'steam', 'playstation', 'xbox', 'nintendo', 'ticketswap', 'jegy.hu', 'eventim', 'ticketmaster', 'szerencsejáték', 'tippmix', 'bowling', 'escape']],
  ['Utazás', ['booking.com', 'airbnb', 'ryanair', 'wizz', 'wizzair', 'easyjet', 'lufthansa', 'hotel', 'szállás', 'hostel', 'expedia', 'trivago']],
  ['Oktatás', ['udemy', 'coursera', 'könyv', 'libri', 'líra', 'bookline', 'egyetem', 'tandíj']],
  ['Háziállat', ['fressnapf', 'zooplus', 'állatorvos', 'vet ', 'kisállat', 'pet ']],
  ['Ajándék', ['ajándék', 'gift', 'virág', 'flower']],
  ['Biztosítás', ['biztosító', 'allianz', 'generali', 'groupama', 'uniqa', 'k&h bizt', 'insurance']],
  ['Lakhatás', ['albérlet', 'bérleti díj', 'lakbér', 'közös költség', 'rent']],
];
const INCOME_HINTS = [['Fizetés', ['salary', 'bér ', 'munkabér', 'fizetés', 'payroll', 'munkáltató', 'wage']], ['Kamat & hozam', ['interest', 'kamat', 'cashback', 'dividend', 'osztalék']], ['Visszatérítés', ['refund', 'visszatérít', 'reversal', 'storno']]];

const deaccent = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function merchantCategory(text, type = 'expense') {
  const p = ' ' + deaccent(text || '') + ' ';
  const list = type === 'income' ? INCOME_HINTS : MERCHANTS;
  for (const [name, keys] of list) {
    if (keys.some(k => p.includes(deaccent(k)))) {
      const c = S.categories.find(x => x.name === name && x.kind === (type === 'income' ? 'income' : 'expense'));
      if (c) return c.id;
    }
  }
  return null;
}

/* ---------- Revolut ---------- */
// Personal statement header (EN): Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance
// Hungarian app language exports use translated headers – match both.
const REV_COLS = {
  type: /^(type|típus)$/i, product: /^(product|termék)$/i, started: /(started|kezd)/i, completed: /(completed|teljesít|befejez)/i,
  balance: /^(balance|egyenleg)$/i, desc: /^(description|leírás|megnevezés)$/i, amount: /^(amount|összeg)$/i, fee: /^(fee|díj)$/i, currency: /^(currency|pénznem)$/i, state: /^(state|állapot)$/i,
};
function detectRevolut(head) {
  const idx = {};
  for (const [k, re] of Object.entries(REV_COLS)) idx[k] = head.findIndex(h => re.test(String(h).trim()));
  return idx.started >= 0 && idx.amount >= 0 && idx.currency >= 0 && idx.desc >= 0 && (idx.product >= 0 || idx.state >= 0) ? idx : null;
}
function revolutAccount(product, currency) {
  const savings = /saving|megtakar|vault|széf|pocket/i.test(product || '');
  const name = `Revolut${savings ? ' megtakarítás' : ''} ${currency}`;
  let a = S.accounts.find(x => x.name === name) || S.accounts.find(x => x.revolut === `${savings ? 's' : 'c'}:${currency}`);
  if (!a) { a = { id: uid(), name, type: savings ? 'savings' : 'bank', currency, start: 0, archived: false, revolut: `${savings ? 's' : 'c'}:${currency}`, _fresh: true }; S.accounts.push(a); }
  return a;
}
function feeCategory() {
  let c = S.categories.find(x => x.name === 'Banki díjak' && x.kind === 'expense');
  if (!c) { c = { id: uid(), name: 'Banki díjak', emoji: '🏦', groupId: (S.groups.find(g => g.id === 'g_fix') || S.groups.find(g => !g.income) || {}).id, kind: 'expense', color: 7, target: 0 }; S.categories.push(c); }
  return c.id;
}
/** Builds Kassza transactions from Revolut rows. Pairs currency exchanges / pocket moves into transfers. */
function buildRevolut(rows, idx, { includePending = false } = {}) {
  const items = [];
  for (const r of rows) {
    const state = idx.state >= 0 ? String(r[idx.state] || '').toUpperCase() : 'COMPLETED';
    if (/REVERTED|DECLINED|FAILED|VISSZA|ELUTAS|SIKERTELEN/.test(state)) continue;
    if (!includePending && /PENDING|FÜGG/.test(state)) continue;
    const amount = parseBankAmount(r[idx.amount]);
    if (isNaN(amount) || !amount) continue;
    const startedRaw = String(r[idx.started] || '').trim();
    const date = parseAnyDate(startedRaw); if (!date) continue;
    const fee = idx.fee >= 0 ? Math.abs(parseBankAmount(r[idx.fee]) || 0) : 0;
    const currency = String(r[idx.currency] || '').trim().toUpperCase() || S.settings.currency;
    items.push({ type: idx.type >= 0 ? String(r[idx.type] || '').toUpperCase() : '', product: idx.product >= 0 ? r[idx.product] : '', startedRaw, date,
      desc: String(r[idx.desc] || '').trim(), amount, fee, currency, balance: idx.balance >= 0 ? parseBankAmount(r[idx.balance]) : NaN });
  }
  const used = new Set(), out = [];
  const extId = it => 'rev:' + [it.startedRaw, it.desc, it.amount, it.currency, it.product].join('|');
  items.forEach((it, i) => {
    if (used.has(i)) return;
    const acc1 = revolutAccount(it.product, it.currency);
    // pair: same timestamp, opposite sign, different pocket/currency → internal transfer
    const j = items.findIndex((o, k) => k !== i && !used.has(k) && o.startedRaw === it.startedRaw && Math.sign(o.amount) === -Math.sign(it.amount) &&
      (o.currency !== it.currency || o.product !== it.product) && (/EXCHANGE|TRANSFER|ÁTVÁLT|ÁTUTAL/.test(it.type + o.type) || /pocket|vault|savings|megtakar|exchange|átvált/i.test(it.desc + o.desc)));
    if (j >= 0) {
      const o = items[j]; used.add(i); used.add(j);
      const from = it.amount < 0 ? it : o, to = it.amount < 0 ? o : it;
      out.push({ type: 'transfer', amount: Math.abs(from.amount), accountId: revolutAccount(from.product, from.currency).id, toAccountId: revolutAccount(to.product, to.currency).id,
        toAmount: Math.abs(to.amount), date: from.date, payee: from.desc || 'Revolut átváltás', note: '', tags: ['revolut'], categoryId: null, extId: extId(from) });
    } else {
      used.add(i);
      const type = it.amount < 0 ? 'expense' : 'income';
      const fallback = type === 'expense' ? (expenseCats().find(c => c.name === 'Egyéb') || expenseCats()[0]) : (incomeCats().find(c => c.name === 'Egyéb bevétel') || incomeCats()[0]);
      out.push({ type, amount: Math.abs(round2(it.amount)), accountId: acc1.id, date: it.date, payee: it.desc.slice(0, 80), note: '', tags: ['revolut'],
        categoryId: suggestCategory(it.desc, type) || (fallback || {}).id, extId: extId(it) });
    }
    if (it.fee > 0) out.push({ type: 'expense', amount: round2(it.fee), accountId: acc1.id, date: it.date, payee: 'Revolut díj', note: it.desc.slice(0, 80), tags: ['revolut', 'díj'],
      categoryId: feeCategory(), extId: extId(it) + ':fee' });
  });
  // new accounts: derive the opening balance from Revolut's running balance on the earliest row
  for (const a of S.accounts.filter(x => x._fresh)) {
    const first = items.filter(it => revolutAccount(it.product, it.currency) === a && !isNaN(it.balance)).sort((x, y) => x.startedRaw.localeCompare(y.startedRaw))[0];
    if (first) a.start = round2(first.balance - first.amount + first.fee);
    delete a._fresh;
  }
  return out;
}

function importRevolutText(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { toast('Üres vagy hibás fájl'); return; }
  const idx = detectRevolut(rows[0]);
  if (!idx) { csvImportFromText(text); return; }
  const before = S.accounts.length, beforeCats = S.categories.length;
  const list = buildRevolut(rows.slice(1), idx);
  const existing = new Set(S.txs.map(t => t.extId).filter(Boolean));
  const fresh = list.filter(t => !existing.has(t.extId));
  const newAccs = S.accounts.slice(before);
  // preview modal
  const byCat = {};
  for (const t of fresh) if (t.type === 'expense') { const k = (cat(t.categoryId) || {}).name || '?'; byCat[k] = (byCat[k] || 0) + toMain(t.amount, (acc(t.accountId) || {}).currency); }
  const uncategorized = fresh.filter(t => t.type !== 'transfer' && ['Egyéb', 'Egyéb bevétel'].includes((cat(t.categoryId) || {}).name)).length;
  const dates = fresh.map(t => t.date).sort();
  const body = openModal('Revolut import', `
    <div class="center" style="font-size:40px">🟦</div>
    <p><b>${fresh.length} új tétel</b>${list.length - fresh.length ? `, ${list.length - fresh.length} már korábban importálva (kihagyom)` : ''}.
      ${dates.length ? `<br><span class="small muted">${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}</span>` : ''}</p>
    ${newAccs.length ? `<p class="small">Új számlák: ${newAccs.map(a => `<span class="chip">${accIcon(a)} ${esc(a.name)}</span>`).join(' ')}</p>` : ''}
    <ul class="list small">${Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `<li class="item"><span class="grow">${esc(k)}</span><b class="num">${money(v)}</b></li>`).join('')}</ul>
    ${uncategorized ? `<p class="small muted">💡 ${uncategorized} tételt nem tudtam besorolni („Egyéb”). Import után nézd át – amit egyszer besorolsz, legközelebb magától tudja.</p>` : ''}
    <p class="small muted">A belső átváltásokat és zsebek közti mozgást átvezetésként rögzítem, a díjakat külön „Banki díjak” tételként.</p>
    <div class="btns"><button class="btn" data-c="0">Mégse</button><button class="btn primary" data-c="1" ${fresh.length ? '' : 'disabled'}>Importálás</button></div>`);
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === '1') {
      fresh.forEach(t => addTx(t));
      localStorage.setItem('kassza_lastRevolut', today());
      afterSave(`${fresh.length} Revolut tétel importálva ✔`);
    } else {
      // undo side effects of the preview (auto-created accounts/categories)
      S.accounts.splice(before); S.categories.splice(beforeCats); closeModal();
    }
  });
}

function revolutHelp() {
  openModal('Revolut tételek behúzása', `
    <p class="small">A Revolut magánszámlákhoz nincs nyilvános, ingyenes API, ezért a kivonat fájllal megy – 30 másodperc:</p>
    <ol class="small" style="line-height:1.7;padding-left:18px">
      <li>Revolut app → a főoldalon koppints a számládra (pl. HUF) → <b>⋯ / Kivonat (Statement)</b></li>
      <li>Formátum: <b>Excel / CSV</b>, időszak: pl. az utolsó import óta</li>
      <li><b>Androidon:</b> a megosztás menüben válaszd a <b>Kassza</b> appot – kész, magától beolvassa.<br>
          <b>iPhone-on:</b> mentsd a Fájlokba, majd itt nyomd meg a lenti gombot és válaszd ki.</li>
    </ol>
    <p class="small muted">Amit már beolvastál, azt nem duplázza. A boltokat (Lidl, Wolt, Netflix…) magától besorolja, és megjegyzi, amit kézzel javítasz.</p>
    <div class="btns"><button class="btn primary" data-c="pick">📄 Revolut fájl kiválasztása</button></div>`)
    .addEventListener('click', async e => {
      if (!e.target.closest('[data-c="pick"]')) return;
      const text = await pickFile('.csv,text/csv,text/plain,application/vnd.ms-excel');
      if (text) importRevolutText(text);
    });
}

/** Called on startup: a CSV shared to Kassza from another app (Android share target) waits in the cache. */
async function checkSharedFile() {
  if (!/[?&]shared=1/.test(location.search) || !('caches' in window)) return;
  history.replaceState(null, '', location.pathname);
  try {
    const c = await caches.open('kassza-share');
    const res = await c.match('shared-file');
    if (!res) return toast('Nem érkezett fájl');
    const text = await res.text(); await c.delete('shared-file');
    importRevolutText(text);
  } catch (e) { toast('A megosztott fájlt nem sikerült beolvasni'); }
}
