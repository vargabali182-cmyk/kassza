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
      <li>Formátum: <b>Excel</b> (a PDF nem jó), időszak: pl. az utolsó import óta. Minden pénznemhez (HUF, EUR…) külön kivonat van.</li>
      <li><b>Androidon:</b> a megosztás menüben válaszd a <b>Kassza</b> appot – kész, magától beolvassa.<br>
          <b>iPhone-on:</b> a megosztásnál válaszd a „Mentés a Fájlokba” lehetőséget, majd itt nyomd meg a lenti gombot, és a Fájlokban válaszd ki (Letöltések vagy „Az iPhone-omon”).</li>
    </ol>
    <p class="small muted">Amit már beolvastál, azt nem duplázza. A boltokat (Lidl, Wolt, Netflix…) magától besorolja, és megjegyzi, amit kézzel javítasz.</p>
    <div class="btns"><button class="btn primary" data-c="pick">📄 Revolut fájl kiválasztása</button></div>`)
    .addEventListener('click', async e => {
      if (!e.target.closest('[data-c="pick"]')) return;
      importStatementFile(await pickFileBuffer());
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
    const buf = await res.arrayBuffer(); await c.delete('shared-file');
    await importStatementFile({ name: 'shared', buf });
  } catch (e) { toast('A megosztott fájlt nem sikerült beolvasni'); }
}

/* =====================================================================
   File reading: CSV (UTF-8 or Windows-1250) and Excel .xlsx without libraries.
   Revolut's "Excel" statement is an .xlsx file.
   ===================================================================== */
const IMPORT_ACCEPT = '.csv,.xlsx,.txt,text/csv,text/plain,text/comma-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream';

function pickFileBuffer(accept = IMPORT_ACCEPT) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; if (accept) i.accept = accept;
    i.onchange = async () => { const f = i.files[0]; if (!f) return res(null); res({ name: f.name, buf: await f.arrayBuffer() }); };
    i.click();
  });
}
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1250').decode(buf); } // older Hungarian bank exports
}

/* ---- minimal ZIP reader (central directory + deflate via DecompressionStream) ---- */
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('A fájl sérült vagy nem Excel.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    files[new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen))] = { method, csize, off };
    p += 46 + nlen + xlen + clen;
  }
  const read = async name => {
    const f = files[name]; if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const data = u8.subarray(start, start + f.csize);
    if (f.method === 0) return new TextDecoder().decode(data);
    if (f.method !== 8 || typeof DecompressionStream === 'undefined') throw new Error('Ez a böngésző nem tudja kicsomagolni az Excel fájlt – frissítsd, vagy válaszd a CSV formátumot.');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
  return { names: Object.keys(files), read };
}
const xmlDoc = s => new DOMParser().parseFromString(s, 'application/xml');
const tags = (el, n) => [...el.getElementsByTagNameNS('*', n)];
function excelDate(serial) { return new Date(Math.round((serial - 25569) * 864e5)).toISOString().slice(0, 19).replace('T', ' '); }

/** Returns the first worksheet of an .xlsx file as rows of strings. */
async function xlsxToRows(buf) {
  const z = await unzip(buf);
  const strings = [];
  const sst = await z.read('xl/sharedStrings.xml');
  if (sst) for (const si of tags(xmlDoc(sst), 'si')) strings.push(tags(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''));
  // which cell styles are dates (so serial numbers become real dates)
  const dateStyles = new Set();
  const sty = await z.read('xl/styles.xml');
  if (sty) {
    const d = xmlDoc(sty), custom = {};
    for (const nf of tags(d, 'numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
    const xfs = tags(d, 'cellXfs')[0];
    if (xfs) tags(xfs, 'xf').forEach((xf, i) => {
      const id = +xf.getAttribute('numFmtId'), code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /y|d|h:mm/i.test(code)) dateStyles.add(i);
    });
  }
  const sheet = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0])[0];
  if (!sheet) throw new Error('Nem találtam munkalapot az Excel fájlban.');
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const rows = [];
  for (const r of tags(xmlDoc(await z.read(sheet)), 'row')) {
    const row = [];
    for (const c of tags(r, 'c')) {
      const t = c.getAttribute('t'), s = +(c.getAttribute('s') || 0), v = tags(c, 'v')[0], ref = c.getAttribute('r');
      let val = '';
      if (t === 's') val = v ? (strings[+v.textContent] ?? '') : '';
      else if (t === 'inlineStr') val = tags(c, 't').map(x => x.textContent).join('');
      else if (v) { val = v.textContent; if ((!t || t === 'n') && dateStyles.has(s) && val !== '' && !isNaN(+val)) val = excelDate(+val); }
      row[ref ? colIdx(ref) : row.length] = val;
    }
    rows.push(Array.from(row, x => x ?? ''));
  }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

/** One entry point for every statement file: sniffs the format, then routes to the Revolut or generic CSV importer. */
async function importStatementFile(file) {
  if (!file) return;
  const u8 = new Uint8Array(file.buf.slice(0, 8));
  let text;
  try {
    if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return toast('Ez PDF – a Revolutban az „Excel” formátumot válaszd a kivonatnál.');
    if (u8[0] === 0xD0 && u8[1] === 0xCF) return toast('Ez régi .xls fájl – mentsd el .xlsx vagy CSV formátumban.');
    if (u8[0] === 0x50 && u8[1] === 0x4B) text = (await xlsxToRows(file.buf)).map(r => r.map(csvEscape).join(';')).join('\n');
    else text = decodeText(file.buf);
  } catch (e) { return toast(e && e.message ? e.message : 'Nem sikerült beolvasni a fájlt'); }
  const head = parseCSV(text.split(/\r?\n/).slice(0, 2).join('\n'))[0] || [];
  if (detectRevolut(head)) importRevolutText(text); else csvImportFromText(text);
}
