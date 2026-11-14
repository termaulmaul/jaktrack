#!/usr/bin/env node
// Build web/dist: the Tokyo page as a static site (serve it with any web server; the data packs go under /data/tokyo/).
//   - bundle + minify src/tokyo/page.js with esbuild (ESM, code splitting): the page shell is one small file; the map
//     engine + MapLibre load as a lazy chunk (preloaded, so both download in parallel; the shell paints first); every
//     feature module (style, trains layer, model, boards, views, search, 3D city, live) is a lazy chunk too
//   - hashed names: dist/assets/tokyo-<hash>.js|.css, lib-<hash>.js (the lazy chunks)
//   - copy public/ (icons, manifest, LICENSES.txt) and write dist/index.html = the Tokyo page (tokyo.html)
//   - .gz and .br siblings for text assets (nginx gzip_static / brotli_static can use them)
//   - print raw / gzip / brotli sizes and the first-load total
// MapLibre's worker is created from a blob: URL by the standard build, which the CSP allows (worker-src 'self' blob).
// Settings (basemap, contact address): environment variables, see pageConfig() below and web/src/tokyo/config.js.
//
// Feature modules are OPTIONAL at build time (`import { load } from 'tokyo:optional'`): a module that does not build on
// its own resolves to null instead of breaking the build, and the page falls back without it.
//
// Usage: npm run build    (or node web/build.mjs from anywhere)
//        import { esbuildOptions, renderPage, assetsFromMetafile } from './build.mjs'   (dev-server.mjs)

import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_NAME, APP_SLUG, APP_TAGLINE } from './src/project.js';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
export const ENTRY = 'src/tokyo/page.js';
export const TEMPLATE = 'tokyo.html';
const TOKYO = path.join(ROOT, 'src/tokyo');

/**
 * The feature modules page.js integrates: key -> file under src/tokyo/. `needs` = files that must exist too before the
 * module is bundled.
 */
export const OPTIONAL = {
  style: { file: 'style.js' },                    // calm Tokyo basemap
  networkLayer: { file: 'network-layer.js' },     // rail network + stations on the map
  layer: { file: 'layer.js' },                    // WebGL trainsets
  model: { file: 'model.js' },                    // clock, running trains, positions
  fixture: { file: 'fixtures/mini.js' },          // two-line test fixture (built by npm run data; dev only)
  net: { file: 'net.js' },                        // network-v1 decoder
  tt: { file: 'tt.js' },                          // timetable packs loader
  calendar: { file: 'calendar.js' },              // JST date -> calendar
  board: { file: 'board.js' },                    // station boards (logic)
  views: { file: 'views.js' },                    // board / home HTML
  trainView: { file: 'train-view.js' },           // train detail
  lineView: { file: 'line-view.js' },             // train detail
  search: { file: 'search.js' },                  // search
  credits: { file: 'credits.js' },                // credits and notices
  types: { file: 'types.js' },                    // train types and operator looks
  live: { file: 'live.js' },                      // live data (off unless the live service runs)
  city3d: { file: '../layers/city3d/index.js' },   // 3D city + underground (own WebGL2 layers)
  route: { file: 'route.js' },                    // journey planner
  routeView: { file: 'route-view.js' },           // planner screen
  exits: { file: 'exits.js' },                    // station exits
  offline: { file: 'offline.js' },                // offline note + service worker registration
  playback: { file: 'playback.js' },              // time playback
  nearby: { file: 'nearby.js' },                  // "Trains near me" on the home (opt-in location)
  buses: { file: 'buses/index.js' },              // Toei live buses (keyless ODPT GTFS-RT)
  coverage: { file: 'coverage.js' },              // "Live now" sheet (which lines are live), #live
  cctv: { file: 'cctv.js' },                      // traffic cameras (optional pack cctv-v1.json)
};
const DISABLED = new Set((process.env.TOKYO_DISABLE || '').split(',').map((s) => s.trim()).filter(Boolean));
// production builds leave the 2-line test fixture out: no packs = the error card, never fake data.
// TOKYO_FIXTURE=1 keeps it (a dev-like build).
let prodBuild = false;

/** Which optional modules exist right now: {key: absolute path | null}. */
export function optionalPresent() {
  const out = {};
  for (const [k, o] of Object.entries(OPTIONAL)) {
    const f = path.join(TOKYO, o.file);
    const ok = !DISABLED.has(k) && !(prodBuild && k === 'fixture' && process.env.TOKYO_FIXTURE !== '1') && fsSync.existsSync(f) && (o.needs || []).every((n) => fsSync.existsSync(path.join(TOKYO, n)));
    out[k] = ok ? f : null;
  }
  return out;
}

/**
 * A feature module is bundled only if it builds on its own (its imports resolve, its exports match): a broken module is
 * left out instead of breaking the page. Verdicts are cached on the mtimes of every source file under src/tokyo and
 * src/layers.
 */
export const verdicts = {};   // key -> { file, ok, error }
let verdictStamp = '';
let sourceFiles = [];
function sourceStamp() {
  const out = [];
  const files = [];
  const walk = (dir) => {
    let ents;
    try { ents = fsSync.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(m?js|json|webp|png|svg|glb|bin)$/.test(e.name)) { try { out.push(`${p}:${fsSync.statSync(p).mtimeMs}`); files.push(p); } catch { /* raced */ } }
    }
  };
  for (const d of ['src/tokyo', 'src/layers', 'src/vendor']) walk(path.join(ROOT, d));
  sourceFiles = files.filter((f) => /\.m?js$/.test(f));
  return out.sort().join('|');
}
export async function validateOptional() {
  const stamp = sourceStamp();
  if (stamp === verdictStamp) return verdicts;
  const present = optionalPresent();
  await Promise.all(Object.entries(present).map(async ([k, f]) => {
    if (!f) { verdicts[k] = { file: null, ok: false, error: prodBuild && k === 'fixture' ? 'dev only' : 'not there' }; return; }
    try {
      await esbuild.build({
        absWorkingDir: ROOT, entryPoints: [f], bundle: true, write: false, format: 'esm', platform: 'browser', splitting: false,
        outdir: path.join(ROOT, 'dist/.check'), logLevel: 'silent', target: ['es2020'],
        loader: { '.png': 'file', '.svg': 'file', '.webp': 'file', '.jpg': 'file', '.glb': 'file', '.bin': 'file' },
        plugins: [{ name: 'opt-stub', setup(b) { b.onResolve({ filter: /^tokyo:optional$/ }, () => ({ path: 'x', namespace: 'opt-stub' })); b.onLoad({ filter: /.*/, namespace: 'opt-stub' }, () => ({ contents: 'export const load = {}; export const has = {};', loader: 'js' })); } }],
      });
      verdicts[k] = { file: f, ok: true, error: null };
    } catch (e) {
      const msg = (e.errors || []).slice(0, 3).map((x) => `${x.location?.file || ''}:${x.location?.line || ''} ${x.text}`).join('; ') || String(e.message || e);
      if (verdicts[k]?.error !== msg) console.log(`[build] leaving out module "${k}" (does not build on its own): ${msg}`);
      verdicts[k] = { file: f, ok: false, error: msg };
    }
  }));
  verdictStamp = stamp;
  return verdicts;
}

/** `tokyo:optional` -> `export const load = {style: () => import('./style.js') | null, ...}; export const has = {...}`. */
export function tokyoOptionalPlugin() {
  return {
    name: 'tokyo-optional',
    setup(b) {
      b.onResolve({ filter: /^tokyo:optional$/ }, () => ({ path: 'tokyo:optional', namespace: 'tokyo-optional' }));
      b.onLoad({ filter: /.*/, namespace: 'tokyo-optional' }, async () => {
        const v = await validateOptional();
        const ok = (k) => v[k]?.ok && v[k].file;
        const lines = Object.keys(OPTIONAL).map((k) => `  ${JSON.stringify(k)}: ${ok(k) ? `() => import(${JSON.stringify(`./${path.relative(TOKYO, v[k].file).split(path.sep).join('/')}`)})` : 'null'},`);
        const has = Object.fromEntries(Object.keys(OPTIONAL).map((k) => [k, !!ok(k)]));
        return {
          contents: `export const load = {\n${lines.join('\n')}\n};\nexport const has = ${JSON.stringify(has)};\n`,
          resolveDir: TOKYO,
          loader: 'js',
          // adding, removing or fixing a module triggers a rebuild in watch mode
          watchDirs: [TOKYO, path.join(TOKYO, 'fixtures'), path.join(TOKYO, 'buses'), path.join(ROOT, 'src/layers/city3d')].filter((d) => fsSync.existsSync(d)),
          watchFiles: sourceFiles,
        };
      });
    },
  };
}

/**
 * The page's build-time settings (web/src/tokyo/config.js reads them as __TOKYO_CONFIG__). From the environment:
 * BASEMAP (openfreemap | protomaps), BASEMAP_URL, BUILDINGS_URL, GLYPHS_URL, MAP_FONT, TOKYO_CONTACT.
 */
export function pageConfig(env = process.env) {
  const cfg = { basemap: env.BASEMAP === 'protomaps' ? 'protomaps' : 'openfreemap' };
  for (const [k, e] of [['basemapUrl', 'BASEMAP_URL'], ['buildingsUrl', 'BUILDINGS_URL'], ['glyphsUrl', 'GLYPHS_URL'], ['mapFont', 'MAP_FONT'], ['contact', 'TOKYO_CONTACT']]) {
    if (env[e] != null && env[e] !== '') cfg[k] = env[e];
  }
  return cfg;
}

/** Origins outside the site the page talks to (the basemap's tiles and glyphs): for the CSP connect-src. */
export function remoteOrigins(cfg = pageConfig()) {
  const out = new Set();
  const urls = cfg.basemap === 'protomaps' ? [cfg.basemapUrl, cfg.buildingsUrl, cfg.glyphsUrl]
    : [cfg.basemapUrl || 'https://tiles.openfreemap.org/planet', cfg.glyphsUrl || 'https://tiles.openfreemap.org/fonts/'];
  for (const u of urls) { try { if (/^https?:\/\//.test(u || '')) out.add(new URL(u.replace(/[{}]/g, '')).origin); } catch { /* not a URL */ } }
  return [...out];
}

export function esbuildOptions({ dev = false } = {}) {
  return {
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    bundle: true,
    plugins: [tokyoOptionalPlugin()],
    publicPath: '/assets',
    splitting: true,
    format: 'esm',
    target: ['es2020', 'chrome92', 'safari15', 'firefox92'],
    minify: !dev,
    sourcemap: dev ? 'inline' : false,
    outdir: path.join(ROOT, 'dist/assets'),
    entryNames: dev ? 'tokyo' : 'tokyo-[hash]',
    chunkNames: dev ? 'chunk-[name]-[hash]' : 'lib-[hash]',
    assetNames: 'asset-[name]-[hash]',
    metafile: true,
    write: !dev,
    loader: { '.png': 'file', '.svg': 'file', '.webp': 'file', '.jpg': 'file', '.glb': 'file', '.bin': 'file' },
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"', __TOKYO_CONFIG__: JSON.stringify(pageConfig()) },
    logLevel: 'warning',
  };
}

// + tokyo/style: the map is created only once its style module is in; preloaded with the map engine it
// no longer waits for page.js to ask for it (~0.4 s earlier map paint at fast 4G)
const FIRST = /^src\/(map\/tokyo-map|tokyo\/(net|tt|calendar|model|style))\.js$/;
/** From the metafile: the entry js/css plus the map + data chunks (to preload) and every css bundle (to link). */
export function assetsFromMetafile(metafile, which = ENTRY) {
  const outs = metafile.outputs;
  const rel = (p) => `/assets/${path.basename(p)}`;
  let entry = null;
  for (const [file, o] of Object.entries(outs)) if (o.entryPoint === which && file.endsWith('.js')) entry = file;
  if (!entry) throw new Error('entry output not found');
  const css = [];
  const preload = [];
  if (outs[entry].cssBundle) css.push(rel(outs[entry].cssBundle));
  const seen = new Set([entry]);
  const walk = (file) => {
    for (const imp of outs[file]?.imports || []) {
      if (imp.external || seen.has(imp.path) || !imp.path.endsWith('.js')) continue;
      // Before first draw: the map engine and the data decoders (measured faster than loading them after the shell); the
      // other modules load after (page.js kicks the first screen's chunks at boot).
      if (imp.kind === 'dynamic-import' && !FIRST.test(outs[imp.path]?.entryPoint || '')) continue;
      seen.add(imp.path);
      preload.push(rel(imp.path));
      if (outs[imp.path]?.cssBundle) css.push(rel(outs[imp.path].cssBundle));
      walk(imp.path);
    }
  };
  walk(entry);
  return { js: rel(entry), css: [...new Set(css)], preload };
}

/** tokyo.html with the bundle's tags in <!--APP_HEAD--> and the project's name in %APP_NAME% / %APP_TAGLINE%. */
export function renderPage(template, { js, css, preload }, { extraHead = '' } = {}) {
  const head = [
    ...css.map((h) => `<link rel="stylesheet" href="${h}">`),
    ...preload.map((h) => `<link rel="modulepreload" href="${h}">`),
    `<script type="module" src="${js}"></script>`,
    extraHead,
  ].filter(Boolean).join('\n');
  if (!template.includes('<!--APP_HEAD-->')) throw new Error('tokyo.html has no <!--APP_HEAD--> marker');
  return template.replace('<!--APP_HEAD-->', head).replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_TAGLINE%', APP_TAGLINE);
}

/** public/ text files with placeholders (tokyo.webmanifest, LICENSES.txt): the project's name and the contact address. */
export function renderManifest(text, cfg = pageConfig()) {
  const contact = typeof cfg.contact === 'string' ? cfg.contact : '';
  return text.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_SLUG%', APP_SLUG).replaceAll('%CONTACT%', contact || '(no contact address set: TOKYO_CONTACT)');
}
export const RENDERED_PUBLIC = ['tokyo.webmanifest', 'LICENSES.txt'];

async function copyDir(src, dst) {
  let entries;
  try { entries = await fs.readdir(src, { withFileTypes: true }); } catch { return; }
  await fs.mkdir(dst, { recursive: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}

async function walkFiles(dir, out = []) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

const COMPRESS = /\.(js|css|html|svg|json|webmanifest|txt|map)$/;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`.padStart(10);

async function main() {
  const t0 = Date.now();
  prodBuild = true;
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, 'assets'), { recursive: true });

  await validateOptional();
  const present = Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, v.ok ? v.file : null]));
  const result = await esbuild.build(esbuildOptions());
  const assets = assetsFromMetafile(result.metafile);

  await copyDir(path.join(ROOT, 'public'), DIST);
  for (const f of RENDERED_PUBLIC) {
    const file = path.join(DIST, f);
    await fs.writeFile(file, renderManifest(await fs.readFile(file, 'utf8')));
  }
  const template = await fs.readFile(path.join(ROOT, TEMPLATE), 'utf8');
  await fs.writeFile(path.join(DIST, 'index.html'), renderPage(template, assets));
  // the service worker (src/tokyo/sw.js): /sw.js at the root (scope '/'), stamped with this build's id and
  // every /assets/* file it made, so it precaches exactly this build (offline.js registers it on the built site only)
  const swSrc = path.join(ROOT, 'src/tokyo/sw.js');
  if (fsSync.existsSync(swSrc)) {
    const list = (await fs.readdir(path.join(DIST, 'assets'))).filter((f) => !/\.(br|gz)$/.test(f)).sort().map((f) => `/assets/${f}`);
    const build = path.basename(assets.js).replace(/^tokyo-|\.js$/g, '');
    // kill switch: TK_SW_OFF=1 builds a worker that removes itself (and its caches) from every phone
    const stamp = `self.__TK_BUILD__ = ${JSON.stringify(build)};\nself.__TK_ASSETS__ = ${JSON.stringify(list)};\n${process.env.TK_SW_OFF === '1' ? 'self.__TK_SW_OFF__ = true;\n' : ''}`;
    if (process.env.TK_SW_OFF === '1') console.log('* sw.js SWITCHED OFF (TK_SW_OFF=1): this build removes the worker from every phone');
    await fs.writeFile(path.join(DIST, 'sw.js'), stamp + await fs.readFile(swSrc, 'utf8'));
  }

  // Precompressed siblings + size report.
  const rows = [];
  for (const file of await walkFiles(DIST)) {
    if (/\.(gz|br)$/.test(file)) continue;
    const buf = await fs.readFile(file);
    let gz = null;
    let br = null;
    if (COMPRESS.test(file) && buf.length > 512) {
      gz = zlib.gzipSync(buf, { level: 9 });
      br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
      await fs.writeFile(`${file}.gz`, gz);
      await fs.writeFile(`${file}.br`, br);
    }
    rows.push({ rel: path.relative(DIST, file), raw: buf.length, gz: gz ? gz.length : buf.length, br: br ? br.length : buf.length });
  }
  rows.sort((a, b) => b.raw - a.raw);

  // First load = the page, its JS/CSS (shell + map chunk) and the favicon.
  const firstLoad = new Set(['index.html', ...[assets.js, ...assets.css, ...assets.preload].map((h) => h.slice(1)), 'icon.svg']);
  const fl = { raw: 0, gz: 0, br: 0 };
  console.log(`\n${'file'.padEnd(46)}${'raw'.padStart(10)}${'gzip'.padStart(10)}${'brotli'.padStart(10)}`);
  for (const r of rows) {
    const mark = firstLoad.has(r.rel) ? '*' : ' ';
    console.log(`${mark} ${r.rel.padEnd(44)}${kb(r.raw)}${kb(r.gz)}${kb(r.br)}`);
    if (firstLoad.has(r.rel)) { fl.raw += r.raw; fl.gz += r.gz; fl.br += r.br; }
  }
  console.log(`\n* first load (page + shell + map chunk):  raw ${kb(fl.raw).trim()}, gzip ${kb(fl.gz).trim()}, brotli ${kb(fl.br).trim()}`);
  console.log(`  modules bundled: ${Object.entries(present).filter(([, f]) => f).map(([k]) => k).join(', ') || 'none'}`);
  console.log(`  left out (null at runtime): ${Object.entries(verdicts).filter(([, v]) => !v.ok).map(([k, v]) => `${k} (${v.error})`).join('; ') || 'none'}`);
  await dataSizes();
  console.log(`\nbuilt web/dist in ${Date.now() - t0} ms -> ${assets.js}`);
  return { assets, rows, firstLoad: fl };
}

/** Runtime data sizes from var/static/tokyo (what the page fetches; built by npm run data). */
async function dataSizes() {
  const dir = path.join(ROOT, '..', 'var', 'static', 'tokyo');
  let names;
  try { names = (await fs.readdir(dir)).filter((f) => /\.json$/.test(f)); } catch { return; }
  for (const f of names.sort()) {
    const size = async (x) => { try { return (await fs.stat(path.join(dir, x))).size; } catch { return null; } };
    const [raw, gz, br] = [await size(f), await size(`${f}.gz`), await size(`${f}.br`)];
    console.log(`  data ${f.padEnd(40)} raw ${kb(raw).trim()}, gzip ${gz != null ? kb(gz).trim() : '?'}, brotli ${br != null ? kb(br).trim() : '?'}`);
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { main as build };
