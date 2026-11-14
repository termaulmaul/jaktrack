// the journey planner on live times. route.js plans on a timetable index built once per hour
// window; this file lays the delays the map already has over that index for one search, without rebuilding it.
//
// Source = what the map and the boards use (live.js keeps them on the model.js model the planner is given as `net`):
//   model.delays   Map(run -> s)  measured + live.js's estimates (an estimate is already decayed by live.js's rule:
//                                 d0 falling to 0 over 20 min after its report; refreshed at every poll)
//   model.measured Set(run)       measured in the newest answer = 'live'; any other run of model.delays = 'estimated'
//                                 (no Set at all: every delay counts as measured, as model.js liveKind)
//   model.derived  Set(run)       live position without a delay figure (the lag is read from the reported place)
//   model._off     Map(run -> s)  -DAY for a late run of the previous service day: never applied to today's runs
// Nothing is matched here (live.js did that); runs are found in the planner's index by run.id. A run with no entry
// stays on the timetable: no delay is ever made up for a line without live data.
//
// The overlay (liveTimetable): copies of the index's arrival / departure arrays; every trip carrying a delayed run
// gets that run's remaining stops (timetable + delay >= cutoff, live.js shiftStops' rule) moved by the delay, then
// times are kept non-decreasing along the trip (a train cannot leave a station before it arrived there: a late run
// hands its lateness to the run it becomes). Negative delays count as 0 (never plan a train leaving early). A pattern
// whose trips stop being FIFO (a late train now runs behind the next one) is split again into FIFO sub-patterns,
// trips permuted inside the pattern's own slot, so RAPTOR's binary search stays right. Everything else is shared with
// the timetable index. Overlay trip t is timetable trip tOrig[t] (its runs: tSegOff/tSegRun/tSegPos of the base).

const INF = 0x3fffffff;

export const LIVE = {
  ahead: 3600,  // s: departures up to this far after now plan on live times (later = timetable)
  behind: 300,  // s: ... and this far before now (a "Leave now" a moment old, the page clock a little behind)
};

/**
 * What the delay source says, for the runs of timetable index `tt`: { byRun: Map(run index -> { d, state, figure,
 * raw }), sig } or null when there is nothing to apply. `src` = the model (or any { delays, measured?, derived?,
 * _off? }).
 */
export function readDelays(src, tt) {
  const delays = src?.delays;
  if (!delays || typeof delays.forEach !== 'function' || !delays.size) return null;
  const idx = tt.runIdx || runIndex(tt);
  const measured = src.measured && typeof src.measured.has === 'function' ? src.measured : null;
  const derived = src.derived && typeof src.derived.has === 'function' ? src.derived : null;
  const off = src._off && typeof src._off.get === 'function' ? src._off : null;
  const byRun = new Map();
  const sig = [];
  delays.forEach((dv, run) => {
    if (!run || typeof run !== 'object' || !Number.isFinite(dv)) return;
    if (off && off.get(run)) return;                       // yesterday's late run: another day's train
    const ri = idx.get(run.id);
    if (ri === undefined) return;
    const mine = tt.runs[ri];
    if (mine !== run && !sameRun(mine, run)) return;        // same id, other timetable (a day turned over)
    const state = !measured || measured.has(run) ? 'live' : 'estimated';
    const figure = !(derived && derived.has(run));
    const d = Math.max(0, Math.round(dv));
    byRun.set(ri, { d, state, figure, raw: Math.round(dv) });
    sig.push(`${ri}:${d}:${state === 'live' ? 1 : 2}${figure ? '' : 'p'}`);
  });
  if (!byRun.size) return null;
  return { byRun, sig: sig.join(',') };
}

function sameRun(a, b) {
  if (!a || !b || a.id !== b.id || a.stops?.length !== b.stops?.length) return false;
  const x = a.stops[0], y = b.stops[0];
  return (x?.d ?? x?.a) === (y?.d ?? y?.a);
}

function runIndex(tt) {
  if (!tt._runIdx) {
    const m = new Map();
    tt.runs.forEach((r, i) => m.set(r.id, i));
    Object.defineProperty(tt, '_runIdx', { value: m, enumerable: false });
  }
  return tt._runIdx;
}

/** run index -> trips that carry it (CSR, built once per timetable index). */
function runTrips(tt) {
  if (tt.rtOff && tt.rtTrips) return { off: tt.rtOff, trips: tt.rtTrips }; // built with the index (route.js)
  if (tt._runTrips) return tt._runTrips;
  const R = tt.runs.length, T = tt.T;
  const off = new Int32Array(R + 1);
  for (let t = 0; t < T; t++) for (let k = tt.tSegOff[t]; k < tt.tSegOff[t + 1]; k++) off[tt.tSegRun[k] + 1]++;
  for (let r = 0; r < R; r++) off[r + 1] += off[r];
  const trips = new Int32Array(off[R]), fill = off.slice(0, R);
  for (let t = 0; t < T; t++) for (let k = tt.tSegOff[t]; k < tt.tSegOff[t + 1]; k++) trips[fill[tt.tSegRun[k]]++] = t;
  const rt = { off, trips };
  Object.defineProperty(tt, '_runTrips', { value: rt, enumerable: false });
  return rt;
}

/**
 * The live overlay of timetable index `tt` for the delays `spec` (readDelays), stops before `cutoff` (service s)
 * left alone. Returns an index with the same shape (RAPTOR, trace and describe read it as they read `tt`) plus
 * { base: tt, tOrig, live: { byRun, sig, cutoff, trips, split, ms } }.
 */
export function liveTimetable(tt, spec, cutoff) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const byRun = new Map(spec.byRun);
  const { tTime, tPat, tSegOff, tSegRun, tSegPos, pStopOff, pTA, pTB } = tt;
  // one pair of work arrays per index, reused: copying 2 x 0.5 MB and dropping it at every new delay set cost a phone
  // more (GC) than the work itself. Undo what the last overlay moved, then move again. An overlay of this index is
  // stale once a newer one is built (live.gen != the index's gen): route.js checks before reusing one.
  let W = tt._lw;
  if (!W) { W = { tArr: tt.tArr.slice(), tDep: tt.tDep.slice(), touched: null, gen: 0 }; Object.defineProperty(tt, '_lw', { value: W }); }
  else if (W.touched) {
    for (const t of W.touched) {
      const b = tTime[t], n = pStopOff[tPat[t] + 1] - pStopOff[tPat[t]];
      W.tArr.set(tt.tArr.subarray(b, b + n), b); W.tDep.set(tt.tDep.subarray(b, b + n), b);
    }
  }
  W.gen++;
  const tArr = W.tArr, tDep = W.tDep;
  const rt = runTrips(tt);
  // trips carrying a delayed run
  const hit = new Uint8Array(tt.T), trips = [];
  const touch = (ri) => {
    for (let k = rt.off[ri]; k < rt.off[ri + 1]; k++) {
      const t = rt.trips[k];
      if (!hit[t]) { hit[t] = 1; trips.push(t); }
    }
  };
  for (const ri of spec.byRun.keys()) touch(ri);
  // the run a late train becomes next (through service, next lap) with nothing of its own: it cannot leave before the
  // train is there. That lateness belongs to the RUN (a lap sits in two trips: both must agree), one hop deep.
  const carry = new Map();
  for (const t of trips) {
    const base = tTime[t];
    for (let k = tSegOff[t] + 1; k < tSegOff[t + 1]; k++) {
      const x = spec.byRun.get(tSegRun[k - 1]), y = tSegRun[k];
      if (!x || spec.byRun.has(y)) continue;
      const h = tSegPos[k], a = tt.tArr[base + h], d = tt.tDep[base + h];
      const c = a + shiftOf(x, 0, a, cutoff) - (d < INF ? d : a);
      if (c > 0 && c > (carry.get(y) || 0)) carry.set(y, c);
    }
  }
  for (const [ri, c] of carry) {
    byRun.set(ri, { d: c, state: 'estimated', figure: true, raw: c, carried: true });
    touch(ri);
  }
  W.touched = trips;
  // move each trip's stops: a run with a delay of its own moves its remaining stops by it (shiftStops' rule); a run
  // the source says nothing about keeps the timetable, unless the same train comes into it late (a through train, the
  // next lap): then it leaves when the train is there and stays that late (never faster than the timetable)
  for (const t of trips) {
    const p = tPat[t], n = pStopOff[p + 1] - pStopOff[p], base = tTime[t];
    const s0 = tSegOff[t], s1 = tSegOff[t + 1];
    let k = s0, own = byRun.get(tSegRun[k]), carried = 0;
    for (let i = 0; i < n; i++) {
      const a = tt.tArr[base + i], d = tt.tDep[base + i];
      let start = false;
      while (k + 1 < s1 && tSegPos[k + 1] <= i) { k++; start = true; }
      // arrival: at the first stop of a later run it is the run before's (its rule), else this run's
      let A = a;
      if (!start) A = a + shiftOf(own, carried, d < INF ? d : a, cutoff);
      else A = a + shiftOf(own, carried, a, cutoff); // `own` / `carried` still describe the run before here
      if (start) { own = byRun.get(tSegRun[k]); carried = own ? 0 : Math.max(0, A - (d < INF ? d : a)); }
      tArr[base + i] = A;
      if (d < INF) {
        const D = d + shiftOf(own, carried, d, cutoff);
        tDep[base + i] = D < A ? A : D;   // never leaves before it is there
      }
    }
    // last resort (two figures of one train that disagree by seconds, odd timetable rows): times never run back
    let prev = -INF;
    for (let i = 0; i < n; i++) {
      if (tArr[base + i] < prev) tArr[base + i] = prev;
      prev = tArr[base + i];
      if (tDep[base + i] < INF) {
        if (tDep[base + i] < prev) tDep[base + i] = prev;
        prev = tDep[base + i];
      }
    }
  }
  // FIFO: only pairs with a moved trip can break; a broken pattern is split again
  const broken = new Set();
  const fifo = (a, b, n) => {
    const x = tTime[a], y = tTime[b];
    for (let i = 0; i < n; i++) if (tDep[x + i] > tDep[y + i] || tArr[x + i] > tArr[y + i]) return false;
    return true;
  };
  for (const t of trips) {
    const p = tPat[t];
    if (broken.has(p)) continue;
    const n = pStopOff[p + 1] - pStopOff[p];
    if ((t - 1 >= pTA[p] && !fifo(t - 1, t, n)) || (t + 1 < pTB[p] && !fifo(t, t + 1, n))) broken.add(p);
  }
  let out = { ...tt, tArr, tDep, base: tt, tOrig: null };
  if (broken.size) out = resplit(tt, out, broken);
  out.live = { byRun, sig: spec.sig, cutoff, gen: W.gen, trips: trips.length, split: broken.size, carried: carry.size,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10 };
  return out;
}

/** Seconds to add at a stop whose own time is x: the run's own delay while that stop is still ahead (x + d >= cutoff),
 *  else (no delay of its own) the lateness the train brought into this run. */
function shiftOf(own, carried, x, cutoff) {
  if (own) return own.d > 0 && x + own.d >= cutoff ? own.d : 0;
  return carried;
}

/** Split each broken pattern into FIFO sub-patterns: the first keeps the pattern's index, the others are appended;
 *  their trips are permuted inside the pattern's own slot of the trip arrays (no trip is copied or moved in time). */
function resplit(tt, out, broken) {
  const { tArr, tDep } = out;
  const P = tt.P, T = tt.T;
  const tTime = tt.tTime.slice(), tPat = tt.tPat.slice(), tOrig = new Int32Array(T);
  for (let t = 0; t < T; t++) tOrig[t] = t;
  const extra = []; // [pattern it copies, trip start, trip end]
  const pTA = tt.pTA.slice(), pTB = tt.pTB.slice();
  for (const p of broken) {
    const n = tt.pStopOff[p + 1] - tt.pStopOff[p], A = tt.pTA[p], B = tt.pTB[p];
    const list = [];
    for (let t = A; t < B; t++) list.push(t);
    const dep0 = (t) => tDep[tt.tTime[t]], arrN = (t) => tArr[tt.tTime[t] + n - 1];
    list.sort((a, b) => dep0(a) - dep0(b) || arrN(a) - arrN(b) || a - b);
    const subs = [];
    for (const t of list) {
      let home = null;
      for (const sub of subs) {
        const x = tt.tTime[sub[sub.length - 1]], y = tt.tTime[t];
        let ok = true;
        for (let i = 0; i < n && ok; i++) if (tDep[x + i] > tDep[y + i] || tArr[x + i] > tArr[y + i]) ok = false;
        if (ok) { home = sub; break; }
      }
      if (home) home.push(t); else subs.push([t]);
    }
    let at = A;
    subs.forEach((sub, j) => {
      const q = j === 0 ? p : P + extra.length;
      if (j > 0) extra.push([p, at, at + sub.length]);
      else { pTA[p] = at; pTB[p] = at + sub.length; }
      for (const t of sub) { tTime[at] = tt.tTime[t]; tPat[at] = q; tOrig[at] = t; at++; }
    });
  }
  const P2 = P + extra.length;
  let nStops = tt.pStopOff[P];
  for (const [p] of extra) nStops += tt.pStopOff[p + 1] - tt.pStopOff[p];
  const pStopOff = new Int32Array(P2 + 1), pStops = new Int32Array(nStops), pBnd = new Uint8Array(nStops), pX = new Uint8Array(P2);
  pStopOff.set(tt.pStopOff.subarray(0, P + 1)); pStops.set(tt.pStops.subarray(0, tt.pStopOff[P])); pBnd.set(tt.pBnd.subarray(0, tt.pStopOff[P]));
  pX.set(tt.pX.subarray(0, P));
  const pTA2 = new Int32Array(P2), pTB2 = new Int32Array(P2);
  pTA2.set(pTA); pTB2.set(pTB);
  let so = tt.pStopOff[P];
  extra.forEach(([p, a, b], j) => {
    const q = P + j, o = tt.pStopOff[p], n = tt.pStopOff[p + 1] - o;
    pStopOff[q] = so;
    pStops.set(tt.pStops.subarray(o, o + n), so); pBnd.set(tt.pBnd.subarray(o, o + n), so);
    so += n; pStopOff[q + 1] = so;
    pX[q] = tt.pX[p]; pTA2[q] = a; pTB2[q] = b;
  });
  // station -> (pattern, position) again, the new patterns included
  const nS = tt.sOff.length - 1;
  const cnt = new Int32Array(nS + 1);
  for (let i = 0; i < so; i++) cnt[pStops[i] + 1]++;
  for (let s = 0; s < nS; s++) cnt[s + 1] += cnt[s];
  const sOff = cnt, sPat = new Int32Array(so), sPos = new Int32Array(so), fill = sOff.slice(0, nS);
  for (let q = 0; q < P2; q++) for (let i = pStopOff[q]; i < pStopOff[q + 1]; i++) {
    const s = pStops[i];
    sPat[fill[s]] = q; sPos[fill[s]] = i - pStopOff[q]; fill[s]++;
  }
  return { ...out, P: P2, tTime, tPat, tOrig, pTA: pTA2, pTB: pTB2, pStopOff, pStops, pBnd, pX, sOff, sPat, sPos };
}
