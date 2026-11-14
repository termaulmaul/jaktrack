// The Tokyo trains on the map: mounts trains.js's WebGL layer, keeps it fed once a second, turns taps into
// open('train', runKey) (and open('station', id) where no network layer took the tap), and carries the picked line /
// train / station. The rail network and station names are style.js's network-layer.js; this draws only trains and
// the picked station's ring. Positions are timetable positions (Scheduled): the page says so, not this layer.
//
//   const layer = createLayer(map, model, { open, change, now, lang, sim, runs, typeStyle, typeLabel, lanePx, stationTaps })
//   model = the network (the data shapes (docs/ARCHITECTURE.md)); sim = model.js's createModel(model, runs) (made here from `runs` when absent).
//   layer.focus('line', lineId) · focus('train', runKey | runId) · focus('station', stationId | index) · focus(null)
//   layer.show(fn | null) · setLang('en' | 'ja' | 'id') · setTypes({ style, label }) · setInsets({ top, bottom, .. })
//   layer.setElevation(elevJson) · setUnderground('muted' | 'full') · setEnabled(bool) · count()
//   layer.stats() / labels() for QA · layer.destroy()
import { createTrains } from './trains.js';
import { createModel, running } from './model.js';
import { typeStyle, typeLabel } from './types.js';
import { lanePx, NET_LABELS_BEFORE } from './network-layer.js';

const collection = (features) => ({ type: 'FeatureCollection', features });
// a station where it is drawn: the network build's on-track point (station.pos), else MT3D's coordinate (62 of them sit
// 50-450 m off their track, e.g. JR Keiyo Tokyo 432 m: the data checks)
const lngLatOf = (s) => (Array.isArray(s.pos) && s.pos.length >= 2 ? s.pos : [s.lng, s.lat]);
const point = (s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: lngLatOf(s) }, properties: {} });
const noMedia = { matches: false, addEventListener() {}, removeEventListener() {} };

export function createLayer(map, model, opts = {}) {
  const { open, change, now = Date.now } = opts;
  const sim = opts.sim || (model.runById && model.runs ? model : createModel(model, opts.runs || []));
  const net = sim; // createModel copies the network's fields (lines, stations, types, dirs, groups)
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : noMedia;
  const doc = typeof document !== 'undefined' ? document : null;
  const ids = [], sources = [];
  let enabled = true, timer = 0, updates = 0, count = 0, picked = { type: null, id: null };
  const add = (layer, before) => { ids.push(layer.id); map.addLayer(layer, before); };
  const source = (id, data) => { sources.push(id); map.addSource(id, { type: 'geojson', data }); };
  const langOf = (l) => (l === 'ja' || l === 'id' ? l : 'en');
  const trains = createTrains(sim, {
    now, reduced, lang: langOf(opts.lang), lanePx: opts.lanePx || lanePx,
    // types.js: the stripe of each train type, and the type word of a map label ('' for locals)
    typeStyle: opts.typeStyle || typeStyle, typeLabel: (type, l) => (opts.typeLabel || typeLabel)(type, l, 'map'),
    label: opts.label, avoidMapLabels: opts.avoidMapLabels,
  });
  // the picked station: a dark ring under the trains (krl's), drawn only while a station is open
  source('tokyo-picked', collection([]));
  add({ id: 'tokyo-picked-ring', type: 'circle', source: 'tokyo-picked', paint: { 'circle-radius': 16, 'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': '#171717' } });
  // under the station names (style.js's network layer), over its lines and dots
  add(trains.layer, map.getLayer?.(NET_LABELS_BEFORE) ? NET_LABELS_BEFORE : undefined);

  // The page's own bars, buttons and sheet over the map: train labels keep out of them. Read from the DOM (these
  // selectors, opts.avoid to change, false = off) once a second and on resize; page.js's setInsets() still applies.
  const AVOID = opts.avoid === false ? [] : opts.avoid || ['#topbar > *', '#sched', '#ctrls > *', '#pane', '.credit', '#toast'];
  const rects = [];
  function readAvoid() {
    if (!AVOID.length || !doc?.querySelectorAll || !map.getCanvas()?.getBoundingClientRect) return;
    const c = map.getCanvas().getBoundingClientRect();
    rects.length = 0;
    try {
      for (const el of doc.querySelectorAll(AVOID.join(','))) {
        if (el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0) || r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom) continue;
        rects.push(r.left - c.left, r.top - c.top, r.right - c.left, r.bottom - c.top);
      }
    } catch { rects.length = 0; }
    trains.setAvoid(rects);
  }
  const onResize = () => readAvoid();
  globalThis.addEventListener?.('resize', onResize);

  // Once a second: the count for the page, and a frame for the trains when nothing else is drawing. The count is every
  // train the frame places (model.js's running(): the page's headline), standing at its first or last stop included, so the
  // page has ONE definition of "running".
  const running_ = () => trains.frame.update(now());
  function tick() {
    clearTimeout(timer); timer = 0;
    if (!enabled || doc?.hidden) return;
    readAvoid();
    count = running_(); updates++;
    change?.(count);
    trains.wake();
    timer = setTimeout(tick, 1000);
  }
  const visibility = () => { clearTimeout(timer); timer = 0; if (doc?.hidden) trains.stop(); else tick(); };
  doc?.addEventListener('visibilitychange', visibility);
  reduced.addEventListener?.('change', visibility);

  // Taps: a train (its label or its cars) first; else the nearest station within 22 px, unless something else (the
  // network layer) already handled the click. Captured before MapLibre's own handlers.
  const stationTaps = opts.stationTaps === true; // network-layer.js takes station taps (onStation); opt in without it
  const canvas = map.getCanvas();
  // A drag that ends on a train is a pan, not a tap: the DOM still fires 'click' after it (MapLibre's own click does
  // not), so a click more than 6 px from its pointerdown is ignored.
  let downX = NaN, downY = NaN;
  const down = (e) => { downX = e.clientX; downY = e.clientY; };
  const hit = (e) => {
    const dragged = Number.isFinite(downX) && Math.hypot(e.clientX - downX, e.clientY - downY) > 6;
    downX = downY = NaN;   // one pointerdown per click (a click with none, e.g. synthetic, counts as a tap)
    if (!enabled || dragged) return;
    const rect = canvas.getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    const run = trains.hit(x, y);
    if (run) { e.preventDefault(); e.stopImmediatePropagation(); open?.('train', run.key || run.id, 'map'); return; }
    if (!stationTaps || map.getZoom() < 11) return;
    let best = null, bd = 22;
    for (const s of net.stations) {
      const q = map.project(lngLatOf(s)), d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return;
    e.preventDefault(); e.stopImmediatePropagation(); open?.('station', best.id, 'map');
  };
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('click', hit, true);
  tick();

  // the heights build's tunnels (where a line dives below the street): given, else fetched once from the data folder
  // (elev-latest.json names the file). Without them the stations' underground flags decide.
  let gone = false;
  if (opts.elev && typeof opts.elev === 'object') trains.setElevation(opts.elev);
  else if (opts.elev !== false && typeof fetch === 'function' && typeof location !== 'undefined') {
    (async () => {
      try {
        const base = new URL(opts.dataBase || '/data/tokyo/', location.href);
        const ptr = await fetch(new URL('elev-latest.json', base)).then((r) => (r.ok ? r.json() : null));
        const res = await fetch(new URL(ptr?.file || 'elev-v1.json', base));
        if (!res.ok) return;
        const json = await res.json();
        if (!gone) trains.setElevation(json);
      } catch { /* keep the station flags */ }
    })();
  }

  const stationOf = (id) => (typeof id === 'number' ? net.stations[id] : net.stationById?.get(id) || net.stations.find((s) => s.id === id)) || null;
  const lineOf = (id) => (typeof id === 'number' ? net.lines[id] : net.lineById?.get(id) || net.lines.find((l) => l.id === id)) || null;
  // a run by id, or by key (the page's #t=): the one on the map now, else the first of the day
  const runOf = (id) => {
    if (id == null) return null;
    const r = sim.runById?.get(id);
    if (r) return r;
    const f = trains.frame, n = f.update(now());
    for (let i = 0; i < n; i++) if (f.runs[i].key === id) return f.runs[i];
    return sim.runs?.find((x) => x.key === id) || null;
  };
  return {
    trains, sim,
    setEnabled(on) {
      enabled = !!on;
      for (const id of ids) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
      if (!on) trains.stop();
      visibility();
    },
    /** Pick a line (its trains stay bright, the rest dim; fit = show it whole), a train (run key or id: drawn on top,
     * label first; fit = ease to it) or a station (a ring; fit = ease to it). focus(null) clears. */
    focus(type, id, fit = true) {
      picked = { type: type || null, id: id ?? null };
      const run = type === 'train' ? runOf(id) : null;
      const line = type === 'line' ? lineOf(id) : run ? net.lines[run.line] : null;
      const lineIx = line ? net.lines.indexOf(line) : null;
      trains.setFocus(type === 'line' || type === 'train' ? lineIx : null, type === 'train' ? (run ? run.id : id) : null);
      const station = type === 'station' ? stationOf(id) : null;
      // the ring only while this layer takes the station taps: with style.js's network layer (stationTaps false) that
      // layer rings the picked station itself (tk-sel), and a second ring here sat beside it over the name
      map.getSource('tokyo-picked')?.setData(collection(station && stationTaps ? [point(station)] : []));
      const duration = reduced.matches ? 0 : 450;
      if (fit && line && type === 'line' && line.path?.length) {
        const b = [[Infinity, Infinity], [-Infinity, -Infinity]];
        for (const p of line.path) for (let i = 0; i < 2; i++) { b[0][i] = Math.min(b[0][i], p[i]); b[1][i] = Math.max(b[1][i], p[i]); }
        map.fitBounds(b, { maxZoom: 13, padding: 48, duration: reduced.matches ? 0 : 500 });
      } else if (fit && type === 'train') {
        const p = trains.positions(now()).find((q) => q.id === id || q.run.key === id);
        if (p) map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(14.5, map.getZoom()), duration });
      } else if (fit && station) map.easeTo({ center: lngLatOf(station), zoom: Math.max(14, map.getZoom()), duration });
      if (enabled) tick();
    },
    /** Only the trains fn(run) keeps on the map (null: all): the page's line / operator chips. */
    show(fn) { trains.setShow(fn); if (enabled) tick(); },
    setLang(l) { trains.setLang(langOf(l)); },
    setTypes(t) { trains.setTypes(t || {}); },
    setLanePx(fn) { trains.setLanePx(fn); },
    /** the heights build's elev-v1.json, when the page has it already (saves the layer's own fetch). */
    setElevation(json) { trains.setElevation(json); },
    /** 'exact' (default: the line's exact colour, ODPT guideline 4), 'full' (the underground view); 'muted' unused. */
    setUnderground(look) { trains.setUnderground(look); },
    /** hide the 2D trainsets while the 3D view draws every train (taps then find none here). */
    setHidden(h) { trains.setHidden(h); },
    /** Live marks on (default) or off: measured trains get a thin ring in their line colour and "+3 min" in the label. */
    setLive(on) { trains.setLive(on); },
    /** Keep train labels clear of the page's bars and sheet: { top, right, bottom, left } css px or fn(W, H). */
    setInsets(v) { trains.setInsets(v); },
    /** Trains running now, whole network: every train the frame places (= model.js running(), the page's headline). */
    count: () => count,
    /** For QA and window.__tokyo: running (whole network), drawn (trainsets placed in the last frame, in view),
     * onScreen, labels shown, fps (frames drawn in the last second), CPU ms per frame and per placement. */
    stats() {
      const s = trains.stats();
      return { running: count, drawn: s.trains, onScreen: s.trains, below: s.below, live: s.live, avoid: s.avoid, cars: s.cars, labels: s.labels, fps: s.fps, cpuMs: s.cpuMs, arrangeMs: s.arrangeMs, arrangeLast: s.arrangeLast, frameLast: s.frameLast, placements: s.placements, frames: s.frames };
    },
    /** Train labels drawn now (WebGL, outside MapLibre's symbols): [{ kind: 'train', id, text, x, y, w, h }] css px. */
    labels: () => trains.shownLabels().map((l) => ({ kind: 'train', id: l.id, text: l.text, x: l.x0, y: l.y0, w: l.x1 - l.x0, h: l.y1 - l.y0 })),
    debug: () => ({ enabled, running: count, updates, ticking: !!timer, picked, trains: trains.stats(), list: running(sim, now()).length }),
    destroy() {
      gone = true; clearTimeout(timer); trains.stop(); canvas.removeEventListener('click', hit, true); canvas.removeEventListener('pointerdown', down, true); globalThis.removeEventListener?.('resize', onResize);
      doc?.removeEventListener('visibilitychange', visibility); reduced.removeEventListener?.('change', visibility);
      ids.slice().reverse().forEach((id) => map.removeLayer(id)); sources.forEach((id) => map.removeSource(id));
      ids.length = 0; sources.length = 0;
    },
  };
}
