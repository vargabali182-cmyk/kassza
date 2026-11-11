'use strict';
/* =====================================================================
   Kassza – AI offer finder ("Ajánlatkereső"). Opt-in, online only.
   Sends an anonymised spending summary to Claude (Anthropic API, the
   user's own key), which searches the web for current discounts in the
   user's bank apps, better card / account packages and merchant programs.
   ===================================================================== */

const AI_KEY_LS = 'kassza_ai_key';           // kept apart from the data, never exported in backups
const AI_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
const AI_MODEL = 'claude-opus-5-5';
// USD list prices used only for the on-screen cost estimate
const AI_PRICE = { inPerM: 4, outPerM: 20, perSearch: 0.01 };
const HU_BANKS = ['OTP Bank', 'K&H Bank', 'Erste Bank', 'MBH Bank', 'Raiffeisen Bank', 'UniCredit Bank', 'CIB Bank', 'Gránit Bank', 'Magnet Bank', 'Revolut', 'Wise', 'N26', 'Bunq'];
const OFFER_ICON = { bank_discount: '🏦', better_card: '💳', merchant_program: '🏷️', subscription: '📺', other: '💡' };
const CONF_TXT = { high: 'biztos', medium: 'valószínű', low: 'ellenőrizd' };
let aiRunning = false;

const getAiKey = () => { try { return localStorage.getItem(AI_KEY_LS) || ''; } catch { return ''; } };
const setAiKey = k => { try { k ? localStorage.setItem(AI_KEY_LS, k) : localStorage.removeItem(AI_KEY_LS); } catch {} };
const aiReady = () => !!getAiKey() && !!S.settings.aiConsent;

/* ---------- what gets sent: aggregates only, no account numbers, no people ---------- */
function spendingProfile() {
  const agg = monthAgg(), m = thisYm();
  let months = [1, 2, 3].map(k => addMonthsYm(m, -k)).filter(k => agg[k] && agg[k].expense > 0);
  const partial = !months.length; // new user: use the current month only
  if (partial) months = [m];
  const span = partial ? Math.max(0.3, new Date().getDate() / 30) : months.length;
  const cats = {}; let inc = 0, exp = 0;
  for (const k of months) {
    const a = agg[k] || { income: 0, expense: 0, spend: {} };
    inc += a.income; exp += a.expense;
    for (const c in a.spend) cats[c] = (cats[c] || 0) + a.spend[c];
  }
  const from = months[months.length - 1] + '-01', to = partial ? addDays(today(), 1) : m + '-01';
  const merch = {}, foreign = {};
  for (const t of S.txs) {
    if (t.type !== 'expense' || t.date < from || t.date >= to) continue;
    const c = cat(t.categoryId), cur = txCurrency(t), v = toMain(t.amount, cur);
    if (cur !== S.settings.currency) foreign[cur] = (foreign[cur] || 0) + v;
    if (!c || !t.payee || ['Egyéb', 'Lakhatás', 'Ajándék'].includes(c.name)) continue;
    if (/^(to |from |átutalás|utalás|kártya törlesztés)/i.test(t.payee)) continue; // transfers to people
    const k = normPayee(t.payee);
    const e = merch[k] || (merch[k] = { merchant: t.payee.slice(0, 40), category: c.name, total: 0, n: 0 });
    e.total += v; e.n++;
  }
  return {
    country: 'HU', currency: S.settings.currency, today: today(),
    my_banks_and_cards: (S.settings.banks || []).filter(b => b.bank).map(b => ({ bank: b.bank, package_or_card: b.product || 'nem tudom' })),
    months_analyzed: Math.round(span * 10) / 10,
    avg_monthly_income: Math.round(inc / span), avg_monthly_spending: Math.round(exp / span),
    spending_per_month_by_category: Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([id, v]) => ({ category: (cat(id) || {}).name || 'egyéb', amount: Math.round(v / span) })),
    top_merchants_per_month: Object.values(merch).sort((a, b) => b.total - a.total).slice(0, 20)
      .map(x => ({ merchant: x.merchant, category: x.category, amount: Math.round(x.total / span), purchases: Math.round(x.n / span * 10) / 10 })),
    foreign_currency_spending_per_month: Object.entries(foreign).map(([c, v]) => ({ currency: c, amount_in_main_currency: Math.round(v / span) })),
    subscriptions: S.recurring.filter(r => r.sub && !r.paused).map(r => ({ name: r.name, per_month: Math.round(monthlyCost(r)) })),
  };
}

const AI_TASK = `Te a Kassza költségkövető app ajánlatkeresője vagy. Egy magyar felhasználó anonimizált költési összesítőjét kapod.
Webes kereséssel keress MOST ÉRVÉNYES, konkrét lehetőségeket, amelyekkel a meglévő költései mellett pénzt spórolhat:
1. kedvezmények a SAJÁT bankjai appjában vagy kedvezményprogramjában azoknál a kereskedőknél, ahol költ (pl. OTP Kedvezményprogram, K&H, Erste, MBH, Revolut ajánlatai);
2. megéri-e a jelenlegi számlacsomagja és fizetős előfizetése (pl. Revolut Plus/Premium/Metal) a tényleges használat alapján, vagy olcsóbb/jobb csomag kellene – számold ki a havi díjat és a valóban kihasznált előnyöket;
3. jobb bankkártya vagy számlacsomag a költései alapján (cashback, devizaváltási díj, ATM, utasbiztosítás, extrák) – a díjakat levonva számold a várható havi nettó előnyt a jelenlegi csomagjához képest; vedd figyelembe a korhatáros csomagokat (junior, diák, start), és jelezd, ha hamarosan váltani kell;
4. kereskedői hűségprogramok és appok a gyakori vásárlásaihoz (pl. kávézók, áruházláncok, benzinkutak, ételrendelés);
5. olcsóbb előfizetési csomagok (éves, családi, diák), ha van előfizetése.
Szabályok:
- Minden ajánlathoz adj forrást (source_urls), a bank vagy kereskedő hivatalos oldala az elsődleges. Ne találj ki ajánlatot, százalékot vagy díjat.
- Ha az infó nem friss vagy nem egyértelmű, confidence = "low". Ha nem tudod a lejáratot, valid_until = null.
- A megtakarítást a megadott havi összegekből számold, és a detail mezőben egy mondatban írd le a számítást.
- Ne ajánlj hitelt, befektetést, biztosítási terméket önmagában, kriptót vagy szerencsejátékot.
- Legfeljebb 8 ajánlat, a legnagyobb várható havi megtakarítás elöl. Ami nem hoz érdemi előnyt, azt hagyd ki.
- Minden szöveg magyarul, tömören.`;
const AI_SYSTEM = AI_TASK + '\nA végén pontosan egyszer hívd meg a report_offers eszközt az eredménnyel.';

const REPORT_TOOL = {
  name: 'report_offers',
  description: 'Az ajánlatkeresés végeredménye, amit az app megjelenít a felhasználónak.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['summary', 'offers'],
    properties: {
      summary: { type: 'string', description: '1-2 mondatos összefoglaló magyarul.' },
      offers: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['kind', 'title', 'detail', 'provider', 'merchant', 'estimated_monthly_saving', 'confidence', 'action', 'source_urls', 'valid_until'],
          properties: {
            kind: { type: 'string', enum: ['bank_discount', 'better_card', 'merchant_program', 'subscription', 'other'] },
            title: { type: 'string' },
            detail: { type: 'string', description: 'Mi az ajánlat és hogyan jött ki a megtakarítás.' },
            provider: { type: 'string', description: 'Bank vagy cég neve.' },
            merchant: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            estimated_monthly_saving: { type: 'number', description: 'Becsült havi megtakarítás a felhasználó fő pénznemében.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            action: { type: 'string', description: 'Mit tegyen a felhasználó, egy mondatban.' },
            source_urls: { type: 'array', items: { type: 'string' } },
            valid_until: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
    },
  },
};

/* ---------- the request ---------- */
async function runOfferSearch({ silent = false } = {}) {
  if (aiRunning) return;
  const key = getAiKey();
  if (!key || !S.settings.aiConsent) { if (!silent) aiSetupForm(); return; }
  if (!navigator.onLine) { if (!silent) toast('Ehhez internet kell 📶'); return; }
  aiRunning = true; if (!silent) rerenderView();
  const profile = spendingProfile();
  const usage = { input: 0, output: 0, searches: 0 };
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(AI_SDK_URL));
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    let messages = [{ role: 'user', content: `Mai dátum: ${today()}.\nA felhasználó költési összesítője (JSON):\n${JSON.stringify(profile, null, 1)}` }];
    let result = null;
    for (let round = 0; round < 5 && !result; round++) {
      // Server-side fallback is on: if Claude Opus 5.5 declines, the API retries on a fallback model in the same call.
      const res = await client.beta.messages.create({
        model: AI_MODEL, max_tokens: 16000, system: AI_SYSTEM,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'HU', timezone: 'Europe/Budapest' } }, REPORT_TOOL],
        messages,
      });
      const u = res.usage || {};
      usage.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      usage.output += u.output_tokens || 0;
      usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
      if (res.stop_reason === 'refusal') throw new Error('A modell ezt a kérést nem vállalta.');
      const call = res.content.find(b => b.type === 'tool_use' && b.name === 'report_offers');
      if (call) { result = call.input; break; }
      messages = [...messages, { role: 'assistant', content: res.content }];
      if (res.stop_reason === 'pause_turn') continue; // server-side search loop paused – resend to resume
      messages.push({ role: 'user', content: 'Kérlek, add vissza az eredményt a report_offers eszközzel.' });
    }
    if (!result) throw new Error('Nem érkezett eredmény.');
    const offers = (Array.isArray(result.offers) ? result.offers : []).slice(0, 10);
    const cost = usage.input / 1e6 * AI_PRICE.inPerM + usage.output / 1e6 * AI_PRICE.outPerM + usage.searches * AI_PRICE.perSearch;
    S.aiOffers = { date: new Date().toISOString(), summary: String(result.summary || ''), offers, usage, cost, seen: false };
    save();
    toast(offers.length ? `🔎 ${offers.length} új ajánlatot találtam` : 'Most nem találtam jobb ajánlatot');
  } catch (e) {
    let msg = 'Hiba az ajánlatkeresésnél: ' + (e && e.message ? e.message : e);
    if (Anthropic && e instanceof Anthropic.AuthenticationError) msg = 'Hibás vagy lejárt API kulcs. Ellenőrizd a beállításokban.';
    else if (Anthropic && e instanceof Anthropic.PermissionDeniedError) msg = 'Az API kulcsnak nincs jogosultsága (vagy elfogyott a keret).';
    else if (Anthropic && e instanceof Anthropic.RateLimitError) msg = 'Túl sok kérés – próbáld újra pár perc múlva.';
    else if (Anthropic && e instanceof Anthropic.APIConnectionError) msg = 'Nem érem el a szervert – nézd meg a netet.';
    else if (!Anthropic) msg = 'Nem sikerült betölteni az AI modult (kell hozzá internet).';
    S.aiLastError = { date: new Date().toISOString(), msg }; save();
    if (!silent) toast(msg);
  } finally {
    aiRunning = false; rerenderView();
  }
}

/* ---------- automatic weekly run on Wi-Fi ---------- */
function onWifiLike() {
  const c = navigator.connection;
  if (c && c.saveData) return false;
  if (c && c.type) return c.type === 'wifi' || c.type === 'ethernet';
  return true; // the browser does not tell (e.g. iPhone) – the user opted in
}
function maybeAutoOffers() {
  if (!S.settings.aiAuto || !aiReady() || !navigator.onLine || !onWifiLike() || aiRunning) return;
  const last = S.aiOffers && S.aiOffers.date ? new Date(S.aiOffers.date) : null;
  const lastTry = S.aiLastError && S.aiLastError.date ? new Date(S.aiLastError.date) : null;
  const days = d => d ? (Date.now() - d) / 864e5 : Infinity;
  if (days(last) < 7 || days(lastTry) < 1) return;
  if (S.txs.length < 10) return;
  runOfferSearch({ silent: true });
}
window.addEventListener('online', () => setTimeout(maybeAutoOffers, 3000));

/* ---------- UI ---------- */
function safeUrl(u) { return /^https?:\/\//i.test(String(u || '')) ? String(u) : null; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }
function offerHtml(o) {
  const urls = (o.source_urls || []).map(safeUrl).filter(Boolean).slice(0, 3);
  return `<li class="ins ${o.confidence === 'low' ? 'info' : 'tip'}"><div class="ins-ico">${OFFER_ICON[o.kind] || '💡'}</div><div class="grow">
    <div class="ins-t">${esc(o.title)}</div>
    <div class="small muted">${esc(o.provider)}${o.merchant ? ' · ' + esc(o.merchant) : ''}${o.valid_until ? ' · ' + esc(o.valid_until) + '-ig' : ''}</div>
    <div class="ins-x" style="margin-top:4px">${esc(o.detail)}</div>
    ${o.action ? `<div class="ins-x" style="margin-top:4px">👉 ${esc(o.action)}</div>` : ''}
    <div class="row wrap" style="margin-top:6px;gap:6px">${o.estimated_monthly_saving > 0 ? `<span class="chip good">💰 ~${money(o.estimated_monthly_saving)}/hó</span>` : ''}
      <span class="chip ${o.confidence === 'high' ? 'good' : o.confidence === 'low' ? 'warn' : ''}">${CONF_TXT[o.confidence] || ''}</span>
      ${urls.map(u => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(hostOf(u))}</a>`).join('')}</div></div></li>`;
}
/* ---------- claude.ai mode: uses the user's own Claude subscription (Pro/Max), no API key ---------- */
const CLAUDE_URL_LIMIT = 12000; // claude.ai prefills up to ~14 000 characters from ?q=

function buildClaudePrompt() {
  return `${AI_TASK}
- Először röviden, közérthetően írd le a felhasználónak magyarul, mit találtál, és mit érdemes tennie.
- A válasz legvégére tegyél egy \`\`\`json kódblokkot ezzel a szerkezettel, hogy vissza tudjam másolni a Kassza appba:
{"summary": "1-2 mondat", "offers": [{"kind": "bank_discount|better_card|merchant_program|subscription|other", "title": "", "detail": "", "provider": "", "merchant": null, "estimated_monthly_saving": 0, "confidence": "high|medium|low", "action": "", "source_urls": [""], "valid_until": null}]}

Mai dátum: ${today()}. Használd a webes keresést. A költési összesítőm (JSON, havi átlagok, ${S.settings.currency}):
${JSON.stringify(spendingProfile())}`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    ta.remove(); return ok;
  }
}

async function openInClaude() {
  const prompt = buildClaudePrompt();
  const copied = await copyText(prompt);
  const url = prompt.length <= CLAUDE_URL_LIMIT ? 'https://claude.ai/new?q=' + encodeURIComponent(prompt) : 'https://claude.ai/new';
  window.open(url, '_blank', 'noopener');
  S.settings.lastClaudeReview = today(); save();
  return copied;
}

const banksEditorHtml = s => `<div class="field"><span>Bankjaid és csomagjaid (minél pontosabb, annál jobb az ajánlás)</span>
  ${s.banks.map((b, i) => `<div class="split-row" style="grid-template-columns:1fr 1fr 34px">
    <input class="input" list="bankList" placeholder="Bank (pl. OTP Bank)" data-bank="${i}" data-bk="bank" value="${esc(b.bank)}">
    <input class="input" list="pkgList" placeholder="Csomag (pl. Junior Számla)" data-bank="${i}" data-bk="product" value="${esc(b.product)}">
    <button class="btn sm" data-f="delBank" data-i="${i}" aria-label="Sor törlése">✕</button></div>`).join('')}
  <datalist id="bankList">${HU_BANKS.map(b => `<option value="${esc(b)}">`).join('')}</datalist>
  <datalist id="pkgList">${['Standard', 'Plus', 'Premium', 'Metal', 'Ultra', 'Junior Számla', 'Diákszámla', 'Start Számla'].map(p => `<option value="${p}">`).join('')}</datalist>
  <button class="link" data-f="addBank">＋ Bank hozzáadása</button></div>`;
const bankHandlers = {
  addBank: (el, s, rr) => { s.banks.push({ bank: '', product: '' }); rr(); },
  delBank: (el, s, rr) => { s.banks.splice(+el.dataset.i, 1); if (!s.banks.length) s.banks.push({ bank: '', product: '' }); rr(); },
};
function bindBankInputs(body, st) {
  body.addEventListener('input', e => {
    const el = e.target; if (el.dataset.bank == null) return;
    st.banks[+el.dataset.bank][el.dataset.bk] = el.value;
  });
}
const cleanBanks = banks => banks.filter(b => b.bank.trim()).map(b => ({ bank: b.bank.trim(), product: b.product.trim() }));
const initialBanks = () => (S.settings.banks && S.settings.banks.length ? clone(S.settings.banks) : [{ bank: '', product: '' }]);

function claudeReviewForm() {
  const st = { banks: initialBanks(), preview: false, opened: false, copied: false };
  const f = formModal({
    title: 'Átnézetem a Claude-dal', state: st,
    render: s => `
      <p class="small" style="line-height:1.5;margin-top:0">A Kassza összeállítja a kérdést a költéseid alapján, és megnyitja a <b>Claude</b>-ot (appot vagy claude.ai-t). Ott csak elküldöd – a <b>Pro előfizetésedbe</b> beletartozik, külön nem fizetsz. A Claude a weben megnézi a bankjaid aktuális kedvezményeit és csomagjait, és megmondja, mivel járnál jobban.</p>
      ${banksEditorHtml(s)}
      <div class="card" style="background:var(--surface-2);box-shadow:none">
        <b class="small">🔒 Mit küldök el?</b>
        <p class="tiny muted" style="margin:4px 0">Csak összesítést: havi összegek kategóriánként, a 20 leggyakoribb bolt havi költése, előfizetések, a bankjaid és csomagjaid neve. <b>Nem</b> küldök számlaszámot, egyenleget, magánszemélyeknek küldött utalást vagy egyedi tételeket. Te látod és te küldöd el a Claude-ban.</p>
        <button class="link" data-f="preview">${s.preview ? 'Elrejtés' : 'Mutasd pontosan'}</button>
        ${s.preview ? `<pre class="tiny" style="white-space:pre-wrap;max-height:220px;overflow:auto;background:var(--surface);padding:8px;border-radius:8px">${esc(buildClaudePrompt())}</pre>` : ''}
      </div>
      ${s.opened ? `<div class="save-box" style="text-align:left"><b>✔ Megnyitottam a Claude-ot.</b><div class="small" style="margin-top:4px">1. Ha a kérdés nincs beírva, illeszd be (${s.copied ? 'már a vágólapon van' : 'másold ki a fenti „Mutasd pontosan” részből'}).<br>2. Kapcsold be a <b>webes keresést</b> a Claude-ban, ha nincs bekapcsolva, és küldd el.<br>3. Ha kész, a válasz végén lévő JSON-t másold ide vissza a „Claude válaszának beillesztése” gombbal – így az ajánlatok itt is megmaradnak.</div></div>` : ''}
      <div class="btns"><button class="btn" data-f="paste">📋 Claude válaszának beillesztése</button><button class="btn primary" data-f="open">🤖 Megnyitás a Claude-ban</button></div>`,
    on: {
      ...bankHandlers,
      preview: (el, s, rr) => { S.settings.banks = cleanBanks(s.banks); s.preview = !s.preview; rr(); },
      open: async (el, s, rr) => {
        S.settings.banks = cleanBanks(s.banks);
        if (!S.settings.banks.length) return toast('Add meg legalább egy bankodat');
        s.copied = await openInClaude(); s.opened = true; rr();
      },
      paste: (el, s) => { S.settings.banks = cleanBanks(s.banks); save(); closeModal(); pasteResultForm(); },
    },
  });
  bindBankInputs(f.body, st);
}

/** Pulls the JSON block out of Claude's answer and stores it as the latest offers. */
function parseClaudeResult(text) {
  const t = String(text || '');
  const fenced = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]);
  const candidates = fenced.length ? fenced.reverse() : [t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)];
  for (const c of candidates) {
    try {
      const o = JSON.parse(c.trim());
      if (!o || !Array.isArray(o.offers)) continue;
      const str = v => (v == null ? '' : String(v)).slice(0, 600);
      const offers = o.offers.slice(0, 10).map(x => ({
        kind: ['bank_discount', 'better_card', 'merchant_program', 'subscription', 'other'].includes(x.kind) ? x.kind : 'other',
        title: str(x.title) || 'Ajánlat', detail: str(x.detail), provider: str(x.provider), merchant: x.merchant ? str(x.merchant) : null,
        estimated_monthly_saving: Number(x.estimated_monthly_saving) > 0 ? Number(x.estimated_monthly_saving) : 0,
        confidence: ['high', 'medium', 'low'].includes(x.confidence) ? x.confidence : 'medium',
        action: str(x.action), source_urls: Array.isArray(x.source_urls) ? x.source_urls.map(String).slice(0, 5) : [],
        valid_until: x.valid_until ? str(x.valid_until).slice(0, 20) : null,
      }));
      return { summary: str(o.summary), offers };
    } catch { /* try next block */ }
  }
  return null;
}
function pasteResultForm() {
  const st = { text: '' };
  formModal({
    title: 'Claude válaszának beillesztése', state: st,
    render: s => `<p class="small muted" style="margin-top:0">Másold ki a Claude teljes válaszát (vagy csak a végén lévő JSON részt), és illeszd be ide.</p>
      <textarea class="input" rows="8" data-k="text" placeholder="Beillesztés ide…" autofocus>${esc(s.text)}</textarea>
      <div class="btns"><button class="btn primary" data-f="go">Beolvasás</button></div>`,
    on: {
      go: (el, s) => {
        const r = parseClaudeResult(s.text);
        if (!r) return toast('Nem találtam benne a JSON részt – a válasz végén lévő ```json blokkot másold be');
        S.aiOffers = { date: new Date().toISOString(), summary: r.summary, offers: r.offers, usage: null, cost: 0, source: 'claude.ai' };
        S.settings.lastClaudeReview = today();
        afterSave(`${r.offers.length} ajánlat beolvasva ✔`);
        navigate('reports');
      },
    },
  });
}

/* ---------- weekly reminder when on Wi-Fi ---------- */
function reviewDue() {
  if (S.settings.reviewRemind === false || S.settings.reviewSnooze === today() || S.txs.length < 10 || !navigator.onLine || !onWifiLike()) return false;
  const last = S.settings.lastClaudeReview || (S.aiOffers && S.aiOffers.date ? S.aiOffers.date.slice(0, 10) : null);
  return !last || (parseISO(today()) - parseISO(last.slice(0, 10))) / 864e5 >= 7;
}
function reviewBanner() {
  if (!reviewDue()) return '';
  return `<div class="card" style="border-color:var(--brand)"><div class="row"><div style="font-size:26px">📶</div>
    <div class="grow"><b>Wi-Fi-n vagy – jöhet a heti átnézés?</b><div class="small muted">A Claude megnézi, van-e jobb csomag, kártya vagy kedvezmény a költéseidhez.</div></div></div>
    <div class="btns"><button class="btn sm" data-act="reviewLater">Most nem</button><button class="btn sm primary" data-act="aiClaude">🤖 Átnézés</button></div></div>`;
}

/* ---------- UI ---------- */
function offersCard() {
  const r = S.aiOffers;
  const apiOn = !!getAiKey() && !!S.settings.aiConsent;
  const total = r ? r.offers.reduce((s, o) => s + (o.estimated_monthly_saving > 0 && o.confidence !== 'low' ? o.estimated_monthly_saving : 0), 0) : 0;
  return `<div class="card"><div class="card-head"><h2>🔎 Jobb csomag, kártya, kedvezmény</h2></div>
    ${!r && !aiRunning ? `<p class="small muted" style="line-height:1.5">A Claude átnézi, mire és hol költesz, és megkeresi a weben a <b>saját bankod appjában elérhető kedvezményeket</b>, hogy <b>megéri-e a mostani csomagod és előfizetésed</b>, és van-e <b>jobb kártya vagy számla</b> a költéseidhez. A Claude Pro előfizetéseddel működik, külön nem fizetsz érte.</p>` : ''}
    ${aiRunning ? '<div class="empty"><div class="big">⏳</div>Keresem az ajánlatokat a weben… ez 1–3 perc.</div>' : ''}
    ${!aiRunning && r ? `<p style="margin:0 0 8px;line-height:1.5">${esc(r.summary)}</p>
      ${total > 0 ? `<div class="save-box"><div class="small">Becsült megtakarítás ezekkel</div><div class="v num">~${money(total)}/hó</div></div>` : ''}
      ${r.offers.length ? `<ul class="list ins-list">${r.offers.map(offerHtml).join('')}</ul>` : '<div class="empty small">Most nem találtam a mostaninál jobb ajánlatot.</div>'}
      <p class="tiny muted">Frissítve: ${esc(fmtDate(r.date.slice(0, 10)))}${r.source === 'claude.ai' ? ' · Claude-dal (Pro)' : r.usage ? ` · ${r.usage.searches} webes keresés · kb. ${r.cost.toFixed(2)} USD` : ''}. Döntés előtt ellenőrizd a forrásokat.</p>` : ''}
    ${!aiRunning && apiOn && S.aiLastError && (!r || S.aiLastError.date > r.date) ? `<p class="small neg">${esc(S.aiLastError.msg)}</p>` : ''}
    <div class="btns"><button class="btn" data-act="aiPaste">📋 Válasz beillesztése</button><button class="btn primary" data-act="aiClaude" ${aiRunning ? 'disabled' : ''}>🤖 Átnézetem a Claude-dal</button></div>
    ${apiOn ? `<div class="btns"><button class="btn sm" data-act="aiRun" ${aiRunning ? 'disabled' : ''}>⚡ Automatikus keresés (API)</button></div>` : ''}
    <p class="tiny muted" style="margin-top:8px">Hetente emlékeztetlek, amikor Wi-Fi-n megnyitod az appot. <button class="link tiny" data-act="aiSetup">Haladó: teljesen automatikus mód saját API kulccsal</button></p></div>`;
}

function aiSetupForm() {
  const st = { key: getAiKey(), auto: S.settings.aiAuto !== false, consent: !!S.settings.aiConsent, preview: false, banks: initialBanks() };
  const f = formModal({
    title: 'Haladó: automatikus mód (API)', state: st,
    render: s => `
      <p class="small muted" style="margin-top:0;line-height:1.5">Ebben a módban a Kassza magától keres, gombnyomás nélkül. Ehhez <b>nem a Claude Pro előfizetés</b> kell, hanem egy külön, használat alapján fizetős Anthropic API kulcs (keresésenként kb. 0,3–0,6 USD). Ha a Pro-d elég, erre nincs szükség.</p>
      ${banksEditorHtml(s)}
      <label class="field"><span>Anthropic API kulcs</span><input class="input" type="password" autocomplete="off" data-k="key" value="${esc(s.key)}" placeholder="sk-ant-…"></label>
      <p class="tiny muted" style="margin-top:-6px">A console.anthropic.com oldalon kapsz kulcsot. Állíts be ott havi költési limitet. A kulcs csak ezen az eszközön van, a mentésekbe nem kerül bele.</p>
      <label class="row small" style="margin:8px 0"><input type="checkbox" data-k="auto" ${s.auto ? 'checked' : ''}> Hetente automatikusan, amikor Wi-Fi-n megnyitom az appot</label>
      <div class="card" style="background:var(--surface-2);box-shadow:none">
        <b class="small">🔒 Mit küldök el?</b>
        <p class="tiny muted" style="margin:4px 0">Ugyanazt az összesítést, mint a Claude-os átnézésnél – egyedi tételek, számlaszám és egyenleg nélkül –, az Anthropic API-nak.</p>
        <button class="link" data-f="preview">${s.preview ? 'Elrejtés' : 'Mutasd pontosan'}</button>
        ${s.preview ? `<pre class="tiny" style="white-space:pre-wrap;max-height:220px;overflow:auto;background:var(--surface);padding:8px;border-radius:8px">${esc(JSON.stringify(spendingProfile(), null, 1))}</pre>` : ''}
      </div>
      <label class="row small" style="margin:10px 0"><input type="checkbox" data-k="consent" ${s.consent ? 'checked' : ''}> Engedélyezem, hogy ezt az összesítést elküldje az Anthropicnak</label>
      <div class="btns">${getAiKey() ? '<button class="btn danger" data-f="off">Kikapcsolás</button>' : ''}<button class="btn primary" data-f="save">Mentés</button></div>`,
    on: {
      ...bankHandlers,
      preview: (el, s, rr) => { S.settings.banks = cleanBanks(s.banks); s.preview = !s.preview; rr(); },
      off: () => { setAiKey(''); S.settings.aiConsent = false; afterSave('Automatikus mód kikapcsolva'); },
      save: (el, s) => {
        const key = s.key.trim();
        if (key && !/^sk-ant-/.test(key)) return toast('Ez nem tűnik Anthropic API kulcsnak (sk-ant-…)');
        if (key && !s.consent) return toast('Pipáld be az engedélyt, különben nem tudok keresni');
        setAiKey(key);
        S.settings.banks = cleanBanks(s.banks);
        S.settings.aiAuto = !!s.auto; S.settings.aiConsent = !!s.consent && !!key;
        afterSave(key ? 'Mentve' : 'Mentve');
      },
    },
  });
  bindBankInputs(f.body, st);
}
