// The Tokyo basemap: a calm look (pale grey ground, white streets with light casings, muted parks and water, grey
// labels, one label font). The only colour on the map is data: the trains and the one line or train picked
// (network-layer.js draws the rail network on top of this). Buildings only in 3D.
//
// Two tile schemas, picked at build time (config.js BASEMAP):
//   openfreemap (default)  OpenFreeMap's public tiles, OpenMapTiles schema: openFreeMapStyle()
//   protomaps              self-hosted Protomaps basemap tiles, v4 schema (a Greater Tokyo cut): protomapsStyle()
// Both use the same layer ids for the labels (setStyleLang swaps their language) and a `bld-3d` layer for 3D.
//
// - Labels by language: EN (and ID, which uses the English names) = name:en, else the local name; JA = name:ja, else
//   the local name. setStyleLang(map, lang) swaps them in place.
// - A Japanese place hierarchy: metropolis / city (東京都, 横浜市 ...) -> special ward (新宿区 ...) -> district (町: 西新宿,
//   丸の内; named areas: 原宿) -> neighbourhood (丁目), each in its own zoom band, so the opening view reads as wards and
//   the street view as districts.
// - CJK: MapLibre draws kana and kanji itself (its `localIdeographFontFamily` option, on by default as 'sans-serif'); the
//   glyph server only needs the Latin font (MAP_FONT). Keep the map container's lang="ja" so Han characters take Japanese
//   forms. Never pass localIdeographFontFamily: false (kanji would then be asked from the glyph server).
// - OSM rail tracks only as a faint street-zoom hint: our own network is the rail map.
import { BASEMAP, BASEMAP_URL, BUILDINGS_URL, GLYPHS_URL, MAP_FONT } from './config.js';

/** Highest zoom of a Protomaps basemap archive (MapLibre overzooms above it). */
export const TILES_MAXZOOM = 14;
/**
 * Covered area [w, s, e, n]: every Mini Tokyo 3D railway (data/coordinates.json spans 138.528..140.864 E,
 * 34.679..36.970 N: Kofu in the west, Kuroiso in the north, Choshi in the east, the Izu lines in the south) plus a
 * margin. Use it for maxBounds and the sources' bounds.
 */
export const TOKYO_BOUNDS = [105.6, -7.6, 108.9, -5.4];
/** The tile sources ask for nothing outside this (a Greater Tokyo cut covers it). */
export const TILES_BOUNDS = [105.6, -7.6, 108.9, -5.4];
/**
 * The opening view, [[w, s], [e, n]] for map.fitBounds (the same shape as trafik.live/kereta's HOME_VIEW): the
 * Yamanote ring (Shinjuku 139.700 .. Uguisudani 139.778 E, Osaki 35.620 .. Tabata 35.738 N) with room on the west for
 * the names of its western stations (they go outside the ring). Measured 3 Nov: a 390x844 phone with kereta's padding
 * (top 72, right 64, left 24, bottom = sheet + 8) and the sheet at PEEK lands at z10.74 with 26 of the 30 Yamanote
 * names; 1440x900 with the 400 px pane lands at z11.77 with all 30.
 */
export const HOME_VIEW = [[106.72, -6.33], [106.93, -6.09]];
/** Camera to construct the map with before the first fitBounds (centre of the ring). */
export const HOME_CENTER = [106.8229, -6.2003];
export const HOME_ZOOM = 11.3;
export const FONT = MAP_FONT;

/** The calm palette. */
export const MAP_CALM = {
  land: '#F2F2F3',
  green: '#DCEBD6',
  greenDeep: '#D2E5CB',
  greenSoft: '#E6F0E2',
  water: '#C7DDED',
  waterLine: '#BAD3E6',
  hospital: '#EFEDED',
  school: '#EFEEEA',
  commercial: '#EFEEF0',
  industrial: '#ECECEE',
  pedestrian: '#F8F8F9',
  building3d: '#E9E9EC',
  tower3d: '#DCDCE1',
  minor: '#FFFFFF',
  minorCase: '#E3E3E6',
  major: '#FFFFFF',
  majorCase: '#D8D8DC',
  primary: '#FFFFFF',
  primaryCase: '#D2D2D7',
  highway: '#FFFFFF',
  highwayCase: '#C6C6CC',
  tunnel: '#EDEDEF',
  path: '#DADADE',
  rail: '#C6C6CC',
  mrt: '#B4B2C6',
  label: '#8A8A90',
  labelStrong: '#55555B',
  area: '#9C9CA3',
  waterLabel: '#7B9CB9',
  halo: '#FFFFFF',
  ink: '#171717',
  data: '#6C63F0',
  // Tokyo additions (same family): airports' aprons and runways
  apron: '#EAEAEE',
  runway: '#DEDEE3',
};

/** 'en' | 'ja' | 'id' -> 'en' | 'ja' (ID shows the English names). */
export const labelLang = (lang) => (String(lang || '').toLowerCase().startsWith('ja') ? 'ja' : 'en');

/** A basemap feature's name in the UI language: EN = name:en, else the local name; JA = name:ja, else the local name. */
export function nameExpr(lang) {
  return labelLang(lang) === 'ja'
    ? ['coalesce', ['get', 'name:ja'], ['get', 'name']]
    : ['coalesce', ['get', 'name:en'], ['get', 'name:ja-Latn'], ['get', 'name:ja_rm'], ['get', 'name:latin'], ['get', 'name']];
}

/** An absolute URL (MapLibre fetches tiles and glyphs from a worker, so site-relative URLs would break). Keeps the
 *  {z}/{x}/{y}/{fontstack}/{range} placeholders as they are. */
export function absUrl(u) {
  const s = String(u || '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  const origin = globalThis.location?.origin && globalThis.location.origin !== 'null' ? globalThis.location.origin : 'http://localhost';
  return `${origin}${s.startsWith('/') ? '' : '/'}${s}`;
}

/** The basemap's label layers (their text-field follows the language; setStyleLang swaps them). */
export const BASE_LABEL_LAYERS = ['water-label', 'river-label', 'road-label-minor', 'road-label-major', 'hood-label',
  'district-label', 'ward-label', 'city-label'];

/** The calm basemap in the configured schema (config.js BASEMAP), labels in `lang` ('en' | 'ja' | 'id'). The first
 *  argument (a tiles base) is ignored: tile and glyph URLs come from config.js. */
export function calmTokyoStyle(_tilesBase, lang = 'en') {
  return BASEMAP === 'protomaps' ? protomapsStyle(lang) : openFreeMapStyle(lang);
}

/** Protomaps basemap v4 schema (self-hosted tiles: BASEMAP_URL, BUILDINGS_URL, GLYPHS_URL). */
export function protomapsStyle(lang = 'en') {
  const P = MAP_CALM;
  const src = 'base';
  const z = (stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
  const lz = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
  const kd = (...k) => ['in', ['get', 'kind_detail'], ['literal', k]];
  const kind = (...k) => ['in', ['get', 'kind'], ['literal', k]];
  const MINOR_W = z([13, 0.8, 14, 1.4, 16, 6, 18, 18]);
  const MINOR_C = z([13, 1.6, 14, 2.4, 16, 8, 18, 21]);
  const MAJOR_W = z([9, 0.6, 10, 0.8, 12, 1.6, 14, 4, 16, 10, 18, 26]);
  const MAJOR_C = z([9, 1.1, 10, 1.4, 12, 2.6, 14, 6, 16, 13, 18, 30]);
  const HWY_W = z([6, 0.6, 8, 1, 11, 2.2, 14, 6, 16, 12, 18, 30]);
  const HWY_C = z([6, 1, 8, 1.6, 11, 3.4, 14, 8.5, 16, 15, 18, 34]);
  const name = nameExpr(lang);
  const pop = ['coalesce', ['get', 'population'], 0];
  const minZ = (dflt) => ['coalesce', ['get', 'min_zoom'], dflt];

  const road = (id, filter, color, width, extra = {}) => ({
    id, type: 'line', source: src, 'source-layer': 'roads', filter,
    layout: { 'line-cap': 'round', 'line-join': 'round', ...(extra.layout || {}) },
    paint: { 'line-color': color, 'line-width': width, ...(extra.paint || {}) },
    ...(extra.minzoom != null ? { minzoom: extra.minzoom } : {}),
    ...(extra.maxzoom != null ? { maxzoom: extra.maxzoom } : {}),
  });
  const isT = ['has', 'is_tunnel'];
  const isB = ['has', 'is_bridge'];
  const flat = (f) => ['all', ['!', isT], ['!', isB], f];
  const prime = kd('primary', 'trunk', 'primary_link', 'trunk_link');
  const minorF = ['in', ['get', 'kind'], ['literal', ['minor_road', 'other']]];
  const majorPlain = ['all', ['==', ['get', 'kind'], 'major_road'], ['!', prime]];
  const majorPrime = ['all', ['==', ['get', 'kind'], 'major_road'], prime];
  const hwy = ['==', ['get', 'kind'], 'highway'];
  const bigRoad = kind('major_road', 'highway');
  const roadColor = ['match', ['get', 'kind'], 'highway', P.highway, 'major_road', ['case', prime, P.primary, P.major], P.minor];
  const caseColor = ['match', ['get', 'kind'], 'highway', P.highwayCase, 'major_road', P.majorCase, P.minorCase];

  // Places, Japanese hierarchy, as the Tokyo cut tags them (checked on a Protomaps v4 Tokyo cut, Nov 2026): the metropolis 東京都
  // and the cities (市) and towns (町) are locality/city|town, and so are the 23 special wards (新宿区 ...: names end in
  // 区); 町 / 大字 districts (新宿, 麹町, 永田町) are macrohood/quarter (min_zoom 11, ~200 per z11 tile); named areas
  // (原宿, 下北沢, 高円寺) are locality/locality or neighbourhood/suburb; 丁目 and small 町 are neighbourhood/neighbourhood.
  // There are no prefecture (region) points in the cut.
  const nm = ['coalesce', ['get', 'name'], ''];
  const isWardName = ['all', ['>', ['length', nm], 1], ['==', ['slice', nm, ['-', ['length', nm], 1]], '区']];
  const isCity = ['all', ['==', ['get', 'kind'], 'locality'], kd('city', 'town'), ['!', isWardName]];
  const isWard = ['any', ['all', ['==', ['get', 'kind'], 'locality'], ['==', ['get', 'kind_detail'], 'city'], isWardName],
    ['all', kind('macrohood', 'neighbourhood'), kd('borough', 'city_district')]];
  const isDistrict = ['any', ['all', ['==', ['get', 'kind'], 'macrohood'], kd('quarter', 'suburb')],
    ['all', ['==', ['get', 'kind'], 'neighbourhood'], kd('suburb', 'quarter')],
    ['all', ['==', ['get', 'kind'], 'locality'], kd('locality', 'suburb', 'quarter', 'village')]];
  const isHood = ['all', ['==', ['get', 'kind'], 'neighbourhood'], kd('neighbourhood', 'hamlet', 'isolated_dwelling')];
  const areaText = (size) => ({
    'text-field': name, 'text-font': FONT, 'text-size': size, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
    'text-max-width': 7, 'symbol-sort-key': ['-', 0, pop], 'text-padding': 6,
  });

  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': P.land } },
    { id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover', maxzoom: 12,
      paint: { 'fill-color': ['match', ['get', 'kind'], ['forest', 'grassland', 'scrub', 'farmland'], P.greenSoft, P.land], 'fill-opacity': lz([8, 0.8, 12, 0]) } },
    { id: 'lu-soft', type: 'fill', source: src, 'source-layer': 'landuse', minzoom: 12,
      filter: kind('commercial', 'industrial', 'railway', 'military', 'pedestrian', 'platform', 'other', 'retail'),
      paint: {
        'fill-color': ['match', ['get', 'kind'], ['commercial', 'retail'], P.commercial, ['pedestrian', 'platform'], P.pedestrian, P.industrial],
        'fill-opacity': lz([12, 0, 13, 1]),
      } },
    { id: 'lu-airport', type: 'fill', source: src, 'source-layer': 'landuse', minzoom: 10,
      filter: kind('aerodrome', 'apron', 'runway', 'taxiway'),
      paint: { 'fill-color': ['match', ['get', 'kind'], ['runway', 'taxiway'], P.runway, P.apron], 'fill-opacity': lz([10, 0, 11, 1]) } },
    { id: 'lu-care', type: 'fill', source: src, 'source-layer': 'landuse', minzoom: 12,
      filter: kind('hospital', 'school', 'kindergarten', 'college', 'university'),
      paint: { 'fill-color': ['match', ['get', 'kind'], 'hospital', P.hospital, P.school], 'fill-opacity': lz([12, 0, 13, 1]) } },
    { id: 'lu-green', type: 'fill', source: src, 'source-layer': 'landuse',
      filter: kind('park', 'grass', 'garden', 'forest', 'wood', 'cemetery', 'scrub', 'recreation_ground', 'meadow', 'playground',
        'grassland', 'golf_course', 'farmland', 'dog_park', 'nature_reserve', 'national_park', 'protected_area', 'pitch', 'wetland', 'zoo'),
      paint: {
        'fill-color': ['match', ['get', 'kind'], ['forest', 'wood', 'nature_reserve', 'national_park', 'protected_area'], P.greenDeep,
          ['cemetery', 'farmland', 'meadow', 'scrub'], P.greenSoft, P.green],
        'fill-opacity': lz([10, 0.6, 13, 1]),
      } },
    { id: 'pitch-line', type: 'line', source: src, 'source-layer': 'landuse', minzoom: 16, filter: ['==', ['get', 'kind'], 'pitch'],
      paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.75, 'line-width': 1 } },
    { id: 'water', type: 'fill', source: src, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': P.water } },
    { id: 'water-line', type: 'line', source: src, 'source-layer': 'water', filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': P.waterLine, 'line-width': lz([11, 0.5, 14, ['match', ['get', 'kind'], ['river', 'canal'], 3, 1.5], 18, ['match', ['get', 'kind'], ['river', 'canal'], 14, 5]]) } },

    // Below zoom 13 tunnels and bridges of the big roads draw like the road itself (no gaps in the Shuto expressways).
    road('lo-case', ['all', bigRoad, ['any', isT, isB]], caseColor, MAJOR_C, { maxzoom: 13 }),
    road('lo-fill', ['all', bigRoad, ['any', isT, isB]], roadColor, MAJOR_W, { maxzoom: 13 }),
    // tunnels from 13
    road('t-all', ['all', isT, kind('minor_road', 'major_road', 'highway')], P.tunnel, MINOR_W, { minzoom: 13, paint: { 'line-opacity': 0.9 } }),
    // casings
    road('c-minor', flat(minorF), P.minorCase, MINOR_C, { minzoom: 13 }),
    road('c-major', flat(majorPlain), P.majorCase, MAJOR_C, { minzoom: 9 }),
    road('c-prime', flat(majorPrime), P.primaryCase, MAJOR_C, { minzoom: 9 }),
    road('c-hwy', flat(hwy), P.highwayCase, HWY_C, { minzoom: 6 }),
    // fills
    road('path', flat(['==', ['get', 'kind'], 'path']), P.path, lz([16, 0.8, 18, 2]), { minzoom: 16, paint: { 'line-dasharray': [1.5, 1.5] } }),
    road('f-minor', flat(minorF), P.minor, MINOR_W, { minzoom: 13 }),
    road('f-major', flat(majorPlain), P.major, MAJOR_W, { minzoom: 9 }),
    road('f-prime', flat(majorPrime), P.primary, MAJOR_W, { minzoom: 9 }),
    road('f-hwy', flat(hwy), P.highway, HWY_W, { minzoom: 6 }),
    // bridges from 13, over everything (the elevated Shuto expressways are bridges)
    road('cb-all', ['all', isB, kind('minor_road', 'major_road', 'highway', 'other')], caseColor, MAJOR_C, { minzoom: 13 }),
    road('fb-all', ['all', isB, kind('minor_road', 'major_road', 'highway', 'other')], roadColor, MAJOR_W, { minzoom: 13 }),
    // OSM's own tracks only as a faint hint at street zoom (yards, sidings): the rail map is network-layer.js.
    road('rail', ['all', ['==', ['get', 'kind'], 'rail'], ['!', isT], ['!', kd('subway')]], P.rail, lz([14.5, 0.6, 16, 1, 18, 1.6]),
      { minzoom: 14.5, paint: { 'line-dasharray': [3, 2], 'line-opacity': lz([14.5, 0, 15, 0.7]) } }),

    // 3D buildings: their own tile set, loaded only while this layer is visible
    { id: 'bld-3d', type: 'fill-extrusion', source: 'bld', 'source-layer': 'buildings', minzoom: 14.5,
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 5], 0, P.building3d, 60, P.tower3d],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'height'], 5]],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      } },

    // labels (one font). Order = placement priority, top first: the network's station names (added later, on top)
    // win over all of these; among these, wards beat districts beat streets.
    { id: 'water-label', type: 'symbol', source: src, 'source-layer': 'water', minzoom: 13,
      filter: ['all', ['has', 'name'], ['==', ['geometry-type'], 'Polygon'], kind('lake', 'water', 'bay', 'basin', 'reservoir')],
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': P.waterLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.2 } },
    { id: 'river-label', type: 'symbol', source: src, 'source-layer': 'water', minzoom: 13.5,
      filter: ['all', ['has', 'name'], ['==', ['geometry-type'], 'LineString'], kind('river', 'canal')],
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': 11, 'symbol-placement': 'line', 'symbol-spacing': 400 },
      paint: { 'text-color': P.waterLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.2 } },
    { id: 'road-label-minor', type: 'symbol', source: src, 'source-layer': 'roads', minzoom: 15.5,
      filter: ['all', ['has', 'name'], minorF],
      layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': lz([15.5, 10, 18, 12]), 'symbol-spacing': 320, 'text-max-angle': 30 },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 } },
    { id: 'road-label-major', type: 'symbol', source: src, 'source-layer': 'roads', minzoom: 13,
      filter: ['all', ['has', 'name'], bigRoad],
      layout: {
        'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': lz([13, 10, 16, 12.5, 18, 14]),
        'symbol-spacing': 360, 'text-max-angle': 30, 'symbol-sort-key': minZ(14),
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.6 } },
    // 丁目 and small 町: street zoom only
    { id: 'hood-label', type: 'symbol', source: src, 'source-layer': 'places', minzoom: 15.2, maxzoom: 18,
      filter: isHood,
      layout: areaText(lz([15.2, 9, 17, 10.5])),
      paint: { 'text-color': P.area, 'text-halo-color': P.halo, 'text-halo-width': 1.2, 'text-opacity': lz([15.2, 0, 15.6, 0.9]) } },
    // districts (町, 大字, named areas): 西新宿, 丸の内, 原宿 ... the kelurahan of Tokyo
    { id: 'district-label', type: 'symbol', source: src, 'source-layer': 'places', minzoom: 13.2, maxzoom: 17,
      filter: isDistrict,
      layout: areaText(lz([13.2, 9.5, 15, 11.5])),
      paint: { 'text-color': P.area, 'text-halo-color': P.halo, 'text-halo-width': 1.2, 'text-opacity': lz([13.2, 0, 13.7, 1, 16.4, 1, 17, 0]) } },
    // the special wards (区): Shinjuku, Shibuya, Minato ... from just inside the opening view to city-block zoom
    { id: 'ward-label', type: 'symbol', source: src, 'source-layer': 'places', minzoom: 10.8, maxzoom: 14.2,
      filter: isWard,
      // 11 px floor: the opening view (z10.7-11.8) read 10.0-10.9 px wards
      layout: { ...areaText(lz([10.8, 11, 13, 12])), 'text-letter-spacing': 0.16 },
      paint: { 'text-color': P.area, 'text-halo-color': P.halo, 'text-halo-width': 1.4, 'text-opacity': lz([10.8, 0, 11.3, 0.95, 13.6, 0.95, 14.2, 0]) } },
    // cities and towns (市, 町): bigger, darker, up to city zoom; 東京都 itself only while zoomed out past the wards
    { id: 'city-label', type: 'symbol', source: src, 'source-layer': 'places', maxzoom: 12.6,
      filter: ['all', isCity, ['<=', minZ(10), ['+', ['zoom'], 1.5]], ['any', ['<', pop, 10000000], ['<', ['zoom'], 11]]],
      layout: {
        'text-field': name, 'text-font': FONT, 'symbol-sort-key': ['-', 0, pop], 'text-padding': 4, 'text-max-width': 8,
        'text-size': lz([7, ['case', ['>=', pop, 1000000], 13, 11], 10, ['case', ['>=', pop, 1000000], 15, 12], 12.6, ['case', ['>=', pop, 1000000], 16, 13]]),
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-opacity': lz([12, 1, 12.6, 0]) } },
  ];
  const bounds = TILES_BOUNDS;
  return {
    version: 8,
    name: 'tokyo-calm-protomaps',
    glyphs: absUrl(GLYPHS_URL),
    sources: {
      [src]: { type: 'vector', tiles: [absUrl(BASEMAP_URL)], minzoom: 0, maxzoom: TILES_MAXZOOM, bounds,
        attribution: '© OpenStreetMap contributors · Protomaps' },
      bld: { type: 'vector', tiles: [absUrl(BUILDINGS_URL || BASEMAP_URL)], minzoom: 14, maxzoom: 14, bounds },
    },
    layers,
  };
}

/**
 * OpenMapTiles schema (OpenFreeMap's public tiles, BASEMAP_URL = its TileJSON): the same calm look, layer for layer.
 * Places as OSM tags them in Japan (checked on OpenFreeMap tiles, Nov 2026): 東京都, the cities (市) and the 23 special
 * wards (新宿区 ...: names end in 区) are class=city with a `rank`; 町 / 大字 districts (西新宿, 歌舞伎町) are quarter or
 * suburb; 丁目 and small 町 are neighbourhood.
 */
export function openFreeMapStyle(lang = 'en') {
  const P = MAP_CALM;
  const src = 'omt';
  const z = (stops) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops];
  const lz = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
  const cls = (...k) => ['in', ['get', 'class'], ['literal', k]];
  const MINOR_W = z([13, 0.8, 14, 1.4, 16, 6, 18, 18]);
  const MINOR_C = z([13, 1.6, 14, 2.4, 16, 8, 18, 21]);
  const MAJOR_W = z([9, 0.6, 10, 0.8, 12, 1.6, 14, 4, 16, 10, 18, 26]);
  const MAJOR_C = z([9, 1.1, 10, 1.4, 12, 2.6, 14, 6, 16, 13, 18, 30]);
  const HWY_W = z([6, 0.6, 8, 1, 11, 2.2, 14, 6, 16, 12, 18, 30]);
  const HWY_C = z([6, 1, 8, 1.6, 11, 3.4, 14, 8.5, 16, 15, 18, 34]);
  const name = nameExpr(lang);
  const rank = ['coalesce', ['get', 'rank'], 30];
  const isT = ['==', ['get', 'brunnel'], 'tunnel'];
  const isB = ['==', ['get', 'brunnel'], 'bridge'];
  const flat = (f) => ['all', ['!', isT], ['!', isB], f];
  const minorF = cls('minor', 'service');
  const majorPlain = cls('secondary', 'tertiary');
  const majorPrime = cls('primary', 'trunk');
  const hwy = cls('motorway');
  const bigRoad = cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary');
  const anyRoad = cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service');
  const roadColor = ['match', ['get', 'class'], 'motorway', P.highway, ['trunk', 'primary'], P.primary, ['secondary', 'tertiary'], P.major, P.minor];
  const caseColor = ['match', ['get', 'class'], 'motorway', P.highwayCase, ['trunk', 'primary'], P.primaryCase, ['secondary', 'tertiary'], P.majorCase, P.minorCase];
  const road = (id, filter, color, width, extra = {}) => ({
    id, type: 'line', source: src, 'source-layer': 'transportation', filter,
    layout: { 'line-cap': 'round', 'line-join': 'round', ...(extra.layout || {}) },
    paint: { 'line-color': color, 'line-width': width, ...(extra.paint || {}) },
    ...(extra.minzoom != null ? { minzoom: extra.minzoom } : {}),
    ...(extra.maxzoom != null ? { maxzoom: extra.maxzoom } : {}),
  });
  const nm = ['coalesce', ['get', 'name'], ''];
  const isWardName = ['all', ['>', ['length', nm], 1], ['==', ['slice', nm, ['-', ['length', nm], 1]], '区']];
  const areaText = (size) => ({
    'text-field': name, 'text-font': FONT, 'text-size': size, 'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
    'text-max-width': 7, 'symbol-sort-key': rank, 'text-padding': 6,
  });
  const layers = [
    { id: 'bg', type: 'background', paint: { 'background-color': P.land } },
    { id: 'landcover', type: 'fill', source: src, 'source-layer': 'landcover', filter: cls('wood', 'grass', 'farmland', 'wetland'),
      paint: { 'fill-color': ['match', ['get', 'class'], 'wood', P.greenDeep, P.green], 'fill-opacity': lz([8, 0.5, 12, 0.8, 13, 1]) } },
    { id: 'park', type: 'fill', source: src, 'source-layer': 'park', paint: { 'fill-color': P.greenDeep, 'fill-opacity': lz([8, 0.4, 12, 0.7]) } },
    { id: 'lu-soft', type: 'fill', source: src, 'source-layer': 'landuse', minzoom: 12,
      filter: cls('commercial', 'retail', 'industrial', 'railway', 'military', 'garages', 'bus_station'),
      paint: { 'fill-color': ['match', ['get', 'class'], ['commercial', 'retail'], P.commercial, P.industrial], 'fill-opacity': lz([12, 0, 13, 1]) } },
    { id: 'lu-care', type: 'fill', source: src, 'source-layer': 'landuse', minzoom: 12,
      filter: cls('hospital', 'school', 'kindergarten', 'college', 'university', 'library'),
      paint: { 'fill-color': ['match', ['get', 'class'], 'hospital', P.hospital, P.school], 'fill-opacity': lz([12, 0, 13, 1]) } },
    { id: 'lu-green', type: 'fill', source: src, 'source-layer': 'landuse',
      filter: cls('cemetery', 'pitch', 'playground', 'stadium', 'zoo', 'theme_park', 'park'),
      paint: { 'fill-color': ['match', ['get', 'class'], ['cemetery'], P.greenSoft, P.green], 'fill-opacity': lz([10, 0.6, 13, 1]) } },
    { id: 'lu-airport', type: 'fill', source: src, 'source-layer': 'aeroway', minzoom: 10, filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['match', ['get', 'class'], ['runway', 'taxiway'], P.runway, P.apron], 'fill-opacity': lz([10, 0, 11, 1]) } },
    { id: 'water', type: 'fill', source: src, 'source-layer': 'water', filter: ['!=', ['get', 'class'], 'swimming_pool'], paint: { 'fill-color': P.water } },
    { id: 'water-line', type: 'line', source: src, 'source-layer': 'waterway', filter: ['!=', ['get', 'brunnel'], 'tunnel'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': P.waterLine, 'line-width': lz([11, 0.5, 14, ['match', ['get', 'class'], ['river', 'canal'], 3, 1.5], 18, ['match', ['get', 'class'], ['river', 'canal'], 14, 5]]) } },
    road('lo-case', ['all', bigRoad, ['any', isT, isB]], caseColor, MAJOR_C, { maxzoom: 13 }),
    road('lo-fill', ['all', bigRoad, ['any', isT, isB]], roadColor, MAJOR_W, { maxzoom: 13 }),
    road('t-all', ['all', isT, anyRoad], P.tunnel, MINOR_W, { minzoom: 13, paint: { 'line-opacity': 0.9 } }),
    road('c-minor', flat(minorF), P.minorCase, MINOR_C, { minzoom: 13 }),
    road('c-major', flat(majorPlain), P.majorCase, MAJOR_C, { minzoom: 9 }),
    road('c-prime', flat(majorPrime), P.primaryCase, MAJOR_C, { minzoom: 9 }),
    road('c-hwy', flat(hwy), P.highwayCase, HWY_C, { minzoom: 6 }),
    road('path', flat(cls('path')), P.path, lz([16, 0.8, 18, 2]), { minzoom: 16, paint: { 'line-dasharray': [1.5, 1.5] } }),
    road('f-minor', flat(minorF), P.minor, MINOR_W, { minzoom: 13 }),
    road('f-major', flat(majorPlain), P.major, MAJOR_W, { minzoom: 9 }),
    road('f-prime', flat(majorPrime), P.primary, MAJOR_W, { minzoom: 9 }),
    road('f-hwy', flat(hwy), P.highway, HWY_W, { minzoom: 6 }),
    road('cb-all', ['all', isB, anyRoad], caseColor, MAJOR_C, { minzoom: 13 }),
    road('fb-all', ['all', isB, anyRoad], roadColor, MAJOR_W, { minzoom: 13 }),
    road('rail', ['all', ['==', ['get', 'class'], 'rail'], ['!', isT]], P.rail, lz([14.5, 0.6, 16, 1, 18, 1.6]),
      { minzoom: 14.5, paint: { 'line-dasharray': [3, 2], 'line-opacity': lz([14.5, 0, 15, 0.7]) } }),
    { id: 'bld-3d', type: 'fill-extrusion', source: src, 'source-layer': 'building', minzoom: 14.5,
      filter: ['!=', ['get', 'hide_3d'], true],
      layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 5], 0, P.building3d, 60, P.tower3d],
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, ['coalesce', ['get', 'render_height'], 5]],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.92,
        'fill-extrusion-vertical-gradient': true,
      } },
    { id: 'water-label', type: 'symbol', source: src, 'source-layer': 'water_name', minzoom: 13,
      filter: ['all', ['has', 'name'], ['!=', ['get', 'class'], 'ocean']],
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': P.waterLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.2 } },
    { id: 'river-label', type: 'symbol', source: src, 'source-layer': 'waterway', minzoom: 13.5,
      filter: ['all', ['has', 'name'], cls('river', 'canal')],
      layout: { 'text-field': name, 'text-font': FONT, 'text-size': 11, 'symbol-placement': 'line', 'symbol-spacing': 400 },
      paint: { 'text-color': P.waterLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.2 } },
    { id: 'road-label-minor', type: 'symbol', source: src, 'source-layer': 'transportation_name', minzoom: 15.5,
      filter: ['all', ['has', 'name'], minorF],
      layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': lz([15.5, 10, 18, 12]), 'symbol-spacing': 320, 'text-max-angle': 30 },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 } },
    { id: 'road-label-major', type: 'symbol', source: src, 'source-layer': 'transportation_name', minzoom: 13,
      filter: ['all', ['has', 'name'], bigRoad, ['!=', ['get', 'subclass'], 'junction']],
      layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': lz([13, 10, 16, 12.5, 18, 14]), 'symbol-spacing': 360, 'text-max-angle': 30 },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.6 } },
    { id: 'hood-label', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 15.2, maxzoom: 18,
      filter: cls('neighbourhood', 'hamlet', 'isolated_dwelling'),
      layout: areaText(lz([15.2, 9, 17, 10.5])),
      paint: { 'text-color': P.area, 'text-halo-color': P.halo, 'text-halo-width': 1.2, 'text-opacity': lz([15.2, 0, 15.6, 0.9]) } },
    { id: 'district-label', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 13.2, maxzoom: 17,
      filter: cls('quarter', 'suburb', 'village'),
      layout: areaText(lz([13.2, 9.5, 15, 11.5])),
      paint: { 'text-color': P.area, 'text-halo-color': P.halo, 'text-halo-width': 1.2, 'text-opacity': lz([13.2, 0, 13.7, 1, 16.4, 1, 17, 0]) } },
    { id: 'ward-label', type: 'symbol', source: src, 'source-layer': 'place', minzoom: 10.8, maxzoom: 14.2,
      filter: ['all', ['==', ['get', 'class'], 'city'], isWardName],
      layout: { ...areaText(lz([10.8, 11, 13, 12])), 'text-letter-spacing': 0.16 },
      paint: { 'text-color': P.area, 'text-halo-color': P.halo, 'text-halo-width': 1.4, 'text-opacity': lz([10.8, 0, 11.3, 0.95, 13.6, 0.95, 14.2, 0]) } },
    { id: 'city-label', type: 'symbol', source: src, 'source-layer': 'place', maxzoom: 12.6,
      filter: ['all', cls('city', 'town'), ['!', isWardName], ['any', ['>', rank, 1], ['<', ['zoom'], 11]]],
      layout: {
        'text-field': name, 'text-font': FONT, 'symbol-sort-key': rank, 'text-padding': 4, 'text-max-width': 8,
        'text-size': lz([7, ['case', ['<=', rank, 8], 13, 11], 10, ['case', ['<=', rank, 8], 15, 12], 12.6, ['case', ['<=', rank, 8], 16, 13]]),
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.6, 'text-opacity': lz([12, 1, 12.6, 0]) } },
  ];
  return {
    version: 8,
    name: 'tokyo-calm-openmaptiles',
    glyphs: absUrl(GLYPHS_URL),
    sources: {
      [src]: { type: 'vector', url: absUrl(BASEMAP_URL),
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
    },
    layers,
  };
}

/** Switch the basemap's labels to another language in place (no style reload, no tile refetch). */
export function setStyleLang(map, lang) {
  const field = nameExpr(lang);
  for (const id of BASE_LABEL_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'text-field', field);
}

/**
 * Map options the Tokyo page should pass to `new maplibregl.Map` (or createTransitMap's equivalents): bounds and
 * zooms for the Tokyo cut. CJK needs nothing here beyond NOT disabling localIdeographFontFamily (see the top note);
 * give the container lang="ja".
 */
export const TOKYO_MAP_OPTIONS = {
  maxBounds: [[TOKYO_BOUNDS[0], TOKYO_BOUNDS[1]], [TOKYO_BOUNDS[2], TOKYO_BOUNDS[3]]],
  minZoom: 8.5,
  maxZoom: 18.6,
  center: HOME_CENTER,
  zoom: HOME_ZOOM,
};
