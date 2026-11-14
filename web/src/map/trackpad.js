// Gestur touchpad (Mac) di atas kanvas peta, seperti layar sentuh / Apple Maps (lihat docs/GESTUR.md):
//   geser dua jari = pan · cubit = zoom di kursor · Option + geser dua jari = putar (mendatar) / miring (tegak)
//   Safari: gesturechange membawa scale + rotation (cubit dan putar dua jari sungguhan).
// Roda tetikus dan cubit-sebagai-wheel (ctrlKey) dibiarkan ke scrollZoom MapLibre. Bila dragPan / dragRotate sedang
// dimatikan (ride, Fly), gestur itu juga tidak kami ambil: mode tersebut tetap memegang kamera seperti sebelumnya.

const STICKY_MS = 250;        // satu gestur = satu jenis alat, walau satu event di tengahnya tampak seperti alat lain
const NOTCH = 4.000244140625; // satu takik roda tetikus di macOS (Chrome / Safari): angka yang sama dipakai MapLibre
const ROT_PER_PX = 0.4, PITCH_PER_PX = 0.25, ROT_DEAD = 4;   // derajat per piksel geser; derajat putar yang diabaikan saat mencubit

/** 'wheel' (roda tetikus) atau 'trackpad', dari satu WheelEvent dan event sebelumnya { kind, t } (heuristik). */
export function classify(e, prev, now = 0) {
  if (e.deltaMode) return 'wheel';                                  // baris / halaman: hanya roda (Firefox)
  if (e.deltaX && !(e.shiftKey && !e.deltaY)) return 'trackpad';    // Shift + roda = gulir mendatar, tetap roda
  if (prev && now - prev.t < STICKY_MS) return prev.kind;
  const wd = e.wheelDeltaY;
  if (wd && wd % 120 === 0) return 'wheel';
  // gestur touchpad selalu mulai dengan delta kecil: event pertama yang sudah besar adalah takik roda
  if (e.deltaY % NOTCH === 0 || Math.abs(e.deltaY) >= 50 || e.shiftKey) return 'wheel';
  return 'trackpad';
}

/**
 * WheelEvent -> aksi kamera. null = bukan urusan kami (MapLibre yang menangani: roda, cubit, atau handler-nya mati).
 * can = { pan, rotate }: apakah dragPan / dragRotate peta sedang aktif.
 */
export function wheelAction(e, kind, can = { pan: true, rotate: true }) {
  if (kind !== 'trackpad' || e.ctrlKey || e.metaKey) return null;   // ctrlKey = cubit (Chrome / Firefox) -> scrollZoom
  if (e.altKey) {
    if (!can.rotate) return null;
    return Math.abs(e.deltaX) > Math.abs(e.deltaY) ? { bearing: -e.deltaX * ROT_PER_PX } : { pitch: e.deltaY * PITCH_PER_PX };
  }
  return can.pan ? { pan: [e.deltaX, e.deltaY] } : null;
}

/** Safari gesturechange -> { zoom, bearing } relatif terhadap awal gestur (rotation: searah jarum jam positif). */
export function gestureAction(scale, rotation, canRotate = true) {
  const r = Math.abs(rotation) > ROT_DEAD && canRotate ? rotation - Math.sign(rotation) * ROT_DEAD : 0;
  return { zoom: Math.log2(Math.max(scale, 0.01)), bearing: -r };
}

/** Pasang pada peta MapLibre; mengembalikan fungsi pelepas. */
export function mountTrackpad(map) {
  const el = map.getCanvasContainer();
  const on = (h) => !!map[h]?.isEnabled?.();
  let prev = null, g = null;

  const onWheel = (e) => {
    const now = performance.now(), kind = classify(e, prev, now), fresh = !prev || now - prev.t >= STICKY_MS;
    prev = { kind, t: now };
    const a = wheelAction(e, kind, { pan: on('dragPan'), rotate: on('dragRotate') });
    if (!a) return;
    e.preventDefault(); e.stopPropagation();   // bukan zoom MapLibre, bukan gulir / navigasi-balik halaman
    const ev = { originalEvent: e };
    if (a.pan) {
      if (fresh) map.fire('dragstart', ev);    // seperti seret: "ikuti kereta" lepas (train-view.js)
      map.panBy(a.pan, { animate: false }, ev);
    } else if (a.bearing) map.jumpTo({ bearing: map.getBearing() + a.bearing }, ev);
    else if (a.pitch) map.jumpTo({ pitch: Math.max(0, Math.min(map.getMaxPitch(), map.getPitch() + a.pitch)) }, ev);
  };

  const onGesture = (e) => {
    e.preventDefault();                        // tanpa ini Safari memperbesar halaman
    if (!on('scrollZoom')) return;             // Fly: kamera milik freecam.js
    if (e.type === 'gesturestart' || !g) {
      const r = el.getBoundingClientRect();
      g = { zoom: map.getZoom(), bearing: map.getBearing(), around: map.unproject([e.clientX - r.left, e.clientY - r.top]) };
    }
    if (e.type === 'gestureend') { g = null; return; }
    const a = gestureAction(e.scale, e.rotation, on('dragRotate'));
    // easeTo berdurasi 0: jumpTo mengabaikan `around`
    map.easeTo({ zoom: g.zoom + a.zoom, bearing: g.bearing + a.bearing, around: g.around, duration: 0 }, { originalEvent: e });
  };

  // capture: sebelum listener wheel MapLibre di elemen yang sama
  el.addEventListener('wheel', onWheel, { capture: true, passive: false });
  // gesture*: hanya Safari desktop (di iOS jari sudah ditangani touchZoomRotate MapLibre)
  const G = typeof navigator !== 'undefined' && !navigator.maxTouchPoints ? ['gesturestart', 'gesturechange', 'gestureend'] : [];
  for (const k of G) el.addEventListener(k, onGesture, { passive: false });
  return () => {
    el.removeEventListener('wheel', onWheel, { capture: true });
    for (const k of G) el.removeEventListener(k, onGesture);
  };
}
