// Toei buses: the state behind the WebGL bus layer, ported from trafik.live's bus map: one record per bus, typed arrays the GPU reads directly, slots reused through a free list,
// a ring of recent positions for trails, focus (dim the other routes), selection, picking.
//
// What changed for Tokyo is the motion. TransJakarta reports every few seconds anywhere on the road; Toei Bus reports
// a bus AT A STOP, about once per stop (3 Nov 2026: 469 of 475 reports sat on their current_stop_sequence stop; a
// bus's reports come a median 93 s apart, 327 m along). So a bus here moves along its own trip's shape (Toei trip ids
// start with their shape id): on each report it catches up to the reported stop if it was behind, stands there about
// DWELL_MS, then rolls on toward the next stop at its own observed speed and HOLDS just short of that stop until the
// feed reports it there. The drawn bus is therefore always between its last reported stop and the next one (never past
// a stop the feed has not confirmed, never backwards). A bus with no known shape glides straight between its reports
// (trafik.live's move) instead. Jumps no bus can drive snap with a quick fade.
//
// GPU layout (per slot), as trafik.live:
//   dyn   f32 x4  [mercX - ORIGIN, mercY - ORIGIN, heading rad, presence 0..1]     every frame (visible buses)
//   info  f32 x4  [trailStart s, label index, label width px, flags]             on change
//   col   u8  x8  [r, g, b, kind, text r, g, b, 0]                               on change
//   trail f32 x4  row-major ring [row][slot] = [mercX - ORIGIN, mercY - ORIGIN, t s, 0]
import { MPU, ORIGIN, toX, toY, lngOfX, latOfY, clamp, angDiff } from './util.js';

export { ORIGIN };
export const TRAIL_K = 30;          // rows in the trail ring
export const TRAIL_DT = 1500;       // ms between trail samples -> ~44 s of trail
export const TRAIL_TEX_W = 1024;    // trail texture width (slots per texture row)
export const F = { STALE: 1, IDLE: 2, NOTRIP: 4, DIM: 8, SEL: 16, HDG: 32, LABEL: 64 };
export const DWELL_MS = 15000;      // a bus reported at a stop leaves it about this long after the report
export const V_DEFAULT = 4.5;       // m/s rolling between stops (Toei, 3 Nov: 327 m per 93 s report incl. the stop)
export const HOLD_M = 12;           // predicted motion stops this far before the next stop until it is reported there
export const STALE_MS = 5 * 60000;  // a report older than this draws greyed
const SNAP_M = 2500;
const D2R = Math.PI / 180;

export class BusStore {
  /**
   * shapes: ShapeIndex over the pack's shapes (shape i = pack shape i); tripShape(tripId) -> shape index | -1;
   * stopsAlong(shapeIndex, tripId) -> along metres of the trip's stops (sorted) | null; stopAlong(tripId, stopSeq) ->
   * along metres of the stop the feed reports the bus at (current_stop_sequence) | null; routeInfo(routeId) ->
   * {short, rgb, trgb} | null; labelFor(text) -> {i, w} | null.
   */
  constructor({ shapes, tripShape = () => -1, stopsAlong = () => null, stopAlong = () => null, routeInfo = () => null, labelFor = () => null }) {
    this.shapes = shapes;
    this.tripShape = tripShape;
    this.stopsAlong = stopsAlong;
    this.stopAlong = stopAlong;
    this.routeInfo = routeInfo;
    this.labelFor = labelFor;
    this.T0 = performance.now();
    this.buses = new Map();   // id -> bus
    this.byId = this.buses;
    this.slots = [];
    this.free = [];
    this.maxSlot = 0;
    this.cap = 0;
    this.row = 0;
    this.lastSample = 0;
    this.focus = null;
    this.only = null;
    this.selId = null;
    this.visible = 0;
    this.visN = 0;
    this.fading = 0;
    this.maxSpeedPx = 0;
    this.skew = 0;            // server clock - this clock (ms), from each snapshot's `at`
    this.dirty = { info: true, col: true, dyn: true, rows: new Set(), realloc: true, frames: true };
    this.lastUpdate = 0;
    this.cullView = null;
    this.maxV = 0;
    this.feedAt = null;
    this._grow(1024);
    this._p = { x: 0, y: 0, h: 0, moving: false, v: 0 };
    this._q = { x: 0, y: 0, h: 0, moving: false, v: 0 };
  }

  get count() { return this.buses.size; }
  tNow(now) { return (now - this.T0) / 1000; }

  _grow(cap) {
    const old = this.cap;
    const dyn = new Float32Array(cap * 4), info = new Float32Array(cap * 4), col = new Uint8Array(cap * 8);
    const trail = new Float32Array(TRAIL_K * cap * 4).fill(-1e6);
    if (old) {
      dyn.set(this.dyn); info.set(this.info); col.set(this.col);
      for (let r = 0; r < TRAIL_K; r++) trail.set(this.trail.subarray(r * old * 4, (r + 1) * old * 4), r * cap * 4);
    }
    Object.assign(this, { dyn, info, col, trail, cap, visList: new Float32Array(cap * 8), visCol: new Uint8Array(cap * 4) });
    this.dirty.realloc = true;
    this.dirty.info = this.dirty.col = true;
  }

  _alloc(b) {
    const slot = this.free.length ? this.free.pop() : this.maxSlot++;
    if (slot >= this.cap) this._grow(this.cap * 2);
    this.slots[slot] = b;
    b.slot = slot;
    return slot;
  }

  _free(b) {
    if (b.slot < 0) return;
    this.dyn[b.slot * 4 + 3] = 0;
    this.slots[b.slot] = null;
    this.free.push(b.slot);
    b.slot = -1;
    this.buses.delete(b.id);
  }

  // ------------------------------------------------------------ snapshots from /api/tokyo/bus.json
  /** Apply one snapshot {at, buses: [{id, trip, route, lat, lng, ts, stopSeq?, stop?, prev?}]}; every bus not in it fades out. */
  applySnapshot(snap, nowPerf = performance.now(), nowMs = Date.now()) {
    if (!snap || !Array.isArray(snap.buses)) return;
    if (Number.isFinite(snap.at)) this.skew = snap.at - nowMs;
    this.feedAt = snap.feedAt ?? snap.at ?? null;
    this.dirty.frames = true;
    const seen = new Set();
    for (const r of snap.buses) {
      if (!r || r.id == null || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      const id = String(r.id);
      seen.add(id);
      this._report(id, r, nowPerf, nowMs + this.skew);
    }
    for (const b of this.buses.values()) if (!seen.has(b.id) && !b.removeAt) b.removeAt = nowPerf;
  }

  _new(id, nowPerf) {
    const b = {
      id, route: null, trip: null, tsi: -1, stopSeq: null, stop: null, slot: -1, flags: 0, placed: false, removeAt: 0, hidden: false,
      rx: NaN, ry: NaN, repTs: 0, iv: 0, v: 0, sRep: NaN, lastMove: nowPerf, hasMoved: false,
      mode: 'free', msi: -1, kt: [], ks: [], ox: 0, oy: 0, ax: 0, ay: 0, bx: 0, by: 0, t0: nowPerf, dur: 0, sh: 0, sd: 0,
      x: 0, y: 0, h: 0, pres: 0, vis: false, trailStart: 0, label: '', s: NaN,
    };
    this.buses.set(id, b);
    this._alloc(b);
    return b;
  }

  /** serverMs -> this page's performance.now() time. */
  _perf(ms, nowPerf, serverNow) { return nowPerf - (serverNow - ms); }

  _report(id, r, nowPerf, serverNow) {
    let b = this.buses.get(id);
    const fresh = !b;
    if (!b) b = this._new(id, nowPerf);
    b.removeAt = 0;
    const tripChanged = !fresh && b.trip !== (r.trip || null);
    const routeChanged = b.route !== (r.route ?? null);
    b.trip = r.trip || null;
    b.route = r.route ?? null;
    b.stopSeq = Number.isFinite(r.stopSeq) ? r.stopSeq : null;
    b.stop = r.stop || null;
    if (fresh || routeChanged) this._style(b);
    const ts = Number.isFinite(r.ts) ? r.ts : serverNow;
    const wasStale = (b.flags & F.STALE) !== 0;
    const stale = serverNow - ts > STALE_MS;
    b.flags = (b.flags & ~F.STALE) | (stale ? F.STALE : 0) | (b.trip ? 0 : F.NOTRIP);
    const x = toX(r.lng), y = toY(r.lat);
    const tsi = b.trip ? this.tripShape(b.trip) : -1;

    if (fresh || tripChanged || !b.placed) {
      b.tsi = tsi;
      b.sRep = NaN;
      b.v = tripChanged ? b.v : 0;
      const near = !fresh && b.placed && Math.hypot(x - b.x, y - b.y) < 300;
      this._first(b, x, y, ts, r.prev, nowPerf, serverNow, near);
      this._refreshFlags(b);
      return;
    }
    if (ts <= b.repTs || (x === b.rx && y === b.ry && ts - b.repTs < 30000)) {
      // the same report again (or a repeat at the same place): only the stale flag can change
      b.repTs = Math.max(b.repTs, ts);
      if (wasStale !== stale) this._refreshFlags(b);
      return;
    }
    const dtRep = ts - b.repTs;
    if (dtRep >= 10000 && dtRep <= 360000) b.iv = b.iv ? b.iv * 0.6 + dtRep * 0.4 : dtRep;
    b.repTs = ts; b.rx = x; b.ry = y;
    const cur = this.evalPos(b, nowPerf, this._p);
    const dist = Math.hypot(x - cur.x, y - cur.y);
    const implausible = dist > 400 && dist / Math.max(1, dtRep / 1000) > 30;
    if (dist > SNAP_M || implausible || (wasStale && dist > 300)) {
      b.sRep = NaN;
      this._first(b, x, y, ts, null, nowPerf, serverNow, false);
      this._refreshFlags(b);
      return;
    }
    if (b.tsi >= 0) {
      const r = this._shapeMove(b, x, y, ts, cur, nowPerf, serverNow);
      if (r === 'snap') {
        b.sRep = NaN;
        this._first(b, x, y, ts, null, nowPerf, serverNow, Math.hypot(x - cur.x, y - cur.y) < 300);
        this._refreshFlags(b);
        return;
      }
      if (r) { this._moved(b); return; }
    }
    this._freeMove(b, x, y, cur, nowPerf);
    this._moved(b);
  }

  _moved(b) { if (!b.hasMoved) { b.hasMoved = true; this._refreshFlags(b); } }

  /** Along metres of (x, y) on the bus's trip shape (near `near` when given), or null when the shape is far. */
  _locate(b, x, y, near = null) {
    if (b.tsi < 0) return null;
    const r = this.shapes.locate(b.tsi, x, y, near != null ? { prevS: near, ahead: 4000, maxD: 90 } : { maxD: 90 });
    return r && r.d <= 90 ? r.s : null;
  }

  /**
   * Along metres of a REPORT at (x, y): on the stretch of the stop the feed reports it at (current_stop_sequence) when
   * that is known. 79 of Toei's 748 shapes pass the same street twice (池86 runs Ikebukuro -> Shibuya -> Ikebukuro along
   * Meiji-dori), and without the stop a northbound bus could land on the southbound pass (3 Nov 2026, bus H873).
   */
  _locateRep(b, x, y, near = null) {
    if (b.tsi < 0) return null;
    const hint = b.trip && b.stopSeq != null ? this.stopAlong(b.trip, b.stopSeq) : null;
    if (hint != null && Number.isFinite(hint)) {
      const r = this.shapes.projectRange(b.tsi, x, y, hint - 450, hint + 450);
      if (r && r.d <= 90) return r.s;
    }
    return this._locate(b, x, y, near);
  }

  /** How long a bus stands after a report: Toei reports a bus AT its stop (current_stop_sequence); a GPS-style feed
   * (a GPS-style feed: no stop in the report) reports it anywhere on the road, so it rolls on at once. */
  _dwell(b) { return b.stopSeq != null ? DWELL_MS : 0; }

  /** The along metres where predicted motion after a report at sRep must hold (just short of the next stop). */
  _holdAfter(b, sRep) {
    const al = this.stopsAlong(b.tsi, b.trip);
    const len = this.shapes.shapes[b.tsi]?.len ?? sRep;
    if (!al || !al.length) return Math.max(sRep, Math.min(len, sRep + 250));
    for (let i = 0; i < al.length; i++) if (al[i] > sRep + 5) return Math.max(sRep, al[i] - HOLD_M);
    return Math.max(sRep, len - 2);   // past the last stop: the terminal
  }

  /** First sight (or a snap): put it on its shape at the reported stop and start the stop-to-stop motion. */
  _first(b, x, y, ts, prev, nowPerf, serverNow, near) {
    b.placed = true;
    b.repTs = ts; b.rx = x; b.ry = y;
    const s = this._locateRep(b, x, y);
    if (s != null) {
      b.mode = 'shape'; b.msi = b.tsi; b.sRep = s; b.ox = 0; b.oy = 0;
      const tRep = this._perf(ts, nowPerf, serverNow);
      const hold = this._holdAfter(b, s);
      const v = (b.v || V_DEFAULT) / 1000;
      const tDep = tRep + this._dwell(b);
      // where it would be now had it rolled on from the stop at its speed since leaving it
      const sNow = nowPerf > tDep ? Math.min(hold, s + (nowPerf - tDep) * v) : s;
      if (sNow < hold - 0.5) {
        const tGo = Math.max(nowPerf, tDep);
        b.kt = [nowPerf, tGo, tGo + (hold - sNow) / v]; b.ks = [sNow, sNow, hold];
      } else { b.kt = [nowPerf]; b.ks = [sNow]; }
      const p = this.shapes.pointAt(b.msi, sNow, this._q);
      this._placeAt(b, p.x, p.y, p.h, nowPerf, near);
      return;
    }
    // no shape: trafik.live's glide; with the report before (server `prev`), start between the two fixes
    b.mode = 'free'; b.msi = -1;
    if (prev && Number.isFinite(prev[0]) && ts - prev[2] >= 15000 && ts - prev[2] <= 360000) {
      const px = toX(prev[1]), py = toY(prev[0]);
      b.iv = ts - prev[2];
      this._placeAt(b, px, py, Math.atan2(x - px, -(y - py)), nowPerf, near);
      const dur = clamp(b.iv * 0.9, 15000, 150000);
      const age = clamp(serverNow - ts, 0, dur * 0.9);
      b.ax = px; b.ay = py; b.bx = x; b.by = y; b.sh = Math.atan2(x - px, -(y - py)); b.sd = Math.hypot(x - px, y - py);
      b.t0 = nowPerf - age; b.dur = dur;
      return;
    }
    this._placeAt(b, x, y, null, nowPerf, near);
  }

  _placeAt(b, x, y, h, now, keepPresence) {
    if (b.mode !== 'shape') { b.ax = b.bx = x; b.ay = b.by = y; b.t0 = now; b.dur = 0; b.sd = 0; }
    b.x = x; b.y = y;
    if (h != null) b.h = h;
    if (!keepPresence) b.pres = 0;
    b.lastMove = now;
    b.trailStart = this.tNow(now);
    if (b.slot >= 0) { this.info[b.slot * 4] = b.trailStart; this.dirty.info = true; }
  }

  /**
   * A new report on the trip's shape: catch up to it, stand, roll on to just short of the next stop. Returns true (moved
   * on the shape), false (the shape is far: glide straight) or 'snap' (place it afresh).
   */
  _shapeMove(b, x, y, ts, cur, nowPerf, serverNow) {
    let sDraw = b.mode === 'shape' && b.msi === b.tsi ? this._sAt(b, nowPerf) : this._locate(b, cur.x, cur.y);
    const sRep = this._locateRep(b, x, y, Number.isFinite(b.sRep) ? b.sRep : sDraw);
    if (sRep == null) return false;
    if (sDraw == null) sDraw = sRep;
    // an along jump far longer than the straight line from the drawn bus to the report: it is on the other pass of a
    // loop / out-and-back shape. Place it afresh instead of racing it kilometres along the street (or holding it there).
    // (streets bend: a real catch-up runs ~1-1.4x the straight line)
    if (Math.abs(sRep - sDraw) > 2 * Math.hypot(x - cur.x, y - cur.y) + 250) return 'snap';
    // learn this bus's rolling speed from report to report (minus the time at the stop)
    if (Number.isFinite(b.sRep) && sRep > b.sRep + 20 && b.iv) {
      const moving = Math.max(10000, (b.iv || 90000) - this._dwell(b));
      const vObs = ((sRep - b.sRep) / moving) * 1000;
      if (vObs > 1 && vObs < 15) b.v = b.v ? b.v * 0.6 + vObs * 0.4 : vObs;
    }
    const v = clamp(b.v || V_DEFAULT, 2, 9) / 1000;   // m/ms
    const hold = this._holdAfter(b, sRep);
    const startOff = b.mode !== 'shape' || b.msi !== b.tsi;
    if (startOff) {   // coming from a straight glide: blend the offset away over the first stretch
      const st = this.shapes.pointAt(b.tsi, sDraw, this._q);
      b.ox = cur.x - st.x; b.oy = cur.y - st.y;
    } else { b.ox = 0; b.oy = 0; }
    b.mode = 'shape'; b.msi = b.tsi; b.sRep = sRep;
    const tRep = this._perf(ts, nowPerf, serverNow);
    const tDep = tRep + this._dwell(b);
    if (sDraw > sRep + 5) {
      // already drawn past this report (predicted ahead, the report is older or a repeat): never go back
      const h2 = Math.max(hold, sDraw);
      b.kt = h2 > sDraw + 0.5 ? [nowPerf, nowPerf + (h2 - sDraw) / v] : [nowPerf];
      b.ks = h2 > sDraw + 0.5 ? [sDraw, h2] : [sDraw];
    } else {
      const t1 = nowPerf + clamp(((sRep - sDraw) / 9) * 1000, 0, 12000);   // catch up at ~9 m/s, 12 s at most
      const tGo = Math.max(t1, tDep);
      b.kt = [nowPerf, t1, tGo, tGo + (hold - sRep) / v];
      b.ks = [sDraw, sRep, sRep, hold];
    }
    b.lastMove = nowPerf;
    return true;
  }

  /** trafik.live's straight glide, spread over the bus's observed report interval (lagging one report). */
  _freeMove(b, x, y, cur, nowPerf) {
    b.mode = 'free'; b.msi = -1;
    b.ax = cur.x; b.ay = cur.y; b.bx = x; b.by = y;
    b.sh = Math.atan2(x - cur.x, -(y - cur.y));
    b.sd = Math.hypot(x - cur.x, y - cur.y);
    b.t0 = nowPerf;
    b.dur = clamp((b.iv || 90000) * 0.9, 15000, 150000);
    b.lastMove = nowPerf;
  }

  /** Along metres at time t (shape mode). */
  _sAt(b, t) {
    const kt = b.kt, ks = b.ks;
    if (!kt.length) return NaN;
    if (t <= kt[0]) return ks[0];
    for (let i = 1; i < kt.length; i++) {
      if (t <= kt[i]) { const span = kt[i] - kt[i - 1]; return span > 0 ? ks[i - 1] + (ks[i] - ks[i - 1]) * ((t - kt[i - 1]) / span) : ks[i]; }
    }
    return ks[ks.length - 1];
  }

  /** Where bus b is drawn at time t (ms): out.x, out.y (metres), out.h (heading of travel), out.moving, out.v (m/ms). */
  evalPos(b, t, out) {
    if (b.mode === 'shape' && b.msi >= 0 && b.kt.length) {
      const kt = b.kt, ks = b.ks;
      let s = ks[ks.length - 1], v = 0, i = 1;
      if (t <= kt[0]) s = ks[0];
      else {
        for (; i < kt.length; i++) {
          if (t <= kt[i]) {
            const span = kt[i] - kt[i - 1];
            const k = span > 0 ? (t - kt[i - 1]) / span : 1;
            s = ks[i - 1] + (ks[i] - ks[i - 1]) * k;
            v = span > 0 ? (ks[i] - ks[i - 1]) / span : 0;
            break;
          }
        }
      }
      b.s = s;
      this.shapes.pointAt(b.msi, s, out);
      if (b.ox || b.oy) {
        const tEnd = kt.length > 1 ? kt[1] : kt[0];
        const f = tEnd > kt[0] ? 1 - clamp((t - kt[0]) / (tEnd - kt[0]), 0, 1) : 0;
        out.x += b.ox * f; out.y += b.oy * f;
        if (f === 0) { b.ox = 0; b.oy = 0; }
      }
      out.moving = v > 1e-4;
      out.v = v;
      return out;
    }
    const k = b.dur > 0 ? clamp((t - b.t0) / b.dur, 0, 1) : 1;
    if (k >= 1) { out.x = b.bx; out.y = b.by; out.h = b.h; out.moving = false; out.v = 0; return out; }
    out.x = b.ax + (b.bx - b.ax) * k;
    out.y = b.ay + (b.by - b.ay) * k;
    out.h = b.sh;
    out.moving = b.sd > 1.5;
    out.v = b.dur > 0 ? b.sd / b.dur : 0;
    return out;
  }

  // ------------------------------------------------------------ style + flags
  _style(b) {
    if (b.slot < 0) return;
    const ri = b.route != null ? this.routeInfo(b.route) : null;
    const rgb = ri ? ri.rgb : [107, 107, 112], text = ri ? ri.trgb : [255, 255, 255];
    const o = b.slot * 8, col = this.col;
    col[o] = rgb[0]; col[o + 1] = rgb[1]; col[o + 2] = rgb[2]; col[o + 3] = 0;
    col[o + 4] = text[0]; col[o + 5] = text[1]; col[o + 6] = text[2]; col[o + 7] = 0;
    const code = ri ? ri.short : b.route || '';
    const lab = code ? this.labelFor(code) : null;
    b.label = code;
    const i = b.slot * 4;
    this.info[i] = b.trailStart;
    this.info[i + 1] = lab ? lab.i : -1;
    this.info[i + 2] = lab ? lab.w : 0;
    this.info[i + 3] = this._flags(b, !!lab);
    b.hidden = this._hidden(b);
    this.dirty.info = this.dirty.col = true;
  }

  _flags(b, hasLabel = this.info[b.slot * 4 + 1] >= 0) {
    let f = b.flags & 7;
    if (this.focus && b.route !== this.focus) f |= F.DIM;
    if (this.selId && b.id === this.selId) f |= F.SEL;
    if (b.mode === 'shape' || b.hasMoved) f |= F.HDG;   // heading from its shape, or from its motion
    if (hasLabel) f |= F.LABEL;
    return f;
  }

  _refreshFlags(b) {
    if (b.slot < 0) return;
    const i = b.slot * 4 + 3;
    const f = this._flags(b);
    if (this.info[i] !== f) { this.info[i] = f; this.dirty.info = true; }
  }

  // ------------------------------------------------------------ per frame (as trafik.live)
  due(now, viewRaw, pxPerM, chips) {
    if (!this.lastUpdate || this.fading || this.dirty.frames) return true;
    const v = this.cullView;
    if (!v || viewRaw[0] < v[0] || viewRaw[1] < v[1] || viewRaw[2] > v[2] || viewRaw[3] > v[3]) return true;
    const pxPerMs = this.maxV * pxPerM;
    const step = Math.min(pxPerMs > 0 ? 0.25 / pxPerMs : Infinity, chips ? 80 : 250);
    return now - this.lastUpdate >= step;
  }

  update(now, dt, view, pxPerM) {
    this.passes = (this.passes || 0) + 1;
    this.lastUpdate = now;
    this.cullView = view;
    this.dirty.frames = false;
    this.dirty.dyn = true;
    const dyn = this.dyn, vl = this.visList, vc = this.visCol, col = this.col, info = this.info;
    let visible = 0, maxV = 0, vn = 0, fading = 0;
    const p = this._p;
    const fadeIn = dt / 260, fadeOut = dt / 360;
    const kh = 1 - Math.exp(-dt / 150);
    for (let slot = 0; slot < this.maxSlot; slot++) {
      const b = this.slots[slot];
      const o = slot * 4;
      if (!b || !b.placed) { dyn[o + 3] = 0; continue; }
      const target = b.removeAt || b.hidden ? 0 : 1;
      if (b.pres < target) b.pres = Math.min(target, b.pres + fadeIn);
      else if (b.pres > target) b.pres = Math.max(target, b.pres - fadeOut);
      if (b.removeAt && b.pres <= 0) { this._free(b); continue; }
      if (b.pres <= 0) { dyn[o + 3] = 0; b.vis = false; continue; }
      this.evalPos(b, now, p);
      // cull on the drawn point with a margin (shape moves are short: a stop or two)
      if (p.x < view[0] - 60 || p.x > view[2] + 60 || p.y < view[1] - 60 || p.y > view[3] + 60) { dyn[o + 3] = 0; b.vis = false; b.x = p.x; b.y = p.y; continue; }
      const want = p.moving || b.mode === 'shape' ? p.h : b.h;
      b.h += angDiff(b.h, want) * kh;
      if (p.moving) { const v = p.v; if (v > maxV) maxV = v < 0.03 ? v : 0.03; }
      if (p.moving) b.lastMove = now;
      b.x = p.x; b.y = p.y; b.vis = true;
      if (b.pres !== target) fading++;
      const mx = p.x / MPU - ORIGIN[0], my = p.y / MPU - ORIGIN[1];
      dyn[o] = mx;
      dyn[o + 1] = my;
      dyn[o + 2] = b.h;
      dyn[o + 3] = b.pres;
      visible++;
      if (now - b.lastMove < 30000 && !(this.focus && b.route !== this.focus)) {
        const v = vn * 8, c = vn * 4, cs = slot * 8;
        vl[v] = slot; vl[v + 1] = mx; vl[v + 2] = my; vl[v + 3] = b.pres;
        vl[v + 4] = info[slot * 4]; vl[v + 5] = info[slot * 4 + 3]; vl[v + 6] = 0; vl[v + 7] = 0;
        vc[c] = col[cs]; vc[c + 1] = col[cs + 1]; vc[c + 2] = col[cs + 2]; vc[c + 3] = 255;
        vn++;
      }
    }
    this.visible = visible;
    this.visN = vn;
    this.fading = fading;
    this.maxV = maxV;
    this.maxSpeedPx = maxV * 1000 * pxPerM;
    if (now - this.lastSample >= TRAIL_DT) this._sample(now);
  }

  _sample(now) {
    this.lastSample = now;
    this.row = (this.row + 1) % TRAIL_K;
    const base = this.row * this.cap * 4;
    const tr = this.trail;
    const t = this.tNow(now);
    const p = this._q;
    for (let slot = 0; slot < this.maxSlot; slot++) {
      const b = this.slots[slot];
      const o = base + slot * 4;
      if (!b || !b.placed) { tr[o + 2] = -1e6; continue; }
      const q = b.vis ? { x: b.x, y: b.y } : this.evalPos(b, now, p);
      tr[o] = q.x / MPU - ORIGIN[0];
      tr[o + 1] = q.y / MPU - ORIGIN[1];
      tr[o + 2] = t;
      tr[o + 3] = 0;
    }
    this.dirty.rows.add(this.row);
  }

  // ------------------------------------------------------------ selection, focus, filters
  setFocusRoute(id) {
    this.focus = id || null;
    for (const b of this.buses.values()) this._refreshFlags(b);
    if (this.only) this._rehide();
  }

  setRouteFilter(ids) {
    this.only = ids && ids.size ? ids : null;
    this._rehide();
  }

  _hidden(b) {
    return !!(this.only && !this.only.has(String(b.route)) && b.route !== this.focus && !(this.selId && b.id === this.selId));
  }

  _rehide() {
    this.dirty.frames = true;
    for (const b of this.buses.values()) b.hidden = this._hidden(b);
  }

  select(id) {
    const prev = this.selId && this.buses.get(this.selId);
    this.selId = id || null;
    if (prev) this._refreshFlags(prev);
    const b = this.selId && this.buses.get(this.selId);
    if (b) this._refreshFlags(b);
    if (this.only) this._rehide();
  }

  restyle() { for (const b of this.buses.values()) this._style(b); }

  get(id) { return this.buses.get(id) || null; }

  /** Nearest visible bus to screen point (x, y) within r px; project(mx, my) -> {x, y} (mercator 0..1 in). */
  pick(x, y, r, project) {
    let best = null, bd = Infinity;
    for (const b of this.buses.values()) {
      if (!b.vis || b.pres < 0.5 || b.hidden || b.removeAt) continue;
      const s = project(b.x / MPU, b.y / MPU);
      if (!s) continue;
      let d = Math.hypot(s.x - x, s.y - y);
      if (this.focus && b.route !== this.focus) d += 10;
      if (d < r && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  lngLat(b) { return [lngOfX(b.x), latOfY(b.y)]; }

  /**
   * Re-flag every bus by the AGE of its report at nowMs (page clock): a feed that stopped answering (a subway, a dead
   * poller) leaves buses that look live for ever otherwise. Returns how many are stale.
   */
  ageFlags(nowMs = Date.now()) {
    const serverNow = nowMs + this.skew;
    let n = 0;
    for (const b of this.buses.values()) {
      const stale = serverNow - b.repTs > STALE_MS;
      if (stale) n++;
      if (stale !== ((b.flags & F.STALE) !== 0)) { b.flags = (b.flags & ~F.STALE) | (stale ? F.STALE : 0); this._refreshFlags(b); this.dirty.frames = true; }
    }
    return n;
  }

  /** The bus's report time in this page's clock (ms since epoch). */
  reportAt(b) { return b.repTs - this.skew; }

  reset() {
    for (const b of [...this.buses.values()]) this._free(b);
    this.buses.clear();
  }
}

export { D2R };
