// Pembangun CCTV: aturan buang/terima pada contoh kecil, lalu berkas hasil `bun run data` bila ada.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { buildCctv, BOX } from './cctv.mjs';
import { cctvCredit } from '../web/src/tokyo/credits.js';

const SRC = {
  v: 1, checkedAt: '2026-11-13T15:14:19Z',
  sources: { a: { name: 'CCTV A', owner: 'Pemilik A', page: 'https://a.example/cctv' }, b: { name: 'B', owner: 'Pemilik B', page: 'https://b.example/' } },
  cams: [
    { id: 'a-1', src: 'a', kind: 'kota', name: 'Simpang Satu', sub: 'Jakarta', lat: -6.2, lng: 106.8, views: [['1', 'https://s.example:7028/x/index.m3u8', 'https://a.example/1'], ['2', 'https://yt.example/embed/x', 'https://a.example/2', 'frame']] },
    { id: 'a-2', src: 'a', kind: 'kota', name: 'Di Surabaya', sub: '', lat: -7.25, lng: 112.75, views: [['1', 'https://s.example/y.m3u8', 'https://a.example/3']] },
    { id: 'a-3', src: 'a', kind: 'kota', name: 'Tanpa tautan', sub: '', lat: -6.2, lng: 106.8, views: [['1', 'https://s.example/z.m3u8', 'javascript:alert(1)']] },
    { id: 'a-4', src: 'zz', kind: 'kota', name: 'Sumber tak dikenal', sub: '', lat: -6.2, lng: 106.8, views: [['1', '', 'https://a.example/4']] },
    { id: 'a-1', src: 'a', kind: 'kota', name: 'Id kembar', sub: '', lat: -6.2, lng: 106.8, views: [['1', '', 'https://a.example/5']] },
    { id: 'b-1', src: 'b', kind: 'tol', name: 'Mati', sub: '', lat: -6.3, lng: 106.9, views: [['1', '', 'https://b.example/', 'off']] },
    { id: 'b-2', src: 'b', kind: 'tol', name: 'Stream http', sub: '', lat: -6.3, lng: 106.9, views: [['1', 'http://s.example/q.m3u8', 'https://b.example/q']] },
  ],
};

test('contoh: yang salah dibuang, view frame dan stream non-https jadi tautan saja', () => {
  const { pack, dropped } = buildCctv(SRC, '2026-11-15T00:00:00Z');
  expect(pack.cams.map((c) => c.id)).toEqual(['a-1', 'b-2']);
  expect(dropped).toEqual(['a-2 (koordinat)', 'a-3 (tautan)', 'a-4 (sumber)', 'a-1 (id)', 'b-1 (tautan)']);
  expect(pack.cams[0].views).toEqual([['1', 'https://s.example:7028/x/index.m3u8', 'https://a.example/1'], ['2', '', 'https://a.example/2']]);
  expect(pack.cams[1].views).toEqual([['1', '', 'https://b.example/q']]);
  expect(pack.hosts).toEqual(['https://s.example:7028']);
  expect(pack.sources.a.n).toBe(1);
});

function check(pack) {
  expect(pack.v).toBe(1);
  expect(pack.cams.length).toBeGreaterThan(0);
  expect(new Set(pack.cams.map((c) => c.id)).size).toBe(pack.cams.length);
  const hosts = new Set(pack.hosts);
  for (const c of pack.cams) {
    expect(c.name).toBeTruthy();
    expect(pack.sources[c.src].owner).toBeTruthy();
    expect(c.lat).toBeGreaterThanOrEqual(BOX.latMin); expect(c.lat).toBeLessThanOrEqual(BOX.latMax);
    expect(c.lng).toBeGreaterThanOrEqual(BOX.lngMin); expect(c.lng).toBeLessThanOrEqual(BOX.lngMax);
    expect(c.views.length).toBeGreaterThan(0);
    for (const [label, hls, page] of c.views) {
      expect(typeof label).toBe('string');
      expect(page).toMatch(/^https:\/\//);                       // tiap sudut punya tautan pemilik
      if (hls) { expect(hls).toMatch(/^https:\/\/.+\.m3u8/); expect(hosts.has(new URL(hls).origin)).toBe(true); }
    }
  }
  for (const h of pack.hosts) expect(h).toMatch(/^https:\/\/[a-z0-9.-]+(:\d+)?$/);   // origin saja: masuk ke CSP media-src
}

test('contoh lolos pemeriksaan bentuk', () => check(buildCctv(SRC).pack));

const OUT = 'var/static/tokyo/cctv-v1.json', built = existsSync(OUT);
test.skipIf(!built)('berkas hasil bangun: bentuk, koordinat di Jabodetabek, tautan pemilik, terdaftar di packs.json', () => {
  const pack = JSON.parse(readFileSync(OUT, 'utf8'));
  check(pack);
  expect(pack.cams.length).toBeGreaterThan(400);
  expect(JSON.parse(readFileSync('var/static/tokyo/packs.json', 'utf8')).files).toContain('cctv-v1.json');
});

test('kredit menyebut tiap pemilik dan menyatakan tidak berafiliasi', () => {
  const { pack } = buildCctv(SRC);
  for (const lang of ['en', 'ja', 'id']) {
    const b = cctvCredit(lang, pack.sources);
    expect(b.key).toBe('cctv');
    const text = b.lines.join(' ');
    for (const s of Object.values(pack.sources)) expect(text).toContain(s.owner);
    expect(b.links.map((l) => l.href)).toEqual(Object.values(pack.sources).map((s) => s.page));
  }
  expect(cctvCredit('id', pack.sources).lines.join(' ')).toContain('tidak berafiliasi');
});
