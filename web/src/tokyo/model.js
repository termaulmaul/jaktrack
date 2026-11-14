/*! Portions from Mini Tokyo 3D, (c) 2019-2026 Akihiko Kusanagi, MIT License: see /LICENSES.txt */
// the timetable model. Where every train is by its timetable, a station's departures and
// arrivals, through-running chains. trafik.live's train model API on the data shapes of docs/ARCHITECTURE.md (MT3D data, WIB).
// Positions are TIMETABLE positions ("Scheduled" / 時刻表どおり / Menurut jadwal), computed afresh from the clock each
// frame, never accumulated. Trains are placed by station chainage on line.path, so loops and both directions work.
// Some logic follows Mini Tokyo 3D (MIT, (c) Akihiko Kusanagi): standing at the terminal until the through-run leaves.

import { calendarFor, dayKind } from './calendar.js';

export const DAY = 86400;
export const TURN = 3 * 3600;          // the service day turns over at 03:00 WIB
export const WIB = 7 * 3600 * 1000;    // ms east of UTC
export const PRE = 60;                  // s standing at the first stop before departing (MT3D: standingDuration 60 s)
export const POST = 45;                 // s standing at the last stop after arriving (no through-run)
export const DWELL = 30;                // s standing before an intermediate departure when the timetable has no arrival
export const RAMP = 22;                 // s to reach line speed after a stop and to brake before the next one
export const FADE = 8;                  // s fade in / out at the very start / end of a train's day
const LONG_WAIT = 20 * 60;              // never stand longer than this at a through-run handover

/** Great-circle distance in metres between [lng, lat] points. */
export const distance = (a, b) => {
  const r = Math.PI / 180, p = a[1] * r, q = b[1] * r;
  return 12742000 * Math.asin(Math.sqrt(Math.sin((q - p) / 2) ** 2 + Math.cos(p) * Math.cos(q) * Math.sin((b[0] - a[0]) * r / 2) ** 2));
};
// Metres between path points: the network build's segLen() (net.js, equirectangular at the mean latitude, R 6371008.8 m), the
// metric its `chain` and `length` are built with, so trains stop exactly where the pack puts the stations.
const segLen = (a, b) => {
  const k = Math.cos((a[1] + b[1]) * Math.PI / 360), dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy) * Math.PI / 180 * 6371008.8;
};
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------------------------------------------------------------------------------------------------------------
// Calendar + service clock
// ---------------------------------------------------------------------------------------------------------------

// Which timetable runs on a date: the timetable build's calendar.js (MT3D's rule + Cabinet Office holidays 2026-2027).
// setCalendar(fn(dateISO, weekday) -> 'weekday' | 'holiday' ...) overrides the main calendar name (tests, previews).
let calendarFn = null;
export function setCalendar(fn) { calendarFn = typeof fn === 'function' ? fn : null; }

/**
 * The service clock at ms: { seconds since 00:00 WIB of the service day (>= 86400 after midnight), weekday (0 Sun),
 * date 'YYYY-MM-DD' of the service day, start = ms of 00:00 WIB of that day, kind ('Weekday' | 'Saturday' |
 * 'Holiday', MT3D's day kind), cals (calendar names in preference order for tt.js loadRuns({ cal })), calendar (the
 * shared set most lines use: 'weekday' or 'holiday') }. Between 00:00 and 03:00 WIB it is still the previous day.
 */
export function serviceTime(ms = Date.now()) {
  const local = new Date(ms + WIB);
  let seconds = local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds() + local.getUTCMilliseconds() / 1000;
  if (seconds < TURN) { seconds += DAY; local.setUTCDate(local.getUTCDate() - 1); }
  const date = local.toISOString().slice(0, 10), weekday = local.getUTCDay(), cals = calendarFor(date);
  return { seconds, weekday, date, start: Date.parse(date + 'T00:00:00+07:00'), kind: dayKind(date), cals,
    calendar: calendarFn ? calendarFn(date, weekday) : cals[cals.length - 1] };
}

/** Seconds of the service day at ms (as serviceTime(ms).seconds, without allocating: for frames). */
export function serviceSeconds(ms = Date.now()) {
  let s = ((ms + WIB) / 1000) % DAY;
  if (s < 0) s += DAY;
  return s < TURN ? s + DAY : s;
}

/** Seconds on a model's clock at ms: its pinned service day (createModel opts.date), else the current one. */
export const secOf = (model, ms = Date.now()) => (model.start != null ? (ms - model.start) / 1000 : serviceSeconds(ms));

/** 'HH:MM' (WIB, hours past midnight wrap: 86400 + 900 -> '00:15'). */
export const clockText = (s) => {
  const t = Math.floor(s / 60);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/** Fraction of a run done after t of T seconds: speeding up for RAMP s, line speed, braking for RAMP s (krl/trains.js). */
export function eased(t, T) {
  if (t <= 0) return 0;
  if (t >= T) return 1;
  const r = Math.min(RAMP, T * 0.35), v = 1 / (T - r);
  if (t < r) return v * t * t / (2 * r);
  if (t > T - r) { const u = T - t; return 1 - v * u * u / (2 * r); }
  return v * (t - r / 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Line geometry
// ---------------------------------------------------------------------------------------------------------------

// Per line: path as typed arrays, metres along it (scaled to line.length so the network build's chain values land on the
// stations), segment bearings, and where each station sits on the chain.
function lineGeo(line) {
  const p = line.path || [];
  let pts = p;
  if (line.loop && p.length > 2 && distance(p[0], p[p.length - 1]) > 1) pts = p.concat([p[0]]);
  const n = pts.length, lng = new Float64Array(n), lat = new Float64Array(n), cum = new Float64Array(n), brg = new Float32Array(Math.max(1, n - 1));
  for (let i = 0; i < n; i++) { lng[i] = pts[i][0]; lat[i] = pts[i][1]; }
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + segLen(pts[i - 1], pts[i]);
  const raw = n ? cum[n - 1] : 0;
  let length = raw;
  if (line.length > 0 && raw > 0 && Math.abs(line.length / raw - 1) < 0.05) {
    const k = line.length / raw; length = line.length;
    for (let i = 1; i < n; i++) cum[i] *= k;
  }
  for (let i = 0; i < n - 1; i++) {
    brg[i] = (Math.atan2((lng[i + 1] - lng[i]) * Math.cos(lat[i] * Math.PI / 180), lat[i + 1] - lat[i]) * 180 / Math.PI + 360) % 360;
  }
  const at = new Map(); // station index -> [chain...]
  (line.stations || []).forEach((s, k) => {
    const c = line.chain?.[k];
    if (c == null) return;
    if (!at.has(s)) at.set(s, []);
    const list = at.get(s), v = line.loop && length ? ((c % length) + length) % length : c;
    if (!list.some((x) => Math.abs(x - v) < 1)) list.push(v);
  });
  return { n, lng, lat, cum, brg, length, loop: !!line.loop, at, proj: new Map() };
}

// Metres along the line nearest to [lng, lat] (for stops not listed on the run's own line).
function projectOnto(g, lng, lat) {
  const kx = Math.cos(lat * Math.PI / 180);
  let best = Infinity, out = 0;
  for (let i = 0; i < g.n - 1; i++) {
    const ax = (g.lng[i] - lng) * kx, ay = g.lat[i] - lat, bx = (g.lng[i + 1] - lng) * kx, by = g.lat[i + 1] - lat;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? clamp(-(ax * dx + ay * dy) / L2, 0, 1) : 0;
    const d = (ax + dx * t) ** 2 + (ay + dy * t) ** 2;
    if (d < best) { best = d; out = g.cum[i] + (g.cum[i + 1] - g.cum[i]) * t; }
  }
  return out;
}

/**
 * The point `along` metres on line `li` into out[o] = lng, out[o+1] = lat, out[o+2] = bearing of the line there
 * (direction of increasing chain). Loops wrap; past either end of an open line it carries on straight along the end
 * segment (a train standing at a terminus stays centred on the station). No allocation.
 */
export function pointAt(model, li, along, out, o = 0) {
  SC[1] = along; HINT[0] = 0;
  return pointOn(model._geo[li], out, o);
}
// SC = scratch for doubles handed between hot functions (a double passed as an argument or returned is boxed on the
// heap; a typed array slot is not): SC[0] = the clock second for place(), SC[1] = metres along for pointOn().
const SC = new Float64Array(2), HINT = new Int32Array(1); // HINT[0]: path segment to try first (pointOn writes back)
function pointOn(g, out, o) {
  const n = g.n;
  if (n < 2) { out[o] = n ? g.lng[0] : 0; out[o + 1] = n ? g.lat[0] : 0; out[o + 2] = 0; return out; }
  let s = SC[1];
  if (g.loop && g.length > 0) s = ((s % g.length) + g.length) % g.length;
  const cum = g.cum;
  if (s <= 0 || s >= g.length) {
    const end = s >= g.length, i = end ? n - 1 : 0, j = end ? n - 2 : 1, seg = end ? n - 2 : 0;
    const len = cum[i] - cum[j] || 1, k = (end ? s - g.length : -s) / Math.abs(len);
    out[o] = g.lng[i] + (g.lng[i] - g.lng[j]) * k; out[o + 1] = g.lat[i] + (g.lat[i] - g.lat[j]) * k; out[o + 2] = g.brg[seg];
    return out;
  }
  let lo = HINT[0];
  if (!(lo >= 1 && lo < n && cum[lo - 1] < s && cum[lo] >= s)) {
    lo = 1; let hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < s) lo = mid + 1; else hi = mid; }
    HINT[0] = lo;
  }
  const len = cum[lo] - cum[lo - 1], f = len > 0 ? (s - cum[lo - 1]) / len : 0;
  out[o] = g.lng[lo - 1] + (g.lng[lo] - g.lng[lo - 1]) * f;
  out[o + 1] = g.lat[lo - 1] + (g.lat[lo] - g.lat[lo - 1]) * f;
  out[o + 2] = g.brg[lo - 1];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------------------------

const MODEL = new WeakMap(); // run -> model

// Suspended lines: lines out of service although MT3D's timetable still runs
// them. A suspended line draws NO trains, has no departures and counts no running train; its line and station screens
// say so (views read suspendedOf()). Entry: lines = MT3D railway ids; checked = the day (WIB) we last read the
// operator's own announcement (read by hand); since / until = first / last service day out when announced (null =
// unknown / until further notice); bus = replacement buses run; note = why. Lift a suspension by deleting its entry.
export const SUSPENDED = [
  { lines: ['Isumi.Isumi'], checked: '2026-11-03', since: null, until: null, bus: true,
    note: 'Isumi Line: trains suspended, replacement buses run' },
];
/** table -> Map(line index -> entry) for net, on service day `day` ('YYYY-MM-DD'; entries outside since..until skip). */
function suspendedLines(net, table, day) {
  const out = new Map();
  for (const e of table || []) {
    if (day && ((e.since && day < e.since) || (e.until && day > e.until))) continue;
    for (const id of e.lines || []) {
      const li = net.lines.findIndex((l) => l.id === id);
      if (li >= 0) out.set(li, e);
    }
  }
  return out;
}
/** The suspension entry of a line (index, id or line object), else null. Views: one calm line instead of a board. */
export function suspendedOf(model, line) {
  const m = model?.suspended;
  if (!m || !m.size || line == null) return null;
  const li = typeof line === 'number' ? line : typeof line === 'string' ? model.lines.findIndex((l) => l.id === line) : model.lines.indexOf(line);
  return m.get(li) || null;
}

/**
 * createModel(net, runs, opts): net = the network build's unpackNet() result (or the fixture's model): { lines, stations, groups,
 * types, dirs, operators }; runs = the timetable build's loadRuns() result for the service day's calendar. opts: { calendar,
 * late } where late = runs of the PREVIOUS service day still running after 03:00 (they are put on today's clock).
 * model.add(runs, { late }) adds more (time buckets as they load); duplicates by id are ignored.
 * await model.addAsync(runs, { late, slice = 1500, pause, budget }) = the same in slices that let the page draw
 * (without a `pause` of its own it pauses once per `budget` = 40 ms of work, not after every slice): the
 * new visibility windows and departure index are built off to the side, then swapped in at once.
 * tt.js shares run objects between loads: position(run) / trainClock(run) use the model that registered the run last.
 * A side model that must not take the runs over (tomorrow's, a preview) passes opts.register = false.
 */
export function createModel(net, runs = [], opts = {}) {
  const model = {
    _register: opts.register !== false,
    ...net,
    operators: net.operators ?? net.ops ?? [], // fixture: operators; DATA-NET's unpackNet: ops (both kept)
    calendar: opts.calendar ?? net.calendar ?? null,
    // opts.date 'YYYY-MM-DD' pins the model to that service day: its runs are placed on that day's clock at any ms
    // (after 03:00 the next day they are simply gone; a model for tomorrow gives tomorrow's first departures).
    date: opts.date ?? null,
    start: opts.date ? Date.parse(opts.date + 'T00:00:00+07:00') : null,
    runs: [], runById: new Map(),
    // lines out of service (SUSPENDED, or opts.suspended): their runs are never added
    suspended: suspendedLines(net, opts.suspended ?? SUSPENDED, opts.date ?? new Date(Date.now() + (9 - 3) * 3600e3).toISOString().slice(0, 10)),
    lineById: new Map(net.lines.map((l) => [l.id, l])),
    stationById: new Map(net.stations.map((s) => [s.id, s])),
    version: 0,
    _geo: net.lines.map(lineGeo),
    _off: new Map(),   // run -> clock offset (0, or -DAY for a late run of the previous service day)
    _win: null,        // visibility windows + time buckets (rebuilt lazily after add)
    _comp: new Map(),  // run -> compiled arrays (only active / recently asked runs are kept)
    _act: { key: -1, list: [], comp: [] },
    _dep: null,        // departure / arrival index (lazy)
    add(more, o = {}) { return addRuns(model, more, o); },
    addAsync(more, o = {}) { return addRunsAsync(model, more, o); },
  };
  model.trains = model.runs; // krl/kereta naming, for ported views
  addRuns(model, runs, {});
  if (opts.late?.length) addRuns(model, opts.late, { late: true });
  return model;
}

function addRuns(model, list, { late = false } = {}) {
  let added = 0;
  for (const r of list || []) {
    if (!r || model.runById.has(r.id)) continue;
    if (model.suspended.has(r.line)) continue;               // a suspended line draws no trains
    if (late && !(lastTime(r) >= DAY + TURN - PRE)) continue; // a late run must still be out after 03:00
    model.runById.set(r.id, r);
    model.runs.push(r);
    if (model._register) MODEL.set(r, model);
    if (late) model._off.set(r, -DAY);
    added++;
  }
  if (added) { model.version++; model._win = null; model._comp.clear(); model._act.key = -1; model._dep = null; }
  return added;
}

// Generators run to the end at once (sync callers) or a slice at a time with a pause between (addAsync).
function drain(g) { let x = g.next(); while (!x.done) x = g.next(); return x.value; }
async function drainAsync(g, pause, budget = 0) {
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let t = clock(), x = g.next();
  while (!x.done) {
    // budget > 0: slices run on until `budget` ms have gone, then one pause. A pause after every slice
    // waited for a map frame each time: ~140 pauses for the rest of the day, ~40 s in the lab while the map flew
    if (!budget || clock() - t >= budget) { await pause(); t = clock(); }
    x = g.next();
  }
  return x.value;
}
const PAUSE = () => new Promise((r) => setTimeout(r, 0));
const BUDGET = 40;   // ms of work between two pauses (a task stays well under 200 ms at 4x CPU)

/** add in slices (a 25k-run add plus the first frame and board after it was one 500-600 ms task at 4x
 * CPU). The new runs' visibility windows and the departure index are prepared off to the side, `slice` runs at a time
 * with `pause()` between slices; then everything is swapped in at once, so frames draw the old set until then. Same
 * result as add(). If the model changes meanwhile (a plain add()), it falls back to add(). -> number of runs added. */
async function addRunsAsync(model, list, { late = false, slice = 1500, pause = null, budget = pause ? 0 : BUDGET } = {}) {
  if (!pause) pause = PAUSE;
  const v0 = model.version, fresh = [], byId = new Map();
  for (const r of list || []) {
    if (!r || model.runById.has(r.id) || byId.has(r.id) || model.suspended.has(r.line)) continue;
    if (late && !(lastTime(r) >= DAY + TURN - PRE)) continue;
    byId.set(r.id, r); fresh.push(r);
  }
  if (!fresh.length) return 0;
  if (late) for (const r of fresh) model._off.set(r, -DAY); // timesOf needs it; harmless for a run that is not added
  const all = model.runs.concat(fresh), get = { get: (id) => model.runById.get(id) || byId.get(id) };
  const n = Math.max(1, slice | 0);
  const win = await drainAsync(windowsGen(model, all, get, n), pause, budget);
  const dep = model.version === v0 ? await drainAsync(stopIndexGen(model, all, 'D', n), pause, budget) : null;
  if (model.version !== v0) return addRuns(model, fresh, { late }); // changed under us: the plain way (correct, one task)
  for (const r of fresh) {
    model.runById.set(r.id, r);
    model.runs.push(r);
    if (model._register) MODEL.set(r, model);
  }
  model.version++; model._win = win; model._comp.clear(); model._act.key = -1;
  model._dep = { version: model.version, D: dep };
  return fresh.length;
}

// Latest time of a run.
function lastTime(r) {
  let prev = -Infinity;
  for (const st of r.stops) for (const t of [st.a, st.d]) if (t != null && t > prev) prev = t;
  return prev;
}

/** The model a run belongs to (createModel registers every run). */
export const modelOf = (run) => MODEL.get(run) || null;

// Times of a run on the model's clock (late runs: - DAY), monotonic: a time that goes backwards inside a run is an MT3D
// typo (Toei.Arakawa.ODPT3691.Holiday: d 20:42 then a 20:41) and is clamped to the time before it. After-midnight
// times are already >= 86400 (tt.js), so nothing is ever pushed a day on. Returns [A0, D0, A1, D1, ...] with nulls
// filled: A = D - dwell, D = A at the last stop.
function timesOf(model, run, out) {
  const st = run.stops, n = st.length, off = model._off.get(run) || 0;
  let prev = -Infinity, prevD = null;
  for (let i = 0; i < n; i++) {
    let a = st[i].a, d = st[i].d;
    if (a != null) { a += off; if (a < prev) a = prev; prev = a; }
    if (d != null) { d += off; if (d < prev) d = prev; prev = d; }
    if (d == null) d = a;
    if (a == null) a = i === 0 || prevD == null ? d : Math.max(prevD, d - Math.min(DWELL, Math.max(0, (d - prevD) * 0.3)));
    if (a == null) a = d = prevD ?? 0; // no time at all (never seen in MT3D): stand where the last stop left it
    out[2 * i] = a; out[2 * i + 1] = d;
    prevD = d;
  }
  return out;
}

// Visibility windows: [start, end) on today's service clock for every run, and 10-minute buckets of run indexes.
const BUCKET = 600;
function windows(model) {
  if (model._win) return model._win;
  return (model._win = drain(windowsGen(model, model.runs, model.runById, Infinity)));
}
// runs = the model's runs (or, for addAsync, the list it will have); byId = id -> run over that list
function* windowsGen(model, runs, byId, slice) {
  const N = runs.length;
  const first = new Float64Array(N), last = new Float64Array(N), start = new Float64Array(N), end = new Float64Array(N);
  const idx = new Map();
  let tmp = new Float64Array(512);
  for (let i = 0; i < N; i++) {
    const r = runs[i], n = r.stops.length;
    idx.set(r, i);
    if (tmp.length < 2 * n) tmp = new Float64Array(4 * n);
    timesOf(model, r, tmp);
    first[i] = tmp[1]; last[i] = tmp[2 * n - 2];
    if ((i + 1) % slice === 0) yield;
  }
  let lo = Infinity, hi = -Infinity;
  const handIn = new Uint8Array(N), handOut = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if ((i + 1) % slice === 0) yield;
    const r = runs[i];
    const p = r.prev?.length ? byId.get(r.prev[0]) : null, nx = r.next?.length ? byId.get(r.next[0]) : null;
    // standing at the first stop: from the arrival of the run it continues (through-running / next lap), else PRE.
    // A hand-over only when the train waits there at most LONG_WAIT; after a longer layover it fades out and back in.
    let s = first[i] - PRE;
    if (p && idx.has(p)) { const pl = last[idx.get(p)]; if (first[i] - pl <= LONG_WAIT) { s = Math.min(pl, first[i]); handIn[i] = 1; } }
    // at the last stop: hand over to the next run the moment it starts standing, else POST
    let e = last[i] + POST;
    if (nx && idx.has(nx) && first[idx.get(nx)] - last[i] <= LONG_WAIT) { e = last[i]; handOut[i] = 1; }
    start[i] = s; end[i] = Math.max(e, s + 1);
    if (start[i] < lo) lo = start[i];
    if (end[i] > hi) hi = end[i];
  }
  if (!N) { lo = 0; hi = 0; }
  const b0 = Math.floor(lo / BUCKET), nb = Math.floor(hi / BUCKET) - b0 + 1;
  const buckets = Array.from({ length: Math.max(1, nb) }, () => []);
  for (let i = 0; i < N; i++) {
    for (let b = Math.floor(start[i] / BUCKET); b <= Math.floor(end[i] / BUCKET); b++) buckets[b - b0].push(i);
  }
  return { idx, first, last, start, end, handIn, handOut, b0, buckets, stamp: new Int32Array(N), mark: 0 };
}

// Per-run arrays for placing it: t = [A0, D0, A1, D1 ...] (s, today's clock), u = unwrapped metres along the line per
// stop, plus the visibility window and whether its ends are hand-overs (no fade there).
function compile(model, run) {
  let c = model._comp.get(run);
  if (c) return c;
  const w = windows(model), i = w.idx.get(run), n = run.stops.length;
  const t = new Float64Array(2 * n), u = new Float64Array(n);
  timesOf(model, run, t);
  const li = run.line, g = model._geo[li], line = model.lines[li], L = g.length;
  // candidates (chain values) for each stop: on the line itself, else a same-group station on the line, else projected
  const cand = (s) => {
    let list = g.at.get(s);
    if (list) return list;
    if (g.proj.has(s)) return g.proj.get(s);
    const st = model.stations[s];
    if (st && st.group >= 0 && model.groups?.[st.group]) {
      for (const o of model.groups[st.group]) if (g.at.has(o)) { list = g.at.get(o); break; }
    }
    if (!list) list = st && st.lng != null ? [projectOnto(g, st.lng, st.lat)] : [0];
    g.proj.set(s, list);
    return list;
  };
  if (g.loop && L > 0) {
    const c0 = cand(run.stops[0].s)[0];
    let sign = 0;
    if (line.ascending != null && run.dir === line.ascending) sign = 1;
    else if (line.descending != null && run.dir === line.descending) sign = -1;
    else if (n > 1) { const d = ((cand(run.stops[1].s)[0] - c0) % L + L) % L; sign = d <= L / 2 ? 1 : -1; }
    else sign = 1;
    u[0] = c0;
    for (let k = 1; k < n; k++) {
      const list = cand(run.stops[k].s);
      let best = Infinity;
      for (const c of list) { const d = ((sign * (c - u[k - 1])) % L + L) % L; if (d < best) best = d; }
      u[k] = u[k - 1] + sign * best;
    }
  } else {
    const l0 = cand(run.stops[0].s);
    u[0] = l0[0];
    if (l0.length > 1 && n > 1) { // pick the copy of the first station nearest the second stop
      const l1 = cand(run.stops[1].s);
      let best = Infinity;
      for (const a of l0) for (const b of l1) if (Math.abs(b - a) < best) { best = Math.abs(b - a); u[0] = a; }
    }
    for (let k = 1; k < n; k++) {
      const list = cand(run.stops[k].s);
      let v = list[0], best = Infinity;
      if (list.length > 1) for (const c of list) { const d = Math.abs(c - u[k - 1]); if (d < best) { best = d; v = c; } }
      u[k] = v;
    }
  }
  // legs with no time (MT3D gives consecutive stops the same minute): pass those stops at times spread by distance up
  // to the next stop the train has time to reach, so it glides instead of jumping (positions only; boards keep times)
  for (let a = 0; a < n - 1; a++) {
    if (t[2 * a + 2] > t[2 * a + 1]) continue;
    let k = a;
    while (k < n - 1 && !(t[2 * k + 2] > t[2 * k + 1])) k++;
    if (k >= n - 1) break;
    const T0 = t[2 * a + 1], T1 = t[2 * k + 2], U0 = u[a], span = Math.abs(u[k + 1] - U0) || 1;
    for (let m = a + 1; m <= k; m++) t[2 * m] = t[2 * m + 1] = T0 + (T1 - T0) * Math.abs(u[m] - U0) / span;
    a = k;
  }
  c = { run, ri: i, li, g, n, t, u, k: -1, seg: 1, start: w.start[i], end: w.end[i], fadeIn: !w.handIn[i], fadeOut: !w.handOut[i],
    span: Math.abs(u[n - 1] - u[0]) || 1 };
  model._comp.set(run, c);
  return c;
}

// The core: where compiled run c is at second sec of the model's clock, written into RF / RI (module scratch, so a
// frame allocates nothing). false = not on the map at sec.
// RF: 0 lng, 1 lat, 2 bearing, 3 along (wrapped), 4 unwrapped, 5 done, 6 speed, 7 alpha; RI: 0 sign, 1 state, 2 stop, 3 doors
const PT = new Float64Array(3), RF = new Float64Array(8), RI = new Int32Array(4);
function place(c, force) {
  const sec = SC[0];
  if (!force && (sec < c.start || sec >= c.end)) return false;
  const t = c.t, u = c.u, n = c.n, m = 2 * n;
  // largest k with t[k] <= sec: last frame's k is nearly always still right (or the next one)
  let k = c.k;
  if (!((k < 0 || t[k] <= sec) && (k + 1 >= m || t[k + 1] > sec))) {
    if (k + 2 < m && t[k + 1] <= sec && t[k + 2] > sec) k++;
    else {
      let lo = 0, hi = m - 1; k = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (t[mid] <= sec) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    }
    c.k = k;
  }
  let state = 0, stop = 0, along = 0.5, speed = 0.5, legSign = 1;
  speed = 0;
  if (k < 0) { state = 2; stop = 0; along = u[0]; legSign = n > 1 ? Math.sign(u[1] - u[0]) || 1 : 1; }
  else if (k >= m - 1) { state = 3; stop = n - 1; along = u[n - 1]; legSign = n > 1 ? Math.sign(u[n - 1] - u[n - 2]) || 1 : 1; }
  else if ((k & 1) === 0) { // standing at stop k/2 between its arrival and departure
    stop = k >> 1; along = u[stop]; state = stop === 0 ? 2 : 1;
    legSign = stop < n - 1 ? Math.sign(u[stop + 1] - u[stop]) || 1 : Math.sign(u[stop] - u[stop - 1]) || 1;
  } else { // moving from stop i to i + 1
    const i = k >> 1, T = t[k + 1] - t[k], dt = sec - t[k], len = u[i + 1] - u[i];
    if (T <= 0) { along = u[i + 1]; state = 1; stop = i + 1; }
    else {
      // eased(dt, T), written out (no call in the per-train path)
      const r = T * 0.35 < RAMP ? T * 0.35 : RAMP, v = 1 / (T - r);
      let f = 0;
      if (dt <= 0) f = 0;
      else if (dt >= T) f = 1;
      else if (dt < r) f = v * dt * dt / (2 * r);
      else if (dt > T - r) { const w = T - dt; f = 1 - v * w * w / (2 * r); }
      else f = v * (dt - r / 2);
      along = u[i] + f * len; state = 0; stop = i + 1;
      const vmax = Math.abs(len) / (T - r), a1 = dt / r, a2 = (T - dt) / r;
      speed = vmax * (a1 < a2 ? (a1 < 1 ? a1 : 1) : (a2 < 1 ? a2 : 1));
    }
    legSign = Math.sign(len) || 1;
  }
  const g = c.g, L = g.length;
  SC[1] = along; HINT[0] = c.seg;
  pointOn(g, PT, 0);
  c.seg = HINT[0];
  RF[0] = PT[0]; RF[1] = PT[1];
  RF[2] = legSign > 0 ? PT[2] : (PT[2] + 180) % 360;
  RF[3] = g.loop && L > 0 ? ((along % L) + L) % L : along;
  RF[4] = along;
  const done = Math.abs(along - u[0]) / c.span;
  RF[5] = done < 0 ? 0 : done > 1 ? 1 : done;
  RF[6] = speed;
  let fi = 1, fo = 1;
  if (c.fadeIn) { const x = (sec - c.start) / FADE; fi = x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
  if (c.fadeOut) { const x = (c.end - sec) / FADE; fo = x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }
  RF[7] = fi * fo;
  RI[0] = legSign; RI[1] = state; RI[2] = stop;
  // doors: open while standing, shut 10 s before leaving and for the first 5 s after arriving
  RI[3] = (state === 3 ? sec >= t[m - 2] + 5 : state === 2 ? sec <= t[1] - 10 : state === 1 ? sec >= t[2 * stop] + 5 && sec <= t[2 * stop + 1] - 10 : false) ? 1 : 0;
  return true;
}
// the last place() as a position object, with the live state of its run (LV: 0 live 0/1, 1 measured delay, 2 lag)
const LV = new Float64Array(3);
function toPosition(run, o) {
  o.run = run; o.id = run.id; o.line = run.line;
  o.lng = RF[0]; o.lat = RF[1]; o.bearing = RF[2]; o.along = RF[3]; o.unwrapped = RF[4]; o.done = RF[5]; o.speed = RF[6]; o.alpha = RF[7];
  o.sign = RI[0]; o.state = RI[1]; o.stop = o.next = RI[2]; o.doors = RI[3] === 1; o.atStation = o.atStop = RI[1] !== 0;
  o.live = LV[0] === 1; o.delaySec = LV[0] === 1 ? LV[1] : null; o.lag = LV[2];
  o.estimated = LV[0] === 2; o.estDelaySec = LV[0] === 2 ? LV[1] : null; // LIVE: delay carried from the last report
  return o;
}

// ---------------------------------------------------------------------------------------------------------------
// Live delays (live.js keeps model.delays = Map(run -> measured delay s) up to date, in place)
// ---------------------------------------------------------------------------------------------------------------
// A late train is placed where the timetable had it `lag` seconds ago: its remaining stops all come lag s later.
// lag follows the measured delay smoothly and never moves a train backwards: it grows at most RATE_UP s per s (the
// train runs at half speed or stands longer) and shrinks at most RATE_DOWN s per s (up to double speed). Frames keep
// the smoothing state (typed arrays per run, read from model.delays once a second); boards use the measured delay.
export const RATE_UP = 0.5, RATE_DOWN = 1;
const SNAP = 10; // s: a clock jump bigger than this (first look, a sleeping tab) takes the measured delays at once

// The smoothing state, synced from model.delays at most once per model-second; null when nothing is late.
function lagOf(model, sec) {
  let L = model._lag;
  // runs changed (indexes moved) or model.delays is another Map now (playback, a new source): start again
  if (L && (L.version !== model.version || L.src !== model.delays)) L = model._lag = null;
  if (!L) {
    if (!model.delays || !model.delays.size) return null;
    const N = model.runs.length;
    L = model._lag = { version: model.version, src: model.delays, tgt: new Float32Array(N), cur: new Float32Array(N),
      live: new Uint8Array(N), list: [], sync: NaN, maxPos: 0, maxNeg: 0 };
  }
  // sync once per model-second going forward; a caller slightly behind the frames (a view using Date.now()) reads the
  // state as is; only a big jump back (a time slider) re-syncs, and that snaps to the measured delays
  if (Number.isNaN(L.sync) || sec - L.sync >= 1 || sec < L.sync - SNAP) syncLag(model, L, sec);
  return L.list.length ? L : null;
}
function syncLag(model, L, sec) {
  const dt = sec - L.sync, snap = !(dt >= 0 && dt <= SNAP), { tgt, cur, live } = L;
  // move every lag towards its target over dt, then read the new targets
  for (const i of L.list) {
    if (snap) cur[i] = tgt[i];
    else { const d = tgt[i] - cur[i], up = RATE_UP * dt, dn = RATE_DOWN * dt; cur[i] += d > up ? up : d < -dn ? -dn : d; }
    tgt[i] = 0; live[i] = 0;
  }
  const seen = new Set(L.list), idx = windows(model).idx;
  if (model.delays) model.delays.forEach((d, run) => {
    const i = idx.get(run);
    if (i === undefined || !Number.isFinite(d)) return;
    tgt[i] = d; live[i] = liveKind(model, run); seen.add(i);
    if (snap) cur[i] = d;
  });
  const list = [];
  let maxPos = 0, maxNeg = 0;
  for (const i of seen) {
    if (!live[i] && Math.abs(cur[i]) < 0.01) { cur[i] = 0; continue; }
    list.push(i);
    const hi = Math.max(cur[i], tgt[i]), lo = Math.min(cur[i], tgt[i]);
    if (hi > maxPos) maxPos = hi;
    if (-lo > maxNeg) maxNeg = -lo;
  }
  L.list = list; L.maxPos = maxPos; L.maxNeg = maxNeg; L.sync = sec;
}

/** 1 = measured in the newest ODPT answer, 2 = estimated (LIVE carried the delay from the train's last report; no
 * live mark, label "Estimated"). live.js keeps model.measured (Set); without it every delay counts as measured. */
function liveKind(model, run) { return model.measured && !model.measured.has(run) ? 2 : 1; }

/** MEASURED delay of a run in s from model.delays, or null (no live data, or only an estimate: not "live"). */
/** eased()'s inverse: the second t of T at which the fraction f (0..1) of a leg is done. */
export function easedInverse(f, T) {
  if (!(T > 0) || f <= 0) return 0;
  if (f >= 1) return T;
  const r = Math.min(RAMP, T * 0.35), v = 1 / (T - r), f1 = v * r / 2;
  if (f < f1) return Math.sqrt(2 * r * f / v);
  if (f > 1 - f1) return T - Math.sqrt(2 * r * (1 - f) / v);
  return f / v + r / 2;
}

function stationIndexOf(model, where) {
  if (typeof where === 'number') return where >= 0 && where < model.stations.length ? where : -1;
  if (!model._sIx) model._sIx = new Map(model.stations.map((s, i) => [s.id, i]));
  return model._sIx.get(where) ?? -1;
}

/**
 * LIVE: the model's OWN unlagged times for `run` at a station (MT3D station id or index), in seconds on
 * the RUN's clock (its service day, like run.stops; a late run's model clock is that - DAY), exactly as compile()
 * places the run: legs MT3D gives no time are glided by distance, every leg is driven on the eased() curve.
 *  - a stop of the run (that station, else a member of its same-name complex): { a, d } of its first such stop;
 *  - a station on the run's line that it passes without stopping (between two of its stops): a = d = the moment the
 *    drawn train passes it (eased() inverted, so a lag taken from it puts the drawn train right there);
 *  - anything else (not on its line, beyond its ends): null.
 * opts.model defaults to the model that registered the run.
 */
export function timeAt(run, where, { model } = {}) {
  const m = model || MODEL.get(run);
  if (!m || !run?.stops?.length) return null;
  const s = stationIndexOf(m, where);
  if (s < 0) return null;
  const c = compile(m, run), off = m._off.get(run) || 0, t = c.t, u = c.u, n = c.n;
  const grp = m.stations[s]?.group ?? -1;
  let k = run.stops.findIndex((x) => x.s === s);
  if (k < 0 && grp >= 0) k = run.stops.findIndex((x) => m.stations[x.s]?.group === grp);
  if (k >= 0) return { a: t[2 * k] - off, d: t[2 * k + 1] - off };
  const g = c.g, L = g.length;
  let chains = g.at.get(s);
  if (!chains && grp >= 0 && m.groups?.[grp]) for (const o of m.groups[grp]) if (g.at.has(o)) { chains = g.at.get(o); break; }
  if (!chains) return null;
  for (let i = 0; i < n - 1; i++) {
    const u0 = u[i], len = u[i + 1] - u0;
    if (!len) continue;
    for (const ch of chains) {
      // on a loop u is unwrapped: the copy of ch at or after the leg's lower end
      const x = g.loop && L > 0 ? ch + Math.ceil((Math.min(u0, u[i + 1]) - ch) / L - 1e-9) * L : ch;
      const f = (x - u0) / len;
      if (f < 0 || f > 1) continue;
      const T = t[2 * i + 2] - t[2 * i + 1];
      const at = T > 0 ? t[2 * i + 1] + easedInverse(f, T) : t[2 * i + 2];
      return { a: at - off, d: at - off };
    }
  }
  return null;
}

export function liveDelay(model, run) {
  const d = model.delays && model.delays.size ? model.delays.get(run) : undefined;
  return d !== undefined && Number.isFinite(d) && liveKind(model, run) === 1 ? d : null;
}

// LV for one run at model-clock sec, read-only (UI calls): the frames' smoothed lag while they run, else the measured
// delay. Returns the lag.
function readLag(model, run, sec) {
  const dv = model.delays && model.delays.size ? model.delays.get(run) : undefined, d = dv !== undefined && Number.isFinite(dv) ? dv : null;
  LV[0] = d === null ? 0 : liveKind(model, run); LV[1] = d === null ? 0 : d; LV[2] = 0;
  const L = model._lag;
  if (L && L.version === model.version && L.src === model.delays && Math.abs(sec - L.sync) <= SNAP) {
    const i = windows(model).idx.get(run);
    if (i !== undefined) {
      const c0 = L.cur[i], tg = L.tgt[i], dt = sec > L.sync ? sec - L.sync : 0, dd = tg - c0, up = RATE_UP * dt, dn = RATE_DOWN * dt;
      LV[2] = c0 + (dd > up ? up : dd < -dn ? -dn : dd);
      return LV[2];
    }
  }
  LV[2] = d === null ? 0 : d;
  return LV[2];
}

/**
 * Where `run` is at `sec` (seconds of its service day, as in run.stops; a late run's own clock, i.e. >= 86400), in the
 * model that registered it last (opts.model to ask another one: tt.js shares run objects between models):
 * { run, id, line, along (m on line.chain, wrapped on loops), unwrapped, lng, lat, bearing, sign (+1 = increasing
 * chain), stop (index in run.stops: where it stands, else the next stop), next (= stop, krl name), atStation / atStop,
 * doors, done (0..1 of its distance), state (0 moving, 1 standing at a stop, 2 waiting at its first stop, 3 arrived at
 * its last stop), speed (m/s), alpha (fade at the start / end of the day) }. null when it is not on the map at sec.
 * opts.force = true places it even outside its visibility window (standing at its first / last stop).
 */
export function position(run, sec, opts = {}) {
  const model = opts.model || MODEL.get(run);
  if (!model || !model.runById.has(run.id)) return null;
  const own = sec + (model._off.get(run) || 0), lag = readLag(model, run, own);
  SC[0] = own - lag;
  if (!place(compile(model, run), opts.force)) return null;
  return toPosition(run, opts.out || {});
}

/** The clock a run's own times are on, now: { seconds, start, previous } (krl/model.js name). */
export function trainClock(run, clock) {
  const model = MODEL.get(run), late = model && model._off.get(run) === -DAY;
  let { seconds, start } = clock;
  if (model && model.start != null) { seconds = (start + seconds * 1000 - model.start) / 1000; start = model.start; }
  return late ? { seconds: seconds + DAY, start: start - DAY * 1000, previous: true } : { seconds, start, previous: false };
}

// The runs that can be on the map this minute (rebuilt when the minute changes), so a frame looks only at those.
function active(model, sec, L = null) {
  const key = Math.floor(sec / 60), a = model._act, wPos = L ? L.maxPos : 0, wNeg = L ? L.maxNeg : 0;
  if (a.key === key && wPos <= a.wPos && wNeg <= a.wNeg) return a.list;
  // late trains stay on the map after their timetable end: look back by the biggest lag (whole minutes, so delays that
  // wobble do not rebuild the list every frame)
  const mPos = Math.ceil(wPos / 60) * 60, mNeg = Math.ceil(wNeg / 60) * 60;
  const w = windows(model), list = [], lo = sec - 61 - mPos, hi = sec + 61 + mNeg, mark = ++w.mark;
  const b1 = Math.max(0, Math.floor(lo / BUCKET) - w.b0), b2 = Math.min(w.buckets.length - 1, Math.floor(hi / BUCKET) - w.b0);
  for (let b = b1; b <= b2; b++) for (const i of w.buckets[b]) {
    if (w.stamp[i] === mark) continue;
    w.stamp[i] = mark;
    if (w.start[i] <= hi && w.end[i] >= lo) list.push(model.runs[i]);
  }
  // keep compiled arrays only for runs on the map now (bounded memory over a whole day)
  if (model._comp.size > list.length * 2 + 512) {
    const keep = new Set(list);
    for (const r of model._comp.keys()) if (!keep.has(r)) model._comp.delete(r);
  }
  a.key = key; a.list = list; a.comp = new Array(list.length).fill(null); a.wPos = mPos; a.wNeg = mNeg;
  return list;
}

/** Every run on the map at ms (positions, as position()). Allocates: for lists and counts; frames use createFrame(). */
export function running(model, ms = Date.now()) {
  const sec = secOf(model, ms), L = lagOf(model, sec), out = [];
  for (const run of active(model, sec, L)) {
    const c = compile(model, run);
    LV[0] = 0; LV[1] = 0; LV[2] = 0;
    if (L !== null) {
      const i = c.ri, c0 = L.cur[i], tg = L.tgt[i], dt = sec > L.sync ? sec - L.sync : 0, d = tg - c0, up = RATE_UP * dt, dn = RATE_DOWN * dt;
      LV[0] = L.live[i]; LV[1] = L.live[i] ? tg : 0; LV[2] = c0 + (d > up ? up : d < -dn ? -dn : d);
    }
    SC[0] = sec - LV[2];
    if (place(c, false)) out.push(toPosition(run, {}));
  }
  return out;
}

/**
 * Zero-allocation frames for the trains layer: const f = createFrame(model); n = f.update(ms) fills f.runs[0..n) and
 * typed arrays lng, lat (Float64), along (Float64, wrapped), bearing (Float32, deg), sign (Int8), line (Int32),
 * stop (Int32), state (Uint8: 0 moving, 1 at a stop, 2 waiting at first stop, 3 arrived at last), doors (Uint8),
 * alpha, speed, done (Float32), live (Uint8: 1 = measured by ODPT, show "live"; 2 = estimated, delay carried from the
 * train's last report: NO live mark, label "Estimated"; 0 = "Scheduled"), delay (Float32, measured or estimated delay
 * s, else 0), lag (Float32, the delay the train is placed with now: eases towards delay).
 * Arrays grow (rarely) when more trains run than fit.
 */
export function createFrame(model, capacity = 2048) {
  const f = { n: 0, runs: [], ms: 0.5, sec: 0.5 };
  const alloc = (cap) => {
    f.cap = cap;
    f.lng = new Float64Array(cap); f.lat = new Float64Array(cap); f.along = new Float64Array(cap);
    f.bearing = new Float32Array(cap); f.alpha = new Float32Array(cap); f.speed = new Float32Array(cap); f.done = new Float32Array(cap);
    f.sign = new Int8Array(cap); f.line = new Int32Array(cap); f.stop = new Int32Array(cap);
    f.state = new Uint8Array(cap); f.doors = new Uint8Array(cap);
    f.live = new Uint8Array(cap); f.delay = new Float32Array(cap); f.lag = new Float32Array(cap);
  };
  alloc(capacity);
  f.update = (ms = Date.now()) => {
    const sec = model.start != null ? (ms - model.start) / 1000 : serviceSeconds(ms);
    const L = lagOf(model, sec), list = active(model, sec, L), comp = model._act.comp;
    if (list.length > f.cap) alloc(Math.max(list.length, f.cap * 2));
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const run = list[i], c = comp[i] || (comp[i] = compile(model, run));
      let lag = 0, lv = 0, dl = 0;
      if (L !== null) {
        const ri = c.ri, c0 = L.cur[ri], tg = L.tgt[ri];
        lag = c0;
        if (c0 !== tg) { const dt = sec > L.sync ? sec - L.sync : 0, d = tg - c0, up = RATE_UP * dt, dn = RATE_DOWN * dt; lag = c0 + (d > up ? up : d < -dn ? -dn : d); }
        lv = L.live[ri]; dl = lv ? tg : 0;
      }
      SC[0] = sec - lag;
      if (!place(c, false)) continue;
      f.runs[n] = run; f.lng[n] = RF[0]; f.lat[n] = RF[1]; f.bearing[n] = RF[2]; f.along[n] = RF[3];
      f.done[n] = RF[5]; f.speed[n] = RF[6]; f.alpha[n] = RF[7];
      f.sign[n] = RI[0]; f.state[n] = RI[1]; f.stop[n] = RI[2]; f.doors[n] = RI[3]; f.line[n] = run.line;
      f.live[n] = lv; f.delay[n] = dl; f.lag[n] = lag;
      n++;
    }
    f.runs.length = n; f.n = n; f.ms = ms; f.sec = sec;
    return n;
  };
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Departures / arrivals
// ---------------------------------------------------------------------------------------------------------------

// Per station, every departure (kind 'D') or arrival ('A') of the model's runs sorted by time (today's clock), as
// CSR typed arrays; each kind is built on first use after the runs change (~40k runs: tens of ms, once).
const KEY = 2097152; // 2^21: composite sort key = time in 1/64 s * KEY + index in the station's slice
function stopIndex(model, kind) {
  if (!model._dep || model._dep.version !== model.version) model._dep = { version: model.version };
  if (model._dep[kind]) return model._dep[kind];
  return (model._dep[kind] = drain(stopIndexGen(model, model.runs, kind, Infinity)));
}
function* stopIndexGen(model, runs, kind, slice) {
  const S = model.stations.length, dep = kind === 'D';
  const off = new Int32Array(S + 1);
  for (let ri = 0; ri < runs.length; ri++) {
    if ((ri + 1) % slice === 0) yield;
    const r = runs[ri], n = r.stops.length;
    for (let i = dep ? 0 : 1; i < (dep ? n - 1 : n); i++) {
      const st = r.stops[i];
      if (dep && st.d == null) continue;
      if (st.s >= 0 && st.s < S) off[st.s + 1]++;
    }
  }
  for (let s = 0; s < S; s++) off[s + 1] += off[s];
  const E = off[S], run = new Int32Array(E), stop = new Uint16Array(E), time = new Float32Array(E), fill = off.slice(0, S);
  let tmp = new Float64Array(512);
  for (let ri = 0; ri < runs.length; ri++) {
    if ((ri + 1) % slice === 0) yield;
    const r = runs[ri], n = r.stops.length;
    if (tmp.length < 2 * n) tmp = new Float64Array(4 * n);
    timesOf(model, r, tmp);
    for (let i = dep ? 0 : 1; i < (dep ? n - 1 : n); i++) {
      const st = r.stops[i];
      if ((dep && st.d == null) || st.s < 0 || st.s >= S) continue;
      const k = fill[st.s]++;
      run[k] = ri; stop[k] = i; time[k] = tmp[2 * i + (dep ? 1 : 0)];
    }
  }
  let keys = new Float64Array(1024), tr = new Int32Array(1024), ts = new Uint16Array(1024), tt = new Float32Array(1024);
  for (let s = 0, done = 0; s < S; s++) {
    const a = off[s], m = off[s + 1] - a;
    if (m < 2) continue;
    if ((done += m) >= slice * 8) { done = 0; yield; } // ~8 stop events per run: about one slice of work
    let sorted = true;
    for (let k = a + 1; k < a + m; k++) if (time[k] < time[k - 1]) { sorted = false; break; }
    if (sorted) continue;
    if (keys.length < m) { keys = new Float64Array(2 * m); tr = new Int32Array(2 * m); ts = new Uint16Array(2 * m); tt = new Float32Array(2 * m); }
    for (let j = 0; j < m; j++) keys[j] = Math.round(time[a + j] * 64) * KEY + j;
    const ks = keys.subarray(0, m).sort();
    for (let j = 0; j < m; j++) { const src = a + (ks[j] % KEY); tr[j] = run[src]; ts[j] = stop[src]; tt[j] = time[src]; }
    run.set(tr.subarray(0, m), a); stop.set(ts.subarray(0, m), a); time.set(tt.subarray(0, m), a);
  }
  return { off, run, stop, time };
}

// where: station index | [station...] | { station } | { group }
function stationsOf(model, where) {
  if (typeof where === 'number') return [where];
  if (Array.isArray(where)) return where;
  if (where && typeof where.group === 'number') return model.groups?.[where.group] || [];
  if (where && typeof where.station === 'number') return [where.station];
  return [];
}

function events(model, X, where, ms, limit, keep) {
  const clock = model.start != null ? { start: model.start, seconds: (ms - model.start) / 1000 } : serviceTime(ms);
  const sec = clock.seconds, out = [];
  // live delays (model.delays: measured + live.js's estimates; model.measured says which): remaining stops come delay s later
  const dm = model.delays && model.delays.size ? model.delays : null;
  let maxPos = 0, minNeg = 0;
  if (dm) dm.forEach((d) => { if (d > maxPos) maxPos = d; if (d < minNeg) minNeg = d; });
  for (const s of stationsOf(model, where)) {
    if (s < 0 || s >= model.stations.length) continue;
    let lo = X.off[s], hi = X.off[s + 1];
    const end = hi, from = sec - maxPos;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (X.time[mid] < from) lo = mid + 1; else hi = mid; }
    let got = 0, worst = -Infinity;
    for (let k = lo; k < end; k++) {
      const sched = X.time[k];
      if (got >= limit && sched + minNeg > worst) break;
      const run = model.runs[X.run[k]], stop = X.stop[k];
      const dv = dm ? dm.get(run) : undefined, has = dv !== undefined && Number.isFinite(dv), delay = has ? dv : 0;
      const live = has && liveKind(model, run) === 1, est = has && !live;
      const time = sched + delay;
      if (time < sec) continue;
      if (keep && !keep(run, stop)) continue;
      const st = run.stops[stop];
      out.push({ run, train: run, stop, station: s, time, at: clock.start + time * 1000, sched, delay, live, est,
        line: run.line, type: run.type, dir: run.dir, to: destination(model, run), last: stop === run.stops.length - 1,
        a: st.a, d: st.d });
      got++;
      if (time > worst) worst = time;
    }
  }
  return out.sort((a, b) => a.at - b.at || (a.run.id < b.run.id ? -1 : a.run.id > b.run.id ? 1 : 0)).slice(0, limit);
}

/**
 * The next departures (expected time >= now) at a station / several / a group: [{ run, train (= run), stop, station,
 * time (s on the model's clock, + the live delay), at (ms epoch), sched (timetable s), delay (s, 0 if none), live
 * (true = measured by ODPT), est (true = estimated by LIVE from the train's last report: say "Estimated", never "live";
 * both false = "Scheduled"), line, type, dir, to (destination station | -1), last, a, d }],
 * soonest first. A run's last stop is no departure (a through-run's departure there belongs to its next run).
 * opts: { line, dir, type, filter(run, stop) }. Only the model's runs (one service day): for tomorrow's first trains use
 * a model pinned to the next service day (nextServiceDay(), nextDayModel(), firstDepartures()).
 */
export function departures(model, where, ms = Date.now(), limit = 20, opts = {}) {
  return events(model, stopIndex(model, 'D'), where, ms, limit, keeper(opts));
}

/**
 * Arrivals (expected arrival, timetable or estimated + live delay, >= now). Default: only runs that END here (last stop,
 * no through-run on); opts.all = true: every arrival, passing trains included. Same entry shape as departures().
 */
export function arrivals(model, where, ms = Date.now(), limit = 12, opts = {}) {
  const k = keeper(opts);
  const keep = opts.all ? k : (run, stop) => stop === run.stops.length - 1 && !nextRuns(model, run).length && (!k || k(run, stop));
  return events(model, stopIndex(model, 'A'), where, ms, limit, keep);
}

// ---------------------------------------------------------------------------------------------------------------
// The next service day (board.js: tomorrow's first trains after the last one has gone)
// ---------------------------------------------------------------------------------------------------------------

/** The service day after the one running at ms, as serviceTime() at its 03:00: { seconds (= TURN), weekday, date,
 * start (ms of its 00:00 WIB), kind, cals (pass to tt.js loadRuns({ cal })), calendar }. */
export function nextServiceDay(ms = Date.now()) {
  const cur = serviceTime(ms);
  return serviceTime(cur.start + (DAY + TURN) * 1000);
}

/**
 * A model of the next service day's early runs, pinned to its date (so its departures come out at tomorrow's ms):
 * nextDayModel(net, loadRuns, ms, { toSec }) with tt.js's loadRuns. Loads 03:00 .. toSec (default 07:00, ~130 KB br on
 * a weekday: every line's first trains). Resolves to the model (its .date / .calendar say which day).
 */
export async function nextDayModel(net, loadRuns, ms = Date.now(), { toSec = 7 * 3600, ...load } = {}) {
  const day = nextServiceDay(ms);
  const runs = await loadRuns({ ...load, cal: day.cals, fromSec: TURN, toSec });
  return createModel(net, runs, { date: day.date, calendar: day.calendar, register: false });
}

/**
 * The first departure of the model's service day at a station / several / a group, one per way out: by 'dir' (line +
 * direction, default), 'line', 'station' (station + line + direction) or 'all' (every departure from 03:00, limit
 * opts.limit). Entries as departures(), soonest first. For tomorrow: pass a model pinned to the next service day; an
 * unpinned model counts from 03:00 of the service day at opts.ms.
 */
export function firstDepartures(model, where, { by = 'dir', ms = Date.now(), limit = Infinity } = {}) {
  const start = model.start != null ? model.start : serviceTime(ms).start;
  const all = departures(model, where, start + TURN * 1000, by === 'all' ? limit : Infinity);
  if (by === 'all') return all;
  const seen = new Set(), out = [];
  for (const e of all) {
    const k = by === 'line' ? e.line : by === 'station' ? `${e.station}/${e.line}/${e.dir}` : `${e.line}/${e.dir}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  return out.slice(0, limit);
}

function keeper(opts) {
  const { line, dir, type, filter } = opts || {};
  if (line == null && dir == null && type == null && !filter) return null;
  return (run, stop) => (line == null || run.line === line) && (dir == null || run.dir === dir) && (type == null || run.type === type) && (!filter || filter(run, stop));
}

// ---------------------------------------------------------------------------------------------------------------
// Through-running
// ---------------------------------------------------------------------------------------------------------------

/** The runs this one continues as (another line or the next lap), as loaded in the model. */
export const nextRuns = (model, run) => (run.next || []).map((id) => model.runById.get(id)).filter(Boolean);
/** The runs this one continues from. */
export const prevRuns = (model, run) => (run.prev || []).map((id) => model.runById.get(id)).filter(Boolean);

/** The whole train: runs linked by prev / next (first link each way), in running order. */
export function throughChain(model, run, max = 64) {
  const seen = new Set([run]), before = [], after = [];
  for (let r = run; before.length < max;) { const p = prevRuns(model, r)[0]; if (!p || seen.has(p)) break; seen.add(p); before.unshift(p); r = p; }
  for (let r = run; after.length < max;) { const x = nextRuns(model, r)[0]; if (!x || seen.has(x)) break; seen.add(x); after.push(x); r = x; }
  return [...before, run, ...after];
}

/** Where the train is going (station index): MT3D's destination (run.to) when given, else the end of its through
 * chain; -1 on a loop line without one (Yamanote: show the direction, model.dirs[run.dir].title). */
export function destination(model, run) {
  if (run.to?.length && run.to[0] >= 0) return run.to[0];
  if (model.lines[run.line]?.loop) return -1; // loop runs have no destination: show model.dirs[run.dir].title
  if (!model._dest || model._dest.version !== model.version) model._dest = { version: model.version, map: new Map() };
  let s = model._dest.map.get(run);
  if (s === undefined) {
    const ch = throughChain(model, run), last = ch[ch.length - 1];
    s = last.stops[last.stops.length - 1].s;
    model._dest.map.set(run, s);
  }
  return s;
}
