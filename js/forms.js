'use strict';
/* =====================================================================
   Kassza – modal forms (transactions, accounts, goals, recurring, debts,
   categories, rules, auto-assign, PIN, CSV import, backup/restore)
   ===================================================================== */

/* ---------- modal framework ---------- */
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; document.body.style.overflow = ''; }
function openModal(title, html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="modal-close" aria-label="Bezárás">✕</button></div><div class="modal-body">${html}</div></div></div>`;
  document.body.style.overflow = 'hidden';
  const bg = root.querySelector('.modal-bg');
  bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
  root.querySelector('.modal-close').onclick = closeModal;
  return root.querySelector('.modal-body');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/** Stateful form: render(state) -> html; on: {name: (el, state, rerender)}; onInput(key, state, rerender, el) */
function formModal({ title, state, render, on = {}, onInput }) {
  const body = openModal(title, '');
  const rerender = () => { body.innerHTML = render(state); };
  body.addEventListener('click', e => {
    const el = e.target.closest('[data-f]'); if (!el) return;
    e.preventDefault();
    const fn = on[el.dataset.f]; if (fn) fn(el, state, rerender);
  });
  body.addEventListener('input', e => {
    const el = e.target, k = el.dataset.k; if (!k) return;
    state[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (onInput) onInput(k, state, rerender, el);
  });
  rerender();
  const first = body.querySelector('[autofocus]'); if (first) setTimeout(() => first.focus(), 60);
  return { body, rerender };
}
function confirmDialog(msg, ok = 'Igen', danger = true) {
  return new Promise(res => {
    const body = openModal('Megerősítés', `<p>${msg}</p><div class="btns"><button class="btn" data-c="0">Mégse</button><button class="btn ${danger ? 'danger' : 'primary'}" data-c="1">${esc(ok)}</button></div>`);
    body.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; closeModal(); res(b.dataset.c === '1'); });
  });
}
function amountDialog(title, label, { initial = '', withDate = false, cur } = {}) {
  return new Promise(res => {
    const body = openModal(title, `<label class="field"><span>${esc(label)}${cur ? ' (' + cur + ')' : ''}</span><input class="input num" inputmode="decimal" id="adV" value="${esc(initial)}" autofocus></label>
      ${withDate ? `<label class="field"><span>Dátum</span><input class="input" type="date" id="adD" value="${today()}"></label>` : ''}
      <div class="btns"><button class="btn" data-c="0">Mégse</button><button class="btn primary" data-c="1">Mentés</button></div>`);
    setTimeout(() => body.querySelector('#adV').focus(), 60);
    const done = ok => {
      if (!ok) { closeModal(); res(null); return; }
      const v = parseAmount(body.querySelector('#adV').value);
      if (!(v > 0) && !(v < 0)) { toast('Adj meg egy érvényes összeget'); return; }
      const d = withDate ? body.querySelector('#adD').value || today() : today();
      closeModal(); res({ amount: v, date: d });
    };
    body.addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (b) done(b.dataset.c === '1'); });
    body.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); });
  });
}
function afterSave(msg) { closeModal(); save(); rerenderView(); if (msg) toast(msg); }
function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const file = typeof File === 'function' ? new File([blob], name, { type: mime }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    navigator.share({ files: [file], title: name }).catch(() => {});
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function pickFile(accept) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
    i.onchange = () => { const f = i.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); };
    i.click();
  });
}

/* =========================== TRANSACTION FORM =========================== */
function txForm(existing, defaults = {}) {
  const t = existing ? clone(existing) : null;
  const firstAcc = (activeAccounts()[0] || S.accounts[0] || {}).id;
  const st = {
    id: t ? t.id : null, type: t ? t.type : (defaults.type || 'expense'),
    amount: t ? String(t.amount) : '', accountId: t ? t.accountId : (defaults.accountId || localStorage.getItem('kassza_lastAcc') || firstAcc),
    toAccountId: t ? t.toAccountId : '', toAmount: t && t.toAmount != null ? String(t.toAmount) : '',
    categoryId: t ? t.categoryId : '', date: t ? t.date : (defaults.date || today()), payee: t ? t.payee || '' : '', note: t ? t.note || '' : '',
    tags: t ? (t.tags || []).join(', ') : '', split: !!(t && t.splits && t.splits.length),
    splits: t && t.splits ? t.splits.map(s => ({ categoryId: s.categoryId, amount: String(s.amount) })) : [{ categoryId: '', amount: '' }, { categoryId: '', amount: '' }],
    repeat: false, freq: 'monthly', autoCat: !t,
  };
  if (!acc(st.accountId)) st.accountId = firstAcc;
  const curOf = id => (acc(id) || {}).currency || S.settings.currency;
  const render = s => {
    const kind = s.type === 'income' ? 'income' : 'expense';
    const cats = S.categories.filter(c => c.kind === kind);
    const amt = parseAmount(s.amount);
    const splitSum = s.splits.reduce((x, p) => x + (parseAmount(p.amount) || 0), 0);
    const crossCur = s.type === 'transfer' && s.toAccountId && curOf(s.toAccountId) !== curOf(s.accountId);
    return `<div class="seg exp">${[['expense', 'Kiadás'], ['income', 'Bevétel'], ['transfer', 'Átvezetés']].map(([v, l]) => `<button data-f="type" data-v="${v}" class="${s.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input class="amount-input num ${s.type === 'expense' ? 'neg' : s.type === 'income' ? 'pos' : ''}" inputmode="decimal" placeholder="0" data-k="amount" value="${esc(s.amount)}" autofocus aria-label="Összeg">
      <div class="center small muted" style="margin-bottom:10px">${curOf(s.accountId)}${s.amount && /[+\-*/]/.test(s.amount.replace(/^-/, '')) && !isNaN(amt) ? ' · = ' + money(amt, curOf(s.accountId)) : ''}</div>
      ${s.type !== 'transfer' && !s.split ? `<div class="cat-grid">${cats.map(c => `<button class="cat-pick ${s.categoryId === c.id ? 'on' : ''}" data-f="cat" data-id="${c.id}"><b>${c.emoji}</b>${esc(c.name)}</button>`).join('')}</div>` : ''}
      ${s.type === 'expense' ? `<div class="row between" style="margin-bottom:10px"><span class="small muted">${s.split ? 'Több kategóriára bontva' : ''}</span><button class="link" data-f="toggleSplit">${s.split ? '✕ Megosztás vége' : '✂️ Megosztás több kategóriára'}</button></div>` : ''}
      ${s.split && s.type === 'expense' ? `<div style="margin-bottom:10px">${s.splits.map((p, i) => `<div class="split-row">
          <select class="input" data-split="${i}" data-sk="categoryId">${catOptions('expense', p.categoryId)}</select>
          <input class="input num" inputmode="decimal" placeholder="Összeg" data-split="${i}" data-sk="amount" value="${esc(p.amount)}">
          <button class="btn sm" data-f="delSplit" data-i="${i}" aria-label="Sor törlése">✕</button></div>`).join('')}
        <div class="row between small"><button class="link" data-f="addSplit">＋ Sor</button>
        <span class="${Math.abs((amt || 0) - splitSum) < 0.01 ? 'pos' : 'neg'}">Felosztva: ${money(splitSum, curOf(s.accountId))} / ${money(amt || 0, curOf(s.accountId))}</span></div></div>` : ''}
      <div class="two"><label class="field"><span>${s.type === 'transfer' ? 'Honnan' : 'Számla'}</span><select class="input" data-k="accountId">${accOptions(s.accountId)}</select></label>
        ${s.type === 'transfer' ? `<label class="field"><span>Hová</span><select class="input" data-k="toAccountId"><option value="">– Válassz –</option>${accOptions(s.toAccountId).replace(`value="${s.accountId}"`, `value="${s.accountId}" disabled`)}</select></label>`
          : `<label class="field"><span>Dátum</span><input class="input" type="date" data-k="date" value="${s.date}"></label>`}</div>
      ${crossCur ? `<label class="field"><span>Érkező összeg (${curOf(s.toAccountId)})</span><input class="input num" inputmode="decimal" data-k="toAmount" value="${esc(s.toAmount)}" placeholder="${amt ? round2(amt * rate(curOf(s.accountId)) / rate(curOf(s.toAccountId))) : ''}"></label>` : ''}
      ${s.type === 'transfer' ? `<label class="field"><span>Dátum</span><input class="input" type="date" data-k="date" value="${s.date}"></label>` : ''}
      <label class="field"><span>${s.type === 'income' ? 'Kitől' : s.type === 'expense' ? 'Hol / kinek (partner)' : 'Megnevezés'}</span><input class="input" data-k="payee" list="payeeList" value="${esc(s.payee)}" placeholder="pl. Lidl, Albérlet…" autocomplete="off">
        <datalist id="payeeList">${payees().map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <div class="two"><label class="field"><span>Megjegyzés</span><input class="input" data-k="note" value="${esc(s.note)}"></label>
        <label class="field"><span>Címkék (vesszővel)</span><input class="input" data-k="tags" value="${esc(s.tags)}" list="tagList" placeholder="pl. nyaralás"><datalist id="tagList">${allTags().map(x => `<option value="${esc(x)}">`).join('')}</datalist></label></div>
      ${!s.id ? `<label class="row small" style="margin-bottom:6px"><input type="checkbox" data-k="repeat" ${s.repeat ? 'checked' : ''}> Ismétlődő tétel
        <select class="input" data-k="freq" style="width:auto;padding:5px 8px;font-size:14px">${Object.entries(FREQS).map(([v, l]) => `<option value="${v}" ${s.freq === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
      <div class="btns">${s.id ? '<button class="btn danger" data-f="del">Törlés</button><button class="btn" data-f="dup">Másolat</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`;
  };
  const f = formModal({
    title: existing ? 'Tétel szerkesztése' : 'Új tétel', state: st, render,
    onInput: (k, s, rr, el) => {
      if (k === 'payee' && s.type !== 'transfer' && (!s.categoryId || s.autoCat)) {
        const sug = suggestCategory(s.payee, s.type);
        if (sug && sug !== s.categoryId) { s.categoryId = sug; s.autoCat = true; const pos = el.selectionStart; rr(); const ni = f.body.querySelector('[data-k="payee"]'); ni.focus(); ni.setSelectionRange(pos, pos); }
      }
      if (k === 'accountId' || k === 'toAccountId' || k === 'repeat') rr();
      if (k === 'amount' && /[+\-*/]/.test(s.amount)) { const el2 = f.body.querySelector('.amount-input + div'); if (el2) { const v = parseAmount(s.amount); el2.textContent = curOf(s.accountId) + (isNaN(v) ? '' : ' · = ' + money(v, curOf(s.accountId))); } }
    },
    on: {
      type: (el, s, rr) => { s.type = el.dataset.v; s.categoryId = ''; s.split = false; rr(); },
      cat: (el, s, rr) => { s.categoryId = el.dataset.id; s.autoCat = false; rr(); },
      toggleSplit: (el, s, rr) => { s.split = !s.split; if (s.split && s.categoryId && !s.splits[0].categoryId) { s.splits[0].categoryId = s.categoryId; s.splits[0].amount = s.amount; } rr(); },
      addSplit: (el, s, rr) => { s.splits.push({ categoryId: '', amount: '' }); rr(); },
      delSplit: (el, s, rr) => { s.splits.splice(+el.dataset.i, 1); if (!s.splits.length) s.splits.push({ categoryId: '', amount: '' }); rr(); },
      del: async (el, s) => { if (await confirmDialog('Biztosan törlöd ezt a tételt?', 'Törlés')) { S.txs = S.txs.filter(x => x.id !== s.id); save(); rerenderView(); toast('Tétel törölve'); } },
      dup: (el, s) => { const src = S.txs.find(x => x.id === s.id); closeModal(); txForm(null, {}); prefillTx(src); toast('Másolat – mai dátummal'); },
      save: (el, s) => {
        const amount = parseAmount(s.amount);
        if (!(amount > 0)) return toast('Adj meg egy pozitív összeget');
        if (!s.accountId) return toast('Válassz számlát');
        const tx = { type: s.type, amount, accountId: s.accountId, date: s.date || today(), payee: s.payee.trim(), note: s.note.trim(),
          tags: s.tags.split(',').map(x => x.trim().replace(/^#/, '')).filter(Boolean) };
        if (s.type === 'transfer') {
          if (!s.toAccountId || s.toAccountId === s.accountId) return toast('Válassz cél számlát');
          tx.toAccountId = s.toAccountId; tx.categoryId = null;
          if (curOf(s.toAccountId) !== curOf(s.accountId)) { const ta = parseAmount(s.toAmount); tx.toAmount = ta > 0 ? ta : round2(amount * rate(curOf(s.accountId)) / rate(curOf(s.toAccountId))); }
        } else if (s.split && s.type === 'expense') {
          const parts = s.splits.map(p => ({ categoryId: p.categoryId, amount: parseAmount(p.amount) })).filter(p => p.amount > 0);
          if (parts.some(p => !p.categoryId)) return toast('Minden sorhoz válassz kategóriát');
          const sum = round2(parts.reduce((x, p) => x + p.amount, 0));
          if (Math.abs(sum - amount) > 0.01) return toast(`A felosztás (${money(sum, curOf(s.accountId))}) nem egyezik az összeggel`);
          tx.splits = parts; tx.categoryId = parts[0].categoryId;
        } else {
          if (!s.categoryId) return toast('Válassz kategóriát');
          tx.categoryId = s.categoryId;
        }
        localStorage.setItem('kassza_lastAcc', s.accountId);
        if (s.id) { const i = S.txs.findIndex(x => x.id === s.id); const old = S.txs[i]; S.txs[i] = { ...old, ...tx, splits: tx.splits || undefined }; sortTxs(); }
        else {
          addTx(tx);
          if (s.repeat) {
            const d = parseISO(tx.date);
            S.recurring.push({ id: uid(), name: tx.payee || (cat(tx.categoryId) || {}).name || 'Ismétlődő', type: tx.type, amount, accountId: tx.accountId, toAccountId: tx.toAccountId || null,
              categoryId: tx.categoryId, freq: s.freq, interval: 1, anchorDay: d.getDate(), next: addPeriod(tx.date, s.freq, 1, d.getDate()), auto: true, sub: false, tags: tx.tags });
          }
        }
        afterSave(s.id ? 'Mentve' : 'Tétel rögzítve ✔');
      },
    },
  });
  // split row inputs
  f.body.addEventListener('input', e => {
    const el = e.target; if (el.dataset.split == null) return;
    st.splits[+el.dataset.split][el.dataset.sk] = el.value;
    const amt = parseAmount(st.amount), sum = st.splits.reduce((x, p) => x + (parseAmount(p.amount) || 0), 0);
    const info = f.body.querySelector('.split-row ~ .row span');
    if (info) { info.textContent = `Felosztva: ${money(sum, curOf(st.accountId))} / ${money(amt || 0, curOf(st.accountId))}`; info.className = Math.abs((amt || 0) - sum) < 0.01 ? 'pos' : 'neg'; }
  });
  window.__txForm = { st, f };
}
function prefillTx(src) {
  const F = window.__txForm; if (!F || !src) return;
  Object.assign(F.st, { type: src.type, amount: String(src.amount), accountId: src.accountId, toAccountId: src.toAccountId || '', categoryId: src.categoryId || '',
    payee: src.payee || '', note: src.note || '', tags: (src.tags || []).join(', '), date: today(), split: !!(src.splits && src.splits.length),
    splits: src.splits ? src.splits.map(x => ({ categoryId: x.categoryId, amount: String(x.amount) })) : F.st.splits, autoCat: false });
  F.f.rerender();
}

/* =========================== ACCOUNTS =========================== */
function accountForm(existing) {
  const st = existing ? { ...existing, start: String(existing.start || 0) } : { name: '', type: 'bank', currency: S.settings.currency, start: '', archived: false };
  formModal({
    title: existing ? 'Számla szerkesztése' : 'Új számla', state: st,
    render: s => `<label class="field"><span>Név</span><input class="input" data-k="name" value="${esc(s.name)}" placeholder="pl. OTP folyószámla" autofocus></label>
      <div class="two"><label class="field"><span>Típus</span><select class="input" data-k="type">${Object.entries(ACCOUNT_TYPES).map(([v, i]) => `<option value="${v}" ${s.type === v ? 'selected' : ''}>${i.emoji} ${i.name}</option>`).join('')}</select></label>
      <label class="field"><span>Pénznem</span><select class="input" data-k="currency">${CURRENCIES.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
      <label class="field"><span>Kezdő egyenleg ${s.type === 'card' || s.type === 'loan' ? '(tartozásnál negatív, pl. -50000)' : ''}</span><input class="input num" inputmode="decimal" data-k="start" value="${esc(s.start)}" placeholder="0"></label>
      ${existing ? `<label class="row small" style="margin-bottom:8px"><input type="checkbox" data-k="archived" ${s.archived ? 'checked' : ''}> Archivált (elrejtve a listákból)</label>` : ''}
      <p class="small muted">💡 A befektetési és hitel számlák beleszámítanak a nettó vagyonba, de nem a költségvetésbe kiosztható pénzbe.</p>
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      save: (el, s) => {
        if (!s.name.trim()) return toast('Adj nevet a számlának');
        const start = s.start === '' ? 0 : parseAmount(s.start); if (isNaN(start)) return toast('Hibás kezdő egyenleg');
        const data = { name: s.name.trim(), type: s.type, currency: s.currency, start, archived: !!s.archived };
        if (existing) Object.assign(acc(existing.id), data); else S.accounts.push({ id: uid(), ...data });
        afterSave('Számla mentve');
      },
      del: async () => {
        const n = S.txs.filter(t => t.accountId === existing.id || t.toAccountId === existing.id).length;
        if (!(await confirmDialog(n ? `Ehhez a számlához ${n} tétel tartozik, ezek is törlődnek. Inkább archiváld! Biztosan törlöd?` : 'Biztosan törlöd a számlát?', 'Törlés'))) return;
        S.accounts = S.accounts.filter(a => a.id !== existing.id);
        S.txs = S.txs.filter(t => t.accountId !== existing.id && t.toAccountId !== existing.id);
        save(); navigate('accounts', null, true); toast('Számla törölve');
      },
    },
  });
}
async function reconcileForm(id) {
  const a = acc(id), cur = balances()[id] || 0;
  const r = await amountDialog('Egyenleg egyeztetése', `Mennyi a valódi egyenleg most? (a Kassza szerint: ${money(cur, a.currency)})`, { initial: String(round2(cur)), cur: a.currency });
  if (!r) return;
  const diff = round2(r.amount - cur);
  if (Math.abs(diff) < 0.005) return toast('Egyezik, nincs teendő ✔');
  addTx({ type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff), accountId: id, date: today(), payee: 'Egyenleg korrekció', note: 'Egyeztetés', tags: [],
    categoryId: diff > 0 ? (incomeCats().find(c => c.name === 'Egyéb bevétel') || incomeCats()[0] || {}).id : (expenseCats().find(c => c.name === 'Egyéb') || expenseCats()[0] || {}).id });
  save(); rerenderView(); toast(`Korrekció rögzítve: ${money(diff, a.currency, true)}`);
}

/* =========================== GOALS =========================== */
function goalForm(existing) {
  const st = existing ? { ...existing, target: String(existing.target) } : { name: '', emoji: '🎯', target: '', date: '', start: '' };
  const emojis = ['🎯', '🏖️', '✈️', '🚗', '🏠', '📱', '💻', '🎓', '💍', '👶', '🛟', '🎮', '🚲', '🐶', '🎁', '💰'];
  formModal({
    title: existing ? 'Cél szerkesztése' : 'Új megtakarítási cél', state: st,
    render: s => `<label class="field"><span>Mire gyűjtesz?</span><input class="input" data-k="name" value="${esc(s.name)}" placeholder="pl. Nyaralás" autofocus></label>
      <div class="field"><span>Ikon</span><div class="row wrap" style="gap:6px">${emojis.map(e => `<button class="cat-pick ${s.emoji === e ? 'on' : ''}" style="width:44px;padding:6px" data-f="emoji" data-v="${e}"><b style="margin:0">${e}</b></button>`).join('')}</div></div>
      <div class="two"><label class="field"><span>Célösszeg (${S.settings.currency})</span><input class="input num" inputmode="decimal" data-k="target" value="${esc(s.target)}"></label>
      <label class="field"><span>Határidő (nem kötelező)</span><input class="input" type="date" data-k="date" value="${s.date || ''}"></label></div>
      ${!existing ? `<label class="field"><span>Már félretett összeg</span><input class="input num" inputmode="decimal" data-k="start" value="${esc(s.start)}" placeholder="0"></label>` : ''}
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      emoji: (el, s, rr) => { s.emoji = el.dataset.v; rr(); },
      save: (el, s) => {
        const target = parseAmount(s.target); if (!s.name.trim() || !(target > 0)) return toast('Adj meg nevet és célösszeget');
        if (existing) Object.assign(S.goals.find(g => g.id === existing.id), { name: s.name.trim(), emoji: s.emoji, target, date: s.date || null });
        else { const st0 = parseAmount(s.start) || 0; S.goals.push({ id: uid(), name: s.name.trim(), emoji: s.emoji, target, date: s.date || null, history: st0 ? [{ date: today(), amount: st0 }] : [] }); }
        afterSave('Cél mentve 🎯');
      },
      del: async () => { if (await confirmDialog('Biztosan törlöd a célt?', 'Törlés')) { S.goals = S.goals.filter(g => g.id !== existing.id); save(); rerenderView(); } },
    },
  });
}
async function goalMove(id, dir) {
  const g = S.goals.find(x => x.id === id);
  const r = await amountDialog(dir > 0 ? `Befizetés: ${g.name}` : `Kivét: ${g.name}`, 'Összeg', { cur: S.settings.currency });
  if (!r) return;
  g.history = g.history || []; g.history.push({ date: r.date, amount: dir * Math.abs(r.amount) });
  save(); rerenderView();
  toast(goalSaved(g) >= g.target ? '🎉 Gratulálok, elérted a célt!' : 'Mentve');
}

/* =========================== RECURRING =========================== */
function recurringForm(existing, prefill) {
  const firstAcc = (activeAccounts()[0] || {}).id;
  const st = existing ? { ...existing, amount: String(existing.amount), interval: String(existing.interval || 1), end: existing.end || '' }
    : { name: '', type: 'expense', amount: '', accountId: firstAcc, toAccountId: '', categoryId: '', freq: 'monthly', interval: '1', next: today(), end: '', auto: true, sub: false, paused: false };
  if (!existing && prefill) Object.assign(st, prefill);
  formModal({
    title: existing ? 'Ismétlődő tétel' : 'Új ismétlődő tétel', state: st,
    render: s => `<div class="seg exp">${[['expense', 'Kiadás'], ['income', 'Bevétel'], ['transfer', 'Átvezetés']].map(([v, l]) => `<button data-f="type" data-v="${v}" class="${s.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="field"><span>Megnevezés</span><input class="input" data-k="name" value="${esc(s.name)}" placeholder="pl. Albérlet, Netflix, Fizetés" autofocus></label>
      <div class="two"><label class="field"><span>Összeg</span><input class="input num" inputmode="decimal" data-k="amount" value="${esc(s.amount)}"></label>
      <label class="field"><span>${s.type === 'transfer' ? 'Honnan' : 'Számla'}</span><select class="input" data-k="accountId">${accOptions(s.accountId)}</select></label></div>
      ${s.type === 'transfer' ? `<label class="field"><span>Hová</span><select class="input" data-k="toAccountId"><option value="">– Válassz –</option>${accOptions(s.toAccountId)}</select></label>`
        : `<label class="field"><span>Kategória</span><select class="input" data-k="categoryId">${catOptions(s.type === 'income' ? 'income' : 'expense', s.categoryId)}</select></label>`}
      <div class="two"><label class="field"><span>Gyakoriság</span><select class="input" data-k="freq">${Object.entries(FREQS).map(([v, l]) => `<option value="${v}" ${s.freq === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Minden hányadik</span><input class="input num" inputmode="numeric" data-k="interval" value="${esc(s.interval)}"></label></div>
      <div class="two"><label class="field"><span>Következő esedékesség</span><input class="input" type="date" data-k="next" value="${s.next}"></label>
      <label class="field"><span>Vége (nem kötelező)</span><input class="input" type="date" data-k="end" value="${s.end || ''}"></label></div>
      <label class="row small" style="margin-bottom:6px"><input type="checkbox" data-k="auto" ${s.auto ? 'checked' : ''}> Automatikus rögzítés esedékességkor (különben csak emlékeztet)</label>
      ${s.type === 'expense' ? `<label class="row small" style="margin-bottom:6px"><input type="checkbox" data-k="sub" ${s.sub ? 'checked' : ''}> Ez egy előfizetés (Netflix, Spotify, edzőterem…)</label>` : ''}
      ${existing ? `<label class="row small" style="margin-bottom:6px"><input type="checkbox" data-k="paused" ${s.paused ? 'checked' : ''}> Szüneteltetve</label>` : ''}
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    onInput: (k, s, rr) => { if (k === 'type') rr(); },
    on: {
      type: (el, s, rr) => { s.type = el.dataset.v; s.categoryId = ''; rr(); },
      save: (el, s) => {
        const amount = parseAmount(s.amount), interval = Math.max(1, parseInt(s.interval) || 1);
        if (!s.name.trim() || !(amount > 0)) return toast('Adj meg nevet és összeget');
        if (s.type === 'transfer' && (!s.toAccountId || s.toAccountId === s.accountId)) return toast('Válassz cél számlát');
        if (s.type !== 'transfer' && !s.categoryId) return toast('Válassz kategóriát');
        const data = { name: s.name.trim(), type: s.type, amount, accountId: s.accountId, toAccountId: s.type === 'transfer' ? s.toAccountId : null,
          categoryId: s.type === 'transfer' ? null : s.categoryId, freq: s.freq, interval, next: s.next || today(), anchorDay: parseISO(s.next || today()).getDate(),
          end: s.end || null, auto: !!s.auto, sub: s.type === 'expense' && !!s.sub, paused: !!s.paused };
        if (existing) Object.assign(S.recurring.find(r => r.id === existing.id), data); else S.recurring.push({ id: uid(), ...data });
        const n = processRecurring();
        afterSave(n ? `Mentve · ${n} esedékes tétel rögzítve` : 'Mentve');
      },
      del: async () => { if (await confirmDialog('Törlöd az ismétlődő tételt? (A már rögzített tételek megmaradnak.)', 'Törlés')) { S.recurring = S.recurring.filter(r => r.id !== existing.id); save(); rerenderView(); } },
    },
  });
}
function postRecurring(id) {
  const r = S.recurring.find(x => x.id === id); if (!r) return;
  txFromRecurring(r, r.next); r.next = addPeriod(r.next, r.freq, r.interval, r.anchorDay);
  save(); rerenderView(); toast(`${r.name} rögzítve ✔`);
}
function skipRecurring(id) {
  const r = S.recurring.find(x => x.id === id); if (!r) return;
  r.next = addPeriod(r.next, r.freq, r.interval, r.anchorDay); save(); rerenderView(); toast('Kihagyva');
}

/* =========================== DEBTS =========================== */
function debtForm(existing) {
  const st = existing ? { ...existing, amount: String(existing.amount), due: existing.due || '' } : { person: '', direction: 'lent', amount: '', date: today(), due: '', note: '' };
  formModal({
    title: existing ? 'Kölcsön szerkesztése' : 'Új kölcsön / tartozás', state: st,
    render: s => `<div class="seg">${[['lent', '📤 Én adtam kölcsön'], ['borrowed', '📥 Én kaptam kölcsön']].map(([v, l]) => `<button data-f="dir" data-v="${v}" class="${s.direction === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label class="field"><span>Ki?</span><input class="input" data-k="person" value="${esc(s.person)}" placeholder="pl. Péter" autofocus></label>
      <div class="two"><label class="field"><span>Összeg (${S.settings.currency})</span><input class="input num" inputmode="decimal" data-k="amount" value="${esc(s.amount)}"></label>
      <label class="field"><span>Dátum</span><input class="input" type="date" data-k="date" value="${s.date}"></label></div>
      <div class="two"><label class="field"><span>Határidő</span><input class="input" type="date" data-k="due" value="${s.due || ''}"></label>
      <label class="field"><span>Megjegyzés</span><input class="input" data-k="note" value="${esc(s.note || '')}"></label></div>
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      dir: (el, s, rr) => { s.direction = el.dataset.v; rr(); },
      save: (el, s) => {
        const amount = parseAmount(s.amount); if (!s.person.trim() || !(amount > 0)) return toast('Add meg, ki és mennyi');
        const data = { person: s.person.trim(), direction: s.direction, amount, date: s.date || today(), due: s.due || null, note: s.note || '' };
        if (existing) Object.assign(S.debts.find(d => d.id === existing.id), data); else S.debts.push({ id: uid(), ...data, payments: [], settled: false });
        afterSave('Mentve');
      },
      del: async () => { if (await confirmDialog('Biztosan törlöd?', 'Törlés')) { S.debts = S.debts.filter(d => d.id !== existing.id); save(); rerenderView(); } },
    },
  });
}
async function debtPay(id) {
  const d = S.debts.find(x => x.id === id);
  const r = await amountDialog(`Részlet: ${d.person}`, `Visszafizetett összeg (még ${money(debtLeft(d))})`, { withDate: true });
  if (!r) return;
  d.payments.push({ date: r.date, amount: Math.abs(r.amount) });
  if (debtLeft(d) <= 0.005) d.settled = true;
  save(); rerenderView(); toast(d.settled ? 'Teljesen rendezve 🎉' : 'Részlet rögzítve');
}

/* =========================== CATEGORIES / GROUPS / RULES =========================== */
const EMOJIS = '🏠💡🛒🚗📱🛡️💊🍔🧽👕💇📺🧸🎬✈️🎁📚🐾🏋️📦💼💵🎉📈↩️➕☕🍕🍺🚌🚕⛽🅿️🏥🦷👓💄🧴🎮🎵🎨⚽🏊🎓🖥️💻📷🧾💳🏦🐷🔧🪴🛠️🧺🍼🎂💐🚬🍷🎟️🏨🗺️⛷️🎣🧘💈🚿🔥💧🌐🎧'.match(/\p{Extended_Pictographic}(️)?/gu);
function categoryForm(existing, groupId) {
  const st = existing ? { ...existing, target: existing.target ? String(existing.target) : '' } : { name: '', emoji: '📦', groupId: groupId || (S.groups.find(g => !g.income) || {}).id, kind: 'expense', target: '', color: S.categories.length % 8 };
  if (!existing && grp(st.groupId) && grp(st.groupId).income) st.kind = 'income';
  formModal({
    title: existing ? 'Kategória' : 'Új kategória', state: st,
    render: s => `<label class="field"><span>Név</span><input class="input" data-k="name" value="${esc(s.name)}" autofocus></label>
      <div class="field"><span>Ikon</span><div class="cat-grid" style="grid-template-columns:repeat(auto-fill,minmax(40px,1fr));max-height:150px">${EMOJIS.map(e => `<button class="cat-pick ${s.emoji === e ? 'on' : ''}" style="padding:5px" data-f="emoji" data-v="${e}"><b style="margin:0">${e}</b></button>`).join('')}</div></div>
      <div class="field"><span>Szín (a grafikonokon)</span><div class="row wrap" style="gap:8px">${SERIES.map((c, i) => `<button data-f="color" data-v="${i}" aria-label="${i + 1}. szín" style="width:32px;height:32px;border-radius:50%;background:${c};border:3px solid ${s.color == i ? 'var(--text)' : 'transparent'}"></button>`).join('')}</div></div>
      <div class="two"><label class="field"><span>Csoport</span><select class="input" data-k="groupId">${S.groups.map(g => `<option value="${g.id}" ${g.id === s.groupId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Típus</span><select class="input" data-k="kind"><option value="expense" ${s.kind === 'expense' ? 'selected' : ''}>Kiadás</option><option value="income" ${s.kind === 'income' ? 'selected' : ''}>Bevétel</option></select></label></div>
      ${s.kind === 'expense' ? `<label class="field"><span>Havi cél / keret (nem kötelező)</span><input class="input num" inputmode="decimal" data-k="target" value="${esc(s.target)}" placeholder="pl. 90000"></label>` : ''}
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    onInput: (k, s, rr) => { if (k === 'kind') rr(); },
    on: {
      emoji: (el, s, rr) => { s.emoji = el.dataset.v; rr(); },
      color: (el, s, rr) => { s.color = +el.dataset.v; rr(); },
      save: (el, s) => {
        if (!s.name.trim()) return toast('Adj nevet a kategóriának');
        const data = { name: s.name.trim(), emoji: s.emoji, groupId: s.groupId, kind: s.kind, color: +s.color, target: s.kind === 'expense' ? (parseAmount(s.target) || 0) : 0 };
        if (existing) Object.assign(cat(existing.id), data); else S.categories.push({ id: uid(), ...data });
        afterSave('Kategória mentve');
      },
      del: async () => {
        const n = S.txs.filter(t => txParts(t).some(p => p.categoryId === existing.id)).length;
        const others = S.categories.filter(c => c.id !== existing.id && c.kind === existing.kind);
        if (n && !others.length) return toast('Ez az utolsó ilyen típusú kategória');
        if (!n) { if (!(await confirmDialog('Törlöd a kategóriát?', 'Törlés'))) return; S.categories = S.categories.filter(c => c.id !== existing.id); save(); rerenderView(); return; }
        const body = openModal('Kategória törlése', `<p>${n} tétel tartozik ide. Melyik kategóriába kerüljenek át?</p>
          <select class="input" id="mvCat">${others.map(c => `<option value="${c.id}">${c.emoji} ${esc(c.name)}</option>`).join('')}</select>
          <div class="btns"><button class="btn" data-c="0">Mégse</button><button class="btn danger" data-c="1">Áthelyezés és törlés</button></div>`);
        body.addEventListener('click', e => {
          const b = e.target.closest('[data-c]'); if (!b) return;
          if (b.dataset.c === '1') {
            const to = body.querySelector('#mvCat').value;
            for (const t of S.txs) { if (t.categoryId === existing.id) t.categoryId = to; (t.splits || []).forEach(p => { if (p.categoryId === existing.id) p.categoryId = to; }); }
            for (const r of S.recurring) if (r.categoryId === existing.id) r.categoryId = to;
            for (const m in S.budget) if (S.budget[m][existing.id]) { S.budget[m][to] = (S.budget[m][to] || 0) + S.budget[m][existing.id]; delete S.budget[m][existing.id]; }
            S.categories = S.categories.filter(c => c.id !== existing.id); save(); toast('Kategória törölve');
          }
          closeModal(); rerenderView();
        });
      },
    },
  });
}
function groupForm(existing) {
  const st = existing ? { ...existing } : { name: '', income: false };
  formModal({
    title: existing ? 'Csoport' : 'Új csoport', state: st,
    render: s => `<label class="field"><span>Név</span><input class="input" data-k="name" value="${esc(s.name)}" autofocus></label>
      ${!existing ? `<label class="row small"><input type="checkbox" data-k="income" ${s.income ? 'checked' : ''}> Bevétel csoport</label>` : ''}
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      save: (el, s) => {
        if (!s.name.trim()) return toast('Adj nevet');
        if (existing) grp(existing.id).name = s.name.trim(); else S.groups.push({ id: uid(), name: s.name.trim(), income: !!s.income });
        afterSave('Mentve');
      },
      del: async () => {
        if (S.categories.some(c => c.groupId === existing.id)) return toast('Előbb helyezd át vagy töröld a csoport kategóriáit');
        if (await confirmDialog('Törlöd a csoportot?', 'Törlés')) { S.groups = S.groups.filter(g => g.id !== existing.id); save(); rerenderView(); }
      },
    },
  });
}
function ruleForm(existing) {
  const st = existing ? { ...existing } : { text: '', categoryId: '' };
  formModal({
    title: existing ? 'Szabály' : 'Új szabály', state: st,
    render: s => `<label class="field"><span>Ha a partner neve tartalmazza…</span><input class="input" data-k="text" value="${esc(s.text)}" placeholder="pl. spar" autofocus></label>
      <label class="field"><span>…akkor a kategória</span><select class="input" data-k="categoryId">${catOptions('all', s.categoryId)}</select></label>
      <div class="btns">${existing ? '<button class="btn danger" data-f="del">Törlés</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      save: (el, s) => {
        if (!s.text.trim() || !s.categoryId) return toast('Töltsd ki mindkét mezőt');
        if (existing) Object.assign(S.rules.find(r => r.id === existing.id), { text: s.text.trim(), categoryId: s.categoryId });
        else S.rules.push({ id: uid(), text: s.text.trim(), categoryId: s.categoryId });
        afterSave('Szabály mentve');
      },
      del: () => { S.rules = S.rules.filter(r => r.id !== existing.id); afterSave('Törölve'); },
    },
  });
}
function applyRulesToUncategorized() {
  let n = 0;
  for (const t of S.txs) {
    if (t.type === 'transfer' || !t.payee) continue;
    const c = cat(t.categoryId);
    if (c && !['Egyéb', 'Egyéb bevétel'].includes(c.name)) continue;
    const p = t.payee.toLowerCase();
    const r = S.rules.find(r => p.includes(r.text.toLowerCase()) && cat(r.categoryId) && cat(r.categoryId).kind === (t.type === 'income' ? 'income' : 'expense'));
    if (r && r.categoryId !== t.categoryId) { t.categoryId = r.categoryId; n++; }
  }
  save(); rerenderView(); toast(n ? `${n} tétel átkategorizálva` : 'Nem volt mit módosítani');
}

/* =========================== AUTO ASSIGN =========================== */
function autoAssignForm(m) {
  const st = { mode: 'lastAssigned', onlyEmpty: true };
  const modes = [
    ['lastAssigned', '📋 Múlt havi kiosztás másolása'], ['lastSpent', '🧾 Múlt havi költés alapján'], ['avg3', '📊 3 havi átlagköltés alapján'],
    ['targets', '🎯 Kategória havi céljai alapján'], ['cover', '🩹 Túlköltések fedezése (negatív borítékok nullázása)'], ['clear', '🗑️ E havi kiosztás törlése'],
  ];
  formModal({
    title: 'Automatikus kiosztás – ' + fmtMonth(m), state: st,
    render: s => `<div class="list">${modes.map(([v, l]) => `<label class="item" style="cursor:pointer"><input type="radio" name="aa" data-k="mode" value="${v}" ${s.mode === v ? 'checked' : ''}><span class="grow">${l}</span></label>`).join('')}</div>
      ${!['clear', 'cover'].includes(s.mode) ? `<label class="row small" style="margin-top:10px"><input type="checkbox" data-k="onlyEmpty" ${s.onlyEmpty ? 'checked' : ''}> Csak az üres borítékokat töltse ki</label>` : ''}
      <div class="btns"><button class="btn primary" data-f="go">Alkalmazás</button></div>`,
    onInput: (k, s, rr) => { if (k === 'mode') rr(); },
    on: {
      go: (el, s) => {
        const prev = addMonthsYm(m, -1), agg = monthAgg(), b = budgetMonth(m); let n = 0;
        S.budget[m] = S.budget[m] || {};
        for (const c of expenseCats()) {
          const curA = S.budget[m][c.id] || 0;
          if (s.mode === 'clear') { if (curA) { delete S.budget[m][c.id]; n++; } continue; }
          if (s.mode === 'cover') { const r = b.rows[c.id]; if (r && r.available < 0) { setAssigned(m, c.id, curA - r.available); n++; } continue; }
          if (s.onlyEmpty && curA) continue;
          let v = 0;
          if (s.mode === 'lastAssigned') v = (S.budget[prev] || {})[c.id] || 0;
          else if (s.mode === 'lastSpent') v = (agg[prev] || { spend: {} }).spend[c.id] || 0;
          else if (s.mode === 'avg3') { for (let k = 1; k <= 3; k++) v += ((agg[addMonthsYm(m, -k)] || { spend: {} }).spend[c.id] || 0); v /= 3; }
          else if (s.mode === 'targets') v = c.target || 0;
          v = S.settings.currency === 'HUF' ? Math.round(v / 100) * 100 : round2(v);
          if (v > 0) { setAssigned(m, c.id, v); n++; }
        }
        afterSave(n ? `${n} boríték frissítve` : 'Nem volt mit kiosztani');
      },
    },
  });
}

/* =========================== PIN =========================== */
function pinForm() {
  const st = { a: '', b: '' };
  formModal({
    title: 'PIN kód beállítása', state: st,
    render: s => `<label class="field"><span>Új PIN (4 számjegy)</span><input class="input num" type="password" inputmode="numeric" maxlength="4" data-k="a" value="${esc(s.a)}" autofocus></label>
      <label class="field"><span>PIN még egyszer</span><input class="input num" type="password" inputmode="numeric" maxlength="4" data-k="b" value="${esc(s.b)}"></label>
      <p class="small muted">⚠️ Ha elfelejted a PIN-t, csak az adatok törlésével lehet feloldani. Készíts biztonsági mentést!</p>
      <div class="btns"><button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      save: async (el, s) => {
        if (!/^\d{4}$/.test(s.a)) return toast('4 számjegyet adj meg');
        if (s.a !== s.b) return toast('A két PIN nem egyezik');
        S.settings.pin = await hashPin(s.a); afterSave('PIN beállítva 🔒');
      },
    },
  });
}

/* =========================== CSV IMPORT =========================== */
async function csvImport() {
  // CSV or Excel; Revolut statements are recognised automatically and get the one-tap importer
  importStatementFile(await pickFileBuffer());
}
function csvImportFromText(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return toast('Nem találtam adatot a fájlban');
  const head = rows[0], data = rows.slice(1);
  const guess = re => Math.max(0, head.findIndex(h => re.test(h)));
  const st = {
    hasHeader: true, date: String(guess(/d[aá]tum|date|könyvel/i)), amount: String(guess(/összeg|amount|érték/i)), out: '-1',
    payee: String(guess(/partner|kedvezm|megnevez|leír|közlem|payee|descr|name/i)), note: '-1',
    accountId: (activeAccounts()[0] || {}).id, invert: false, skipDup: true,
  };
  const cols = () => (st.hasHeader ? head : head.map((_, i) => `${i + 1}. oszlop`));
  const opt = (k, allowNone) => (allowNone ? `<option value="-1" ${st[k] === '-1' ? 'selected' : ''}>– nincs –</option>` : '') + cols().map((h, i) => `<option value="${i}" ${st[k] === String(i) ? 'selected' : ''}>${esc(h || `${i + 1}. oszlop`)}</option>`).join('');
  const build = () => {
    const src = st.hasHeader ? data : rows, out = [];
    for (const r of src) {
      const date = parseAnyDate(r[+st.date]); if (!date) continue;
      let v = parseBankAmount(r[+st.amount]);
      if (st.out !== '-1') { const o = parseBankAmount(r[+st.out]); if (!isNaN(o) && o) v = (isNaN(v) ? 0 : Math.abs(v)) - Math.abs(o); }
      if (isNaN(v) || !v) continue;
      if (st.invert) v = -v;
      const payee = st.payee !== '-1' ? (r[+st.payee] || '').trim() : '';
      const note = st.note !== '-1' ? (r[+st.note] || '').trim() : '';
      const type = v < 0 ? 'expense' : 'income';
      const fallback = type === 'expense' ? (expenseCats().find(c => c.name === 'Egyéb') || expenseCats()[0]) : (incomeCats().find(c => c.name === 'Egyéb bevétel') || incomeCats()[0]);
      out.push({ date, type, amount: Math.abs(round2(v)), accountId: st.accountId, payee: payee.slice(0, 80), note: note.slice(0, 120), tags: ['import'], categoryId: suggestCategory(payee, type) || (fallback || {}).id });
    }
    return out;
  };
  formModal({
    title: 'Banki CSV importálása', state: st,
    render: s => {
      const preview = build();
      return `<p class="small muted">${data.length} sor a fájlban. Válaszd ki, melyik oszlop mit jelent.</p>
      <label class="row small" style="margin-bottom:8px"><input type="checkbox" data-k="hasHeader" ${s.hasHeader ? 'checked' : ''}> Az első sor fejléc</label>
      <div class="two"><label class="field"><span>Dátum</span><select class="input" data-k="date">${opt('date')}</select></label>
        <label class="field"><span>Összeg (+ bevétel / − kiadás)</span><select class="input" data-k="amount">${opt('amount')}</select></label></div>
      <div class="two"><label class="field"><span>Terhelés külön oszlopban?</span><select class="input" data-k="out">${opt('out', true)}</select></label>
        <label class="field"><span>Partner / leírás</span><select class="input" data-k="payee">${opt('payee', true)}</select></label></div>
      <div class="two"><label class="field"><span>Megjegyzés</span><select class="input" data-k="note">${opt('note', true)}</select></label>
        <label class="field"><span>Melyik számlára?</span><select class="input" data-k="accountId">${accOptions(s.accountId)}</select></label></div>
      <label class="row small"><input type="checkbox" data-k="invert" ${s.invert ? 'checked' : ''}> Előjel megfordítása (ha a kiadások pozitívak)</label>
      <label class="row small" style="margin:6px 0 10px"><input type="checkbox" data-k="skipDup" ${s.skipDup ? 'checked' : ''}> Már meglévő tételek kihagyása (azonos dátum + összeg + partner)</label>
      <h3>Előnézet (${preview.length} érvényes tétel)</h3>
      <ul class="list small">${preview.slice(0, 5).map(t => `<li class="item"><span class="grow ellipsis">${t.date} · ${esc(t.payee || '–')}<br><span class="muted">${esc((cat(t.categoryId) || {}).name || '')}</span></span><b class="num ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount, (acc(t.accountId) || {}).currency)}</b></li>`).join('') || '<li class="empty">Nincs érvényes sor – ellenőrizd az oszlopokat.</li>'}</ul>
      <div class="btns"><button class="btn primary" data-f="go" ${preview.length ? '' : 'disabled'}>Importálás</button></div>`;
    },
    onInput: (k, s, rr) => rr(),
    on: {
      go: () => {
        const list = build(); let n = 0, skipped = 0;
        for (const t of list) {
          if (st.skipDup && S.txs.some(x => x.date === t.date && Math.abs(x.amount - t.amount) < 0.01 && x.accountId === t.accountId && (x.payee || '') === t.payee)) { skipped++; continue; }
          addTx(t); n++;
        }
        afterSave(`${n} tétel importálva${skipped ? `, ${skipped} duplikátum kihagyva` : ''}`);
      },
    },
  });
}

/* =========================== BACKUP / RESTORE =========================== */
function backup() {
  downloadFile(`kassza-mentes-${today()}.json`, JSON.stringify({ app: 'kassza', exported: new Date().toISOString(), data: S }, null, 1), 'application/json');
  localStorage.setItem('kassza_lastBackup', today());
  toast('Mentés elkészült 💾');
}
async function restore() {
  const text = await pickFile('.json,application/json');
  if (!text) return;
  let obj; try { obj = JSON.parse(text); } catch { return toast('Ez nem érvényes mentés fájl'); }
  const d = obj && obj.app === 'kassza' ? obj.data : obj;
  if (!d || !Array.isArray(d.txs) || !Array.isArray(d.accounts)) return toast('Ez nem Kassza mentés');
  if (!(await confirmDialog(`Visszaállítod a mentést (${d.txs.length} tétel, ${d.accounts.length} számla)? A jelenlegi adatok felülíródnak.`, 'Visszaállítás'))) return;
  replaceData(d); applyTheme(); navigate('home', null, true); toast('Visszaállítva ✔');
}
