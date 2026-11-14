// The map engine: MapLibre with the calm look and nothing else (no bus store, no stop network, no idle repaint
// loop), so the trains layer owns the frames. The page
// talks to the map only through the api below; modules that draw on the map get `getMap()` (the MapLibre map).
//
//   const tm = await createTokyoMap({ container, style, tilesBase: '/tiles', bounds, center, zoom, onReady, onMapClick })
//   tm.getMap() / setPadding / zoomIn / zoomOut / set3D / resetNorth / setUserLocation / flyTo / fitBounds / getDebug
//
// `style`: a MapLibre style object, a factory (tilesBase -> style), or nothing (a plain calm ground with glyphs, the
// look until style.js's web/src/tokyo/style.js lands).
import maplibregl from 'maplibre-gl';
import { injectCss } from './chrome.js';

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Absolute base (MapLibre fetches tiles and glyphs from a worker: relative URLs would break). */
export const absBase = (base = '/tiles') => (/^https?:/.test(base) ? base : `${location.origin}${base.startsWith('/') ? '' : '/'}${base}`).replace(/\/$/, '');

/** The calm ground alone: what the page shows until a basemap style exists (and if the tiles are down). */
export function plainStyle(tilesBase = '/tiles') {
  return {
    version: 8,
    name: 'tokyo-plain',
    glyphs: `${absBase(tilesBase)}/fonts/{fontstack}/{range}.pbf`,
    sources: {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F2F2F3' } }],
  };
}

/** Greater Tokyo, padded around MT3D's 2,610 stations (138.53..140.86 E, 34.68..36.97 N). */
export const TOKYO_BOUNDS = [105.6, -7.6, 108.9, -5.4];
/** The opening view: the Yamanote ring with its station names readable . */
export const YAMANOTE_VIEW = [[106.72, -6.33], [106.93, -6.09]];

export async function createTokyoMap(opts = {}) {
  injectCss();
  const container = opts.container;
  container?.classList?.add('tm-map');
  const tilesBase = opts.tilesBase || '/tiles';
  const b = Array.isArray(opts.bounds) && opts.bounds.length === 4 ? opts.bounds : TOKYO_BOUNDS;
  let style;
  try {
    style = typeof opts.style === 'function' ? opts.style(tilesBase) : opts.style || plainStyle(tilesBase);
  } catch (e) {
    console.warn('[map] style factory failed, using the plain ground', e);
    style = plainStyle(tilesBase);
  }
  let map;
  try {
    map = new maplibregl.Map({
      container,
      style,
      bounds: opts.center ? undefined : opts.home || YAMANOTE_VIEW,
      fitBoundsOptions: { padding: opts.fit ?? 16 },   // the page's opening padding (one set of tiles)
      center: opts.center,
      zoom: opts.zoom,
      minZoom: opts.minZoom ?? 7.5,
      maxZoom: 18.6,
      maxBounds: [[b[0], b[1]], [b[2], b[3]]],
      maxPitch: 70,
      attributionControl: false,
      fadeDuration: 150,
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
      cooperativeGestures: false,
      ...(opts.tileCache || {}),   // { maxTileCacheZoomLevels, maxTileCacheSize }
      ...(opts.ariaLabel ? { locale: { 'Map.Title': opts.ariaLabel } } : {}),
    });
  } catch (err) {
    console.warn('[map] cannot start the map', err);
    opts.onReady?.(false);
    return stub();
  }

  let loaded = false;
  let want3D = false;
  let meMarker = null;
  let meLngLat = null;
  let meAcc = 0;
  // frames per second, measured from MapLibre's render events (the QA harness reads it through window.__tokyo)
  let frames = 0, fps = 0, fpsT = performance.now();
  map.on('render', () => {
    frames++;
    const now = performance.now();
    if (now - fpsT >= 1000) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
  });

  map.on('load', () => {
    loaded = true;
    try { map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.26, position: [1.4, 210, 38] }); } catch { /* older styles */ }
    map.addSource('me-acc', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'me-acc', type: 'circle', source: 'me-acc',
      paint: {
        'circle-color': 'rgba(47,124,246,0.10)', 'circle-stroke-color': 'rgba(47,124,246,0.35)', 'circle-stroke-width': 1,
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'r0'], 22, ['*', ['get', 'r0'], 4194304]],
        'circle-pitch-alignment': 'map',
      },
    });
    if (meLngLat) setMe(meLngLat, meAcc);
    opts.onReady?.(true);
  });
  map.on('error', (e) => {
    const msg = e && e.error && e.error.message;
    // missing tiles / a tile server that is not up yet are expected in dev: stay quiet about them
    if (msg && !/Failed to fetch|AbortError|204|404|NetworkError|Load failed/.test(msg)) console.warn('[map]', msg);
  });
  map.on('click', (e) => { if (!opts.onPreClick?.(e)) opts.onMapClick?.(e); });
  if (opts.onCamera) {
    let q = false;
    map.on('move', () => {
      if (q) return;
      q = true;
      requestAnimationFrame(() => { q = false; opts.onCamera({ bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom() }); });
    });
  }

  function setMe(lngLat, acc) {
    if (!lngLat) {
      if (meMarker) { meMarker.remove(); meMarker = null; }
      map.getSource('me-acc')?.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    if (!meMarker) {
      const el = document.createElement('div');
      el.className = 'tm-me';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', 'You');
      meMarker = new maplibregl.Marker({ element: el, anchor: 'center', pitchAlignment: 'map', rotationAlignment: 'map' });
      meMarker.setLngLat(lngLat).addTo(map);
    } else meMarker.setLngLat(lngLat);
    const mPerPxZ0 = (40075016.686 * Math.cos((lngLat[1] * Math.PI) / 180)) / 512;
    const r0 = Math.max(acc || 0, 0) / mPerPxZ0;
    map.getSource('me-acc')?.setData({ type: 'FeatureCollection', features: acc > 0 ? [{ type: 'Feature', properties: { r0 }, geometry: { type: 'Point', coordinates: lngLat } }] : [] });
  }

  const dur = (ms) => (reduceMotion() ? 0 : ms);
  return {
    getMap: () => map,
    isLoaded: () => loaded,
    setPadding(p) { map.setPadding({ top: 0, bottom: 0, left: 0, right: 0, ...p }); },
    zoomIn() { map.zoomIn({ duration: dur(300) }); },
    zoomOut() { map.zoomOut({ duration: dur(300) }); },
    /** 3D: tilt + turn a little (buildings and viaducts come from the the 3D city layer when mounted). */
    set3D(on) {
      want3D = !!on;
      if (want3D) map.easeTo({ pitch: 58, bearing: map.getBearing() || -17, zoom: Math.max(map.getZoom(), 15.2), duration: dur(1000) });
      else map.easeTo({ pitch: 0, bearing: 0, duration: dur(800) });
    },
    is3D: () => want3D,
    resetNorth() { want3D = false; map.easeTo({ bearing: 0, pitch: 0, duration: dur(600) }); },
    setUserLocation(lngLat, accuracyM) { meLngLat = lngLat || null; meAcc = accuracyM || 0; if (loaded) setMe(meLngLat, meAcc); },
    flyTo({ center, zoom } = {}) { if (center) map.flyTo({ center, zoom: zoom ?? Math.max(map.getZoom(), 14.5), duration: dur(1000), essential: true }); },
    fitBounds(bb, o = {}) { map.fitBounds(bb, { padding: 40, maxZoom: 15, duration: dur(800), essential: true, ...o }); },
    getDebug: () => ({ fps, zoom: Math.round(map.getZoom() * 100) / 100, pitch: Math.round(map.getPitch()), loaded }),
    /** The canvas's accessible name (MapLibre sets it once from locale 'Map.Title'): for a language switch. */
    setAriaLabel(label) { try { map.getCanvas().setAttribute('aria-label', label); } catch { /* fine */ } },
    destroy() { if (meMarker) meMarker.remove(); map.remove(); },
  };
}

function stub() {
  const noop = () => {};
  return { getMap: () => null, isLoaded: () => false, setPadding: noop, zoomIn: noop, zoomOut: noop, set3D: noop, is3D: () => false, resetNorth: noop, setUserLocation: noop, flyTo: noop, fitBounds: noop, getDebug: () => ({ fps: 0 }), destroy: noop };
}
