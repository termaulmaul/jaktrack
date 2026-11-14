/*! Portions from Mini Tokyo 3D, (c) 2019-2026 Akihiko Kusanagi, MIT License: see /LICENSES.txt */
// the live layer. Polls /api/tokyo/live.json (the live service, server/live.mjs: Toei from ODPT's keyless open data,
// plus whatever adapters you run) and turns it into what the views need, per run ONE of three states (never call an
// estimate live):
//   'live'       the run is in the newest answer with a FRESH (<= 150 s old) measured position: placed by the
//                reported delay, or, when the report gives none, by where it says the train is (label without minutes)
//   'estimated'  the delay is carried from the train's last report (its next runs on another operator's track, e.g.
//                Toei Asakusa -> Keisei, Shinjuku -> Keio, Mita -> Tokyu Meguro; or a run that dropped out of the
//                answer): the delay is kept, with its source { line, station, at }
//   'scheduled'  the timetable, as before
// ESTIMATE RULE: an estimate starts at the train's measured delay d0 from its last report and falls linearly to 0 over
// 20 min after that report's data time (dc:date); after 20 min with no new report it expires ('scheduled'). A newer
// report always replaces an older estimate; a fresh run in the newest answer is 'live', never 'estimated'. A report
// older than 150 s (a per-line source that comes round every few minutes) is an estimate from its own time.
// NO DELAY FIGURE (Toei trams, and any source that reports only a place): the lag is read from the reported place against the timetable
// (at a station: 0 while the timetable has it there, else the gap to that window; between two stations: the gap to
// the middle of that leg), never below 0, never over 2 h (then nothing is derived and the run stays 'scheduled').
// That lag places the train and shifts its times; the label says "Live position · as of 17:40" without minutes.
// With the live service off (or not running) the feed answers { off: true } and this module stays quiet (looks again
// every 5 min). Feed shape: docs/ARCHITECTURE.md.
//
//   import { createLive } from './live.js';
//   const live = createLive({ model, fetch, now });   // model = createModel(...) from model.js
//   live.onChange(() => redraw()); live.start();
//   live.stateOf(runOrKey)    -> 'live' | 'estimated' | 'scheduled'
//   live.label(runOrKey)      -> the text for that state in the page language: "Live position · 2 min late · as of
//                                17:40" | "Estimated · about 2 min late (last report Oshiage 17:38)" | "Scheduled"
//   live.liveOf(runOrKey)     -> MEASURED + fresh only: { live: true, delaySec (the report's figure | null), lag (s used
//                                to PLACE it: the figure; the reported place when there is none (derived) or when the
//                                report names a station the run passes non-stop and the figure is > 90 s off it
//                                (placed)), derived, placed, at, from, to, carriages, number, op } | null
//   live.estimateOf(runOrKey) -> { delaySec (now, decayed), d0, source: { line, station, at, odpt }, until } | null
//   live.delayOf(runOrKey)    -> the report's delay FIGURE in s (0 = on time) | null (none given / not live)
//   live.creditOf(runOrLine)  -> the credit text to show next to this run's live data in the page language: the ODPT
//                                (+ Toei CC BY) lines for ODPT data, '' for every other source (never named)
//   live.status(lineIdOrIdx)  -> { severity: 'normal'|'info'|'delay'|'suspended', text: { ja, en, enAuto? }, at, op, line,
//                                  cause?, resume? } | null   (line notice, else the operator's own notice)
//   live.notices()            -> every notice that is not 'normal', worst first (home / board banner)
//   live.updatedAt(lineId)    -> ms of the newest ODPT data for that line's operator (guideline: show the data time)
//   live.stopsOf(run, ms)     -> run.stops with the remaining stops' a/d moved by the measured or estimated delay
//                                (+ sa/sd = timetable); stateOf(run) says which
//   live.delays / model.delays     Map(run -> s): measured + estimated delays, what model.js places trains with
//   live.measured / model.measured Set(run): the runs measured in the newest answer (model.js: frames live 1 = measured,
//                                  2 = estimated; trains.js rings only 1)
//   model.derived              Set(run): of the measured runs, those placed by the reported PLACE (no delay figure):
//                                  map labels show no "+N min" for them (a review's trains.js)
//   live.state()              -> { state: 'idle'|'off'|'on'|'error', reason, at, trains, matched, unmatched, estimated }
//
// Matching, any operator (ids as MT3D: ODPT ids without their 'odpt.X:' prefix; adapters send MT3D ids): run.key ===
// train.runKey, else the Marunouchi branch alias, else same line + train number; several candidates (a late run of
// yesterday, the other direction) -> the one whose timetable window holds the report time, same direction first, then
// the one that calls at the reported from / to station (Oedo's '.1' second call counts).

import { t, title, clockMs } from './i18n.js';
import { timeAt } from './model.js';

const POLL_MS = 30000;            // ODPT odpt:Train frequency
const OFF_MS = 5 * 60000;         // switched off / poller not there: look again this often
// A blip (network error, the service worker's {off, reason: 'offline'}, 5xx while the poller restarts, a bad or stale
// answer): keep what we have (marks age by the 150 s rule, estimates decay), look again in 15 s, 30 s, then every 60 s.
// Only a real "off" (404 = no poller behind the path, or the poller's own {off: true}) waits OFF_MS and clears.
const ERR_MS = [15000, 30000, 60000];
const FETCH_TIMEOUT_MS = 10000;   // one poll never hangs longer than this
const STALE_MS = 150000;          // a snapshot or a train report older than this is not shown as live any more
const LAG_MAX = 2 * 3600;         // a lag read from the reported place above this = no lag (wrong run / bad report)
const PLACE_SLACK = 90;           // s: a delay figure that puts the train further than this from a reported station it
                                  // passes without stopping is not used to PLACE it
export const EST_MS = 20 * 60000; // an estimate falls to 0 and expires this long after its report
const CHAIN_MAX = 6;              // through-service runs followed after a measured run
const WIB = 7 * 3600 * 1000, DAY = 86400, TURN = 3 * 3600;
const SLACK = 300;                // s around a run's timetable window that still counts as "running"
const RANK = { suspended: 3, delay: 2, info: 1, normal: 0 };
const STATUS_ALIAS = { 'TokyoMetro.MarunouchiBranch': 'TokyoMetro.Marunouchi' };

/** Seconds of the service day at ms (WIB, the day turns at 03:00: 00:30 -> 88200), as model.js serviceSeconds. */
export function serviceSec(ms) {
  let s = ((ms + WIB) / 1000) % DAY;
  if (s < 0) s += DAY;
  return s < TURN ? s + DAY : s;
}

const timeOf = (st) => (st.d ?? st.a);
function spanOf(run) {
  if (Number.isFinite(run.first) && Number.isFinite(run.last)) return [run.first, run.last];
  let lo = Infinity, hi = -Infinity;
  for (const st of run.stops || []) for (const x of [st.a, st.d]) if (x != null) { if (x < lo) lo = x; if (x > hi) hi = x; }
  return [lo, hi];
}

/**
 * The stops of `run` as expected now: stops still ahead (scheduled time + delay >= now) get a/d + delay, passed stops
 * keep the timetable. sa/sd = timetable times, late = delay in s on shifted stops (0 on passed ones).
 */
export function shiftStops(stops, delaySec, nowSec) {
  const d = Number.isFinite(delaySec) ? delaySec : 0;
  return stops.map((st) => {
    const x = timeOf(st);
    const ahead = d !== 0 && x != null && x + d >= nowSec;
    return {
      ...st,
      a: st.a != null && ahead ? st.a + d : st.a,
      d: st.d != null && ahead ? st.d + d : st.d,
      sa: st.a, sd: st.d, late: ahead ? d : 0,
    };
  });
}

/** The estimate rule: delay now from d0 measured at `at` (ms), or null once expired. */
export function decayed(d0, at, ms) {
  const age = ms - at;
  if (!Number.isFinite(d0) || !Number.isFinite(age) || age >= EST_MS) return null;
  return Math.round(d0 * (1 - Math.max(0, age) / EST_MS));
}

/** Index of the model's runs for matching (rebuilt when the model changes). */
function indexOf(model) {
  const byKey = new Map(), byNum = new Map(), lineIdx = new Map(), dirIdx = new Map();
  (model.lines || []).forEach((l, i) => lineIdx.set(l.id, i));
  (model.dirs || []).forEach((d, i) => dirIdx.set(d.id, i));
  const push = (m, k, r) => { const a = m.get(k); if (a) a.push(r); else m.set(k, [r]); };
  for (const r of model.runs || []) {
    if (r.key) push(byKey, r.key, r);
    if (r.number != null) push(byNum, `${r.line}|${r.number}`, r);
  }
  return { byKey, byNum, lineIdx, dirIdx, version: model.version, n: (model.runs || []).length };
}

/** The model's own window { a, d, dist } for `run` at station `id` (or its loop twin `id.1`), nearest to r s. */
function modelWindow(model, run, id, r) {
  let best = null;
  for (const x of [id, `${id}.1`]) {
    let w = null;
    try { w = timeAt(run, x, { model }); } catch { w = null; }
    if (!w || !Number.isFinite(w.a) || !Number.isFinite(w.d)) continue;
    const dist = r < w.a ? w.a - r : r > w.d ? r - w.d : 0;
    if (!best || dist < best.dist) best = { a: w.a, d: w.d, dist };
  }
  return best;
}

/**
 * The lag (s) that puts `run` where the report says the train is, at the report's time, on the MODEL's own clock
 * (model.js timeAt: glided legs, eased driving, stations passed without stopping), so the drawn train lands there:
 * at a station, 0 while the model has it there, else the gap to that window; between two stations, the gap to the
 * middle of that leg; only "towards" a station: the gap past its arrival. Negative = ahead of MT3D's timetable.
 * Falls back to run.stops when the model cannot say (a model without timeAt, a station off the run).
 * null when the place is not on the run or the lag would be absurd (beyond 2 h either way).
 */
export function placeLag(model, run, tr, ms) {
  if (!tr || (!tr.from && !tr.to) || !run) return null;
  const at = Number.isFinite(tr.at) ? tr.at : ms;
  const r = serviceSec(at) - (model._off?.get?.(run) || 0);
  let lag = null;
  if (model.runById?.get?.(run.id) === run) {
    const wf = tr.from ? modelWindow(model, run, tr.from, r) : null;
    const wt = tr.to ? modelWindow(model, run, tr.to, r) : null;
    if (wf && wt && wt.a >= wf.d) lag = r - (wf.d + wt.a) / 2;
    else if (wf) lag = r < wf.a ? r - wf.a : r > wf.d ? r - wf.d : 0;
    else if (wt && !tr.from) lag = r > wt.a ? r - wt.a : 0;
  }
  if (lag == null) lag = rawLag(model, run, tr, r);
  if (lag == null || Math.abs(lag) > LAG_MAX) return null;
  return Math.round(lag);
}

/** The same from run.stops alone (timetable minutes, no glide): the fallback. */
function rawLag(model, run, tr, r) {
  const stops = run?.stops || [];
  const idOf = (st) => model.stations?.[st.s]?.id;
  const is = (st, id) => { const x = idOf(st); return !!id && !!x && (x === id || x === `${id}.1`); };
  let best = null;
  const near = (lo, hi) => {
    if (lo == null || hi == null) return;
    const lag = r < lo ? r - lo : r > hi ? r - hi : 0;
    if (best == null || Math.abs(lag) < Math.abs(best)) best = lag;
  };
  for (let k = 0; k < stops.length; k++) {
    const st = stops[k], nx = stops[k + 1], pv = stops[k - 1];
    if (tr.from && is(st, tr.from)) {
      if (tr.to && nx && is(nx, tr.to)) {                       // between from and the next stop: middle of the leg
        const d = st.d ?? st.a, a = nx.a ?? nx.d;
        if (d != null && a != null) { const mid = (d + a) / 2; near(mid, mid); }
      } else if (tr.to && nx) {                                  // between from and a station it passes: after from, before the next stop
        near(st.d ?? st.a, nx.a ?? nx.d);
      } else {
        near(st.a ?? st.d, st.d ?? st.a);                        // at / around the station
      }
    } else if (!tr.from && tr.to && is(st, tr.to)) {
      near(pv ? (pv.d ?? pv.a) : (st.a ?? st.d), st.a ?? st.d);  // only "towards": after the previous stop
    }
  }
  return best;
}

/** Kept for tools: the place-lag (placeLag), never below 0. */
export function lagFromReport(model, run, tr, ms) {
  const v = placeLag(model, run, tr, ms);
  return v == null ? null : Math.max(0, v);
}

/** The call of `run` at station `id` (or its loop twin `id.1`) nearest to `own` s: { dist (s outside [a, d + late]),
 * last (it is the run's last stop), first }. dist Infinity when it does not call there. */
function callNear(model, run, id, own, late) {
  const stops = run.stops || [];
  let best = { dist: Infinity, last: false, first: false };
  stops.forEach((st, k) => {
    const sid = model.stations?.[st.s]?.id;
    if (sid !== id && sid !== `${id}.1`) return;
    const lo = st.a ?? st.d, hi = (st.d ?? st.a) + late;
    if (lo == null || hi == null) return;
    const dist = own < lo ? lo - own : own > hi ? own - hi : 0;
    if (dist < best.dist) best = { dist, last: k === stops.length - 1, first: k === 0 };
  });
  return best;
}

/**
 * Match the feed's trains to runs at ms. Returns { byRun: Map(run -> info), delays: Map(run -> s), unmatched: [train] }:
 * only runs reported in this answer (a run is always on the reported line). info.live = the run can be placed from
 * this report (a delay figure, or a lag read from the reported place); info.delaySec = the figure only.
 * Pure (no state): exported for tests and for views that want to check one train.
 */
export function matchTrains(model, trains, ms, ix = indexOf(model)) {
  const byRun = new Map(), delays = new Map(), unmatched = [];
  const stationId = (i) => model.stations?.[i]?.id;
  const calls = (run, id) => !!id && (run.stops || []).some((st) => { const x = stationId(st.s); return x === id || x === `${id}.1`; });
  for (const tr of trains || []) {
    if (!tr || typeof tr.line !== 'string') continue;
    const li = ix.lineIdx.get(tr.line);
    const cands = (tr.runKey && ix.byKey.get(tr.runKey))
      || (tr.runKey && tr.runKey.includes('.Marunouchi.') && ix.byKey.get(tr.runKey.replace('.Marunouchi.', '.MarunouchiBranch.')))
      || (li != null && tr.number != null && ix.byNum.get(`${li}|${tr.number}`))
      || null;
    if (!cands) { unmatched.push(tr); continue; }
    const dir = tr.dir != null ? ix.dirIdx.get(tr.dir) : undefined;
    const fig = Number.isFinite(tr.delaySec) ? tr.delaySec : null;
    const sec = serviceSec(Number.isFinite(tr.at) && tr.at <= ms ? tr.at : ms);   // the report's own time
    let best = null, bestScore = Infinity, tied = [];
    for (const run of cands) {
      const own = sec - (model._off?.get?.(run) || 0);      // a late run of yesterday runs on yesterday's clock
      const [lo, hi] = spanOf(run);
      const late = fig != null ? Math.max(0, fig) : 0;
      let score = own < lo - SLACK ? lo - SLACK - own : own > hi + late + SLACK ? own - hi - late - SLACK : 0;
      if (dir != null && run.dir != null && run.dir !== dir) score += 1e6;
      // ODPT names a loop's second call at a station the same as the first (MT3D: 'Toei.Oedo.Tochomae.1')
      if (calls(run, tr.from)) score -= 1;
      if (calls(run, tr.to)) score -= 0.5;
      if (score < bestScore) { bestScore = score; best = run; tied = [run]; } else if (score === bestScore) tied.push(run);
    }
    if (!best || bestScore > 3600) { unmatched.push(tr); continue; }
    // several runs of this number call at the reported station in their windows: the ones whose call there is nearest
    // in time (+ the reported delay) win, and a run that ENDS there loses to one that goes on from there (two halves of
    // one number handing over at a station). What is left are the parts of a split / coupled train running
    // together over that place: the report is true for each of them.
    let parts = bestScore <= -1 ? tied : [best];
    if (parts.length > 1 && (tr.from || tr.to)) {
      const late = fig != null ? Math.max(0, fig) : 0;
      const near = parts.map((run) => ({ run, ...callNear(model, run, tr.from || tr.to, sec - (model._off?.get?.(run) || 0), late) }));
      const dmin = Math.min(...near.map((x) => x.dist));
      let keep = near.filter((x) => x.dist <= dmin + 30);
      if (keep.some((x) => !x.last)) keep = keep.filter((x) => !x.last);
      parts = keep.map((x) => x.run);
    }
    // a place the run never reaches (beyond its ends, another line): not this run's report. Only
    // with a real model, where timeAt knows the run's whole path, stations passed non-stop included.
    if ((tr.from || tr.to) && model.runById?.get?.(best.id) === best && placeLag(model, best, tr, ms) == null) {
      unmatched.push({ ...tr, why: 'place off the run' });
      continue;
    }
    parts.forEach((run, k) => {
      // where to DRAW it: the reported delay figure, unless it puts the train more than PLACE_SLACK away from the
      // reported place (then the place wins: placed); no figure = the place (derived). Times / labels keep the figure.
      const place = placeLag(model, run, tr, ms);
      // the figure is trusted for placing unless the report names a station the run PASSES without stopping (a long
      // non-stop leg, drawn at even speed: Skyliner at Keisei-Takasago) and the figure puts it > PLACE_SLACK off there
      const passing = !!((tr.from && !calls(run, tr.from)) || (tr.to && !calls(run, tr.to)));
      const placed = fig != null && place != null && passing && Math.abs(place - fig) > PLACE_SLACK;
      const lag = fig != null ? (placed ? place : fig) : place;
      const info = { live: lag != null, delaySec: fig, lag, derived: fig == null && lag != null, placed,
        at: tr.at ?? null, from: tr.from ?? null, to: tr.to ?? null, carriages: tr.carriages ?? null, number: tr.number,
        op: tr.op ?? (typeof tr.line === 'string' ? tr.line.split('.')[0] : null), ...(k ? { part: true } : {}) };
      // ODPT data: marked by the server; a feed without the mark (a rolled-back poller) still credits Toei
      info.odpt = tr.src ? tr.src === 'odpt' : info.op === 'Toei';
      byRun.set(run, info);
      if (info.live) delays.set(run, lag);
    });
  }
  return { byRun, delays, unmatched };
}

/**
 * The runs a train becomes after `run` (through service onto other tracks, the next loop lap), nearest first. With
 * untilSec: only runs that begin by then (an estimate expires 20 min after its report: no point carrying it further).
 */
export function successors(model, run, max = CHAIN_MAX, untilSec = Infinity) {
  const out = [], seen = new Set([run]);
  let frontier = [run];
  for (let depth = 0; depth < max && frontier.length; depth++) {
    const next = [];
    for (const r of frontier) for (const id of r.next || []) {
      const nx = model.runById?.get?.(id);
      if (!nx || seen.has(nx)) continue;
      seen.add(nx);
      if (spanOf(nx)[0] + (model._off?.get?.(nx) || 0) > untilSec) continue;
      out.push(nx); next.push(nx);
    }
    frontier = next;
  }
  return out;
}

/** A Set whose members count only while `ok(member)` holds when read (has / size / iteration). */
class FreshSet extends Set {
  constructor(ok) { super(); this.ok = ok; }
  has(x) { return super.has(x) && this.ok(x); }
  get size() { let n = 0; for (const x of super.values()) if (this.ok(x)) n += 1; return n; }
  *values() { for (const x of super.values()) if (this.ok(x)) yield x; }
  keys() { return this.values(); }
  [Symbol.iterator]() { return this.values(); }
  *entries() { for (const x of this.values()) yield [x, x]; }
  forEach(fn, self) { for (const x of this.values()) fn.call(self, x, x, this); }
}

export function createLive({ model, fetch: fetchFn = globalThis.fetch?.bind(globalThis), now = Date.now,
  url = '/api/tokyo/live.json', timers = { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h) },
  doc = typeof document !== 'undefined' ? document : null, win = typeof window !== 'undefined' ? window : null } = {}) {
  const listeners = new Set();
  const delays = new Map();            // run -> s, measured + estimated (what model.js places trains with)
  // runs measured in the newest fresh answer. has() / iteration / size check the report's age at the moment they are
  // read: a report turning 150 s old between two polls drops its live ring at once, with the label
  const measuredSet = new FreshSet((run) => liveNow(measured.get(run)));
  const derivedSet = new FreshSet((run) => liveNow(measured.get(run)));   // of those: placed by the reported place
  const estimates = new Map();         // run -> { d0, source: { line, station, at } }
  let measured = new Map();            // run -> info, from the newest answer (info.live = has a delay)
  let runByKey = new Map();
  let unmatched = [];
  let statusByLine = new Map(), statusByOp = new Map(), notices = [];
  let ops = {};
  let feedAt = 0;
  let st = { state: 'idle', reason: null };
  let timer = 0, started = false, current = null, errors = 0, lastPoll = 0, sig = '';
  let ix = null;

  // What model.js reads: delays (Map run -> s), measured (Set: live 1 vs estimated 2), delaysMax / delaysVersion.
  const touch = () => {
    if (!model || typeof model !== 'object') return;
    let max = 0;
    for (const d of delays.values()) if (d > max) max = d;
    model.delaysMax = max;
    model.delaysVersion = (model.delaysVersion || 0) + 1;
  };
  if (model && typeof model === 'object') {
    model.delays = delays; model.measured = measuredSet; model.derived = derivedSet; model.delaysMax = 0; model.delaysVersion = model.delaysVersion || 0;
  }

  const keyOf = (r) => (typeof r === 'string' ? r : r?.key);
  const runOf = (r) => (r && typeof r === 'object' ? r : runByKey.get(r) || null);
  const lineIdOf = (l) => (typeof l === 'number' ? model?.lines?.[l]?.id : typeof l === 'object' && l ? l.id : l);
  // live marks last while the newest good snapshot is young: one failed poll does not flip trains to scheduled
  const fresh = () => feedAt > 0 && now() - feedAt <= STALE_MS;
  // one report is live while it is young (a per-line source comes round every few minutes: older = an estimate)
  const young = (info, ms = now()) => !Number.isFinite(info?.at) || ms - info.at <= STALE_MS;
  const liveNow = (info, ms = now()) => !!info?.live && fresh() && young(info, ms);
  const sourceOf = (run, info) => ({ line: model?.lines?.[run.line]?.id ?? null, station: info.from || info.to || null,
    at: Number.isFinite(info.at) ? info.at : feedAt || now(), odpt: !!info.odpt });

  function emit() {
    for (const fn of listeners) { try { fn(api); } catch (e) { /* a broken listener never stops the others */ } }
  }

  function setEst(run, d0, source) {
    if (!Number.isFinite(d0)) return;
    const cur = estimates.get(run);
    if (!cur || cur.source.at <= source.at) estimates.set(run, { d0, source });
  }

  /** The estimate for a run at ms (a stale measurement counts as an estimate from its own report), or null. */
  function estFor(run, ms) {
    let e = estimates.get(run) || null;
    const m = measured.get(run);
    if (m && m.live && !liveNow(m, ms)) {
      const own = { d0: m.delaySec ?? m.lag, source: sourceOf(run, m) };   // a delay goes on: the figure first
      if (!e || own.source.at >= e.source.at) e = own;
    }
    if (!e) return null;
    const d = decayed(e.d0, e.source.at, ms);
    return d == null ? null : { delaySec: d, d0: e.d0, source: e.source, until: e.source.at + EST_MS };
  }

  /** model.delays + model.measured from the measured runs and the estimates at ms; expired estimates go. */
  function rebuild(ms) {
    for (const [run, e] of estimates) if (decayed(e.d0, e.source.at, ms) == null) estimates.delete(run);
    delays.clear(); measuredSet.clear(); derivedSet.clear();
    for (const [run, info] of measured) {
      if (!info.live) continue;
      if (liveNow(info, ms)) { delays.set(run, info.lag); measuredSet.add(run); if (info.derived) derivedSet.add(run); continue; }
      const e = estFor(run, ms);
      if (e) delays.set(run, e.delaySec);
    }
    for (const run of estimates.keys()) {
      if (measuredSet.has(run) || delays.has(run)) continue;
      const e = estFor(run, ms);
      if (e) delays.set(run, e.delaySec);
    }
    touch();
  }

  function clearData() {
    estimates.clear(); measured = new Map(); runByKey = new Map(); unmatched = [];
    if (delays.size || measuredSet.size) { delays.clear(); measuredSet.clear(); derivedSet.clear(); touch(); }
    statusByLine = new Map(); statusByOp = new Map(); notices = []; ops = {}; feedAt = 0;
  }

  function setState(state, reason = null) {
    const changed = st.state !== state || st.reason !== reason;
    st = { state, reason };
    return changed;
  }

  function apply(feed) {
    if (!model) return;
    const ms = now();
    if (!ix || ix.version !== model.version || ix.n !== (model.runs || []).length) ix = indexOf(model);
    const m = matchTrains(model, feed.trains, ms, ix);
    // a run measured before but missing now (left the reporting operator's track, a gap in the answer): estimate
    for (const [run, info] of measured) if (info.live && !m.byRun.get(run)?.live) setEst(run, info.delaySec ?? info.lag, sourceOf(run, info));
    measured = m.byRun; unmatched = m.unmatched;
    // the runs the measured train becomes next (through service, next lap): estimate from this report
    for (const [run, info] of measured) {
      if (!info.live) continue;
      const src = sourceOf(run, info);
      const until = serviceSec(src.at + EST_MS) + (serviceSec(src.at + EST_MS) < serviceSec(src.at) ? DAY : 0);
      for (const nx of successors(model, run, CHAIN_MAX, until)) if (!measured.get(nx)?.live) setEst(nx, info.delaySec ?? info.lag, src);
    }
    for (const run of [...estimates.keys()]) if (measured.get(run)?.live) estimates.delete(run);
    runByKey = new Map();
    for (const run of estimates.keys()) runByKey.set(run.key, run);
    for (const run of measured.keys()) runByKey.set(run.key, run);       // a measured run wins its key
    statusByLine = new Map(); statusByOp = new Map();
    for (const s of Array.isArray(feed.status) ? feed.status : []) {
      if (!s || !s.text) continue;
      if (s.line) statusByLine.set(s.line, s); else if (s.op) statusByOp.set(s.op, s);
    }
    notices = (Array.isArray(feed.status) ? feed.status : []).filter((s) => s && s.severity && s.severity !== 'normal')
      .sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0) || String(a.op).localeCompare(String(b.op)));
    ops = feed.ops && typeof feed.ops === 'object' ? feed.ops : {};
    feedAt = Number(feed.at) || ms;
    rebuild(ms);
  }

  function signature() {
    const parts = [st.state, st.reason, delays.size, measuredSet.size];
    for (const [run, d] of delays) parts.push(run.id, d, measuredSet.has(run) ? 1 : 2);
    for (const s of notices) parts.push(s.op, s.line, s.severity, s.at);
    return parts.join('|');
  }

  // one request at a time: a second call while one is out gets the same promise
  function poll() {
    if (!current) current = pollOnce().finally(() => { current = null; });
    return current;
  }

  async function pollOnce() {
    if (!fetchFn) return;
    lastPoll = now();
    let next = POLL_MS;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const kill = ctl ? timers.set(() => ctl.abort(), FETCH_TIMEOUT_MS) : 0;
      let res;
      try { res = await fetchFn(url, { headers: { accept: 'application/json' }, cache: 'no-cache', ...(ctl ? { signal: ctl.signal } : {}) }); }
      finally { if (kill) timers.clear(kill); }
      if (res.status === 404) {
        clearData(); setState('off', 'unreachable'); next = OFF_MS;   // no poller behind the path at all
      } else if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);                        // 502 / 503 / 504 while it restarts: a blip
      } else {
        const feed = await res.json();
        if (!feed || typeof feed !== 'object') throw new Error('bad feed');
        if (feed.off && feed.reason === 'offline') {
          throw new Error('offline');                                 // sw.js: the network failed, a blip
        } else if (feed.off) {
          clearData(); setState('off', String(feed.reason || 'off')); next = OFF_MS;
        } else if (!Array.isArray(feed.trains)) {
          throw new Error('bad feed');
        } else if (now() - (Number(feed.at) || 0) > STALE_MS) {
          throw new Error('stale');
        } else {
          apply(feed); setState('on'); errors = 0;
        }
      }
    } catch (e) {
      errors += 1;
      next = ERR_MS[Math.min(errors, ERR_MS.length) - 1];
      setState('error', String(e?.message || e).slice(0, 80));
      rebuild(now());                  // measurements age into estimates, estimates decay / expire
    }
    const s = signature();
    if (s !== sig) { sig = s; emit(); }
    schedule(next);
  }

  function schedule(ms) {
    if (timer) timers.clear(timer);
    timer = 0;
    if (!started) return;
    if (doc?.hidden) return;                      // hidden tab: nothing polls; visibilitychange picks it up again
    timer = timers.set(poll, ms);
  }

  function onOnline() { if (started && !doc?.hidden) poll(); }

  /** Marks and delays as of now (a report aged while nobody polled: playback, a hidden tab, a slow first answer). */
  function refreshMarks() {
    rebuild(now());
    const s = signature();
    if (s !== sig) { const had = sig !== ''; sig = s; if (had) emit(); }   // nothing to tell before the first answer
  }

  function onVisible() {
    if (!started || doc?.hidden) { if (timer) { timers.clear(timer); timer = 0; } return; }
    refreshMarks();
    if (now() - lastPoll >= POLL_MS) poll(); else schedule(POLL_MS - (now() - lastPoll));
  }

  const stationName = (id) => {
    const s = id ? model?.stationById?.get?.(id) || model?.stations?.find?.((x) => x.id === id) : null;
    return s?.name ? title(s.name) : id ? String(id).split('.').pop() : '';
  };
  const lateText = (prefix, sec) => {
    const n = Math.round((Number(sec) || 0) / 60);
    return n > 0 ? t(`${prefix}.late`, { n }) : t(`${prefix}.ontime`);
  };

  const api = {
    start() {
      if (started) return api;
      started = true;
      doc?.addEventListener?.('visibilitychange', onVisible);
      win?.addEventListener?.('online', onOnline);
      refreshMarks();                                  // "Back to now" after a playback: no stale delays until the answer
      if (!doc?.hidden) poll();
      return api;
    },
    stop() {
      started = false;
      if (timer) timers.clear(timer);
      timer = 0;
      doc?.removeEventListener?.('visibilitychange', onVisible);
      win?.removeEventListener?.('online', onOnline);
      return api;
    },
    /** Poll now (tests, a manual refresh). */
    refresh: poll,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get delays() { return delays; },
    get measured() { return measuredSet; },
    stateOf(r) {
      const run = runOf(r);
      if (!run) return 'scheduled';
      if (liveNow(measured.get(run))) return 'live';
      return estFor(run, now()) ? 'estimated' : 'scheduled';
    },
    delayOf(r) {
      const info = measured.get(runOf(r));
      return liveNow(info) ? info.delaySec : null;
    },
    liveOf(r) {
      const info = measured.get(runOf(r));
      return liveNow(info) ? info : null;
    },
    /** Credit for the live data of this run / line: ODPT's (+ Toei's CC BY) for ODPT data; '' for other sources. */
    creditOf(r) {
      let odpt = false, op = null;
      const run = runOf(r);                                  // a run or run key; else a line (index, id or object)
      if (run && Array.isArray(run.stops)) {
        const info = measured.get(run);
        const e = info ? null : estFor(run, now());
        odpt = info ? !!info.odpt : !!e?.source?.odpt;
        op = info ? info.op : e?.source?.line ? String(e.source.line).split('.')[0] : null;
      } else {
        const id = lineIdOf(r);
        op = id ? String(id).split('.')[0] : null;
        for (const [x, info] of measured) if (info.odpt && model?.lines?.[x.line]?.id === id) { odpt = true; break; }
      }
      if (!odpt) return '';
      return op === 'Toei' ? `${t('live.credit')} ${t('live.credit.toei')}` : t('live.credit');
    },
    estimateOf(r) {
      const run = runOf(r);
      if (!run || api.stateOf(run) !== 'estimated') return null;
      return estFor(run, now());
    },
    /** The text a view puts on this train, in the page language (i18n 'live.pos' / 'live.est' / 'sched'). */
    label(r) {
      const run = runOf(r);
      const state = api.stateOf(run);
      if (state === 'live') {
        const info = measured.get(run);
        const at = Number.isFinite(info.at) ? info.at : feedAt;
        if (info.delaySec == null) return t('live.pos.only', { time: clockMs(at) });   // a place, no delay figure
        return t('live.pos', { late: lateText('live.pos', info.delaySec), time: clockMs(at) });
      }
      if (state === 'estimated') {
        const e = estFor(run, now());
        return t('live.est', { late: lateText('live.est', e.delaySec), station: stationName(e.source.station), time: clockMs(e.source.at) });
      }
      return t('sched');
    },
    status(l) {
      if (!fresh()) return null;
      const id = lineIdOf(l);
      if (!id) return null;
      return statusByLine.get(id) || statusByLine.get(STATUS_ALIAS[id]) || statusByOp.get(String(id).split('.')[0]) || null;
    },
    notices() { return fresh() ? notices.slice() : []; },
    updatedAt(l) {
      if (!fresh()) return null;
      const id = lineIdOf(l);
      return id ? ops[String(id).split('.')[0]] ?? null : null;
    },
    stopsOf(run, ms = now()) {
      const state = api.stateOf(run);
      const d = state === 'live' ? (measured.get(run).delaySec ?? measured.get(run).lag) : state === 'estimated' ? estFor(run, ms).delaySec : null;
      return d == null ? run.stops : shiftStops(run.stops, d, serviceSec(ms) - (model?._off?.get?.(run) || 0));
    },
    unmatched() { return fresh() ? unmatched.slice() : []; },
    state() {
      let matched = 0, est = 0;
      for (const info of measured.values()) if (info && !info.part) matched += 1;   // a split train counts once
      const ms = now();
      for (const run of estimates.keys()) if (!measuredSet.has(run) && decayed(estimates.get(run).d0, estimates.get(run).source.at, ms) != null) est += 1;
      return { ...st, at: feedAt || null, trains: matched + unmatched.length, matched, unmatched: unmatched.length, estimated: est,
        live: measuredSet.size };
    },
    keyOf,
  };
  return api;
}
