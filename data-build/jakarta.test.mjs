// Memeriksa berkas hasil `bun run data` dengan pembaca milik halaman web sendiri.
import { test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { unpackNet, pointAt } from '../web/src/tokyo/net.js';
import { unpackBucket } from '../web/src/tokyo/tt.js';

const OUT = 'var/static/tokyo', built = existsSync(`${OUT}/network-v1.json`);
const json = f => JSON.parse(readFileSync(`${OUT}/${f}`, 'utf8'));

test.skipIf(!built)('jaringan terbaca dan berada di Jawa bagian barat', () => {
  const net = unpackNet(json('network-v1.json'));
  expect(net.lines.length).toBeGreaterThan(10);
  for (const line of net.lines) {
    expect(line.stations.length).toBeGreaterThan(1);
    expect(line.chain).toEqual([...line.chain].sort((a, b) => a - b));        // stasiun berurutan di sepanjang jalur
    expect(line.chain.at(-1)).toBeLessThanOrEqual(line.length);
    for (const si of line.stations) {
      const s = net.stations[si], [lng, lat] = pointAt(line, s.m);
      expect(lng).toBeGreaterThan(105.5); expect(lng).toBeLessThan(109);
      expect(lat).toBeGreaterThan(-7.6); expect(lat).toBeLessThan(-5.4);
      expect(Math.hypot((lng - s.lng) * 111e3, (lat - s.lat) * 111e3)).toBeLessThan(1500);   // titik di rel dekat koordinat stasiun
    }
  }
  for (const g of net.groups) expect(new Set(g.map(si => net.stations[si].name.en)).size).toBe(1);
});

test.skipIf(!built)('jadwal terbaca: waktu menaik dan kereta berjalan searah di jalurnya', () => {
  const net = unpackNet(json('network-v1.json')), ptr = json('tt-latest.json');
  let runs = 0;
  for (const cal of Object.keys(ptr.cals)) {
    const idx = json(`tt-v1/${cal}/index.json`);
    for (const b of idx.buckets) for (const run of unpackBucket(json(`tt-v1/${cal}/${b.file}`)).runs) {
      runs++;
      const times = run.stops.map(s => s.d ?? s.a), m = run.stops.map(s => net.stations[s.s].m);
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(run.stops.every(s => net.stations[s.s].line === run.line)).toBe(true);
      const sorted = [...m].sort((a, b) => a - b);
      expect(run.dir === 0 ? m : [...m].reverse()).toEqual(sorted);
    }
  }
  expect(runs).toBeGreaterThan(1000);
});
