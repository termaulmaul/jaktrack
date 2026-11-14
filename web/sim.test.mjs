import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeShape, pointAt, distAt, prepare, busesAt, activeServices, jakartaClock, meters } from './sim.js';

// Rute lurus ke timur di khatulistiwa: 0 → 0.01° → 0.02° bujur, 3 halte, 100 detik per ruas
const pack = { trips: [{ sv: 'SH', p: [0, 0, 1000, 0, 1000, 0], st: [0, 100, 200], sd: [0, 1112, 2224], f: [[3600, 7200, 600]] }] };
const trips = prepare(pack);
const SH = new Set(['SH']);

test('decodeShape memulihkan koordinat dan panjang', () => {
  const s = decodeShape([0, 0, 1000, 0, 1000, 0]);
  assert.deepEqual([...s.xy], [0, 0, 0.01, 0, 0.02, 0]);
  assert.ok(Math.abs(s.cum[2] - 2224) < 2);
});

test('posisi diinterpolasi sepanjang rute', () => {
  assert.equal(distAt(trips[0], 50), 556);
  const [lng] = pointAt(trips[0].shape, trips[0].shape.cum[2] / 2);
  assert.ok(Math.abs(lng - 0.01) < 1e-6);
});

test('jumlah bus mengikuti headway dan jendela layanan', () => {
  assert.equal(busesAt(trips, 3599, SH).length, 0);          // sebelum mulai
  assert.equal(busesAt(trips, 3600, SH).length, 1);          // keberangkatan pertama
  assert.equal(busesAt(trips, 3600 + 201, SH).length, 0);    // perjalanan 200 dtk selesai
  assert.equal(busesAt(trips, 7200, SH).length, 0);          // end eksklusif
  assert.equal(busesAt(trips, 6600 + 100, SH).length, 1);    // keberangkatan terakhir (start + 5×600)
  assert.equal(busesAt(trips, 3700, new Set(['HK'])).length, 0);
});

test('headway lebih pendek dari durasi menghasilkan beberapa bus', () => {
  const t = prepare({ trips: [{ ...pack.trips[0], f: [[0, 3600, 60]] }] });
  assert.equal(busesAt(t, 1000, SH).length, 3);              // berangkat 840, 900, 960; yang 780 sudah selesai (220 dtk)
});

test('bus yang berangkat sebelum tengah malam masih terlihat', () => {
  const t = prepare({ trips: [{ ...pack.trips[0], f: [[86300, 86400, 600]] }] });
  assert.equal(busesAt(t, 50, new Set(), SH).length, 1);
  assert.equal(busesAt(t, 50, new Set(), new Set()).length, 0);
});

test('kalender dan jam Jakarta', () => {
  const cal = { HK: [1, 1, 1, 1, 1, 0, 0], HM: [0, 0, 0, 0, 0, 0, 1] };
  assert.deepEqual([...activeServices(cal, 6)], ['HM']);
  const c = jakartaClock(Date.UTC(2026, 10, 14, 17, 30));     // Sabtu 17.30 UTC = Minggu 00.30 WIB
  assert.deepEqual([c.sec, c.day, c.yesterday], [1800, 6, 5]);
  assert.ok(Math.abs(meters(0, 0, 0.01, 0) - 1112) < 1);
});
