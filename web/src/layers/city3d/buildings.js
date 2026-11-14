// 3D view: the buildings: calm grey massing, a touch darker as buildings get taller, no textures. Normally the
// basemap style's own `bld-3d` layer draws them (style.js); this module is the fallback that adds a building tile set
// of its own (site path /tiles/tokyo-bld-v1/{z}/{x}/{y}.mvt; heights in the tiles' `height` and `min_height`, metres). One fill-extrusion
// layer, kept by index.js under the rail network and the labels (route lines, stations and names draw over the city, as
// a navigation app's route over 3D buildings) and over the ground.
//
// The tile set's own metadata is read once for its zoom range and its layer
// name; without it the defaults below stand.
//
// export const BLD_ID, BLD_SOURCE, GREY
// export async function buildingSpec(origin?, fetcher?) -> { tiles, minzoom, maxzoom, layer, bounds? }
// export function addBuildings(map, spec, { before }), showBuildings(map, on), setBuildingOpacity(map, a), removeBuildings(map)

export const BLD_ID = 'tk3d-buildings';
export const BLD_SOURCE = 'tk3d-buildings';
export const BLD_NAME = 'tokyo-bld-v1';
export const DEFAULT_LAYER = 'buildings';
// Calm grey: a calm grey city, real shapes, no textures
export const GREY = { base: '#E3E5E9', tall: '#D9DCE1', tower: '#D0D4DA' };
export const OPACITY = 0.9;
// height of a building the tiles give none for (a one-storey block) and of a building part without min_height
const H_DEFAULT = 6;

const HEIGHT = ['coalesce', ['to-number', ['get', 'height'], null], ['to-number', ['get', 'render_height'], null], ['*', ['coalesce', ['to-number', ['get', 'building:levels'], null], ['to-number', ['get', 'levels'], null], 0], 3.2], H_DEFAULT];
const BASE = ['coalesce', ['to-number', ['get', 'min_height'], null], ['to-number', ['get', 'render_min_height'], null], 0];

export function paint(minzoom = 14) {
  // the buildings rise over one zoom level from where the tiles start, so they never pop up at full height
  const z0 = Math.max(12, minzoom), z1 = z0 + 1;
  return {
    'fill-extrusion-color': ['interpolate', ['linear'], HEIGHT, 0, GREY.base, 60, GREY.tall, 150, GREY.tower],
    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], z0, 0, z1, HEIGHT],
    'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], z0, 0, z1, BASE],
    'fill-extrusion-opacity': OPACITY,
    'fill-extrusion-vertical-gradient': true,
  };
}

/** Where the building tiles are and what is in them. */
export async function buildingSpec(origin = (typeof location !== 'undefined' ? location.origin : ''), fetcher = (typeof fetch === 'function' ? fetch : null)) {
  const spec = { tiles: [`${origin}/tiles/${BLD_NAME}/{z}/{x}/{y}.mvt`], minzoom: 14, maxzoom: 14, layer: DEFAULT_LAYER };
  if (!fetcher) return spec;
  try {
    const r = await fetcher(`${origin}/tiles/${BLD_NAME}/metadata`);
    if (r.ok) {
      const tj = await r.json();
      if (Number.isFinite(tj.minzoom)) spec.minzoom = tj.minzoom;
      if (Number.isFinite(tj.maxzoom)) spec.maxzoom = tj.maxzoom;
      const vl = Array.isArray(tj.vector_layers) ? tj.vector_layers : [];
      const pick = vl.find((l) => /build/i.test(l.id)) || vl[0];
      if (pick?.id) spec.layer = pick.id;
      if (Array.isArray(tj.bounds) && tj.bounds.length === 4 && tj.bounds.every(Number.isFinite)) spec.bounds = tj.bounds;
    }
  } catch { /* defaults */ }
  return spec;
}

export function addBuildings(map, spec, { before } = {}) {
  if (map.getLayer(BLD_ID)) return false;
  if (!map.getSource(BLD_SOURCE)) {
    map.addSource(BLD_SOURCE, {
      type: 'vector', tiles: spec.tiles, minzoom: spec.minzoom, maxzoom: spec.maxzoom,
      ...(spec.bounds ? { bounds: spec.bounds } : {}),
    });
  }
  const b = before && map.getLayer(before) ? before : undefined;
  map.addLayer({ id: BLD_ID, type: 'fill-extrusion', source: BLD_SOURCE, 'source-layer': spec.layer, minzoom: Math.max(12, spec.minzoom), paint: paint(spec.minzoom) }, b);
  return true;
}

export function showBuildings(map, on) {
  if (!map.getLayer(BLD_ID)) return;
  const v = on ? 'visible' : 'none';
  if ((map.getLayoutProperty(BLD_ID, 'visibility') || 'visible') !== v) map.setLayoutProperty(BLD_ID, 'visibility', v);
}

export function removeBuildings(map) {
  if (map.getLayer(BLD_ID)) map.removeLayer(BLD_ID);
  if (map.getSource(BLD_SOURCE)) map.removeSource(BLD_SOURCE);
}
