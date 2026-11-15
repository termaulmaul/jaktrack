// one train. The Tokyo remake of trafik.live/kereta's train screen
// (kereta/views.js trainView + trackHtml, kereta/board.js whereNow + trainTrack, krl/panes.js), on the data shapes (docs/ARCHITECTURE.md):
// its type, number, destination, operator and cars; every stop with its WIB time and where the train is now by its
// timetable ("between X and Y" / "at X"); its through-running onto other lines (run.prev / run.next) drawn as ONE
// journey with a line chip per line; and the follow camera that keeps the train centred while its sheet is open.
//
// Views are HTML strings (every dynamic value through esc()), in the style of kereta/views.js:
//   trainView(m, runRef, ms, st, api, desktop) -> html     runRef = run.id, run.key, run index or the run itself
//   follow(map, getPos, opts) -> { on, start(), stop(), toggle(), destroy() }   (the follow camera, see below)
//   trainPos(m, runRef, ms) -> [lng, lat, bearing] | null   (where the train of runRef's journey is drawn now)
//   act(dataset, st) -> true when a tap was one of ours (data-act="tv-follow" | "tv-all")
// m = model.js's createModel(net, runs) (model.js): lines, stations, groups, types, dirs, operators, runs, runById.
// Taps: data-train = run.id, data-station = station.id, data-line = line.id (page.js's click delegate opens them).
// Positions are timetable positions, never reports: every screen says "Scheduled".

import { esc } from '../app/format.js';
import { icon } from '../app/ui.js';
import { clock, clockMs, has, lang, t, title, titleAlt, tn } from './i18n.js';
import { DAY, liveDelay, position, serviceTime, trainClock } from './model.js';
import { lineChip as tkLineChip, typeChip as tkTypeChip, typeStyle } from './types.js';
import { logoPlate } from './logos.js';

// ------------------------------------------------------------------ lookups
const runIdx = new WeakMap();
const CAL_SUFFIX = /\.(Weekday|SaturdayHoliday|Saturday|Holiday|Sunday|weekday|holiday)(\.\d+)?$/;
/** The run runRef names: the run itself, its index in m.runs, its id, or its key ('JR-East.Yamanote.400G', and an id
 * of another calendar: today's run of that train, the one running now first). */
export function runOf(m, ref, ms = Date.now()) {
  if (ref == null || !m) return null;
  if (typeof ref === 'object') return ref;
  const runs = m.runs || [];
  if (typeof ref === 'number' || /^\d+$/.test(ref)) return runs[Number(ref)] || null;
  const hit = m.runById?.get(ref);
  if (hit) return hit;
  let c = runIdx.get(m);
  if (!c || c.runs !== runs || c.n !== runs.length) {
    const byId = new Map(), byKey = new Map();
    for (const r of runs) {
      byId.set(r.id, r);
      const k = r.key || String(r.id).replace(CAL_SUFFIX, '');
      let a = byKey.get(k); if (!a) byKey.set(k, a = []); a.push(r);
    }
    runIdx.set(m, c = { runs, n: runs.length, byId, byKey });
  }
  if (c.byId.has(ref)) return c.byId.get(ref);
  const same = c.byKey.get(ref) || c.byKey.get(String(ref).replace(CAL_SUFFIX, ''));
  if (!same?.length) return null;
  if (same.length === 1) return same[0];
  const sec = secOf(same[0], ms);
  return same.find((r) => sec >= firstDep(r) && sec <= lastArr(r)) || same.find((r) => firstDep(r) > sec) || same[0];
}
/** A line (index, id or object) -> its index in m.lines, or -1. */
export function lineIndex(m, ref) {
  if (ref == null || !m) return -1;
  if (typeof ref === 'object') return m.lines.indexOf(ref);
  if (typeof ref === 'number' || /^\d+$/.test(ref)) return m.lines[Number(ref)] ? Number(ref) : -1;
  const l = m.lineById?.get(ref);
  return l ? m.lines.indexOf(l) : m.lines.findIndex((x) => x.id === ref);
}
const runRef = (m, ref) => (typeof ref === 'number' ? m.runs?.[ref] : m.runById?.get(ref) || runOf(m, ref, null)) || null;
/** The line a next / prev entry names when that run is not loaded (yet): its id's 'Operator.Line' prefix. */
function lineOfRef(m, ref) {
  const r = runRef(m, ref);
  if (r) return r.line;
  const [a, b] = String(ref).split('.');
  const i = lineIndex(m, `${a}.${b}`);
  return i >= 0 ? i : null;
}

// ------------------------------------------------------------------ names (EN / JA; ID uses the English names)
export const sName = (m, s) => title(m.stations[s]?.name);
export const lName = (m, l) => title(m.lines[l]?.title);
const tName = (m, y) => title(m.types[y]?.title);
/** The operator of line l in the current language (model.operators, the network build's ops, else the id's prefix). */
export function opName(m, l) {
  const line = m.lines[l];
  const op = line ? (m.operators || m.ops)?.[line.op] : null;
  return op ? title(op.title) || op.id : String(line?.id || '').split('.')[0];
}
/** Station indexes of s's interchange complex (model.groups), s itself when it stands alone. */
export function complexOf(m, s) {
  const g = m.stations[s]?.group;
  const ids = g != null && g >= 0 && m.groups?.[g] ? m.groups[g] : [s];
  return ids.includes(s) ? ids : [s, ...ids];
}
/** Where run r goes, the way a board says it: {to [station] (MT3D's destination = where a through train ends up),
 * loop (a loop-line train going round: `toward` = the next two big stations), toward [station], name}. */
export function destination(m, r) {
  const L = m.lines[r.line];
  const lap = (r.next || []).map((x) => runRef(m, x)).find((x) => x && x.line === r.line);
  const loop = !!L?.loop && (!!lap || (r.stops.length > 2 && samePlace(m, r.stops[0].s, r.stops[r.stops.length - 1].s)));
  const to = (r.to?.length && r.to[0] >= 0 ? r.to : [r.stops[r.stops.length - 1].s]).slice();
  // a named train (the timetable build `names`: [{en, ja}] like "Azusa 3"; MT3D `nm`)
  return { to, loop, toward: loop ? towardOnLoop(m, r, 0) : [], name: r.names?.[0] || r.name || r.nm || null };
}
function towardOnLoop(m, r, i) {
  const ahead = [], here = m.stations[r.stops[i]?.s]?.group;
  let cur = r, k = i + 1, hops = 0;
  while (cur && ahead.length < 14 && hops < 3) {
    for (; k < cur.stops.length && ahead.length < 14; k++) {
      const s = cur.stops[k].s;
      if (!ahead.includes(s) && (here == null || here < 0 || m.stations[s]?.group !== here)) ahead.push(s);
    }
    cur = (cur.next || []).map((x) => runRef(m, x)).find((x) => x && x.line === r.line);
    k = 1; hops++;
  }
  const size = (s) => { const g = m.stations[s]?.group; return g != null && g >= 0 && m.groups?.[g] ? m.groups[g].length : 1; };
  return ahead.map((s, n) => ({ s, n, w: size(s) })).sort((a, b) => b.w - a.w || a.n - b.n).slice(0, 2).sort((a, b) => a.n - b.n).map((x) => x.s);
}
/** Station s and s2 are the same place (same station, or the same interchange complex): a through-run's hand-over. */
const samePlace = (m, s, s2) => s === s2 || (m.stations[s]?.group >= 0 && m.stations[s]?.group === m.stations[s2]?.group)
  || (m.stations[s] && m.stations[s2] && m.stations[s].name?.en === m.stations[s2].name?.en);
const isHome = (m, s, home) => {
  if (home == null || home === '') return false;
  const h = typeof home === 'number' || /^\d+$/.test(home) ? Number(home) : m.stationById?.get(home) ? m.stations.indexOf(m.stationById.get(home)) : m.stations.findIndex((x) => x.id === home);
  return h >= 0 && (h === s || complexOf(m, h).includes(s));
};

// ------------------------------------------------------------------ time (WIB service seconds)
const secOf = (r, ms) => trainClock(r, serviceTime(ms)).seconds;
const firstDep = (r) => r.stops[0].d ?? r.stops[0].a;
const lastArr = (r) => { const s = r.stops[r.stops.length - 1]; return s.a ?? s.d; };
/** A stop's time on screen: the departure, at the last stop the arrival. */
const stopTime = (r, i) => (i === r.stops.length - 1 ? lastArr(r) : r.stops[i].d ?? r.stops[i].a);
export const hhmm = (sec) => clock(sec);
/** Whole minutes from sec until at (both service seconds), rounded down. */
const minsTo = (at, sec) => Math.floor((at - sec) / 60);

// ------------------------------------------------------------------ the journey (through-running)
/** a -> b is a new lap of a loop line (Yamanote 400G -> 500G) or a turn-back on the same line, not the same journey. */
const isLap = (a, b) => a.line === b.line && String(a.number) !== String(b.number);
/**
 * One train's journey across lines: the runs linked by prev / next (first link each way, as Mini Tokyo 3D's train
 * panel), without the laps of a loop line. {runs, at (index of run), lapPrev, lapNext (the lap before / after on the
 * same line: "continues as 500G"), forks [{at, run | ref, line}] (a train that splits: the other part), more {prev,
 * next} (a link to a run not loaded yet: {ref, line})}.
 */
export function journey(m, run, max = 8) {
  const runs = [run], seen = new Set([run.id]);
  let lapPrev = null, lapNext = null;
  const forks = [], more = { prev: null, next: null };
  // a link to a run that is not loaded (yet: another time bucket) onto another line: "through to / from <line>"
  const unloaded = (refs, got, line) => {
    const i = refs.findIndex((x, n) => !got[n] && lineOfRef(m, x) != null && lineOfRef(m, x) !== line);
    return i < 0 ? null : { ref: refs[i], line: lineOfRef(m, refs[i]) };
  };
  for (let cur = run; runs.length < max;) {
    const refs = cur.prev || [], ps = refs.map((x) => runRef(m, x));
    const k = ps.findIndex((p) => p && !seen.has(p.id) && !isLap(p, cur));
    if (k < 0) {
      lapPrev = ps.find((p) => p && isLap(p, cur)) || null;
      more.prev = unloaded(refs, ps, cur.line);
      break;
    }
    runs.unshift(ps[k]); seen.add(ps[k].id); cur = ps[k];
  }
  for (let cur = run; runs.length < max;) {
    const refs = cur.next || [], ns = refs.map((x) => runRef(m, x));
    const k = ns.findIndex((x) => x && !seen.has(x.id) && !isLap(cur, x));
    if (k < 0) {
      lapNext = ns.find((x) => x && isLap(cur, x)) || null;
      more.next = unloaded(refs, ns, cur.line);
      break;
    }
    // a train that splits: the part that does not stay in this journey
    ns.forEach((x, i) => {
      if (i === k || (x && (seen.has(x.id) || isLap(cur, x)))) return;
      const line = x ? x.line : lineOfRef(m, refs[i]);
      if (line != null) forks.push(x ? { at: cur, run: x, line } : { at: cur, ref: refs[i], line });
    });
    runs.push(ns[k]); seen.add(ns[k].id); cur = ns[k];
  }
  // a loop line (Yamanote): the next lap belongs on the track too (a rider at Ebisu wants Shinagawa's time), once
  const laps = new Set();
  if (lapNext && m.lines[lapNext.line]?.loop && runs.length < max && !seen.has(lapNext.id)) {
    const last = runs[runs.length - 1];
    runs.push(lapNext); seen.add(lapNext.id); laps.add(lapNext.id);
    lapNext = (lapNext.next || []).map((x) => runRef(m, x)).find((x) => x && !seen.has(x.id) && isLap(lapNext, x) && x !== last) || null;
  }
  return { runs, at: runs.indexOf(run), lapPrev, lapNext, forks, more, laps };
}

// ------------------------------------------------------------------ where the train is now (by its timetable)
/**
 * Where run r is at ms by its timetable, the way the map draws it (model.js's position()): {state, stop, from, to, pos}.
 * state: 'before' (not at its first station yet), 'wait' (standing at its first station, about to leave), 'at'
 * (standing at stop `stop`), 'between' (between stop-1 and stop: from -> to), 'end' (standing at its last stop),
 * 'done' (its run is over). pos = model.js's position object (null when not on the map).
 */
export function whereNow(m, r, ms = Date.now()) {
  const sec = secOf(r, ms), p = position(r, sec);
  const last = r.stops.length - 1;
  if (!p) return sec < firstDep(r) ? { state: 'before', stop: 0, pos: null } : { state: 'done', stop: last, pos: null };
  if (p.state === 0) return { state: 'between', stop: p.stop, from: r.stops[p.stop - 1].s, to: r.stops[p.stop].s, pos: p };
  if (p.state === 2) return { state: 'wait', stop: 0, pos: p };
  if (p.state === 3) return { state: 'end', stop: last, pos: p };
  return { state: 'at', stop: p.stop, pos: p };
}
/** Where the journey's train is now: {k (run index in j.runs), ...whereNow} ('before' / 'done' for the whole journey). */
export function journeyNow(m, j, ms = Date.now()) {
  const n = j.runs.length;
  let w = null;
  for (let k = 0; k < n; k++) {
    w = whereNow(m, j.runs[k], ms);
    if (w.state === 'done') continue;
    if (w.state === 'end' && k < n - 1) { // handed over: it stands at the junction as the next run
      const w2 = whereNow(m, j.runs[k + 1], ms);
      return w2.state === 'before' ? { ...w2, state: 'at', stop: 0, k: k + 1, pos: w.pos } : { ...w2, k: k + 1 };
    }
    if (w.state === 'before' && k > 0) return { state: 'at', stop: 0, k, pos: null };
    return { ...w, k };
  }
  return { ...w, k: n - 1 };
}
/** The run of runRef's journey that is on the map now (the train may already run on its next line), or null. */
export function activeRun(m, ref, ms = Date.now()) {
  const r = runOf(m, ref, ms);
  if (!r) return null;
  const j = journey(m, r), w = journeyNow(m, j, ms);
  return w.pos || w.state === 'at' ? j.runs[w.k] : null;
}
/** Where the train of runRef's journey is drawn now: [lng, lat, bearing], or null when it is not on the map. */
export function trainPos(m, ref, ms = Date.now()) {
  const r = runOf(m, ref, ms);
  if (!r) return null;
  const j = journey(m, r), w = journeyNow(m, j, ms);
  let p = w.pos;
  if (!p && w.state === 'at') p = position(j.runs[w.k], secOf(j.runs[w.k], ms), { force: true });
  return p ? [p.lng, p.lat, p.bearing] : null;
}

// ------------------------------------------------------------------ the stops of the journey, as one track
/**
 * The journey's stops in order: [{k, i, run, s, line, time, arr, xfer (first stop on a new line), past, here}] where a
 * through-run's hand-over station shows once (its arrival on the old line, its departure on the new). Plus where the
 * train is: {rows, j, w, cur (row index of the stop it is at or heading to)}.
 */
export function trainTrack(m, run, ms = Date.now()) {
  const j = journey(m, run), w = journeyNow(m, j, ms), rows = [];
  let carry = null;
  j.runs.forEach((r, k) => {
    const last = r.stops.length - 1;
    r.stops.forEach((st, i) => {
      const nx = j.runs[k + 1];
      if (i === last && nx && samePlace(m, st.s, nx.stops[0].s)) { carry = lastArr(r); return; }
      rows.push({ k, i, run: r, s: st.s, line: r.line, time: stopTime(r, i), arr: i === 0 && carry != null ? carry : null, xfer: k > 0 && i === 0, lap: k > 0 && i === 0 && j.laps.has(r.id), end: i === last && k === j.runs.length - 1 });
      if (i === 0) carry = null;
    });
  });
  const rowOf = (k, i) => {
    let x = rows.findIndex((o) => o.k === k && o.i === i);
    if (x < 0 && i === j.runs[k].stops.length - 1) x = rows.findIndex((o) => o.k === k + 1 && o.i === 0);
    return x;
  };
  const cur = w.state === 'before' ? 0 : w.state === 'done' ? rows.length - 1 : Math.max(0, rowOf(w.k, w.stop));
  rows.forEach((o, x) => {
    o.past = w.state === 'done' || (w.state !== 'before' && x < cur);
    o.here = (w.state === 'at' || w.state === 'wait' || w.state === 'end') && x === cur;
  });
  return { j, w, rows, cur };
}

// ------------------------------------------------------------------ pieces
/** A line chip: the line's code in a ring of its colour (JY, G), the way Tokyo's station numbering draws lines; a
 * line without a code is a plain disc of its colour. Round, never a square badge (look rule). */
export function lineChip(l, size = '') {
  if (!l) return '';
  // a line without a code wears the Lines list's letters ("Jo" Joetsu: views.js disc), never an empty ring
  if (!l.code) {
    const c = (l.title?.en || l.id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2);   // the same letters in every language
    if (c) l = { ...l, code: c };
  }
  // one look everywhere: types.js's ring (kereta's disc); sizes here: xl = a screen's head (40 px)
  try { return tkLineChip(l, lang(), { size: size === 'xl' ? '' : size }); } catch { /* types.js not ready: our ring */ }
  const code = l.code || '';
  return `<span class="tv-ring${size ? ` ${size}` : ''}${code ? '' : ' nocode'}" style="--rc:${esc(l.color || '#6B6B70')}" data-len="${Math.min(3, code.length)}" aria-hidden="true">${code ? `<b>${esc(code)}</b>` : ''}</span>`;
}
/** The train type as a round chip, by types.js's rules (types.js: locals grey, faster types tinted by rank). */
function typeChip(m, r) {
  const y = m.types[r.type];
  if (!y) return '';
  try { return tkTypeChip(y, lang(), { title: true, line: m.lines[r.line] }).replace('class="tk-type"', 'class="tk-type tv-type"'); } catch {
    return `<span class="tv-chip tv-type">${esc(tName(m, r.type))}</span>`;
  }
}
/** The colour a train is drawn in on the strip: its type's own colour (types.js `ink`, null for locals), else its
 * line's colour (a local looks like its line, as on the map). */
export function trainColor(m, r) {
  const y = m.types[r.type];
  let ink = null;
  try { ink = y ? typeStyle(y, m.lines[r.line], r)?.ink : null; } catch { /* types.js not ready: line colour */ }
  return ink || m.lines[r.line]?.color || '#6B6B70';
}
const carsOf = (m, r) => r.cars || m.lines[r.line]?.cars || 0;
/** Name lists the way the boards write them: split destinations JA '・' / EN + ID
 * ' / '; the big stations a loop heads for JA '・' / EN + ID ', '. */
export const joinTo = (names) => names.join(lang() === 'ja' ? '・' : ' / ');
export const joinToward = (names) => names.join(lang() === 'ja' ? '・' : ', ');
/** A direction's name: MT3D's title (JA / EN), the Indonesian words in ID where i18n has them ("Lingkar dalam"). */
export function dirName(m, d) {
  const dir = m.dirs[d];
  if (!dir) return '';
  if (lang() !== 'id') return title(dir.title);
  if (has(`board.dir.${dir.id}`)) return t(`board.dir.${dir.id}`);
  const en = dir.title?.en || dir.id;
  return /^For\s+/i.test(en) ? t('board.dir.for', { name: en.replace(/^For\s+/i, '') }) : en;
}
/** "To Shibuya" (or a loop's direction + the next big stations from stop i, or a named train). */
function headline(m, r, i = 0) {
  const d = destination(m, r);
  const name = d.name ? title(Array.isArray(d.name) ? d.name[0] : d.name) : '';
  if (name) return { title: name, to: d.loop ? '' : t('train.to', { name: joinTo(d.to.map((s) => sName(m, s))) }) };
  if (d.loop) {
    const dir = dirName(m, r.dir);
    const toward = joinToward(towardOnLoop(m, r, Math.max(0, Math.min(i, r.stops.length - 1))).map((s) => sName(m, s)));
    return { title: dir || lName(m, r.line), to: toward ? t('tv.toward', { names: toward }) : '' };
  }
  return { title: t('train.to', { name: joinTo(d.to.map((s) => sName(m, s))) }), to: '' };
}
const STATION_SVG = '<svg class="i tv-sg" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="13" rx="3"/><path d="M6 10h12M9.5 13.5h.01M14.5 13.5h.01M8.5 20l1.8-3.5M15.5 20l-1.8-3.5"/></svg>';
export const stationTile = () => `<span class="etile tv-stile" aria-hidden="true">${STATION_SVG}</span>`;
const note = (text) => `<p class="tv-note">${text}</p>`;
/** Toei live data only ever comes from ODPT (adapters may not report Toei: live.js's registry refuses it), so Toei keeps the
 * ODPT + Toei CC BY credit (licence) even when live.creditOf() has nothing (a live service older than its `src` flag).
 * Any other operator: '' (never named or credited when not ODPT). */
export const toeiCredit = (op) => (op === 'Toei' ? joinSent([t('live.credit'), t('live.credit.toei')]) : '');
/** Sentences joined the page's way: a space in EN / ID, none in JA (as page.js's joinSent). */
export const joinSent = (parts) => parts.filter(Boolean).join(lang() === 'ja' ? '' : ' ');

// ------------------------------------------------------------------ live
/** The page's live layer (live.js createLive): api.live, else the page's QA handle; null = no live layer. */
const liveApi = (api) => api?.live ?? (typeof globalThis !== 'undefined' ? globalThis.__tokyo?.live : null) ?? null;
/**
 * Is run measured by the operator now? {delay (s, measured; 0 = on time), at (ms of the data: ODPT dc:date), op} |
 * {estimated: true, label, delay, at, op} = live.js's estimate (a delay carried from the train's last report, e.g. a Toei
 * train running on into Keisei: "Estimated · about 2 min late (last report Oshiage 17:38)", never the live mark) |
 * null = no live data: the run stays "Scheduled" exactly as before. With the live layer: live.liveOf(run) (measured
 * only) then live.stateOf(run) === 'estimated'; without it: model.js's liveDelay (model.delays, measured, no data time).
 */
/** The feed's fresh measurement of this run, else null (never throws). */
function liveOfRun(api, run) {
  try { const info = liveApi(api)?.liveOf?.(run); return info && info.live ? info : null; } catch { return null; }
}
export function liveState(m, run, api = {}) {
  if (!run) return null;
  const live = liveApi(api), lineId = m.lines[run.line]?.id;
  const op = String(lineId || '').split('.')[0];
  if (live && typeof live.liveOf === 'function') {
    let info = null;
    try { info = live.liveOf(run); } catch { info = null; }
    if (!info || !info.live) {
      let state = null;
      try { state = live.stateOf?.(run) ?? null; } catch { state = null; }
      if (state !== 'estimated') return null;
      let e = null, label = '';
      try { e = live.estimateOf?.(run) ?? null; label = live.label?.(run) || ''; } catch { /* the words below */ }
      const delay = Number(e?.delaySec) || 0;
      if (!label) label = t('live.est.late', { n: Math.max(0, Math.round(delay / 60)) });
      return { estimated: true, label, delay, at: Number.isFinite(e?.source?.at) ? e.source.at : null, op };
    }
    let at = Number.isFinite(info.at) ? info.at : null;
    if (at == null) { try { at = live.updatedAt?.(lineId) ?? null; } catch { at = null; } }
    // no delay figure in the report (Toei trams, or a source that reports only a place): placed and timed by the lag read
    // from the reported place, but the words claim no minutes ("Live position · as of 17:40")
    const fig = Number.isFinite(info.delaySec) ? info.delaySec : null;
    const lag = fig ?? (Number.isFinite(info.lag) ? info.lag : 0);
    return { delay: lag, figure: fig != null, at, op };
  }
  const d = liveDelay(m, run);
  return d == null ? null : { delay: d, at: null, op };
}
/** Whole minutes late (rounded; early counts as on time). */
const lateMin = (lv) => Math.max(0, Math.round((lv?.delay || 0) / 60));
/** "Live position · 3 min late" / "実際の位置 · 3分遅れ" / "Posisi langsung · terlambat 3 mnt"; on time likewise. An
 * estimate reads live.js's own words ("Estimated · about 2 min late (last report Oshiage 17:38)"). */
export const liveLabel = (lv) => (lv?.estimated ? lv.label : lv?.figure === false ? t('tv.live')
  : `${t('tv.live')} · ${lateMin(lv) ? t('tv.live.late', { n: lateMin(lv) }) : t('tv.live.ontime')}`);
/** Measured (the live mark, the green dot, the operator's note); an estimate is not. */
export const isLive = (lv) => !!lv && !lv.estimated;
/** liveLabel as HTML for the screen: the late part in the delay colour (green only means on time). */
export function liveLabelHtml(lv) {
  if (!lv) return esc(t('sched'));
  if (lv.estimated) return esc(lv.label);
  if (lv.figure === false) return esc(t('tv.live'));
  const n = lateMin(lv);
  return `${esc(t('tv.live'))} · ${n ? `<span class="tv-late">${esc(t('tv.live.late', { n }))}</span>` : esc(t('tv.live.ontime'))}`;
}
/** The language of a station's other-script name: Japanese on EN / ID screens, English on JA (VoiceOver, glyph forms). */
export const altLang = () => (lang() === 'ja' ? 'en' : 'ja');
/** "as of 17:32" (WIB) from the data time, '' without one. */
const asOf = (lv) => (lv && Number.isFinite(lv.at) ? t('tv.asof', { time: clockMs(lv.at) }) : '');
/** The screen's head (the place head of app/ui.js, with the close button's label in the page's language). */
export function head({ lead, title: text, sub = '', close = false }) {
  return `<div class="ph" data-drag>${lead}<div class="rt"><h2>${esc(text)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${close ? `<button type="button" class="xbtn" data-act="back" aria-label="${esc(t('close'))}">${icon('x')}</button>` : ''}</div>`;
}

/** The state line under the head: "Between Shinjuku and Yoyogi · Scheduled". */
function statePill(m, j, w, color, lv = null) {
  const r = j.runs[w.k] || j.runs[0];
  const sched = lv ? `${liveLabelHtml(lv)}${isLive(lv) && asOf(lv) ? ` · ${esc(asOf(lv))}` : ''}` : esc(t('sched'));
  let html;
  if (w.state === 'between') html = `<b>${esc(t('tv.between', { a: sName(m, w.from), b: sName(m, w.to) }))}</b> · ${sched}`;
  else if (w.state === 'at' || w.state === 'end') html = `<b>${esc(t('tv.at', { name: sName(m, r.stops[w.stop].s) }))}</b> · ${sched}`;
  else if (w.state === 'wait') html = `<b>${esc(t('tv.wait', { name: sName(m, r.stops[0].s), time: hhmm(firstDep(r)) }))}</b> · ${sched}`;
  else if (w.state === 'before') { const r0 = j.runs[0]; html = `<b>${esc(t('tv.before'))}</b> · ${esc(t('tv.before.sub', { name: sName(m, r0.stops[0].s), time: hhmm(firstDep(r0)) }))}`; }
  else { const rl = j.runs[j.runs.length - 1]; html = `<b>${esc(t('tv.done'))}</b> · ${esc(t('tv.done.sub', { name: sName(m, rl.stops[rl.stops.length - 1].s), time: hhmm(lastArr(rl)) }))}`; }
  const moving = w.state === 'between';
  return `<p class="tv-pill${moving ? ' moving' : ''}${isLive(lv) ? ' live' : ''}" style="--lc:${esc(color)}"><i></i><span>${html}</span></p>`;
}

/** One stop on the track. */
function stopRow(m, o, sec, home, prevColor, late = 0) {
  const st = m.stations[o.s], L = m.lines[o.line];
  const mine = isHome(m, o.s, home);
  const exp = o.time + late;                     // expected time (timetable + the measured delay) on stops ahead
  const min = minsTo(exp, sec);
  const cd = mine && !o.past && min >= 0 && min < 60 ? `<span class="cd">${esc(min <= 0 ? t('dep.now') : t('min', { n: min }))}</span>` : '';
  const alt = titleAlt(st?.name);
  const code = st?.code ? `<small class="tv-code" style="--rc:${esc(L?.color || '#6B6B70')}">${esc(st.code)}</small>` : '';
  // every stop in its own line's colour (a through train's Toyoko / Sotetsu stretch is not drawn Fukutoshin brown)
  const xfer = o.xfer && prevColor ? ` style="--lc:${esc(L?.color || '#6B6B70')};--lp:${esc(prevColor)}"` : ` style="--lc:${esc(L?.color || '#6B6B70')}"`;
  const shifted = late && Math.floor(exp / 60) !== Math.floor(o.time / 60);
  const time = shifted
    ? `<span class="t tv-exp"><s aria-label="${esc(t('tv.timetable'))}">${esc(hhmm(o.time))}</s>${esc(hhmm(exp))}</span>`
    : o.arr != null && Math.floor(o.arr / 60) !== Math.floor(o.time / 60)
      ? `<span class="t"><small>${esc(hhmm(o.arr))}</small>${esc(hhmm(o.time))}</span>` : `<span class="t">${esc(hhmm(o.time))}</span>`;
  const cls = `tv-stop${o.past ? ' past' : ''}${o.here ? ' here' : ''}${mine ? ' mine' : ''}${o.xfer && prevColor ? ' xfer' : ''}`;
  const label = `${sName(m, o.s)}, ${shifted ? `${t('tv.expected', { time: hhmm(exp) })}, ${t('tv.timetable')} ${hhmm(o.time)}` : hhmm(o.time)}${o.here ? `, ${t('tv.now.here')}` : ''}`;
  return `<button type="button" class="${cls}"${xfer} data-station="${esc(st?.id ?? o.s)}" aria-label="${esc(label)}"><i></i>${code}<span class="n"><span class="nm">${esc(sName(m, o.s))}</span>${mine ? `<span class="me">${esc(t('my.is'))}</span>` : ''}${alt ? `<small lang="${altLang()}">${esc(alt)}</small>` : ''}</span>${cd}${time}</button>`;
}

/** The line change inside the track: "Through to Tokyu Toyoko Line · Express 003111" (or the next lap of a loop). */
function xferRow(m, r, past, lap) {
  const L = m.lines[r.line];
  const what = lap ? t('tv.lap', { no: r.number }) : t('tv.through', { line: lName(m, r.line) });
  const small = lap ? '' : [tName(m, r.type), r.number].filter(Boolean).join(' · ');
  // a new line opens that line's view; the next lap of a loop is the same train, nothing to open
  const tag = lap ? 'div' : 'button', attrs = lap ? '' : ` type="button" data-line="${esc(L?.id ?? r.line)}"`;
  return `<${tag}${attrs} class="tv-stop tv-xrow${past ? ' past' : ''}" style="--lc:${esc(L?.color || '#6B6B70')}">${lineChip(L, 'sm')}<span class="n">${esc(what)}${small ? `<small>${esc(small)}</small>` : ''}</span></${tag}>`;
}

function trackHtml(m, tr, sec, st, lv = null) {
  const { rows, w, j, cur } = tr;
  const late = lv ? lv.delay || 0 : 0;
  if (!rows.length) return '';
  const all = !!st.tvAll;
  const from = all ? 0 : Math.max(0, cur - 1);
  const out = [];
  if (from > 0) {
    const r0 = rows[0];
    out.push(`<button type="button" class="tv-stop past more first" data-act="tv-all" style="--lc:${esc(m.lines[r0.line]?.color || '#6B6B70')}"><span class="n">${esc(tn('tv.earlier', from, { name: sName(m, r0.s), time: hhmm(r0.time) }))}</span><span class="tv-show">${esc(t('tv.show'))}</span></button>`);
  }
  for (let x = from; x < rows.length; x++) {
    const o = rows[x], color = m.lines[o.line]?.color || '#6B6B70';
    if (x === cur && w.state === 'between') out.push(`<div class="tv-stop here-mark${isLive(lv) ? ' live' : ''}${isLive(lv) && lv.figure !== false && !lateMin(lv) ? ' ontime' : ''}" style="--lc:${esc(color)}" aria-hidden="true"><span class="tv-train"></span><span class="n">${esc(t('tv.now.here'))}<small>${liveLabelHtml(lv)}</small></span></div>`);
    const prevColor = o.xfer ? m.lines[rows[x - 1]?.line ?? j.runs[o.k - 1].line]?.color : null;
    let html = stopRow(m, o, sec, st.home, prevColor, x >= cur && !o.past ? late : 0);
    if (x === from && !out.length) html = html.replace('class="tv-stop', 'class="tv-stop first');
    if (x === rows.length - 1) html = html.replace('class="tv-stop', 'class="tv-stop last');
    out.push(html);
    if (o.xfer) out.push(xferRow(m, o.run, o.past && rows[x + 1]?.past, o.lap));
  }
  if (all && from === 0 && rows.length > 2 && cur > 1) out.push(`<button type="button" class="tv-less" data-act="tv-all">${esc(t('tv.less'))}</button>`);
  return `<div class="tv-track" style="--lc:${esc(m.lines[rows[from].line]?.color || '#6B6B70')}">${out.join('')}</div>`;
}

// ------------------------------------------------------------------ a train
/**
 * The train screen. st: {home (station index or id: "My station"), tvAll (show the stops it has passed), following
 * (the follow camera is on; or st.follow = the follow() controller), canFollow (false: no map, no button)}. api:
 * {stamp (timetable version text)}. desktop: draw the close button.
 */
export function trainView(m, ref, ms = Date.now(), st = {}, api = {}, desktop = false) {
  ensureCss();
  const run = runOf(m, ref, ms);
  if (!run) return head({ lead: stationTile(), title: t('tv.notfound'), sub: t('tv.notfound.sub'), close: desktop });
  const tr = trainTrack(m, run, ms), { j, w } = tr;
  // the run the train is on now (it may already run on its next line); before / after its journey: the one tapped
  const live = w.state === 'before' || w.state === 'done' ? run : j.runs[w.k] || run, L = m.lines[live.line] || m.lines[run.line];
  const sec = secOf(live, ms);
  const hl = headline(m, live, live === run || j.laps.has(live.id) ? Math.max(0, w.stop - (w.state === 'between' ? 1 : 0)) : 0);
  const op = opName(m, live.line);
  const sub = [lName(m, live.line), op && op !== lName(m, live.line) ? op : '', hl.to].filter(Boolean).join(' · ');
  const cars = carsOf(m, live);
  const meta = [typeChip(m, live), live.number ? `<span class="tv-chip">${esc(t('train.no', { no: live.number }))}</span>` : '',
    cars ? `<span class="tv-chip">${esc(tn('tv.cars', cars))}</span>` : '', live.vehicle ? `<span class="tv-chip">${esc(live.vehicle)}</span>` : '',
    logoPlate((m.operators || m.ops)?.[m.lines[live.line]?.op]?.id, opName(m, live.line), 'sm')].filter(Boolean).join('');
  const following = st.follow ? !!st.follow.on : !!st.following;
  const onMap = !!w.pos || w.state === 'at';
  const followBtn = st.canFollow === false || !onMap ? ''
    : `<button type="button" class="btn${following ? '' : ' primary'} tv-follow" data-act="tv-follow" aria-pressed="${following}">${icon(following ? 'stop' : 'nav')}${esc(t(following ? 'tv.unfollow' : 'tv.follow'))}</button>`;
  const lines = [...new Set(j.runs.map((r) => r.line))];
  const links = `<div class="tv-links">${lines.map((l) => `<button type="button" data-line="${esc(m.lines[l]?.id ?? l)}">${lineChip(m.lines[l], 'sm')}${esc(lName(m, l))}</button>`).join('')}</div>`;
  const ends = [];
  if (j.lapNext && w.state !== 'done') ends.push(`<button type="button" class="tv-next" data-train="${esc(j.lapNext.id)}">${lineChip(m.lines[j.lapNext.line], 'sm')}<span>${esc(t('tv.lap', { no: j.lapNext.number }))}</span>${icon('chev', 'chev')}</button>`);
  for (const f of j.forks) ends.push(`<${f.run ? `button type="button" data-train="${esc(f.run.id)}"` : 'div'} class="tv-next">${lineChip(m.lines[f.line], 'sm')}<span>${esc(t('tv.fork', { line: lName(m, f.line), name: f.run ? sName(m, f.run.stops[f.run.stops.length - 1].s) : lName(m, f.line) }))}</span>${f.run ? icon('chev', 'chev') : ''}</${f.run ? 'button' : 'div'}>`);
  if (j.more.next?.line != null) ends.push(`<div class="tv-next">${lineChip(m.lines[j.more.next.line], 'sm')}<span>${esc(t('tv.through', { line: lName(m, j.more.next.line) }))}</span></div>`);
  if (j.more.prev?.line != null) ends.unshift(`<div class="tv-next">${lineChip(m.lines[j.more.prev.line], 'sm')}<span>${esc(t('tv.from.line', { line: lName(m, j.more.prev.line) }))}</span></div>`);
  const through = lines.length > 1 ? `<p class="tv-thru">${esc(t('tv.journey', { n: lines.length }))}</p>` : '';
  const stamp = api.stamp ? ` ${esc(t('tv.stamp', { stamp: api.stamp }))}` : '';
  // live (measured by the operator: ODPT): the live label instead of "Scheduled", expected times, the data time
  // (D7, one state per train): the part the timetable shows can be a later run of the journey than the one
  // the feed measured (the timetable moved on, the late train has not): a measured part of THIS journey (one physical
  // train) makes the train live, as the map's pill (it follows the run the trains layer placed) already says
  let lvRun = live;
  if (w.state !== 'done' && !liveOfRun(api, live)) lvRun = j.runs.find((r) => liveOfRun(api, r)) || live;
  const lv = w.state === 'done' ? null : liveState(m, lvRun, api);
  const opTitle = opName(m, live.line);
  // the source is named and credited only for ODPT data (live.creditOf: '' for any other source: never named or
  // hinted); the data time as its own sentence, joined without spaces in JA
  let credit = '';
  if (isLive(lv)) { try { credit = liveApi(api)?.creditOf?.(live) || ''; } catch { credit = ''; } }
  if (isLive(lv) && !credit) credit = toeiCredit(lv.op);
  const liveNote = isLive(lv) ? esc(joinSent([credit ? t('tv.note.live', { op: opTitle }) : t('live.note'),
    Number.isFinite(lv.at) ? t('tv.note.asof', { time: clockMs(lv.at) }) : '', credit])) : '';
  return `${head({ lead: lineChip(L, 'xl'), title: hl.title, sub, close: desktop })}
    <div class="tv-meta">${meta}</div>
    ${statePill(m, j, w, L?.color || '#6B6B70', lv)}
    ${followBtn}
    ${through}${trackHtml(m, tr, sec, st, lv)}
    ${ends.length ? `<div class="tv-ends">${ends.join('')}</div>` : ''}
    ${links}
    ${note(isLive(lv) ? `${liveNote}${stamp}` : `${esc(t('tv.note'))}${stamp}`)}`;
}

// ------------------------------------------------------------------ taps
/** page.js's click delegate calls act(el.dataset, S) first; true = handled (then re-render). */
export function act(d, st) {
  if (!d || !st) return false;
  if (d.act === 'tv-all') { st.tvAll = !st.tvAll; return true; }
  if (d.act === 'tv-follow') {
    if (st.follow?.toggle) st.follow.toggle();
    else st.following = !st.following;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ the follow camera
/**
 * Keep a train centred on the map: f = follow(map, () => trainPos(m, runId, Date.now()), { onChange }). It eases the
 * camera onto getPos() about once a second (linear, so a moving train glides), zooming in to `zoom` (14.5) first.
 * A user drag (pan) stops it, zoom and rotate gestures keep it (they zoom around the centre while following);
 * f.stop() / f.start() / f.toggle() for the button, f.destroy() when the train's sheet closes.
 * opts: { every (ms, 1000), zoom (14.5), start (true: start at once), reduceMotion () => bool,
 *         onChange (on, byUser) => void }. getPos() -> [lng, lat] | {lng, lat} | null (null: keep the camera).
 */
export function follow(map, getPos, opts = {}) {
  const every = opts.every ?? 1000, zoom = opts.zoom ?? 14.5;
  const reduced = () => (opts.reduceMotion ? opts.reduceMotion() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let on = false, timer = 0, first = true, gesture = 0, dead = false;
  const read = () => {
    let p = null;
    try { p = getPos(); } catch (e) { console.warn('[train-view] follow', e); }
    if (!p) return null;
    const ll = Array.isArray(p) ? [p[0], p[1]] : [p.lng, p.lat];
    return Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null;
  };
  const hidden = () => typeof document !== 'undefined' && document.hidden;
  function tick() {
    clearTimeout(timer); timer = 0;
    if (!on || dead) return;
    if (!hidden() && !gesture) {
      const p = read();
      if (p) {
        if (first) {
          first = false;
          map.easeTo({ center: p, zoom: Math.max(map.getZoom(), zoom), duration: reduced() ? 0 : 800, essential: true });
        } else map.easeTo({ center: p, duration: reduced() ? 0 : every, easing: (x) => x, essential: true });
      }
    }
    timer = setTimeout(tick, first ? 250 : every);
  }
  const around = (yes) => {
    try {
      if (yes) { map.scrollZoom?.enable?.({ around: 'center' }); map.touchZoomRotate?.enable?.({ around: 'center' }); }
      else { map.scrollZoom?.enable?.(); map.touchZoomRotate?.enable?.(); }
    } catch { /* an engine without these handlers: zoom stays as it was */ }
  };
  const onDrag = (e) => { if (on && e?.originalEvent) stop(true); };
  const onStart = (e) => { if (e?.originalEvent) gesture++; };
  // a user zoom / rotate ended: back onto the train at once (the zoom itself went round the centre)
  const onEnd = (e) => { if (!e?.originalEvent || !gesture) return; gesture--; if (on && !gesture) tick(); };
  const onMoveEnd = () => { if (gesture) { gesture = 0; if (on) tick(); } };   // never stuck "in a gesture"
  const onVis = () => { if (on && !hidden()) tick(); };
  map.on('dragstart', onDrag);
  map.on('moveend', onMoveEnd);
  for (const k of ['zoomstart', 'rotatestart', 'pitchstart']) map.on(k, onStart);
  for (const k of ['zoomend', 'rotateend', 'pitchend']) map.on(k, onEnd);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
  function start() {
    if (on || dead) return;
    on = true; first = true; gesture = 0; around(true);
    tick();
    opts.onChange?.(true, false);
  }
  function stop(byUser = false) {
    if (!on) return;
    on = false; clearTimeout(timer); timer = 0; around(false);
    opts.onChange?.(false, byUser);
  }
  const f = {
    get on() { return on; },
    start, stop,
    toggle() { if (on) stop(false); else start(); return on; },
    destroy() {
      stop(false); dead = true;
      map.off('dragstart', onDrag);
      map.off('moveend', onMoveEnd);
      for (const k of ['zoomstart', 'rotatestart', 'pitchstart']) map.off(k, onStart);
      for (const k of ['zoomend', 'rotateend', 'pitchend']) map.off(k, onEnd);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    },
  };
  if (opts.start !== false) start();
  return f;
}

// ------------------------------------------------------------------ styles (injected once; the kereta look, tv- names)
export const css = `
.tv-ring{--rc:#6B6B70;flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:#FFFFFF;color:#231F20;box-shadow:inset 0 0 0 5px var(--rc)}
.tv-ring b{display:block;font:800 16px/1 var(--font);letter-spacing:-0.02em}
.tv-ring[data-len="2"] b{font-size:14px;letter-spacing:-0.03em}
.tv-ring[data-len="3"] b{font-size:11px}
.tv-ring.nocode{background:var(--rc);box-shadow:inset 0 0 0 1px rgba(23,23,23,.08)}
.tv-ring.xl{width:44px;height:44px;box-shadow:inset 0 0 0 5.5px var(--rc)}
.tv-ring.xl b{font-size:17px}
.tv-ring.xl[data-len="2"] b{font-size:15px}
.tv-ring.sm{width:26px;height:26px;box-shadow:inset 0 0 0 3.2px var(--rc)}
.tv-ring.sm b{font-size:11.5px}
.tv-ring.sm[data-len="2"] b{font-size:9.5px}
.tv-ring.sm[data-len="3"] b{font-size:7px}
.tv-ring.xs{width:20px;height:20px;box-shadow:inset 0 0 0 2.6px var(--rc)}
.tv-ring.xs b{font-size:9px}
.tv-ring.xs[data-len="2"] b{font-size:7.5px}
.tv-ring.xs[data-len="3"] b{font-size:6px}
.tv-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.tv-meta .tk-type{height:28px;padding:0 11px;font-size:13px}
.tv-meta .tk-logo{margin-left:auto}
.tv-chip{display:inline-flex;align-items:center;height:28px;padding:0 2px;background:none;font:400 13px/1 var(--font);color:var(--text2);font-variant-numeric:tabular-nums;white-space:nowrap}
.tv-chip+.tv-chip::before{content:"·";margin-right:6px;color:var(--text3)}
.tv-type.on{background:var(--tc);color:#FFFFFF}
.tv-pill{display:flex;align-items:center;gap:9px;min-width:0;margin:0;padding:10px 12px;border-radius:14px;background:var(--panel);font:400 13px/17px var(--font);color:var(--text2)}
.tv-pill b{color:var(--text);font-weight:600}
.tv-pill i{flex:none;width:8px;height:8px;border-radius:50%;background:var(--text3,#6E6E73);box-shadow:0 0 0 3px rgba(23,23,23,.08)}
.tv-pill.live i{background:var(--income);box-shadow:0 0 0 3px var(--income-soft)}
.tv-stop .t.tv-exp{color:#B54708}
.tv-stop .t s{font:400 13px/16px var(--font);color:var(--text3);text-decoration-thickness:1px}
.tv-late{color:#B54708;font-weight:600}
.tv-stop.here-mark.live.ontime .n small{color:#157A39}
.tv-follow{width:100%;min-width:0;height:44px;font-size:15px}
.tv-thru{margin:0;font:600 13px/16px var(--font);letter-spacing:.064em;text-transform:uppercase;color:var(--text3)}
.tv-track{display:grid;grid-template-columns:minmax(0,1fr);min-width:0;border-radius:18px;background:var(--panel);padding:6px 0;--lc:#6B6B70}
.tv-stop{position:relative;display:flex;align-items:center;gap:8px;min-width:0;min-height:44px;padding:0 14px 0 48px;text-align:left;color:var(--text);width:100%;background:none}
.tv-stop::before{content:"";position:absolute;left:24px;top:0;bottom:0;width:4px;background:var(--lc)}
.tv-stop.past::before{background:#D3D3D8}
.tv-stop.first::before{top:50%}
.tv-stop.last::before{bottom:50%}
.tv-stop.first.last::before{display:none}
.tv-stop.xfer::before{background:linear-gradient(var(--lp) 0 50%,var(--lc) 50% 100%)}
.tv-stop.xfer.past::before{background:#D3D3D8}
.tv-stop > i{position:absolute;left:19px;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 3px var(--lc)}
.tv-stop.past > i{box-shadow:inset 0 0 0 3px #C9C9CE}
.tv-stop.xfer > i{width:16px;height:16px;margin-top:-8px;left:18px;box-shadow:inset 0 0 0 3px #171717}
.tv-stop.here > i{width:18px;height:18px;margin-top:-9px;left:17px;background:var(--lc);box-shadow:0 0 0 3px #fff,0 0 0 5px rgba(23,23,23,.14)}
.tv-stop .n{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px;font:500 15px/20px var(--font);white-space:nowrap;overflow:hidden}
.tv-stop .n .nm{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.tv-stop .n small{flex:none;max-width:100%;font:400 13px/16px var(--font);color:var(--text3);overflow:hidden;text-overflow:ellipsis}
.tv-stop.past .n{color:var(--text3)}
.tv-stop .t{flex:none;display:flex;align-items:baseline;gap:6px;font:600 15px/20px var(--font);font-variant-numeric:tabular-nums}
.tv-stop .t small{font:400 13px/16px var(--font);color:var(--text3)}
.tv-stop.past .t{color:var(--text3);font-weight:500}
.tv-stop.mine .n{font-weight:700}
.tv-stop .me{flex:none;align-self:center;font:600 11px/1 var(--font);color:var(--chart);background:var(--chart-soft);border-radius:999px;padding:4px 8px}
.tv-stop .cd{flex:none;font:600 15px/20px var(--font);color:var(--income);font-variant-numeric:tabular-nums}
.tv-code{flex:none;min-width:36px;height:20px;padding:0 5px;border-radius:999px;display:inline-grid;place-items:center;font:700 13px/1 var(--font);letter-spacing:-.01em;color:#231F20;background:#fff;box-shadow:inset 0 0 0 2px var(--rc);font-variant-numeric:tabular-nums}
.tv-stop.past .tv-code{color:var(--text3);box-shadow:inset 0 0 0 2px #D3D3D8}
.tv-stop.more{min-height:44px}
.tv-stop.more .n{display:block;white-space:normal;padding:6px 0;font:400 13px/18px var(--font);color:var(--text2)}
.tv-stop.more::before{background:repeating-linear-gradient(#D3D3D8 0 5px,transparent 5px 9px)}
.tv-show{flex:none;font:600 13px/18px var(--font);color:#5B52E0}
.tv-less{justify-self:start;min-height:44px;margin:2px 0 0 48px;font:600 13px/18px var(--font);color:var(--chart);background:none}
.tv-xrow{min-height:44px}
.tv-xrow .tv-ring{position:absolute;left:13px;top:50%;margin-top:-13px}
.tv-xrow .n{font:600 13px/17px var(--font);color:var(--text);display:grid;gap:0;white-space:normal;padding:4px 0}
.tv-xrow .n small{font-size:13px;color:var(--text2);margin:0}
.tv-xrow.past .n{color:var(--text3)}
.tv-stop.here-mark{min-height:46px}
.tv-stop.here-mark::before{background:linear-gradient(#D3D3D8 0 50%,var(--lc) 50% 100%)}
.tv-stop.here-mark .n{display:grid;gap:0;font:600 13px/17px var(--font)}
.tv-stop.here-mark .n small{margin:0;color:var(--text2);font-size:13px;white-space:normal}
.tv-train{position:absolute;left:16px;top:50%;width:20px;height:34px;margin-top:-17px;border-radius:7px 7px 5px 5px;background:var(--lc);box-shadow:0 0 0 3px #fff,0 4px 12px rgba(16,24,40,.22)}
.tv-train::before{content:"";position:absolute;left:3px;right:3px;top:4px;height:7px;border-radius:3px;background:rgba(20,20,24,.82)}
.tv-train::after{content:"";position:absolute;left:4px;right:4px;top:15px;bottom:5px;border-radius:2px;background:repeating-linear-gradient(rgba(255,255,255,.75) 0 3px,transparent 3px 6px)}
.tv-ends{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0}
.tv-next{display:flex;align-items:center;gap:10px;min-height:44px;padding:8px 14px 8px 10px;border-radius:14px;background:var(--panel);font:500 14px/18px var(--font);color:var(--text);text-align:left;width:100%}
.tv-next span{flex:1;min-width:0}
.tv-next .chev{width:16px;height:16px;color:var(--text3)}
.tv-links{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
.tv-links button{min-height:44px;padding:4px 14px 4px 9px;display:flex;align-items:center;gap:8px;border-radius:999px;background:var(--panel);font:500 13px/17px var(--font);color:var(--text)}
.tv-note{margin:0;font:400 13px/18px var(--font);color:var(--text3)}
.tv-stile{background:var(--elevated)}
.tv-stile .tv-sg{width:21px;height:21px;fill:none;stroke:var(--text);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-reduced-motion:no-preference){
  .tv-train{animation:tvNudge 2.4s ease-in-out infinite}
  @keyframes tvNudge{0%,100%{translate:0 -3px}50%{translate:0 3px}}
}
@media (hover:hover){.tv-next:hover,.tv-links button:hover{background:var(--elevated)}.tv-stop:hover .n{text-decoration:underline;text-decoration-color:var(--border)}}
`;
let cssDone = false;
/** Put the train / line view styles in the page once (no-op outside a browser). */
export function ensureCss(extra = '') {
  if (typeof document === 'undefined') return;
  if (!cssDone) {
    cssDone = true;
    const el = document.createElement('style');
    el.id = 'tv-css';
    el.textContent = css;
    document.head.append(el);
  }
  if (extra && !document.getElementById('tv-css-line')) {
    const el = document.createElement('style');
    el.id = 'tv-css-line';
    el.textContent = extra;
    document.head.append(el);
  }
}

export { DAY };
export { css as TV_CSS };   // tests read the rules
