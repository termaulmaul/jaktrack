// Timetable bucket decoder + loader.
// Data: Mini Tokyo 3D train timetables (MIT, (c) Akihiko Kusanagi), packed by data-build/tt/build.mjs.
//
//   import { loadRuns } from './tt.js';
//   import { calendarAt } from './calendar.js';
//   const { cals, sec } = calendarAt(Date.now());
//   const runs = await loadRuns({ cal: cals, fromSec: sec - 3600, toSec: sec + 3 * 3600 });
//
// run = { id, key, line, type, dir, number, from: [station], to: [station], stops: [{ s, a, d }], next: [runId],
//         prev: [runId], cars: null, cal, part, names: [{ en, ja }] | null, vehicle: string | null, first, last,
//         until }
// Times are seconds since 00:00 WIB of the service day (>= 86400 after midnight; the day turns over at 03:00).
// `a` / `d` are null where MT3D gives none (first stop: no arrival, last stop: no departure; many middle stops only
// have a departure). `from` / `to` are empty for runs MT3D gives no origin / destination (Yamanote loop runs, some
// through-running Chiyoda runs): show model.dirs[run.dir].title instead. `part` is 1 / 2 for the two sections of a
// train that splits or joins mid-line (MT3D id suffix '.1' / '.2'), else 0. `first` / `last` = earliest / latest time;
// `until` = when it leaves its last stop: the first departure of its next run if later than `last` (MT3D keeps the
// train standing at the terminal until then), else `last`.
// Extra fields beyond the documented run shape: cal, part, names, vehicle, first, last, until.

import { calendarAt } from './calendar.js';

export const FORMAT = 1;
export const CAL_NAMES = ['weekday', 'holiday', 'saturday', 'sunday-holiday'];
const LEAD = 120, TAIL = 60; // same activity window as the build: first - 2 min .. end + 1 min

/**
 * Decode one bucket file (the parsed JSON). Self-contained: it carries the line ids it needs.
 * @returns {{ cal: string, src: string, t0: number, t1: number, runs: object[] }}
 */
export function unpackBucket(json) {
  if (!json || json.f !== FORMAT) throw new Error(`tt: unsupported bucket format ${json && json.f}`);
  const { cal, src, t0, t1, lines, p: patterns } = json;
  const ref = (line, r) => {
    const [l, num] = Array.isArray(r) ? r : [line, r];
    const dot = num.indexOf('.');
    return dot < 0 ? `${lines[l]}.${num}.${src}` : `${lines[l]}.${num.slice(0, dot)}.${src}.${num.slice(dot + 1)}`;
  };
  const runs = new Array(json.r.length);
  for (let i = 0; i < json.r.length; i++) {
    const [num, line, type, dir, pi, startMin, deltas, from, to, next, prev, stand, names, vehicle] = json.r[i];
    const dot = num.indexOf('.');
    const number = dot < 0 ? num : num.slice(0, dot);
    const part = dot < 0 ? 0 : +num.slice(dot + 1);
    const key = `${lines[line]}.${number}`;
    const pat = patterns[pi];
    const stops = new Array(pat.length);
    let m = startMin, k = -1, first = Infinity, last = -Infinity;
    for (let j = 0; j < pat.length; j++) {
      const v = pat[j];
      let a = null, d = null;
      if (v & 1) {
        if (k >= 0) m += deltas[k];
        k++; a = m * 60;
        if (a < first) first = a;
        if (a > last) last = a;
      }
      if (v & 2) {
        if (k >= 0) m += deltas[k];
        k++; d = m * 60;
        if (d < first) first = d;
        if (d > last) last = d;
      }
      stops[j] = { s: v >> 2, a, d };
    }
    runs[i] = {
      id: part ? `${key}.${src}.${part}` : `${key}.${src}`,
      key, line, type, dir, number, from, to, stops,
      next: next.map((r) => ref(line, r)), prev: prev.map((r) => ref(line, r)),
      cars: null, cal, part,
      names: names ? names.map(([en, ja]) => ({ en, ja })) : null,
      vehicle: vehicle || null, first, last, until: last + stand * 60,
    };
  }
  return { cal, src, t0, t1, runs };
}

// ---- loader ------------------------------------------------------------------------------------------------------
const cache = new Map(); // url -> Promise<json | unpacked bucket>

/** Forget everything fetched (tests, or after a data update). */
export function clearCache() { cache.clear(); }

const trim = (base) => String(base ?? '/data/tokyo').replace(/\/+$/, '');

async function getJSON(url, fetchFn) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`tt: ${url} -> ${res.status}`);
  return res.json();
}

function memo(url, make) {
  if (!cache.has(url)) {
    const p = make().catch((e) => { cache.delete(url); throw e; });
    cache.set(url, p);
  }
  return cache.get(url);
}

/** tt-latest.json: { f, dir: 'tt-v1', hash, bucket, cals: { weekday: { runs, lines, buckets }, ... } } */
export function loadPointer({ base = '/data/tokyo', fetch: fetchFn = globalThis.fetch } = {}) {
  base = trim(base);
  return memo(`${base}/tt-latest.json`, () => getJSON(`${base}/tt-latest.json`, fetchFn));
}

/** A calendar's index.json: { cal, src, bucket, t0, t1, runs, stops, first, last, lines: [lineIndex], buckets: [...] } */
export async function loadIndex({ base = '/data/tokyo', cal, fetch: fetchFn = globalThis.fetch } = {}) {
  base = trim(base);
  const ptr = await loadPointer({ base, fetch: fetchFn });
  if (!ptr.cals[cal]) return null; // calendar not built (unknown name)
  const url = `${base}/${ptr.dir}/${cal}/index.json?h=${ptr.hash}`;
  return memo(url, () => getJSON(url, fetchFn));
}

/** One bucket, fetched once and unpacked once. */
export async function loadBucket({ base = '/data/tokyo', cal, file, fetch: fetchFn = globalThis.fetch } = {}) {
  base = trim(base);
  const ptr = await loadPointer({ base, fetch: fetchFn });
  const url = `${base}/${ptr.dir}/${cal}/${file}`;
  return memo(url, async () => unpackBucket(await getJSON(url, fetchFn)));
}

/** [start, end] seconds in which a run is on the map: first time - 2 min .. `until` (its last time, or the next
 *  run's first departure while it stands at the terminal) + 1 min. Same window the build buckets by. */
export function activeWindow(run) {
  return [run.first - LEAD, run.until + TAIL];
}

/**
 * Runs active in [fromSec, toSec] of one service day.
 * @param {object} o
 * @param {string} [o.base='/data/tokyo']
 * @param {string|string[]} o.cal  calendar name, or calendarFor()'s ordered list: each line uses the first calendar
 *        in the list that has runs for it (e.g. ['saturday', 'holiday']: Toei Arakawa uses its Saturday set, every
 *        other line the shared Saturday/holiday set).
 * @param {number} [o.fromSec=0]  seconds since 00:00 WIB of the service day
 * @param {number} [o.toSec=97200]
 * @param {Function} [o.fetch=globalThis.fetch]
 * @returns {Promise<object[]>} runs sorted by first time, then id; each run object is shared across calls (cached).
 */
export async function loadRuns({ base = '/data/tokyo', cal, fromSec = 0, toSec = 97200, fetch: fetchFn = globalThis.fetch } = {}) {
  base = trim(base);
  const cals = (Array.isArray(cal) ? cal : [cal]).filter(Boolean);
  if (!cals.length) throw new Error('tt: loadRuns needs cal');
  const indexes = await Promise.all(cals.map((c) => loadIndex({ base, cal: c, fetch: fetchFn })));
  const lineCal = new Map(); // line -> calendar it uses
  cals.forEach((c, i) => {
    if (!indexes[i]) return;
    for (const l of indexes[i].lines) if (!lineCal.has(l)) lineCal.set(l, c);
  });
  const jobs = [];
  cals.forEach((c, i) => {
    const idx = indexes[i];
    if (!idx) return;
    for (const b of idx.buckets) if (b.t0 <= toSec && b.t1 > fromSec) jobs.push(loadBucket({ base, cal: c, file: b.file, fetch: fetchFn }));
  });
  const buckets = await Promise.all(jobs);
  const seen = new Set(), out = [];
  for (const b of buckets) for (const run of b.runs) {
    if (seen.has(run.id) || lineCal.get(run.line) !== b.cal) continue;
    seen.add(run.id);
    out.push(run);
  }
  const kept = out.filter((r) => { const [s, e] = activeWindow(r); return s <= toSec && e >= fromSec; });
  kept.sort((a, b) => a.first - b.first || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return kept;
}

/**
 * the hour buckets that cover [fromSec, toSec], whole: { runs, from, to } where runs = every run
 * active in [from, to] and [from, to] = the span those buckets cover, widened to the service day's ends (03:00 /
 * 27:00) when it reaches the first / last bucket, so a model window built from it says honestly what is loaded
 * (board.js's coverage(): first / last trains are claimed only when that end of the day is in). Buckets are fetched once
 * (cached like loadRuns); asking again for a wider span only fetches the missing hours.
 */
export async function loadWindow({ base = '/data/tokyo', cal, fromSec = 0, toSec = 97200, fetch: fetchFn = globalThis.fetch } = {}) {
  base = trim(base);
  const cals = (Array.isArray(cal) ? cal : [cal]).filter(Boolean);
  if (!cals.length) throw new Error('tt: loadWindow needs cal');
  const ptr = await loadPointer({ base, fetch: fetchFn });
  const indexes = (await Promise.all(cals.map((c) => loadIndex({ base, cal: c, fetch: fetchFn })))).filter(Boolean);
  const B = ptr.bucket > 0 ? ptr.bucket : 3600;
  let from = Math.floor(fromSec / B) * B, to = Math.max(from + B, Math.ceil(toSec / B) * B);
  let t0 = Infinity, t1 = -Infinity;
  for (const idx of indexes) for (const b of idx.buckets) { if (b.t0 < t0) t0 = b.t0; if (b.t1 > t1) t1 = b.t1; }
  if (from <= t0) from = DAY_FROM;
  if (to >= t1) to = DAY_TO;
  const runs = await loadRuns({ base, cal: cals, fromSec: from, toSec: to - 1, fetch: fetchFn });
  return { runs, from, to };
}
const DAY_FROM = 3 * 3600, DAY_TO = 27 * 3600;

/**
 * Convenience for the page: the runs around `now` on the right calendar.
 * loadTimetable('/data/tokyo/', { calendar?, now?, fromSec?, toSec?, fetch? })
 *   -> { runs, date, sec, cals, kind, holiday, fromSec, toSec }
 * calendar defaults to calendarFor(service date of now); the window to now - 1 h .. now + 3 h (service-day seconds).
 * Call again with a later window as time passes: cached buckets are not fetched again, and the same run objects
 * come back (model.js's model.add() skips ids it has). At 03:00 WIB the service date changes: load the new day.
 */
export async function loadTimetable(base = '/data/tokyo', { calendar, now = Date.now(), fromSec, toSec, fetch: fetchFn = globalThis.fetch } = {}) {
  const at = calendarAt(now);
  const cals = calendar && (Array.isArray(calendar) ? calendar.length : true) ? calendar : at.cals;
  const from = fromSec ?? Math.max(0, at.sec - 3600), to = toSec ?? at.sec + 3 * 3600;
  const runs = await loadRuns({ base, cal: cals, fromSec: from, toSec: to, fetch: fetchFn });
  return { runs, date: at.date, sec: at.sec, cals: Array.isArray(cals) ? cals : [cals], kind: at.kind, holiday: at.holiday, fromSec: from, toSec: to };
}
