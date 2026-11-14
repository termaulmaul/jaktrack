// Build-time settings of the page. web/build.mjs pageConfig() reads them from the environment of `npm run dev` /
// `npm run build` and injects them as __TOKYO_CONFIG__; outside a bundle (node --test) the defaults below apply.
//
//   BASEMAP=openfreemap   (default) OpenFreeMap's public vector tiles (OpenMapTiles schema): no key, no sign-up
//   BASEMAP=protomaps     your own Protomaps basemap tiles (v4 schema), e.g. a Tokyo cut of a Protomaps build served
//                         with `pmtiles serve`: BASEMAP_URL=/tiles/tokyo/{z}/{x}/{y}.mvt (the dev server proxies /tiles/
//                         to TILES_UPSTREAM), BUILDINGS_URL (default: the basemap's own buildings layer), GLYPHS_URL
//   GLYPHS_URL, MAP_FONT  the label glyphs (MapLibre {fontstack}/{range}.pbf) and the font name in them
//   TOKYO_CONTACT         the address shown in About for questions about the app (the ODPT data notice asks for one)
/* global __TOKYO_CONFIG__ */
const C = typeof __TOKYO_CONFIG__ !== 'undefined' && __TOKYO_CONFIG__ ? __TOKYO_CONFIG__ : {};

export const BASEMAP = C.basemap === 'protomaps' ? 'protomaps' : 'openfreemap';
export const OPENFREEMAP_URL = 'https://tiles.openfreemap.org/planet';
export const OPENFREEMAP_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
/** OpenFreeMap: a TileJSON URL. Protomaps: a tile URL template ({z}/{x}/{y}), absolute or site-relative. */
export const BASEMAP_URL = C.basemapUrl || (BASEMAP === 'protomaps' ? '/tiles/tokyo/{z}/{x}/{y}.mvt' : OPENFREEMAP_URL);
/** Protomaps only: a separate building tile set; '' = the basemap's own `buildings` layer. */
export const BUILDINGS_URL = C.buildingsUrl || '';
export const GLYPHS_URL = C.glyphsUrl || (BASEMAP === 'protomaps' ? '/tiles/fonts/{fontstack}/{range}.pbf' : OPENFREEMAP_GLYPHS);
/** The one label font of the map (it must exist on the glyph server; kana and kanji are drawn by the browser). */
export const MAP_FONT = [C.mapFont || (BASEMAP === 'protomaps' ? 'Noto Sans Medium' : 'Noto Sans Regular')];
/** Questions about the app go here (ODPT guideline 3.1 (3)); set your own with TOKYO_CONTACT when you host it. */
export const CONTACT = typeof C.contact === 'string' ? C.contact : '';
