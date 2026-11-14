// Uji pembangun ketinggian dengan jaringan dan rel OSM buatan (tanpa berkas).
import { expect, test } from 'bun:test';
import { buildElev, levelOf, metres, H_TUNNEL, H_VIADUCT, H_LAYER } from './elev.mjs';

// satu jalur lurus ke timur sepanjang ±4 km di lintang -6.2; 0.009° bujur ≈ 1 km
const LAT = -6.2, LNG0 = 106.8, perM = 1 / (111320 * Math.cos(-6.4 * Math.PI / 180));
const at = (m, dLat = 0) => ({ lon: LNG0 + m * perM, lat: LAT + dLat });
const line = (id) => ({ id, path: [[LNG0, LAT], [LNG0 + 4000 * perM, LAT]], length: 4000 });
const way = (railway, a, b, tags = {}, dLat = 0) => ({ tags: { railway, ...tags }, geometry: [at(a, dLat), at(b, dLat)] });
const near = (got, want, tol = 45) => { expect(Math.abs(got - want)).toBeLessThanOrEqual(tol); };

test('tingkat dan meter dari tag', () => {
  expect(levelOf({ tunnel: 'yes', layer: '-2' })).toBe(-1);
  expect(levelOf({ tunnel: 'building_passage' })).toBe(0);
  expect(levelOf({ bridge: 'yes' })).toBe(1);
  expect(levelOf({ bridge: 'viaduct', layer: '3' })).toBe(3);
  expect(levelOf({ layer: '2' })).toBe(2);          // rel stasiun layang tanpa bridge=yes
  expect(levelOf({})).toBe(0);
  expect(metres(-1)).toBe(H_TUNNEL);
  expect(metres(1)).toBe(H_VIADUCT);
  expect(metres(2)).toBe(H_VIADUCT);
  expect(metres(4)).toBe(H_VIADUCT + 2 * H_LAYER);
});

test('MRT: layang, celah peralihan, lalu terowongan; celah stasiun diisi', () => {
  const ways = [
    way('subway', 0, 900, { bridge: 'yes', layer: '3' }), way('subway', 900, 1000), way('subway', 1000, 2000, { bridge: 'yes', layer: '3' }),
    way('subway', 2000, 2400),                                   // peralihan tanpa tag (400 m > celah yang diisi)
    way('subway', 2400, 4000, { tunnel: 'yes', layer: '-2' }),
    way('rail', 0, 4000),                                        // rel KRL di tempat yang sama: bukan rel MRT
  ];
  const { lines, len } = buildElev({ lines: [line('mrt.MRT.0')] }, ways);
  const R = lines['mrt.MRT.0'];
  expect(R.length).toBe(2);
  near(R[0][0], 0); near(R[0][1], 2000); expect(R[0][2]).toBe(H_VIADUCT + H_LAYER);
  near(R[1][0], 2400); near(R[1][1], 4000); expect(R[1][2]).toBe(H_TUNNEL);
  expect(len['mrt.MRT.0']).toBe(4000);
});

test('KRL: jembatan sungai dan terowongan pendek tetap di permukaan, viaduk panjang naik', () => {
  const ways = [
    way('rail', 0, 500), way('rail', 500, 560, { bridge: 'yes', layer: '1' }), way('rail', 560, 1000),
    way('rail', 1000, 1040, { tunnel: 'yes', layer: '-1' }), way('rail', 1040, 2000),
    way('rail', 2000, 3000, { bridge: 'yes', layer: '2' }), way('rail', 3000, 4000),
    way('light_rail', 0, 4000, { bridge: 'yes', layer: '4' }),   // LRT di atasnya: bukan rel KRL
  ];
  const { lines, report } = buildElev({ lines: [line('krl.X.0')] }, ways);
  const R = lines['krl.X.0'];
  expect(R.length).toBe(1);
  near(R[0][0], 2000); near(R[0][1], 3000); expect(R[0][2]).toBe(H_VIADUCT);
  expect(report[0].dropped.length).toBe(2);
});

test('rel yang jauh, melintang, atau kereta cepat tidak dipakai; jalur tanpa rel OSM = permukaan', () => {
  const ways = [
    way('rail', 0, 4000, { bridge: 'yes' }, 0.001),                                   // ±110 m di utara
    { tags: { railway: 'rail', bridge: 'yes' }, geometry: [at(2000, -0.004), at(2000, 0.004)] },   // melintang
    way('rail', 0, 4000, { bridge: 'yes', highspeed: 'yes' }),
  ];
  const { lines, report } = buildElev({ lines: [line('kai.X.0')] }, ways);
  expect(lines['kai.X.0']).toEqual([]);
  expect(report[0].matched).toBe(0);
});

test('LRT: tingkat yang hanya sebentar mengikuti tetangganya', () => {
  const ways = [way('light_rail', 0, 1900, { bridge: 'yes', layer: '3' }), way('light_rail', 1900, 2000, { bridge: 'yes', layer: '4' }), way('light_rail', 2000, 4000, { bridge: 'yes', layer: '3' })];
  const { lines } = buildElev({ lines: [line('jbdb.X.0')] }, ways);
  expect(lines['jbdb.X.0']).toEqual([[0, 4000, H_VIADUCT + H_LAYER]]);
});

test('LRT: rel stasiun ujung tanpa tag ikut viaduk di sebelahnya; KRL tidak', () => {
  const ways = (k) => [way(k, 0, 150), way(k, 150, 4000, { bridge: 'yes', layer: '2' })];
  expect(buildElev({ lines: [line('lrtj.X.0')] }, ways('light_rail')).lines['lrtj.X.0']).toEqual([[0, 4000, H_VIADUCT]]);
  near(buildElev({ lines: [line('krl.X.0')] }, ways('rail')).lines['krl.X.0'][0][0], 150);
});
