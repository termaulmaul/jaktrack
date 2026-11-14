// The page: every train of Greater Tokyo on a calm map, the sheet (phones) / pane (desktop), its screens and history,
// fed by the packs `npm run data` builds from Mini Tokyo 3D's dataset. Positions are timetable positions: every screen
// with trains says "Scheduled" (live data, when switched on, marks its own trains). Three languages (i18n.js). No
// analytics.
//
// The feature modules come in through `tokyo:optional` (web/build.mjs): each is a lazy chunk, and a module that does not
// build is null at runtime, so the page uses its own small fallback instead of failing (docs/ARCHITECTURE.md).
//
// Routes: #s=<stationId>  #t=<runKey>  #l=<lineId>  #route[=from:<id>|to:<id>]  #about  #tab=lines|stations
//         (?lang=en|ja|id overrides the language until the switch in About is used)
// Debug / tests: window.__tokyo = { ready(), stats(), sample(), map, open(type, id), setLang(l), set3d(on), labels(),
//     live, i18n(), sheet(detent), state }

// Opened from https://user:password@host/ the document keeps the credentials and every relative fetch() is refused
// ("URL includes credentials"): go to the same address without them (the browser keeps the login).
if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(document.URL)) location.replace(location.origin + location.pathname + location.search + location.hash);

import '../../styles/app.css';
import { createSheet } from '../app/sheet.js';
import { $, $$, icon, setUiText, toast } from '../app/ui.js';
import { esc, isLight } from '../app/format.js';
import * as I from './i18n.js';
import css from './styles.js';
import { load as LOAD, has as HAS } from 'tokyo:optional';
import { mountResetButton } from './reset.js';   // the card's Reset view button
import { MAP_FONT } from './config.js';
import trainArt from './art/train.svg';
import nightArt from './art/night.svg';

// the app's art: the loop with a train (About button, loading card, empty states) and the night after the last train
const ART = { anker: trainArt, tidur: nightArt };
const HOME_KEY = 'tokyo.mystation';
const BUS_KEY = 'tokyo.buses';   // '0' = the user switched the bus layer off (it is on by default when the bus pack is there)
const REFRESH_MS = 15000;
// desktop = the docked pane: wide screens, and phones held sideways (styles.js mirrors the pane CSS for that query)
const desktopMQ = matchMedia('(min-width: 900px), (min-width: 640px) and (max-height: 500px) and (orientation: landscape)');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const isDesktop = () => desktopMQ.matches;
const reduceMotion = () => reduceMQ.matches;
const app = $('#app');
const viewEl = $('#view');
const qInput = $('#q');
const { t, tn } = I;
const nm = (o) => I.title(o);

{ const el = document.createElement('style'); el.id = 'tokyo-css'; el.textContent = css; document.head.append(el); }
for (const img of $$('.round.oyen img, .lcard .lart')) img.src = trainArt;

const readHome = () => { try { return localStorage.getItem(HOME_KEY) || null; } catch { return null; } };
const writeHome = (id) => { try { if (id) localStorage.setItem(HOME_KEY, id); else localStorage.removeItem(HOME_KEY); } catch { /* storage blocked: this visit only */ } };

const S = {
  tab: 'home', stack: [], q: '', home: readHome(), near: null,
  model: null, runs: null, ix: null, source: null, loadError: false, calendar: null,
  tm: null, map: null, mapReady: false, mapFailed: false, layer: null, network: null, city3d: null, on3D: false, live: null,
  sim: null, errors: [], nearState: { st: 'idle', list: null },
  tv: { home: null, tvAll: false, following: false, follow: null, canFollow: false },   // train-view.js's screen state
};
// the page's ONE clock. Live = Date.now; in playback a virtual clock (playback.js). Every
// service-time read goes through NOW; live data only reaches the views while the clock is live.
const NOW = () => (S.pb ? S.pb.now() : Date.now());
const liveOn = () => (!S.pb || S.pb.isLive() ? S.live : null);

// ------------------------------------------------------------------ lane modules (lazy, optional)
const MODS = {};
// A chunk that is gone (this page is older than the build or release on the server: a dev rebuild, a phone tab kept
// open across releases) fails the dynamic import: forget the failure (a later use retries)
// and reload ONCE to get the new build (sessionStorage stamp: never a loop; the hash keeps the screen); else a toast.
const CHUNK_GONE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i;
function chunkGone(key) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // offline (subway): retried later, no reload
  let last = 0;
  try { last = Number(sessionStorage.getItem('tokyo.reloaded')) || 0; } catch { last = Date.now(); }
  if (Date.now() - last > 120000) {
    try { sessionStorage.setItem('tokyo.reloaded', String(Date.now())); } catch { /* storage blocked: no reload (could loop) */ }
    try { if (Number(sessionStorage.getItem('tokyo.reloaded')) > last) { location.reload(); return; } } catch { /* fall through */ }
  }
  try { toast(t('update.reload')); } catch { /* fine */ }
  console.warn(`[tokyo] ${key}: the page is older than the build`);
}
function mod(key) {
  if (!(key in MODS)) {
    const f = LOAD[key];
    MODS[key] = f ? f().catch((e) => {
      console.warn(`[tokyo] module ${key} did not load`, e); S.errors.push(`${key}: ${e?.message || e}`);
      delete MODS[key];   // a later need() tries again
      if (CHUNK_GONE.test(String(e?.message || e))) chunkGone(key);
      return null;
    }) : Promise.resolve(null);
  }
  return MODS[key];
}
const loaded = {};   // key -> the module once it resolved (sync access in render)
async function need(key) { const m = await mod(key); loaded[key] = m; return m; }

/** The service day turned (03:00 WIB) since the runs were loaded; never under a playback (Back to now reloads). */
function dayTurned() {
  if (S.pb && !S.pb.isLive()) return false;
  const d = loaded.calendar?.serviceDate?.(Date.now());
  return !!(S.date && d && d !== S.date);
}
// A page hidden across 03:00 reloads ONCE when shown again, before anything else reacts to its return (registered
// first, it stops the other visibility listeners: no live / bus / timetable fetch started only to be aborted by the
// reload). it reloaded twice. Visible pages: checkDay every minute (below).
document.addEventListener('visibilitychange', (e) => {
  if (document.hidden || !dayTurned()) return;
  e.stopImmediatePropagation();
  location.reload();
});

// ------------------------------------------------------------------ service clock (WIB, the service day turns at 03:00)
/** Seconds since 00:00 WIB of the service day (after-midnight times are >= 86400; the day turns at 03:00). */
export function serviceSec(ms = NOW()) {
  const sim = loaded.model;
  if (sim?.serviceSeconds) { try { const v = sim.serviceSeconds(ms); if (Number.isFinite(v)) return Math.floor(v); } catch { /* fall back */ } }
  const s = Math.floor(ms / 1000) + 7 * 3600;
  const d = ((s % 86400) + 86400) % 86400;
  return d < 3 * 3600 ? d + 86400 : d;
}
const firstT = (r) => r.stops[0].d ?? r.stops[0].a;
const lastT = (r) => { const s = r.stops[r.stops.length - 1]; return s.a ?? s.d; };
const stopT = (st) => st.d ?? st.a;

// ------------------------------------------------------------------ data index (ids, lookups, what runs now)
function indexData(model, runs) {
  const stationIx = new Map(model.stations.map((s, i) => [s.id, i]));
  const lineIx = new Map(model.lines.map((l, i) => [l.id, i]));
  // runs by key AND by id (a tap on the map may name either); rebuilt when the model.js model grows (time buckets)
  let runByKey = new Map(), seenLen = -1;
  const keyMap = () => {
    if (seenLen !== runs.length) {
      runByKey = new Map();
      const sec = serviceSec();
      for (const r of runs) {
        runByKey.set(r.id, r);
        const had = runByKey.get(r.key);
        // the key names today's run of that train: the one running now, else the next, else the latest
        if (!had || (firstT(had) > sec && firstT(r) < firstT(had)) || (lastT(had) < sec && lastT(r) > lastT(had))) runByKey.set(r.key, r);
      }
      seenLen = runs.length;
      atStation.clear();
    }
    return runByKey;
  };
  const atStation = new Map();   // station index -> [{r, i}] (built on demand)
  const linesAt = (si) => {
    const s = model.stations[si];
    const sts = s && s.group >= 0 && model.groups[s.group] ? model.groups[s.group] : [si];
    return [...new Set(sts.map((x) => model.stations[x].line))].map((li) => model.lines[li]).filter(Boolean);
  };
  return {
    stationIx, lineIx, linesAt,
    get runByKey() { return keyMap(); },
    station: (id) => model.stations[stationIx.get(id)] || null,
    line: (id) => model.lines[lineIx.get(id)] || null,
    groupOf: (si) => { const s = model.stations[si]; return s && s.group >= 0 && model.groups[s.group] ? model.groups[s.group] : [si]; },
    stopsAt(si) {
      keyMap();
      if (atStation.has(si)) return atStation.get(si);
      const want = new Set(this.groupOf(si));
      const out = [];
      for (const r of runs) for (let i = 0; i < r.stops.length; i++) if (want.has(r.stops[i].s)) out.push({ r, i });
      atStation.set(si, out);
      return out;
    },
  };
}
function runningNow(ms = NOW()) {
  const runs = S.runs;
  if (!runs) return { total: 0, byLine: new Map() };
  const sim = loaded.model;
  if (sim?.running && S.sim) {
    try {
      const list = sim.running(S.sim, ms);
      if (Array.isArray(list)) {
        const byLine = new Map();
        for (const x of list) { const r = x.run || x; byLine.set(r.line, (byLine.get(r.line) || 0) + 1); }
        return { total: list.length, byLine };
      }
    } catch { /* fall back */ }
  }
  const sec = serviceSec(ms);
  const byLine = new Map();
  let total = 0;
  for (const r of runs) if (firstT(r) <= sec && sec <= lastT(r)) { total++; byLine.set(r.line, (byLine.get(r.line) || 0) + 1); }
  return { total, byLine };
}

// ------------------------------------------------------------------ screens and history
const KEYS = { station: 's', train: 't', line: 'l', route: 'route', bus: 'b' };
const top = () => S.stack[S.stack.length - 1] || null;
const screen = () => { const x = top(); return x ? { name: x.t, id: x.id } : { name: S.tab, id: null }; };
const hashOf = () => {
  const x = top();
  if (x) return x.t === 'about' ? '#about' : x.t === 'live' ? '#live' : x.t === 'route' && (!x.id || x.id === '1') ? '#route' : `#${KEYS[x.t]}=${encodeURIComponent(x.id)}`;
  return S.tab === 'home' ? '' : `#tab=${S.tab}`;
};
const stateOf = () => ({ tk: 1, tab: S.tab, stack: S.stack.slice() });
function fromHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const tab = ['lines', 'stations'].includes(h.get('tab')) ? h.get('tab') : 'home';
  const stack = [];
  if (h.has('about')) stack.push({ t: 'about', id: '1' });
  else if (h.has('live')) stack.push({ t: 'live', id: '1' });
  else if (h.has('route')) stack.push({ t: 'route', id: h.get('route') || '1' });
  else for (const [ty, k] of Object.entries(KEYS)) if (h.get(k)) { stack.push({ t: ty, id: h.get(k) }); break; }
  return { tab, stack };
}
const urlOf = () => `${location.pathname}${location.search}${hashOf()}`;

function open(type, id, { replace = false } = {}) {
  if (type === 'train' && id) id = S.sim?.runById?.get(id)?.key || S.ix?.runByKey.get(id)?.key || id;
  if (type === 'train' && S.on3D) { try { S.city3d?.setSelected?.(id); } catch { /* fine */ } }
  const cur = top();
  if (cur && cur.t === type && cur.id === id) return;
  const from = app.contains(document.activeElement) ? sigOf(document.activeElement) : '';   // refocused on Back
  if (replace && cur) S.stack[S.stack.length - 1] = { t: type, id, ...(cur.from ? { from: cur.from } : {}) };
  else S.stack.push({ t: type, id, ...(from ? { from } : {}) });
  if (S.stack.length > 12) S.stack.shift();
  history[replace ? 'replaceState' : 'pushState'](stateOf(), '', urlOf());
  show({ detent: isDesktop() ? null : type === 'about' || type === 'route' ? 'full' : sheet.detent === 'peek' ? 'half' : null });
}
function back() {
  if (S.stack.length) history.back();
  else goTab('home');
}
function goTab(tab) {
  const same = tab === S.tab && !S.stack.length;
  S.stack = [];
  S.tab = tab;
  if (!same) { S.q = ''; qInput.value = ''; $('#qx').hidden = true; }
  setPlaceholder();
  history.replaceState(stateOf(), '', urlOf());
  show({ detent: isDesktop() ? null : tab === 'home' ? null : sheet.detent === 'peek' ? 'half' : null });
}
function setPlaceholder() {
  const k = S.tab === 'stations' ? 'search.ph.stations' : 'search.ph';
  qInput.dataset.i18nPh = k; qInput.dataset.i18nAria = k;
  qInput.placeholder = t(k); qInput.setAttribute('aria-label', t(k));
}
addEventListener('popstate', (e) => {
  const st = e.state?.tk ? e.state : fromHash();
  const leaving = top(), was = S.stack.length;
  S.tab = st.tab || 'home';
  S.stack = (st.stack || []).slice();
  show();
  // Back puts keyboard focus on the control that opened the screen we left (when it is on screen again)
  if (leaving?.from && S.stack.length < was && (focusWasIn || document.activeElement === document.body)) {
    let el = null;
    try { el = document.querySelector(`#app ${leaving.from}`); } catch { el = null; }
    if (el) el.focus({ preventScroll: true });
  }
});
addEventListener('hashchange', () => {   // a hash typed or pasted by hand (QA, shared links)
  const h = fromHash();
  if (hashOf() === location.hash || (hashOf() === '' && !location.hash)) return;
  S.tab = h.tab; S.stack = h.stack;
  history.replaceState(stateOf(), '', urlOf());
  show({ detent: !isDesktop() && S.stack.length && sheet.detent === 'peek' ? 'half' : null });
});

let curKey = '';
let focusWasIn = false;   // keyboard / screen-reader focus was in the page's controls when the screen changed
function show({ detent = null } = {}) {
  const { name, id } = screen();
  app.dataset.screen = name;
  app.toggleAttribute('data-detail', S.stack.length > 0);
  setPlaceholder();
  for (const b of $$('[data-seg] [data-tab]')) { const on = b.dataset.tab === S.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }   // A9 roving tabindex
  const key = `${name}|${id ?? ''}`;
  const changed = key !== curKey;
  const ae = document.activeElement;
  focusWasIn = changed && !!ae && ae !== document.body && app.contains(ae) && !ae.closest('#map');
  if (changed) {
    curKey = key;
    viewEl.__html = '';
    $('#pbody').scrollTop = 0;
    if (!isDesktop()) updatePadding(name === 'station' || name === 'train' || name === 'line' || name === 'bus' ? 'half' : 'peek');
    focusMap();
    setupFollow(name, id);
    // the train / line screens' modules load at idle after ready; opened before that, they come now and
    // the screen (and the train's follow camera, on from the start as always) follows as soon as they are in
    if ((name === 'train' && !loaded.trainView) || (name === 'line' && !loaded.lineView)) {
      need(name === 'train' ? 'trainView' : 'lineView').then(() => {
        const sc = screen();
        if (sc.name !== name || sc.id !== id) return;
        if (name === 'train' && !S.tv.follow) setupFollow(name, id);
        viewEl.__html = ''; render();
      });
    }
    if (name !== 'route') closeRoute();
    if (name !== 'live') closeCov();
    if (name === 'station') ensureExits();
    exitsFocus(name, id);
    busFocus(name, id);
  }
  render();
  if (changed) wantScreen();   // the hours this screen needs (a station's whole day, a train's journey)
  if (detent && !isDesktop()) sheet.snap(detent);
  if (changed) {
    // a screen opened from a control: focus moves to its title (not <body>); the polite line names it
    const h = viewEl.querySelector('.ph h2, h2');
    if (focusWasIn && h && !document.activeElement?.closest?.('[data-seg]')) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
    // the main name only ("Tokyo", not "Tokyo東京": the other-script name sits in a lang span)
    const title = h ? [...h.childNodes].filter((n) => !(n.nodeType === 1 && (n.lang || n.classList?.contains('tk-alt')))).map((n) => n.textContent).join('').trim() || h.textContent.trim() : '';
    if (S.stack.length || name !== 'home') say(title);
    else sayCount();
  }
  chromeSync();   // the chrome may have changed (back button, sheet, pill)
}

/** train-view.js's follow camera: one controller while a train's screen is open (off until the button is tapped). */
function setupFollow(name, id) {
  if (S.tv.follow) { try { S.tv.follow.destroy?.(); } catch { /* fine */ } S.tv.follow = null; }
  S.tv.following = false; S.tv.tvAll = false;
  const tv = loaded.trainView;
  if (name !== 'train' || !S.map || !S.sim || typeof tv?.follow !== 'function' || typeof tv?.trainPos !== 'function') return;
  try {
    S.tv.follow = tv.follow(S.map, () => tv.trainPos(S.sim, id, NOW()), { start: true, reduceMotion, onChange: () => { viewEl.__html = ''; render(); } });
  } catch (e) { console.warn('[tokyo] follow', e); S.tv.follow = null; }
}

/** A focusable element's data-* signature ("button[data-station=…]"): finds the same control after a re-render. */
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
function sigOf(el) {
  if (!el || el === document.body || !el.attributes) return '';
  const sig = [...el.attributes].filter((x) => x.name.startsWith('data-') && x.name !== 'data-drag').map((x) => `[${x.name}="${CSS.escape(x.value)}"]`).join('');
  return sig ? `${el.tagName.toLowerCase()}${sig}` : el.id ? `#${CSS.escape(el.id)}` : '';
}
/** Replace the screen's HTML; keyboard focus stays on the same control (same data-* signature, else the same index:
 *  the 15 s / live refresh must not throw a keyboard or screen-reader user back to the top). */
function setView(html) {
  if (viewEl.__html === html) return;
  const a = document.activeElement, inView = a && a !== viewEl && viewEl.contains(a);
  const sig = inView ? sigOf(a) : '';
  const idx = inView ? [...viewEl.querySelectorAll(FOCUSABLE)].indexOf(a) : -1;
  viewEl.__html = html;
  viewEl.innerHTML = `<div class="view">${html}</div>`;
  if (!inView) return;
  if (a.tagName === 'H2') {   // the screen title keeps focus across a refresh, never the first control instead
    const h = viewEl.querySelector('.ph h2, h2');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); return; }
  }
  let el = null;
  try { el = sig ? viewEl.querySelector(sig) : null; } catch { el = null; }
  (el || viewEl.querySelectorAll(FOCUSABLE)[Math.max(0, idx)])?.focus({ preventScroll: true });
}

/** What lane views get: the data, the clock, the language, the markup helpers. */
function ctx() {
  return {
    model: S.model, runs: S.runs, sim: S.sim, ix: S.ix, now: NOW(), sec: serviceSec(), lang: I.lang(),
    t, tn, title: I.title, titleAlt: I.titleAlt, clock: I.clock, esc, icon, disc, home: S.home, isDesktop: isDesktop(),
    art: ART, open, map: S.map, tm: S.tm, layer: S.layer, calendar: S.calendar, playback: !!S.pb && !S.pb.isLive(), live: liveOn(),
    stationActs: ugStationAct,   // views.js puts it in the station's action row
    nearby: !!S.nearby,   // the picker card's pill starts nearby.js's "Trains near me" (views.js says so with t('nb.go'))
    liveN: liveCount(), liveOnly: liveOnlyOn(),   // the headline's live count + the Live chip (views.js)
    say,   // one polite announcement (a filter change, a result count); never per tick
    tj: S.busPack ? { on: !!S.busesOn, n: S.busesOn && S.buses?.on ? S.buses.stats().feed : null } : null,   // the home's TransJakarta row
    liveBus: !!S.busesOn, gsi: (() => { try { return S.city3d?.state?.()?.elev === 'elev2'; } catch { return false; } })(),   // credits for what is in use
  };
}
/** A lane view: (fn exists) -> its HTML, else null (the page's own fallback renders). A throw is logged once. */
const failedViews = new Set();
function laneView(modKey, fnName, ...args) {
  const fn = loaded[modKey]?.[fnName];
  if (typeof fn !== 'function') return null;
  try { const html = fn(ctx(), ...args); return typeof html === 'string' && html ? html : null; } catch (e) {
    const k = `${modKey}.${fnName}`;
    if (!failedViews.has(k)) { failedViews.add(k); console.warn(`[tokyo] ${k} failed, using the fallback`, e); S.errors.push(`${k}: ${e?.message || e}`); }
    return null;
  }
}

/** Lane views in kereta's signature (m, ref, ms, st, api, desktop): train-view.js's trainView / lineView. */
function kView(modKey, fnName, id) {
  const fn = loaded[modKey]?.[fnName];
  if (typeof fn !== 'function' || !S.sim) return null;
  S.tv.home = S.home; S.tv.canFollow = !!S.map;
  try { const html = fn(S.sim, id, NOW(), S.tv, { stamp: stampText(), live: liveOn() }, isDesktop()); return typeof html === 'string' && html ? html : null; } catch (e) {
    const k = `${modKey}.${fnName}`;
    if (!failedViews.has(k)) { failedViews.add(k); console.warn(`[tokyo] ${k} failed, using the fallback`, e); S.errors.push(`${k}: ${e?.message || e}`); }
    return null;
  }
}

// ------------------------------------------------------------------ ROUTE (journey planner) and exits.js (station exits)
const ROUTE_SVG = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.4 6H15a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h6.6"/></svg>';
/** Station sheet: "route from / to here" (ROUTE) and the exits section, after board.js's board. */
function stationExtras(id) {
  let out = '';
  if (HAS.routeView) {
    out += `<div class="kr-acts tk-racts"><button type="button" class="kr-save" data-act="route-from" data-id="${esc(id)}">${ROUTE_SVG}${esc(t('route.from'))}</button><button type="button" class="kr-save" data-act="route-to" data-id="${esc(id)}">${ROUTE_SVG}${esc(t('route.to'))}</button></div>`;
  }
  const ex = loaded.exits;
  if (typeof ex?.exitsSection === 'function') {
    try {
      const si = S.ix.stationIx.get(id), g = S.model.stations[si]?.group;
      out += ex.exitsSection(g >= 0 ? g : { station: si }, I.lang(), { station: si }) || '';
    } catch (e) { if (!failedViews.has('exits')) { failedViews.add('exits'); console.warn('[tokyo] exitsSection', e); } }
  }
  return out;
}
const routeHost = () => `<div class="tk-routehost" id="tk-route"></div>`;
/** ROUTE's screen lives in a container the page never re-renders (mountRouteView owns it). */
function mountRoute(id) {
  const rv = loaded.routeView;
  const el = $('#tk-route');
  if (!el) return;
  if (typeof rv?.mountRouteView !== 'function') {
    if (!el.firstChild) el.innerHTML = `<div class="empty card"><b>${esc(t('rt.title'))}</b><span>${esc(t('data.loading'))}</span></div>`;
    // the planner's chunks load on its first open
    if (HAS.routeView && S.model && !S.routeP) S.routeP = need('routeView').then(() => { const sc = screen(); if (sc.name === 'route' && $('#tk-route')) { $('#tk-route').innerHTML = ''; mountRoute(sc.id); } });
    return;
  }
  if (S.route?.el === el) { if (S.route.id !== id) { S.route.id = id; applyRouteEnds(id); } return; }
  try { S.route?.h?.destroy?.(); } catch { /* fine */ }
  try {
    const h = rv.mountRouteView(el, { ...ctx(), now: NOW, search: S.searchObj || undefined, source: S.source, open: (type, x) => open(type, x),
      onPlan: () => { if (!isDesktop() && sheet.detent === 'full') sheet.snap('half'); } });
    S.route = { el, h, id };
    applyRouteEnds(id);
  } catch (e) { console.warn('[tokyo] route view', e); S.errors.push(`routeView: ${e?.message || e}`); S.route = null; }
}
/** #route=from:<stationId> / to:<stationId> (the station sheet's buttons). */
function applyRouteEnds(id) {
  const m = /^(from|to):(.+)$/.exec(id || '');
  if (!m || !S.route?.h) return;
  try { (m[1] === 'from' ? S.route.h.setFrom : S.route.h.setTo)?.call(S.route.h, m[2]); } catch (e) { console.warn('[tokyo] route ends', e); }
}
function closeRoute() {
  if (!S.route) return;
  try { S.route.h?.destroy?.(); } catch { /* fine */ }
  S.route = null;
}
// the "Live now" sheet: which lines have live positions now, which are estimated, which are
// timetable only. The Live/Scheduled pill opens it (#live); the module owns #tk-cov
// (redraws itself on live changes, every 15 s and on a language switch) and loads on the first open.
const covHost = () => `<div class="tk-covhost" id="tk-cov"><div class="ph" data-drag><div class="rt"><h2>${esc(t('cov.title'))}</h2></div></div></div>`;
function mountCov() {
  const el = $('#tk-cov');
  if (!el) return;
  const cv = loaded.coverage;
  if (typeof cv?.mountCoverage !== 'function') {
    if (HAS.coverage && !S.covP) S.covP = need('coverage').then(() => { if (screen().name === 'live') mountCov(); });
    return;
  }
  if (S.cov?.el === el) { S.cov.h.update(); return; }
  closeCov();
  try {
    S.cov = { el, h: cv.mountCoverage(el, { model: () => S.sim, live: liveOn, now: NOW, isDesktop, playback: () => !!S.pb && !S.pb.isLive() }) };
  } catch (e) { console.warn('[tokyo] coverage', e); S.errors.push(`coverage: ${e?.message || e}`); S.cov = null; }
}
function closeCov() {
  if (!S.cov) return;
  try { S.cov.h?.destroy?.(); } catch { /* fine */ }
  S.cov = null;
}
/** the module loads on the first station screen; its map layer (under the station names) mounts
 *  once the map and the data are up; the sheet re-renders when the module and when the exits data are in. */
function ensureExits() {
  if (!HAS.exits) return;
  if (!S.exitsP) S.exitsP = need('exits').then(() => { mountExitsLayer(); viewEl.__html = ''; render(); });
  mountExitsLayer();
}
function mountExitsLayer() {
  const exMod = loaded.exits;
  if (S.exitsLayer || S.exitsFailed || !S.mapReady || !S.map || !S.model || typeof exMod?.mountExits !== 'function') return;
  try {
    S.exitsLayer = exMod.mountExits(S.map, { net: S.model, lang: I.lang() });
    Promise.resolve(S.exitsLayer?.ready).then(() => { viewEl.__html = ''; render(); exitsFocus(screen().name, screen().id); }, (e) => console.warn('[tokyo] exits data', e));
  } catch (e) { console.warn('[tokyo] exits layer', e); S.exitsLayer = null; S.exitsFailed = true; return; }
  exitsFocus(screen().name, screen().id);
}
/** exits.js on the map: the picked station's exits (from z15), cleared elsewhere. */
function exitsFocus(name, id) {
  if (!S.exitsLayer) return;
  try {
    if (name === 'station') {
      const si = S.ix.stationIx.get(id), g = S.model.stations[si]?.group;
      if (g >= 0) S.exitsLayer.showFor(g); else if (si != null) S.exitsLayer.showForStation(si);
    } else S.exitsLayer.clear();
  } catch (e) { console.warn('[tokyo] exits focus', e); }
}

/**
 * The map pill (phones) / pane badge (desktop) says what the open train's position is:
 * "Live position · 19:21" (green dot; the data time: the train's own report, else its operator's newest data from
 * live.json `ops`) for a measured position, "Estimated" for a delay carried from an earlier report (never called live),
 * "Scheduled" everywhere else. Never a source name.
 * on every other screen, while trains
 * have a FRESH live position (live.js 'live', <= 150 s), it says "● Live · 281" (a line screen: that line's live trains);
 * none (live off, a playback, the feed stale) -> "Scheduled" as before. Tap -> the Live now sheet (#live).
 */
let pillWord = '';
function updateSchedPill() {
  const sc = screen();
  let st = 'scheduled', at = null, n = 0;
  const lv = liveOn();
  if (sc.name === 'train' && lv?.stateOf) {
    try {
      // the run the train is on NOW (trains.js follows a through-run onto its next run, as train-view.js does): the pill and
      // the sheet must name the same state (a measured Narita line run continues as an estimated Kashima line run)
      let run = null;
      try { run = S.layer?.trains?.picked?.() || null; } catch { run = null; }
      if (!run || (run.key !== sc.id && !(run.prev || []).length && run.id !== sc.id)) run = S.ix?.runByKey.get(sc.id) || sc.id;
      st = lv.stateOf(run) || 'scheduled';
      if (st === 'live') { const r = typeof run === 'object' ? run : null; at = lv.liveOf?.(run)?.at ?? (r ? lv.updatedAt?.(r.line) : null) ?? null; }
    } catch { st = 'scheduled'; }
  } else if (sc.name === 'bus' && S.buses?.on) {
    st = 'scheduled';   // buses are simulated from the timetable: never the live pill
  } else if (sc.name !== 'bus' && lv) {
    n = sc.name === 'line' ? liveCount(S.ix?.lineIx?.get(sc.id) ?? -2) : liveCount();
    if (n > 0) st = 'live';
  }
  const word = st === 'live' ? (n > 0 ? t('lvis.pill', { n: I.fmtNum(n) }) : Number.isFinite(at) ? t('pill.live', { time: I.clockMs(at) }) : t('tv.live')) : st === 'estimated' ? t('pill.est') : t('sched');
  if (word === pillWord && (app.getAttribute('data-live') || 'scheduled') === st) return;
  pillWord = word;
  if (st === 'live' || st === 'estimated') app.setAttribute('data-live', st); else app.removeAttribute('data-live');
  const aria = st === 'live' ? (n > 0 ? t('lvis.pill.aria', { n: I.fmtNum(n) }) : word) : st === 'estimated' ? t('pill.est.aria') : t('sched.aria');
  for (const el of $$('#sched [data-i18n="sched"], .tk-badge [data-i18n="sched"]')) el.textContent = word;
  for (const el of $$('#sched, .tk-badgebtn')) el.setAttribute('aria-label', aria);
  chromeSync();   // the pill got wider / narrower
}

function render() {
  if (S.afterReady) keepAhead();   // back from a playback, a tab woken after hours: the hours around now
  syncLiveOnly();
  updateSchedPill();
  const m = S.model;
  const { name, id } = screen();
  if (name === 'about') { setView(aboutView()); return; }
  if (name === 'live') { if (!viewEl.querySelector('#tk-cov')) setView(covHost()); mountCov(); return; }
  if (name === 'route') { if (!viewEl.querySelector('#tk-route')) setView(routeHost()); mountRoute(id); return; }
  if (!m) {
    setView(S.loadError
      ? `<div class="empty card"><b>${esc(t('data.fail'))}</b><span>${esc(t('load.fail.net'))}</span><button type="button" class="btn primary" data-act="retry">${esc(t('retry'))}</button></div>`
      : `<div class="kr-now"><p class="eyebrow">${esc(t('data.loading'))}</p><div class="big"><span class="sk sk-num"></span></div></div><div class="list" aria-hidden="true"><div class="skrow"><span class="sk a"></span><span class="b"><span class="sk sk-t" style="width:62%"></span><span class="sk sk-t" style="width:38%"></span></span><span class="sk c"></span></div></div>`);
    return;
  }
  const ms = NOW();
  let html = null;
  if (name === 'home') html = S.q.trim() ? searchView(S.q) : laneView('views', 'homeView') ?? homeView(ms);
  else if (name === 'lines') html = laneView('views', 'linesView') ?? linesView(ms);
  else if (name === 'stations') html = S.q.trim() ? searchView(S.q, 'station') : laneView('views', 'stationsView', { near: S.near }) ?? stationsView();
  else if (name === 'station') html = (laneView('views', 'stationView', id) ?? stationView(id, ms)) + stationExtras(id);
  else if (name === 'train') html = withRide(kView('trainView', 'trainView', id) ?? trainView(id, ms), id);   // Ride in the tunnel
  else if (name === 'line') html = kView('lineView', 'lineView', id) ?? lineView(id, ms);
  else if (name === 'bus') html = busView(id);
  setView(html || '');
}
setInterval(() => { if (!document.hidden) render(); }, REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ------------------------------------------------------------------ one persistent polite status line (#tk-say)
let sayTimer = 0, countSaidAt = 0;
/** Announce `text` once (screen readers): the screen title on open / back, a count; lane views get it as ctx.say. */
function say(text) {
  const el = document.getElementById('tk-say');
  if (!el || !text) return;
  clearTimeout(sayTimer);
  el.textContent = '';
  sayTimer = setTimeout(() => { el.textContent = String(text); }, 150);   // emptied first: the same words again are read too
}
/** "1,575 trains running by the timetable" (with live trains: "1,575 trains, 281 live"): after ready() and when the Map
 *  tab shows, at most once a minute. */
function sayCount() {
  if (!S.model || Date.now() - countSaidAt < 60000) return;
  let n = 0;
  try { n = runningNow().total; } catch { return; }
  countSaidAt = Date.now();
  const live = liveCount();
  say(live ? `${tn('n.trains', n)}, ${t('lvis.head', { n: I.fmtNum(live) })}` : `${tn('n.trains', n)} ${t('now.running')}`);
}

// ------------------------------------------------------------------ live trains, counted and filtered
/**
 * Trains with a FRESH live position now: live.js's measured runs (its 150 s rule: the same runs coverage.js counts as
 * 'live', coverageOf().counts.liveTrains; the trains the map rings). line = a line index: that line's live trains ON
 * THE MAP now (the trains layer's frame, live 1), so the pill never says more than the line screen's "N trains
 * running". 0 in a playback, with live off or a stale feed (a timetable position is never live).
 */
function liveCount(line = null) {
  const lv = liveOn();
  if (!lv) return 0;
  try {
    const m = lv.measured;
    if (!m || !m.size) return 0;
    if (line == null) return m.size;
    const f = S.layer?.trains?.frame;
    let n = 0;
    if (f?.live && f.line) { for (let i = 0; i < f.n; i++) if (f.line[i] === line && f.live[i] === 1) n += 1; return n; }
    for (const run of m) if (run.line === line) n += 1;
    return n;
  } catch { return 0; }
}
/** The Live chip (home): pressed = the map shows only the live trains (+ the picked train / line); off by itself when no
 *  train is live (live off, a stale feed, a playback). Never stored: a reload shows every train. */
const liveOnlyOn = () => !!S.liveOnly && liveCount() > 0;
let keepLine = -1, keepKey = null;   // the picked line / train stay on the map while the Live chip is pressed
function liveShow(run) {
  if (S.sim?.measured?.has?.(run)) return true;
  if (run.line === keepLine || (keepKey != null && (run.key === keepKey || run.id === keepKey))) return true;
  let p = null;
  try { p = S.layer?.trains?.picked?.() || null; } catch { p = null; }
  return !!p && run === p;
}
let liveShown = false;
/** The map's train filter follows S.liveOnly + the live data (render() and the screen changes call it). */
function syncLiveOnly() {
  const on = liveOnlyOn();
  if (S.liveOnly && !on) S.liveOnly = false;   // nothing live any more: every train again, the chip goes
  const sc = screen();
  keepLine = sc.name === 'line' ? S.ix?.lineIx?.get(sc.id) ?? -1 : -1;
  keepKey = sc.name === 'train' ? sc.id : null;
  if (on === liveShown && !on) return;
  liveShown = on;
  try { S.layer?.show?.(on ? liveShow : null); } catch (e) { console.warn('[tokyo] live filter', e); }
}
function toggleLiveOnly(want = !S.liveOnly) {
  const n = liveCount();
  S.liveOnly = !!want && n > 0;
  syncLiveOnly();
  say(S.liveOnly ? t('lvis.say.on', { n: I.fmtNum(n) }) : t('lvis.say.off'));
  viewEl.__html = '';
  render();
}

// ------------------------------------------------------------------ markup pieces (fallback views)
/** A line's ring bullet: its code (JY, G) on a white disc ringed in the line colour (round chips). */
export function disc(l, size = '') {
  if (!l) return '';
  const c = l.code || (nm(l.title) || l.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '·';
  return `<span class="rtile krl-bullet${size ? ` ${size}` : ''}" style="--rc:${esc(l.color || '#6B6B70')}" data-len="${Math.min(3, c.length)}" aria-hidden="true"><b>${esc(c)}</b></span>`;
}
const STATION_SVG = '<svg class="i kr-sg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 20l1.8-3.5M15.5 20l-1.8-3.5"/></svg>';
const stationTile = () => `<span class="etile kr-stile" aria-hidden="true">${STATION_SVG}</span>`;
const STAR = '<svg class="kr-star" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8L12 3.5Z"/></svg>';
/** Text with its Japanese runs tagged lang="ja" (EN / ID screens): Japanese glyph forms on an English phone. */
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]+/g;
const cjk = (txt) => (I.lang() === 'ja' ? esc(txt) : esc(txt).replace(CJK, (m) => `<span lang="ja">${m}</span>`));
const alt = (o) => { const a = I.titleAlt(o); return a ? `<span class="tk-alt" lang="${I.lang() === 'ja' ? 'en' : 'ja'}">${esc(a)}</span>` : ''; };
function rowHtml({ attrs = '', lead = '', titleHtml = '', sub = '', subHtml = '', right = '', chev = false, cls = '', label = '' }) {
  const tag = attrs ? 'button' : 'div';
  return `<${tag} ${tag === 'button' ? 'type="button" ' : ''}class="row${cls ? ` ${cls}` : ''}" ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>${lead}<span class="rt"><b>${titleHtml}</b>${subHtml ? `<span>${subHtml}</span>` : sub ? `<span>${esc(sub)}</span>` : ''}</span>${right ? `<span class="rr">${right}</span>` : ''}${chev ? icon('chev', 'chev') : ''}</${tag}>`;
}
const listHtml = (rows) => `<div class="list">${rows.join('')}</div>`;
const secHtml = (title, small, body) => `<section class="sec"><div class="sech"><h2>${esc(title)}</h2>${small ? `<small>${esc(small)}</small>` : ''}</div>${body}</section>`;
/** The timetable's own date (ODPT guideline 2.2.1): the data pack's meta.source, else credits.js's constants. */
function dataDate() {
  const src = S.model?.meta?.source, c = loaded.credits;
  const date = src?.date || c?.SNAPSHOT?.date, got = src?.obtained || c?.DATA_OBTAINED || date;
  if (!date) return '';
  const f = (iso) => (typeof c?.fmtDate === 'function' ? c.fmtDate(iso, I.lang()) : iso);
  return t('data.date', { date: f(date), obtained: f(got) });
}
/** Sentences joined the way the language writes them: no space after 。 in Japanese. */
const joinSent = (...xs) => xs.filter(Boolean).join(I.lang() === 'ja' ? '' : ' ');
const schedNote = () => `<p class="kr-note">${esc(joinSent(t('sched.long'), dataDate()))}</p>`;
/** train-view.js's timetable stamp: "Mini Tokyo 3D, 2 Nov 2026". */
function stampText() {
  const src = S.model?.meta?.source, c = loaded.credits;
  const date = src?.date || c?.SNAPSHOT?.date;
  if (!date) return '';
  return `${c?.SNAPSHOT?.name || 'Mini Tokyo 3D'}, ${typeof c?.fmtDate === 'function' ? c.fmtDate(date, I.lang()) : date}`;
}
/** Place-page head; the close button only on desktop (phones have the top bar's back button). */
function head({ lead, titleHtml, sub = '' }) {
  const x = isDesktop() ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}">${icon('x')}</button>` : '';
  return `<div class="ph" data-drag>${lead}<div class="rt"><h2>${titleHtml}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${x}</div>`;
}
const stationName = (si) => nm(S.model.stations[si]?.name);
/** Where a run goes, as words: "To Shinjuku", or the direction on a loop ("Outer Loop"). */
function toText(r) {
  const sim = loaded.model;
  let d = null;
  if (typeof sim?.destination === 'function' && S.sim) { try { d = sim.destination(S.sim, r); } catch { d = null; } }
  if (d == null) d = r.to?.length && r.to[0] >= 0 ? r.to[0] : S.model.lines[r.line]?.loop ? -1 : r.stops[r.stops.length - 1].s;
  if (d === -1) { const dir = S.model.dirs[r.dir]; return (dir && I.has(`board.dir.${dir.id}`) ? t(`board.dir.${dir.id}`) : nm(dir?.title)) || nm(S.model.lines[r.line]?.title); }
  return t('train.to', { name: stationName(d) });
}
const typeOf = (r) => S.model.types[r.type];
const minsTo = (sec, now) => Math.floor((sec - now) / 60);
function countdown(min) {
  if (min >= 60 || min < 0) return '';
  return `<span class="cd${min <= 1 ? ' go' : ''}">${min <= 0 ? esc(t('dep.now')) : esc(tn('min', min))}</span>`;
}

// Stasiun besar untuk "Pilih stasiunmu" (id dari data-build/jakarta.mjs; yang tidak ada di data tidak ditampilkan)
const HUBS = ['krl.Bogor.0.MRI', 'krl.Rangkasbitung.2.THB', 'krl.Rangkasbitung.3.SUD', 'mrt.MRT.9.MRT-DKA', 'krl.Bogor.0.JAKK',
  'krl.Bogor.0.BOO', 'krl.Cikarang.7.BKS', 'krl.Cikarang.7.JNG', 'krl.Rangkasbitung.3.DU', 'kai.KA-GMR.13.KA-GMR'];

function nowBlock(ms, r) {
  const eb = `<p class="eyebrow">${esc(t(S.pb && !S.pb.isLive() ? 'pb.eyebrow' : 'now.eyebrow', { time: I.clockMs(ms) }))}</p>`;
  if (r.total) {
    const live = liveCount();   // "1,308 trains (● 281 live)" -> the Live now sheet
    const tail = live ? `<button type="button" class="tk-livehead" data-act="sched" aria-label="${esc(t('lvis.head.aria', { n: I.fmtNum(live) }))}"><span class="tk-lh1"><i class="tk-ldot" aria-hidden="true"></i><span>${esc(t('lvis.head', { n: I.fmtNum(live) }))}</span></span><span class="tk-lh2">${esc(t('lvis.rest'))}</span></button>`
      : `<span class="callout c2">${esc(t('now.running'))}</span>`;
    return `<div class="kr-now">${eb}<div class="big"><span class="display">${esc(tn('n.trains', r.total))}</span>${tail}</div><p class="caption c2">${esc(t('now.lines', { n: I.fmtNum(r.byLine.size) }))}</p></div>`;
  }
  const sec = serviceSec(ms);
  let first = null;
  for (const run of S.runs) { const f = firstT(run); if (f > sec && (!first || f < firstT(first))) first = run; }
  return `<div class="kr-now">${eb}<div class="big"><span class="title">${esc(t('none.running'))}</span></div>${first ? `<p class="caption c2">${esc(t('first.train', { time: I.clock(firstT(first)), station: stationName(first.stops[0].s) }))}</p>` : ''}</div>`;
}
function depRows(si, ms, max = 6, horizon = 3 * 3600) {
  const now = serviceSec(ms);
  const deps = S.ix.stopsAt(si)
    .filter(({ r, i }) => i < r.stops.length - 1 && r.stops[i].d != null && r.stops[i].d >= now - 30 && r.stops[i].d <= now + horizon)
    .sort((a, b) => a.r.stops[a.i].d - b.r.stops[b.i].d)
    .slice(0, max);
  return deps.map(({ r, i }) => {
    const l = S.model.lines[r.line], ty = typeOf(r), d = r.stops[i].d;
    const cd = countdown(minsTo(d, now));
    return rowHtml({
      attrs: `data-train="${esc(r.key)}"`, cls: 'tk-dep',
      lead: `<span class="tk-tm">${esc(I.clock(d))}</span>`,
      titleHtml: esc(toText(r)),
      sub: [nm(l?.title), ty ? nm(ty.title) : ''].filter(Boolean).join(' · '),
      right: `${cd}${disc(l)}`,
      label: `${toText(r)}, ${I.clock(d)}`,
    });
  });
}
function myStation(ms) {
  const s = S.home && S.ix.station(S.home);
  if (!s) return picker();
  const si = S.ix.stationIx.get(S.home);
  const board = laneView('views', 'myStation', S.home);
  if (board) return board;
  const rows = depRows(si, ms, 5);
  return `<section class="kr-home" aria-label="${esc(t('my'))}, ${esc(nm(s.name))}">
    <div class="kr-sth"><div><p class="eyebrow">${esc(t('my'))}</p><h2>${esc(nm(s.name))}${STAR}</h2></div><button type="button" class="kr-ghost" data-act="change-home">${esc(t('my.change'))}</button></div>
    ${rows.length ? `<div class="kr-dg">${rows.join('')}</div>` : `<p class="kr-none">${esc(t('station.none'))}</p>`}
    <button type="button" class="kr-more" data-station="${esc(s.id)}">${esc(t('my.all', { name: nm(s.name) }))}${icon('chev', 'chev')}</button></section>`;
}
function picker() {
  const hubs = HUBS.filter((id) => S.ix.stationIx.has(id)).slice(0, 8);
  return `<section class="kr-pick" aria-label="${esc(t('my.pick'))}"><div class="kr-pickh"><img src="${esc(ART.anker)}" width="72" height="72" alt="" draggable="false" decoding="async">
    <div><b>${esc(t('my.pick'))}</b><span>${esc(t('my.pick.sub'))}</span></div></div>
    <button type="button" class="btn" data-act="locate">${icon('locate')}${esc(S.nearby && I.has('nb.go') ? t('nb.go') : t('locate'))}</button>
    <div class="tk-hubs">${hubs.map((id) => `<button type="button" class="chip" data-home="${esc(id)}">${esc(nm(S.ix.station(id).name))}</button>`).join('')}</div></section>`;
}
function lineRow(l, r) {
  const n = r.byLine.get(S.ix.lineIx.get(l.id)) || 0;
  const stations = new Set(l.stations).size;
  return rowHtml({ attrs: `data-line="${esc(l.id)}"`, lead: disc(l), titleHtml: `${esc(nm(l.title))}${alt(l.title)}`, sub: tn('n.stations', stations), right: n ? `<b>${esc(tn('n.running', n))}</b>` : '', chev: true });
}
function homeView(ms) {
  const r = runningNow(ms);
  const lines = S.model.lines.slice().sort((a, b) => (r.byLine.get(S.ix.lineIx.get(b.id)) || 0) - (r.byLine.get(S.ix.lineIx.get(a.id)) || 0));
  const top8 = lines.slice(0, 8);
  const more = lines.length > top8.length ? `<button type="button" class="kr-more" data-tab="lines">${esc(t('lines.all', { n: I.fmtNum(lines.length) }))}${icon('chev', 'chev')}</button>` : '';
  return `${nowBlock(ms, r)}${myStation(ms)}${secHtml(t('lines'), t('sched'), listHtml(top8.map((l) => lineRow(l, r))) + more)}${schedNote()}`;
}
function linesView(ms) {
  const r = runningNow(ms);
  const ops = S.model.operators || [];
  const by = new Map();
  for (const l of S.model.lines) { const k = l.op ?? -1; if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
  return [...by.entries()].map(([op, ls]) => secHtml(nm(ops[op]?.title) || ops[op]?.id || t('lines'), tn('n.lines', ls.length), listHtml(ls.map((l) => lineRow(l, r))))).join('') + schedNote();
}
function stationRow(si) {
  const s = S.model.stations[si];
  const order = typeof loaded.board?.complexLines === 'function' ? (() => { try { return loaded.board.complexLines(S.model, si); } catch { return null; } })() : null;
  const ls = (order ? order.map((i) => S.model.lines[i]) : S.ix.linesAt(si)).filter(Boolean);
  const seen = new Set(), discs = [];
  for (const l of ls) { const k = l.code || l.id; if (!seen.has(k)) { seen.add(k); discs.push(l); } }   // one disc per code
  const more = discs.length > 5 ? `<small class="tk-more">+${discs.length - 5}</small>` : '';
  const other = I.titleAlt(s.name);
  const otherHtml = other ? `<span lang="${I.lang() === 'ja' ? 'en' : 'ja'}">${esc(other)}</span> · ` : '';
  return rowHtml({ attrs: `data-station="${esc(s.id)}"`, lead: stationTile(), titleHtml: esc(nm(s.name)), subHtml: `${otherHtml}${esc(tn('n.lines', ls.length))}`,
    right: `<span class="kr-buls">${discs.slice(0, 5).map((l) => disc(l, 'xs')).join('')}${more}</span>`, chev: true });   // xs chips like search rows (codes >= 11 px)
}
/** One row per same-name complex (the group), its first station standing in. */
function uniqueStations(list) {
  const seen = new Set(), out = [];
  for (const si of list) { const g = S.model.stations[si]?.group; const k = g >= 0 ? `g${g}` : `s${si}`; if (!seen.has(k)) { seen.add(k); out.push(si); } }
  return out;
}
function stationsView() {
  // near me: search.js's block (walking distances, asked on tap only), else the page's own rows
  let near = '';
  if (S.searchObj && typeof loaded.search?.renderNear === 'function') {
    try { near = loaded.search.renderNear(S.searchObj, S.nearState, { lang: I.lang(), t }); } catch (e) { console.warn('[tokyo] renderNear', e); near = ''; }
  }
  if (!near) near = S.near?.length ? secHtml(t('stations.near'), '', listHtml(S.near.map((x) => stationRow(x.si)))) : '';
  const hubIds = Array.isArray(loaded.views?.HUBS) ? loaded.views.HUBS : HUBS;
  const hubs = uniqueStations(hubIds.filter((id) => S.ix.stationIx.has(id)).map((id) => S.ix.stationIx.get(id)));
  return `${near}${hubs.length ? secHtml(t('stations.hubs'), '', listHtml(hubs.map(stationRow))) : ''}<p class="fine">${cjk(t('search.hint'))}</p>`;
}
function stationView(id, ms) {
  const s = S.ix.station(id);
  if (!s) return `<div class="empty card"><b>${esc(t('station'))}</b><span>${esc(id)}</span></div>`;
  const si = S.ix.stationIx.get(id);
  const ls = S.ix.linesAt(si);
  const saved = S.home === id;
  const rows = depRows(si, ms, 12);
  return `${head({ lead: stationTile(), titleHtml: `${esc(nm(s.name))}${alt(s.name)}`, sub: ls.map((l) => nm(l.title)).join(' · ') })}
    <div class="kr-acts"><button type="button" class="kr-save" data-act="save" data-id="${esc(id)}" aria-pressed="${saved}">${STAR}${esc(saved ? t('my.is') : t('my.save'))}</button></div>
    ${secHtml(t('station.next'), t('sched'), rows.length ? `<div class="list">${rows.join('')}</div>` : `<p class="kr-none">${esc(t('station.none'))}</p>`)}
    ${secHtml(t('station.lines'), '', listHtml(ls.map((l) => lineRow(l, runningNow(ms)))))}${schedNote()}`;
}
function trainView(key, ms) {
  const r = S.ix.runByKey.get(key);
  if (!r) return `<div class="empty card"><b>${esc(t('train'))}</b><span>${esc(t('train.gone'))}</span></div>`;
  const l = S.model.lines[r.line], ty = typeOf(r), now = serviceSec(ms);
  const stops = r.stops.map((st, i) => {
    const tm = stopT(st), past = tm != null && tm < now;
    return `<button type="button" class="kr-stop${past ? ' past' : ''}${i === 0 ? ' first' : ''}${i === r.stops.length - 1 ? ' last' : ''}" data-station="${esc(S.model.stations[st.s].id)}"><i></i><span class="n">${esc(stationName(st.s))}</span><span class="t">${esc(I.clock(tm))}</span></button>`;
  }).join('');
  return `${head({ lead: disc(l, 'xl'), titleHtml: esc(toText(r)), sub: [nm(l?.title), ty ? nm(ty.title) : '', t('train.no', { no: r.number })].filter(Boolean).join(' · ') })}
    ${secHtml(t('train.stops'), t('sched'), `<div class="kr-track" style="--lc:${esc(l?.color || '#6B6B70')}">${stops}</div>`)}${schedNote()}`;
}
function lineView(id, ms) {
  const l = S.ix.line(id);
  if (!l) return `<div class="empty card"><b>${esc(t('line'))}</b><span>${esc(t('line.gone'))}</span></div>`;
  const r = runningNow(ms);
  const n = r.byLine.get(S.ix.lineIx.get(id)) || 0;
  const sts = l.loop && l.stations.length > 1 && l.stations[0] === l.stations[l.stations.length - 1] ? l.stations.slice(0, -1) : l.stations;
  const rows = sts.map((si, i) => `<button type="button" class="kr-stop${i === 0 ? ' first' : ''}${i === sts.length - 1 ? ' last' : ''}" data-station="${esc(S.model.stations[si].id)}"><i></i><span class="n">${esc(stationName(si))}${S.model.stations[si].code ? `<small>${esc(S.model.stations[si].code)}</small>` : ''}</span></button>`).join('');
  return `${head({ lead: disc(l, 'xl'), titleHtml: `${esc(nm(l.title))}${alt(l.title)}`, sub: [nm(S.model.operators?.[l.op]?.title), n ? tn('n.running', n) : ''].filter(Boolean).join(' · ') })}
    ${secHtml(t('line.stations'), tn('n.stations', sts.length), `<div class="kr-track kr-line" style="--lc:${esc(l.color || '#6B6B70')}">${rows}</div>`)}${schedNote()}`;
}
function searchView(q, only = '') {
  const lane = laneQuery(q);
  if (lane && typeof loaded.search?.renderResults === 'function') {
    try {
      const res = only === 'station' ? { ...lane, lines: [], lead: 'stations' } : lane;
      const html = loaded.search.renderResults(S.searchObj, res, { lang: I.lang(), t });
      if (html) return html;
    } catch (e) { console.warn('[tokyo] search render failed, using the fallback', e); }
  }
  const res = fallbackSearch(q);
  const rows = res.filter((h) => !only || h.t === only).slice(0, 30).map((h) => (h.t === 'station' ? stationRow(S.ix.stationIx.get(h.id)) : lineRow(S.ix.line(h.id), runningNow())));
  return rows.length ? listHtml(rows) : `<div class="empty"><b>${esc(t('q.none', { q: q.trim() }))}</b><span>${esc(t('q.none.sub'))}</span></div>`;
}
/** search.js's createSearch(net).query(q, lang, limit) -> {q, stations, lines, lead}; null when not there. */
function laneQuery(q) {
  if (!S.searchObj?.query) return null;
  try { return S.searchObj.query(q, I.lang(), 12); } catch (e) { console.warn('[tokyo] search failed, using the fallback', e); return null; }
}
/** The first hit for Enter: [{t, id}] in the order the results show. */
function searchHits(q) {
  const r = laneQuery(q);
  if (r) {
    const st = (r.stations || []).map((x) => ({ t: 'station', id: x.id })), ln = (r.lines || []).map((x) => ({ t: 'line', id: x.id }));
    return r.lead === 'lines' ? [...ln, ...st] : [...st, ...ln];
  }
  return fallbackSearch(q);
}
function fallbackSearch(q) {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  const out = [];
  for (const l of S.model.lines) if ([l.title.en, l.title.ja, l.code, l.id].some((x) => x && String(x).toLowerCase().includes(k))) out.push({ t: 'line', id: l.id });
  for (const si of uniqueStations(S.model.stations.map((_, i) => i))) {
    const s = S.model.stations[si];
    if ([s.name.en, s.name.ja, s.code].some((x) => x && String(x).toLowerCase().includes(k))) out.push({ t: 'station', id: s.id });
  }
  return out;
}

// ------------------------------------------------------------------ About (credits from credits.js)
function aboutView() {
  const credits = laneView('credits', 'creditsHtml') ?? laneView('credits', 'aboutHtml') ?? `<p>${esc(t('about.credits.fallback'))}</p>`;
  const cal = S.calendar ? t(`cal.${S.calendar}`) : '';
  const langs = I.LANGS.map(([k, label]) => `<button type="button" data-lang="${k}" aria-pressed="${I.lang() === k}" lang="${k}">${esc(label)}</button>`).join('');
  return `${head({ lead: `<img class="kr-aart" src="${esc(ART.anker)}" width="56" height="56" alt="" draggable="false">`, titleHtml: esc(t('brand')), sub: t('brand.tag') })}
    <div class="tk-text"><p>${esc(t('about.what'))}</p></div>
    <div class="tk-schedcard" id="about-sched"><span class="tk-badge badge muted"><i aria-hidden="true"></i>${esc(t('sched'))}</span><span>${esc(joinSent(t('about.sched'), cal ? t('about.today', { cal }) : '', dataDate()))}</span></div>
    ${liveOn()?.state?.().state === 'on' ? `<div class="tk-schedcard" id="about-live"><span class="tk-badge badge muted tk-livebadge"><i aria-hidden="true"></i>${esc(t('tv.live'))}</span><span>${esc(t('about.live'))}</span></div>` : ''}
    ${secHtml(t('about.types'), '', `<div class="tk-credits tk-types"><p>${cjk(t('about.types.local'))}</p><p>${cjk(t('about.types.rapid'))}</p><p>${cjk(t('about.types.ltd'))}</p></div>`)}
    ${secHtml(t('about.lang'), '', `<div class="tk-langs" role="group" aria-label="${esc(t('about.lang'))}">${langs}</div>`)}
    ${secHtml(t('about.data'), '', `<div class="tk-credits">${credits}</div>`)}`;
}

// ------------------------------------------------------------------ My station, location
function setHome(id) {
  const s = S.ix?.station(id);
  if (!s) return;
  S.home = id; writeHome(id);
  toast(t('my.saved', { name: nm(s.name) }));
  render();
}
function toggleHome(id) {
  if (S.home === id) { S.home = null; writeHome(null); toast(t('my.removed')); render(); } else setHome(id);
}
function nearest(lng, lat, n = 4) {
  const k = Math.cos((lat * Math.PI) / 180);
  const all = uniqueStations(S.model.stations.map((_, i) => i)).map((si) => {
    const s = S.model.stations[si];
    const dx = (s.lng - lng) * k * 111320, dy = (s.lat - lat) * 110540;
    return { si, d: Math.hypot(dx, dy) };
  });
  return all.sort((a, b) => a.d - b.d).slice(0, n);
}
function locate() {
  const btn = $('#b-locate');
  if (!navigator.geolocation) { S.nearState = { st: 'fail' }; toast(t('loc.none')); render(); return; }
  btn.setAttribute('aria-busy', 'true');
  if (S.nearState?.st !== 'ok') { S.nearState = { st: 'wait' }; if (S.tab === 'stations' && !S.stack.length) render(); }
  navigator.geolocation.getCurrentPosition((p) => {
    btn.removeAttribute('aria-busy');
    const { longitude: lng, latitude: lat, accuracy } = p.coords;
    try { S.nearState = S.searchObj?.near ? { st: 'ok', list: S.searchObj.near(lng, lat, 4, I.lang()) } : { st: 'idle' }; } catch { S.nearState = { st: 'idle' }; }
    S.tm?.setUserLocation?.([lng, lat], accuracy);
    if (S.map) S.map.flyTo({ center: [lng, lat], zoom: Math.max(S.map.getZoom(), 14), duration: reduceMotion() ? 0 : 800 });
    if (!S.model) return;
    S.near = nearest(lng, lat, 4);
    if (S.tab !== 'stations' || S.stack.length) goTab('stations'); else render();
    if (!isDesktop()) sheet.snap('half');
  }, (err) => {
    btn.removeAttribute('aria-busy');
    S.nearState = { st: err.code === 1 ? 'denied' : 'fail' };
    if (S.tab === 'stations' && !S.stack.length) render();
    toast(err.code === 1 ? t('loc.denied') : t('loc.wait'));
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}

// ------------------------------------------------------------------ taps
app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act], [data-tab], [data-station], [data-train], [data-line], [data-home], [data-lang], [data-search-near]');
  if (!el || !app.contains(el) || el.closest('a[href]')) return;
  if (el.hasAttribute('data-search-near')) { locate(); return; }
  const d = el.dataset;
  if (d.act && /^tv-/.test(d.act)) { try { if (loaded.trainView?.act?.(d, S.tv)) { viewEl.__html = ''; render(); return; } } catch (err) { console.warn('[tokyo] trainView.act', err); } }
  if (d.tab) { goTab(d.tab); return; }
  if (d.act === 'back') { back(); return; }
  if (d.act === 'about') { open('about', '1'); return; }
  if (d.act === 'route') { open('route', '1'); return; }
  if (d.act === 'route-from' || d.act === 'route-to') { open('route', `${d.act === 'route-from' ? 'from' : 'to'}:${d.id}`); return; }
  if (d.act === 'sched') { open(HAS.coverage ? 'live' : 'about', '1'); return; }
  if (d.act === 'live-only') { toggleLiveOnly(); return; }
  if (d.act === 'buses-map') { toggleBuses(true); if (!isDesktop()) sheet.snap('peek'); return; }   // the home's TransJakarta row: buses on, the map in view
  if (d.act === 'see-ug') { seeUnderground(d.id); return; }   // the underground view
  if (d.act === 'ride-ug') { rideUnderground(d.id); return; }   // ride along in the tunnel
  if (d.act === 'locate') {
    // on Home without a saved station the picker card's pill starts "Trains near me" (the map's #b-locate keeps locate)
    if (S.nearby && S.home == null && screen().name === 'home') { S.nearby.start(); if (!isDesktop()) sheet.snap('half'); return; }
    locate(); return;
  }
  if (d.act === 'change-home') { goTab('stations'); return; }
  if (d.act === 'save') { toggleHome(d.id); return; }
  if (d.act === 'retry') { clearTimeout(dataTimer); S.loadError = false; render(); loadData(); return; }
  if (d.lang) { I.setLang(d.lang); return; }
  if (d.home) { setHome(d.home); return; }
  if (d.station) { open('station', d.station); return; }
  if (d.train) { open('train', d.train); return; }
  if (d.line) { open('line', d.line); }
});
// Escape = the back button (the sheet pattern); the search field clears first; ROUTE's fields and anything that
// already handled the key (search.js's own Escape, playback.js's sheet) keep theirs
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
  if (e.target.closest?.('.tk-routehost input, .tk-routehost select, .tk-routehost textarea')) return;
  if (e.target === qInput && S.q) { e.preventDefault(); $('#qx').click(); return; }
  if (S.stack.length) { e.preventDefault(); back(); return; }
  if (!isDesktop() && sheet.detent !== 'peek') sheet.snap('peek');
});
// a focused chip in a sideways-scrolling row scrolls into view (operator chips, board line filter, 3D row)
document.addEventListener('focusin', (e) => {
  const sc = e.target.closest?.('.chips, .tk3d-ctl');
  if (!sc || sc.scrollWidth <= sc.clientWidth) return;
  const r = e.target.getBoundingClientRect(), b = sc.getBoundingClientRect(), pad = 16;
  if (r.right > b.right - pad) sc.scrollLeft += r.right - b.right + pad;
  else if (r.left < b.left + pad) sc.scrollLeft -= b.left - r.left + pad;
});
// the tab lists move with the arrow keys (Left / Right / Home / End), one tab stop each (roving tabindex in show)
for (const seg of $$('[data-seg]')) seg.addEventListener('keydown', (e) => {
  const tabs = [...seg.querySelectorAll('[role=tab]')], i = tabs.indexOf(document.activeElement);
  const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (i < 0 || j == null) return;
  e.preventDefault();
  const k = (j + tabs.length) % tabs.length;
  tabs[k].focus(); tabs[k].click();
});
$('#b-locate').addEventListener('click', locate);
$('#b-zin').addEventListener('click', () => S.tm?.zoomIn?.());
$('#b-zout').addEventListener('click', () => S.tm?.zoomOut?.());
$('#b-3d').addEventListener('click', () => toggle3D());
$('#b-ug').addEventListener('click', () => toggleUnderground());
$('#b-bus').addEventListener('click', () => toggleBuses());
$('#map').addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; }, true);
$('#map').addEventListener('click', (e) => mapTapFirst(e), true);   // capture on the container: before the trains layer's own

qInput.addEventListener('input', () => { S.q = qInput.value; $('#qx').hidden = !S.q; render(); });
qInput.addEventListener('focus', () => { if (!S.searchObj && S.model) need('search').then(setupSearch); warmSearch(); if (!isDesktop() && sheet.detent !== 'full') sheet.snap('full'); });
$('#pbody').addEventListener('focusin', (e) => { if (!isDesktop() && e.target.matches?.('.tk-routehost input') && sheet.detent !== 'full') sheet.snap('full'); });
$('#qx').addEventListener('click', () => { S.q = ''; qInput.value = ''; $('#qx').hidden = true; render(); qInput.focus(); });
$('#search').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!S.model || !S.q.trim()) return;
  const first = searchHits(S.q).find((h) => S.tab !== 'stations' || h.t === 'station');
  if (!isDesktop()) qInput.blur();   // phones: the keyboard goes; desktop: focus moves on to the new screen's title
  if (first) {
    open(first.t, first.id);
    const h = viewEl.querySelector('.ph h2, h2');   // phones too (the blur left focus on <body>)
    if (h && (document.activeElement === document.body || !document.activeElement)) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
});

// language switch: static markup + every screen + the map's labels
I.onLang(() => {
  // a ?lang= link would override the switch on the next visit: drop it from the address
  try { const u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.delete('lang'); history.replaceState(history.state, '', `${u.pathname}${u.search}${u.hash}`); } } catch { /* fine */ }
  setUiText({ close: t('close'), live: t('live') });
  I.applyDom();
  app.removeAttribute('data-live'); pillWord = '';   // applyDom wrote "Scheduled" back: updateSchedPill() (in render) sets it again
  applyCredits();
  try { S.city3d?.setLang?.(I.lang()); S.c3dCtl?.setLang?.(I.lang()); } catch { /* fine */ }
  try { S.route?.h?.rerender?.(); S.exitsLayer?.setLang?.(I.lang()); S.buses?.setLang?.(I.lang()); } catch { /* fine */ }
  document.title = t('doc.title');
  setPlaceholder();
  viewEl.__html = '';
  render();
  S.tm?.setAriaLabel?.(t('map.aria'));
  try { S.network?.setLang?.(I.lang()); S.layer?.setLang?.(I.lang()); if (S.map) (loaded.style?.setStyleLang || loaded.style?.setLang)?.(S.map, I.lang()); } catch (e) { console.warn('[tokyo] setLang on the map', e); }
  fallbackNetLang();
});

/** credits.js: the footer line names the data source; the sheet's map credit links OSM's copyright page. */
function applyCredits() {
  const c = loaded.credits;
  if (!c) return;
  const f = c.footer?.[I.lang()] || c.footer?.en;
  if (f) for (const el of $$('.pfoot .credit')) el.textContent = f;
  const href = c.URLS?.osm || 'https://www.openstreetmap.org/copyright';
  for (const el of $$('.grab .credit [data-i18n="credit.osm"]')) {
    el.innerHTML = `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(c.attributionShort || t('credit.osm'))}</a>`;
  }
}

// ------------------------------------------------------------------ sheet (phones) / pane (desktop)
const sheet = createSheet({ sheet: $('#pane'), body: $('#pbody'), isDesktop, reduceMotion });
$('#grab').addEventListener('click', (e) => { if (!isDesktop() && !e.target.closest('.credit')) sheet.cycle(); });
/**
 * The map's padding = the UI over it. Phones: the bottom follows the sheet the screen opens at: peek
 * for the opening view (the Yamanote ring large), half once a station / train / line is picked, so what the camera
 * centres sits in the visible map above the sheet (kereta used half throughout).
 */
let padDetent = 'peek';
function padding(detent = padDetent) {
  if (isDesktop()) return { top: 24, bottom: 32, left: 24, right: 76 };
  const tb = $('#topbar').getBoundingClientRect().bottom || 62;
  const d = sheet.detents();
  return { top: Math.round(tb + 48), bottom: Math.round((detent === 'peek' ? d.peek || 206 : d.half || 420) + 8), left: 20, right: 64 };
}
function updatePadding(detent) { if (detent) padDetent = detent; if (S.tm) S.tm.setPadding?.(padding()); }
addEventListener('resize', () => { clearTimeout(updatePadding.t); updatePadding.t = setTimeout(updatePadding, 200); });
desktopMQ.addEventListener('change', () => { if (isDesktop()) $('#pane').style.transform = ''; else sheet.snap(sheet.detent, { instant: true }); updatePadding(); viewEl.__html = ''; render(); });

// ------------------------------------------------------------------ map: basemap, network, trains, 3D
function focusMap() {
  const { name, id } = screen();
  const f = name === 'station' || name === 'train' || name === 'line' ? [name, id] : [null, null];
  try { S.layer?.focus?.(f[0], f[1]); } catch (e) { console.warn('[tokyo] layer.focus', e); }
  syncLiveOnly();   // the picked line / train stay on the map under the Live filter
  try { netFocus(f[0], f[1]); } catch (e) { console.warn('[tokyo] network focus', e); }
  if (!S.network) fallbackNetFocus(f[0], f[1], !S.layer);
  if (S.on3D && S.city3d) { try { S.city3d.setLine?.(name === 'line' ? id : null); if (name !== 'train') S.city3d.setSelected?.(null); } catch { /* fine */ } }
}
const pickOpen = (type, id) => open(type, id);
/** style.js's network: the picked line in its colour (a line, or a train's line), the picked station ringed. */
function netFocus(type, id) {
  const n = S.network;
  if (!n || !S.model) return;
  if (type === 'line') { n.clear?.(); n.highlightLine?.(id); }
  else if (type === 'train') { n.clear?.(); const r = S.ix.runByKey.get(id) || S.sim?.runById?.get(id); if (r) n.highlightLine?.(S.model.lines[r.line]?.id); }
  else if (type === 'station') { n.clear?.(); const si = S.ix.stationIx.get(id); if (si != null) n.highlightStation?.(si); }
  else n.clear?.();
}

async function attachMapLayers() {
  if (!S.mapReady || !S.model || !S.map || attachMapLayers.done) return;
  attachMapLayers.done = true;
  await need('types');
  const opts = { lang: I.lang(), open: pickOpen, now: () => NOW(), sec: serviceSec, t, title: I.title, runs: S.runs, sim: S.sim,
    typeStyle: loaded.types?.typeStyle, typeLabel: loaded.types?.typeLabel };
  // the trains go in first and the rail network right after the frame that draws them, in its own
  // task (its build is ~0.2 s at 4x CPU; together with the trains it held the first trains back by a frame or two).
  // MapLibre needs its worker to cut the network's GeoJSON anyway, so the lines never came in the trains' first frame.
  const netMod = await need('networkLayer');
  const hasNet = typeof netMod?.addNetwork === 'function';
  const elevNow = S.elev || null;   // the line heights loaded with the data: the network and the trains built once
  // trains, under the station names (trains go before NET_LABELS_BEFORE, once the network is in)
  const layerMod = await need('layer');
  const mkLayer = layerMod?.createLayer || layerMod?.createTrainsLayer || layerMod?.default;
  const below = () => S.network?.labelsBefore || loaded.networkLayer?.NET_LABELS_BEFORE;
  const trainsUnder = () => { const b = below(); if (b && S.map.getLayer(b)) for (const id of ['tokyo-trains', 'tokyo-picked-ring']) if (S.map.getLayer(id)) S.map.moveLayer(id, b); };
  if (typeof mkLayer === 'function') {
    const lanePx = loaded.networkLayer?.lanePx;
    try {
      S.layer = await mkLayer(S.map, S.model, { ...opts, elev: elevNow || false, stationTaps: !hasNet, ...(typeof lanePx === 'function' ? { lanePx } : {}) });
      trainsUnder();
    } catch (e) { console.warn('[tokyo] trains layer failed', e); S.layer = null; S.errors.push(`layer: ${e?.message || e}`); }
  }
  // the line heights (tunnels dashed on the network, trains' underground look, viaducts in 3D): fetched once with the
  // data (loadReal), shared; applied here only when they came after the layers went in
  if (!elevNow) {
    (S.elevP || (S.elevP = loadElev().then((j) => { if (j) S.elev = j; return j; }))).then((json) => {
      if (!json) return;
      S.elev = json;
      try { S.network?.setElevation?.(json); } catch (e) { console.warn('[tokyo] network elevation', e); }
      try { S.layer?.setElevation?.(json); } catch (e) { console.warn('[tokyo] trains elevation', e); }
    });
  }
  focusMap();
  { const sc = screen(); if (sc.name === 'train' && !S.tv.follow) setupFollow(sc.name, sc.id); }   // a #t= link opened cold
  try { S.chromeSync = chromeBlockers(S.map); } catch (e) { console.warn('[tokyo] chrome blockers', e); }
  // ready once the first trains are drawn (the frame that drew them, not the map's next idle: with the trains
  // moving and the labels fading in, that came ~3 s later); with no train to draw (night) the map's next idle; 3 s at most
  await new Promise((r) => {
    let done = false;
    const drawn = () => { try { return (S.layer?.stats?.().drawn || 0) > 0; } catch { return false; } };
    const onRender = () => { if (drawn()) fin(); };   // MapLibre's 'render' comes right after each frame is drawn
    const fin = () => { if (done) return; done = true; S.map.off('render', onRender); r(); };
    S.map.once('idle', fin);
    S.map.on('render', onRender);
    setTimeout(fin, 3000);
    onRender();
  });
  gate.layers = true; settle();
  // rail network + stations (style.js's addNetwork), else the page's own calm lines and dots: in a task of its own
  await new Promise((r) => setTimeout(r, 0));
  if (hasNet) {
    try {
      S.network = netMod.addNetwork(S.map, S.model, {
        lang: I.lang(), ...(elevNow || S.elev ? { elev: elevNow || S.elev } : {}),
        deferData: (flush) => { S.netFlush = flush; },   // its GeoJSON goes to MapLibre after ready, one source per task
        onStation: (i) => { const s = S.model.stations[i]; if (s) open('station', s.id); },
        onLine: (i) => { const l = S.model.lines[i]; if (l) open('line', l.id); },
      });
    } catch (e) { console.warn('[tokyo] network layer failed, drawing the fallback', e); S.errors.push(`networkLayer: ${e?.message || e}`); S.network = null; }
  }
  if (!S.network) fallbackNetwork();
  trainsUnder();
  chromeSync();   // the blockers back on top of the network's names
  // station exits: loaded on the first station screen; the layer mounts once the map is up
  if (loaded.exits || screen().name === 'station') ensureExits();
  focusMap();
  exitsFocus(screen().name, screen().id);
  // after ready (the map's 'load' too: data sent before it would hold 'load' back until the network's tiles
  // are cut) the network's lines, dots and names go to MapLibre, one source per task
  readyP.then(() => setTimeout(() => { const f = S.netFlush; S.netFlush = null; f?.(); }, 0));
  if (screen().name === 'bus') toggleBuses(true);   // a #b= link opened cold
}

/**
 * After a WebGL context loss + restore (iOS Safari does it to background tabs) MapLibre brings the style back WITHOUT
 * custom layers: the trains go. Re-create the trains layer; if that fails, or the 3D city was on,
 * reload the page (the hash keeps the screen).
 */
async function restoreLayers() {
  if (!S.map || !S.layer || S.map.getLayer('tokyo-trains')) return;
  if (S.on3D) { location.reload(); return; }
  try {
    try { S.layer.destroy?.(); } catch { /* half gone already */ }
    const layerMod = loaded.layer, mk = layerMod?.createLayer || layerMod?.default;
    const lanePx = S.network?.lanePx || loaded.networkLayer?.lanePx;
    S.layer = await mk(S.map, S.model, { lang: I.lang(), open: pickOpen, now: () => NOW(), sec: serviceSec, t, title: I.title, runs: S.runs, sim: S.sim,
      typeStyle: loaded.types?.typeStyle, typeLabel: loaded.types?.typeLabel, elev: S.elev || false, stationTaps: !S.network, ...(typeof lanePx === 'function' ? { lanePx } : {}) });
    const below = S.network?.labelsBefore || loaded.networkLayer?.NET_LABELS_BEFORE;
    if (below && S.map.getLayer(below)) for (const id of ['tokyo-trains', 'tokyo-picked-ring']) if (S.map.getLayer(id)) S.map.moveLayer(id, below);
    focusMap();
    if (!S.map.getLayer('tokyo-trains')) location.reload();
  } catch (e) { console.warn('[tokyo] trains after a GL restore', e); location.reload(); }
}

/**
 * No map name under
 * the floating chrome. One invisible icon the size of each floating card (controls, clock chip, Scheduled pill, top bar,
 * 3D chip row), kept on top of the symbol stack like network-layer.js's tk-blk dots: MapLibre's collision index then
 * moves the names to another anchor or hides them there (trains.js's labels read the same index). Returns sync():
 * call it after the chrome changes (screen switch, 3D row, pill word, loading over); moveend + resize call it by
 * themselves. sync() is cheap when nothing moved (same boxes, layer already on top: no setData).
 */
function chromeBlockers(map) {
  const SEL = '#ctrls .ccard, #tk-tl .tk-pbchip .tk-pill, #sched .tk-pill, #topbar .segwrap, #topbar .round, #tk-c3dctl .tk3d-ctl';
  const shown = (el) => (el.checkVisibility ? el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) : el.getClientRects().length > 0);
  let last = '';
  const sync = () => {
    const src = map.getSource('tk-chrome');
    if (!src) return;
    const cv = map.getCanvas().getBoundingClientRect(), feats = [], sig = [];
    for (const el of document.querySelectorAll(SEL)) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      const x0 = Math.max(r.left, cv.left), y0 = Math.max(r.top, cv.top), x1 = Math.min(r.right, cv.right), y1 = Math.min(r.bottom, cv.bottom);
      if (x1 - x0 < 2 || y1 - y0 < 2) continue;
      const w = Math.round(x1 - x0 + 4), h = Math.round(y1 - y0 + 4), id = `tk-chrome-${w}x${h}`;
      if (!map.hasImage(id)) map.addImage(id, { width: w, height: h, data: new Uint8Array(w * h * 4) });
      const ll = map.unproject([(x0 + x1) / 2 - cv.left, (y0 + y1) / 2 - cv.top]);
      feats.push({ type: 'Feature', properties: { img: id }, geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } });
      sig.push(`${id}@${ll.lng.toFixed(6)},${ll.lat.toFixed(6)}`);
    }
    const order = typeof map.getLayersOrder === 'function' ? map.getLayersOrder() : map.getStyle().layers.map((l) => l.id);
    const onTop = order[order.length - 1] === 'tk-chrome';
    if (!onTop) map.moveLayer('tk-chrome');   // placed first = wins
    const key = sig.join('|');
    if (onTop && key === last) return;
    last = key;
    src.setData({ type: 'FeatureCollection', features: feats });
  };
  map.addSource('tk-chrome', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'tk-chrome', type: 'symbol', source: 'tk-chrome',
    layout: { 'icon-image': ['get', 'img'], 'icon-allow-overlap': true, 'icon-ignore-placement': false,
      'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport', 'icon-padding': 0 },
    paint: { 'icon-opacity': 0 } });
  map.on('moveend', sync);
  addEventListener('resize', () => { clearTimeout(sync.t); sync.t = setTimeout(sync, 250); });
  sync();
  return sync;
}
const chromeSync = () => { try { S.chromeSync?.(); } catch (e) { console.warn('[tokyo] chrome blockers', e); } };

/** The page's own rail network until style.js's network-layer.js lands: grey lines, white station dots, names. */
function fallbackNetwork() {
  const map = S.map, m = S.model;
  const lines = { type: 'FeatureCollection', features: m.lines.filter((l) => !l.hidden && l.path?.length > 1).map((l) => ({ type: 'Feature', properties: { id: l.id, color: l.color || '#8B8B93' }, geometry: { type: 'LineString', coordinates: l.path } })) };
  const seen = new Set();
  const pts = [];
  for (let si = 0; si < m.stations.length; si++) {
    const s = m.stations[si]; const g = s.group >= 0 ? `g${s.group}` : `s${si}`;
    if (!Number.isFinite(s.lng) || !Number.isFinite(s.lat)) continue;
    pts.push({ type: 'Feature', properties: { si, id: s.id, en: s.name.en, ja: s.name.ja, label: seen.has(g) ? 0 : 1 }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } });
    seen.add(g);
  }
  map.addSource('tk-lines', { type: 'geojson', data: lines });
  map.addSource('tk-stations', { type: 'geojson', data: { type: 'FeatureCollection', features: pts } });
  map.addLayer({ id: 'tk-line', type: 'line', source: 'tk-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9A9AA2', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 14, 3], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'tk-line-focus', type: 'line', source: 'tk-lines', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 6] } });
  map.addLayer({ id: 'tk-station', type: 'circle', source: 'tk-stations', minzoom: 10.5, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5], 'circle-color': '#FFFFFF', 'circle-stroke-width': 1.5, 'circle-stroke-color': '#6B6B70' } });
  map.addLayer({ id: 'tk-station-name', type: 'symbol', source: 'tk-stations', minzoom: 10.6, filter: ['==', ['get', 'label'], 1],
    layout: { 'text-field': ['get', I.lang() === 'ja' ? 'ja' : 'en'], 'text-font': MAP_FONT, 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-padding': 3 },
    paint: { 'text-color': '#4A4A52', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 } });
  map.on('click', 'tk-station', (e) => { const f = e.features?.[0]; if (f && !e.defaultPrevented) open('station', f.properties.id); });
  map.on('mouseenter', 'tk-station', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'tk-station', () => { map.getCanvas().style.cursor = ''; });
  S.fallbackNet = true;
}
function fallbackNetLang() { if (S.fallbackNet && S.map?.getLayer('tk-station-name')) S.map.setLayoutProperty('tk-station-name', 'text-field', ['get', I.lang() === 'ja' ? 'ja' : 'en']); }
function fallbackNetFocus(type, id, camera = true) {
  if (!S.fallbackNet || !S.map || !S.model) return;
  let lineId = '';
  if (type === 'line') lineId = id;
  else if (type === 'train') { const r = S.ix.runByKey.get(id); lineId = r ? S.model.lines[r.line]?.id || '' : ''; }
  S.map.setFilter('tk-line-focus', ['==', ['get', 'id'], lineId]);
  const reduced = reduceMotion();
  if (!camera) return;
  if (type === 'line' && lineId) {
    const l = S.ix.line(lineId);
    const bb = [[Infinity, Infinity], [-Infinity, -Infinity]];
    for (const [x, y] of l.path) { bb[0][0] = Math.min(bb[0][0], x); bb[0][1] = Math.min(bb[0][1], y); bb[1][0] = Math.max(bb[1][0], x); bb[1][1] = Math.max(bb[1][1], y); }
    S.map.fitBounds(bb, { padding: 40, maxZoom: 14, duration: reduced ? 0 : 600 });
  } else if (type === 'station') {
    const s = S.ix.station(id);
    if (s) S.map.easeTo({ center: [s.lng, s.lat], zoom: Math.max(14.5, S.map.getZoom()), duration: reduced ? 0 : 450 });
  }
}

async function toggle3D(want, quiet = false) {   // quiet: no tilt / Shinjuku flight of its own
  const on = want == null ? !S.on3D : !!want;
  if (on === S.on3D) return;
  S.on3D = on;
  $('#b-3d').setAttribute('aria-pressed', String(on));
  app.toggleAttribute('data-3d', on);
  if (on && !S.city3d && S.map) {
    const c = await need('city3d');
    const mk = c?.mountCity3d || c?.default;
    if (typeof mk === 'function') {
      try {
        const [hasHeights, hasDepths, hasTunnels] = await Promise.all([hasPack('elev-latest.json'), hasPack('elev-v2.json'), hasPack('tunnels-v1.json')]);
        S.city3d = await mk(S.map, { model: S.model, sim: S.sim, runs: S.runs, net: S.model, elev: S.elev || (hasHeights ? undefined : null), lang: I.lang(), beforeId: S.network?.labelsBefore, now: NOW, layer2d: S.layer || undefined,
          ...(hasDepths ? {} : { elev2: null }), ...(hasTunnels ? {} : { tunnels: null }) });
        S.city3d?.setSelected?.(screen().name === 'train' ? screen().id : null);
        S.city3d?.onChange?.((st) => { $('#b-ug').setAttribute('aria-pressed', String(!!st.underground)); });   // the underground view
        // the 3D city's own row (Underground + Shinjuku / Shibuya / Tokyo Station / Ikebukuro), shown while 3D is on; its host
        // sits right after the map controls (Tab order), unpositioned (the row places itself in #app)
        if (S.city3d && !S.c3dCtl && typeof c?.mountCity3dControls === 'function') {
          const host = document.createElement('div'); host.id = 'tk-c3dctl'; $('#ctrls').after(host);
          try { S.c3dCtl = c.mountCity3dControls(host, S.city3d, { lang: I.lang() }); } catch (e) { console.warn('[tokyo] 3D controls', e); S.c3dCtl = null; }
        }
      } catch (e) { console.warn('[tokyo] city3d failed', e); S.errors.push(`city3d: ${e?.message || e}`); S.city3d = null; }
    }
  }
  if (S.city3d) {
    let ok = true;
    try { ok = (await (S.city3d.setOn || S.city3d.setEnabled || S.city3d.show)?.call(S.city3d, on, quiet ? { tilt: false } : undefined)) !== false; } catch (e) { console.warn('[tokyo] city3d toggle', e); }
    if (on && !ok) { toast(t('city3d.weak')); S.on3D = false; $('#b-3d').setAttribute('aria-pressed', 'false'); app.removeAttribute('data-3d'); return; }
    if (on) {
      const sc = screen();
      try { S.city3d.setLine?.(sc.name === 'line' ? sc.id : null); } catch { /* fine */ }
      // from the opening view (nothing picked, zoomed out) 3D lands on Shinjuku: buildings + viaducts
      if (!quiet && !S.stack.length && S.map.getZoom() < 14 && typeof S.city3d.flyTo === 'function') { try { S.city3d.flyTo('shinjuku'); } catch { /* fine */ } }
    }
  } else S.tm?.set3D?.(on);   // no 3D city module: tilt only
  if (!on) $('#b-ug').setAttribute('aria-pressed', 'false');   // the card button stays; 3D off = underground off (city3d puts its camera back)
  requestAnimationFrame(chromeSync);   // the 3D chip row shows / hides
  if (!on && S.city3d && /[?&]tc=\d/.test(location.search)) setTimeout(() => { if (!S.on3D) dropTiles(['tk3d-buildings', 'tk3d-viaduct']); }, 400);   // A/B only (see TILE_CACHE)
}
// ------------------------------------------------------------------ TransJakarta buses, SIMULATED from the timetable
// Off by default (the page is train-first). The bus button in the control card turns them on: the static pack loads once,
// buses/sim.js works the buses out from the GTFS frequencies (no request), buses draw UNDER the trains. A tap on a bus opens its sheet (#b=<id>).
// They run on the page clock (NOW: playback.js), so a playback moves them like the trains. On by default; BUS_KEY keeps an off.
const busBtn = $('#b-bus');
async function toggleBuses(want) {
  const on = want == null ? !S.busesWant : !!want;
  if (on === !!S.busesWant) return;
  S.busesWant = on; S.busesOn = on;
  try { localStorage.setItem(BUS_KEY, on ? '1' : '0'); } catch { /* storage blocked: this visit only */ }
  busBtn.setAttribute('aria-pressed', String(on));   // at once; the pack loads behind it
  if (S.busesBusy) return;                           // the call already running settles to the newest wish
  S.busesBusy = true;
  try {
    for (;;) {
      const goal = S.busesWant;
      if (goal && !gate.layers) await readyP;        // the bus layer goes in UNDER the trains layer
      if (goal && !S.buses) {
        const m = await need('buses');
        if (typeof m?.mountBuses !== 'function' || !S.map) { S.busesWant = S.busesOn = false; busBtn.setAttribute('aria-pressed', 'false'); return; }
        try {
          S.buses = m.mountBuses(S.map, { lang: I.lang(), open: (type, id) => open(type, id), before: 'tokyo-trains', now: NOW, rate: () => (S.pb ? S.pb.rate() : 1),
            onChange: (st) => {
              if (st?.feed !== S.busN) { S.busN = st?.feed; if (screen().name === 'home') render(); }   // the home's TransJakarta row
              if (S.busSay && st?.on && st.feed) { S.busSay = false; say(t('bus.count', { n: I.fmtNum(st.feed) })); }   // once per switch-on
              if (screen().name === 'bus') render();
            } });
        } catch (e) { console.warn('[tokyo] buses', e); S.errors.push(`buses: ${e?.message || e}`); S.buses = null; S.busesWant = S.busesOn = false; busBtn.setAttribute('aria-pressed', 'false'); return; }
      }
      if (!S.buses) return;
      busBtn.setAttribute('aria-busy', 'true');
      S.busSay = goal;
      let now = false;
      try { now = await S.buses.setOn(goal); } catch (e) { console.warn('[tokyo] buses', e); now = false; }
      busBtn.removeAttribute('aria-busy');
      if (S.busesWant !== goal) continue;            // tapped again meanwhile: settle to the newest
      S.busesWant = S.busesOn = !!now;
      busBtn.setAttribute('aria-pressed', String(!!now));
      if (!now && screen().name === 'bus') back();
      else if (now && screen().name === 'bus') busFocus('bus', screen().id);
      return;
    }
  } finally { S.busesBusy = false; }
}
/** The bus screen: select (ring, dim the other routes, route + stops) and fly to it; elsewhere nothing is selected. */
function busFocus(name, id) {
  if (name === 'bus' && !S.busesOn) { if (gate.layers) toggleBuses(true); return; }   // a #b= link turns them on (cold: attachMapLayers)
  if (!S.buses) return;
  try {
    if (name === 'bus') { S.buses.select(id); S.buses.fly(id); } else S.buses.select(null);
  } catch (e) { console.warn('[tokyo] bus focus', e); }
}
function busView(id) {
  if (!S.buses?.on) return `<div class="empty card"><b>${esc(t('bus.loading'))}</b></div>`;
  // the sheet carries the shared.ph head with its own close X on desktop
  try { return S.buses.view(id, { t, lang: I.lang(), close: isDesktop() }); } catch (e) { console.warn('[tokyo] bus view', e); return ''; }
}
// the card's Underground button = the subway at its depth in ONE tap (3D on, the underground view,
// a tilt that shows depth; from far out a flight to Otemachi first; an open station: there); again = the map as it was
// (3D off again if it was off). city3d's enterUnderground / exitUnderground do the camera. A station sheet's "See it
// underground" (data-act="see-ug") passes its place.
async function toggleUnderground(want, place = null) {
  const ug = $('#b-ug');
  const on = want == null ? ug.getAttribute('aria-pressed') !== 'true' : !!want;
  if (S.ugBusy) return;
  S.ugBusy = true;
  try {
    if (on) {
      if (ug.getAttribute('aria-pressed') !== 'true') S.ugFrom3D = S.on3D;   // what "again" goes back to
      ug.setAttribute('aria-pressed', 'true');
      if (!S.on3D) await toggle3D(true, true);
      if (!S.on3D || !S.city3d?.enterUnderground) { ug.setAttribute('aria-pressed', 'false'); return; }
      const sc = screen(), st = !place && sc.name === 'station' ? S.ix.station(sc.id) : null;
      await S.city3d.enterUnderground({ place: place || (st ? { center: [st.lng, st.lat] } : null) });
      toast(t('city3d.ug.toast'));
    } else {
      ug.setAttribute('aria-pressed', 'false');
      await S.city3d?.exitUnderground?.();
      if (!S.ugFrom3D && S.on3D) await toggle3D(false, true);   // quiet: exitUnderground already put the camera back
    }
  } catch (e) { console.warn('[tokyo] underground', e); }
  finally { S.ugBusy = false; requestAnimationFrame(chromeSync); }
}
/** the card button's tunnel icon + its word (the word shows on desktop; phones: icon + aria-label). */
const UG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 6.5h19"/><path d="M4.5 21.5V15a7.5 7.5 0 0 1 15 0v6.5"/><rect x="9" y="13.5" width="6" height="6.5" rx="1.6"/><path d="M9 16.6h6"/></svg>';
function ugButton() {
  const b = $('#b-ug');
  b.hidden = false;
  b.innerHTML = `${UG_SVG}<span class="tk-ugw" data-i18n="city3d.underground">${esc(t('city3d.underground'))}</span>`;
}
/** A station with a platform below ground (its complex): the sheet's "See it underground". */
function ugStationAct(id) {
  if (!HAS.city3d || S.mapFailed || !S.model) return '';
  const si = S.ix.stationIx.get(id), s = S.model.stations[si];
  if (!s) return '';
  const g = s.group >= 0 ? S.model.groups[s.group] || [si] : [si];
  if (!g.some((x) => S.model.stations[x]?.underground)) return '';
  return `<button type="button" class="kr-save tk-seeug" data-act="see-ug" data-id="${esc(id)}">${UG_SVG.replace('<svg ', '<svg class="i" ')}${esc(t('city3d.see'))}</button>`;
}
function seeUnderground(id) {
  const s = S.ix.station(id);
  if (!s) return;
  if (!isDesktop() && sheet.detent !== 'peek') sheet.snap('peek');
  toggleUnderground(true, { center: [s.lng, s.lat] });
}
// "Ride in the tunnel" on a train whose line runs underground: the underground view on,
// then city3d rides along with it (a chase camera in its bore); back (the sheet closes), Reset view or Underground off end it
function ugTrainAct(id) {
  if (!HAS.city3d || S.mapFailed || !S.model) return '';
  const run = S.ix.runByKey?.get?.(id) || S.sim?.runById?.get?.(id);
  if (!run || !S.model.lines[run.line]?.underground) return '';
  return `<button type="button" class="btn tk-seeug tk-ride" data-act="ride-ug" data-id="${esc(id)}">${UG_SVG.replace('<svg ', '<svg class="i" ')}${esc(t('city3d.ug.ridetrain'))}</button>`;
}
function withRide(html, id) {
  const b = ugTrainAct(id);
  if (!b || typeof html !== 'string') return html;
  const m = /<button[^>]*data-act="tv-follow"[^>]*>[\s\S]*?<\/button>/.exec(html);   // next to train-view.js's Follow
  return m ? html.slice(0, m.index + m[0].length) + b + html.slice(m.index + m[0].length) : `${html}<div class="kr-acts tk-rideacts">${b}</div>`;
}
async function rideUnderground(id) {
  if (!isDesktop() && sheet.detent !== 'peek') sheet.snap('peek');
  // the map's padding follows the peek sheet too (the train screen set it for the half sheet: 430 px under a 206 px
  // sheet put the ride camera's aim 160 px high, the train under the ride buttons)
  if (!isDesktop()) updatePadding('peek');
  if ($('#b-ug').getAttribute('aria-pressed') !== 'true') await toggleUnderground(true);
  try { if (!S.city3d?.ride?.(id, { sheet: true })) toast(t('city3d.ug.ridenone')); } catch (e) { console.warn('[tokyo] ride', e); }
}
// the underground view end (round 3)
/**
 * Map taps: what is actually UNDER the finger wins (capture on the map container,
 * before the trains layer's own listener):
 *   1-2. a station's NAME (on its letters = 0 px; on its 2 px padded margin = 3 px), a station DOT (its drawn disc +
 *      2 px = 0; within 4 px more = within reach) and a TRAIN under the finger (its label box, or its drawn body + 8 px:
 *      the segment along its way, half its drawn length each side): the NEAREST geometry wins, a tie goes to the
 *      station;
 *   3. nothing under the finger: the trains layer's own rule (the nearest train within ~22 px), else style.js's
 *      station hit (12 px), else the bus layer.
 * A thumb ON a moving train between stations opens that train; every placed name opens its station.
 * In 3D, the 3D city's pick() answers first (2D trains hide). QA: window.__tokyo.tapAt(clientX, clientY) = the decision.
 */
let downAt = null;   // where the pointer went down: a click after a drag is no tap
const NAME_LAYERS = ['tk-pick-label', 'tk-nlabel', 'tk-glabel', 'tk-slabel'];
const DOT_LAYERS = ['tk-pick-dot', 'tk-mdot', 'tk-sdot', 'tk-gdot'];
/** Station index under (x, y) on the network's name layers (box = the name; +-r px), nearest anchor first. */
function stationAt(x, y, layers, r) {
  const ids = layers.filter((id) => S.map.getLayer(id) && S.map.getLayoutProperty(id, 'visibility') !== 'none');
  if (!ids.length) return null;
  let best = null, bd = Infinity;
  for (const f of S.map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: ids })) {
    const si = f.properties?.s;
    if (si == null || !S.model.stations[si]) continue;
    const ll = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    const q = ll ? S.map.project(ll) : { x, y };
    const d = Math.hypot(q.x - x, q.y - y);
    if (d < bd) { bd = d; best = si; }
  }
  return best;
}
/**
 * A station NAME under the finger: { si, d } with d = 0 when the finger is on its letters, d = 3 when it is only on the
 * label's margin; null when no name is there.
 * "On its letters" = inside the label's collision box shrunk to its glyphs: style.js's 2 px text-padding on every side
 * (less 1 px for the finger) and, vertically, the line-height slack above / below the letters (~2 px more): the four
 * points 1 px left / right and 4 px above / below the finger all still hit the same name.
 */
function nameAt(x, y) {
  const si = stationAt(x, y, NAME_LAYERS, 1);
  if (si == null) return null;
  const IX = 1, IY = 4;
  const on = [[x - IX, y], [x + IX, y], [x, y - IY], [x, y + IY]].every(([px, py]) => stationAt(px, py, NAME_LAYERS, 0.5) === si);
  return { si, d: on ? 0 : 3 };
}
/**
 * The station dot nearest the finger: { si, d: px from its drawn disc (0 = on it, +2 px for the finger) } or null when
 * none is within 4 px. The disc is style.js's: lanes x lanePx(z) wide (hub 3.4, picked 3.0, station 2.5 x its dsc),
 * drawn around the station point (a lane offset of a few px at most); the icon's own box is twice the disc (SDF margin),
 * so queryRenderedFeatures alone would call a finger 6 px off the dot "on it".
 */
function dotAt(x, y) {
  const ids = DOT_LAYERS.filter((id) => S.map.getLayer(id) && S.map.getLayoutProperty(id, 'visibility') !== 'none');
  if (!ids.length) return null;
  const lp = S.network?.lanePx || loaded.networkLayer?.lanePx;
  const lane = typeof lp === 'function' ? Math.abs(lp(S.map.getZoom())) || 1.7 : 1.7;
  let best = null;
  for (const f of S.map.queryRenderedFeatures([[x - 12, y - 12], [x + 12, y + 12]], { layers: ids })) {
    const si = f.properties?.s;
    if (si == null || !S.model.stations[si] || f.geometry?.type !== 'Point') continue;
    const q = S.map.project(f.geometry.coordinates);
    const lanes = f.layer?.id === 'tk-gdot' ? 3.4 : f.layer?.id === 'tk-pick-dot' ? 3.0 : 2.5 * (Number(f.properties?.dsc) || 1);
    const d = Math.max(0, Math.hypot(q.x - x, q.y - y) - (lanes * lane) / 2 - 2);
    if (d <= 4 && (!best || d < best.d)) best = { si, d };
  }
  return best;
}
// trains.js's drawn length by zoom (trains.js trainSizes().len): the body reaches half of it each way from its centre
const LEN_Z = [[9, 13], [11, 17], [12, 23], [13, 34], [14, 54], [15, 78], [16, 112], [17, 152], [18, 200]];
const lenAt = (z) => { if (z <= LEN_Z[0][0]) return LEN_Z[0][1]; for (let i = 1; i < LEN_Z.length; i++) if (z <= LEN_Z[i][0]) { const [z0, a] = LEN_Z[i - 1], [z1, b] = LEN_Z[i]; return a + ((b - a) * (z - z0)) / (z1 - z0); } return LEN_Z[LEN_Z.length - 1][1]; };
/** The train under the finger: { run, d: px from its drawn body (0 = on it), why } or null (nothing within 8 px). */
function trainUnder(x, y) {
  const L = S.layer;
  if (!L?.trains?.hit) return null;
  try {
    const lab = (L.labels?.() || []).find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (lab) return { run: S.sim?.runById?.get(lab.id) || null, d: 0, why: 'label' };
    const run = L.trains.hit(x, y);
    if (!run) return null;
    const p = (L.trains.positions?.() || []).find((q) => q.run === run || q.id === run.id);
    if (!p) return null;
    const c = S.map.project([p.lng, p.lat]);
    // its way here: from the stop it left to the next one (a train standing at a stop: the leg it came along)
    let u = null;
    const st = run.stops || [], sec = serviceSec();
    let i = st.findIndex((x2, k) => k < st.length - 1 && (st[k + 1].a ?? st[k + 1].d) >= sec);
    if (i < 0) i = st.length - 2;
    const A = S.model.stations[st[Math.max(0, i)]?.s], B = S.model.stations[st[Math.max(1, i + 1)]?.s];
    if (A && B && A !== B) { const a2 = S.map.project([A.lng, A.lat]), b2 = S.map.project([B.lng, B.lat]); const dx = b2.x - a2.x, dy = b2.y - a2.y, n = Math.hypot(dx, dy); if (n > 1) u = [dx / n, dy / n]; }
    const h = lenAt(S.map.getZoom()) / 2, vx = x - c.x, vy = y - c.y;
    let d;
    if (u) { const t = Math.max(-h, Math.min(h, vx * u[0] + vy * u[1])); d = Math.hypot(vx - u[0] * t, vy - u[1] * t) - 2; }
    else d = Math.hypot(vx, vy) - h;
    d = Math.max(0, d);
    return d <= 8 ? { run, d, why: 'body' } : null;
  } catch { return null; }
}
/** What a tap at client (cx, cy) opens: { type: 'station', si, why } | { type: 'train', run, why } | null. */
function tapDecision(cx, cy) {
  if (!S.map || !S.model) return null;
  const rect = S.map.getCanvas().getBoundingClientRect();
  const x = cx - rect.left, y = cy - rect.top;
  if (S.on3D) {
    let hit = null;
    try { hit = S.city3d?.pick?.(x, y) || null; } catch { hit = null; }
    const run = hit?.run || (hit?.id ? S.sim?.runById?.get(hit.id) : null);
    return run || hit?.id ? { type: 'train', run, id: hit?.id, why: '3d' } : null;
  }
  if (!S.network) return null;
  let nm = null, dot = null;
  try { nm = nameAt(x, y); } catch { nm = null; }
  try { dot = dotAt(x, y); } catch { dot = null; }
  const tr = trainUnder(x, y);
  // the station's nearer geometry (its name or its dot) against the train's: the nearer wins, a tie goes to the station
  let st = nm ? { si: nm.si, d: nm.d, why: nm.d === 0 ? 'name' : 'name-near' } : null;
  if (dot && (!st || dot.d < st.d)) st = { si: dot.si, d: dot.d, why: dot.d === 0 ? 'dot' : 'dot-near' };
  if (st && (!tr || st.d <= tr.d)) return { type: 'station', si: st.si, why: st.why };
  if (tr) return { type: 'train', run: tr.run, why: tr.why };
  let near = null;
  try { near = S.layer?.trains?.hit?.(x, y) || null; } catch { near = null; }
  if (near) return { type: 'train', run: near, why: 'nearest' };
  let h = null;
  try { h = S.network.hit?.({ x, y }, 12) || null; } catch { h = null; }
  return h?.type === 'station' ? { type: 'station', si: h.index, why: 'net12' } : null;
}
function mapTapFirst(e) {
  if (!S.map || !S.model || e.target?.closest?.('.maplibregl-marker, .tm-attrib')) return;
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const d = tapDecision(e.clientX, e.clientY);
  if (!d) return;
  if (d.type === 'station' && d.why !== 'net12') {   // net12 = style.js's own click handler opens it
    const st = S.model.stations[d.si];
    if (st) { e.preventDefault(); e.stopPropagation(); open('station', st.id); }
    return;
  }
  if (d.why === '3d') { e.preventDefault(); e.stopPropagation(); open('train', d.run?.key || d.id); }
  // a 2D train: the trains layer's own capture listener opens it (its label first, else the nearest train)
}

// ------------------------------------------------------------------ data: real packs when DATA lanes land, else model.js's fixture
const gate = { map: false, data: false, layers: false };
let readyResolve;
const readyP = new Promise((r) => { readyResolve = r; });
readyP.then(() => { if (!S.stack.length && S.tab === 'home') sayCount(); });   // the count, once, when the trains are in
function settle() {
  if (gate.map && gate.data && (gate.layers || S.mapFailed || !S.model)) readyResolve(stats());
}
setTimeout(() => readyResolve({ ...stats(), timeout: true }), 45000);

const DATA = '/data/tokyo';
const FIRST_AHEAD = 5 * 60;   // the first window: the hour on the clock (+ the next in its last 5 min)
async function getJSON(url) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 20000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`${url} -> ${r.status}`); return await r.json(); } finally { clearTimeout(to); }
}
/** the network build's network pack (network-latest.json -> network-v1.json), unpacked by net.js. */
async function loadNetwork() {
  const net = await need('net');
  if (typeof net?.unpackNet !== 'function') return null;
  const ptr = await getJSON(`${DATA}/network-latest.json`).catch((e) => { if (/-> 404$/.test(e.message)) return null; throw e; });
  const file = ptr?.file || 'network-v1.json';
  return net.unpackNet(await getJSON(`${DATA}/${file}${ptr?.hash ? `?h=${ptr.hash}` : ''}`));
}
/**
 * Which packs `npm run data` built (packs.json lists them): the optional ones (heights, tunnels, depths, buses) are only
 * fetched when they are there, so a core build shows no 404s. No packs.json (an older build) = ask for each.
 */
let packsP = null;
function hasPack(file) {
  packsP = packsP || getJSON(`${DATA}/packs.json`).then((j) => (Array.isArray(j?.files) ? new Set(j.files) : null)).catch(() => null);
  return packsP.then((set) => !set || set.has(file));
}
/** The line heights elev-v1.json (elev-latest.json names the file); null when it is not there. */
async function loadElev() {
  if (!await hasPack('elev-latest.json')) return null;
  try {
    const ptr = await getJSON(`${DATA}/elev-latest.json`);
    return await getJSON(`${DATA}/${ptr?.file || 'elev-v1.json'}`);
  } catch (e) { if (!/-> 404$/.test(e.message)) console.warn('[tokyo] elevation', e); return null; }
}
/**
 * The whole network + today's timetable around now (the timetable build's buckets: now-1h .. now+3h first, the rest after).
 * null = the packs or their modules are not there (dev: the fixture); a network / server error THROWS (
 * a dropped connection must show the error card and retry, never a silent 2-line fixture).
 */
async function loadReal() {
  const [tt, cal] = await Promise.all([need('tt'), need('calendar'), need('model')]);
  if (typeof tt?.loadRuns !== 'function' || typeof tt?.loadPointer !== 'function') return null;
  // ONE request for the pointer (404 = no packs -> the fixture; other errors still throw), and the network
  // pack downloads at the same time as the timetable
  let packs = 'ok';
  const ptrP = tt.loadPointer({ base: DATA, fetch: async (u, o) => { const r = await fetch(u, o); if (r.status === 404) packs = 'absent'; return r; } });
  const netP = loadNetwork();
  netP.catch(() => {});
  // the line heights come with the network, so the network and the trains are built once with them (a
  // late setElevation rebuilt and re-sent the whole network: one ~0.5 s task at 4x CPU after the first trains)
  if (!S.elevP) S.elevP = loadElev().then((json) => { if (json) S.elev = json; return json; });
  const ptr = await ptrP.catch((e) => { if (packs === 'absent') return null; throw e; });
  if (packs === 'absent' || !ptr) return null;
  if (!ptr?.cals) throw new Error('tt-latest.json has no calendars');
  const at = typeof cal?.calendarAt === 'function' ? cal.calendarAt(Date.now()) : null;
  const cals = at?.cals?.length ? at.cals : ['weekday'];
  const sec = at?.sec ?? serviceSec();
  // before the first view only the hour bucket on the clock (+ the next one in the hour's last 5
  // minutes; keepAhead adds the half hour behind and the hour ahead right after ready()). Everything else
  // loads when something needs it (ensureWindow below): the next hours as the clock gets there, the rest of the day
  // for a station board, a line or a train's whole journey. The whole day used to load 2.5 s after the first trains
  // (~1.2 MB and ~1 s of main thread at 4x CPU, while the first view was still settling).
  const first = typeof tt.loadWindow === 'function'
    ? tt.loadWindow({ base: DATA, cal: cals, fromSec: sec, toSec: sec + FIRST_AHEAD })
    : tt.loadRuns({ base: DATA, cal: cals, fromSec: sec - 3600, toSec: sec + 3 * 3600 }).then((runs) => ({ runs, from: sec - 3600, to: sec + 3 * 3600 }));
  let [net, win] = await Promise.all([netP, first]);
  // nothing in that hour (03:00-04:00, before the first train): the next hour too, so the home can say when it leaves
  if (typeof tt.loadWindow === 'function' && win && !win.runs?.length && win.to < 27 * 3600) win = await tt.loadWindow({ base: DATA, cal: cals, fromSec: sec, toSec: win.to + 3600 });
  if (!net?.lines?.length) throw new Error('network pack empty');
  if (!Array.isArray(win?.runs)) throw new Error('timetable window empty');
  return { net, runs: win.runs, from: win.from, to: win.to, cals, calendar: cals[cals.length - 1] === 'holiday' && cals.length > 1 ? 'holiday' : cals[0], source: 'data', sec, date: at?.date || null };
}
async function loadFixture() {
  const fx = await need('fixture');
  await need('model');
  if (!fx?.model || !fx?.runs) return null;
  return { net: fx.model, runs: fx.runs, cals: [fx.model.calendar || 'holiday'], calendar: fx.model.calendar || 'holiday', source: 'fixture' };
}
/** Korean / Chinese station and line names (the network build side file) for search, after first paint. */
async function moreNames() {
  const net = loaded.net;
  if (typeof net?.mergeNames !== 'function' || typeof loaded.search?.createSearch !== 'function' || S.namesMerged) return;
  try {
    const ptr = await getJSON(`${DATA}/network-latest.json`).catch(() => null);
    const file = (ptr?.file || 'network-v1.json').replace(/\.json$/, '-names.json');
    net.mergeNames(S.model, await getJSON(`${DATA}/${file}${ptr?.hash ? `?h=${ptr.hash}` : ''}`));
    S.namesMerged = true;
    S.searchObj = loaded.search.createSearch(S.model, null);
    S.searchObj?.warm?.();
  } catch (e) { console.warn('[tokyo] names', e); }
}
/** search.js's index + its keyboard keys, once its module is in (at boot when the search field has the focus or a query,
 *  else on the field's first focus or at idle after ready). */
function setupSearch() {
  if (S.searchObj || typeof loaded.search?.createSearch !== 'function' || !S.model) return;
  try {
    S.searchObj = loaded.search.createSearch(S.model, null);
    if (!S.searchKeys && typeof loaded.search.searchKeys === 'function') { try { loaded.search.searchKeys(qInput, $('#pbody')); S.searchKeys = true; } catch { /* fine */ } }
    if (loaded.search.SEARCH_CSS && !document.getElementById('tk-search-css')) { const el = document.createElement('style'); el.id = 'tk-search-css'; el.textContent = loaded.search.SEARCH_CSS; document.head.append(el); }
    if (document.activeElement === qInput) warmSearch();   // focused while the data loaded
    if (S.q.trim()) { viewEl.__html = ''; render(); }
  } catch (e) { console.warn('[tokyo] search index', e); S.searchObj = null; }
}
/** after the first trains (ready): live positions at once; at an idle moment the hours around now,
 *  what the open screen needs, and the modules of the screens a tap opens next (train, line, search). */
async function afterReady() {
  startLive();
  await idleWait();
  S.afterReady = true;   // from now on every render() also keeps the hours around the clock loaded (keepAhead is cheap)
  keepAhead();
  if (screen().name === 'home') wantScreen();   // the own station's card, the night's first trains (other screens asked at once)
  await Promise.all(['trainView', 'lineView', 'search'].map((k) => need(k)));
  setupSearch();
  viewEl.__html = ''; render();
}
/** the search index warms (and the KO/ZH names load) on the first focus of the search field, not at boot. */
let searchWarmed = false;
function warmSearch() {
  if (searchWarmed || !S.searchObj) return;
  searchWarmed = true;
  try { S.searchObj.warm?.(); } catch { /* fine */ }
  if (S.source === 'data') moreNames();
}
const BACKOFF = [3000, 8000, 20000, 60000, 300000];
const backoff = (n) => BACKOFF[Math.min(n, BACKOFF.length - 1)];
const idleWait = () => new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout: 8000 }) : setTimeout(r, 3000)));
// ------------------------------------------------------------------ the timetable on demand
// The page holds ONE piece of the service day, S.sim.window = { from, to } (service seconds; board.js's coverage() reads it
// for its first / last train claims, playback.js widens it around its clock). It starts as the hour on the clock and grows
// only when something needs more: the next hour as the clock gets there (keepAhead), the rest of the day for a station
// board (later departures, last trains; the morning too for its first trains), the Lines tab and a line (every train
// still to come), the hours of a train's whole journey, the morning at night (tomorrow's first trains). Buckets are
// fetched once (tt.js) and added in slices (model.js addAsync), so no single task blocks the map; offline.js puts the rest of
// today into the worker's cache at idle, so a subway gap later still has every hour.
const TT_FROM = 3 * 3600, TT_TO = 27 * 3600;
const tw = { want: null, busy: null, tries: 0, timer: 0, retryAt: 0 };
S.tw = tw;   // QA: window.__tokyo.state.tw (what is being fetched) next to state.sim.window (what is loaded)
/** Make the loaded window cover [from, to] (service seconds), as one piece with what is loaded. -> runs added. A failed
 *  fetch is retried with backoff (3 s, 8 s, 20 s, 1 min, then every 5 min) and when the connection or the tab comes
 *  back (a subway gap must not freeze the day). */
function ensureWindow(from, to) {
  if (S.source !== 'data' || !S.sim?.add || typeof loaded.tt?.loadRuns !== 'function') return Promise.resolve(0);
  from = Math.max(TT_FROM, Math.floor(from)); to = Math.min(TT_TO, Math.ceil(to));
  const w = S.sim.window;
  if (w && w.from <= from && w.to >= to) return tw.busy || Promise.resolve(0);
  tw.want = tw.want ? { from: Math.min(tw.want.from, from), to: Math.max(tw.want.to, to) } : { from, to };
  if (!tw.busy && Date.now() >= tw.retryAt) { clearTimeout(tw.timer); tw.busy = fillWindow().finally(() => { tw.busy = null; }); }
  return tw.busy || Promise.resolve(0);   // after a failure: the backoff timer (or the connection coming back) retries
}
async function fillWindow() {
  const tt = loaded.tt;
  let added = 0;
  while (tw.want && S.sim) {
    const wish = tw.want, w = S.sim.window || wish;
    const from = Math.min(w.from, wish.from), to = Math.max(w.to, wish.to);   // the hull: the window stays one piece
    if (w.from <= wish.from && w.to >= wish.to) { if (tw.want === wish) tw.want = null; continue; }
    try {
      const got = typeof tt.loadWindow === 'function' ? await tt.loadWindow({ base: DATA, cal: S.cals, fromSec: from, toSec: to })
        : { runs: await tt.loadRuns({ base: DATA, cal: S.cals, fromSec: from, toSec: to }), from, to };
      const n = typeof S.sim.addAsync === 'function' ? await S.sim.addAsync(got.runs) : S.sim.add(got.runs);
      const cur = S.sim.window || got;
      S.sim.window = { from: Math.min(cur.from, got.from), to: Math.max(cur.to, got.to) };
      if (tw.want === wish) tw.want = null;   // a wish merged in meanwhile stays for the next round
      tw.tries = 0; tw.retryAt = 0;
      added += n;
      if (n) { S.runs = S.sim.runs; viewEl.__html = ''; render(); }
    } catch (e) {
      console.warn('[tokyo] timetable hours (will retry)', e);
      const wait = backoff(tw.tries++);
      tw.retryAt = Date.now() + wait;
      tw.timer = setTimeout(retryWindow, wait);
      break;   // tw.want stays: retried later, and at once when the connection or the tab comes back (onBack)
    }
  }
  return added;
}
function retryWindow() {
  if (!tw.want || tw.busy) return;
  clearTimeout(tw.timer);
  tw.retryAt = 0;
  tw.busy = fillWindow().finally(() => { tw.busy = null; });
}
/** The live clock (not a playback): [now - 30 min, now + 1 h] loaded, the next hour's bucket as the clock gets there;
 *  from 21:00 the rest of the night, so the last trains are claimed on time (boards, the home's own station). */
function keepAhead() {
  if (S.source !== 'data' || !S.sim?.window || (S.pb && !S.pb.isLive())) return;
  const now = serviceSec(Date.now()), w = S.sim.window;
  const from = Math.min(w.from, now - 1800), to = Math.max(w.to, now >= 21 * 3600 ? TT_TO : now + 3660);
  if (from < w.from || to > w.to) ensureWindow(from, to);
}
/** What the open screen needs beyond the hours around now: a station board its later departures and last
 *  trains (and its first trains: the morning), the Lines tab and a line every train still to come today, a train the
 *  hours of its whole journey, the home at night tomorrow's first trains; the home's own station a few hours ahead. */
function wantScreen() {
  if (S.source !== 'data' || !S.sim?.window) return;
  const { name, id } = screen();
  if (name === 'station') wantDay(true);
  else if (name === 'line' || name === 'lines') wantDay(true);   // "next 16:30", "the last train has left", never "no trains" for one that ran this morning
  else if (name === 'train') wantTrain(id);
  else if (name === 'home') wantHome();
}
function wantDay(morning) {
  if (!S.sim?.window) return;
  ensureWindow(S.sim.window.from, TT_TO).then(() => { if (morning && morningUseful()) return ensureWindow(TT_FROM, TT_TO); }).catch(() => {});
}
async function wantTrain(id, depth = 0) {
  const tv = await need('trainView');
  if (!S.sim?.window || screen().name !== 'train' || screen().id !== id) return;
  const run = S.sim.runById?.get(id) || S.ix?.runByKey.get(id) || (typeof tv?.runOf === 'function' ? tv.runOf(S.sim, id, NOW()) : null);
  if (!run) { await ensureWindow(TT_FROM, TT_TO); return; }   // a train outside the loaded hours (a shared #t= link)
  if (typeof tv?.journey !== 'function' || depth > 4) return;
  const j = tv.journey(S.sim, run), w = S.sim.window;
  const a = j.runs[0], z = j.runs[j.runs.length - 1];
  const from = j.more?.prev ? Math.min(w.from, (a.first ?? firstT(a)) - 3600) : w.from;
  const to = j.more?.next ? Math.max(w.to, (z.until ?? lastT(z)) + 3600) : w.to;
  if (from < w.from || to > w.to) { if (await ensureWindow(from, to)) wantTrain(id, depth + 1); }
}
function wantHome() {
  // after midnight with no train running: the home says when tomorrow's first one leaves (board.js nextFirst: the morning)
  if (serviceSec() >= 24 * 3600 && runningNow().total === 0 && morningUseful()) { ensureWindow(TT_FROM, TT_TO); return; }
  // the own station's card is a small board: its next trains, its last ones, where each way's trains go TODAY and the
  // train types today are all read from the whole day, as on its board; the day comes in the background, after the
  // first view, in slices (a rider who saved no station never pays for it)
  if (S.home && S.ix?.stationIx.has(S.home)) wantDay(true);
}
/**
 * The morning of the loaded service day (03:00 .. the first window) is worth its ~1.3 MB only while that day's morning
 * still means something: during the day (first trains, the First / Last table), or after midnight when TOMORROW runs the
 * same timetable (the night card then shows tomorrow's first trains from it). After midnight on a night the calendar
 * changes (holiday -> weekday), the 03:00 reload would throw it away: skip it. A playback loads
 * what it needs itself.
 */
function morningUseful() {
  const cal = loaded.calendar;
  if (serviceSec() < 24 * 3600 || typeof cal?.calendarAt !== 'function') return true;
  const next = cal.calendarAt(Date.now() + 86400000)?.cals || [];   // the next service day's timetables
  return next.join() === (S.cals || []).join();
}
/** First load failed (network / server): the error card is up; try again with backoff, and when back online. */
let dataTries = 0, dataTimer = 0, dataBusy = false;
function retryDataLater() {
  clearTimeout(dataTimer);
  dataTimer = setTimeout(() => { if (!S.model && !dataBusy) { S.loadError = false; render(); loadData(); } }, backoff(dataTries++));
}
function onBack() {
  if (!S.model && S.loadError && !dataBusy) { clearTimeout(dataTimer); S.loadError = false; render(); loadData(); return; }
  retryWindow();
  keepAhead();
}
addEventListener('online', onBack);
addEventListener('tokyo:exit-fly', (e) => { if (!isDesktop()) { sheet.snap('peek'); e.preventDefault(); } });   // the exit must not fly under the sheet
document.addEventListener('visibilitychange', () => { if (!document.hidden) onBack(); });
async function loadData() {
  if (dataBusy) return;
  dataBusy = true;
  try {
    let d = await loadReal();          // throws on a network / server error -> the error card + retry below
    if (!d) d = await loadFixture();   // packs not built (dev) -> model.js's fixture; production builds leave it out
    if (!d) throw new Error('no data');
    dataTries = 0;
    S.loadError = false;
    const sim = loaded.model;
    if (typeof sim?.createModel === 'function') {
      try { S.sim = sim.createModel(d.net, d.runs, { calendar: d.calendar }); } catch (e) { console.warn('[tokyo] model.createModel', e); S.sim = null; }
    }
    if (S.sim && d.source === 'data') S.sim.window = { from: d.from ?? d.sec - 3600, to: d.to ?? d.sec + 3 * 3600 };
    else if (S.sim) S.sim.window = { from: 0, to: 97200 };   // the fixture is a whole day
    S.model = S.sim || { ...d.net, runs: d.runs };
    if (!S.model.operators && S.model.ops) S.model.operators = S.model.ops;
    S.runs = S.sim ? S.sim.runs : d.runs;
    S.source = d.source; S.calendar = d.calendar; S.cals = d.cals;
    S.ix = indexData(S.model, S.runs);
    S.date = d.date || loaded.calendar?.serviceDate?.(Date.now()) || null;   // the day the runs belong to
    setTimeout(attachMapLayers, 0);   // trains first (a 2nd call is a no-op); its own task, not createModel's
    // the planner (routeView + route) loads on its first open, exits on the first station screen.
    // the first screen's modules only; the train / line screens and search come at idle after ready
    const sc0 = screen(), first = ['views', 'board', 'credits', 'types'];
    if (sc0.name === 'train') first.push('trainView');
    if (sc0.name === 'line') first.push('lineView');
    if (S.q.trim() || document.activeElement === qInput) first.push('search');
    await Promise.all(first.map((k) => need(k)));
    $('#b-route').hidden = !HAS.routeView;
    setupSearch();
    applyCredits();
    render();
    { const sc = screen(); if (sc.name === 'train' && !S.tv.follow) setupFollow(sc.name, sc.id); if (sc.name === 'station') ensureExits(); }   // a cold #t= / #s= link
    if (screen().name !== 'home') wantScreen();   // a cold #s= / #l= / #t= link: that screen's hours now
    readyP.then(afterReady);
  } catch (e) {
    console.warn('[tokyo] data (will retry)', e);
    S.loadError = true; render();
    retryDataLater();
  } finally { dataBusy = false; gate.data = true; settle(); }
}

/** the offline note, and on the built site the service worker (registered after ready + an idle moment). */
async function startOffline() {
  const o = await need('offline');
  if (typeof o?.initOffline !== 'function' || S.offline) return;
  try {
    S.offline = o.initOffline({ t, lang: I.lang, onLang: I.onLang, ready: readyP, calendar: () => loaded.calendar, map: () => S.map, register: process.env.NODE_ENV === 'production' });
  } catch (e) { console.warn('[tokyo] offline', e); S.offline = null; }
}
/** Live data (npm run live): without the service the feed answers {off: true} and nothing changes on screen. */
async function startLive() {
  const lv = await need('live');
  if (typeof lv?.createLive !== 'function' || !S.sim || S.live) return;
  try {
    S.live = lv.createLive({ model: S.sim });
    S.live.onChange?.(() => { viewEl.__html = ''; render(); });
    S.live.start?.();
    S.pbUi?.gate?.();   // a poller made during a playback stops again
  } catch (e) { console.warn('[tokyo] live', e); S.live = null; }
}
/**
 * At 03:00 WIB the service day turns over: today's timetable is another one, so load the page again. Checked every
 * minute AND when the page comes back (iOS freezes timers in a background tab overnight).
 */
function checkDay() { if (!document.hidden && dayTurned()) location.reload(); }   // hidden: the early listener reloads on show
setInterval(() => { checkDay(); if (!document.hidden) keepAhead(); }, 60000);   // the next hour's bucket as the clock gets there
addEventListener('pageshow', (e) => { if (e.persisted) checkDay(); });

/**
 * MapLibre's tile cache (in WebKit a 3D camera move can add GBs). Measured: a smaller cache (1 zoom level, <= 48 tiles:
 * out-of-view tiles 251 -> 57) changes neither Chromium (~1.04 vs 1.08 GB peak) nor WebKit (a jump to Shinjuku z15.6
 * bearing -20 still passes 2.7 GB in both variants), so the page keeps MapLibre's defaults. A/B hook for whoever digs further: `?tc=<zoomLevels>[,<maxTiles>]`
 * (+ dropping the 3D city's tiles when 3D goes off); `?tc=default` = the defaults.
 */
const TILE_CACHE = {};
function tileCacheOpts() {
  let q = null;
  try { q = new URLSearchParams(location.search).get('tc'); } catch { q = null; }
  if (q === 'default') return {};
  if (q) { const [z, n] = q.split(',').map(Number); return { ...(z > 0 ? { maxTileCacheZoomLevels: z } : {}), ...(n > 0 ? { maxTileCacheSize: n } : {}) }; }
  return TILE_CACHE;
}
/** Drop the tiles of sources nothing shows any more (3D off: the 3D city's buildings + viaducts): their GPU buffers go now,
 *  not when the cache would evict them (MapLibre internals, guarded: a missing API just keeps the tiles). */
function dropTiles(ids) {
  try {
    const tm = S.map?.style?.tileManagers || S.map?.style?.sourceCaches;
    for (const id of ids) tm?.[id]?.clearTiles?.();
  } catch (e) { console.warn('[tokyo] drop tiles', e); }
}

// ------------------------------------------------------------------ boot
const setBar = (k) => { const b = $('#load-bar'); if (b) b.style.width = `${Math.round(10 + 90 * k)}%`; };
/** the Latin glyph range of every font stack the style names, asked for now: MapLibre asks for it only
 *  after its first tiles are parsed (~0.6 s later at fast 4G), then finds it in the HTTP cache (when the glyph
 *  server allows caching). Kana and kanji are drawn on the phone (style.js), never fetched. Returns the style. */
function glyphsEarly(style) {
  try {
    const tpl = style?.glyphs, stacks = new Set();
    for (const l of style?.layers || []) {
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && f.length && f.every((x) => typeof x === 'string')) stacks.add(f.join(','));
    }
    if (tpl) for (const f of stacks) fetch(tpl.replace('{fontstack}', encodeURIComponent(f).replace(/%2C/g, ',')).replace('{range}', '0-255')).then((r) => r.arrayBuffer()).catch(() => {});
  } catch { /* MapLibre fetches them itself */ }
  return style;
}
function failed(kind) {
  S.mapFailed = true;
  app.setAttribute('data-mapfail', '');
  $('#load-t').textContent = t('load.fail');
  $('#load-s').textContent = kind === 'gl' ? t('load.fail.gl') : t('load.fail.net');
  $('#load-track').hidden = true;
  $('#load-retry').hidden = kind === 'gl';
  gate.map = true; settle();
}
$('#load-retry').addEventListener('click', () => location.reload());

{
  setUiText({ close: t('close'), live: t('live') });
  I.applyDom();
  document.title = t('doc.title');
  const h = fromHash();
  S.tab = h.tab; S.stack = h.stack;
  setPlaceholder();
  try { history.replaceState(stateOf(), '', location.href); } catch { /* fine */ }
  if (HAS.city3d) { $('#b-3d').hidden = false; ugButton(); }   // one-tap Underground in the card
  if (HAS.buses) hasPack('bus-latest.json').then((yes) => {
    busBtn.hidden = !yes; S.busPack = yes;
    let off = false;
    try { off = localStorage.getItem(BUS_KEY) === '0'; } catch { /* storage blocked */ }
    if (yes && !off) toggleBuses(true); else if (yes) render();   // on by default; the home row shows either way
  });   // the bus pack: npm run data:bus
}
sheet.snap(S.stack.length ? 'half' : 'peek', { instant: true });
show();
// fetch the feature chunks the first screen needs now, all at once (need awaits them later)
for (const k of ['tt', 'calendar', 'model', 'net', 'networkLayer', 'layer', 'types', 'views', 'board', 'credits']) mod(k);
loadData();
startOffline();   // at boot, so the offline note shows even when the data cannot load
// the clock chip next to the Scheduled pill + its time sheet
need('playback').then((pb) => {
  if (typeof pb?.createPlayback !== 'function') return;
  S.pb = pb.createPlayback({ now: Date.now, reduceMotion });
  S.pb.onChange(() => { try { S.buses?.refresh?.(); } catch { /* fine */ } });   // simulated buses follow the page clock
  const row = $('#tk-tl');
  if (!row || typeof pb.mountPlayback !== 'function') return;
  try {
    S.pbUi = pb.mountPlayback(row, {
      playback: S.pb, t, lang: I.lang, onLang: I.onLang, reduceMotion, isDesktop,
      refresh: () => render(),
      repaint: () => { try { S.map?.triggerRepaint(); } catch { /* fine */ } },
      sim: () => S.sim, live: () => S.live,
      say: (txt) => say(txt),   // only when a button switches live <-> playback
      pageSheet: (d) => { if (d) sheet.snap(d); return sheet.detent; },   // phones: page sheet to peek under the time sheet
      loadRuns: (fromSec, toSec) => (S.source === 'data' && loaded.tt?.loadRuns ? loaded.tt.loadRuns({ base: DATA, cal: S.cals, fromSec, toSec }) : Promise.resolve([])),
      onLoaded: () => { if (S.sim) S.runs = S.sim.runs; },
    });
  } catch (e) { console.warn('[tokyo] playback', e); S.errors.push(`playback: ${e?.message || e}`); }
});

// "Trains near me" above the home view. Location only after its button is
// tapped; the block owns #tk-nearby (shows on the home only, watches the position only while it shows).
need('nearby').then((nb) => {
  if (typeof nb?.mountNearby !== 'function') return;
  const el = document.createElement('div');
  el.id = 'tk-nearby';
  viewEl.before(el);
  try {
    S.nearby = nb.mountNearby(el, { model: () => S.sim, open, now: NOW, live: liveOn, visible: () => screen().name === 'home' && !S.q.trim(),
      onLocation: (p, acc) => { S.tm?.setUserLocation?.(p, acc); if (!S.nearDay) { S.nearDay = true; wantDay(true); } },   // nearby boards need the day
      say, idle: () => S.home != null });   // no saved station = Home's card pill is the one near-me entry
  } catch (e) { console.warn('[tokyo] nearby', e); S.errors.push(`nearby: ${e?.message || e}`); }
});

(async () => {
  if (typeof WebGLRenderingContext === 'undefined') { failed('gl'); app.removeAttribute('data-loading'); return; }
  setBar(0.2);
  let mapMod, styleMod;
  try { [mapMod, styleMod] = await Promise.all([import('../map/tokyo-map.js'), need('style')]); } catch (e) { console.warn('[tokyo] map module', e); failed('load'); return; }
  setBar(0.6);
  const styleFn = styleMod?.calmTokyoStyle || styleMod?.tokyoStyle || styleMod?.createStyle || styleMod?.default;
  $('#map').setAttribute('lang', 'ja');   // Han glyphs in Japanese forms (style.js note): the map's own labels only
  try {
    S.tm = await mapMod.createTokyoMap({
      container: $('#map'), tilesBase: '/tiles', ariaLabel: t('map.aria'),
      style: typeof styleFn === 'function' ? (base) => glyphsEarly(styleFn(base, I.lang())) : undefined,
      bounds: styleMod?.TOKYO_BOUNDS, home: styleMod?.HOME_VIEW, minZoom: styleMod?.TOKYO_MAP_OPTIONS?.minZoom,
      fit: (() => { const p = padding(); return { top: p.top + 8, bottom: p.bottom + 8, left: p.left + 8, right: p.right + 8 }; })(),   // open on the final camera
      tileCache: tileCacheOpts(),
      onMapClick: () => { if (!isDesktop() && sheet.detent !== 'peek') sheet.snap('peek'); },
      onReady: (ok) => {
        if (ok === false) { failed('load'); return; }
        setBar(1);
        setTimeout(() => { app.removeAttribute('data-loading'); chromeSync(); }, 250);
        S.map = S.tm.getMap();
        S.mapReady = true;
        updatePadding();
        if (!S.stack.length) S.map.fitBounds(styleMod?.HOME_VIEW || mapMod.YAMANOTE_VIEW, { padding: 8, duration: 0 });
        gate.map = true;
        setTimeout(attachMapLayers, 0);   // its own task, after the map's first frame is on screen (not inside it)
        settle();
        S.map.on('webglcontextrestored', () => setTimeout(restoreLayers, 600));
      },
    });
  } catch (e) { console.warn('[tokyo] map', e); failed('load'); return; }
  S.map = S.tm.getMap();
  updatePadding();
})();

// reset.js:
// the control card's Reset view button (reset.js) = the opening view again, through the page's own functions (goTab,
// toggleUnderground, toggle3D, toggleLiveOnly, focusMap, sheet, updatePadding); the camera = the load's
// cameraForBounds(HOME_VIEW, { padding: 8 }) on the opening padding, north up, flat. Buses stay as they are.
function resetCtx() {
  return {
    t, say, chromeSync,
    map: () => (S.mapReady && !S.mapFailed ? S.map : null),
    state: () => {
      const m = S.mapReady ? S.map : null;
      let ug = $('#b-ug')?.getAttribute('aria-pressed') === 'true';
      try { ug = ug || !!S.city3d?.state?.().underground; } catch { /* fine */ }
      return { screen: screen(), tab: S.tab, stack: S.stack.length, q: S.q, on3D: !!S.on3D, underground: ug, liveOnly: !!S.liveOnly,
        following: !!S.tv.follow?.on, desktop: isDesktop(), reduceMotion: reduceMotion(), homeBounds: loaded.style?.HOME_VIEW,
        width: m?.getCanvas?.().clientWidth || innerWidth };
    },
    followOff: () => { try { S.tv.follow?.stop?.(false); } catch { /* fine */ } },
    home: () => { if (S.q) { S.q = ''; qInput.value = ''; $('#qx').hidden = true; } goTab('home'); },
    clearPicks: () => { focusMap(); try { S.city3d?.setSelected?.(null); S.city3d?.setLine?.(null); } catch { /* fine */ } },
    undergroundOff: async () => {
      for (let i = 0; S.ugBusy && i < 60; i++) await new Promise((r) => setTimeout(r, 50));   // a flight under way finishes first
      await toggleUnderground(false);
    },
    off3d: () => toggle3D(false, true),   // quiet: the reset's own flight does the camera
    liveAll: () => { if (S.liveOnly) toggleLiveOnly(false); },
    sheetPeek: () => { if (!isDesktop()) sheet.snap('peek'); updatePadding(isDesktop() ? undefined : 'peek'); },
  };
}
try { S.reset = mountResetButton($('#c3dcard'), resetCtx()); } catch (e) { console.warn('[tokyo] reset view', e); S.errors.push(`reset: ${e?.message || e}`); }
// reset.js end

// ------------------------------------------------------------------ test hooks (window.__tokyo)
function layerStats() { try { return S.layer?.stats?.() || S.layer?.debug?.() || null; } catch { return null; } }
function stats() {
  let running = 0;
  try { running = runningNow().total; } catch { running = 0; }
  const ls = layerStats();
  let drawn = null;
  try { drawn = ls?.drawn ?? ls?.n ?? S.layer?.count?.() ?? null; } catch { drawn = null; }
  return {
    trains: S.runs?.length || 0, running, drawn, onScreen: ls?.onScreen ?? null, fps: S.tm?.getDebug?.().fps ?? null,
    lines: S.model?.lines.length || 0, stations: S.model?.stations.length || 0, source: S.source, cal: S.calendar, cals: S.cals || null,
    lang: I.lang(), screen: screen().name, map: S.mapReady, mapFailed: S.mapFailed, layer: !!S.layer, network: S.network ? 'lane' : S.fallbackNet ? 'fallback' : null,
    modules: { ...HAS }, errors: S.errors.slice(), dataError: S.loadError, buses: S.buses?.stats?.() || null,
  };
}
/** A station id for #s= and a train running now for #t= (Yamanote first: always in the opening view). */
function sample() {
  if (!S.model) return { station: null, train: null };
  const hub = HUBS.find((id) => S.ix.stationIx.has(id)) || S.model.stations[0]?.id || null;
  let train = null;
  try {
    const list = typeof loaded.model?.running === 'function' && S.sim ? loaded.model.running(S.sim, NOW()).map((x) => x.run || x) : null;
    const now = serviceSec();
    const pool = list || S.runs.filter((r) => firstT(r) <= now && now <= lastT(r));
    const yam = pool.find((r) => S.model.lines[r.line]?.id === 'JR-East.Yamanote');
    train = (yam || pool[0])?.key || null;
  } catch { train = null; }
  return { station: hub, train };
}
window.__tokyo = {
  ready: () => readyP,
  stats,
  sample,
  get map() { return S.map; },
  open: (type, id) => open(type, id),
  setLang: (l) => I.setLang(l),
  set3d: (on) => toggle3D(!!on),
  labels: () => { const out = []; for (const f of [() => S.layer?.labels?.(), () => S.exitsLayer?.labels?.(), () => S.city3d?.labels?.()]) { try { out.push(...(f() || [])); } catch { /* fine */ } } return out; },
  get exits() { return S.exitsLayer; },
  get buses() { return S.buses; },
  setBuses: (on) => toggleBuses(!!on),
  /** QA (tap probes): what a tap at client (x, y) opens now: { type: 'station', id, why } | { type: 'train', key, why } | null */
  tapAt: (cx, cy) => { const d = tapDecision(cx, cy); if (!d) return null; return d.type === 'station' ? { type: 'station', id: S.model.stations[d.si]?.id, why: d.why } : { type: 'train', key: d.run?.key || d.id || null, why: d.why }; },
  get offline() { return S.offline; },
  get live() { return liveOn(); },
  /** trains with a fresh live position now (the headline / pill count); the Live chip by hand. */
  liveCount: () => liveCount(),
  setLiveOnly: (on) => toggleLiveOnly(!!on),
  get playback() { return S.pb; },
  i18n: () => I.report(),
  sheet: (detent) => { if (detent) sheet.snap(detent); return sheet.detent; },
  state: S,
  light: isLight,
};
