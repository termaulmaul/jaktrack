// TransJakarta buses, SIMULATED from the timetable (not live positions). The layer is trafik.live's bus layer as ported
// by tokyo-rail-twin for Toei; jaktrack replaces its live feed with sim.js. Off by default; the bus button turns it on.
// Then: the static pack (/data/tokyo/bus-v1.json, data-build/bus.mjs: GTFS PT Transportasi Jakarta) loads once, sim.js
// lists the buses on the road every 10 s (one per headway of each trip pattern; no network request), and every bus
// follows its own trip's shape at the timetable's stop times (store.js applySim) in a WebGL layer UNDER the trains.
// Tap a bus -> opts.open('bus', id); select(id) rings it, dims the other routes and draws its route + stops.
//
//   import { mountBuses } from './buses/index.js'
//   const buses = mountBuses(map, { lang, open, before: 'tokyo-trains' })   // nothing loads until setOn(true)
//   await buses.setOn(true) / buses.setOn(false) / buses.toggle()
//   buses.select(id | null); buses.view(id, { t, lang }) -> HTML; buses.info(id); buses.fly(id); buses.stats()
//   buses.near([lng, lat], n) + buses.rowsHtml(list, { t, lang }): the keyboard / screen-reader list
//   buses.setLang('en' | 'ja' | 'id'); buses.destroy()
import { ShapeIndex } from './shapes.js';
import { LabelAtlas } from './labels.js';
import { BusStore } from './store.js';
import { simTrips, busesNow } from './sim.js';
import { BusLayer } from './gl.js';
import { loadBusPack } from './pack.js';
import { busRowsHtml, busSheetHtml, busT, BUS_CSS, BUS_TEXT, clockJst } from './view.js';
import { lngOf, latOf } from './util.js';

export const BUS_LAYER_ID = 'tokyo-buses';
export { BUS_TEXT, busSheetHtml, clockJst };
const SEL_SRC = 'tokyo-bus-sel';
const SEL_LINE = 'tokyo-bus-sel-line';
const SEL_STOP = 'tokyo-bus-sel-stop';
const EMPTY = { type: 'FeatureCollection', features: [] };

/** The chip that turns buses on/off (page.js places it next to 3D). data-act="buses", aria-pressed = on. */
export function busChipHtml(lang = 'en', on = false, t) {
  const tt = busT(lang, t);
  const icon = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="14" rx="3"/><path d="M5 11h14M8.5 14.5h.01M15.5 14.5h.01M8 17.5V20M16 17.5V20"/></svg>';
  return `<button type="button" class="btn tk-buschip" data-act="buses" aria-pressed="${on}" aria-label="${tt('bus.chip.aria').replace(/"/g, '&quot;')}">${icon}<span>${tt('bus.chip')}</span></button>`;
}

export function mountBuses(map, opts = {}) {
  const o = { data: '/data/tokyo/', every: 10000, before: null, lang: 'en', open: null, onChange: null, ...opts };
  let lang = o.lang;
  let on = false, destroyed = false;
  let pack = null, trips = null, packP = null, store = null, layer = null, shapes = null, atlas = null;
  let pollTimer = 0, frameTimer = 0, nextPoll = 0;
  let polls = 0, error = null, lastSnap = null, lastOkAt = 0;
  let selId = null;
  let pendingFly = null;   // fly(id) asked before that bus was in (a cold #b= link): done after the poll that brings it
  const canvas = map.getCanvas();

  if (typeof document !== 'undefined' && !document.getElementById('tokyo-bus-css')) {
    const el = document.createElement('style'); el.id = 'tokyo-bus-css'; el.textContent = BUS_CSS; document.head.append(el);
  }

  const emit = () => { try { o.onChange?.(api.stats()); } catch { /* the page's problem */ } };
  const kick = () => { if (!destroyed && on) map.triggerRepaint(); };

  // ------------------------------------------------------------ build (once, on the first setOn(true))
  async function build() {
    pack = await loadBusPack(o.data);
    if (destroyed) return;
    if (!pack.sim) throw new Error('bus pack has no timetable (sim): run bun data-build/bus.mjs');
    trips = simTrips(pack);
    shapes = new ShapeIndex();
    shapes.build(pack.shapeList());
    atlas = new LabelAtlas();
    store = new BusStore({
      shapes,
      tripShape: (trip) => pack.tripShape(trip),
      // the trip's own stop pattern (a variant trip may skip stops), else its shape's usual one
      stopsAlong: (si, trip) => { const p = (trip && pack.tripPat(trip)) || (pack.shapes[si] ? pack.pats[pack.shapes[si].pat] : null); return p ? p.along : null; },
      stopAlong: (trip, seq) => { const p = pack.tripPat(trip); const i = pack.seqIndex(p, seq); return i >= 0 ? p.along[i] : null; },
      routeInfo: (id) => { const r = pack.route(id); return r ? { short: r.tag.ja, rgb: r.rgb, trgb: r.trgb } : null; },
      labelFor: (text) => atlas.get(text),
    });
    layer = new BusLayer(store, atlas, {
      afterFrame: () => {
        if (destroyed || frameTimer || !on || (typeof document !== 'undefined' && document.hidden)) return;
        // frame rate from how fast buses cross the screen (battery): Toei buses roll ~4.5 m/s, so city views need few
        const v = store.maxSpeedPx;
        let fps = 60;
        if (layer.focusMix % 1 === 0 && !store.fading) fps = v < 0.5 ? 5 : v < 2.5 ? 12 : v < 10 ? 30 : v < 30 ? 45 : 60;
        if (store.count === 0) fps = 2;
        if (fps >= 60) map.triggerRepaint();
        else frameTimer = setTimeout(() => { frameTimer = 0; map.triggerRepaint(); }, 1000 / fps - 4);
      },
    });
    attachLayers();
    map.on('styledata', reattach);
  }

  function beforeId() {
    const b = o.before || 'tokyo-trains';
    return map.getLayer(b) ? b : undefined;
  }
  function attachLayers() {
    if (!layer || map.getLayer(BUS_LAYER_ID)) return;
    const before = beforeId();
    try {
      if (!map.getSource(SEL_SRC)) map.addSource(SEL_SRC, { type: 'geojson', data: EMPTY });
      if (!map.getLayer(SEL_LINE)) {
        map.addLayer({ id: SEL_LINE, type: 'line', source: SEL_SRC, filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 17, 6], 'line-opacity': 1 } }, before);
      }
      if (!map.getLayer(SEL_STOP)) {
        map.addLayer({ id: SEL_STOP, type: 'circle', source: SEL_SRC, filter: ['==', ['geometry-type'], 'Point'], minzoom: 12,
          paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5], 'circle-color': '#FFFFFF',
            'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 16, 2.5] } }, before);
      }
      map.addLayer(layer, before);
    } catch (e) { console.warn('[tokyo buses] layer', e); error = `layer: ${e?.message || e}`; }
  }
  // only while ON: 'styledata' fires on every restyle (language, 3D) and must not bring an OFF layer back
  function reattach() { if (on && !destroyed && layer && !map.getLayer(BUS_LAYER_ID)) { attachLayers(); if (selId) drawSel(); } }
  /** Buses off: the layers leave the map, so the custom layer's render() (cull + 2 instanced passes) never runs while
   *  off. The GL buffers go with it (onRemove) and are made again by onAdd when buses come back. */
  function detachLayers() {
    for (const id of [BUS_LAYER_ID, SEL_STOP, SEL_LINE]) { try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* gone */ } }
  }

  // ------------------------------------------------------------ simulated from the timetable (sim.js): no network
  function poll() {
    pollTimer = 0;
    if (!on || destroyed || !store) return;
    if (typeof document !== 'undefined' && document.hidden) { nextPoll = Date.now(); return; }   // again when shown
    const nowMs = Date.now(), nowPerf = performance.now();
    const list = busesNow(trips, pack.sim.calendar, nowMs).map(({ trip, el }) => {
      const dep = nowMs - el * 1000;   // id = pattern + departure time: the same bus in every pass
      return { id: `${trip.id}.${Math.round(dep / 1000)}`, trip: trip.id, route: trip.route, kt: trip.st.map((s) => nowPerf - (el - s) * 1000), ks: trip.along };
    });
    store.applySim(list, nowPerf);
    lastSnap = { at: nowMs, buses: list }; lastOkAt = nowMs; polls++; error = null;
    if (selId) {   // selected before its bus was in: dim the other routes now
      const sb = store.get(selId);
      if (sb && store.focus !== sb.route) store.setFocusRoute(sb.route);
      drawSel();
    }
    if (pendingFly && store.get(pendingFly.id)) { const f = pendingFly; pendingFly = null; api.fly(f.id, f.opts); }
    nextPoll = nowMs + o.every; pollTimer = setTimeout(poll, o.every);
    kick();
    emit();
  }
  const onVis = () => {
    if (typeof document === 'undefined' || document.hidden || !on) return;
    if (Date.now() >= nextPoll - 500) { clearTimeout(pollTimer); poll(); }
    kick();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);

  // ------------------------------------------------------------ taps: after the trains layer's own (it stops the event)
  let downAt = null;
  const onDown = (e) => { downAt = [e.clientX, e.clientY]; };
  // a 44 px target like the trains' (trains.js hit(): max(22, ...) px); the nearest bus still wins
  const pickRadius = () => (map.getZoom() >= 15 ? 24 : 22);
  const project = (mx, my) => map.project([lngOf(mx), latOf(my)]);
  const onClick = (e) => {
    if (!on || !store || destroyed) return;
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    const rect = canvas.getBoundingClientRect();
    const b = store.pick(e.clientX - rect.left, e.clientY - rect.top, pickRadius(), project);
    if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (o.open) o.open('bus', b.id);
    else api.select(b.id);
  };
  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('click', onClick, true);

  // ------------------------------------------------------------ selection: ring + dim others + route line + stops
  function drawSel() {
    const src = map.getSource(SEL_SRC);
    if (!src) return;
    const b = selId && store?.get(selId);
    if (!b || b.tsi < 0) { src.setData(EMPTY); return; }
    const r = pack.route(b.route);
    const color = r ? r.color : '#6B6B70';
    const pat = pack.tripPat(b.trip);
    const feats = [];
    // a shape made from the stop order (no GTFS shape) is not drawn: a straight line through blocks is not the street
    if (!pack.shapes[b.tsi]?.synth) {
      const flat = pack.flat(b.tsi) || [];
      const coords = [];
      for (let i = 0; i < flat.length; i += 2) coords.push([flat[i], flat[i + 1]]);
      feats.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: coords } });
    }
    if (pat) for (const k of pat.stops) { const s = pack.stops[k]; if (s) feats.push({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } }); }
    src.setData({ type: 'FeatureCollection', features: feats });
  }

  function info(id) {
    const b = store?.get(String(id));
    if (!b || !pack) return null;
    const route = pack.route(b.route);
    const pat = pack.tripPat(b.trip);
    const head = pat ? pack.heads[pat.head] : null;
    let next = [], more = 0, last = null;
    if (pat && pat.stops.length) {
      const idx = pack.seqIndex(pat, b.stopSeq);
      let start = idx >= 0 ? idx : 0;
      if (b.mode === 'shape' && Number.isFinite(b.s)) {
        let k = pat.along.findIndex((a) => a >= b.s - 20);
        if (k < 0) k = pat.stops.length - 1;
        start = Math.max(start, k);
      }
      const n = 8;
      const ids = pat.stops.slice(start, start + n);
      // "now" only at the stop the feed reported it at: a bus drawn arriving at the next stop is not confirmed there yet
      const atRep = start === idx && Number.isFinite(b.s) && Math.abs(pat.along[start] - b.s) < 25;
      next = ids.map((k, i) => ({ id: pack.stops[k]?.id, name: pack.stops[k]?.name || { ja: '', en: '' }, now: i === 0 && atRep }));
      more = Math.max(0, pat.stops.length - (start + n));
      last = { name: pack.stops[pat.stops[pat.stops.length - 1]]?.name || { ja: '', en: '' } };
    }
    return {
      id: b.id, trip: b.trip, route, op: pack.opOf(b.route), head, next, more, last, lngLat: store.lngLat(b),
      reportAt: Date.now(), stale: false, stopSeq: b.stopSeq, mode: b.mode,   // simulated: there is no report to age
    };
  }

  // ------------------------------------------------------------ API
  const api = {
    layerId: BUS_LAYER_ID,
    get on() { return on; },
    get pack() { return pack; },
    get store() { return store; },
    async setOn(v) {
      v = !!v;
      if (destroyed || v === on) return on;
      on = v;
      if (on) {
        try {
          if (!packP) packP = build();
          await packP;
        } catch (e) { on = false; packP = null; error = `pack: ${e?.message || e}`; console.warn('[tokyo buses]', e); emit(); return false; }
        if (!on || destroyed) return on;
        reattach();
        clearTimeout(pollTimer);
        poll();
      } else {
        clearTimeout(pollTimer); pollTimer = 0;
        if (store) { store.reset(); store.select(null); store.setFocusRoute(null); }
        selId = null;
        map.getSource(SEL_SRC)?.setData(EMPTY);
        clearTimeout(frameTimer); frameTimer = 0;
        detachLayers();
        map.triggerRepaint();
      }
      emit();
      return on;
    },
    toggle() { return api.setOn(!on); },
    setLang(l) { lang = l || 'en'; },
    /** Ring + dim the other routes + its route line and stops; null clears. */
    select(id) {
      selId = id ? String(id) : null;
      if (!selId || (pendingFly && pendingFly.id !== selId)) pendingFly = null;
      if (!store) return;
      store.select(selId);
      const b = selId && store.get(selId);
      store.setFocusRoute(b ? b.route : null);
      drawSel();
      kick();
    },
    info,
    /** The bus sheet as an HTML string (ctx.t = the page's i18n t, ctx.lang). */
    /** ctx.close: put the close button in the sheet's head (desktop pane, like the train / line views). */
    view(id, ctx = {}) { return busSheetHtml(info(id), { lang: ctx.lang || lang, t: ctx.t, now: Date.now(), close: !!ctx.close, loading: !polls && (on || !pack) }); },
    /** Ease the camera to the bus (street zoom) unless it is already well inside the view. */
    fly(id, { zoom = 15, padding } = {}) {
      const b = store?.get(String(id));
      if (!b) { pendingFly = { id: String(id), opts: { zoom, padding } }; return false; }
      const ll = store.lngLat(b);
      const p = map.project(ll), c = map.getCanvas();
      const inside = p.x > 40 && p.y > 40 && p.x < c.clientWidth - 40 && p.y < c.clientHeight - 40;
      if (!inside || map.getZoom() < zoom - 1.5) map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), zoom), duration: 700, ...(padding ? { padding } : {}) });
      return true;
    },
    /** The n buses nearest [lng, lat] (the keyboard list): info(id) + d (metres), nearest first; [] while off. */
    near(lngLat, n = 6) {
      if (!on || !store || !pack || !Array.isArray(lngLat)) return [];
      const [lng, lat] = lngLat.map(Number);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
      const k = Math.cos((lat * Math.PI) / 180), all = [];
      for (const b of store.buses.values()) {
        if (b.removeAt || b.hidden) continue;   // fading out / not drawn
        const [x, y] = store.lngLat(b);
        all.push({ id: b.id, d: Math.hypot((x - lng) * k, y - lat) * 111195 });
      }
      all.sort((a, z) => a.d - z.d);
      const out = [];
      for (const a of all) { if (out.length >= n) break; const i = info(a.id); if (i) out.push({ ...i, d: Math.round(a.d) }); }
      return out;
    },
    /** near()'s items as buttons (data-bus = id) in the page's row look; ctx: { t, lang }. */
    rowsHtml: (list, ctx = {}) => busRowsHtml(list, { lang: ctx.lang || lang, t: ctx.t, now: Date.now() }),
    chipHtml: (t) => busChipHtml(lang, on, t),
    stats() {
      return {
        on, loaded: !!pack, feed: lastSnap?.buses?.length ?? 0, drawn: store ? store.count : 0, visible: store ? store.visible : 0,
        feedAt: lastSnap?.feedAt ?? null, at: lastSnap?.at ?? null, polls, fails: 0, error, lastOkAt,
        shapes: shapes ? shapes.size : 0, layer: !!(layer && map.getLayer(BUS_LAYER_ID)), fps: layer?.fps ?? 0,
      };
    },
    labels: () => [],
    destroy() {
      destroyed = true; on = false;
      clearTimeout(pollTimer); clearTimeout(frameTimer);
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('click', onClick, true);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
      map.off('styledata', reattach);
      for (const id of [BUS_LAYER_ID, SEL_STOP, SEL_LINE]) { try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* gone */ } }
      try { if (map.getSource(SEL_SRC)) map.removeSource(SEL_SRC); } catch { /* gone */ }
    },
  };
  if (o.on) api.setOn(true);
  return api;
}
