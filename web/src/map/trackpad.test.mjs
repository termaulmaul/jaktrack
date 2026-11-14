import { test, expect } from 'bun:test';
import { classify, wheelAction, gestureAction } from './trackpad.js';

const w = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ...o });

test('roda tetikus vs touchpad', () => {
  expect(classify(w({ deltaY: 3, deltaMode: 1 }))).toBe('wheel');                      // Firefox: mode baris
  expect(classify(w({ deltaY: 4.000244140625, wheelDeltaY: -120 }))).toBe('wheel');    // satu takik (macOS)
  expect(classify(w({ deltaY: 100, wheelDeltaY: -120 }))).toBe('wheel');               // satu takik (Windows / Linux)
  expect(classify(w({ deltaY: -53 }))).toBe('wheel');                                  // langsung besar, tanpa wheelDelta
  expect(classify(w({ deltaX: 40, shiftKey: true }))).toBe('wheel');                 // Shift + roda
  expect(classify(w({ deltaY: 2, wheelDeltaY: -6 }))).toBe('trackpad');
  expect(classify(w({ deltaX: -3, deltaY: 1 }))).toBe('trackpad');
  // di tengah satu gestur touchpad, delta 40 (wheelDelta 120) tidak berubah jadi roda; setelah jeda, dinilai ulang
  expect(classify(w({ deltaY: 40, wheelDeltaY: -120 }), { kind: 'trackpad', t: 1000 }, 1016)).toBe('trackpad');
  expect(classify(w({ deltaY: 40, wheelDeltaY: -120 }), { kind: 'trackpad', t: 1000 }, 2000)).toBe('wheel');
});

test('touchpad: pan, cubit, pengubah', () => {
  expect(wheelAction(w({ deltaX: 5, deltaY: -7 }), 'trackpad')).toEqual({ pan: [5, -7] });
  expect(wheelAction(w({ deltaY: -7, ctrlKey: true }), 'trackpad')).toBeNull();          // cubit -> scrollZoom MapLibre
  expect(wheelAction(w({ deltaY: 100 }), 'wheel')).toBeNull();                           // roda -> scrollZoom MapLibre
  expect(wheelAction(w({ deltaX: -10, deltaY: 2, altKey: true }), 'trackpad')).toEqual({ bearing: 4 });
  expect(wheelAction(w({ deltaX: 1, deltaY: 20, altKey: true }), 'trackpad')).toEqual({ pitch: 5 });
});

test('handler peta yang dimatikan (ride / Fly) tidak diambil alih', () => {
  expect(wheelAction(w({ deltaY: 9 }), 'trackpad', { pan: false, rotate: false })).toBeNull();
  expect(wheelAction(w({ deltaY: 9, altKey: true }), 'trackpad', { pan: true, rotate: false })).toBeNull();
});

test('Safari gesturechange: skala -> zoom, rotasi -> bearing (zona mati 4 derajat)', () => {
  expect(gestureAction(2, 0)).toEqual({ zoom: 1, bearing: -0 });
  expect(gestureAction(1, 3).bearing).toBe(-0);
  expect(gestureAction(1, 14).bearing).toBe(-10);
  expect(gestureAction(0.5, -14, false)).toEqual({ zoom: -1, bearing: -0 });
});
