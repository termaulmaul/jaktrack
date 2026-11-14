// Uji jumlah rel sejajar (snap.mjs tracks) dan pemisahan arah (web/src/tokyo/rails.js) dengan data buatan.
import { expect, test } from 'bun:test';
import { snapper } from './snap.mjs';
import { railsOf } from '../web/src/tokyo/rails.js';

const LAT = -6.2, LNG0 = 106.8, perM = 1 / (111320 * Math.cos(-6.4 * Math.PI / 180)), latM = 1 / 110574;
const at = (m, north = 0) => ({ lon: LNG0 + m * perM, lat: LAT + north * latM });
// way dari a ke b (b < a = digambar ke barat); north = meter di utara lintasan (lintasan menuju timur: utara = kiri)
const way = (a, b, north, tags = {}) => ({ tags: { railway: 'rail', ...tags }, geometry: [at(a, north), at(b, north)] });
const path = [[LNG0, LAT], [LNG0 + 4000 * perM, LAT]];
const fwd = { 'railway:preferred_direction': 'forward' };
const kmOf = (ranges, n) => ranges.filter((r) => r[2] === n).reduce((s, r) => s + r[1] - r[0], 0);

test('jumlah rel: ganda, tunggal, dwiganda; rel langsir dan rel jenis lain tidak dihitung', () => {
  const ways = [
    way(0, 2000, 2), way(0, 2000, -2),                               // 0-2 km: ganda, 4 m antar-rel
    way(2000, 3000, 0),                                               // 2-3 km: tunggal
    way(3000, 4000, 6), way(3000, 4000, 2), way(3000, 4000, -2), way(3000, 4000, -6),   // 3-4 km: dwiganda
    way(0, 4000, 9, { service: 'yard' }), way(0, 4000, -9, { service: 'crossover' }),
    { tags: { railway: 'light_rail' }, geometry: [at(0, 5), at(4000, 5)] },
  ];
  const { ranges, unknown } = snapper(ways).tracks(path, 'rail');
  expect(unknown).toBe(0);
  expect(Math.abs(kmOf(ranges, 2) - 2000)).toBeLessThan(150);
  expect(Math.abs(kmOf(ranges, 1) - 1000)).toBeLessThan(250);
  expect(Math.abs(kmOf(ranges, 4) - 1000)).toBeLessThan(150);
  const mid = (m) => ranges.find((r) => m >= r[0] && m < r[1]);
  expect(mid(1000).slice(2)).toEqual([2, 2]);                         // setengah jarak antar-rel 2 m
  expect(mid(2500).slice(2)).toEqual([1, 0]);
  expect(mid(3500).slice(2)).toEqual([4, 2]);                         // sepasang rel terdekat di kiri dan kanan lintasan
});

test('lintasan tanpa rel OSM: jumlah rel tidak diketahui (0)', () => {
  const { ranges, unknown } = snapper([way(0, 4000, 200)]).tracks(path, 'rail');
  expect(ranges).toEqual([[0, 4000, 0, 0]]);
  expect(unknown).toBe(4000);
});

test('sisi jalan dari arah way: kanan dan kiri', () => {
  // jalan kanan: rel selatan (kanan arah timur) berjalan ke timur, rel utara ke barat
  const right = snapper([way(0, 4000, -2, fwd), way(4000, 0, 2, fwd)]).tracks(path, 'rail').hand;
  expect(right.right).toBeGreaterThan(100); expect(right.left).toBe(0);
  const left = snapper([way(0, 4000, 2, fwd), way(4000, 0, -2, fwd)]).tracks(path, 'rail').hand;
  expect(left.left).toBeGreaterThan(100); expect(left.right).toBe(0);
  const none = snapper([way(0, 4000, 2), way(0, 4000, -2)]).tracks(path, 'rail').hand;
  expect(none).toEqual({ right: 0, left: 0 });
});

test('pemisahan arah: di ruas ganda dua kereta berlawanan arah di rel berbeda, di ruas tunggal di rel yang sama', () => {
  const net = { lines: [{ id: 'krl.X.0' }, { id: 'krl.Y.1' }] };
  const pack = { tracks: { 'krl.X.0': [[0, 2000, 2, 2], [2000, 3000, 1, 0], [3000, 4000, 2, 2.5]] }, hand: { 'krl.X.0': 1 } };
  const R = railsOf(net, pack);
  // letak kereta terhadap arah naik meteran jalur (m, + = kiri): kereta searah (+1) dan berlawanan (-1)
  const chainLeft = (li, m, sign) => sign * R.offset(li, m) || 0;
  expect(chainLeft(0, 1000, 1)).toBe(-2);                             // jalan kanan: 2 m di kanan
  expect(chainLeft(0, 1000, -1)).toBe(2);
  expect(chainLeft(0, 1000, 1) - chainLeft(0, 1000, -1)).toBe(-4);    // terpisah sejauh jarak antar-rel
  expect(chainLeft(0, 2500, 1)).toBe(0);                              // rel tunggal: keduanya di garis jalur
  expect(chainLeft(0, 2500, -1)).toBe(0);
  expect(chainLeft(0, 3500, -1)).toBe(2.5);
  const edge = chainLeft(0, 2000, -1);                                // peralihan ganda -> tunggal landai, bukan lompatan
  expect(edge).toBeGreaterThan(0); expect(edge).toBeLessThan(2);
  expect(R.has(0)).toBe(true); expect(R.hand(0)).toBe(1);
  // jalan kiri, dan jalur tanpa data
  expect(railsOf(net, { tracks: pack.tracks, hand: { 'krl.X.0': -1 } }).offset(0, 1000)).toBe(2);
  expect(R.has(1)).toBe(false); expect(R.offset(1, 1000)).toBe(0);
  expect(railsOf(net, null).offset(0, 1000)).toBe(0);
});

test('dua kereta berpapasan di jalur ganda tidak pernah saling menutupi', async () => {
  const { MIN_HALF_M } = await import('../web/src/tokyo/rails.js');
  const { CAR_W } = await import('../web/src/layers/city3d/vehicles.js');
  // jarak sumbu dua rel = 2 * half * wide(kw); lebar badan = CAR_W * kw; wide(kw) >= kw
  const wide = (kw) => Math.ceil(Math.max(1, kw) * 4) / 4;
  for (const kw of [1, 1.1, 1.3, 2, 3.7, 6]) expect(2 * MIN_HALF_M * wide(kw) - CAR_W * kw).toBeGreaterThan(0.9);
});

test('rel terlihat: pelebaran jarak rel tidak pernah lebih sempit dari badan kereta, pada zoom mana pun', async () => {
  const { kwAtZoom, wideOf, CAR_W } = await import('../web/src/layers/city3d/vehicles.js');
  const { MIN_HALF_M } = await import('../web/src/tokyo/rails.js');
  for (let z = 14; z <= 22; z += 0.05) {
    const kw = kwAtZoom(z);
    expect(2 * MIN_HALF_M * wideOf(kw)).toBeGreaterThan(CAR_W * kw);   // jarak sumbu dua rel > lebar satu badan
  }
  expect(kwAtZoom(19)).toBe(1);
  expect(kwAtZoom(14)).toBe(8);
});
