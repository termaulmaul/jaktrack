// What the app's boards read from the timetable (the Tokyo remake of
// web/src/kereta/board.js). Pure functions over model.js's model (web/src/tokyo/model.js: createModel(net, runs) with the
// the data shapes (docs/ARCHITECTURE.md), the loaded service day's runs in model.runs): a station complex's departures per line and
// direction with through-running destinations and the last train, the rider's own station, a line's rhythm (trains
// running now, the gap between trains each way), the first and last train of the service day, and the trains running
// now per operator. Everything is worked out in the browser from the timetable: nothing here is a report from a train,
// and every screen built on it says "Scheduled".
//
// Time: `sec` / `time` = seconds since 00:00 WIB of the service day (after-midnight times are >= 86400); the service
// day turns over at 03:00 WIB. `ms` = epoch milliseconds; a departure's `at` = epoch ms.

import { DAY, TURN, clockText, departures, position, running, serviceTime } from './model.js';

export { DAY, TURN, serviceTime };

/** A service-day second as a WIB clock, rounded down to the minute: 86700 -> '00:05'. */
export const hhmm = clockText;
/** Whole minutes from ms until at, rounded down (a rider who reads 17:43 for a 17:43:30 departure is never late). */
export const minutesTo = (at, ms) => Math.floor((at - ms) / 60000);

// ------------------------------------------------------------------ names and lookups
const pick = (title, lang) => (title ? (lang === 'ja' ? title.ja || title.en : title.en || title.ja) || '' : '');
/** A station's name in lang ('ja' -> Japanese, anything else -> the English title; ID uses the English names). */
export const stationName = (m, s, lang = 'en') => pick(m.stations[s]?.name, lang);
export const lineName = (m, l, lang = 'en') => pick(m.lines[l]?.title, lang);
export const typeName = (m, y, lang = 'en') => pick(m.types[y]?.title, lang);
export const dirName = (m, d, lang = 'en') => pick(m.dirs[d]?.title, lang);
/** Operator of line l: {id, title {en, ja}} (from model.operators, else from the line id's prefix). */
export function operatorOf(m, l) {
  const line = m.lines[l];
  const op = line && m.operators ? m.operators[line.op] : null;
  if (op) return op;
  const id = String(line?.id || '').split('.')[0];
  return { id, title: { en: id, ja: id } };
}

/** Generic directions (no station in the name): their headers also say where the trains go. */
const GENERIC_DIR = new Set(['InnerLoop', 'OuterLoop', 'Inbound', 'Outbound', 'Eastbound', 'Westbound', 'Southbound', 'Northbound']);
export const isGenericDir = (m, d) => GENERIC_DIR.has(m.dirs[d]?.id);

const lineIdx = new WeakMap();
function lineIndexOf(m, id) {
  let map = lineIdx.get(m);
  if (!map) lineIdx.set(m, map = new Map(m.lines.map((l, i) => [l.id, i])));
  return map.get(id);
}
/** The run a `next` / `prev` entry names (id string or run index), when it is loaded. */
function runRef(m, ref) {
  if (typeof ref === 'number') return m.runs?.[ref] || null;
  return m.runById?.get(ref) || null;
}
/** The line of a run named by `next` / `prev`: the loaded run's line, else the id's 'Operator.Line' prefix (MT3D run
 * ids are 'Operator.Line.Number.Calendar'), so a through-run shows its line before that run's time bucket loads. */
function lineOfRef(m, ref) {
  const r = runRef(m, ref);
  if (r) return r.line;
  if (typeof ref !== 'string') return null;
  const [a, b] = ref.split('.');
  return lineIndexOf(m, `${a}.${b}`) ?? null;
}

/** Station indexes of the complex s belongs to (model.groups), s itself when it stands alone. */
export function complexOf(m, s) {
  const g = m.stations[s]?.group;
  const ids = g != null && g >= 0 && m.groups?.[g] ? m.groups[g] : [s];
  return ids.includes(s) ? ids : [s, ...ids];
}
/** The complex's name: its station names, each once ("Okachimachi / Ueno-hirokoji"). */
export function complexName(m, s, lang = 'en') {
  return [...new Set(complexOf(m, s).map((x) => stationName(m, x, lang)).filter(Boolean))].join(lang === 'ja' ? '・' : ' / ');
}
/** The lines that stop in the complex, in board order. */
export function complexLines(m, s) {
  return [...new Set(complexOf(m, s).map((x) => m.stations[x]?.line).filter((l) => l != null))].sort((a, b) => lineOrder(m, a) - lineOrder(m, b));
}

// Board order: JR first, then Tokyo Metro, Toei, the private railways; then the line's own order in the network.
const OP_RANK = { 'JR-East': 0, 'JR-Central': 1, TokyoMetro: 2, Toei: 3 };
export const opRank = (id) => OP_RANK[id] ?? 4;
export const lineOrder = (m, l) => opRank(operatorOf(m, l).id) * 100000 + l;
const dirOrder = (m, line, dir) => { const l = m.lines[line]; return l?.ascending === dir ? 0 : l?.descending === dir ? 1 : 2 + dir; };

// ------------------------------------------------------------------ a complex's departures over the service day
// Every departure of the loaded service day from the complex (model.js's departures() from 03:00), cached per model version:
// [{r, i (stop index), s (station), t (sec, TIMETABLE)}] sorted by time. Live delays are never cached (they change
// with every ODPT answer and do not bump model.version); delayOf adds them when a board is drawn.
const dayCache = new WeakMap();
function dayDeps(m, ids, clock) {
  let c = dayCache.get(m);
  if (!c || c.version !== m.version || c.date !== clock.date) dayCache.set(m, c = { version: m.version, date: clock.date, by: new Map() });
  const key = ids.join(',');
  if (c.by.has(key)) return c.by.get(key);
  const list = departures(m, ids, clock.start + TURN * 1000, Infinity)
    .map((e) => ({ r: e.run, i: e.stop, s: e.station, t: e.sched ?? e.time }))
    .sort((a, b) => a.t - b.t);
  c.by.set(key, list);
  return list;
}

// ------------------------------------------------------------------ live delays (LIVE: live.js keeps them in the model)
// model.delays = Map(run -> s): measured + estimated delays; model.measured = Set of the runs measured in the newest
// ODPT answer (the rest of the Map are live.js's estimates: "Estimated", never "live"). Same reading as model.js events().
const NO_DELAY = Object.freeze({ delay: 0, live: false, est: false });
/** {delay (s, 0 = none), live (measured by the operator), est (live.js's estimate)} for run r now. */
export function delayOf(m, r) {
  const dv = m.delays && m.delays.size ? m.delays.get(r) : undefined;
  if (dv === undefined || !Number.isFinite(dv)) return NO_DELAY;
  const live = !m.measured || m.measured.has(r);
  return { delay: dv, live, est: !live };
}
/** The biggest late and early delay in the model ([maxPos >= 0, minNeg <= 0]): how far a board looks back / ahead. */
function delaySpan(m) {
  let maxPos = 0, minNeg = 0;
  if (m.delays && m.delays.size) m.delays.forEach((d) => { if (d > maxPos) maxPos = d; if (d < minNeg) minNeg = d; });
  return [maxPos, minNeg];
}
/** First index in a sorted dep list with t >= sec. */
function from(deps, sec) {
  let lo = 0, hi = deps.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (deps[mid].t < sec) lo = mid + 1; else hi = mid; }
  return lo;
}

// ------------------------------------------------------------------ where a train goes
/**
 * Where run r goes from stop i, the way a departure board says it: {to [station] (MT3D's destination, which already is
 * where a through train ends up), via [line] (the lines it runs onto, in order), loop (true: a loop-line train that
 * carries on round the loop; `toward` then names the next big stations), toward [station], name (a named train)}.
 */
const destCache = new WeakMap();
export function whereTo(m, r, i = 0) {
  let c = destCache.get(r);
  if (!c || c.v !== m.version) destCache.set(r, c = { v: m.version, by: new Map() });
  if (!c.by.has(i)) c.by.set(i, whereTo1(m, r, i));
  return c.by.get(i);
}
function whereTo1(m, r, i) {
  const via = [];
  const line = m.lines[r.line];
  let cur = r, hops = 0, sameLine = false;
  while (cur && hops < 6) {
    const nxt = cur.next || [];
    if (!nxt.length) break;
    const l2 = lineOfRef(m, nxt[0]);
    if (l2 == null) break;
    if (l2 === r.line) sameLine = true;
    else if (!via.includes(l2)) via.push(l2);
    cur = runRef(m, nxt[0]);
    hops++;
  }
  const loop = !!line?.loop && sameLine && !via.length;
  const to = (r.to && r.to.length && r.to[0] >= 0 ? r.to : [r.stops[r.stops.length - 1].s]).slice();
  // the train's own name (MT3D run.names: [{ en, ja }], e.g. "Narita Express 18"; the train view reads the same)
  return { to, via, loop, toward: loop ? towardOnLoop(m, r, i) : [], name: r.names?.[0] || r.name || r.nm || null };
}

/** The next two big stations ahead on a loop (the way JR's Yamanote boards say "for Shibuya, Shinagawa"). */
function towardOnLoop(m, r, i) {
  const ahead = [];
  let cur = r, k = i + 1, hops = 0;
  const here = m.stations[r.stops[i]?.s]?.group;
  while (cur && ahead.length < 10 && hops < 3) {
    for (; k < cur.stops.length && ahead.length < 10; k++) {
      const s = cur.stops[k].s;
      if (!ahead.includes(s) && (here == null || here < 0 || m.stations[s]?.group !== here)) ahead.push(s);
    }
    cur = (cur.next || []).map((x) => runRef(m, x)).find((x) => x && x.line === r.line);
    k = 1; hops++;
  }
  const size = (s) => { const g = m.stations[s]?.group; return g != null && g >= 0 && m.groups?.[g] ? m.groups[g].length : 1; };
  return ahead.map((s, n) => ({ s, n, w: size(s) })).sort((a, b) => b.w - a.w || a.n - b.n).slice(0, 2).sort((a, b) => a.n - b.n).map((x) => x.s);
}

/** "Shibuya / Shinagawa": stations by name in lang. */
export const namesOf = (m, ids, lang = 'en', sep = ' / ') => [...new Set(ids.map((s) => stationName(m, s, lang)).filter(Boolean))].join(sep);

// ------------------------------------------------------------------ where a train is now (by its timetable)
/**
 * Where run r is at ms by its timetable: {state: 'before' | 'wait' | 'at' | 'between' | 'done', stop, from, to}.
 * 'before' = not on the line yet, 'wait' = standing at its first stop, 'at' = standing at stop `stop`, 'between' =
 * between stop-1 and stop, 'done' = arrived. Read from model.js's position(), the same place the map draws it.
 */
export function whereNow(m, r, ms = Date.now()) {
  const sec = serviceTime(ms).seconds;
  const p = position(r, sec);
  const last = r.stops.length - 1;
  if (!p) {
    const st = r.stops[0], t0 = st.d ?? st.a;
    return sec < t0 ? { state: 'before', stop: 0 } : { state: 'done', stop: last };
  }
  if (p.state === 2) return { state: 'wait', stop: 0 };
  if (p.state === 3) return { state: 'done', stop: last };
  if (p.state === 1) return { state: 'at', stop: p.stop };
  return { state: 'between', stop: p.stop, from: r.stops[p.stop - 1]?.s ?? null, to: r.stops[p.stop]?.s ?? null };
}

// ------------------------------------------------------------------ station board
/** How far ahead "where the train is now" is worked out on a board row (minutes). */
const WHERE_MIN = 45;
/** Departures after this service second may say "last for <destination>" (late evening). */
export const LATE = 20 * 3600;
/** "Last for X" is about where a train ends up, whatever the route; loop trains that carry on have no end. */
const destKey = (dest) => (dest.loop ? null : dest.to.join(','));

function depOut(m, d, clock, ms, groupLast, lastTo, day = 0) {
  // today's departures carry the run's live delay now (measured or estimated); tomorrow's are the timetable
  const x = day ? NO_DELAY : delayOf(m, d.r);
  const time = d.t + x.delay;
  const at = clock.start + (time + day * DAY) * 1000, min = minutesTo(at, ms);
  const dest = whereTo(m, d.r, d.i);
  const out = { run: d.r, id: d.r.id, i: d.i, s: d.s, time, sched: d.t, delay: x.delay, live: x.live, est: x.est, at, min, type: d.r.type, number: d.r.number || '', ...dest,
    last: d === groupLast, lastTo: d !== groupLast && destKey(dest) != null && lastTo.get(destKey(dest)) === d, where: null, from: null };
  if (!day && min >= 0 && min <= WHERE_MIN) out.where = whereNow(m, d.r, ms);
  // a train that starts here but comes through from another line ("through from the Tokyu Toyoko Line")
  if (d.i === 0 && d.r.prev?.length) { const pl = lineOfRef(m, d.r.prev[0]); if (pl != null && pl !== d.r.line) out.from = pl; }
  return out;
}

/**
 * Which part of the service day the model's runs cover. The page loads the timetable build's hourly buckets around now first and
 * the rest later, so the first and the last trains are only claimed when that end of the day is loaded:
 * {first: morning loaded (first trains are real), last: night loaded (last trains are real)}. model.window =
 * {from, to} (service seconds, set by the page) wins; else read from the runs (the day runs 04:18 .. 25:16).
 */
const covCache = new WeakMap();
export function coverage(m) {
  let c = covCache.get(m);
  if (c && c.version === m.version && c.w === m.window) return c;
  let minStart = Infinity, maxEnd = -Infinity;
  for (const r of m.runs || []) {
    const a = r.stops[0], z = r.stops[r.stops.length - 1];
    const t0 = a.d ?? a.a, t1 = z.a ?? z.d;
    if (t0 < minStart) minStart = t0;
    if (t1 > maxEnd) maxEnd = t1;
  }
  const w = m.window;
  c = { version: m.version, w, minStart, maxEnd,
    first: w ? w.from <= TURN + 60 : minStart <= 5.5 * 3600,
    last: w ? w.to >= DAY + TURN - 60 : maxEnd >= DAY };
  covCache.set(m, c);
  return c;
}

/** Will tomorrow's service day run the same calendar as the loaded runs (so their times hold tomorrow too)? */
export function tomorrowSame(m, clock) {
  if (!m.calendar) return false;
  return serviceTime(clock.start + (DAY + TURN) * 1000 + 60000).calendar === m.calendar;
}

/**
 * A station complex's board: one group per line and direction that leaves from it.
 * Returns {s, ids, lines, clock, groups: [{key, line, dir, station, split (the line has two stations in the complex:
 * one group per station), generic, toward [station], loop (most of its trains
 * carry on round a loop line), mixed (more than one train type that way today), next (station of the
 * next stop), deps [dep], first dep, last dep (of the service day; null while that end of the day is not loaded, see
 * coverage()), gone (the last has left), firstNext (the
 * first train of the next service day when its calendar is the loaded one, else null), count}]}; groups in board order
 * (JR, Tokyo Metro, Toei, private; then line; then direction).
 * dep = {run, id, i, s, time (expected: timetable + live delay), sched (timetable), delay (s), live (measured by the
 * operator), est (live.js's estimate), at, min, type, number, to, via, loop, toward, name, last, lastTo, where, from}.
 * opts: per (departures per group, default 3), line (only this line index).
 */
export function stationBoard(m, s, ms = Date.now(), opts = {}) {
  const per = opts.per ?? 3;
  const clock = serviceTime(ms);
  const ids = complexOf(m, s);
  const cov = coverage(m);
  const same = cov.first && tomorrowSame(m, clock);
  const groups = new Map();
  // a line with two stations in the complex (Oedo: Shinjuku and Shinjuku-nishiguchi) gets a group per station: the
  // same direction leaves them towards different next stops
  const perLine = new Map();
  for (const x of ids) { const l = m.stations[x]?.line; perLine.set(l, (perLine.get(l) || 0) + 1); }
  const [maxPos, minNeg] = delaySpan(m);
  for (const d of dayDeps(m, ids, clock)) {
    if (opts.line != null && d.r.line !== opts.line) continue;
    const split = perLine.get(d.r.line) > 1;
    const key = split ? `${d.r.line}|${d.r.dir}|${d.s}` : `${d.r.line}|${d.r.dir}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, line: d.r.line, dir: d.r.dir, station: d.s, split, all: [] });
    g.all.push(d);
  }
  const out = [];
  for (const g of groups.values()) {
    const all = g.all, last = all[all.length - 1], first = all[0];
    const lastTo = new Map();
    const freq = new Map();
    const types = new Set();
    let loopVotes = 0;
    for (const d of all) {
      const dest = whereTo(m, d.r, d.i);
      types.add(d.r.type);
      if (d.t >= LATE && !dest.loop) lastTo.set(destKey(dest), d);
      if (dest.loop) loopVotes++;
      else for (const t of dest.to) freq.set(t, (freq.get(t) || 0) + 1);
    }
    const loop = loopVotes > all.length / 2;
    if (!cov.last) lastTo.clear();
    // the next trains by their expected time (timetable + live delay): a late one is still to come, an early one may
    // pass one ahead of it (looks back by the biggest delay, stops once nothing later can come sooner)
    const up = [];
    let worst = -Infinity;
    for (let k = from(all, clock.seconds - maxPos); k < all.length; k++) {
      const d = all[k];
      if (up.length >= Math.max(1, per) && d.t + minNeg > worst) break;
      const exp = d.t + delayOf(m, d.r).delay;
      if (exp < clock.seconds) continue;
      up.push({ d, exp });
      if (exp > worst) worst = exp;
    }
    up.sort((a, b) => a.exp - b.exp || a.d.t - b.d.t);
    const deps = up.slice(0, per).map(({ d }) => depOut(m, d, clock, ms, cov.last ? last : null, lastTo));
    // the board's own words for this way: the big stations ahead on a loop, else the most frequent destinations
    const lead = up[0]?.d || first;
    const toward = loop ? towardOnLoop(m, lead.r, lead.i)
      : [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).map(([t]) => t);
    const gone = !up.length && cov.last;
    out.push({ key: g.key, line: g.line, dir: g.dir, station: g.station, split: g.split, generic: isGenericDir(m, g.dir), toward, loop, mixed: types.size > 1,
      next: lead.r.stops[lead.i + 1]?.s ?? null, deps, count: all.length,
      first: cov.first ? depOut(m, first, clock, ms, last, lastTo) : null, last: cov.last ? depOut(m, last, clock, ms, last, lastTo) : null, gone,
      firstNext: gone && same ? depOut(m, first, clock, ms, last, lastTo, 1) : null });
  }
  const own = m.stations[s]?.name?.en;
  const stOrder = (g) => (!g.split ? 0 : g.station === s || m.stations[g.station]?.name?.en === own ? -1 : g.station);   // the tapped name first
  out.sort((a, b) => lineOrder(m, a.line) - lineOrder(m, b.line) || stOrder(a) - stOrder(b) || dirOrder(m, a.line, a.dir) - dirOrder(m, b.line, b.dir));
  return { s, ids, lines: complexLines(m, s), clock, groups: out, allGone: out.length > 0 && out.every((g) => g.gone), known: { first: cov.first, last: cov.last } };
}

/**
 * The rider's own station, compact: {…stationBoard, lines: [{line, groups}] (per line its directions with the next n
 * trains), soonest: the next departure of each direction, soonest first (the home card's rows)}.
 */
export function myStation(m, s, ms = Date.now(), n = 2) {
  const b = stationBoard(m, s, ms, { per: n });
  const byLine = new Map();
  for (const g of b.groups) { if (!byLine.has(g.line)) byLine.set(g.line, []); byLine.get(g.line).push(g); }
  const soonest = b.groups.filter((g) => g.deps.length).map((g) => ({ ...g.deps[0], group: g })).sort((x, y) => x.at - y.at);
  return { ...b, byLine: [...byLine.entries()].map(([line, groups]) => ({ line, groups })), soonest };
}

/**
 * First and last train of the service day from a station complex, per line and direction: [{key, line, dir, generic,
 * toward, first, last, count, gone, lastFor}] in board order. lastFor = the last train after 20:00 to each of the way's
 * main destinations other than the very last train's (up to 4, by time): "last for Osaki 00:13".
 */
export function firstLast(m, s, ms = Date.now()) {
  const b = stationBoard(m, s, ms, { per: 0 });
  const day = dayDeps(m, b.ids, b.clock);
  return b.groups.map((g) => {
    const all = day.filter((d) => d.r.line === g.line && d.r.dir === g.dir && (!g.split || d.s === g.station));
    const final = all[all.length - 1];
    const finalKey = final ? destKey(whereTo(m, final.r, final.i)) : null;
    // the main destinations of this way (at least 6 trains and 5% of them today), each with its last train after 20:00
    const by = new Map();
    for (const d of all) {
      const k = destKey(whereTo(m, d.r, d.i));
      if (k == null) continue;
      const e = by.get(k) || { n: 0, d: null };
      e.n++;
      if (d.t >= LATE) e.d = d;
      by.set(k, e);
    }
    const lastFor = !b.known.last ? [] : [...by.entries()]
      .filter(([k, e]) => e.d && e.d !== final && k !== finalKey && e.n >= Math.max(6, all.length * 0.05))
      .sort((a, c) => c[1].n - a[1].n).slice(0, 4).map(([, e]) => e.d).sort((a, c) => a.t - c.t)
      .map((d) => ({ ...whereTo(m, d.r, d.i), time: d.t, at: b.clock.start + d.t * 1000, type: d.r.type, run: d.r, id: d.r.id }));
    return { key: g.key, line: g.line, dir: g.dir, station: g.station, split: g.split, generic: g.generic, loop: g.loop, toward: g.toward, first: g.first, last: g.last, count: g.count, gone: g.gone, lastFor };
  });
}

// ------------------------------------------------------------------ trains running now
// model.js's running() (what the map draws), memoised for the second: the home, lines list and rhythm all read it.
let runMemo = { m: null, version: -1, sec: -1, list: [] };
function runningNow(m, ms) {
  const sec = Math.floor(ms / 1000);
  if (runMemo.m !== m || runMemo.version !== m.version || runMemo.sec !== sec) runMemo = { m, version: m.version, sec, list: running(m, ms) };
  return runMemo.list;
}

/** Runs on the line now (as drawn on the map): [{run, ...position}]. */
export const runningOn = (m, line, ms = Date.now()) => runningNow(m, ms).filter((p) => p.line === line);

// The station each line and direction is busiest at over the loaded day: where the gap between trains is read.
const refCache = new WeakMap();
function refStation(m, line, dir) {
  let c = refCache.get(m);
  if (!c || c.version !== m.version) refCache.set(m, c = { version: m.version, by: new Map(), dirs: new Map() });
  const key = `${line}|${dir}`;
  if (c.by.has(key)) return c.by.get(key);
  const counts = new Map();
  for (const r of m.runs) {
    if (r.line !== line || r.dir !== dir) continue;
    for (let i = 0; i < r.stops.length - 1; i++) counts.set(r.stops[i].s, (counts.get(r.stops[i].s) || 0) + 1);
  }
  let best = null, n = -1;
  for (const [s, k] of counts) if (k > n || (k === n && s < best)) { best = s; n = k; }
  c.by.set(key, best);
  return best;
}
/** The directions a line's loaded runs travel in, in line order. */
function lineDirs(m, line) {
  let c = refCache.get(m);
  if (!c || c.version !== m.version) refCache.set(m, c = { version: m.version, by: new Map(), dirs: new Map() });
  if (!c.dirs.size) {
    const by = new Map();
    for (const r of m.runs) { if (!by.has(r.line)) by.set(r.line, new Set()); by.get(r.line).add(r.dir); }
    for (const [l, set] of by) c.dirs.set(l, [...set].sort((a, b) => dirOrder(m, l, a) - dirOrder(m, l, b)));
  }
  return c.dirs.get(line) || [];
}

/**
 * A line's rhythm now: {line, total (trains running now), dirs: [{dir, running, gap (minutes between trains, rounded;
 * null when fewer than three departures in the window), perHour (departures in the next hour at ref), ref (station the
 * gap is read at: the line's busiest that way), next {time, at, run} (the next departure at ref)}]}. gap = the median
 * gap between departures at ref from 30 minutes ago to an hour ahead.
 */
export function lineRhythm(m, line, ms = Date.now()) {
  const clock = serviceTime(ms), sec = clock.seconds;
  const run = runningOn(m, line, ms);
  return {
    line, total: run.length,
    dirs: lineDirs(m, line).map((dir) => {
      const ref = refStation(m, line, dir);
      const deps = ref == null ? [] : dayDeps(m, [ref], clock).filter((d) => d.r.line === line && d.r.dir === dir);
      const win = deps.filter((d) => d.t >= sec - 1800 && d.t <= sec + 3600).map((d) => d.t);
      const gaps = [];
      for (let i = 1; i < win.length; i++) if (win[i] > win[i - 1]) gaps.push(win[i] - win[i - 1]);
      gaps.sort((a, b) => a - b);
      const med = gaps.length ? gaps[gaps.length >> 1] : null;
      const nx = deps[from(deps, sec)] || null;
      return { dir, running: run.filter((p) => p.run.dir === dir).length, gap: med && win.length >= 3 ? Math.max(1, Math.round(med / 60)) : null,
        perHour: deps.filter((d) => d.t >= sec && d.t < sec + 3600).length, ref,
        next: nx ? { time: nx.t, at: clock.start + nx.t * 1000, run: nx.r } : null };
    }),
  };
}

/** The home chips: JR, Tokyo Metro, Toei, the private railways. */
// Kelompok saringan = operator di data Jakarta (id operator dari data-build/jakarta.mjs). Operator yang tidak dikenal masuk 'other'.
const CHIP_BY_OP = { 'KAI-Commuter': 'krl', KAI: 'kai', 'MRT-Jakarta': 'mrt', 'LRT-Jabodebek': 'jbdb', 'LRT-Jakarta': 'lrtj' };
export const CHIPS = ['krl', 'kai', 'mrt', 'jbdb', 'lrtj', 'other'];
export const chipOf = (opId) => CHIP_BY_OP[opId] || 'other';

/**
 * Trains running now (as drawn on the map) per operator: {total, ops: [{op (operator id), title, n, lines: [{line,
 * n}]}], by: {jr, metro, toei, private}, byLine: Map(line -> n)}; operators in board order (JR East, Tokyo Metro, Toei,
 * then the private railways by count).
 */
export function runningByOperator(m, ms = Date.now()) {
  const byLine = new Map();
  for (const p of runningNow(m, ms)) byLine.set(p.line, (byLine.get(p.line) || 0) + 1);
  const ops = new Map();
  for (const [line, n] of byLine) {
    const op = operatorOf(m, line);
    if (!ops.has(op.id)) ops.set(op.id, { op: op.id, title: op.title, n: 0, lines: [] });
    const o = ops.get(op.id);
    o.n += n; o.lines.push({ line, n });
  }
  const list = [...ops.values()];
  for (const o of list) o.lines.sort((a, b) => b.n - a.n || a.line - b.line);
  list.sort((a, b) => opRank(a.op) - opRank(b.op) || b.n - a.n || a.op.localeCompare(b.op));
  const by = Object.fromEntries(CHIPS.map((k) => [k, 0]));
  for (const o of list) by[chipOf(o.op)] += o.n;
  return { total: list.reduce((n, o) => n + o.n, 0), ops: list, by, byLine };
}

/** The next first departure of any run after ms ({time, at, run, tomorrow}) or null: "first train 04:30 from …".
 * Looks at the rest of the loaded day, then the next service day when it runs the same calendar. */
export function nextFirst(m, ms = Date.now()) {
  const clock = serviceTime(ms);
  let best = null, min = Infinity;
  for (const r of m.runs || []) { const st = r.stops[0], t = st.d ?? st.a; if (t < min) min = t; if (t >= clock.seconds && (!best || t < best.time)) best = { time: t, at: clock.start + t * 1000, run: r, tomorrow: false }; }
  if (best || !coverage(m).first || !tomorrowSame(m, clock)) return best;
  for (const r of m.runs || []) { const st = r.stops[0], t = st.d ?? st.a; if (t === min) return { time: t, at: clock.start + (t + DAY) * 1000, run: r, tomorrow: true }; }
  return null;
}
