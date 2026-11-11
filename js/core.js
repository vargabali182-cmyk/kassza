'use strict';
/* =====================================================================
   Kassza – core: data model, storage, money/date helpers, calculations
   All data lives in localStorage on the device. Nothing is sent anywhere.
   ===================================================================== */

const STORE_KEY = 'kassza_v1';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = o => JSON.parse(JSON.stringify(o));

const CURRENCIES = ['HUF', 'EUR', 'USD', 'GBP', 'CHF', 'RON', 'CZK', 'PLN', 'SEK', 'NOK', 'DKK', 'JPY', 'CAD', 'AUD'];
const DEFAULT_RATES = { EUR: 395, USD: 365, GBP: 465, CHF: 415, RON: 79, CZK: 15.8, PLN: 92, SEK: 34, NOK: 33, DKK: 53, JPY: 2.4, CAD: 265, AUD: 240 };
const ACCOUNT_TYPES = {
  cash: { name: 'Készpénz', emoji: '💵' },
  bank: { name: 'Bankszámla', emoji: '🏦' },
  card: { name: 'Hitelkártya', emoji: '💳' },
  savings: { name: 'Megtakarítás', emoji: '🐷' },
  invest: { name: 'Befektetés', emoji: '📈' },
  loan: { name: 'Hitel / tartozás', emoji: '🏠' },
};
const FREQS = { daily: 'naponta', weekly: 'hetente', monthly: 'havonta', yearly: 'évente' };
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
const catColor = c => (c && c.color != null) ? SERIES[c.color % 8] : 'var(--other)';

/* ---------------- default data ---------------- */
function defaultData() {
  const groups = [
    { id: 'g_fix', name: 'Kötelező kiadások' },
    { id: 'g_day', name: 'Hétköznapi' },
    { id: 'g_fun', name: 'Szabadidő és célok' },
    { id: 'g_inc', name: 'Bevételek', income: true },
  ];
  const c = (name, emoji, groupId, kind = 'expense') => ({ id: uid(), name, emoji, groupId, kind, color: null, target: 0 });
  const categories = [
    c('Lakhatás', '🏠', 'g_fix'), c('Rezsi', '💡', 'g_fix'), c('Élelmiszer', '🛒', 'g_fix'),
    c('Közlekedés', '🚗', 'g_fix'), c('Telefon & internet', '📱', 'g_fix'), c('Biztosítás', '🛡️', 'g_fix'),
    c('Egészség', '💊', 'g_fix'),
    c('Étterem & kávé', '🍔', 'g_day'), c('Háztartás', '🧽', 'g_day'), c('Ruházat', '👕', 'g_day'),
    c('Szépségápolás', '💇', 'g_day'), c('Előfizetések', '📺', 'g_day'), c('Gyerek', '🧸', 'g_day'),
    c('Szórakozás', '🎬', 'g_fun'), c('Utazás', '✈️', 'g_fun'), c('Ajándék', '🎁', 'g_fun'),
    c('Oktatás', '📚', 'g_fun'), c('Háziállat', '🐾', 'g_fun'), c('Sport', '🏋️', 'g_fun'), c('Egyéb', '📦', 'g_fun'),
    c('Fizetés', '💼', 'g_inc', 'income'), c('Mellékes', '💵', 'g_inc', 'income'), c('Kapott ajándék', '🎉', 'g_inc', 'income'),
    c('Kamat & hozam', '📈', 'g_inc', 'income'), c('Visszatérítés', '↩️', 'g_inc', 'income'), c('Egyéb bevétel', '➕', 'g_inc', 'income'),
  ];
  categories.forEach((cat, i) => cat.color = i % 8);
  return {
    version: 1,
    settings: { currency: 'HUF', theme: 'auto', pin: null, rates: { ...DEFAULT_RATES }, onboarded: false, weekStart: 1 },
    accounts: [
      { id: uid(), name: 'Készpénz', type: 'cash', currency: 'HUF', start: 0, archived: false },
      { id: uid(), name: 'Bankszámla', type: 'bank', currency: 'HUF', start: 0, archived: false },
    ],
    groups, categories,
    txs: [], budget: {}, goals: [], recurring: [], debts: [], rules: [],
  };
}

/* ---------------- storage ---------------- */
let S = load();
let dataVersion = 0;
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.error('load failed', e); }
  return defaultData();
}
function migrate(d) {
  const base = defaultData();
  for (const k of ['accounts', 'groups', 'categories', 'txs', 'goals', 'recurring', 'debts', 'rules']) if (!Array.isArray(d[k])) d[k] = base[k];
  d.budget = d.budget || {};
  d.settings = Object.assign(base.settings, d.settings || {});
  d.settings.rates = Object.assign({ ...DEFAULT_RATES }, d.settings.rates || {});
  return d;
}
function save() {
  dataVersion++;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { alert('Nem sikerült menteni – megtelt a tárhely? Készíts biztonsági mentést.'); }
}
function replaceData(d) { S = migrate(d); save(); }

/* ---------------- lookups ---------------- */
const acc = id => S.accounts.find(a => a.id === id);
const cat = id => S.categories.find(c => c.id === id);
const grp = id => S.groups.find(g => g.id === id);
const expenseCats = () => S.categories.filter(c => c.kind === 'expense');
const incomeCats = () => S.categories.filter(c => c.kind === 'income');
const activeAccounts = () => S.accounts.filter(a => !a.archived);

/* ---------------- dates ---------------- */
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => toISO(new Date());
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymOf = s => s.slice(0, 7);
const thisYm = () => ymOf(today());
function addMonthsYm(ym, n) {
  let [y, m] = ym.split('-').map(Number);
  m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${pad(m)}`;
}
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); }
function addPeriod(s, freq, interval = 1, anchorDay) {
  const d = parseISO(s);
  if (freq === 'daily') d.setDate(d.getDate() + interval);
  else if (freq === 'weekly') d.setDate(d.getDate() + 7 * interval);
  else {
    const months = freq === 'yearly' ? 12 * interval : interval;
    let y = d.getFullYear(), m = d.getMonth() + months;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    const day = Math.min(anchorDay || d.getDate(), daysInMonth(y, m + 1));
    return toISO(new Date(y, m, day));
  }
  return toISO(d);
}
const monthsBetween = (a, b) => { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); };
const fmtMonth = ym => new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long' }).format(parseISO(ym + '-01'));
const fmtMonthShort = ym => new Intl.DateTimeFormat('hu-HU', { month: 'short' }).format(parseISO(ym + '-01')).replace('.', '');
const fmtDay = s => new Intl.DateTimeFormat('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' }).format(parseISO(s));
const fmtDate = s => new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'short', day: 'numeric' }).format(parseISO(s));
function relDay(s) {
  const diff = Math.round((parseISO(s) - parseISO(today())) / 864e5);
  if (diff === 0) return 'ma'; if (diff === 1) return 'holnap'; if (diff === -1) return 'tegnap';
  return diff > 0 ? `${diff} nap múlva` : `${-diff} napja`;
}

/* ---------------- money ---------------- */
const fmtCache = {};
function money(amount, cur = S.settings.currency, signed = false) {
  const key = cur + signed;
  if (!fmtCache[key]) {
    const dec = ['HUF', 'JPY'].includes(cur) ? 0 : 2;
    fmtCache[key] = new Intl.NumberFormat('hu-HU', { style: 'currency', currency: cur, maximumFractionDigits: dec, minimumFractionDigits: dec, signDisplay: signed ? 'exceptZero' : 'auto' });
  }
  return fmtCache[key].format(Math.abs(amount) < 0.005 ? 0 : amount);
}
function moneyShort(v, cur = S.settings.currency) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toLocaleString('hu-HU', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e4) return (v / 1e3).toLocaleString('hu-HU', { maximumFractionDigits: 0 }) + ' e';
  return Math.round(v).toLocaleString('hu-HU');
}
const rate = cur => cur === S.settings.currency ? 1 : (S.settings.rates[cur] || 1) / (S.settings.currency === 'HUF' ? 1 : (S.settings.rates[S.settings.currency] || 1));
const toMain = (amount, cur) => amount * rate(cur);
const round2 = n => Math.round(n * 100) / 100;
/** Accepts "1 200", "1200,5", and simple math like "1200+350*2" (calculator input). */
function parseAmount(str) {
  if (typeof str === 'number') return str;
  const s = String(str || '').replace(/\s/g, '').replace(/,/g, '.');
  if (!s) return NaN;
  if (!/^[\d.+\-*/()]+$/.test(s)) return NaN;
  try { const v = Function(`"use strict";return (${s})`)(); return Number.isFinite(v) ? round2(v) : NaN; } catch { return NaN; }
}

/* ---------------- transactions ---------------- */
// Returns category parts of a transaction: [{categoryId, amount}] in account currency
function txParts(t) {
  if (t.splits && t.splits.length) return t.splits;
  return [{ categoryId: t.categoryId, amount: t.amount }];
}
function txCurrency(t) { const a = acc(t.accountId); return a ? a.currency : S.settings.currency; }
function signedAmount(t, accountId) {
  if (t.type === 'income') return t.amount;
  if (t.type === 'expense') return -t.amount;
  if (t.accountId === accountId) return -t.amount;
  return t.toAmount != null ? t.toAmount : t.amount;
}
function balances() {
  const b = {};
  for (const a of S.accounts) b[a.id] = a.start || 0;
  for (const t of S.txs) {
    if (t.type === 'income') b[t.accountId] = (b[t.accountId] || 0) + t.amount;
    else if (t.type === 'expense') b[t.accountId] = (b[t.accountId] || 0) - t.amount;
    else if (t.type === 'transfer') {
      b[t.accountId] = (b[t.accountId] || 0) - t.amount;
      b[t.toAccountId] = (b[t.toAccountId] || 0) + (t.toAmount != null ? t.toAmount : t.amount);
    }
  }
  return b;
}
function netWorth(bal = balances()) {
  return S.accounts.reduce((s, a) => s + toMain(bal[a.id] || 0, a.currency), 0);
}
function sortTxs() { S.txs.sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0)); }
function addTx(t) {
  t.id = t.id || uid(); t.created = t.created || Date.now();
  S.txs.push(t); sortTxs();
  return t;
}

/* ---------------- monthly aggregates (cached) ---------------- */
let aggCache = { v: -1, data: null };
function monthAgg() {
  if (aggCache.v === dataVersion && aggCache.data) return aggCache.data;
  const data = {};
  const get = ym => data[ym] || (data[ym] = { income: 0, expense: 0, spend: {}, incomeBy: {} });
  for (const t of S.txs) {
    if (t.type === 'transfer') continue;
    const m = get(ymOf(t.date)), cur = txCurrency(t);
    for (const p of txParts(t)) {
      const v = toMain(p.amount, cur);
      if (t.type === 'expense') { m.expense += v; m.spend[p.categoryId] = (m.spend[p.categoryId] || 0) + v; }
      else { m.income += v; m.incomeBy[p.categoryId] = (m.incomeBy[p.categoryId] || 0) + v; }
    }
  }
  aggCache = { v: dataVersion, data };
  return data;
}
function rangeAgg(fromYm, toYm) {
  const agg = monthAgg(), out = { income: 0, expense: 0, spend: {}, incomeBy: {} };
  for (let m = fromYm; m <= toYm; m = addMonthsYm(m, 1)) {
    const a = agg[m]; if (!a) continue;
    out.income += a.income; out.expense += a.expense;
    for (const k in a.spend) out.spend[k] = (out.spend[k] || 0) + a.spend[k];
    for (const k in a.incomeBy) out.incomeBy[k] = (out.incomeBy[k] || 0) + a.incomeBy[k];
  }
  return out;
}

/* ---------------- envelope budget engine ----------------
   Zero-based ("give every forint a job"):
   - Money to assign = starting balances + all income so far − everything assigned − past overspending
   - Each category envelope: available = leftover from last month + assigned − spent
   - Positive leftovers roll over; overspending is taken from next month's money to assign.      */
function budgetMonth(m) {
  const agg = monthAgg();
  const months = Object.keys(agg).concat(Object.keys(S.budget));
  let start = months.length ? months.reduce((a, b) => a < b ? a : b) : m;
  if (start > m) start = m;
  let toAssign = S.accounts.filter(a => a.type !== 'invest' && a.type !== 'loan')
    .reduce((s, a) => s + toMain(a.start || 0, a.currency), 0);
  const carry = {};
  const cats = expenseCats();
  let rows = {}, income = 0, assignedTotal = 0, spentTotal = 0;
  for (let k = start; k <= m; k = addMonthsYm(k, 1)) {
    const a = agg[k] || { income: 0, spend: {} }, B = S.budget[k] || {};
    toAssign += a.income;
    for (const c of cats) {
      const assigned = B[c.id] || 0, spent = a.spend[c.id] || 0, prev = carry[c.id] || 0;
      const available = prev + assigned - spent;
      toAssign -= assigned;
      if (k === m) {
        rows[c.id] = { assigned, spent, carry: prev, available };
        assignedTotal += assigned; spentTotal += spent;
      } else if (available < 0) { toAssign += available; carry[c.id] = 0; }
      else carry[c.id] = available;
    }
    // spending in categories that no longer exist / uncategorized still reduces money
    for (const id in a.spend) if (!cats.some(c => c.id === id) && k < m) toAssign -= a.spend[id];
    if (k === m) income = a.income;
  }
  const overspent = Object.values(rows).filter(r => r.available < -0.004).reduce((s, r) => s + r.available, 0);
  return { rows, toAssign, income, assignedTotal, spentTotal, overspent };
}
function setAssigned(m, catId, v) {
  S.budget[m] = S.budget[m] || {};
  if (!v) delete S.budget[m][catId]; else S.budget[m][catId] = round2(v);
}

/* ---------------- recurring / subscriptions ---------------- */
function monthlyCost(r) {
  const k = { daily: 365 / 12, weekly: 52 / 12, monthly: 1, yearly: 1 / 12 }[r.freq] / (r.interval || 1);
  return toMain(r.amount, (acc(r.accountId) || {}).currency || S.settings.currency) * k;
}
function txFromRecurring(r, date) {
  return addTx({
    type: r.type, amount: r.amount, accountId: r.accountId, toAccountId: r.toAccountId || null,
    categoryId: r.type === 'transfer' ? null : r.categoryId, payee: r.name, note: r.note || '', tags: r.tags || [],
    date, recurringId: r.id,
  });
}
/** Posts all automatic recurring transactions that are due. Returns how many were created. */
function processRecurring() {
  const t = today(); let n = 0;
  for (const r of S.recurring) {
    if (!r.auto || r.paused) continue;
    let guard = 0;
    while (r.next <= t && (!r.end || r.next <= r.end) && guard++ < 400) {
      txFromRecurring(r, r.next); n++;
      r.next = addPeriod(r.next, r.freq, r.interval, r.anchorDay);
    }
  }
  if (n) save();
  return n;
}
function upcoming(days = 30) {
  const limit = addDays(today(), days), out = [];
  for (const r of S.recurring) {
    if (r.paused) continue;
    let d = r.next, guard = 0;
    while (d <= limit && (!r.end || d <= r.end) && guard++ < 60) {
      out.push({ r, date: d, overdue: d < today() });
      d = addPeriod(d, r.freq, r.interval, r.anchorDay);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------------- rules / auto-categorize ---------------- */
function suggestCategory(payee, type = 'expense') {
  if (!payee) return null;
  const p = payee.toLowerCase().trim();
  for (const r of S.rules) {
    if (r.text && p.includes(r.text.toLowerCase())) { const c = cat(r.categoryId); if (c && c.kind === (type === 'income' ? 'income' : 'expense')) return c.id; }
  }
  const prev = S.txs.find(t => t.type === type && t.payee && t.payee.toLowerCase().trim() === p && t.categoryId);
  if (prev) return prev.categoryId;
  return typeof merchantCategory === 'function' ? merchantCategory(payee, type) : null;
}
function payees() {
  const seen = new Map();
  for (const t of S.txs) if (t.payee) seen.set(t.payee.toLowerCase(), t.payee);
  return [...seen.values()].slice(0, 300);
}
function allTags() {
  const s = new Set(); for (const t of S.txs) (t.tags || []).forEach(x => s.add(x)); return [...s].sort();
}

/* ---------------- goals & debts ---------------- */
const goalSaved = g => (g.history || []).reduce((s, h) => s + h.amount, 0);
function goalMonthly(g) {
  const left = g.target - goalSaved(g);
  if (left <= 0 || !g.date) return 0;
  const months = Math.max(1, monthsBetween(thisYm(), ymOf(g.date)));
  return left / months;
}
const debtPaid = d => (d.payments || []).reduce((s, p) => s + p.amount, 0);
const debtLeft = d => d.amount - debtPaid(d);

/* ---------------- CSV ---------------- */
function csvEscape(v) { v = v == null ? '' : String(v); return /[;"\n,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function exportCSV() {
  const head = ['Dátum', 'Típus', 'Összeg', 'Pénznem', 'Számla', 'Cél számla', 'Kategória', 'Partner', 'Megjegyzés', 'Címkék'];
  const typeName = { expense: 'Kiadás', income: 'Bevétel', transfer: 'Átvezetés' };
  const rows = [head];
  for (const t of S.txs) {
    const parts = t.type === 'transfer' ? [{ categoryId: null, amount: t.amount }] : txParts(t);
    for (const p of parts) rows.push([
      t.date, typeName[t.type], String(t.type === 'expense' || t.type === 'transfer' ? -p.amount : p.amount).replace('.', ','),
      txCurrency(t), (acc(t.accountId) || {}).name || '', t.type === 'transfer' ? ((acc(t.toAccountId) || {}).name || '') : '',
      p.categoryId ? ((cat(p.categoryId) || {}).name || '') : '', t.payee || '', t.note || '', (t.tags || []).join(', '),
    ]);
  }
  return '﻿' + rows.map(r => r.map(csvEscape).join(';')).join('\r\n');
}
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = [';', '\t', ','].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
/** Parses dates like 2026-11-06, 2026.11.06., 06.11.2026, 11/06/2026 */
function parseAnyDate(s) {
  s = String(s || '').trim().replace(/\.$/, '');
  let m;
  if ((m = s.match(/^(\d{4})[-./ ]+(\d{1,2})[-./ ]+(\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  if ((m = s.match(/^(\d{1,2})[-./ ]+(\d{1,2})[-./ ]+(\d{4})/))) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  const d = new Date(s); return isNaN(d) ? null : toISO(d);
}
function parseBankAmount(s) {
  s = String(s || '').replace(/[^\d,.\-+]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const v = parseFloat(s); return isNaN(v) ? NaN : v;
}

/* ---------------- PIN ---------------- */
async function hashPin(pin) {
  const data = new TextEncoder().encode('kassza:' + pin);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const b of data) h = (h * 31 + b) >>> 0; return 'x' + h.toString(16);
}

/* ---------------- demo data ---------------- */
function loadDemo() {
  const d = defaultData();
  d.settings.onboarded = true;
  const byName = n => d.categories.find(c => c.name === n).id;
  const [cash, bank] = d.accounts;
  bank.start = 180000; cash.start = 15000;
  const card = { id: uid(), name: 'Hitelkártya', type: 'card', currency: 'HUF', start: 0, archived: false };
  const savAcc = { id: uid(), name: 'Megtakarítás', type: 'savings', currency: 'HUF', start: 450000, archived: false };
  const eur = { id: uid(), name: 'Euró számla', type: 'bank', currency: 'EUR', start: 320, archived: false };
  d.accounts.push(card, savAcc, eur);
  const txs = []; let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const add = (date, type, amount, accountId, categoryId, payee, extra = {}) =>
    txs.push({ id: uid(), created: Date.now() + txs.length, date, type, amount, accountId, categoryId, payee, note: '', tags: [], ...extra });
  const now = thisYm(); let prevCard = 0;
  for (let k = 3; k >= 0; k--) {
    const m = addMonthsYm(now, -k), [y, mo] = m.split('-').map(Number);
    const last = k === 0 ? new Date().getDate() : daysInMonth(y, mo);
    const day = n => `${m}-${pad(Math.min(n, last))}`;
    if (last >= 5 || k > 0) add(day(5), 'income', 485000, bank.id, byName('Fizetés'), 'Munkáltató Kft.');
    if (last >= 8 || k > 0) add(day(8), 'expense', 165000, bank.id, byName('Lakhatás'), 'Albérlet');
    if (last >= 12 || k > 0) add(day(12), 'expense', 28000 + Math.round(rnd() * 9000), bank.id, byName('Rezsi'), 'ELMŰ-ÉMÁSZ');
    if (last >= 10 || k > 0) add(day(10), 'transfer', 50000, bank.id, null, 'Megtakarítás', { toAccountId: savAcc.id });
    if (last >= 3 || k > 0) add(day(3), 'transfer', 20000, bank.id, null, 'ATM készpénzfelvétel', { toAccountId: cash.id });
    const startIdx = txs.length;
    for (let i = 1; i <= last; i += 2 + Math.floor(rnd() * 3)) {
      add(day(i), 'expense', 3000 + Math.round(rnd() * 14000), rnd() > .4 ? card.id : bank.id, byName('Élelmiszer'), rnd() > .5 ? 'Lidl' : 'Tesco');
      if (rnd() > .6) add(day(i), 'expense', 1200 + Math.round(rnd() * 6000), cash.id, byName('Étterem & kávé'), rnd() > .5 ? 'Kávézó' : 'Gyorsétterem');
      if (rnd() > .8) add(day(i), 'expense', 4000 + Math.round(rnd() * 20000), card.id, byName(rnd() > .5 ? 'Szórakozás' : 'Ruházat'), rnd() > .5 ? 'Mozi' : 'Webshop');
      if (rnd() > .85) add(day(i), 'expense', 9000 + Math.round(rnd() * 8000), card.id, byName('Közlekedés'), 'MOL benzinkút');
    }
    if (prevCard && (last >= 20 || k > 0)) add(day(20), 'transfer', prevCard, bank.id, null, 'Kártya törlesztés', { toAccountId: card.id });
    prevCard = txs.slice(startIdx).filter(t => t.accountId === card.id && t.type === 'expense').reduce((x, t) => x + t.amount, 0);
    if (rnd() > .3) add(day(15), 'income', 25000 + Math.round(rnd() * 30000), bank.id, byName('Mellékes'), 'Szabadúszó munka');
    d.budget[m] = {
      [byName('Lakhatás')]: 165000, [byName('Rezsi')]: 35000, [byName('Élelmiszer')]: 90000, [byName('Közlekedés')]: 25000,
      [byName('Étterem & kávé')]: 20000, [byName('Szórakozás')]: 15000, [byName('Ruházat')]: 15000, [byName('Előfizetések')]: 9000,
      [byName('Telefon & internet')]: 12000, [byName('Utazás')]: 30000, [byName('Háztartás')]: 15000, [byName('Egészség')]: 10000,
      [byName('Sport')]: 12000, [byName('Ajándék')]: 10000, [byName('Biztosítás')]: 3000, [byName('Egyéb')]: 15000,
    };
  }
  d.txs = txs;
  const next = (dom) => { const t = today(), [y, m] = t.split('-').map(Number); let dd = `${y}-${pad(m)}-${pad(dom)}`; return dd <= t ? addPeriod(dd, 'monthly', 1, dom) : dd; };
  d.recurring = [
    { id: uid(), name: 'Netflix', type: 'expense', amount: 4490, accountId: card.id, categoryId: byName('Előfizetések'), freq: 'monthly', interval: 1, anchorDay: 3, next: next(3), auto: true, sub: true },
    { id: uid(), name: 'Spotify', type: 'expense', amount: 1990, accountId: card.id, categoryId: byName('Előfizetések'), freq: 'monthly', interval: 1, anchorDay: 17, next: next(17), auto: true, sub: true },
    { id: uid(), name: 'Mobil előfizetés', type: 'expense', amount: 8990, accountId: bank.id, categoryId: byName('Telefon & internet'), freq: 'monthly', interval: 1, anchorDay: 22, next: next(22), auto: true, sub: true },
    { id: uid(), name: 'Lakásbiztosítás', type: 'expense', amount: 36000, accountId: bank.id, categoryId: byName('Biztosítás'), freq: 'yearly', interval: 1, anchorDay: 1, next: addMonthsYm(thisYm(), 2) + '-01', auto: false, sub: false },
  ];
  d.goals = [
    { id: uid(), name: 'Nyaralás', emoji: '🏖️', target: 400000, date: addMonthsYm(thisYm(), 7) + '-01', history: [{ date: today(), amount: 120000 }] },
    { id: uid(), name: 'Vésztartalék', emoji: '🛟', target: 1500000, date: addMonthsYm(thisYm(), 18) + '-01', history: [{ date: today(), amount: 450000 }] },
  ];
  d.debts = [
    { id: uid(), person: 'Péter', direction: 'lent', amount: 30000, date: addDays(today(), -20), due: addDays(today(), 10), note: 'Koncertjegy', payments: [{ date: addDays(today(), -5), amount: 10000 }], settled: false },
  ];
  d.rules = [{ id: uid(), text: 'mol', categoryId: byName('Közlekedés') }, { id: uid(), text: 'lidl', categoryId: byName('Élelmiszer') }];
  replaceData(d);
  sortTxs(); save();
  // park the leftover starting money in the travel envelope so the demo starts nearly fully budgeted
  const firstM = addMonthsYm(now, -3), extra = budgetMonth(now).toAssign - 25000;
  if (extra > 0) { const id = byName('Utazás'); S.budget[firstM][id] = (S.budget[firstM][id] || 0) + Math.round(extra / 1000) * 1000; save(); }
}
