#!/usr/bin/env node
// Dev server: `npm run dev` -> http://127.0.0.1:4776
//   /                 tokyo.html with the dev bundle (rebuilt in memory on every change, the page reloads itself)
//   /assets/*         esbuild output (memory)
//   /data/tokyo/*     the packs `npm run data` wrote to var/static/tokyo (.br/.gz when asked)
//   /api/tokyo/*      -> the live service (`npm run live`, default http://127.0.0.1:4777); not running = 200 {off: true}
//   /tiles/*          -> TILES_UPSTREAM (self-hosted basemap tiles, BASEMAP=protomaps), only when set
//   /tiles/fonts/*    files in GLYPHS_DIR (self-hosted glyphs), only when set
//   /__dev/*          live reload, build status (/__dev/status), last build error (/__dev/error)
//   everything else   -> web/public/
// Sends a CSP like a production server should, so CSP problems show up in dev. A failed rebuild keeps serving the LAST
// GOOD build; the error is logged and shown at /__dev/error.
//
// HTTPS=1 or --https (`bun run dev:https`): the same server over https on every interface, so a phone on the same Wi-Fi gets
// a secure context (the browser only shares a location over https or on localhost). A self-signed certificate is made
// once with the system's `openssl` into var/tls/ (never committed) and remade when the machine's LAN address changes.
// docs/LOKASI.md.
//
// Env: PORT (4776), HOST (127.0.0.1; 0.0.0.0 with HTTPS), HTTPS, DATA_DIR (var/static/tokyo), LIVE_UPSTREAM (http://127.0.0.1:4777),
//      TILES_UPSTREAM, GLYPHS_DIR, the page settings of web/src/tokyo/config.js (BASEMAP, ...), TOKYO_DISABLE=layer,city3d
//      (leaves those modules out of the bundle). `--dist` (npm run serve) serves web/dist (npm run build) instead.

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import path from 'node:path';
import { ROOT, TEMPLATE, RENDERED_PUBLIC, assetsFromMetafile, esbuildOptions, renderPage, renderManifest, remoteOrigins, verdicts } from './build.mjs';

const PORT = Number(process.env.PORT || 4776);
const HTTPS = process.env.HTTPS === '1' || process.argv.includes('--https');
const HOST = process.env.HOST || (HTTPS ? '0.0.0.0' : '127.0.0.1');
const TILES = process.env.TILES_UPSTREAM ? new URL(process.env.TILES_UPSTREAM) : null;
const LIVE = new URL(process.env.LIVE_UPSTREAM || 'http://127.0.0.1:4777');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '..', 'var', 'static', 'tokyo'));
const GLYPHS = process.env.GLYPHS_DIR ? path.resolve(process.env.GLYPHS_DIR) : null;
const SERVE_DIST = process.env.DIST === '1' || process.argv.includes('--dist');
const REMOTE = remoteOrigins();
const PUBLIC = path.join(ROOT, SERVE_DIST ? 'dist' : 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.pbf': 'application/x-protobuf',
  '.map': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.mvt': 'application/vnd.mapbox-vector-tile',
};

// ------------------------------------------------------------------ https (opt-in): a self-signed certificate for this machine
const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
/** { key, cert } from var/tls/, made with openssl when missing, about to expire, or not naming one of this machine's addresses. */
function devCert() {
  const dir = path.join(ROOT, '..', 'var', 'tls');
  const keyFile = path.join(dir, 'dev-key.pem'), certFile = path.join(dir, 'dev-cert.pem');
  const sans = ['DNS:localhost', 'IP:127.0.0.1', ...lanIps().map((ip) => `IP:${ip}`)];
  try {
    const x = new X509Certificate(fs.readFileSync(certFile));
    const have = x.subjectAltName || '';
    const covers = sans.every((n) => have.split(', ').includes(n.replace(/^IP:/, 'IP Address:')));
    if (covers && Date.parse(x.validTo) - Date.now() > 7 * 864e5) return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  } catch { /* none yet, or unreadable: make one */ }
  fs.mkdirSync(dir, { recursive: true });
  const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '365', '-subj', '/CN=jaktrack dev',
    '-addext', `subjectAltName=${sans.join(',')}`, '-addext', 'extendedKeyUsage=serverAuth', '-keyout', keyFile, '-out', certFile], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error(r.error?.code === 'ENOENT'
      ? '[dev] HTTPS=1 needs the `openssl` command to make a certificate, and it is not installed (not on PATH). Install OpenSSL, or run without HTTPS.'
      : `[dev] openssl could not make the certificate:\n${r.error?.message || r.stderr}`);
    process.exit(1);
  }
  fs.chmodSync(keyFile, 0o600);
  console.log(`[dev] made a self-signed certificate for ${sans.join(', ')} (${path.relative(process.cwd(), certFile)})`);
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}
const TLS = HTTPS ? devCert() : null;

// ------------------------------------------------------------------ in-memory build with watch (last good build kept)
let outputs = new Map();   // '/assets/name' -> Uint8Array
// Every lazy chunk ever built is also written to disk (names are content hashed), so a page loaded before a rebuild OR
// before a restart of this server still gets its lazy chunks; 6 h kept.
const CHUNK_DIR = path.join(ROOT, '..', 'var', 'tmp', 'dev-chunks');
try {
  fs.mkdirSync(CHUNK_DIR, { recursive: true });
  for (const f of fs.readdirSync(CHUNK_DIR)) { const st = fs.statSync(path.join(CHUNK_DIR, f)); if (Date.now() - st.mtimeMs > 6 * 3600e3) fs.rmSync(path.join(CHUNK_DIR, f)); }
} catch (e) { console.log('[dev] chunk dir', e.message); }
let assets = null;
let buildError = null;
let builtAt = null;
let buildCount = 0;
const clients = new Set();
const reload = () => { for (const res of clients) res.write('event: reload\ndata: 1\n\n'); };

if (!SERVE_DIST) {
  const base = esbuildOptions({ dev: true });
  const ctx = await esbuild.context({
    ...base,
    plugins: [...base.plugins, {
      name: 'memory',
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length) {
            buildError = result.errors.map((e) => `${e.location?.file || ''}:${e.location?.line || ''} ${e.text}`).join('\n');
            console.log(`[dev] ${new Date().toISOString().slice(11, 19)}Z build FAILED (still serving the last good build):\n${buildError}`);
            return;   // no reload: the open pages keep the last good build
          }
          let nextAssets;
          try { nextAssets = assetsFromMetafile(result.metafile); } catch (e) { buildError = String(e); console.log(`[dev] ${buildError}`); return; }
          const next = new Map();
          for (const f of result.outputFiles || []) {
            const name = path.basename(f.path);
            next.set(`/assets/${name}`, f.contents);
            if (name.startsWith('chunk-')) { const disk = path.join(CHUNK_DIR, name); if (!fs.existsSync(disk)) fs.promises.writeFile(disk, f.contents).catch(() => {}); }
          }
          outputs = next;   // older chunks: CHUNK_DIR
          assets = nextAssets;
          buildError = null;
          builtAt = new Date();
          buildCount++;
          const on = Object.entries(verdicts).filter(([, v]) => v.ok).map(([k]) => k);
          const sig = on.join(',');
          if (sig !== reload.sig) { reload.sig = sig; console.log(`[dev] built ${builtAt.toISOString().slice(11, 19)}Z #${buildCount} (modules: ${on.join(', ') || 'none'})`); }
          reload();
        });
      },
    }],
  });
  await ctx.watch();
  // tokyo.html and public/ are outside esbuild's graph: reload on change.
  for (const p of [path.join(ROOT, TEMPLATE), path.join(ROOT, 'public')]) {
    try { fs.watch(p, { recursive: true }, () => { clearTimeout(reload.t); reload.t = setTimeout(reload, 120); }); } catch { /* fine */ }
  }
}

/** Origins of the camera streams in the CCTV pack (cctv-v1.json `hosts`, written by data-build/cctv.mjs): only these
 *  may be loaded as media. No pack = none. Read per page load: a rebuild of the data shows without a restart. */
function cctvHosts() {
  try {
    const hosts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cctv-v1.json'), 'utf8')).hosts;
    return Array.isArray(hosts) ? hosts.filter((h) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(h)) : [];
  } catch { return []; }
}

function csp(req) {
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    `connect-src 'self' blob: data: ${TLS ? 'wss' : 'ws'}://${host}${REMOTE.length ? ` ${REMOTE.join(' ')}` : ''}`,
    "worker-src 'self' blob:",
    "img-src 'self' data: blob:",
    `media-src 'self' blob:${cctvHosts().map((h) => ` ${h}`).join('')}`,   // CCTV: <video> plays HLS straight from the owners' servers
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(body);
}

// ------------------------------------------------------------------ proxy
function proxy(req, res, target, upstreamPath) {
  const p = http.request({
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: upstreamPath,
    headers: { ...req.headers, host: target.host },
  }, (pr) => {
    res.writeHead(pr.statusCode || 502, pr.headers);
    pr.pipe(res);
  });
  p.setTimeout(30000, () => p.destroy(new Error('timeout')));
  p.on('error', () => {
    // a service that is not up: 204 for tiles (MapLibre draws nothing, logs nothing), the live feed's own "off" answer
    if (res.headersSent) { res.destroy(); return; }
    if (target === TILES) send(res, 204, '');
    else if (target === LIVE) send(res, 200, JSON.stringify({ off: true, reason: 'upstream_unavailable' }), 'application/json');   // the poller's own "off" answer: no console noise
    else send(res, 503, JSON.stringify({ error: 'upstream_unavailable' }), 'application/json');
  });
  req.pipe(p);
}

async function serveFile(res, file, req, extra = {}) {
  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = path.extname(file);
    const headers = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-cache' };
    if (ext === '.html') headers['content-security-policy'] = csp(req);
    Object.assign(headers, extra);
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'not found');
  }
}

/** Precompressed sibling when the client takes it (like nginx brotli_static / gzip_static). */
async function serveData(res, file, req) {
  const ae = String(req.headers['accept-encoding'] || '');
  for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']]) {
    if (!ae.includes(enc)) continue;
    try {
      const st = await fsp.stat(file + ext);
      if (!st.isFile()) continue;
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'content-encoding': enc, vary: 'accept-encoding', 'cache-control': 'no-cache', 'content-length': st.size });
      fs.createReadStream(file + ext).pipe(res);
      return;
    } catch { /* next */ }
  }
  return serveFile(res, file, req, { vary: 'accept-encoding' });
}

function safeJoin(base, rel) {
  const p = path.resolve(base, `.${path.posix.normalize(`/${rel}`)}`);
  return p.startsWith(path.resolve(base) + path.sep) || p === path.resolve(base) ? p : null;
}

// Live reload; ?noreload (screenshots, tests) keeps the page still while files change.
const RELOAD_JS = "if (!/[?&]noreload/.test(location.search)) new EventSource('/__dev/events').addEventListener('reload', () => location.reload());\n";

const server = (TLS ? https.createServer.bind(https, TLS) : http.createServer)(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  res.setHeader('x-robots-tag', 'noindex');
  try {
    if (p.startsWith('/data/tokyo/')) {
      let rel;
      try { rel = decodeURIComponent(p.slice('/data/tokyo/'.length)); } catch { return send(res, 400, 'bad path'); }
      const file = safeJoin(DATA_DIR, rel);
      return file ? serveData(res, file, req) : send(res, 403, 'forbidden');
    }
    if (GLYPHS && p.startsWith('/tiles/fonts/')) {
      let rel;
      try { rel = decodeURIComponent(p.slice('/tiles/fonts/'.length)); } catch { return send(res, 400, 'bad path'); }
      const file = safeJoin(GLYPHS, rel);
      return file ? serveFile(res, file, req) : send(res, 403, 'forbidden');
    }
    if (p.startsWith('/tiles/')) return TILES ? proxy(req, res, TILES, req.url.slice('/tiles'.length)) : send(res, 404, 'no TILES_UPSTREAM');
    // the live service's health stays on its own loopback port (see server/live.mjs), never through the site
    if (/^\/api\/tokyo\/live\/health/.test(p)) return send(res, 404, JSON.stringify({ error: 'not here' }), 'application/json');
    if (p === '/api/tokyo' || p.startsWith('/api/tokyo/')) return proxy(req, res, LIVE, req.url);
    if (p === '/__dev/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hi\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/__dev/reload.js') return send(res, 200, RELOAD_JS, TYPES['.js']);
    if (p === '/__dev/status') {
      return send(res, 200, JSON.stringify({ ok: !buildError, servingLastGood: !!buildError && !!assets, builtAt, builds: buildCount, error: buildError, modules: Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, v.ok])), leftOut: Object.fromEntries(Object.entries(verdicts).filter(([, v]) => !v.ok).map(([k, v]) => [k, v.error])), assets }, null, 2), TYPES['.json']);
    }
    if (p === '/__dev/error') return send(res, 200, buildError || 'no build error');
    if (!SERVE_DIST && p.startsWith('/assets/')) {
      const body = outputs.get(p);
      if (body) return send(res, 200, body, TYPES[path.extname(p)] || 'application/octet-stream');
      const name = path.basename(p);
      if (name.startsWith('chunk-') && fs.existsSync(path.join(CHUNK_DIR, name))) return serveFile(res, path.join(CHUNK_DIR, name), req);
      return send(res, 404, 'not built');
    }
    if (p === '/' || p === '/index.html' || p === '/tokyo' || p === '/tokyo.html') {
      if (SERVE_DIST) return serveFile(res, path.join(PUBLIC, 'index.html'), req);
      if (!assets) {
        return send(res, 500, `<!doctype html><meta charset=utf-8><script type="module" src="/__dev/reload.js"></script><pre style="padding:16px;font:13px/1.5 monospace;white-space:pre-wrap">${(buildError || 'building…').replace(/</g, '&lt;')}</pre>`, TYPES['.html'], { 'content-security-policy': csp(req) });
      }
      const template = await fsp.readFile(path.join(ROOT, TEMPLATE), 'utf8');
      const html = renderPage(template, assets, { extraHead: '<script type="module" src="/__dev/reload.js"></script>' });
      return send(res, 200, html, TYPES['.html'], { 'content-security-policy': csp(req), 'x-build': buildError ? 'last-good' : 'ok' });
    }
    if (p === '/robots.txt' && !fs.existsSync(path.join(PUBLIC, 'robots.txt'))) return send(res, 200, 'User-agent: *\nDisallow: /\n');
    if (!SERVE_DIST && RENDERED_PUBLIC.includes(p.slice(1))) return send(res, 200, renderManifest(await fsp.readFile(path.join(PUBLIC, p.slice(1)), 'utf8')), TYPES[path.extname(p)]);
    let rel;
    try { rel = decodeURIComponent(p); } catch { return send(res, 400, 'bad path'); }
    const file = safeJoin(PUBLIC, rel);
    return file ? serveFile(res, file, req) : send(res, 403, 'forbidden');
  } catch (e) {
    console.error('[dev]', e);
    if (!res.headersSent) send(res, 500, 'error');
  }
});

server.listen(PORT, HOST, () => {
  const haveData = fs.existsSync(path.join(DATA_DIR, 'tt-latest.json')) && fs.existsSync(path.join(DATA_DIR, 'network-latest.json'));
  const wild = HOST === '0.0.0.0' || HOST === '::';
  const hosts = TLS && wild ? ['localhost', ...lanIps()] : [HOST];
  for (const h of hosts) console.log(`[dev] open ${TLS ? 'https' : 'http'}://${h}:${PORT}/${SERVE_DIST ? '  (serving web/dist)' : ''}`);
  if (TLS) console.log('[dev] self-signed certificate: the browser warns once per device; choose "Advanced" -> "Proceed" (docs/LOKASI.md)');
  console.log(`[dev] data ${path.relative(process.cwd(), DATA_DIR) || DATA_DIR}${haveData ? '' : '  (EMPTY: run `npm run data` first)'}  live -> ${LIVE.origin}${TILES ? `  tiles -> ${TILES.origin}` : ''}${REMOTE.length ? `  basemap: ${REMOTE.join(', ')}` : ''}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
