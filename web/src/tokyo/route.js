// journey planner for the app, in the browser, on our own timetable packs (no server).
//
// Algorithm: RAPTOR, round-based public transit routing (Delling, Pajor, Werneck: "Round-Based Public Transit
// Routing", ALENEX 2012 / Transportation Science 2015). Round k finds the earliest arrival with exactly k trains;
// the rounds together give the Pareto set (arrival time x number of trains). Arrive-by runs the same rounds
// backwards (latest departure).
//
//   import { createPlanner } from './route.js';
//   const planner = createPlanner({ net, loadRuns });   // net = unpackNet(); loadRuns = tt.js loadRuns (or a stub)
//   const options = await planner.plan({ from, to, departSec, date });       // or { from, to, arriveSec, date }
//
// from / to: station index (expanded to its station complex, model.groups), station id string, { station },
//   { group }, { stations: [...] }, or { lng, lat } (walk from / to the stations within 800 m).
// departSec / arriveSec: seconds since 00:00 WIB of the service day `date` ('YYYY-MM-DD'); default now.
// options: up to 3, sorted by arrival: the Pareto set (fewest trains .. earliest arrival), filled up with the next
//   departures. Each option:
//   { dep, arr, dur, rides, transfers, walk (s), date, nextDay, best: ['fast','few'], legs: [leg...] }
//   leg = { kind: 'ride', line, lines: [{ line, from, to }], type, dir, run (run id), key, number, to (destination
//           station or -1: loop, see dir), from, board, alight, dep, arr, stops (stops ridden), via: [station...],
//           through: bool (stays on the train onto another line),
//           live: 'live' | 'estimated' | 'timetable', delay (s late at boarding), arrDelay (s late getting off),
//           sdep / sarr (the timetable's times), figure (false: a live position without a reported delay figure) }
//       | { kind: 'walk', from, to, sec, m, inside (true = change inside one station complex), origin?, dest? }
//   option.live = true when any of its trains runs on live or estimated times.
// LIVE TIMES: a depart-at search within [now - 5 min, now + 60 min] of the real
// clock ("Leave now" and the next hour) uses the delays the map has (model.delays: measured = 'live', live.js's carried
// estimates = 'estimated'); changes are checked on those times (a late first train can lose a change, a late next
// train can save one). Arrive-by, later departures and runs without live data stay on the timetable (rule 6: a leg
// says which). q.live = false forces the timetable.
//
// Data: Mini Tokyo 3D lines, stations and timetables (MIT, (c) Akihiko Kusanagi), packed by the network build / the timetable build.

import { calendarFor, calendarAt } from './calendar.js';
import { SUSPENDED } from './model.js';
import { readDelays, liveTimetable, LIVE } from './route-live.js';

export const RULES = {
  maxTransfers: 4,        // => at most 5 trains
  walkSpeed: 80 / 60,     // m/s (80 m a minute)
  walkMax: 400,           // m: walking links between station complexes
  walkBase: 180,          // s on top of a walk between complexes (out of one station, into the next)
  inside: 60,             // s on top of metres / walkSpeed for a change inside one complex
  changeSame: 60,         // s: change trains at the same station of the same line (often across the platform)
  change: 180,            // s: change lines inside a station complex
  changeBig: 300,         // s: ... in a big complex (>= bigLines lines: Tokyo, Shinjuku, Shibuya, Ikebukuro, Ueno...)
  bigLines: 6,
  accessMax: 800,         // m: from / to a map point, stations within this walk
  window: 4 * 3600,       // s of timetable searched after the departure (before the arrival for arrive-by)
  options: 3,
};
export const DAY = 86400;
export const TURN = 3 * 3600; // the service day turns over at 03:00 WIB
const INF = 0x3fffffff;

const D2R = Math.PI / 180;
/** Metres between two stations (equirectangular, as net.js segLen). */
export function metres(a, b) {
  if (a == null || b == null || a.lng == null || b.lng == null) return NaN;
  const k = Math.cos((a.lat + b.lat) * D2R / 2);
  const dx = (b.lng - a.lng) * k, dy = b.lat - a.lat;
  return Math.sqrt(dx * dx + dy * dy) * D2R * 6371008.8;
}

// ================================================================== network index (once per net)
/**
 * Footpaths: every pair of stations inside a complex (change time by complex size and distance) and every pair of
 * stations of different complexes within walkMax metres (walkBase + metres / walkSpeed). CSR arrays.
 */
export function buildNetIndex(net, rules = RULES) {
  const S = net.stations, nS = S.length, groups = net.groups || [];
  const groupOf = new Int32Array(nS).fill(-1);
  groups.forEach((g, gi) => { for (const s of g) if (s >= 0 && s < nS) groupOf[s] = gi; });
  for (let s = 0; s < nS; s++) if (groupOf[s] < 0 && S[s].group >= 0 && S[s].group < groups.length) groupOf[s] = S[s].group;
  const links = Array.from({ length: nS }, () => []);
  const passenger = (l) => !/Freight$/.test(net.lines[l]?.id || '');
  groups.forEach((mem) => {
    const lineSet = new Set(mem.map((s) => S[s].line).filter((l) => l >= 0 && passenger(l)));
    const minT = lineSet.size >= rules.bigLines ? rules.changeBig : rules.change;
    for (const a of mem) for (const b of mem) {
      if (a === b) continue;
      const m = metres(S[a], S[b]);
      const sec = Math.max(minT, Math.round(rules.inside + (Number.isFinite(m) ? m : 0) / rules.walkSpeed));
      links[a].push([b, sec, 1, Number.isFinite(m) ? Math.round(m) : 0]);
    }
  });
  // walking between complexes: grid of ~walkMax cells
  const cellLat = rules.walkMax / 111000, cellLng = cellLat / Math.cos(35.7 * D2R);
  const grid = new Map();
  const key = (x, y) => x * 100000 + y;
  for (let s = 0; s < nS; s++) {
    if (S[s].lng == null) continue;
    const k = key(Math.floor(S[s].lng / cellLng), Math.floor(S[s].lat / cellLat));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  for (let a = 0; a < nS; a++) {
    if (S[a].lng == null) continue;
    const cx = Math.floor(S[a].lng / cellLng), cy = Math.floor(S[a].lat / cellLat);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const b of grid.get(key(cx + dx, cy + dy)) || []) {
        if (b === a || (groupOf[a] >= 0 && groupOf[a] === groupOf[b])) continue;
        const m = metres(S[a], S[b]);
        if (!(m <= rules.walkMax)) continue;
        links[a].push([b, Math.round(rules.walkBase + m / rules.walkSpeed), 0, Math.round(m)]);
      }
    }
  }
  let n = 0;
  const lkStart = new Int32Array(nS + 1);
  for (let s = 0; s < nS; s++) { lkStart[s] = n; n += links[s].length; }
  lkStart[nS] = n;
  const lkTo = new Int32Array(n), lkDur = new Int32Array(n), lkInside = new Uint8Array(n), lkM = new Int32Array(n);
  for (let s = 0, i = 0; s < nS; s++) for (const [b, d, inside, m] of links[s]) { lkTo[i] = b; lkDur[i] = d; lkInside[i] = inside; lkM[i] = m; i++; }
  return { net, rules, nS, groupOf, lkStart, lkTo, lkDur, lkInside, lkM };
}

/** Link (footpath) a -> b: { sec, m, inside } or null. */
export function linkOf(nx, a, b) {
  for (let i = nx.lkStart[a]; i < nx.lkStart[a + 1]; i++) if (nx.lkTo[i] === b) return { sec: nx.lkDur[i], m: nx.lkM[i], inside: !!nx.lkInside[i] };
  return null;
}

// ================================================================== timetable index (once per loaded run set)
/**
 * Through-running: run B continues run A (A.next) on the same train. A continuation never reverses in MT3D data
 * (checked on the holiday set: 0 of 3,111), so every resolvable `next` is merged, except a guard for reversals.
 */
function reverses(S, A, B) {
  const p = A.stops[A.stops.length - 2]?.s, q = B.stops[1]?.s;
  if (p == null || q == null) return false;
  if (p === q) return true;
  return S[p].group >= 0 && S[p].group === S[q].group;
}

/**
 * Trips = chains of runs linked by `next` (through-running is one train, so riding on is not a transfer). Loop
 * lines (Yamanote) chain a lap with the next lap only, so trips stay short and share one stop pattern. Trips with
 * the same station sequence form a RAPTOR route ("pattern"), split further where a trip would overtake another.
 */
export function buildTimetable(nx, runs) {
  const it = buildSteps(nx, runs);
  let r;
  while (!(r = it.next()).done);
  return r.value;
}

/** The same build, giving the page back every ~8 ms (no long task on a phone: ~200 ms of work at 4x CPU). */
export async function buildTimetableAsync(nx, runs, budget = 8) {
  const it = buildSteps(nx, runs);
  let r, t = now();
  while (!(r = it.next()).done) if (now() - t > budget) { await yieldNow(); t = now(); }
  return r.value;
}
const yieldNow = () => new Promise((res) => {
  if (typeof MessageChannel === 'function') { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); res(); }; ch.port2.postMessage(0); } else setTimeout(res, 0);
});

function* buildSteps(nx, runs) {
  const net = nx.net, S = net.stations, L = net.lines, nS = nx.nS;
  const t0 = now();
  const idx = new Map();
  runs.forEach((r, i) => idx.set(r.id, i));
  const nexts = runs.map((r) => (r.next || []).map((id) => idx.get(id)).filter((j) => j !== undefined && !reverses(S, r, runs[j])));
  const fed = new Uint8Array(runs.length);
  nexts.forEach((ns) => { for (const j of ns) fed[j] = 1; });
  const isLoop = (i) => !!L[runs[i].line]?.loop;
  const chains = [];
  const expand = (i, chain, budget) => {
    const ns = budget > 0 ? nexts[i] : [];
    if (!ns.length) { chains.push(chain); return; }
    for (const j of ns) {
      if (chain.includes(j)) { chains.push(chain); continue; }
      expand(j, chain.concat(j), isLoop(j) ? 0 : budget - 1);
    }
  };
  for (let i = 0; i < runs.length; i++) {
    if (fed[i] && !isLoop(i)) continue;
    expand(i, [i], isLoop(i) ? 1 : 8);
  }
  // trips -> station sequence + times
  const T = net.types || [];
  const extra = (r) => (T[r.type]?.rank ?? 0) >= 4;
  const trips = [];
  yield;
  let tick = 0;
  for (const chain of chains) {
    if ((++tick & 255) === 0) yield;
    const st = [], ar = [], dp = [], seg = [], bnd = [];
    chain.forEach((ri, k) => {
      const r = runs[ri];
      r.stops.forEach((x, j) => {
        const a = x.a ?? x.d, d = x.d ?? x.a;
        if (a == null) return; // a stop without any time (none in MT3D data): skip it
        if (k > 0 && j === 0) {
          const last = st.length - 1;
          if (st[last] === x.s) { dp[last] = d; seg.push(ri, last); return; }
          // two stations of one complex (line A's, then line B's): get off at either, get on at B's only, else
          // "board at A's at the departure, alight at B's at the arrival" would travel back in time
          dp[last] = INF;
          seg.push(ri, st.length);
          bnd.push(st.length);
          st.push(x.s); ar.push(ar[last]); dp.push(d);
          return;
        }
        if (k === 0 && j === 0) seg.push(ri, 0);
        st.push(x.s); ar.push(a); dp.push(d);
      });
    });
    if (st.length < 2) continue;
    dp[st.length - 1] = INF; // never board at the last stop
    const x = chain.some((ri) => extra(runs[ri]));
    trips.push({ st, ar, dp, seg, bnd, x, key: (x ? 'x|' : '') + st.join(',') });
  }
  // patterns
  const byKey = new Map();
  yield;
  for (const tr of trips) {
    if ((++tick & 1023) === 0) yield;
    let list = byKey.get(tr.key);
    if (!list) { list = []; byKey.set(tr.key, list); }
    list.push(tr);
  }
  const pats = [];
  yield;
  for (const list of byKey.values()) {
    if ((++tick & 127) === 0) yield;
    list.sort((a, b) => a.dp[0] - b.dp[0] || a.ar[a.ar.length - 1] - b.ar[b.ar.length - 1]);
    const subs = [];
    for (const tr of list) {
      let home = null;
      for (const sub of subs) {
        const prev = sub[sub.length - 1];
        let ok = true;
        for (let i = 0; i < tr.st.length && ok; i++) if (prev.dp[i] > tr.dp[i] || prev.ar[i] > tr.ar[i]) ok = false;
        if (ok) { home = sub; break; }
      }
      if (home) home.push(tr); else subs.push([tr]);
    }
    for (const sub of subs) pats.push(sub);
  }
  // flatten
  const P = pats.length;
  let nStops = 0, nTrips = 0, nTimes = 0, nSeg = 0;
  for (const sub of pats) { nStops += sub[0].st.length; nTrips += sub.length; nTimes += sub.length * sub[0].st.length; for (const tr of sub) nSeg += tr.seg.length / 2; }
  const pStopOff = new Int32Array(P + 1), pTripOff = new Int32Array(P + 1), pStops = new Int32Array(nStops), pBnd = new Uint8Array(nStops);
  const pX = new Uint8Array(P);
  const tTime = new Int32Array(nTrips), tPat = new Int32Array(nTrips), tArr = new Int32Array(nTimes), tDep = new Int32Array(nTimes);
  const tSegOff = new Int32Array(nTrips + 1), tSegRun = new Int32Array(nSeg), tSegPos = new Int32Array(nSeg);
  const visits = new Int32Array(nS);
  let so = 0, to = 0, ti = 0, sg = 0;
  yield;
  for (let p = 0; p < P; p++) {
    const sub = pats[p];
    const n = sub[0].st.length;
    pStopOff[p] = so; pTripOff[p] = to;
    for (let i = 0; i < n; i++) {
      pStops[so + i] = sub[0].st[i];
      visits[sub[0].st[i]]++;
    }
    for (const pos of sub[0].bnd) pBnd[so + pos] = 1; // same train, the next line's station of the same complex
    pX[p] = sub[0].x ? 1 : 0;
    so += n;
    if ((++tick & 127) === 0) yield;
    for (const tr of sub) {
      tTime[to] = ti; tPat[to] = p; tSegOff[to] = sg;
      for (let i = 0; i < n; i++) { tArr[ti + i] = tr.ar[i]; tDep[ti + i] = tr.dp[i]; }
      for (let k = 0; k < tr.seg.length; k += 2) { tSegRun[sg] = tr.seg[k]; tSegPos[sg] = tr.seg[k + 1]; sg++; }
      ti += n; to++;
    }
  }
  pStopOff[P] = so; pTripOff[P] = to; tSegOff[nTrips] = sg;
  // run -> trips carrying it (CSR; the live overlay starts from the late runs)
  const R = runs.length, rtOff = new Int32Array(R + 1);
  for (let k = 0; k < sg; k++) rtOff[tSegRun[k] + 1]++;
  for (let r = 0; r < R; r++) rtOff[r + 1] += rtOff[r];
  const rtTrips = new Int32Array(sg), rtFill = rtOff.slice(0, R);
  for (let t = 0; t < nTrips; t++) for (let k = tSegOff[t]; k < tSegOff[t + 1]; k++) rtTrips[rtFill[tSegRun[k]]++] = t;
  yield;
  // station -> (pattern, position)
  const sOff = new Int32Array(nS + 1);
  for (let s = 0, k = 0; s < nS; s++) { sOff[s] = k; k += visits[s]; sOff[nS] = k; }
  const sPat = new Int32Array(sOff[nS]), sPos = new Int32Array(sOff[nS]), fill = sOff.slice(0, nS);
  for (let p = 0; p < P; p++) for (let i = pStopOff[p]; i < pStopOff[p + 1]; i++) {
    const s = pStops[i];
    sPat[fill[s]] = p; sPos[fill[s]] = i - pStopOff[p]; fill[s]++;
  }
  return {
    runs, P, T: nTrips, pStopOff, pTripOff, pStops, pBnd, pX, tTime, tPat, tArr, tDep, tSegOff, tSegRun, tSegPos, sOff, sPat, sPos,
    // pattern p's trips = [pTA[p], pTB[p]) (views on pTripOff here; a live overlay splits patterns and has its own)
    pTA: pTripOff.subarray(0, P), pTB: pTripOff.subarray(1, P + 1), runIdx: idx, rtOff, rtTrips,
    stats: { runs: runs.length, trips: nTrips, patterns: P, events: nTimes, ms: Math.round(now() - t0) },
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ================================================================== RAPTOR
/** Scratch arrays for nS stations and K rounds, reused across queries. */
function scratch(nS, K) {
  const per = () => Array.from({ length: K + 1 }, () => new Int32Array(nS));
  return {
    nS, K, arr: per(), ready: per(), rFrom: per(), rRound: per(), walkArr: per(), walkFrom: per(),
    trip: per(), bPos: per(), aPos: per(),
    best: new Int32Array(nS), mark: new Uint8Array(nS), imp: new Uint8Array(nS), pMin: null,
  };
}
const FROM_ORIGIN = -1, FROM_SAME = -2;

/**
 * Earliest-arrival RAPTOR from `origins` (Map station -> access s) at `dep`, to `targets` (Map station -> egress s).
 * Returns the Pareto journeys [{ rides, arr, legs }] (raw legs: ride {trip, bp, ap} / walk {from, to, sec}).
 */
export function raptor(nx, tt, sc, { origins, targets, dep, maxRides, extraFare = false }) {
  const K = Math.min(maxRides, sc.K), nS = nx.nS;
  const { arr, ready, rFrom, rRound, walkArr, walkFrom, trip, bPos, aPos, best, mark, imp } = sc;
  if (!sc.pMin || sc.pMin.length < tt.P) sc.pMin = new Int32Array(tt.P).fill(-1);
  const pMin = sc.pMin;
  for (let k = 0; k <= K; k++) { arr[k].fill(INF); walkArr[k].fill(INF); }
  ready[0].fill(INF); rFrom[0].fill(FROM_ORIGIN); rRound[0].fill(0);
  best.fill(INF);
  const { lkStart, lkTo, lkDur } = nx;
  const { pStopOff, pTA, pTB, pStops, pX, tTime, tArr, tDep, sOff, sPat, sPos } = tt;
  let marked = [];
  const isT = new Map(targets);
  // round 0: origins and a walk from them
  for (const [s, acc] of origins) {
    const v = dep + acc;
    if (v < ready[0][s]) { ready[0][s] = v; rFrom[0][s] = FROM_ORIGIN; }
  }
  for (const [s] of origins) {
    if (!mark[s]) { mark[s] = 1; marked.push(s); }
    for (let e = lkStart[s]; e < lkStart[s + 1]; e++) {
      const b = lkTo[e], w = ready[0][s] + lkDur[e];
      if (w < ready[0][b]) { ready[0][b] = w; rFrom[0][b] = s; walkArr[0][b] = w; walkFrom[0][b] = s; if (!mark[b]) { mark[b] = 1; marked.push(b); } }
    }
  }
  let bound = INF;
  const found = [];
  // a walk alone (origin complex next to the target complex)
  {
    let bt = -1, bv = INF;
    for (const [t, eg] of isT) if (walkArr[0][t] < INF && !origins.has(t) && walkArr[0][t] + eg < bv) { bv = walkArr[0][t] + eg; bt = t; }
    if (bt >= 0) { bound = bv; found.push({ rides: 0, arr: bv, t: bt, walk: true, k: 0 }); }
  }
  for (let k = 1; k <= K; k++) {
    for (const s of marked) mark[s] = 0;
    if (!marked.length) break;
    ready[k].set(ready[k - 1]); rFrom[k].set(rFrom[k - 1]); rRound[k].set(rRound[k - 1]);
    // routes through the marked stations, from their earliest marked position
    const pats = [];
    for (const s of marked) for (let e = sOff[s]; e < sOff[s + 1]; e++) {
      const p = sPat[e], pos = sPos[e];
      if (!extraFare && pX[p]) continue;
      if (pMin[p] < 0) { pMin[p] = pos; pats.push(p); } else if (pos < pMin[p]) pMin[p] = pos;
    }
    marked = [];
    const improved = [];
    const prevReady = ready[k - 1], arrK = arr[k], tripK = trip[k], bPosK = bPos[k], aPosK = aPos[k];
    for (const p of pats) {
      const off = pStopOff[p], n = pStopOff[p + 1] - off, tA = pTA[p], tB = pTB[p];
      let cur = -1, base = 0, bp = -1;
      for (let i = pMin[p]; i < n; i++) {
        const s = pStops[off + i];
        if (cur >= 0) {
          const a = tArr[base + i];
          if (a < best[s] && a < bound) {
            arrK[s] = a; best[s] = a; tripK[s] = cur; bPosK[s] = bp; aPosK[s] = i;
            if (!imp[s]) { imp[s] = 1; improved.push(s); }
            const eg = isT.get(s);
            if (eg !== undefined && a + eg < bound) bound = a + eg;
          }
        }
        const rd = prevReady[s];
        if (rd < INF && (cur < 0 || rd <= tDep[base + i])) {
          // earliest trip of this route leaving position i at or after rd (trips are FIFO within a pattern)
          let lo = tA, hi = cur < 0 ? tB : cur + 1;
          while (lo < hi) { const m = (lo + hi) >> 1; if (tDep[tTime[m] + i] >= rd) hi = m; else lo = m + 1; }
          if (lo < (cur < 0 ? tB : cur + 1) && tDep[tTime[lo] + i] < INF && lo !== cur) { cur = lo; base = tTime[lo]; bp = i; }
        }
      }
      pMin[p] = -1;
    }
    // changes and walks after this round's trains
    const readyK = ready[k], rFromK = rFrom[k], rRoundK = rRound[k], walkK = walkArr[k], walkFK = walkFrom[k];
    for (const s of improved) {
      imp[s] = 0;
      const a = arrK[s];
      const c = a + nx.rules.changeSame;
      if (c < readyK[s]) { readyK[s] = c; rFromK[s] = FROM_SAME; rRoundK[s] = k; if (!mark[s]) { mark[s] = 1; marked.push(s); } }
      for (let e = lkStart[s]; e < lkStart[s + 1]; e++) {
        const b = lkTo[e], w = a + lkDur[e];
        if (w < walkK[b]) { walkK[b] = w; walkFK[b] = s; }
        if (w < readyK[b]) { readyK[b] = w; rFromK[b] = s; rRoundK[b] = k; if (!mark[b]) { mark[b] = 1; marked.push(b); } }
      }
    }
    // the target this round
    let bt = -1, bv = INF, viaWalk = false;
    for (const [t, eg] of isT) {
      if (arrK[t] < INF && arrK[t] + eg < bv) { bv = arrK[t] + eg; bt = t; viaWalk = false; }
      if (walkK[t] < INF && !isT.has(walkFK[t]) && walkK[t] + eg < bv) { bv = walkK[t] + eg; bt = t; viaWalk = true; }
    }
    const prev = found.length ? found[found.length - 1].arr : INF;
    if (bt >= 0 && bv < prev) { found.push({ rides: k, arr: bv, t: bt, walk: viaWalk, k }); if (bv < bound) bound = bv; }
  }
  for (const s of marked) mark[s] = 0;
  return found.map((f) => ({ rides: f.rides, arr: f.arr, legs: trace(nx, tt, sc, f, origins, targets, dep) }));
}

function trace(nx, tt, sc, f, origins, targets, dep) {
  const { arr, rFrom, rRound, walkArr, walkFrom, trip, bPos, aPos, ready } = sc;
  const legs = [];
  let s = f.t, k = f.k;
  const eg = targets.get(f.t) || 0;
  if (eg) legs.push({ kind: 'walk', from: f.t, to: -1, sec: eg, dest: true });
  if (f.walk) {
    const from = walkFrom[k][s];
    legs.push({ kind: 'walk', from, to: s, sec: walkArr[k][s] - (k === 0 ? ready[0][from] : arr[k][from]) });
    s = from;
  }
  if (k === 0) {
    const acc = origins.get(s) || 0;
    if (acc) legs.push({ kind: 'walk', from: -1, to: s, sec: acc, origin: true });
    return legs.reverse();
  }
  let guard = 0;
  while (k > 0 && guard++ < 16) {
    const tr = trip[k][s], bp = bPos[k][s], ap = aPos[k][s];
    legs.push({ kind: 'ride', trip: tr, bp, ap });
    const bs = tt.pStops[tt.pStopOff[tt.tPat[tr]] + bp];
    const rr = rRound[k - 1][bs], from = rFrom[k - 1][bs];
    if (rr === 0) {
      if (from >= 0) {
        legs.push({ kind: 'walk', from, to: bs, sec: ready[0][bs] - ready[0][from] });
        s = from;
      } else s = bs;
      const acc = origins.get(s) || 0;
      if (acc) legs.push({ kind: 'walk', from: -1, to: s, sec: acc, origin: true });
      break;
    }
    if (from === FROM_SAME) { legs.push({ kind: 'walk', from: bs, to: bs, sec: nx.rules.changeSame, same: true }); s = bs; }
    else { legs.push({ kind: 'walk', from, to: bs, sec: ready[k - 1][bs] - arr[rr][from] }); s = from; }
    k = rr;
  }
  return legs.reverse();
}

// ------------------------------------------------------------------ arrive-by: the same rounds, backwards
/**
 * Latest-departure RAPTOR: from `targets` (Map station -> egress s) at `arrBy` back to `origins` (Map station ->
 * access s). Round k = latest departure with exactly k trains. Returns [{ rides, dep, legs }] with legs in travel order.
 */
export function raptorBack(nx, tt, sc, { origins, targets, arrBy, maxRides, extraFare = false }) {
  const K = Math.min(maxRides, sc.K);
  const { arr: depL, ready, rFrom, rRound, walkArr, walkFrom, trip, bPos, aPos, best, mark, imp } = sc;
  if (!sc.pMax || sc.pMax.length < tt.P) sc.pMax = new Int32Array(tt.P).fill(-1);
  const pMax = sc.pMax;
  const NEG = -INF;
  for (let k = 0; k <= K; k++) { depL[k].fill(NEG); walkArr[k].fill(NEG); }
  ready[0].fill(NEG); rFrom[0].fill(FROM_ORIGIN); rRound[0].fill(0);
  best.fill(NEG);
  const { lkStart, lkTo, lkDur } = nx; // footpaths are symmetric (built both ways)
  const { pStopOff, pTA, pTB, pStops, pX, tTime, tArr, tDep, sOff, sPat, sPos } = tt;
  let marked = [];
  const isO = new Map(origins);
  for (const [s, eg] of targets) { const v = arrBy - eg; if (v > ready[0][s]) { ready[0][s] = v; rFrom[0][s] = FROM_ORIGIN; } }
  for (const [s] of targets) {
    if (!mark[s]) { mark[s] = 1; marked.push(s); }
    for (let e = lkStart[s]; e < lkStart[s + 1]; e++) {
      const b = lkTo[e], w = ready[0][s] - lkDur[e];
      if (w > ready[0][b]) { ready[0][b] = w; rFrom[0][b] = s; walkArr[0][b] = w; walkFrom[0][b] = s; if (!mark[b]) { mark[b] = 1; marked.push(b); } }
    }
  }
  let bound = NEG;
  const found = [];
  {
    let bo = -1, bv = NEG;
    for (const [o, acc] of isO) if (walkArr[0][o] > NEG && !targets.has(o) && walkArr[0][o] - acc > bv) { bv = walkArr[0][o] - acc; bo = o; }
    if (bo >= 0) { bound = bv; found.push({ rides: 0, dep: bv, o: bo, walk: true, k: 0 }); }
  }
  for (let k = 1; k <= K; k++) {
    for (const s of marked) mark[s] = 0;
    if (!marked.length) break;
    ready[k].set(ready[k - 1]); rFrom[k].set(rFrom[k - 1]); rRound[k].set(rRound[k - 1]);
    const pats = [];
    for (const s of marked) for (let e = sOff[s]; e < sOff[s + 1]; e++) {
      const p = sPat[e], pos = sPos[e];
      if (!extraFare && pX[p]) continue;
      if (pMax[p] < 0) { pMax[p] = pos; pats.push(p); } else if (pos > pMax[p]) pMax[p] = pos;
    }
    marked = [];
    const improved = [];
    const prevReady = ready[k - 1], depK = depL[k], tripK = trip[k], bPosK = bPos[k], aPosK = aPos[k];
    for (const p of pats) {
      const off = pStopOff[p], tA = pTA[p], tB = pTB[p];
      let cur = -1, base = 0, ap = -1;
      for (let i = pMax[p]; i >= 0; i--) {
        const s = pStops[off + i];
        if (cur >= 0) {
          const d = tDep[base + i];
          if (d < INF && d > best[s] && d > bound) {
            depK[s] = d; best[s] = d; tripK[s] = cur; bPosK[s] = i; aPosK[s] = ap;
            if (!imp[s]) { imp[s] = 1; improved.push(s); }
            const acc = isO.get(s);
            if (acc !== undefined && d - acc > bound) bound = d - acc;
          }
        }
        const rd = prevReady[s];
        if (rd > NEG && i > 0 && (cur < 0 || rd >= tArr[base + i])) {
          // latest trip arriving at position i at or before rd
          let lo = cur < 0 ? tA : cur, hi = tB;
          while (lo < hi) { const m = (lo + hi) >> 1; if (tArr[tTime[m] + i] <= rd) lo = m + 1; else hi = m; }
          const t = lo - 1;
          if (t >= (cur < 0 ? tA : cur) && t !== cur) { cur = t; base = tTime[t]; ap = i; }
        }
      }
      pMax[p] = -1;
    }
    const readyK = ready[k], rFromK = rFrom[k], rRoundK = rRound[k], walkK = walkArr[k], walkFK = walkFrom[k];
    for (const s of improved) {
      imp[s] = 0;
      const d = depK[s];
      const c = d - nx.rules.changeSame;
      if (c > readyK[s]) { readyK[s] = c; rFromK[s] = FROM_SAME; rRoundK[s] = k; if (!mark[s]) { mark[s] = 1; marked.push(s); } }
      for (let e = lkStart[s]; e < lkStart[s + 1]; e++) {
        const b = lkTo[e], w = d - lkDur[e];
        if (w > walkK[b]) { walkK[b] = w; walkFK[b] = s; }
        if (w > readyK[b]) { readyK[b] = w; rFromK[b] = s; rRoundK[b] = k; if (!mark[b]) { mark[b] = 1; marked.push(b); } }
      }
    }
    let bo = -1, bv = NEG, viaWalk = false;
    for (const [o, acc] of isO) {
      if (depK[o] > NEG && depK[o] - acc > bv) { bv = depK[o] - acc; bo = o; viaWalk = false; }
      if (walkK[o] > NEG && !isO.has(walkFK[o]) && walkK[o] - acc > bv) { bv = walkK[o] - acc; bo = o; viaWalk = true; }
    }
    const prev = found.length ? found[found.length - 1].dep : NEG;
    if (bo >= 0 && bv > prev) { found.push({ rides: k, dep: bv, o: bo, walk: viaWalk, k }); if (bv > bound) bound = bv; }
  }
  for (const s of marked) mark[s] = 0;
  return found.map((f) => ({ rides: f.rides, dep: f.dep, legs: traceBack(nx, tt, sc, f, origins, targets) }));
}

function traceBack(nx, tt, sc, f, origins, targets) {
  const { arr: depL, rFrom, rRound, walkArr, walkFrom, trip, bPos, aPos, ready } = sc;
  const legs = [];
  let s = f.o, k = f.k;
  const acc = origins.get(f.o) || 0;
  if (acc) legs.push({ kind: 'walk', from: -1, to: f.o, sec: acc, origin: true });
  if (f.walk) {
    const to = walkFrom[k][s];
    legs.push({ kind: 'walk', from: s, to, sec: (k === 0 ? ready[0][to] : depL[k][to]) - walkArr[k][s] });
    s = to;
  }
  if (k === 0) {
    const eg = targets.get(s) || 0;
    if (eg) legs.push({ kind: 'walk', from: s, to: -1, sec: eg, dest: true });
    return legs;
  }
  let guard = 0;
  while (k > 0 && guard++ < 16) {
    const tr = trip[k][s], bp = bPos[k][s], ap = aPos[k][s];
    legs.push({ kind: 'ride', trip: tr, bp, ap });
    const as = tt.pStops[tt.pStopOff[tt.tPat[tr]] + ap];
    const rr = rRound[k - 1][as], to = rFrom[k - 1][as];
    if (rr === 0) {
      if (to >= 0) { legs.push({ kind: 'walk', from: as, to, sec: ready[0][to] - ready[0][as] }); s = to; } else s = as;
      const eg = targets.get(s) || 0;
      if (eg) legs.push({ kind: 'walk', from: s, to: -1, sec: eg, dest: true });
      break;
    }
    if (to === FROM_SAME) { legs.push({ kind: 'walk', from: as, to: as, sec: nx.rules.changeSame, same: true }); s = as; }
    else { legs.push({ kind: 'walk', from: as, to, sec: depL[rr][to] - ready[k - 1][as] }); s = to; }
    k = rr;
  }
  return legs;
}

// ================================================================== journeys -> options
const tdep = (tt, tr, i) => tt.tDep[tt.tTime[tr] + i];
const tarr = (tt, tr, i) => tt.tArr[tt.tTime[tr] + i];

/** Wait less: move each train but the last to the latest trip of its route that still makes the next connection. */
function squeeze(tt, legs) {
  let next = Infinity; // latest time we may reach the end of the current leg
  for (let i = legs.length - 1; i >= 0; i--) {
    const l = legs[i];
    if (l.kind === 'walk') { next -= l.sec; continue; }
    const p = tt.tPat[l.trip], tB = tt.pTB[p];
    if (Number.isFinite(next)) {
      let t = l.trip;
      while (t + 1 < tB && tarr(tt, t + 1, l.ap) <= next) t++;
      l.trip = t;
    }
    next = tdep(tt, l.trip, l.bp);
  }
  return legs;
}
/** Arrive-by: leave each leg after the first as early as the previous one allows (no waiting at the end). */
function squeezeFwd(tt, legs) {
  let ready = -Infinity;
  for (const l of legs) {
    if (l.kind === 'walk') { ready += l.sec; continue; }
    if (Number.isFinite(ready)) {
      const p = tt.tPat[l.trip], tA = tt.pTA[p];
      let t = l.trip;
      while (t - 1 >= tA && tdep(tt, t - 1, l.bp) >= ready) t--;
      l.trip = t;
    }
    ready = tarr(tt, l.trip, l.ap);
  }
  return legs;
}

/** Raw journey -> option (see the header for the shape). */
function describe(nx, tt, j, dep0) {
  const S = nx.net.stations;
  const legs = [];
  for (const l of j.legs) {
    if (l.kind === 'walk') {
      const lk = l.from >= 0 && l.to >= 0 && l.from !== l.to ? linkOf(nx, l.from, l.to) : null;
      legs.push({ kind: 'walk', from: l.from, to: l.to, sec: l.sec, m: lk ? lk.m : 0, inside: l.same ? true : lk ? lk.inside : false, same: !!l.same, origin: !!l.origin, dest: !!l.dest });
      continue;
    }
    const p = tt.tPat[l.trip], off = tt.pStopOff[p];
    const ot = tt.tOrig ? tt.tOrig[l.trip] : l.trip; // a live overlay may have moved the trip inside its pattern
    const segs = [];
    for (let k = tt.tSegOff[ot]; k < tt.tSegOff[ot + 1]; k++) segs.push([tt.tSegRun[k], tt.tSegPos[k]]);
    // runs with at least one hop inside [bp, ap] (the hand-over hop between two lines' stations belongs to none)
    const used = [];
    const n = tt.pStopOff[p + 1] - off;
    for (let k = 0; k < segs.length; k++) {
      const start = segs[k][1];
      const lastPos = k + 1 < segs.length ? (tt.pBnd[off + segs[k + 1][1]] ? segs[k + 1][1] - 1 : segs[k + 1][1]) : n - 1;
      if (Math.max(l.bp, start) < Math.min(l.ap, lastPos)) used.push(segs[k][0]);
    }
    if (!used.length) used.push(segs[0][0]);
    const run0 = tt.runs[used[0]], runN = tt.runs[used[used.length - 1]];
    const via = [];
    let stops = 0;
    for (let i = l.bp; i <= l.ap; i++) {
      const s = tt.pStops[off + i];
      if (i > l.bp && !tt.pBnd[off + i]) stops++;
      via.push(s);
    }
    const lines = [];
    for (const s of via) {
      const li = S[s].line;
      if (!lines.length || lines[lines.length - 1].line !== li) lines.push({ line: li, from: s, to: s });
      else lines[lines.length - 1].to = s;
    }
    const dep = tdep(tt, l.trip, l.bp), arr = tarr(tt, l.trip, l.ap);
    // live marker: the run you board decides (its stops are the ones that moved); timetable times next to the live ones
    const B = tt.base || tt, x = tt.live ? tt.live.byRun.get(used[0]) : null;
    const sdep = B.tDep[tt.tTime[l.trip] + l.bp], sarr = B.tArr[tt.tTime[l.trip] + l.ap];
    const moved = dep !== sdep || arr !== sarr;
    legs.push({
      kind: 'ride', line: run0.line, lines, type: run0.type, dir: run0.dir, run: run0.id, key: run0.key, number: run0.number,
      to: headsign(tt, runN), from: run0.from?.[0] ?? -1, board: via[0], alight: via[via.length - 1],
      dep, arr, stops, via, through: lines.length > 1,
      types: used.map((ri) => tt.runs[ri].type), runs: used.map((ri) => tt.runs[ri].id), trip: l.trip, bp: l.bp, ap: l.ap,
      extraFare: !!tt.pX[p],
      // a run without its own figure whose times moved anyway took the lateness of the run before it (same train)
      live: x ? x.state : moved ? 'estimated' : 'timetable', delay: dep - sdep, arrDelay: arr - sarr, sdep, sarr,
      figure: x ? x.figure : true,
    });
  }
  // times: walks before the first train end when it leaves, walks after a train start when it arrives
  const rides = legs.filter((l) => l.kind === 'ride');
  let t = rides.length ? rides[0].dep : dep0;
  const firstRide = legs.indexOf(rides[0]);
  for (let i = firstRide - 1; i >= 0; i--) { legs[i].arr = t; t -= legs[i].sec; legs[i].dep = t; }
  const depart = rides.length ? t : dep0;
  let cur = rides.length ? null : dep0;
  for (const l of legs) {
    if (l.kind === 'ride') { cur = l.arr; continue; }
    if (cur === null) continue;
    l.dep = cur; l.arr = cur + l.sec; cur = l.arr;
  }
  const last = legs[legs.length - 1];
  const arrive = last ? (last.kind === 'ride' ? last.arr : last.arr) : dep0;
  const walk = legs.reduce((a, l) => a + (l.kind === 'walk' && !l.same ? l.sec : 0), 0);
  return {
    dep: depart, arr: arrive, dur: arrive - depart, rides: rides.length, transfers: Math.max(0, rides.length - 1), walk, legs,
    sig: rides.map((r) => `${r.run}@${r.board}>${r.alight}`).join('|') || 'walk',
    live: rides.some((r) => r.live !== 'timetable'),
  };
}

/** Where the train is going: MT3D gives each run the train's final destination (through-running included); loop
 *  runs have none (-1: show the direction, e.g. Inner Loop). */
function headsign(tt, run) {
  if (run.to?.length && run.to[0] >= 0) return run.to[0];
  return -1;
}

// ================================================================== places
/** from / to -> Map station -> access (or egress) seconds. */
export function resolvePlace(nx, place) {
  const S = nx.net.stations, out = new Map();
  const addGroup = (s) => {
    const g = nx.groupOf[s];
    if (g >= 0) for (const m of nx.net.groups[g]) out.set(m, 0);
    else out.set(s, 0);
  };
  if (place == null) return out;
  if (typeof place === 'number') { if (S[place]) addGroup(place); return out; }
  if (typeof place === 'string') {
    const s = S.findIndex((x) => x.id === place);
    if (s >= 0) addGroup(s);
    return out;
  }
  if (Array.isArray(place)) { for (const s of place) if (S[s]) out.set(s, 0); return out; }
  if (place.stations) { for (const s of place.stations) if (S[s]) out.set(s, 0); return out; }
  if (place.group != null && place.group >= 0) { for (const s of nx.net.groups[place.group] || []) out.set(s, 0); return out; }
  if (place.station != null) return resolvePlace(nx, place.station);
  if (place.lng != null && place.lat != null) {
    const p = { lng: place.lng, lat: place.lat };
    for (let s = 0; s < S.length; s++) {
      const m = metres(p, S[s]) * 1.25; // streets are not straight
      if (m <= nx.rules.accessMax) out.set(s, Math.round(60 + m / nx.rules.walkSpeed));
    }
  }
  return out;
}

// ================================================================== planner
/**
 * @param {object} o
 * @param {object} o.net       unpacked network (net.js unpackNet) or the model.js fixture model
 * @param {Function} o.loadRuns  tt.js loadRuns({ cal, fromSec, toSec }) -> Promise<runs[]> (or any stub)
 * @param {Function} [o.calendar=calendarFor]  'YYYY-MM-DD' -> calendar list for loadRuns
 * @param {object} [o.rules]   overrides of RULES
 * @param {object|Function} [o.live=net]  the delay source (or () => source): { delays: Map(run -> s), measured?: Set,
 *   derived?: Set, _off?: Map } = the model.js model live.js keeps them on (the page's ctx.model). null = timetable only.
 * @param {Function} [o.now=Date.now]  the REAL clock (ms) the live window is measured from (never the playback clock)
 * @param {object[]} [o.suspended=SUSPENDED]  model.js's table of lines out of service (trains stopped, replacement
 *   buses): on the days it covers, their runs never enter the index, so no plan boards them (as no map draws them)
 */
export function createPlanner({ net, loadRuns, calendar = calendarFor, rules = {}, live = net, now: clockNow = () => Date.now(),
  suspended = SUSPENDED } = {}) {
  const R = { ...RULES, ...rules };
  const nx = buildNetIndex(net, R);
  const sc = scratch(nx.nS, Math.max(R.maxTransfers + 1, 13));
  const cache = new Map(); // window key -> Promise<tt>
  let last = null;
  const lvs = new Map(); // timetable index -> its live overlay { sig, cutoff, out } (this hour + the next: warm() does both)
  let lastLive = null;   // the overlay the last live search used
  const span = Math.ceil(R.window / 3600) + 1; // hours loaded: any time in the first hour still sees `window` ahead
  const lineIx = new Map((net.lines || []).map((l, i) => [l.id, i]));
  /** Line indexes out of service on service day `date` (model.js suspendedLines' rule: since / until bound an entry). */
  function offLines(date) {
    const out = new Set();
    for (const e of suspended || []) {
      if ((e.since && date < e.since) || (e.until && date > e.until)) continue;
      for (const id of e.lines || []) if (lineIx.has(id)) out.add(lineIx.get(id));
    }
    return out;
  }

  /** The timetable index for whole hours [h0, h0 + span h) of a service day (shared by every query in that hour). */
  function timetable(date, h0) {
    const cals = calendar(date);
    const key = `${date}|${[].concat(cals).join('+')}|${h0}`;
    if (!cache.has(key)) {
      const off = offLines(date);
      const p = Promise.resolve(loadRuns({ cal: cals, fromSec: h0, toSec: h0 + span * 3600, date }))
        .then((runs) => {
          const list = Array.isArray(runs) ? runs : runs?.runs || [];
          return buildTimetableAsync(nx, off.size ? list.filter((r) => !off.has(r.line)) : list);
        });
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      while (cache.size > 3) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  }
  const hourOf = (sec) => Math.floor(sec / 3600) * 3600;

  const uniq = (opts) => { const seen = new Set(); return opts.filter((o) => !seen.has(o.sig) && seen.add(o.sig)); };
  /** Keep what nothing else beats on every count (leaves later or same, arrives earlier or same, fewer trains). */
  const front = (opts) => opts.filter((o) => !opts.some((k) => k !== o && k.dep >= o.dep && k.arr <= o.arr && k.rides <= o.rides
    && (k.dep > o.dep || k.arr < o.arr || k.rides < o.rides)));

  /**
   * One query. q = { from, to, departSec | arriveSec, date, extraFare?: false (limited express / liner trains that
   * need a supplement ticket), maxTransfers?: 4, options?: 3 }.
   * @returns {Promise<object[]>} options (see the header); planner.last = { ms, query, tt stats, ... }
   */
  async function plan(q = {}) {
    const t0 = now();
    const date = q.date;
    if (!date) throw new Error('route: plan needs date (service date YYYY-MM-DD)');
    const origins = q.origins || resolvePlace(nx, q.from), targets = q.targets || resolvePlace(nx, q.to);
    const maxRides = (q.maxTransfers ?? R.maxTransfers) + 1;
    const n = q.options || R.options;
    const extraFare = !!q.extraFare;
    if (!origins.size || !targets.size) { last = { ms: 0, error: 'place' }; return []; }
    for (const s of origins.keys()) if (targets.has(s) && !origins.get(s) && !targets.get(s)) { last = { ms: 0, error: 'same' }; return []; }
    const back = q.arriveSec != null;
    const sec = back ? q.arriveSec : q.departSec;
    const base = await timetable(date, back ? hourOf(sec) + 3600 - span * 3600 : hourOf(sec));
    const tq = now();
    const tt = back ? base : liveFor(base, q, date, sec) || base;
    const run = back
      ? (by) => raptorBack(nx, tt, sc, { origins, targets, arrBy: by, maxRides, extraFare }).map((j) => describe(nx, tt, { ...j, legs: squeezeFwd(tt, j.legs) }, j.dep))
      : (at) => raptor(nx, tt, sc, { origins, targets, dep: at, maxRides, extraFare }).map((j) => describe(nx, tt, { ...j, legs: squeeze(tt, j.legs) }, at));
    const order = back ? (a, b) => b.dep - a.dep || a.rides - b.rides : (a, b) => a.arr - b.arr || a.rides - b.rides || b.dep - a.dep;
    // the Pareto set (arrival x trains) for this time: always kept (earliest arrival, fewest changes) ...
    const core = front(uniq(run(sec))).sort(order).slice(0, n);
    // ... then the next departures (arrive-by: the trains before) fill the free places, with at most one change more
    // than the best way needs
    let opts = core.slice();
    if (core.length && core.length < n) {
      const bestRides = core[0].rides;
      let extra = [];
      let at = back ? Math.min(...core.map((o) => o.arr)) - 60 : Math.min(...core.map((o) => o.dep)) + 60;
      for (let tries = 0; tries < 4 && core.length + extra.length < n; tries++) {
        const more = run(at).filter((o) => o.rides <= bestRides + 1);
        if (!more.length) break;
        extra = front(uniq(core.concat(extra, more))).filter((o) => !core.includes(o));
        at = back ? Math.min(...more.map((o) => o.arr)) - 60 : Math.min(...more.map((o) => o.dep)) + 60;
      }
      opts = core.concat(extra.sort(order).slice(0, n - core.length));
    }
    opts.sort(order);
    if (!opts.length && !back && q.nextDay !== false && sec >= 20 * 3600) {
      // the last trains have gone: the first trains of the next service day
      const more = await plan({ ...q, date: addDays(date, 1), departSec: Math.max(TURN, sec - DAY), nextDay: false, origins, targets });
      if (last) last.ms = Math.round(now() - t0);
      return more.map((o) => ({ ...o, nextDay: true }));
    }
    mark(opts, back);
    const lx = tt.live ? { runs: tt.live.byRun.size - tt.live.carried, carried: tt.live.carried, trips: tt.live.trips, split: tt.live.split, ms: tt.live.ms } : null;
    last = { ms: Math.round(now() - t0), query: Math.round(now() - tq), tt: tt.stats, date, [back ? 'arriveSec' : 'departSec']: sec, live: lx };
    return opts.map((o) => ({ ...o, date, nextDay: false }));
  }

  /**
   * The live overlay of `tt` for a depart-at search at `sec` of `date`, or null (the timetable): only within
   * [now - LIVE.behind, now + LIVE.ahead] of the real clock on today's service day, only when the source has delays
   * for runs of this index. One overlay is kept (same index, same delays, same minute = the same overlay).
   */
  function liveFor(tt, q, date, sec) {
    if (q.live === false) return null;
    const src = q.live && typeof q.live === 'object' ? q.live : typeof live === 'function' ? live() : live;
    if (!src?.delays?.size || (src.date && src.date !== date) || !Number.isFinite(sec)) return null;
    const c = calendarAt(q.nowMs ?? clockNow());
    if (c.date !== date || sec < c.sec - LIVE.behind || sec > c.sec + LIVE.ahead) return null;
    const spec = readDelays(src, tt);
    if (!spec) return null;
    const cutoff = Math.floor((c.sec - LIVE.behind) / 60) * 60;
    const hit = lvs.get(tt);
    if (hit && hit.sig === spec.sig && hit.cutoff === cutoff && hit.out.live.gen === tt._lw?.gen) return (lastLive = hit.out);
    const out = liveTimetable(tt, spec, cutoff);
    lvs.delete(tt); lvs.set(tt, { sig: spec.sig, cutoff, out });
    while (lvs.size > 2) lvs.delete(lvs.keys().next().value);
    return (lastLive = out);
  }

  return {
    plan, nx, rules: R,
    get last() { return last; },
    /** The live overlay the last live search used (tests, QA): an index like warm()'s + { base, live }, or null. */
    get overlay() { return lastLive; },
    /** Build (or reuse) the timetable index for the hour of `sec` ahead of time (the view calls this on open); with live
     *  delays for that time, the live overlay too, so the first search does not pay for it. Resolves to the index. */
    warm: (date, sec) => timetable(date, hourOf(sec)).then((tt) => {
      try { liveFor(tt, {}, date, sec); } catch (e) { /* the search will say it */ }
      return tt;
    }),
    resolve: (place) => resolvePlace(nx, place),
  };
}

function mark(opts, back = false) {
  for (const o of opts) o.best = [];
  if (opts.length < 2) return;
  // 'fast': the one best option (earliest arrival; arrive-by: shortest trip); 'few': the earliest of those with the
  // fewest trains, only when that is a real trade-off (fewer changes than the fastest one)
  const score = (o) => (back ? o.dur : o.arr);
  const fast = opts.reduce((a, o) => (score(o) < score(a) ? o : a));
  if (opts.some((o) => score(o) !== score(fast))) fast.best.push('fast');
  const minRides = Math.min(...opts.map((o) => o.rides));
  if (minRides < fast.rides) {
    const few = opts.filter((o) => o.rides === minRides).reduce((a, o) => (score(o) < score(a) ? o : a));
    few.best.push('few');
  }
}

/** 'YYYY-MM-DD' + n days. */
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ================================================================== map highlight geometry
/** [chain metres...] where station s sits on its own line (two values for the loop's first/last station). */
function chainsOf(net, s) {
  const st = net.stations[s], line = net.lines[st?.line];
  if (!line) return [];
  const out = [];
  line.stations.forEach((x, i) => { if (x === s && line.chain?.[i] != null) out.push(line.chain[i]); });
  return out;
}
const cumOf = (line) => {
  if (line._cum) return line._cum;
  const p = line.path, c = new Float64Array(p.length);
  for (let i = 1; i < p.length; i++) c[i] = c[i - 1] + metres({ lng: p[i - 1][0], lat: p[i - 1][1] }, { lng: p[i][0], lat: p[i][1] });
  Object.defineProperty(line, '_cum', { value: c, enumerable: false });
  return c;
};
/** Path of `line` between metres m0 and m1 (either order), as [[lng, lat]...]. */
export function slicePath(line, m0, m1) {
  const p = line.path, c = cumOf(line), out = [];
  if (!p?.length) return out;
  const lo = Math.min(m0, m1), hi = Math.max(m0, m1);
  const at = (m) => {
    let i = 1;
    while (i < c.length - 1 && c[i] < m) i++;
    const span = c[i] - c[i - 1], t = span > 0 ? Math.min(1, Math.max(0, (m - c[i - 1]) / span)) : 0;
    return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t];
  };
  out.push(at(lo));
  for (let i = 0; i < c.length; i++) if (c[i] > lo && c[i] < hi) out.push(p[i]);
  out.push(at(hi));
  return m0 <= m1 ? out : out.reverse();
}

/**
 * GeoJSON of an option for the map: rides along their tracks (line colour), walks as straight dashes, and the
 * stations where you board / change / get off. properties: { kind: 'ride'|'walk'|'stop', color, line, role }.
 */
export function routeGeoJSON(net, option) {
  const S = net.stations, feats = [];
  const pt = (s) => [S[s].lng, S[s].lat];
  for (const leg of option?.legs || []) {
    if (leg.kind === 'walk') {
      if (leg.from >= 0 && leg.to >= 0 && leg.from !== leg.to && S[leg.from]?.lng != null && S[leg.to]?.lng != null) {
        feats.push({ type: 'Feature', properties: { kind: 'walk' }, geometry: { type: 'LineString', coordinates: [pt(leg.from), pt(leg.to)] } });
      }
      continue;
    }
    const coords = [];
    for (let i = 1; i < leg.via.length; i++) {
      const a = leg.via[i - 1], b = leg.via[i];
      const la = S[a].line, lb = S[b].line, line = net.lines[la];
      if (la !== lb || !line) continue; // the through-running hand-over: same place
      const ca = chainsOf(net, a), cb = chainsOf(net, b);
      let seg = null;
      if (ca.length && cb.length && line.path?.length > 1) {
        let bestD = Infinity, pair = null;
        for (const x of ca) for (const y of cb) { const d = Math.abs(x - y); if (d < bestD) { bestD = d; pair = [x, y]; } }
        if (line.loop && line.length && bestD > line.length / 2) {
          // the short way round crosses the loop's seam (chain 0 = chain length)
          const [x, y] = pair;
          seg = x < y ? slicePath(line, x, 0).concat(slicePath(line, line.length, y)) : slicePath(line, x, line.length).concat(slicePath(line, 0, y));
        } else seg = slicePath(line, pair[0], pair[1]);
      }
      if (!seg || seg.length < 2) seg = [pt(a), pt(b)];
      if (coords.length) seg = seg.slice(1);
      coords.push(...seg);
    }
    const color = net.lines[leg.line]?.color || '#6B6B70';
    if (coords.length >= 2) feats.push({ type: 'Feature', properties: { kind: 'ride', color, line: net.lines[leg.line]?.id || '' }, geometry: { type: 'LineString', coordinates: coords } });
    for (const [s, role] of [[leg.board, 'board'], [leg.alight, 'alight']]) {
      if (S[s]?.lng != null) feats.push({ type: 'Feature', properties: { kind: 'stop', role, color, name: S[s].name?.en || '' }, geometry: { type: 'Point', coordinates: pt(s) } });
    }
  }
  return { type: 'FeatureCollection', features: feats };
}

/** [[w, s], [e, n]] around an option's geometry (for map.fitBounds), or null. */
export function routeBounds(geo) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const add = (c) => { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; };
  for (const f of geo?.features || []) {
    if (f.geometry.type === 'Point') add(f.geometry.coordinates);
    else for (const c of f.geometry.coordinates) add(c);
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}
