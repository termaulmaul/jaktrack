// Pure logic behind the navigation fixes: counted strings, the route planner's hash, same-name stations in search.
import { test, expect } from 'bun:test';
import * as I from './i18n.js';
import { routeHash, parseRouteHash } from './route-hash.js';
import { sameNameLabels } from './search.js';

test('a count of one reads the singular in EN, and the same word in ID', () => {
  I.setLang('en');
  expect(I.tn('n.trains', 1)).toBe('1 train');
  expect(I.tn('n.trains', 2)).toBe('2 trains');
  expect(I.tn('n.trains', 0)).toBe('0 trains');
  expect(I.tn('n.lines', 1)).toBe('1 line');
  expect(I.t('board.trains.word', { n: 1 })).toBe('train');
  expect(I.t('board.trains.word', { n: 4 })).toBe('trains');
  expect(I.t('bus.word', { n: 1 })).toBe('bus');
  expect(I.t('bus.word', { n: 12 })).toBe('buses');
  expect(I.t('tv.cars', { n: '1' })).toBe('1 car');           // n arrives formatted from some callers
  expect(I.t('rt.stops', { n: 1 })).toBe('1 stop');
  expect(I.t('rt.stops', { n: 11 })).toBe('11 stops');
  expect(I.t('lines.all', { n: 1 })).toBe('The 1 line');
  I.setLang('id');
  expect(I.tn('n.trains', 1)).toBe('1 kereta');
  expect(I.t('board.trains.word', { n: 1 })).toBe('kereta');
  expect(I.t('bus.word', { n: 1 })).toBe('bus');
  expect(I.t('rt.stops', { n: 1 })).toBe('1 stasiun');
});

test('no counted EN string is left without a singular', () => {
  const D = I._dict.en;
  const bad = Object.entries(D).filter(([k, v]) => typeof v === 'string' && !k.endsWith('.one') && /\{n\}\s+[a-z]+s\b/i.test(v) && !(`${k}.one` in D) && k !== 'tv.journey');   // tv.journey is only shown for 2+
  expect(bad.map(([k]) => k)).toEqual([]);
});

test('the route planner text names no Tokyo train', () => {
  for (const l of ['en', 'id']) for (const [k, v] of Object.entries(I._dict[l])) {
    if (k.startsWith('rt.')) expect(`${k}: ${v}`).not.toMatch(/Skyliner|N.EX|Romancecar|Limited Express|liner/i);
  }
});

test('the route hash round-trips and ignores what it cannot read', () => {
  expect(routeHash({ from: 'krl.MRI', to: 'mrt.BHI', mode: 'dep', time: '08:10' })).toBe('from:krl.MRI;to:mrt.BHI;dep:0810');
  expect(parseRouteHash('from:krl.MRI;to:mrt.BHI;dep:0810')).toEqual({ from: 'krl.MRI', to: 'mrt.BHI', mode: 'dep', time: '08:10' });
  expect(routeHash({ from: 'a', to: 'b', mode: 'now', time: '' })).toBe('from:a;to:b');
  expect(routeHash({ from: 'a', to: null, mode: 'arr', time: '23:59' })).toBe('from:a;arr:2359');
  expect(routeHash({})).toBe('');
  expect(routeHash({ from: 'a;b', to: 'c d' })).toBe('');                 // an id that would break the format is left out
  expect(parseRouteHash('from:krl.MRI')).toEqual({ from: 'krl.MRI' });    // the station sheet's one-ended link
  expect(parseRouteHash('to:x:y')).toEqual({ to: 'x:y' });
  for (const junk of [undefined, null, 1, '', '1', ';;;', 'dep:9999', 'arr:ab:cd', 'from:', ':x', 'x'.repeat(500), 'dep:2460', 'zzz:1;from']) {
    expect(parseRouteHash(junk)).toEqual({});
  }
  expect(parseRouteHash('from:a;from:b;dep:0700;arr:0800')).toEqual({ from: 'a', mode: 'dep', time: '07:00' });
  expect(parseRouteHash('dep:2500;to:b')).toEqual({ to: 'b' });
});

test('stations that share a name get their operators as a label; the others get none', () => {
  const op = (i) => ['KAI Commuter', 'KAI Commuter', 'LRT Jakarta', ''][i];
  const rows = [{ name: 'Manggarai', lines: [0, 1] }, { name: 'Manggarai', lines: [2] }, { name: 'Mangga Besar', lines: [0] }, { name: 'manggarai ', lines: [3] }];
  expect(sameNameLabels(rows, op)).toEqual(['KAI Commuter', 'LRT Jakarta', '', '']);
  expect(sameNameLabels([], op)).toEqual([]);
  expect(sameNameLabels(null, op)).toEqual([]);
});
