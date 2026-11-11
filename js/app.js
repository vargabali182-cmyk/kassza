'use strict';
/* =====================================================================
   Kassza – app shell: routing, event delegation, theme, PIN lock, startup
   ===================================================================== */

const ROUTES = {
  home: viewHome, tx: viewTx, budget: viewBudget, reports: viewReports, more: viewMore,
  accounts: viewAccounts, account: () => viewAccount(UI.param), goals: viewGoals, recurring: viewRecurring,
  debts: viewDebts, categories: viewCategories, rules: viewRules, data: viewData, settings: viewSettings,
};
const TAB_OF = { home: 'home', tx: 'tx', budget: 'budget', reports: 'reports' };

function navigate(route, param = null, replace = false) {
  if (!replace && (UI.route !== route || UI.param !== param)) UI.history.push([UI.route, UI.param]);
  if (TAB_OF[route]) UI.history = [];
  UI.route = route; UI.param = param;
  rerenderView();
  window.scrollTo(0, 0);
}
function goBack() {
  const prev = UI.history.pop();
  if (prev) { UI.route = prev[0]; UI.param = prev[1]; } else UI.route = TAB_OF[UI.route] ? UI.route : 'more';
  rerenderView();
}

function rerenderView() {
  const main = document.getElementById('view');
  let v;
  if (!S.settings.onboarded) v = viewWelcome();
  else v = (ROUTES[UI.route] || viewHome)();
  document.getElementById('pageTitle').textContent = v.title;
  document.getElementById('topActions').innerHTML = v.actions || '';
  document.getElementById('backBtn').hidden = !v.back;
  main.innerHTML = v.html;
  const tab = TAB_OF[UI.route] || 'more';
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.route === tab));
  document.getElementById('fab').classList.toggle('hidden', !S.settings.onboarded || ['settings', 'data', 'categories', 'rules'].includes(UI.route));
  document.getElementById('tabbar').classList.toggle('hidden', !S.settings.onboarded);
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = S.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#173a2d' : '#0f6b4f';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (S.settings.theme === 'auto') applyTheme(); });

/* ---------- click actions ---------- */
const ACTIONS = {
  go: el => navigate(el.dataset.route),
  newTx: el => txForm(null, { accountId: el.dataset.acc }),
  editTx: el => { const t = S.txs.find(x => x.id === el.dataset.id); if (t) txForm(t); },
  txMonth: el => { UI.month = addMonthsYm(UI.month, +el.dataset.d); UI.calDay = null; rerenderView(); },
  budgetMonth: el => { UI.month = addMonthsYm(UI.month, +el.dataset.d); rerenderView(); },
  rMonth: el => { UI.rMonth = addMonthsYm(UI.rMonth, +el.dataset.d); rerenderView(); },
  rRange: el => { UI.rRange = el.dataset.v; rerenderView(); },
  rTable: () => { UI.rTable = !UI.rTable; rerenderView(); },
  txMode: el => { UI.txMode = el.dataset.v; rerenderView(); },
  calDay: el => { UI.calDay = UI.calDay === el.dataset.d ? null : el.dataset.d; rerenderView(); },
  filterCat: el => { UI.txf = { q: '', account: '', category: el.dataset.id, type: '', tag: '' }; UI.month = UI.rMonth; UI.txMode = 'list'; navigate('tx'); },
  autoAssign: () => autoAssignForm(UI.month),
  newAccount: () => accountForm(null),
  editAccount: el => accountForm(acc(el.dataset.id)),
  openAccount: el => navigate('account', el.dataset.id),
  reconcile: el => reconcileForm(el.dataset.id),
  toggleArchived: () => { UI.showArchived = !UI.showArchived; rerenderView(); },
  newGoal: () => goalForm(null),
  editGoal: el => goalForm(S.goals.find(g => g.id === el.dataset.id)),
  goalMove: el => goalMove(el.dataset.id, +el.dataset.dir),
  newRecurring: () => recurringForm(null),
  editRecurring: el => recurringForm(S.recurring.find(r => r.id === el.dataset.id)),
  postRecurring: el => postRecurring(el.dataset.id),
  skipRecurring: el => skipRecurring(el.dataset.id),
  newDebt: () => debtForm(null),
  editDebt: el => debtForm(S.debts.find(d => d.id === el.dataset.id)),
  debtPay: el => debtPay(el.dataset.id),
  settleDebt: el => { const d = S.debts.find(x => x.id === el.dataset.id); const left = debtLeft(d); if (left > 0) d.payments.push({ date: today(), amount: left }); d.settled = true; save(); rerenderView(); toast('Rendezve ✔'); },
  reopenDebt: el => { const d = S.debts.find(x => x.id === el.dataset.id); d.settled = false; save(); rerenderView(); },
  toggleSettled: () => { UI.showSettledDebts = !UI.showSettledDebts; rerenderView(); },
  newCategory: el => categoryForm(null, el.dataset.group),
  editCategory: el => categoryForm(cat(el.dataset.id)),
  newGroup: () => groupForm(null),
  editGroup: el => groupForm(grp(el.dataset.id)),
  newRule: () => ruleForm(null),
  editRule: el => ruleForm(S.rules.find(r => r.id === el.dataset.id)),
  applyRules: () => applyRulesToUncategorized(),
  exportCsv: () => { downloadFile(`kassza-tetelek-${today()}.csv`, exportCSV(), 'text/csv;charset=utf-8'); toast('CSV elkészült'); },
  backup: () => backup(),
  restore: () => restore(),
  importCsv: () => csvImport(),
  setPin: () => pinForm(),
  removePin: async () => { if (await confirmDialog('Kikapcsolod a PIN kódot?', 'Kikapcsolás')) { S.settings.pin = null; save(); rerenderView(); toast('PIN kikapcsolva'); } },
  wipe: async () => {
    if (!(await confirmDialog('<b>Minden adat végleg törlődik</b> erről az eszközről (tételek, számlák, célok). Ezt nem lehet visszavonni. Előtte érdemes mentést készíteni.', 'Mindent törlök'))) return;
    localStorage.removeItem(STORE_KEY); S = defaultData(); save(); UI.route = 'home'; applyTheme(); rerenderView(); toast('Minden adat törölve');
  },
  revolut: () => revolutHelp(),
  aiSetup: () => aiSetupForm(),
  aiRun: () => runOfferSearch(),
  aiClaude: () => claudeReviewForm(),
  aiPaste: () => pasteResultForm(),
  reviewLater: () => { S.settings.reviewSnooze = today(); save(); rerenderView(); },
  insAddRec: el => {
    const d = el.dataset, day = +d.day || 1, t = today(), [y, mo] = t.split('-').map(Number);
    let next = `${y}-${pad(mo)}-${pad(Math.min(day, daysInMonth(y, mo)))}`; if (next <= t) next = addPeriod(next, 'monthly', 1, day);
    recurringForm(null, { name: d.name, amount: String(d.amount), accountId: d.acc, categoryId: d.cat, next, sub: d.sub === '1', auto: true });
  },
  startEmpty: () => {
    const cur = document.getElementById('welcomeCur').value;
    S.settings.currency = cur; S.accounts.forEach(a => a.currency = cur); S.settings.onboarded = true;
    save(); rerenderView(); toast('Kezdésnek add meg a számláid egyenlegét 👇');
    setTimeout(() => navigate('accounts'), 400);
  },
  startDemo: async () => {
    if (S.settings.onboarded && S.txs.length && !(await confirmDialog('A demó adatok felülírják a jelenlegi adataidat. Folytatod?', 'Demó betöltése'))) return;
    loadDemo(); processRecurring(); UI.route = 'home'; UI.month = thisYm(); rerenderView(); toast('Demó adatok betöltve – nézz körül!');
  },
};
document.addEventListener('click', e => {
  if (e.target.closest('#modalRoot')) return;
  const el = e.target.closest('[data-act]');
  if (el && ACTIONS[el.dataset.act]) { e.preventDefault(); ACTIONS[el.dataset.act](el); }
});
document.getElementById('tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-route]'); if (!b) return;
  if (b.dataset.route === 'tx' || b.dataset.route === 'budget') UI.month = UI.month || thisYm();
  navigate(b.dataset.route);
});
document.getElementById('fab').onclick = () => txForm(null, UI.route === 'account' ? { accountId: UI.param } : (UI.route === 'tx' && UI.calDay ? { date: UI.calDay } : {}));
document.getElementById('backBtn').onclick = goBack;

/* ---------- inputs in views ---------- */
let searchTimer;
document.getElementById('view').addEventListener('input', e => {
  const el = e.target, k = el.dataset.input;
  if (k === 'txq') { clearTimeout(searchTimer); searchTimer = setTimeout(() => { UI.txf.q = el.value; const pos = el.selectionStart; rerenderView(); const ni = document.querySelector('[data-input="txq"]'); if (ni) { ni.focus(); ni.setSelectionRange(pos, pos); } }, 250); return; }
  const map = { txacc: 'account', txcat: 'category', txtype: 'type', txtag: 'tag' };
  if (map[k]) { UI.txf[map[k]] = el.value; rerenderView(); }
});
document.getElementById('view').addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.assign) {
    const v = el.value.trim() === '' ? 0 : parseAmount(el.value);
    if (isNaN(v)) { toast('Hibás összeg'); return; }
    setAssigned(UI.month, el.dataset.assign, v); save();
    const y = window.scrollY; rerenderView(); window.scrollTo(0, y);
  } else if (el.dataset.setting) {
    const k = el.dataset.setting; S.settings[k] = k === 'weekStart' ? +el.value : el.value;
    for (const key in fmtCache) delete fmtCache[key];
    save(); applyTheme(); rerenderView(); toast('Beállítás mentve');
  } else if (el.dataset.settingBool) {
    S.settings[el.dataset.settingBool] = el.checked; save(); toast('Beállítás mentve');
  } else if (el.dataset.rate) {
    const v = parseAmount(el.value); if (!(v > 0)) return toast('Hibás árfolyam');
    S.settings.rates[el.dataset.rate] = v; save(); toast('Árfolyam mentve');
  }
});
document.getElementById('view').addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset.assign) e.target.blur();
});

/* ---------- PIN lock ---------- */
function showLock() {
  const lock = document.getElementById('lock'); lock.classList.remove('hidden');
  let entry = '';
  const dots = () => document.getElementById('pinDots').innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join('');
  document.getElementById('pinPad').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('');
  dots();
  const press = async k => {
    if (k === '⌫') entry = entry.slice(0, -1); else if (entry.length < 4) entry += k;
    dots();
    if (entry.length === 4) {
      if (await hashPin(entry) === S.settings.pin) { lock.classList.add('hidden'); document.getElementById('lockErr').textContent = ''; }
      else { document.getElementById('lockErr').textContent = 'Hibás PIN'; if (navigator.vibrate) navigator.vibrate(120); entry = ''; setTimeout(dots, 250); }
    }
  };
  document.getElementById('pinPad').onclick = e => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); };
  document.onkeydown = e => { if (lock.classList.contains('hidden')) return; if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); };
}
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.settings.pin && Date.now() - hiddenAt > 60000) showLock();
});

/* ---------- startup ---------- */
applyTheme();
const posted = S.settings.onboarded ? processRecurring() : 0;
rerenderView();
checkSharedFile();
setTimeout(maybeAutoOffers, 4000);
if (S.settings.pin) showLock();
if (posted) toast(`${posted} ismétlődő tétel automatikusan rögzítve 🔁`);
if (S.settings.onboarded && S.txs.length > 20) {
  const lb = localStorage.getItem('kassza_lastBackup');
  if (!lb || monthsBetween(ymOf(lb), thisYm()) >= 1) setTimeout(() => toast('💾 Tipp: rég készült mentés – Több › Import / Export'), 3200);
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
