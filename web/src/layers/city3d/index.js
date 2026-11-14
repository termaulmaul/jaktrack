// 3D view: a calm 3D city (grey buildings, trains on
// viaducts, train labels in 3D) remade for Greater Tokyo, plus an underground view after Mini Tokyo 3D's eye button,
// done our calm way. The page mounts it on its map and drives it from its 3D button:
//
//   const c3d = await mountCity3d(map, { model, sim, runs, lang })
//     model  the network (docs/ARCHITECTURE.md "In memory": lines, stations,...); `net` is taken as a synonym
//     sim    model.js's createModel() result (web/src/tokyo/model.js): positions come from its createFrame(); without it, the
//            runs (the run shape, docs/ARCHITECTURE.md) are placed by track.js's own timetable placement
//     elev   the heights build's elev-v1.json, parsed (optional: fetched from /data/tokyo/elev-v1.json, else elevation.js's heuristic)
//     lang   'en' | 'ja' | 'id' (labels: trains.js's trainLabel, the same text as the 2D trains)
//     beforeId  the layer the 3D trains go under (default: under the labels, over every line and dot)
//     layer2d  trains.js's createLayer() object: hidden while the 3D trains draw (its setHidden, else setEnabled; without
//            it the 'tokyo-trains' layer's visibility); hide2d(bool) instead, to do it yourself
//     open(type, id, from)  the page's opener: a tap on a 3D train calls open('train', run.key || run.id, 'map')
//   c3d.setOn(true | false)          buildings, viaducts, 3D trains and their labels; a flat map tilts to 60
//   c3d.setUnderground(true | false) the city and the ground fade, subway lines and their trains show at depth
//   c3d.flyTo('shinjuku' | 'shibuya' | 'tokyo' | 'ikebukuro' | { center, zoom, pitch, bearing })
//   c3d.pick(x, y) -> { id, run, line } | null   the 3D train under a tap (css px on the map canvas)
//   c3d.setSelected(runId), c3d.setLang(lang), c3d.labels(), c3d.state(), c3d.destroy()
//   (setEnabled and show are aliases of setOn, for page.js)
//   one tap from the map's card (page.js #b-ug):
//   await c3d.enterUnderground({ place?: { center: [lng, lat], zoom? }, preset?: 'otemachi' | ... }) -> bool
//     3D on (no tilt of its own), the underground view, the camera: the place given (a station sheet's "See it
//     underground"), else from far out (zoom < UG_NEAR_Z, the opening view) a flight to Otemachi, else the current place
//     tilted to UG_PITCH at a zoom where the levels separate. Remembers the camera it left.
//   await c3d.exitUnderground() -> { cam }: the underground off, the camera back where enterUnderground found it (3D
//     itself stays as the page has it: the page turns 3D off again when it was off before). setOn(false) while the
//     underground is on also puts that camera back.
//   setOn(on, { tilt: false }) = no tilt / zoom of its own (the page's quiet toggle3D while the underground drives).
//
// What draws what:
//   - buildings.js: the tile server's tokyo-bld-v1 as calm grey fill-extrusions; the style's own `bld-3d`
//     is used instead when it is there, so the city never doubles;
//   - viaduct.js: decks and columns under every elevated stretch, built here from the network and the heights;
//   - vehicles.js: the trains as boxes on their track's height (viaduct, grade, tunnel), the underground view's veil and
//     the subway ribbons at depth;
//   - labels.js: the trains' labels over the map.
// Every screen with trains says "Scheduled" or, on a live train, "Live position" (the page's own chip).
// With `sim` (the page passes it) the positions come from model.js's createFrame on the page clock: the same places as the 2D
// trains, live and estimated delays included (the frame's lag state lives in the model and is shared with the 2D
// layer). Only without sim do runs fall back to track.js's own timetable placement.

import { profiles as makeProfiles, ELEV_URL } from './elevation.js';
import { viaductData, addViaduct, showViaduct, removeViaduct, VIADUCT_IDS } from './viaduct.js';
import { buildingSpec, addBuildings, showBuildings, removeBuildings, BLD_ID } from './buildings.js';
import { createTrains3d, TRAINS3D_ID } from './vehicles.js';
import { carSpec } from './trainset.js';   // the Behind eye per line (its cars' height / pantograph)
import { UG_MIN_Z } from './underground.js';
import { patchProfiles, localTracks, localPlatforms } from './real.js';
import { decodeTunnels } from '../../tokyo/tunnels.js';
/** the underground view r3b: the real depth pack and the real alignments. Switched on
 * once the files are READY (no fetch before, so no 404 in the console); null = elev-v1 / our line paths only. */
export const ELEV2_URL = '/data/tokyo/elev-v2.json';
export const TUNNELS_URL = '/data/tokyo/tunnels-v1.json';
import * as I18N from '../../tokyo/i18n.js';
import { createLabels } from './labels.js';
import { placeRun, serviceSec, timesOf, PRE_S, POST_S, toLngLat, toLocal } from './track.js';
import * as SIM from '../../tokyo/model.js';
import * as TG from '../../tokyo/trains.js';
import * as TY from '../../tokyo/types.js';
import { PRESETS, TEXT, TILT, UG_PRESETS, UG_PITCH, UG_ZOOM, UG_NEAR_Z } from './presets.js';
import { mountCity3dControls } from './controls.js';

export { PRESETS, TEXT, TILT, UG_PRESETS, UG_PITCH, UG_ZOOM, UG_NEAR_Z, mountCity3dControls };

// the 3D trains from this zoom (2D trainsets below it, where a viaduct's height is a pixel); back to 2D below Z_2D
export const Z_3D = 14.5, Z_2D = 14.2;
const BLD_STYLE = 'bld-3d';   // style.js's own 3D buildings layer (same tiles)
// the basemap's street and district names go while the underground view shows (under the veil
// they are noise, and MapLibre's collision grid kept the trains' labels out); station names (the network's) stay
export const UG_HIDE = ['road-label-minor', 'road-label-major', 'hood-label', 'district-label'];
// a calm 3D light: soft walls, so the grey city stays calm; set while
// 3D is on, the style's own light back when it is off
export const LIGHT = { anchor: 'viewport', color: '#ffffff', intensity: 0.26, position: [1.4, 210, 38] };
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const order = (map) => (typeof map.getLayersOrder === 'function' ? map.getLayersOrder() : (map.getStyle()?.layers || []).map((l) => l.id));

/** Why this device stays flat ('' = it can take the 3D view): the trains layer is WebGL2. */
export function gateReason(map) {
  const gl = map?.painter?.context?.gl;
  if (typeof WebGL2RenderingContext === 'undefined') return 'webgl2';
  if (gl && !(gl instanceof WebGL2RenderingContext)) return 'webgl2';
  return '';
}

/** Where the 3D trains go: right above the topmost line / circle / fill / custom layer that has a label above it, i.e.
 * under every label and over every line and dot. */
export function trainsBefore(map, own = []) {
  const ids = order(map).filter((id) => !own.includes(id));
  let last = -1;
  for (let i = 0; i < ids.length; i++) {
    const t = map.getLayer(ids[i])?.type;
    if (t && t !== 'symbol') last = i;
  }
  return ids[last + 1];
}

/** The positions: model.js's frames (zero allocation), else our own placement of the runs. Each item: { id, run, line, s
 * (m on the chain, the train's middle), dir, cars, look }. */
function makeSource(net, sim, runs, lookOf) {
  const out = [], pool = [];
  const item = (i) => pool[i] || (pool[i] = {});
  if (sim && typeof SIM.createFrame === 'function' && Array.isArray(sim._geo)) {
    const f = SIM.createFrame(sim, 1024);
    return (ms) => {
      const n = f.update(ms);
      out.length = 0;
      for (let i = 0; i < n; i++) {
        if (f.alpha[i] < 0.05) continue;
        const run = f.runs[i], o = item(out.length);
        o.id = run.id; o.run = run; o.line = f.line[i]; o.s = f.along[i]; o.dir = f.sign[i] < 0 ? -1 : 1;
        o.cars = run.cars || net.lines[o.line]?.cars || 10; o.look = lookOf(run);
        // live.js (live.js -> model.measured, model.js's frame live 1): a fresh measured position; 2 = estimated (no mark)
        o.live = f.live ? f.live[i] === 1 : false;
        out.push(o);
      }
      return out;
    };
  }
  const list = Array.isArray(runs) ? runs : [];
  let active = [], key = -1;
  return (ms) => {
    const sec = serviceSec(ms), k = Math.floor(sec / 20);
    if (k !== key) {
      key = k;
      active = list.filter((r) => { const tm = timesOf(r); return tm.first - PRE_S <= sec + 20 && tm.last + POST_S >= sec; });
    }
    out.length = 0;
    for (const run of active) {
      const line = net.lines[run.line];
      if (!line) continue;
      const p = placeRun(run, line, sec);
      if (!p) continue;
      const o = item(out.length);
      o.id = run.id; o.run = run; o.line = run.line; o.s = p.s; o.dir = p.dir;
      o.cars = run.cars || line.cars || 10; o.look = lookOf(run); o.live = false;   // timetable placement: never live
      out.push(o);
    }
    return out;
  };
}

export async function mountCity3d(map, opts = {}) {
  const net = opts.net || opts.model || opts.sim;
  if (!map || !net?.lines) throw new Error('mountCity3d: needs a map and the network (model.lines)');
  const sim = opts.sim && Array.isArray(opts.sim._geo) ? opts.sim : (Array.isArray(opts.model?._geo) ? opts.model : null);
  let lang = opts.lang || 'en';
  const S = {
    on: false, underground: false, built: false, reason: gateReason(map), tilted: 0, bldOwn: false, bldWas: null,
    profiles: null, viaduct: null, trains: null, labels: null, elevSource: 'heuristic', selected: null,
    hidden2d: false, trains3d: null,
  };

  // ------------------------------------------------------------------ labels and looks (trains.js's, same as 2D)
  const labelCache = new Map();
  const textOf = (t) => {
    const run = t.run;
    if (!run) return t.label || '';
    const key = `${lang}|${run.id}`;
    let s = labelCache.get(key);
    if (s == null) {
      try {
        s = typeof opts.labelOf === 'function' ? opts.labelOf(run, lang)
          : typeof TG.trainLabel === 'function' ? TG.trainLabel(sim || net, run, lang, typeof TY.typeLabel === 'function' ? (type, l) => TY.typeLabel(type, l, 'map') : null)
            : '';
      } catch { s = ''; }
      if (!s) {
        const d = run.to?.[0] ?? run.stops?.[run.stops.length - 1]?.s;
        const nm = net.stations?.[d]?.name;
        s = nm ? (lang === 'ja' ? `${nm.ja || nm.en}行` : `→ ${nm.en || nm.ja}`) : (run.number || '');
      }
      if (labelCache.size > 5000) labelCache.clear();
      labelCache.set(key, s);
    }
    return s;
  };
  // the label's extras: a fresh live train's green dot (both 3D views); in the underground view an underground train's
  // line chip (its letter in a round chip of its colour: "line + destination" at depth)
  const decoOf = (t, mode) => {
    const live = !!t.liveShown;
    if (!mode?.underground || !t.under) return live ? { live } : null;
    const line = net.lines[t.line];
    const code = line?.code ? String(line.code).slice(0, 3) : '';
    return code || live ? { live, code, color: line?.color || null } : null;
  };
  const lookCache = new Map();
  const lookOf = (run) => {
    const k = `${run.line}|${run.type}`;
    let v = lookCache.get(k);
    if (v === undefined) {
      v = null;
      try {
        // the 2D trainsets' own look (trains.js's lookFrom: types.js's typeStyle decides the stripe, the body stays the
        // line's colour unless it names one; without types.js, trains.js's defaultLook)
        const line = net.lines[run.line], type = net.types?.[run.type];
        const hx = (c) => (typeof c === 'number' ? `#${(c & 0xffffff).toString(16).padStart(6, '0')}` : typeof c === 'string' ? c : null);
        const st = typeof TY.typeStyle === 'function' ? TY.typeStyle(type, line, run) : null;
        if (st && typeof st === 'object') {
          const body = st.body ?? st.fill ?? st.color ?? st.colour, band = st.band ?? st.stripe ?? st.accent;
          const lc = line?.color || null;
          v = { body: typeof body === 'string' ? body : lc, band: band === null ? null : typeof band === 'string' ? band : null, weight: band === null ? 0 : (st.weight ?? 0.36) };
          if (!v.body) v = null;
        } else if (typeof TG.defaultLook === 'function') {
          const L = TG.defaultLook(line, type);
          if (L?.body != null) v = { body: hx(L.body), band: L.weight > 0 ? hx(L.band) : null, weight: L.weight };
        }
      } catch { v = null; }
      lookCache.set(k, v);
    }
    return v;
  };

  // ------------------------------------------------------------------ heights
  async function loadElev() {
    if (opts.elev !== undefined) return opts.elev;
    try {
      const r = await fetch(ELEV_URL);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  // ------------------------------------------------------------------ the 2D trainsets give way while 3D draws
  // trains.js's layer object: handed in (layer2d), else the page's own (page.js keeps it at window.__tokyo.state.layer)
  const layer2d = () => opts.layer2d || globalThis.__tokyo?.state?.layer || null;
  function hide2d(on) {
    if (S.hidden2d === on) return;
    S.hidden2d = on;
    try {
      if (typeof opts.hide2d === 'function') { opts.hide2d(on); return; }
      // agreed with setHidden(true) = no drawing and no taps, count kept live;
      // until it exists setEnabled(false) (taps off too, so a tap never opens a train at an old 2D position)
      const L = layer2d();
      if (L?.setHidden) { L.setHidden(on); S.hideVia = 'setHidden'; return; }
      if (L?.setEnabled) { L.setEnabled(!on); S.hideVia = 'setEnabled'; return; }
      if (L?.setVisible) { L.setVisible(!on); S.hideVia = 'setVisible'; return; }
      // no layer object: trains.js's custom layer (web/src/tokyo/trains.js id 'tokyo-trains') by visibility
      for (const id of ['tokyo-trains']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
      S.hideVia = 'visibility';
    } catch (e) { console.warn('[city3d] hide 2D trains', e); }
  }

  // Taps while 3D draws: a 3D train under the finger opens it (the 2D trains' own taps are off with them). Captured
  // before MapLibre's handlers, like trains.js's.
  const canvas = map.getCanvas();
  const onTap = (e) => {
    if (!S.on || !S.trains || typeof opts.open !== 'function') return;
    const r = canvas.getBoundingClientRect();
    const hit = S.trains.pick(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    opts.open('train', hit.run?.key || hit.id, 'map');
  };
  canvas.addEventListener('click', onTap, true);

  // ------------------------------------------------------------------ build once, when 3D first shows
  async function build() {
    if (S.built) return;
    const elev = await loadElev();
    S.elevSource = elev ? 'elev' : 'heuristic';
    S.profiles = makeProfiles(net, elev);
    // real depths, sections and confidence (elev-v2) over elev-v1 where they exist
    S.real = null;
    const v2 = opts.elev2 !== undefined ? opts.elev2 : ELEV2_URL ? await fetch(ELEV2_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
    if (v2) { try { S.real = patchProfiles(net, S.profiles, v2); S.profiles = S.real.profiles; S.elevSource = 'elev2'; } catch (e) { console.warn('[city3d] elev-v2', e); S.real = null; } }
    S.tracks = null;
    const tv = opts.tunnels !== undefined ? opts.tunnels : TUNNELS_URL ? await fetch(TUNNELS_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
    S.platforms = null;
    if (tv) { try { const dec = decodeTunnels(tv); S.tracks = localTracks(net, dec, toLocal); S.platforms = localPlatforms(net, dec, toLocal); } catch (e) { console.warn('[city3d] tunnels-v1', e); S.tracks = null; } }
    // the viaducts (4.3 MB of GeoJSON, ~17k extrusions) are built the first time the CITY shows (showCity): the one-tap
    // underground view never needs them
    S.viaOnMap = false;
    // buildings: the style's own bld-3d if it has one, else ours
    if (map.getLayer(BLD_STYLE)?.type === 'fill-extrusion') {
      S.bldOwn = false;
      S.bldWas = map.getLayoutProperty(BLD_STYLE, 'visibility') || 'visible';
    } else {
      const spec = await buildingSpec();
      addBuildings(map, spec, { before: trainsBefore(map) });
      S.bldOwn = true;
    }
    // viaducts (showCity, later) go right under the 3D trains: over the ground's lines and dots (a deck hides the 2D line
    // under it; the deck carries its line's colour and its trains in 3D), under the labels
    const given = opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : null;
    // the 3D trains and their labels, right above the decks
    S.labels = createLabels(map, { text: textOf, deco: decoOf, area: labelArea });
    // the page clock (a playback moves the 3D trains too); page.js passes now: NOW
    S.trains = createTrains3d({ net, profiles: S.profiles, real: S.real, tracks: S.tracks, platforms: S.platforms, source: makeSource(net, sim, opts.runs || sim?.runs, lookOf), labels: S.labels, reduced: reduced(), now: typeof opts.now === 'function' ? opts.now : undefined });
    map.addLayer(S.trains.layer, given || trainsBefore(map, [TRAINS3D_ID]));
    S.built = true;
    if (S.selected != null) api.setSelected(S.selected);
    else if (S.line != null) S.trains.setLine(S.line);
  }

  function showCity(on) {
    if (on && S.built && !S.viaOnMap) {
      try {
        S.viaduct = S.viaduct || viaductData(net, S.profiles, { bounds: opts.bounds });
        addViaduct(map, S.viaduct, { before: map.getLayer(TRAINS3D_ID) ? TRAINS3D_ID : trainsBefore(map) });
        S.viaOnMap = true;
      } catch (e) { console.warn('[city3d] viaducts', e); }
    }
    if (S.bldOwn) showBuildings(map, on);
    else if (map.getLayer(BLD_STYLE)) map.setLayoutProperty(BLD_STYLE, 'visibility', on ? 'visible' : (S.bldWas || 'none'));
    showViaduct(map, on);
  }

  // where 3D labels may go (css px on the map canvas): setInsets() when the page gives them, else the map's padding
  // (page.js sets it: the top bar and the Scheduled pill row above, the sheet's peek below, the controls' column right),
  // and never over our own chip row
  function labelArea() {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const p = S.insets || (typeof map.getPadding === 'function' ? map.getPadding() : null) || {};
    const a = { l: p.left || 0, t: p.top || 0, r: W - (p.right || 0), b: H - (p.bottom || 0) };
    const el = S.ctlEl;
    if (el && !el.hidden && el.isConnected) {
      const rr = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
      if (rr.height > 0 && rr.top - cr.top < H / 2) a.t = Math.max(a.t, rr.bottom - cr.top);
    }
    if (fly.active()) a.holes = fly.holes();   // no label under its pad, buttons or key card
    return a;
  }

  // who wants to know when 3D or the underground view turns on or off (controls.js)
  const listeners = new Set();
  const changed = () => { for (const fn of [...listeners]) { try { fn(api.state()); } catch (e) { console.warn('[city3d] onChange', e); } } };

  // 3D trains at street zoom, the 2D trainsets at city zoom (the underground view keeps its 3D trains at any zoom)
  function syncZoom() {
    if (!S.on || !S.trains) return;
    const z = map.getZoom();
    // the underground keeps its 3D trains from UG_MIN_Z; further out (all of Kanto) it draws nothing, the
    // 2D trainsets come back and a calm note says to zoom in (the state stays: zoom in and it is there again)
    const ugFar = S.underground && z < UG_MIN_Z;
    const want = ugFar ? false : S.underground || (S.trains3d ? z >= Z_2D : z >= Z_3D);
    if (want !== S.trains3d) {
      S.trains3d = want;
      S.trains.setMode({ trains: want });
      hide2d(want);
    }
    ugNote(ugFar);
  }
  map.on('zoom', syncZoom);

  // the "Zoom in to see the underground" note: a calm pill, not a button
  function ugNote(show) {
    if (!show) { if (S.noteEl) S.noteEl.hidden = true; return; }
    if (!S.noteEl) {
      const el = document.createElement('div');
      el.className = 'tk3d-ugnote';
      el.setAttribute('role', 'status');
      Object.assign(el.style, { position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: '2', pointerEvents: 'none',
        padding: '8px 14px', borderRadius: '999px', background: 'var(--realm-card, #fff)', color: 'var(--text, #171717)',
        boxShadow: 'var(--realm-shadow, 0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.07))',
        font: '600 13px/1.2 var(--font, -apple-system, system-ui, sans-serif)', whiteSpace: 'nowrap' });
      (map.getCanvasContainer?.() || canvas.parentElement).appendChild(el);
      S.noteEl = el;
    }
    let text = '';
    try { text = typeof I18N.has === 'function' && I18N.has('city3d.ug.zoomin') ? I18N.t('city3d.ug.zoomin') : ''; } catch { text = ''; }
    S.noteEl.textContent = text || (TEXT[lang] || TEXT.en).zoomIn;
    const a = labelArea();
    S.noteEl.style.top = `${Math.round(a.t + 12)}px`;
    S.noteEl.style.left = `${Math.round((a.l + a.r) / 2)}px`;
    S.noteEl.hidden = false;
  }

  // a new style drops our layers: put them back (the page's setStyle on a language switch)
  const onStyle = () => {
    if (!S.on || !S.built || map.getLayer(TRAINS3D_ID)) return;
    fly.stop({ quiet: true });   // the trains layer is rebuilt under it
    try {
      S.built = false;
      S.trains?.destroy(); S.labels?.destroy();
      S.ugHidden = null;   // a new style: its names are visible again
      S.viaOnMap = false;  // ... and none of our layers
      build().then(() => { showCity(!S.underground); S.trains.setMode({ on: true, underground: S.underground }); ugLabels(S.underground); }).catch((e) => console.warn('[city3d] rebuild', e));
    } catch (e) { console.warn('[city3d] style', e); }
  };
  map.on('style.load', onStyle);

  async function setOn(on, o = {}) {
    const r = await setOn_(on, o);
    changed();
    return r;
  }
  async function setOn_(on, o = {}) {
    on = !!on;
    if (on && S.reason) { S.on = false; return false; }
    if (on === S.on) return S.on;
    S.on = on;
    if (on) {
      await build();
      if (!S.on) return false;   // switched off while it built
      // quiet (tilt: false = the caller drives the view; the underground's one tap turns the underground on right after):
      // the city waits a frame, so a city the underground hides again is never loaded
      if (o.tilt === false) requestAnimationFrame(() => { if (S.on && !S.underground) showCity(true); });
      else showCity(!S.underground);
      S.trains.setMode({ on: true, underground: S.underground });
      S.trains3d = null;
      syncZoom();
      try { S.light = S.light ?? (map.getLight?.() || null); map.setLight(LIGHT); } catch (e) { console.warn('[city3d] light', e); }
      if (opts.tilt !== false && o.tilt !== false && map.getPitch() < 5) {
        S.tilted = TILT;
        map.easeTo({ pitch: TILT, zoom: Math.max(map.getZoom(), 14.8), duration: reduced() ? 0 : 900 });
      }
    } else {
      S.underground = false;
      fly.stop({ quiet: true });   // Fly
      stopRide(true);
      ugLabels(false);
      ugNote(false);
      if (S.built) { showCity(false); S.trains.setMode({ on: false, underground: false }); }
      hide2d(false);
      try { if (S.light !== undefined) { map.setLight(S.light || { anchor: 'viewport', intensity: 0.5, position: [1.15, 210, 30], color: '#ffffff' }); S.light = undefined; } } catch (e) { console.warn('[city3d] light', e); }
      // turned off while the underground was on: the camera the underground found (flat again if 3D had tilted it)
      if (S.ugBack) { const b = S.ugBack; S.ugBack = null; S.tilted = 0; if (o.tilt !== false) go(b.wasOn && b.tilted ? { ...b.cam, pitch: 0 } : b.cam, 900); }
      if (S.tilted && Math.abs(map.getPitch() - S.tilted) < 1 && o.tilt !== false) map.easeTo({ pitch: 0, duration: reduced() ? 0 : 700 });
      S.tilted = 0;
      if (!S.bldOwn && S.built && map.getLayer(BLD_STYLE)) map.setLayoutProperty(BLD_STYLE, 'visibility', S.bldWas || 'none');
    }
    return S.on;
  }

  function setUnderground(on) {
    const r = setUnderground_(on);
    changed();
    return r;
  }
  // the basemap names UG_HIDE hide while the underground shows, each back to what it was
  function ugLabels(hide) {
    if (hide === !!S.ugHidden) return;
    try {
      if (hide) {
        S.ugHidden = {};
        for (const id of UG_HIDE) if (map.getLayer(id)) { S.ugHidden[id] = map.getLayoutProperty(id, 'visibility') || 'visible'; map.setLayoutProperty(id, 'visibility', 'none'); }
      } else {
        for (const [id, v] of Object.entries(S.ugHidden || {})) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
        S.ugHidden = null;
      }
    } catch (e) { console.warn('[city3d] underground names', e); }
  }
  function setUnderground_(on, o = {}) {
    S.underground = !!on && S.on;
    if (!S.underground) { S.ugBack = null; stopRide(true); }
    ugLabels(S.underground);
    if (!S.built) return S.underground;
    showCity(S.on && !S.underground);
    S.trains.setMode({ on: S.on, underground: S.underground });
    syncZoom();
    // depth reads only on a tilted map
    if (S.underground && o.tilt !== false && map.getPitch() < 30) map.easeTo({ pitch: 50, duration: reduced() ? 0 : 700 });
    return S.underground;
  }

  // ------------------------------------------------------------------ one tap from the map
  const camOf = () => { const c = map.getCenter(); return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }; };
  function go(view, ms = 2400) {
    if (!view?.center) return;
    const v = { center: view.center, zoom: view.zoom, pitch: view.pitch, bearing: view.bearing };
    if (reduced()) map.jumpTo(v);
    else if (ms >= 1500) map.flyTo({ ...v, duration: ms, essential: true });
    else map.easeTo({ ...v, duration: ms, essential: true });
  }
  async function enterUnderground(o = {}) {
    if (S.reason) return false;
    if (fly.active()) fly.stop({ quiet: true });   // the camera the underground keeps is a normal one
    const cam = camOf();
    if (!S.underground) S.ugBack = { cam, wasOn: S.on, tilted: S.tilted };
    const back = S.ugBack;
    if (!S.on) { await setOn_(true, { tilt: false }); if (!S.on) { S.ugBack = null; changed(); return false; } }
    S.tilted = 0;
    setUnderground_(true, { tilt: false });
    S.ugBack = back;
    const z = map.getZoom();
    let view;
    if (o.place?.center) view = { center: o.place.center, zoom: o.place.zoom ?? Math.max(UG_ZOOM, Math.min(17, z)), pitch: UG_PITCH, bearing: map.getBearing() };
    else if (o.preset && UG_PRESETS[o.preset]) view = UG_PRESETS[o.preset];
    // far out (the opening view), or no underground station in view (Jakarta: only MRT Senayan–Bundaran HI is underground,
    // so most of the map would show an empty veil): fly to where there is something to see
    else if (z < UG_NEAR_Z || !(net.stations || []).some((s) => s.underground && map.getBounds().contains([s.lng, s.lat]))) view = UG_PRESETS.otemachi;
    else view = { center: cam.center, zoom: Math.max(15, Math.min(17, z)), pitch: Math.max(UG_PITCH, Math.min(70, cam.pitch)), bearing: cam.bearing };
    go(view, o.place?.center || view === UG_PRESETS[o.preset] || view === UG_PRESETS.otemachi ? 2400 : 900);
    changed();
    return true;
  }
  async function exitUnderground() {
    if (fly.active()) fly.stop({ quiet: true });   // Fly
    const back = S.ugBack;
    S.ugBack = null;
    setUnderground_(false, { tilt: false });
    if (back) S.tilted = back.tilted || 0;   // a later 3D off flattens what 3D tilted, as before
    if (back?.cam) go(back.cam, 900);
    changed();
    return back ? { cam: back.cam, wasOn: back.wasOn } : null;
  }

  // ------------------------------------------------------------------ the underground view round 3: true scale + ride-along
  /** Real proportions (depth x1, no px floors) or the UG_EXAG view. */
  function setTrueScale(on) {
    S.trueScale = !!on;
    S.trains?.setExag(S.trueScale ? 1 : undefined);
    fly.update();   // the tunnels moved under the eye
    changed();
    return S.trueScale;
  }
  // Ride along a train in its tunnel. The ridden line is lifted to MapLibre's ground plane (vehicles.js
  // u_lift) so its camera can chase the train: just behind and above it, looking along the bore, no roll, eased (no jolt);
  // in true scale (real proportions; the other lines pass at their real depths). Reduced motion: a still view that steps
  // to the train every RIDE_STEP_MS. Back (another screen), Reset view, underground off or 3D off end the ride.
  // r3d: Behind = the camera in the bore just behind / over the train's last car (looking along it); Cab = the driver's
  // view out of the front window, 2.6 m over the rail, looking down the tunnel (calculateCameraOptionsFromTo)
  // Behind: the eye on the train's own track behind its tail, just over its roof, looking at its end face
  // (behindCam / behindGap below; calculateCameraOptionsFromTo like the Cab)
  const RIDE = { ahead: 16, zoom: 22, pitch: 79, stepMs: 7000, maxZoom: 24, eye: 2.6, look: 70 };
  // (b): the Behind camera per line, from its cars (trainset carSpec): the eye just over the roof units (roof +
  // 0.15 m), kept 0.45 m under the overhead bar where the line has one (Oedo: roof 3.18, bar 3.60 -> 3.15; 20 m cars with
  // pantographs: 3.99 under the 4.44 bar), ON the train's own track behind its tail (vehicles.js rideTrackAt), looking
  // at the middle of the last car's end face. The gap: the distance where that end face takes ~45 % of the visible map
  // width (a phone held upright ~18 m, a desktop ~8 m), x the rider's own zoom (wheel / pinch: R.gapK). An earlier
  // 3.66 m eye 11 m along the middle car's heading put the Oedo's bar through the view, the tail under the top buttons
  // on a phone and the eye into the bore's wall on curves.
  const EYE = new Map();
  const behindCam = (li) => {
    let e = EYE.get(li);
    if (!e) {
      const sp = carSpec(net.lines[li]?.id, null, 1, 8);
      let eye = (sp.roof || sp.height) + 0.15;
      if (sp.wire > 0) eye = Math.min(eye, sp.wire - 0.45);
      e = { eye: Math.max(2.4, Math.min(4.3, eye)), aim: (sp.floor + sp.height) / 2, width: sp.width };
      EYE.set(li, e);
    }
    return e;
  };
  const behindGap = (bc, k = 1) => {
    const el = map.getCanvas(), pad = map.getPadding?.() || {};
    const wv = Math.max(200, (el.clientWidth || 390) - (pad.left || 0) - (pad.right || 0));
    const f = map.transform?.cameraToCenterDistance || 1.5 * (el.clientHeight || 844);   // focal length (css px)
    return Math.max(6, Math.min(40, (bc.width * f) / (0.45 * wv) * k));
  };
  // tiles while riding: MapLibre picks a tile's zoom from its distance to the eye, ~z23 next to an eye
  // a few metres over the rail; overscaled 2^5 their labels ran into "Too many glyphs being rendered in a tile" and slow
  // layouts (more tiles, more work, nothing more to see). Each source's calculateTileZoom capped at the map's own maxZoom
  // while riding; the returned function puts them back (Fly does the same in freecam.js).
  function capTileZoom(cap) {
    const saved = {};
    let ids = [];
    try { ids = Object.keys(map.getStyle()?.sources || {}); } catch { ids = []; }
    for (const sid of ids) {
      const src = map.getSource(sid);
      if (!src) continue;
      saved[sid] = src.calculateTileZoom;
      let f = src.calculateTileZoom;
      if (typeof f !== 'function') { try { map.setSourceTileLodParams(9.314, 3, sid); f = src.calculateTileZoom; } catch { f = null; } }
      if (typeof f === 'function') src.calculateTileZoom = (a, b, c, d, e) => Math.min(cap, f(a, b, c, d, e));
    }
    return () => { for (const sid of Object.keys(saved)) { const src = map.getSource(sid); if (src) src.calculateTileZoom = saved[sid]; } };
  }
  function ride(id, o = {}) {
    if (!S.on || !S.underground || !S.trains || id == null) return false;
    if (fly.active()) fly.stop({ quiet: true });   // Fly and Ride never run at once
    const p = S.trains.locate(id);
    if (!p) return false;
    if (S.ride) stopRide(true);
    const cam = camOf();
    S.ride = { id, cam, view: o.view === 'cab' ? 'cab' : 'behind', sheet: !!o.sheet, true0: !!S.trueScale, maxPitch: map.getMaxPitch?.() ?? 60, maxZoom: map.getMaxZoom?.() ?? 18.6, rotate: map.dragRotate?.isEnabled?.(), pan: map.dragPan?.isEnabled?.(), c: null, b: null, t: 0, lost: 0, step: 0 };
    if (!S.trueScale) setTrueScale(true);
    // pitch up to 120: a camera looking up a grade must not be capped (MapLibre then swings the eye up around its target)
    try { map.setMaxPitch?.(120); map.setMaxZoom?.(RIDE.maxZoom); } catch { /* fine */ }
    // the ride's cameras (calculateCameraOptionsFromTo) set a centre ELEVATION; MapLibre resets it to 0 on every render
    // while centerClampedToGround is on (no terrain), which dropped the eye by it (Cab meant 2.6 m was 0.6 m over the rail)
    S.ride.clamp0 = map.getCenterClampedToGround?.() ?? true;
    try { map.setCenterClampedToGround?.(false); } catch { /* fine */ }
    try { S.ride.untile = capTileZoom(S.ride.maxZoom); } catch { S.ride.untile = null; }
    try { map.dragPan?.disable(); map.dragRotate?.disable(); map.touchZoomRotate?.disableRotation?.(); } catch { /* fine */ }
    S.trains.setRide(id);
    const bearing = Math.atan2(p.hx, p.hy) * 180 / Math.PI;
    const c = toLngLat(p.x + p.hx * RIDE.ahead, p.y + p.hy * RIDE.ahead);
    S.ride.b = bearing;
    map.jumpTo({ center: c, zoom: RIDE.zoom, pitch: RIDE.pitch, bearing });
    S.ride.raf = requestAnimationFrame(rideTick);
    changed();
    return true;
  }
  function rideTick(ts) {
    const R = S.ride;
    if (!R) return;
    R.raf = requestAnimationFrame(rideTick);
    const dtr = R.t ? Math.max(0, (ts - R.t) / 1000) : 0.016, dt = Math.min(0.1, dtr);   // dtr: the real time since the last tick
    R.t = ts;
    const st = S.trains?.rideState?.();
    if (!st) { if ((R.lost += dt) > 6) stopRide(); return; }
    R.lost = 0;
    // QA 4 Nov: the Behind eye no longer eases in the plane (with slow frames it fell 20-30 m back and cut the Oedo's tight
    // curves, out of its bore); it rides ON the track, and a jump of the train (a live correction moves it tens of metres)
    // becomes extra gap that melts away along the track (R.lag), so the eye glides after it without leaving the rails
    // a jump = the train's move along its line since the last fill far off what its recent speed predicts (playback x10 /
    // x60 included: the speed is measured, not assumed)
    R.mdt = (R.mdt || 0) + dtr;
    if (Number.isFinite(st.m) && st.m !== R.lastM) {
      if (R.lastM != null && R.mdt > 0) {
        const dm = (st.m - R.lastM) * (st.dir || 1), exp = (R.v ?? dm / R.mdt) * R.mdt, off = dm - exp;
        if ((R.vn || 0) > 2 && Math.abs(off) > 25 + 0.5 * Math.abs(exp)) R.lag = off > 0 ? Math.min(400, (R.lag || 0) + off) : 0;   // forward: the eye follows; back: a cut
        else { R.v = R.v == null ? dm / R.mdt : R.v + (dm / R.mdt - R.v) * Math.min(1, R.mdt / 1.5); R.vn = (R.vn || 0) + 1; }
      }
      R.lastM = st.m; R.mdt = 0;
    }
    R.lag = (R.lag || 0) * Math.exp(-dtr / 0.8);
    if (R.lag < 0.05) R.lag = 0;
    // the point the eye rides at: Behind = on the train's own track behind its tail, Cab = 3 m ahead of its front window
    const cab = R.view === 'cab' && Number.isFinite(st.fx);
    const hx = cab ? st.fhx : st.hx, hy = cab ? st.fhy : st.hy;
    const tb = Math.atan2(hx, hy) * 180 / Math.PI;
    const rx = Number.isFinite(st.rx) ? st.rx : st.x - st.hx * (st.len || 200) / 2, ry = Number.isFinite(st.ry) ? st.ry : st.y - st.hy * (st.len || 200) / 2;
    const bc = behindCam(st.line);   // (b)
    if (!cab) {
      // the rider's own zoom (wheel / pinch) moves the Behind eye nearer or farther (the zoom this tick set is R.zSet)
      if (R.zSet != null && Math.abs(map.getZoom() - R.zSet) > 0.02) R.gapK = Math.max(0.35, Math.min(4, (R.gapK || 1) * 2 ** (R.zSet - map.getZoom())));
      S.trains.setRideGap?.(behindGap(bc, R.gapK || 1) + (R.lag || 0));
    }
    const onTrack = Number.isFinite(st.bx);
    const tx = cab ? st.fx + hx * 3 : onTrack ? st.bx : rx - st.hx * behindGap(bc, R.gapK || 1);   // Cab: 3 m ahead of the nose
    const ty = cab ? st.fy + hy * 3 : onTrack ? st.by : ry - st.hy * behindGap(bc, R.gapK || 1);
    if (reduced()) {
      // reduced motion: no gliding camera; a still view that steps to the train every few seconds
      if (ts - R.step < RIDE.stepMs) return;
      R.step = ts; R.p = [tx, ty]; R.b = tb;
    } else {
      // both eyes ride WITH the train on its track (the Behind one glides along the track after a jump: R.lag above)
      R.p = [tx, ty];
      R.b = tb;
    }
    if (R.view === 'cab' && typeof map.calculateCameraOptionsFromTo === 'function') {
      // the driver's eye 2.6 m over the rail (the ridden line rides at MapLibre's ground plane), looking 70 m ahead
      // (c): look at the train's OWN track ahead (vehicles.js: LOOK_M past the nose, on its OSM track), so the view
      // follows a curve (Oedo Iidabashi - Ushigome-kagurazaka looked into the wall along the head car's tangent)
      const look = Number.isFinite(st.lx) && (st.lx - R.p[0]) ** 2 + (st.ly - R.p[1]) ** 2 > 100;
      if (look) R.b = Math.atan2(st.lx - R.p[0], st.ly - R.p[1]) * 180 / Math.PI;
      const rad = R.b * Math.PI / 180, hx = Math.sin(rad), hy = Math.cos(rad);
      const from = toLngLat(R.p[0], R.p[1]), to = look ? toLngLat(st.lx, st.ly) : toLngLat(R.p[0] + hx * RIDE.look, R.p[1] + hy * RIDE.look);
      // the look point's rail relative to the rail under the Cab eye (st.lz - st.fz: both under the same lift, whichever
      // eye that lift was measured at; QA 4 Nov: right after Behind -> Cab the stale lift tilted the view up a 3 % grade,
      // the pitch cap pushed the eye 1.4 m up, out of the Oedo's bore): the view follows a grade
      try { map.jumpTo(map.calculateCameraOptionsFromTo(from, RIDE.eye, to, RIDE.eye - (look ? 0.6 - ((st.lz || 0) - (st.fz || 0)) : 1.2))); } catch { map.jumpTo({ center: to, bearing: R.b, pitch: 85 }); }
      return;
    }
    // Behind: from the eye (bc.eye over the rail under it: vehicles.js lifts the scene by that rail) to the middle of the
    // last car's end face (its rail relative to the rail under the eye: st.rz - st.bz, both under the same lift)
    const from = toLngLat(R.p[0], R.p[1]), to = toLngLat(rx, ry);
    try { map.jumpTo(map.calculateCameraOptionsFromTo(from, bc.eye, to, bc.aim + ((st.rz || 0) - (st.bz || 0)))); } catch { map.jumpTo({ center: to, bearing: R.b, pitch: 84 }); }
    R.zSet = map.getZoom();
  }
  /** End the ride: interactions, pitch limit and scale as they were; the camera eases out to the underground view there. */
  function stopRide(quiet = false) {
    const R = S.ride;
    if (!R) return false;
    S.ride = null;
    cancelAnimationFrame(R.raf);
    S.trains?.setRide(null);
    try { if (R.pan !== false) map.dragPan?.enable(); if (R.rotate !== false) map.dragRotate?.enable(); map.touchZoomRotate?.enableRotation?.(); } catch { /* fine */ }
    try { if (R.clamp0 !== false) { map.setCenterClampedToGround?.(true); map.jumpTo({ elevation: 0 }); } } catch { /* fine */ }
    try { R.untile?.(); } catch { /* fine */ }
    if (!R.true0 && S.trueScale) setTrueScale(false);
    if (!quiet && S.underground) {
      const c = map.getCenter();
      go({ center: [c.lng, c.lat], zoom: UG_ZOOM, pitch: UG_PITCH, bearing: map.getBearing() }, 900);
      setTimeout(() => { try { if (!S.ride) { map.setMaxPitch?.(R.maxPitch); map.setMaxZoom?.(R.maxZoom); } } catch { /* fine */ } }, 950);
    } else {
      try { map.setMaxPitch?.(R.maxPitch); if (map.getZoom() > R.maxZoom) map.jumpTo({ zoom: R.maxZoom }); map.setMaxZoom?.(R.maxZoom); } catch { /* fine */ }
    }
    changed();
    return true;
  }
  /** "Ride a train" from the underground view: the underground train nearest the middle of the map (a live one first). */
  function rideNearest() {
    const list = S.trains?.undergroundTrains?.() || [];
    if (!list.length) return null;
    const c = map.getCenter();
    const P = toLocal(c.lng, c.lat, [0, 0]);
    let best = null, bd = Infinity;
    for (const t of list) {
      if (!Number.isFinite(t.x)) continue;
      const d = (t.x - P[0]) ** 2 + (t.y - P[1]) ** 2 - (t.live ? 4e5 : 0);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) return null;
    if (typeof opts.open === 'function') { try { opts.open('train', best.key, 'map'); } catch { /* fine */ } }
    ride(best.key);
    return best.key;
  }

  function flyTo(p) {
    const v = typeof p === 'string' ? (S.underground ? UG_PRESETS[p] || PRESETS[p] : PRESETS[p]) : p;
    if (!v?.center) return false;
    const view = { center: v.center, zoom: v.zoom ?? 16.2, pitch: v.pitch ?? TILT, bearing: v.bearing ?? 0 };
    if (reduced()) map.jumpTo(view);
    else map.flyTo({ ...view, duration: 2400, essential: true });
    return true;
  }

  // ------------------------------------------------------------------ the free camera (freecam.js)
  // One chip (controls.js): the eye anywhere, above and below the street, through walls; Fly and Ride never run at once
  // (starting one ends the other); 3D off, the underground on / off, Reset view, a preset or any other camera move end it.
  // freecam.js is its own chunk, loaded on the first Fly tap: nothing of it for those who never fly (boreeye.js, the
  // inside-a-tunnel test vehicles.js runs while flying, is the only static part).
  const FLY_OFF = { active: () => false, stop: () => false, update() {}, refresh() {}, destroy() {} };
  let fly = FLY_OFF, flyLoad = null;
  const flyOpts = {
    host: () => S.ctlEl?.parentElement || null, area: labelArea, reduced, trains: () => S.trains,
    text: () => TEXT[lang] || TEXT.en, onChange: changed,
    // a flight that started from a ride kept the ride's true scale: put back what was there before the ride
    onStop: () => { if (S.flyTrue) { S.flyTrue = false; if (S.trueScale && !S.ride) setTrueScale(false); } },
  };
  async function setFly(on, o = {}) {
    if (!on) return fly.stop(o);
    if (!S.on || S.reason || !S.built) return false;
    if (fly === FLY_OFF) {
      flyLoad = flyLoad || import('./freecam.js').then((m) => (fly = m.createFreeCam(map, flyOpts))).catch((e) => { console.warn('[city3d] fly', e); flyLoad = null; return null; });
      if (!(await flyLoad) || !S.on || S.reason || fly.active()) return fly.active();
    }
    let pose = null;
    if (S.ride) {
      // from a ride: its eye in the world drawn without the ride's lift (the ridden line rides at MapLibre's ground
      // plane), in true scale as the ride draws it
      const tr = map.transform, ll = tr.getCameraLngLat(), lift = S.trains?.rideState?.()?.lift || 0, ts = S.trueScale;
      pose = { lng: ll.lng, lat: ll.lat, alt: tr.getCameraAltitude() - lift, bearing: map.getBearing(), pitch: map.getPitch() };
      stopRide(true);
      if (ts && !S.trueScale) { S.trains?.setExag(1); S.trueScale = true; S.flyTrue = true; }
    }
    return fly.start({ pose, event: o.event });
  }
  // Fly end

  const api = {
    setOn,
    setEnabled: setOn,
    show: setOn,
    setUnderground,
    enterUnderground,
    exitUnderground,
    setTrueScale,
    ride,
    rideNearest,
    stopRide: () => stopRide(false),
    /** the free camera on / off ({ event } = the tap that asked, { quiet } = no ease out). */
    setFly,
    /** Fly QA: pose(p?), input({ fwd, side, up, turn, tilt, boost }), push(m), stats() (after the first setFly). */
    get fly() { return fly; },
    /** The ride camera: 'behind' (in the bore over the last car) or 'cab' (the driver's view). */
    setRideView(v) { if (!S.ride) return false; S.ride.view = v === 'cab' ? 'cab' : 'behind'; S.ride.zSet = null; changed(); return true; },
    /** QA: the ride as of the last frame drawn (vehicles.js rideState: eye points, ends, rails, chain) or null. */
    rideState: () => S.trains?.rideState?.() || null,
    /** QA: the underground trains drawn last frame ([{ id, key, x, y, live }]). */
    trainsUnder: () => S.trains?.undergroundTrains?.() || [],
    flyTo,
    presets: PRESETS,
    ugPresets: UG_PRESETS,
    text: TEXT,
    pick: (x, y) => S.trains?.pick(x, y) || null,
    /** The open train (run key or id): roof lighter, its label first, its line's deck rails in colour. */
    setSelected(id) {
      // another train than the ridden one, or (a ride from its sheet) the sheet closed: the ride ends (back = exit)
      if (S.ride && id !== S.ride.id && (id != null || S.ride.sheet)) {
        const st = S.trains?.rideState?.();
        if (!st || (id !== st.key && id !== st.id)) stopRide();
      }
      S.selected = id ?? null;
      S.trains?.setSelected(S.selected);
      const run = S.selected == null ? null : sim?.runById?.get(S.selected) || (opts.runs || sim?.runs || []).find((r) => r.key === S.selected || r.id === S.selected);
      S.trains?.setLine(run ? run.line : S.line ?? null);
    },
    /** The open line (index or id): its deck rails in colour (null: all calm grey). */
    setLine(l) {
      const i = typeof l === 'string' ? net.lines.findIndex((x) => x.id === l) : l;
      S.line = Number.isInteger(i) && i >= 0 ? i : null;
      S.trains?.setLine(S.line);
    },
    setLang(l) { lang = l || 'en'; fly.refresh(); map.triggerRepaint(); },
    labels: () => S.labels?.boxes() || [],
    /** fn(state) whenever 3D or the underground view turns on or off; returns off(). */
    onChange(fn) { if (typeof fn === 'function') listeners.add(fn); return () => listeners.delete(fn); },
    /** The 3D view's own chip row (controls.js) in the page's app root: one call for the page. */
    mountControls(el, o = {}) { return mountCity3dControls(el, api, { lang, ...o }); },
    /** controls.js tells us where its row is (3D labels keep out of it). */
    attachControls(el) { S.ctlEl = el || null; },
    /** The page's bars and sheet, css px from each edge of the map ({ top, bottom, left, right }); null = map padding. */
    setInsets(v) { S.insets = v && typeof v === 'object' ? { ...v } : null; map.triggerRepaint(); },
    state: () => ({
      on: S.on, underground: S.underground, ugBack: !!S.ugBack, trueScale: !!S.trueScale, ride: S.ride ? S.ride.id : null, rideView: S.ride ? S.ride.view : null, built: S.built, reason: S.reason, elev: S.elevSource, trains3d: !!S.trains3d, hidden2d: S.hidden2d, hideVia: S.hideVia || null,
      viaduct: S.viaduct?.stats || null, buildings: S.bldOwn ? BLD_ID : BLD_STYLE,
      trains: S.trains?.stats() || null, labels: S.labels?.stats() || null,
      layers: [S.bldOwn ? BLD_ID : BLD_STYLE, ...VIADUCT_IDS, TRAINS3D_ID].filter((id) => map.getLayer(id)),
      fly: fly.active(),   // Fly
    }),
    destroy() {
      fly.destroy();
      S.noteEl?.remove(); S.noteEl = null;
      map.off('style.load', onStyle);
      map.off('zoom', syncZoom);
      canvas.removeEventListener('click', onTap, true);
      if (S.on) setOn(false);
      S.trains?.destroy(); S.labels?.destroy();
      if (map.getLayer(TRAINS3D_ID)) map.removeLayer(TRAINS3D_ID);
      removeViaduct(map);
      if (S.bldOwn) removeBuildings(map);
      S.built = false;
    },
  };
  if (typeof globalThis !== 'undefined') (globalThis.__tokyo3d = api);
  return api;
}

export default mountCity3d;
