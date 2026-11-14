// Simulator bus (port uji purwarupa e2ae3e6: web/sim.test.mjs) dan berkas hasil `bun data-build/bus.mjs`.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { busesAt, activeServices, jakartaClock, serviceWindows, simTrips, busesNow } from '../web/src/tokyo/buses/sim.js';
import { unpackBus } from '../web/src/tokyo/buses/pack.js';
import { ShapeIndex } from '../web/src/tokyo/buses/shapes.js';
import { toX, toY } from '../web/src/tokyo/buses/util.js';

// Satu pola: perjalanan 200 detik, berangkat tiap 600 detik dari 01.00 sampai sebelum 02.00
const trip = (f) => ({ sv: 'SH', dur: 200, f });
const trips = [trip([[3600, 7200, 600]])];
const SH = new Set(['SH']);

test('jumlah bus mengikuti headway dan jendela layanan', () => {
  expect(busesAt(trips, 3599, SH).length).toBe(0);          // sebelum mulai
  expect(busesAt(trips, 3600, SH).length).toBe(1);          // keberangkatan pertama
  expect(busesAt(trips, 3600 + 201, SH).length).toBe(0);    // perjalanan 200 dtk selesai
  expect(busesAt(trips, 7200, SH).length).toBe(0);          // end eksklusif
  expect(busesAt(trips, 6600 + 100, SH)).toEqual([{ trip: trips[0], el: 100 }]);   // keberangkatan terakhir (start + 5×600)
  expect(busesAt(trips, 3700, new Set(['HK'])).length).toBe(0);
});

test('headway lebih pendek dari durasi menghasilkan beberapa bus', () => {
  expect(busesAt([trip([[0, 3600, 60]])], 1000, SH).length).toBe(3);   // berangkat 840, 900, 960; yang 780 sudah selesai (220 dtk)
});

test('bus yang berangkat sebelum tengah malam masih terlihat', () => {
  const t = [trip([[86300, 86400, 600]])];
  expect(busesAt(t, 50, new Set(), SH).length).toBe(1);
  expect(busesAt(t, 50, new Set(), new Set()).length).toBe(0);
});

test('kalender dan jam Jakarta', () => {
  const cal = { HK: [1, 1, 1, 1, 1, 0, 0], HM: [0, 0, 0, 0, 0, 0, 1] };
  expect([...activeServices(cal, 6)]).toEqual(['HM']);
  const c = jakartaClock(Date.UTC(2026, 10, 14, 17, 30));     // Sabtu 17.30 UTC = Minggu 00.30 WIB
  expect([c.sec, c.day, c.yesterday]).toEqual([1800, 6, 5]);
});

test('hari layanan berganti 03.00: keberangkatan dini hari milik hari sebelumnya', () => {
  expect(serviceWindows([[18000, 79200, 600]])).toEqual([[18000, 79200, 600]]);                    // 05.00-22.00 tidak berubah
  expect(serviceWindows([[0, 86399, 700]])).toEqual([[86400, 97200, 700], [11200, 86399, 700]]);   // 00.00-23.59: dini hari +24 jam, sisanya mulai 03.06.40
  expect(serviceWindows([[3600, 7200, 600]])).toEqual([[90000, 93600, 600]]);                      // seluruhnya sebelum 03.00
  // pola Sabtu-saja 00.00-23.59, perjalanan 10 menit, tiap 10 menit: Minggu 01.00 masih jalan (hari layanan Sabtu), Sabtu 01.00 belum
  const cal = { SAB: [0, 0, 0, 0, 0, 1, 0] }, t = [{ sv: 'SAB', dur: 600, f: serviceWindows([[0, 86399, 600]]) }];
  const wib = (d, h) => Date.UTC(2026, 10, d, h - 7);         // 14 Nov 2026 = Sabtu
  expect(busesNow(t, cal, wib(15, 1)).length).toBe(2);        // berangkat 00.50 dan 01.00
  expect(busesNow(t, cal, wib(14, 1)).length).toBe(0);
  expect(busesNow(t, cal, wib(14, 4)).length).toBe(2);
  expect(busesNow(t, cal, wib(15, 4)).length).toBe(0);
});

const FILE = 'var/static/tokyo/bus-v1.json', built = existsSync(FILE);
test.skipIf(!built)('berkas bus terbaca pack.js, terdaftar di packs.json, dan rutenya berada di Jabodetabek', () => {
  const raw = JSON.parse(readFileSync(FILE, 'utf8')), pack = unpackBus(raw);
  expect(JSON.parse(readFileSync('var/static/tokyo/packs.json', 'utf8')).files).toEqual(expect.arrayContaining(['network-v1.json', 'bus-latest.json', 'bus-v1.json']));
  expect(pack.feed.name).toBe('GTFS PT Transportasi Jakarta');
  expect(pack.routes.length).toBeGreaterThan(100);
  expect(pack.pats.length).toBe(pack.sim.trips.length);
  const ix = new ShapeIndex();
  ix.build(pack.shapeList());
  let far = 0, stops = 0;
  pack.sim.trips.forEach(([id, r, sv, st, f], i) => {
    const pat = pack.pats[i], shape = ix.shapes[pat.shape];
    expect(pack.tripShape(id)).toBe(pat.shape);
    expect(pack.routes[r]).toBeDefined();
    expect(pack.sim.calendar[sv] === undefined || pack.sim.calendar[sv].length === 7).toBe(true);
    expect(st.length).toBe(pat.stops.length);
    expect(st[0]).toBe(0);
    expect(st).toEqual([...st].sort((a, b) => a - b));                    // waktu tiba menaik
    expect(pat.along).toEqual([...pat.along].sort((a, b) => a - b));      // halte tidak pernah mundur di sepanjang rute
    expect(pat.along.at(-1)).toBeLessThanOrEqual(Math.ceil(shape.len));
    for (const [start, end, headway] of f) { expect(headway).toBeGreaterThan(0); expect(end).toBeGreaterThan(start); }
    const flat = pack.flat(pat.shape);
    expect(flat[0]).toBeGreaterThan(106.3); expect(flat[0]).toBeLessThan(107.3);
    expect(flat[1]).toBeGreaterThan(-6.8); expect(flat[1]).toBeLessThan(-5.9);
    const p = {};
    pat.stops.forEach((k, j) => {                                         // titik di rute dekat koordinat halte
      const s = pack.stops[k]; ix.pointAt(pat.shape, pat.along[j], p); stops++;
      if (Math.hypot(p.x - toX(s.lng), p.y - toY(s.lat)) > 150) far++;
    });
  });
  expect(far / stops).toBeLessThan(0.001);
});

test.skipIf(!built)('simulasi dari berkas bus: ada bus di jam sibuk, id unik', () => {
  const pack = unpackBus(JSON.parse(readFileSync(FILE, 'utf8'))), sim = simTrips(pack);
  const at = Date.UTC(2026, 10, 13, 1), list = busesNow(sim, pack.sim.calendar, at);   // Jumat 08.00 WIB
  expect(list.length).toBeGreaterThan(1000);
  expect(new Set(list.map(({ trip, el }) => `${trip.id}.${Math.round(at / 1000 - el)}`)).size).toBe(list.length);
  for (const { trip, el } of list) { expect(el).toBeGreaterThanOrEqual(0); expect(el).toBeLessThanOrEqual(trip.dur); }
});
