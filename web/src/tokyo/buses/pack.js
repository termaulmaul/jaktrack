// Buses: the static pack var/static/tokyo/bus-v1.json (data-build/bus/build.mjs) -> lookups. Operator: Toei Bus
// (CC BY 4.0, 東京都交通局・公共交通オープンデータ協議会); other feeds carry an id prefix. Modified: shapes encoded, stops
// projected, route tags romanised.
import { decodePath, routeColor, BUS_GREY } from './util.js';

/** Raw pack -> { routes, routeIx, heads, stops, shapes (flat paths), pats, tripShape(id), routeOf(id), feed }. */
export function unpackBus(raw) {
  if (!raw || raw.v !== 1 || !Array.isArray(raw.routes)) throw new Error('bus pack: unknown format');
  // operators (a pack without the table is Toei only); stopReports: the feed reports a bus AT its stops (Toei)
  const ops = (Array.isArray(raw.ops) && raw.ops.length ? raw.ops : [{ id: 'toei', name: { ja: '都営バス', en: 'Toei Bus' }, stopReports: true }])
    .map((o) => ({ id: String(o.id), name: { ja: o.name?.ja || '', en: o.name?.en || o.name?.ja || '' }, stopReports: !!o.stopReports }));
  const routes = raw.routes.map(([id, ja, en, code, color, , op]) => {
    const c = routeColor(color || BUS_GREY);
    return { id, tag: { ja, en: en || ja }, code: code || null, color: c.hex, gtfsColor: color, rgb: c.rgb, trgb: c.text, op: Number.isInteger(op) && ops[op] ? op : 0 };
  });
  const routeIx = new Map(routes.map((r, i) => [r.id, i]));
  const heads = raw.heads.map(([ja, en]) => ({ ja, en: en || ja }));
  const names = raw.names.map(([ja, en]) => ({ ja, en: en || ja }));
  const stops = [];
  for (let i = 0; i < raw.stopIds.length; i++) {
    stops.push({ id: raw.stopIds[i], name: names[raw.stops[i * 3]] || { ja: '', en: '' }, lng: raw.stops[i * 3 + 1] / 1e5, lat: raw.stops[i * 3 + 2] / 1e5 });
  }
  const stopIx = new Map(stops.map((s, i) => [s.id, i]));
  const pats = raw.pats.map(([shape, head, st, along, seq]) => ({
    shape, head, stops: st, along, seq0: typeof seq === 'number' ? seq : null, seqs: Array.isArray(seq) ? seq : null,
  }));
  // synth: made from the stop order (the operator's GTFS has no shape): motion follows it, the page draws no line for it
  const shapes = raw.shapes.map(([id, route, dir, pat, path, len, synth]) => ({ id, route, dir, pat, path, len, synth: synth === 1, flat: null }));
  const shapeIx = new Map(shapes.map((s, i) => [s.id, i]));
  const flat = (i) => { const s = shapes[i]; if (s && !s.flat) s.flat = decodePath(s.path); return s ? s.flat : null; };
  const tripX = raw.tripX || {};

  /** Shape index of a Toei trip: its id starts with its shape id ("72801-1-85-101-1715" -> "72801-1"). */
  function tripShape(tripId) {
    if (!tripId) return -1;
    if (tripX[tripId] != null) { const p = pats[tripX[tripId]]; return p ? p.shape : -1; }
    const m = /^([^-]+-[^-]+)-/.exec(tripId);
    const i = m ? shapeIx.get(m[1]) : undefined;
    return i ?? -1;
  }
  /** The stop pattern of a trip (its shape's default unless listed in tripX). */
  function tripPat(tripId) {
    if (!tripId) return null;
    if (tripX[tripId] != null) return pats[tripX[tripId]] || null;
    const si = tripShape(tripId);
    return si >= 0 ? pats[shapes[si].pat] || null : null;
  }
  /** Index in pattern p of GTFS stop_sequence `seq` (RT current_stop_sequence), or -1. */
  function seqIndex(p, seq) {
    if (!p || !Number.isFinite(seq)) return -1;
    const i = p.seq0 != null ? seq - p.seq0 : p.seqs.indexOf(seq);
    return i >= 0 && i < p.stops.length ? i : -1;
  }
  const route = (id) => { const i = routeIx.get(id); return i == null ? null : routes[i]; };
  /** The operator of a route id ({ id, name: {ja, en}, stopReports }), or null. */
  const opOf = (routeId) => { const r = route(routeId); return r ? ops[r.op] || null : null; };
  return {
    feed: raw.feed || null, feeds: raw.feeds || null, built: raw.built || null, ops, opOf, routes, routeIx, route, heads, stops, stopIx, shapes, shapeIx, pats,
    flat, tripShape, tripPat, seqIndex,
    /** ShapeIndex.build input: every shape, with its route id so the route fallback works too. */
    shapeList: () => shapes.map((s, i) => ({ id: i, route: routes[s.route]?.id ?? null, dir: s.dir, flat: flat(i) })),
  };
}

/** Fetch + unpack (the dev server / nginx send the .br / .gz sibling when the browser takes it). */
export async function loadBusPack(base = '/data/tokyo/', fetchImpl = globalThis.fetch) {
  const b = base.endsWith('/') ? base : `${base}/`;
  let file = 'bus-v1.json';
  try {
    const r = await fetchImpl(`${b}bus-latest.json`, { cache: 'no-cache' });
    if (r.ok) { const j = await r.json(); if (j && typeof j.file === 'string' && /^bus-v\d+\.json$/.test(j.file)) file = j.file; }
  } catch { /* the pointer is optional */ }
  const res = await fetchImpl(`${b}${file}`);
  if (!res.ok) throw new Error(`bus pack HTTP ${res.status}`);
  return unpackBus(await res.json());
}
