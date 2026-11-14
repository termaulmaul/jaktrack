// Uji penyelarasan trase dengan rel OSM buatan (tanpa berkas).
import { expect, test } from 'bun:test';
import { snapper } from './snap.mjs';

const LAT = -6.2, LNG0 = 106.8, perM = 1 / (111320 * Math.cos(-6.4 * Math.PI / 180)), latM = 1 / 110574;
const at = (m, north = 0) => ({ lon: LNG0 + m * perM, lat: LAT + north * latM });
const way = (railway, a, b, north = 0, tags = {}) => ({ tags: { railway, ...tags }, geometry: [at(a, north), at(b, north)] });
const path = (north = 0, len = 2000) => [[LNG0, LAT + north * latM], [LNG0 + len * perM, LAT + north * latM]];
const northOf = ([, lat]) => (lat - LAT) / latM;

test('jalur ganda: lintasan di salah satu rel pindah ke tengah kedua rel', () => {
  const S = snapper([way('rail', 0, 2000, 0), way('rail', 0, 2000, 4)]);
  const r = S.snap(path(0), 'rail');
  for (const p of r.points) expect(Math.abs(northOf(p) - 2)).toBeLessThan(0.3);
  expect(r.unmatched).toBe(0);
  expect(S.offset(path(0), 'rail').mean).toBeLessThan(0.1);
  expect(Math.abs(S.offset(r.points, 'rail').mean - 2)).toBeLessThan(0.3);
});

test('rel tunggal: lintasan yang meleset 20 m ditarik ke rel; ujung-ujungnya tetap di tempat sepanjang lintasan', () => {
  const S = snapper([way('subway', 0, 2000, 20)]);
  const r = S.snap(path(0), 'subway');
  for (const p of r.points) expect(Math.abs(northOf(p) - 20)).toBeLessThan(0.3);
  expect(Math.abs(r.points[0][0] - LNG0)).toBeLessThan(2 * perM);
  expect(Math.abs(r.points.at(-1)[0] - (LNG0 + 2000 * perM))).toBeLessThan(2 * perM);
});

test('rel jenis lain, rel yang jauh, dan lintasan tanpa rel OSM tidak mengubah apa pun', () => {
  const S = snapper([way('rail', 0, 2000, 10), way('subway', 0, 2000, 90)]);
  const r = S.snap(path(0), 'subway');
  for (const p of r.points) expect(Math.abs(northOf(p))).toBeLessThan(0.01);
  expect(r.unmatched).toBeGreaterThan(1900);
  expect(S.offset(path(0), 'light_rail').mean).toBe(null);
});

test('zona rel layang: rel layang dipilih walau rel permukaan lebih dekat, dengan peralihan landai', () => {
  const ways = [way('rail', 0, 2000, 0), way('rail', 0, 2000, 30, { bridge: 'yes', layer: '3' })];
  const S = snapper(ways), mid = [LNG0 + 1000 * perM, LAT, 150];
  expect(Math.abs(northOf(S.snap(path(0), 'rail').points[1]))).toBeLessThan(0.3);            // tanpa zona: rel permukaan
  const pts = S.snap(path(0), 'rail', [mid]).points;
  const far = pts.filter(([lng]) => Math.abs((lng - LNG0) / perM - 1000) > 600), near = pts.filter(([lng]) => Math.abs((lng - LNG0) / perM - 1000) < 60);
  for (const p of far) expect(Math.abs(northOf(p))).toBeLessThan(0.3);
  for (const p of near) expect(Math.abs(northOf(p) - 30)).toBeLessThan(0.5);
  for (let i = 1; i < pts.length; i++) {                                                     // tidak ada lompatan menyamping
    const dn = Math.abs(northOf(pts[i]) - northOf(pts[i - 1])), de = Math.abs(pts[i][0] - pts[i - 1][0]) / perM;
    expect(dn).toBeLessThanOrEqual(0.13 * de + 0.5);
  }
});
