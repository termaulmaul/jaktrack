// time playback, Mini Tokyo 3D's "playback mode" done the calm way.
// You can scrub to any time of today's service day (03:00 -> 27:00 WIB) and watch the trains move: the 08:00 rush,
// the last trains at 00:30. The whole page reads time ONLY through playback.now() (page.js passes it to the model, the
// trains layer, boards, train view, route planner, 3D city). Live = real time (the default). Playback = a virtual clock
// that advances at 1x / 10x / 60x / 300x. In playback every position is a timetable position: live delays are switched
// off (gateLive) and come back with live(). Times are WIB; the service day turns over at 03:00 (calendar.js).
//
//   import { createPlayback, mountPlayback } from './playback.js';
//   const P = createPlayback({ now: Date.now, reduceMotion: () => reduceMQ.matches });
//   P.now()              -> ms since epoch: real time when live, the virtual clock in playback   (call it every frame)
//   P.set(ms)            -> playback at ms, clamped to the service day; from live it plays at 1x at once (paused when
//                           reduceMotion says so: no auto-play)
//   P.setSec(sec)        -> the same with seconds of the service day (08:00 = 28800, 00:40 = 89 ... 86400 + 2400)
//   P.speed(x)           -> playback speed (SPEEDS = 1, 10, 60, 300); P.speed() reads it
//   P.play(), P.pause()  -> pause() while live freezes the clock at now (playback, paused); play() at the end does nothing
//   P.live()             -> back to real time (speed back to 1x)
//   P.isLive(), P.isPlaying() (live: true), P.rate() (virtual s per real s: live 1, paused 0), P.state(), P.bounds()
//   P.onChange(fn)       -> unsubscribe; fn(state) after set / speed / play / pause / live and when playback hits 27:00
//
//   const ui = mountPlayback(rowEl, { playback: P, t, lang, onLang, reduceMotion, isDesktop, refresh, repaint,
//                                      sim, live, loadRuns, onLoaded })
//   -> { playback, open(), close(), toggle(), isOpen(), update(), gate(), destroy(), chip, sheet }
//   The clock chip ("17:20 WIB", in playback "Playback 08:00" in the calm lavender accent) goes into rowEl, next to the
//   Scheduled pill; tapping it opens a compact sheet (phones: bottom sheet; desktop: card under the chip) with a time
//   slider (5-minute steps, labels every 3 h), play / pause, speeds and "Back to now". has page.js's part.

import { serviceDate, dayStartMs } from './calendar.js';

export const SPEEDS = [1, 10, 60, 300];
export const DAY_FROM = 3 * 3600;          // 03:00 WIB: the service day starts
export const DAY_TO = 27 * 3600;           // 27:00 = 03:00 next morning: already the next service day
export const STEP = 300;                   // the slider's 5-minute steps
export const LABEL_EVERY = 3 * 3600;       // slider labels every 3 h
const END_PAD = 1000;                      // ms: the clock stops at 26:59:59, never on the next service day
const MAX_RATE = 3600;

const flag = (v) => { try { return typeof v === 'function' ? !!v() : !!(v && (v.matches ?? v === true)); } catch { return false; } };

/** 'HH:MM' for seconds of the service day (after midnight wraps: 88200 -> '00:30'); sep '.' for ID (i18n.js clock()). */
export function clockOf(sec, sep = ':') {
  if (!Number.isFinite(sec)) return '–';
  const m = Math.floor(sec / 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}${sep}${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
}
/** The time separator of a page language: Indonesian writes 05.30 (trafik.live's own pages), EN / JA 05:30. */
export const sepOf = (lang) => (lang === 'id' ? '.' : ':');

/** The service day around an instant: { date, start (ms of 00:00 WIB), from (ms of 03:00), to (ms of 26:59:59) }. */
export function serviceDay(ms) {
  const date = serviceDate(ms), start = dayStartMs(date);
  return { date, start, from: start + DAY_FROM * 1000, to: start + DAY_TO * 1000 - END_PAD };
}

/**
 * The page's one clock. now = the real clock (Date.now; tests pass a fake), reduceMotion = function, boolean or a
 * MediaQueryList (true: entering playback does not start playing).
 */
export function createPlayback({ now = Date.now, reduceMotion = false } = {}) {
  let mode = 'live';                       // 'live' | 'playback'
  let playing = false, rate = 1;
  let day = null;                          // serviceDay() of the playback day (fixed while in playback)
  let baseV = 0, baseR = 0;                // virtual ms at real ms
  let queued = false;
  const fns = new Set();

  const real = () => { const r = +now(); return Number.isFinite(r) ? r : Date.now(); };
  const clamp = (ms) => (ms < day.from ? day.from : ms > day.to ? day.to : ms);
  function current() {
    if (mode === 'live') return real();
    if (!playing) return baseV;
    const r = real();
    const v = baseV + Math.max(0, r - baseR) * rate;
    if (v < day.to) return v;
    playing = false; baseV = day.to; baseR = r;   // the end of the service day: stop there, tell the listeners
    soon();
    return baseV;
  }
  function emit() {
    const st = api.state();
    for (const fn of [...fns]) { try { fn(st); } catch (e) { console.warn('[playback] listener', e); } }
  }
  function soon() {
    if (queued) return;
    queued = true;
    const go = () => { queued = false; emit(); };
    if (typeof queueMicrotask === 'function') queueMicrotask(go); else Promise.resolve().then(go);
  }
  function enter(r) {                      // live -> playback on the current service day
    day = serviceDay(r);
    mode = 'playback';
  }

  const api = {
    /** ms since epoch: real time when live, else the virtual clock (clamped to the service day). */
    now: () => current(),
    /** Playback at ms (clamped to 03:00 .. 26:59:59 of the service day). From live it starts playing at the current
     *  speed unless reduceMotion (no auto-play); in playback it keeps playing or paused as it was. */
    set(ms) {
      ms = +ms;
      if (!Number.isFinite(ms)) return api;
      const r = real();
      if (mode === 'live') { enter(r); playing = !flag(reduceMotion); }
      baseV = clamp(ms); baseR = r;
      emit();
      return api;
    },
    /** set() with seconds of the service day (today's while live, the playback day in playback). */
    setSec(sec) {
      const d = mode === 'live' ? serviceDay(real()) : day;
      return api.set(d.start + +sec * 1000);
    },
    /** speed(x) sets the playback speed (any x > 0; the sheet offers SPEEDS) and returns the api; speed() reads it. */
    speed(x) {
      if (x === undefined) return rate;
      x = +x;
      if (!(x > 0) || !Number.isFinite(x)) return api;
      x = Math.min(MAX_RATE, x);
      if (x === rate) return api;
      if (mode === 'playback' && playing) { baseV = current(); baseR = real(); }
      rate = x;
      emit();
      return api;
    },
    play() {
      if (mode === 'live' || playing) return api;
      if (baseV >= day.to) return api;     // at the end of the service day: nothing left to play
      playing = true; baseR = real();
      emit();
      return api;
    },
    /** Pause; while live it freezes the map at now (playback, paused). */
    pause() {
      const r = real();
      if (mode === 'live') { enter(r); baseV = clamp(r); baseR = r; playing = false; emit(); return api; }
      if (!playing) return api;
      baseV = current(); baseR = r; playing = false;
      emit();
      return api;
    },
    /** Back to real time (and to 1x for the next playback). */
    live() {
      if (mode === 'live') return api;
      mode = 'live'; playing = false; rate = 1; day = null;
      emit();
      return api;
    },
    /** The real clock (the `now` given to createPlayback). */
    real,
    isLive: () => mode === 'live',
    isPlaying: () => mode === 'live' || (current(), playing),
    /** Virtual seconds per real second: 1 live, the speed while playing, 0 paused. */
    rate: () => (mode === 'live' ? 1 : (current(), playing ? rate : 0)),
    /** { live, playing, speed, rate, ms, sec (seconds of the service day), date, from, to (ms bounds), atEnd } */
    state() {
      const ms = current();
      const d = mode === 'live' ? serviceDay(ms) : day;
      return {
        live: mode === 'live', playing: mode === 'live' || playing, speed: rate, rate: mode === 'live' ? 1 : playing ? rate : 0,
        ms, sec: (ms - d.start) / 1000, date: d.date, from: d.from, to: d.to, atEnd: mode !== 'live' && ms >= d.to,
      };
    },
    /** The service day the clock moves in: { date, start, from, to } (ms). */
    bounds: () => (mode === 'live' ? serviceDay(real()) : { ...day }),
    onChange(fn) { if (typeof fn === 'function') fns.add(fn); return () => fns.delete(fn); },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------------------- live gate
/**
 * Live data only in live mode. In playback the model.js model must place every train by the timetable:
 * model.delays (live.js's Map, read by model.js for positions and departures) is swapped for an empty Map and the poller
 * stops; back in live the LIVE Map comes back and the poller starts (it polls at once). Drops model.js's smoothed-lag state
 * (model._lag) on every swap so no old delay lingers. Safe to call again and again; call it after createLive() too.
 */
export function gateLive({ sim, live } = {}, isLive = true) {
  if (!sim || typeof sim !== 'object') { if (live) { try { isLive ? live.start?.() : live.stop?.(); } catch { /* fine */ } } return false; }
  if (isLive) {
    const d = live && live.delays;
    if (d instanceof Map && sim.delays !== d) { sim.delays = d; sim._lag = null; }
    try { live?.start?.(); } catch (e) { console.warn('[playback] live.start', e); }
  } else {
    try { live?.stop?.(); } catch (e) { console.warn('[playback] live.stop', e); }
    if (!(sim.delays instanceof Map) || !sim.delays.__playback) {
      const off = new Map();
      Object.defineProperty(off, '__playback', { value: true });
      sim.delays = off; sim.delaysMax = 0; sim._lag = null;
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------- timetable window
/**
 * Seconds [fromSec, toSec] of the service day to load so the trains and boards at `sec` are there, given the loaded
 * window { from, to } (page.js's S.sim.window, service seconds). null = covered. Always the hull of the window and the
 * wish, so the loaded window stays one piece (board.js reads it for first / last train claims).
 */
export function needWindow(win, sec, { before = 1800, after = 3 * 3600 } = {}) {
  if (!Number.isFinite(sec)) return null;
  const lo = Math.max(DAY_FROM, Math.floor(sec - before)), hi = Math.min(DAY_TO, Math.ceil(sec + after));
  const f = Number.isFinite(win?.from) ? win.from : null, t = Number.isFinite(win?.to) ? win.to : null;
  if (f != null && t != null && f <= lo && t >= hi) return null;
  return { fromSec: f == null ? lo : Math.min(f, lo), toSec: t == null ? hi : Math.max(t, hi) };
}

/**
 * Keeps the timetable loaded around the virtual clock. sim = () => model.js model (.window, .add(runs)); loadRuns(fromSec,
 * toSec) -> Promise<runs> (tt.loadRuns({ base, cal: S.cals, fromSec, toSec }), buckets are cached so asking for
 * the hull again only fetches the missing hours). One load at a time, the newest wish wins; after a failure it waits
 * 15 s (real) before trying again. check(sec, rate) -> Promise | null.
 */
export function createLoader({ sim, loadRuns, onLoaded, onError, before = 1800, after = 3 * 3600, clock = Date.now } = {}) {
  let busy = null, want = null, retryAt = 0;
  const model = () => (typeof sim === 'function' ? sim() : sim);
  function check(sec, rate = 1) {
    const m = model();
    if (!m || typeof m.add !== 'function' || typeof loadRuns !== 'function') return null;
    if (busy) { want = [sec, rate]; return busy; }
    if (clock() < retryAt) return null;
    const need = needWindow(m.window, sec, { before, after: Math.max(after, (rate || 1) * 60) });
    if (!need) return null;
    busy = (async () => {
      let added = 0;
      try {
        const runs = await loadRuns(need.fromSec, need.toSec);
        // in slices when model.js offers it (a scrub to the evening adds ~25k runs: one ~0.6 s task at 4x CPU)
        added = Array.isArray(runs) ? (typeof m.addAsync === 'function' ? await m.addAsync(runs) : m.add(runs)) || 0 : 0;
        const w = m.window || {};
        m.window = { from: Math.min(w.from ?? need.fromSec, need.fromSec), to: Math.max(w.to ?? need.toSec, need.toSec) };
        try { onLoaded?.(added, need); } catch (e) { console.warn('[playback] onLoaded', e); }
      } catch (e) {
        retryAt = clock() + 15000;
        try { onError?.(e); } catch { /* fine */ }
        console.warn('[playback] timetable window', e);
      }
      return added;
    })().finally(() => {
      busy = null;
      if (want) { const [s, r] = want; want = null; check(s, r); }
    });
    return busy;
  }
  return { check, busy: () => !!busy };
}

// ------------------------------------------------------------------------------------------------------- the chip
/** Slider labels every 3 h from 03:00 to 27:00: [{ sec, text: '03' .. '00' .. '03', frac }]. */
export function sliderLabels(from = DAY_FROM, to = DAY_TO, every = LABEL_EVERY) {
  const out = [];
  for (let s = from; s <= to; s += every) out.push({ sec: s, text: String(Math.floor(s / 3600) % 24).padStart(2, '0'), frac: (s - from) / (to - from) });
  return out;
}

/** The chip's words for a clock state: { text, aria, cls: 'live' | 'pb' }. t = i18n.js t(), sep = sepOf(lang). */
export function chipLabel(st, t, sep = ':') {
  const time = clockOf(st.sec, sep);
  if (st.live) return { text: t('pb.chip.live', { time }), aria: t('pb.chip.aria', { time }), cls: 'live' };
  return { text: t('pb.chip', { time }), aria: t('pb.chip.aria.pb', { time }), cls: 'pb' };
}

/** The sheet's state line: "Playing at 60×" / "Paused" / "End of today's timetable" / "Following the clock". */
export function stateLine(st, t) {
  if (st.live) return t('pb.live');
  if (st.atEnd) return t('pb.end');
  return st.playing ? t('pb.playing', { n: fmtSpeed(st.speed) }) : t('pb.paused');
}
const fmtSpeed = (x) => (Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10));

// The look: the Scheduled pill's component (white pill, realm shadow, 32 px inside a 44 px button); playback in
// the lavender (info/progress colour) on a pale lavender pill. Text #5A51E0 on #F0EFFE = 5.0:1.
export const PLAYBACK_CSS = `
.tk-tl{position:absolute;z-index:30;left:calc(10px + var(--safe-l));top:calc(var(--safe-t) + 60px);display:flex;align-items:center;gap:0;max-width:calc(100% - 84px - var(--safe-l))}
.tk-tl > .tk-sched{position:static;flex:none}
.tk-app[data-loading] .tk-tl{visibility:hidden}
.tk-pbchip{position:relative;flex:none;display:flex;align-items:center;height:44px;padding:0 4px;background:none;border-radius:999px;color:var(--text2);cursor:pointer;-webkit-tap-highlight-color:transparent}
.tk-pbchip .tk-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px 0 12px;border-radius:999px;background:var(--realm-card);box-shadow:var(--realm-shadow);font:600 12.5px/1 var(--font);color:var(--text2);white-space:nowrap;font-variant-numeric:tabular-nums}
.tk-pbchip .tk-pbt{color:var(--text)}
.tk-pbchip .tk-pbz{color:var(--text2);font-weight:500}
.tk-pbchip .tk-pbcv{width:9px;height:9px;flex:none;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;color:var(--text3)}
.tk-pbchip.pb .tk-pill{background:#F0EFFE;color:#5A51E0;box-shadow:inset 0 0 0 1px rgba(108,99,240,.22),var(--realm-shadow);padding-left:10px}
.tk-pbchip.pb .tk-pbt{color:#5A51E0}
.tk-pbchip .tk-pbg{display:none;width:10px;height:10px;flex:none;fill:currentColor}
.tk-pbchip.pb.playing .tk-pbg.p,.tk-pbchip.pb:not(.playing) .tk-pbg.z{display:block}
.tk-pbchip.pb .tk-pbcv{color:#8A84EC}
.tk-pbchip[aria-expanded="true"] .tk-pill{box-shadow:inset 0 0 0 1.5px currentColor,var(--realm-shadow)}
.tk-pbchip:focus-visible{outline:none}
.tk-pbchip:focus-visible .tk-pill{outline:2px solid #6C63F0;outline-offset:2px}
.tk-pbsheet{position:fixed;z-index:50;left:var(--safe-l);right:var(--safe-r);bottom:0;display:grid;gap:12px;padding:10px 16px calc(14px + var(--safe-b));background:var(--bg);border-radius:24px 24px 0 0;box-shadow:var(--sheet-shadow);font-family:var(--font);color:var(--text)}
.tk-pbsheet[hidden]{display:none}
.tk-pbhead{display:flex;align-items:flex-start;gap:12px}
.tk-pbread{flex:1;min-width:0;display:grid;gap:2px}
.tk-pbeye{margin:0;font:600 13px/16px var(--font);letter-spacing:.064em;text-transform:uppercase;color:var(--text2)}
.tk-pbsheet.pb .tk-pbeye{color:#5A51E0}
.tk-pbtime{margin:0;display:flex;align-items:baseline;gap:6px;font:700 28px/34px var(--font);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.tk-pbtime small{font:600 13px/17px var(--font);color:var(--text2);letter-spacing:0}
.tk-pbstate{margin:0;font:400 13px/17px var(--font);color:var(--text2);min-height:17px}
.tk-pbx{position:relative;flex:none;width:44px;height:44px;margin:-4px -6px 0 0;border-radius:22px;display:grid;place-items:center;background:none;color:var(--text)}
.tk-pbx i{width:32px;height:32px;border-radius:16px;display:grid;place-items:center;background:var(--panel)}
.tk-pbx svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round}
.tk-pbslider{position:relative;padding:0 2px 18px}
.tk-pbrange{--pct:0%;display:block;width:100%;height:44px;margin:0;background:none;-webkit-appearance:none;appearance:none;cursor:pointer;touch-action:pan-y}
.tk-pbrange:focus{outline:none}
.tk-pbrange::-webkit-slider-runnable-track{height:6px;border-radius:3px;background:linear-gradient(90deg,#6C63F0 var(--pct),var(--track) var(--pct))}
.tk-pbrange::-moz-range-track{height:6px;border-radius:3px;background:var(--track)}
.tk-pbrange::-moz-range-progress{height:6px;border-radius:3px;background:#6C63F0}
.tk-pbrange::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:28px;height:28px;margin-top:-11px;border-radius:50%;background:#fff;border:0;box-shadow:0 0 0 .5px rgba(16,24,40,.12),0 2px 6px rgba(16,24,40,.18)}
.tk-pbrange::-moz-range-thumb{width:28px;height:28px;border-radius:50%;background:#fff;border:0;box-shadow:0 0 0 .5px rgba(16,24,40,.12),0 2px 6px rgba(16,24,40,.18)}
.tk-pbrange:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 2px #fff,0 0 0 4px #6C63F0}
.tk-pbrange:focus-visible::-moz-range-thumb{box-shadow:0 0 0 2px #fff,0 0 0 4px #6C63F0}
.tk-pbticks{position:absolute;left:16px;right:16px;bottom:0;height:16px;font:500 13px/16px var(--font);color:var(--text2);font-variant-numeric:tabular-nums;pointer-events:none}
.tk-pbticks span{position:absolute;top:0;transform:translateX(-50%)}
.tk-pbnow{position:absolute;top:8px;width:2px;height:8px;margin-left:-1px;border-radius:1px;background:var(--text2);pointer-events:none}
.tk-pbnow[hidden]{display:none}
.tk-pbctl{display:flex;align-items:center;gap:10px}
.tk-pbplay{flex:none;width:44px;height:44px;border-radius:22px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary)}
.tk-pbplay svg{width:18px;height:18px;fill:currentColor}
.tk-pbplay[aria-disabled="true"]{background:var(--panel);color:var(--text3)}
.tk-pbspeeds{flex:1;min-width:0;display:flex;padding:3px;border-radius:999px;background:var(--realm-track)}
.tk-pbspeeds button{flex:1;min-width:0;height:38px;display:grid;place-items:center;border-radius:999px;font:500 14px/18px var(--font);color:#5E5E63;font-variant-numeric:tabular-nums;position:relative}
.tk-pbspeeds button::after{content:"";position:absolute;inset:-3px 0}
.tk-pbspeeds button[aria-pressed="true"]{background:var(--realm-card);box-shadow:var(--realm-shadow);color:var(--text);font-weight:600}
.tk-pbback{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;height:44px;border-radius:999px;background:var(--primary);color:var(--on-primary);font:600 15px/20px var(--font)}
.tk-pbback[aria-disabled="true"]{background:var(--panel);color:var(--text3)}
.tk-pbhint{margin:-4px 0 0;font:400 13px/17px var(--font);color:var(--text2);text-align:center}
@media (min-width:900px){
  .tk-tl{left:calc(var(--pane-w) + 12px);top:12px;max-width:none}
  .tk-pbsheet{left:calc(var(--pane-w) + 16px);right:auto;bottom:auto;top:64px;width:380px;padding:14px 18px 16px;border-radius:24px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 12px 36px rgba(16,24,40,.16)}
}
@media (hover:hover){
  .tk-pbspeeds button:not([aria-pressed="true"]):hover{color:var(--text)}
  .tk-pbplay:not([aria-disabled="true"]):hover,.tk-pbback:not([aria-disabled="true"]):hover{background:#2B2B2E}
  .tk-pbx:hover i{background:var(--elevated)}
}
`;

const SVG = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8c0 .8.9 1.3 1.6.8l9.6-6.4c.6-.4.6-1.2 0-1.6L9.6 4.8C8.9 4.3 8 4.8 8 5.6Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  chev: '<svg class="tk-pbcv" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.6 5 6.6l3-3"/></svg>',
  gPlay: '<svg class="tk-pbg p" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.6 1.4v7.2L8.6 5z"/></svg>',
  gPause: '<svg class="tk-pbg z" viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="1.6" width="2.2" height="6.8" rx=".6"/><rect x="5.8" y="1.6" width="2.2" height="6.8" rx=".6"/></svg>',
};
const escTxt = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let cssDone = false;
function injectCss(doc) {
  if (cssDone || !doc || doc.getElementById('tk-playback-css')) { cssDone = true; return; }
  const el = doc.createElement('style');
  el.id = 'tk-playback-css';
  el.textContent = PLAYBACK_CSS;
  doc.head.append(el);
  cssDone = true;
}

/**
 * The clock chip + its sheet. el = the row next to the Scheduled pill (page.js's `.tk-tl`); the chip is appended to it,
 * the sheet to the page (`.tk-app`). ctx:
 *   playback   createPlayback() (made here from ctx.now when absent)
 *   t, lang, onLang   i18n.js: t(key, vars), lang(), onLang(fn) (keys 'pb.*' in the playback.js block)
 *   reduceMotion      () => bool: no auto-play, no fast repaint loop
 *   isDesktop         () => bool (layout is CSS; used for focus only)
 *   refresh           () => void: redraw the views for the clock (boards, train): on every change and about once a
 *                     second while the virtual minute moves
 *   repaint           () => void: map.triggerRepaint() (trains at the new time; ~30 fps while playing faster than 1x)
 *   sim, live         () => S.sim, () => S.live: the live gate (gateLive) and the timetable window
 *   loadRuns          (fromSec, toSec) => Promise<runs>: tt.loadRuns for the loaded day's calendars
 *   onLoaded          (added, range) => void after model.add (S.runs = S.sim.runs)
 *   say               (text) => void, optional: page.js's polite live region; called ONLY on a user's button action
 *                     that switches live <-> playback ("Playback · 08:00 WIB", "Now · 17:45 WIB"), never per tick
 *   pageSheet         (detent?) => detent, optional (`(d) => { if (d) sheet.snap(d); return sheet.detent; }`):
 *                     phones only: the page's own sheet goes down to its peek while the time sheet is open (else its
 *                     text peeks out half cut above this one) and back to where it was when the time sheet closes
 *   mapEl             the map's element (default #map): on phones a tap on the map (a train, a station) closes the time
 *                     sheet so the page's sheet can show what was tapped; dragging the map keeps it open
 */
export function mountPlayback(el, ctx = {}) {
  const doc = el?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || !el) throw new Error('mountPlayback: needs an element');
  const P = ctx.playback || createPlayback({ now: ctx.now || Date.now, reduceMotion: ctx.reduceMotion });
  const t = typeof ctx.t === 'function' ? ctx.t : (k, v) => fallbackT(k, v);
  const reduced = () => flag(ctx.reduceMotion);
  const call = (fn, ...a) => { try { return typeof fn === 'function' ? fn(...a) : undefined; } catch (e) { console.warn('[playback] hook', e); return undefined; } };
  const win = doc.defaultView || globalThis;
  const clk = (sec) => clockOf(sec, sepOf(call(ctx.lang)));
  const say = (text) => { if (typeof ctx.say === 'function') call(ctx.say, text); };
  injectCss(doc);

  // ---- the chip
  const chip = doc.createElement('button');
  chip.type = 'button';
  chip.className = 'tk-pbchip live';
  chip.id = 'tk-pbchip';
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-expanded', 'false');
  chip.setAttribute('aria-controls', 'tk-pbsheet');
  chip.innerHTML = `<span class="tk-pill">${SVG.gPlay}${SVG.gPause}<span class="tk-pbtx"></span>${SVG.chev}</span>`;
  el.append(chip);

  // ---- the sheet
  const labels = sliderLabels();
  const sheet = doc.createElement('section');
  sheet.className = 'tk-pbsheet';
  sheet.id = 'tk-pbsheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'false');
  sheet.innerHTML = `
<div class="tk-pbhead">
  <div class="tk-pbread"><p class="tk-pbeye" id="tk-pbeye"></p><p class="tk-pbtime" aria-live="off"><b class="tk-pbclock"></b><small class="tk-pbtz"></small></p><p class="tk-pbstate"></p></div>
  <button type="button" class="tk-pbx" data-pb="close"><i>${SVG.x}</i></button>
</div>
<div class="tk-pbslider">
  <input class="tk-pbrange" type="range" min="${DAY_FROM}" max="${DAY_TO}" step="${STEP}" value="${DAY_FROM}">
  <i class="tk-pbnow" hidden></i>
  <div class="tk-pbticks" aria-hidden="true">${labels.map((l) => `<span style="left:${(l.frac * 100).toFixed(3)}%">${l.text}</span>`).join('')}</div>
</div>
<div class="tk-pbctl">
  <button type="button" class="tk-pbplay" data-pb="play"></button>
  <div class="tk-pbspeeds" role="group">${SPEEDS.map((x) => `<button type="button" data-pbspeed="${x}" aria-pressed="false">${x}×</button>`).join('')}</div>
</div>
<button type="button" class="tk-pbback" data-pb="live"></button>
<p class="tk-pbhint"></p>`;
  (el.closest?.('.tk-app') || doc.body).append(sheet);
  const q = (s) => sheet.querySelector(s);
  const range = q('.tk-pbrange'), nowTick = q('.tk-pbnow'), playBtn = q('.tk-pbplay'), backBtn = q('.tk-pbback');
  const valueText = (sec) => range.setAttribute('aria-valuetext', t('pb.chip.live', { time: clk(sec) }));   // "08:00 WIB"
  const speedsEl = q('.tk-pbspeeds');
  let dragging = false, open = false, lastText = '', lastLive = null, lastRefresh = 0, lastMinute = NaN, loading = null;

  // ---- the timetable window + live gate
  const loader = createLoader({
    sim: ctx.sim, loadRuns: ctx.loadRuns,
    onLoaded: (added, range_) => { call(ctx.onLoaded, added, range_); loading = null; call(ctx.refresh); call(ctx.repaint); update(); },
    onError: () => { loading = null; update(); },
  });
  function gate() {
    const isLive = P.isLive();
    gateLive({ sim: call(ctx.sim), live: call(ctx.live) }, isLive);
    lastLive = isLive;
  }
  function ensure(st) {
    if (st.live) return;
    const p = loader.check(st.sec, st.rate || 1);
    if (p && !loading) { loading = st.sec; update(); }
  }

  // ---- drawing
  function update() {
    const st = P.state();
    const sep = sepOf(call(ctx.lang));
    const c = chipLabel(st, t, sep);
    if (c.text + c.cls !== lastText) {
      lastText = c.text + c.cls;
      chip.className = `tk-pbchip ${c.cls}${st.playing ? ' playing' : ''}`;
      const time = clockOf(st.sec, sep);
      const tx = chip.querySelector('.tk-pbtx');
      // the time darker than the words around it ("17:20 WIB", "Playback 08:00")
      tx.innerHTML = escTxt(c.text).replace(escTxt(time), `<span class="tk-pbt">${time}</span>`).replace(/\bJST\b/, '<span class="tk-pbz">WIB</span>');
      chip.setAttribute('aria-label', c.aria);
    }
    chip.classList.toggle('playing', st.playing);
    if (!open) return;
    sheet.classList.toggle('pb', !st.live);
    sheet.setAttribute('aria-label', t('pb.eye'));
    q('.tk-pbeye').textContent = st.live ? t('pb.eye.live') : t('pb.eye');
    q('.tk-pbclock').textContent = clockOf(st.sec, sep);
    q('.tk-pbtz').textContent = t('jst');                        // EN / ID "WIB", JA "日本時間" (as on every JA screen)
    q('.tk-pbstate').textContent = loading != null && !st.live ? t('pb.loading', { time: clockOf(loading, sep) }) : stateLine(st, t);
    if (!dragging) range.value = String(Math.min(DAY_TO, Math.max(DAY_FROM, st.sec)));
    const pct = ((+range.value - DAY_FROM) / (DAY_TO - DAY_FROM)) * 100;
    range.style.setProperty('--pct', `${pct}%`);
    // the slider's value text = the clock ("08:00 WIB", accessibility). While the clock runs and the slider has focus it is left
    // alone, so a screen reader is not told every tick; each user step sets it (input), and so do a stop or a blur.
    if (!(st.playing && doc.activeElement === range)) valueText(dragging ? +range.value : st.sec);
    range.setAttribute('aria-label', t('pb.slider'));
    // the real "now" as a small mark on the track while you look at another time
    if (!st.live) {
      const nowSec = (P.real() - (st.from - DAY_FROM * 1000)) / 1000;
      const f = (nowSec - DAY_FROM) / (DAY_TO - DAY_FROM);
      nowTick.hidden = !(f >= 0 && f <= 1);
      nowTick.style.left = `calc(16px + (100% - 32px) * ${f.toFixed(4)})`;
    } else nowTick.hidden = true;
    // live runs at 1x, so the button offers Pause there too (it freezes the map at now). One toggle button:
    // the name stays "Play", aria-pressed says whether the clock runs; the glyph shows what a tap does.
    const runs = st.playing;
    if (playBtn.dataset.k !== String(runs)) { playBtn.innerHTML = runs ? SVG.pause : SVG.play; playBtn.dataset.k = String(runs); }
    playBtn.setAttribute('aria-label', t('pb.play'));
    playBtn.setAttribute('aria-pressed', String(runs));
    playBtn.setAttribute('aria-disabled', String(!runs && st.atEnd));
    // in live the clock runs at 1x: the pressed speed is the one playback will use
    for (const b of speedsEl.querySelectorAll('[data-pbspeed]')) {
      b.setAttribute('aria-pressed', String(+b.dataset.pbspeed === st.speed));
      b.setAttribute('aria-label', t('pb.speed.n', { n: b.dataset.pbspeed }));
    }
    speedsEl.setAttribute('aria-label', t('pb.speed'));
    backBtn.textContent = t('pb.back');
    backBtn.setAttribute('aria-disabled', String(st.live));
    q('.tk-pbhint').textContent = t('pb.hint');
    q('.tk-pbx').setAttribute('aria-label', t('close'));
  }

  // ---- clock ticks: the chip's minute, the views, the window, the fast repaint loop
  let timer = 0, raf = 0, lastPaint = 0;
  function tick() {
    timer = 0;
    const st = P.state();
    update();
    if (!st.live) {
      ensure(st);
      const minute = Math.floor(st.sec / 60);
      const nowR = Date.now();
      if (minute !== lastMinute && nowR - lastRefresh >= 1000) { lastMinute = minute; lastRefresh = nowR; call(ctx.refresh); }
    }
    schedule(st);
  }
  function schedule(st = P.state()) {
    clearTimeout(timer); timer = 0;
    if (doc.hidden) return;
    let ms;
    if (st.live) ms = 60000 - (st.ms % 60000) + 40;               // the next real minute
    else if (st.playing) ms = Math.max(120, Math.min(1000, 30000 / Math.max(1, st.rate)));
    else return;                                                  // paused: nothing moves
    timer = setTimeout(tick, ms);
  }
  function loop(ts) {
    raf = 0;
    if (P.isLive() || reduced() || doc.hidden || !(P.rate() > 1)) return;
    if (!(ts - lastPaint < 30)) { lastPaint = ts; call(ctx.repaint); }
    raf = win.requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf && !P.isLive() && !reduced() && P.rate() > 1 && typeof win.requestAnimationFrame === 'function') raf = win.requestAnimationFrame(loop);
  }

  let refreshTimer = 0;
  const refreshNow = () => { clearTimeout(refreshTimer); refreshTimer = 0; lastRefresh = Date.now(); call(ctx.refresh); };
  const offChange = P.onChange((st) => {
    if (lastLive !== st.live) gate();
    if (st.live) loading = null;
    lastMinute = Math.floor(st.sec / 60);
    // while the slider is dragged the views follow at most 4 times a second (the map follows every move)
    if (dragging) { if (!refreshTimer) refreshTimer = setTimeout(refreshNow, 250); } else refreshNow();
    call(ctx.repaint);
    update();
    ensure(st);
    schedule(st);
    kick();
  });

  // ---- input
  // phones: the page's sheet to its peek while the time sheet is open, back to its detent on close (ctx.pageSheet)
  let savedDetent = null;
  function pageDown() {
    if (typeof ctx.pageSheet !== 'function' || flag(ctx.isDesktop)) return;
    const d = call(ctx.pageSheet);
    if (d && d !== 'peek') { savedDetent = d; call(ctx.pageSheet, 'peek'); }
  }
  function pageBack() {
    const d = savedDetent;
    savedDetent = null;
    if (d && call(ctx.pageSheet) === 'peek') call(ctx.pageSheet, d);   // the page moved on by itself: leave it there
  }
  function setOpen(on, { focus = true } = {}) {
    on = !!on;
    if (on === open) return;
    open = on;
    sheet.hidden = !on;
    chip.setAttribute('aria-expanded', String(on));
    if (on) { pageDown(); update(); if (focus) range.focus({ preventScroll: true }); } else {
      pageBack();
      if (focus) chip.focus({ preventScroll: true });
    }
  }
  chip.addEventListener('click', () => setOpen(!open));
  const toMs = (sec) => P.bounds().start + sec * 1000;
  range.addEventListener('pointerdown', () => { dragging = true; });
  const endDrag = () => { if (dragging) { dragging = false; if (refreshTimer) refreshNow(); update(); } };
  range.addEventListener('pointerup', endDrag);
  range.addEventListener('pointercancel', endDrag);
  range.addEventListener('change', endDrag);
  range.addEventListener('blur', endDrag);
  range.addEventListener('input', () => {
    const sec = +range.value;
    range.style.setProperty('--pct', `${((sec - DAY_FROM) / (DAY_TO - DAY_FROM)) * 100}%`);
    P.set(toMs(sec));
    valueText(sec);                                               // the user's own step: always say it
  });
  sheet.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !sheet.contains(b)) return;
    const was = P.isLive();
    if (b.dataset.pbspeed) {
      const x = +b.dataset.pbspeed;
      if (P.isLive()) {                                           // a faster speed from live: fast-forward from now
        if (x !== 1) { P.speed(x); P.set(P.now()); }
      } else P.speed(x);
    } else {
      const act = b.dataset.pb;
      if (act === 'close') { setOpen(false); return; }
      if (act === 'live') { if (!P.isLive()) P.live(); }
      else if (act === 'play') {
        if (P.isPlaying()) P.pause();                             // live runs too: Pause freezes the map at now
        else P.play();
      }
    }
    // the user's own action switched live <-> playback: say where the clock is now (nothing else is announced)
    if (P.isLive() !== was) say(t(P.isLive() ? 'now.eyebrow' : 'pb.eyebrow', { time: clk(P.state().sec) }));
  });
  // phones: a tap on the map closes the time sheet (the page opens what was tapped); a drag / pinch keeps it open
  const mapEl = ctx.mapEl || doc.getElementById('map');
  let downAt = null;
  const onMapDown = (e) => { downAt = [e.clientX, e.clientY]; };
  const onMapTap = (e) => {
    if (!open || flag(ctx.isDesktop)) return;
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 10) return;
    setOpen(false, { focus: false });
  };
  mapEl?.addEventListener('pointerdown', onMapDown, true);
  mapEl?.addEventListener('click', onMapTap, true);
  const onKey = (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } };
  sheet.addEventListener('keydown', onKey);
  chip.addEventListener('keydown', onKey);
  // a hidden page pauses playback (it picks up where it was when you come back)
  let resume = false;
  const onVis = () => {
    if (doc.hidden) {
      if (!P.isLive() && P.isPlaying()) { resume = true; P.pause(); }
      clearTimeout(timer); timer = 0;
    } else {
      if (resume && !P.isLive()) P.play();
      resume = false;
      tick();
    }
  };
  doc.addEventListener('visibilitychange', onVis);
  const offLang = typeof ctx.onLang === 'function' ? ctx.onLang(() => { lastText = ''; update(); }) : null;

  lastLive = P.isLive();
  update();
  schedule();

  return {
    playback: P, chip, sheet,
    open: (o) => setOpen(true, o), close: (o) => setOpen(false, o), toggle: () => setOpen(!open), isOpen: () => open,
    update: () => { lastText = ''; update(); },
    /** Apply the live gate again (right after createLive / live.start, so playback stays timetable-only). */
    gate,
    destroy() {
      clearTimeout(timer); clearTimeout(refreshTimer); if (raf) win.cancelAnimationFrame?.(raf);
      offChange(); if (typeof offLang === 'function') offLang();
      doc.removeEventListener('visibilitychange', onVis);
      mapEl?.removeEventListener('pointerdown', onMapDown, true);
      mapEl?.removeEventListener('click', onMapTap, true);
      chip.remove(); sheet.remove();
    },
  };
}

// English words when the page's i18n is not passed (tests, harness).
const FALLBACK = {
  'pb.chip.live': '{time} WIB', 'pb.chip': 'Playback {time}', 'pb.chip.aria': '{time} WIB. Watch the trains at another time today',
  'pb.chip.aria.pb': 'Playback {time}. Change the time or go back to now', jst: 'WIB', 'pb.eye.live': 'Now', 'pb.eye': 'Playback',
  'pb.playing': 'Playing at {n}×', 'pb.paused': 'Paused', 'pb.end': 'End of today’s timetable', 'pb.live': 'Following the clock',
  'pb.slider': 'Time of day', 'pb.speed': 'Speed', 'pb.speed.n': '{n}× speed', 'pb.play': 'Play', 'pb.pause': 'Pause',
  'pb.back': 'Back to now', 'pb.hint': 'Any time of today’s timetable, 03:00 to 03:00.', 'pb.loading': 'Getting the timetable for {time}…',
  'pb.eyebrow': 'Playback · {time} WIB', 'now.eyebrow': 'Now · {time} WIB', close: 'Close',
};
function fallbackT(k, v) {
  const s = FALLBACK[k] ?? k;
  return v ? s.replace(/\{(\w+)\}/g, (m, x) => (v[x] != null ? String(v[x]) : m)) : s;
}
