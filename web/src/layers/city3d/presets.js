// 3D view: the camera presets and the 3D view's own copy (EN / JA / ID), shared by
// index.js (mountCity3d) and controls.js (mountCity3dControls). The page's i18n.js carries the same words (the 3D city block).

export const TILT = 60;
/** Camera presets: fly in, pitched 60, each looking at its station from where its towers and tracks read best. */
export const PRESETS = {
  shinjuku: { center: [106.84994, -6.21017], zoom: 16.2, pitch: TILT, bearing: -62, title: { en: 'Manggarai', ja: 'Manggarai', id: 'Manggarai' } },   // kunci lama dipertahankan: dipakai page.js saat masuk 3D
  shibuya: { center: [106.82345, -6.20241], zoom: 16.5, pitch: TILT, bearing: -38, title: { en: 'Sudirman', ja: 'Sudirman', id: 'Sudirman' } },
  tokyo: { center: [106.83065, -6.17665], zoom: 16.2, pitch: TILT, bearing: 22, title: { en: 'Gambir', ja: 'Gambir', id: 'Gambir' } },
  ikebukuro: { center: [106.81462, -6.13758], zoom: 16.3, pitch: TILT, bearing: 80, title: { en: 'Jakarta Kota', ja: 'Jakarta Kota', id: 'Jakarta Kota' } },
};
/** where the underground view flies (the chip row's presets while it is on; `otemachi` = the
 * opening view's one tap: Otemachi + Tokyo Station, where five subway levels and the JR tunnels cross). Zoomed so the
 * levels (drawn UG_EXAG x deeper) separate on a phone, tilted so the depth reads, turned to look along the crossings. */
export const UG_PITCH = 62, UG_ZOOM = 15.6, UG_NEAR_Z = 13.5;
export const UG_PRESETS = {
  otemachi: { center: [106.82306, -6.19185], zoom: 15.55, pitch: UG_PITCH, bearing: -28, title: { en: 'Bundaran HI', ja: 'Bundaran HI', id: 'Bundaran HI' } },
  jimbocho: { center: [106.82283, -6.2008], zoom: 15.6, pitch: UG_PITCH, bearing: -20, title: { en: 'Dukuh Atas', ja: 'Dukuh Atas', id: 'Dukuh Atas' } },
  shinjuku: { center: [106.82176, -6.20909], zoom: 15.6, pitch: UG_PITCH, bearing: -62, title: { en: 'Setiabudi', ja: 'Setiabudi', id: 'Setiabudi' } },
  shibuya: { center: [106.818, -6.21506], zoom: 15.9, pitch: UG_PITCH, bearing: -38, title: { en: 'Bendungan Hilir', ja: 'Bendungan Hilir', id: 'Bendungan Hilir' } },
  ueno: { center: [106.80866, -6.22244], zoom: 15.8, pitch: UG_PITCH, bearing: 20, title: { en: 'Istora', ja: 'Istora', id: 'Istora' } },
  ikebukuro: { center: [106.80252, -6.22678], zoom: 15.8, pitch: UG_PITCH, bearing: 80, title: { en: 'Senayan', ja: 'Senayan', id: 'Senayan' } },
};
/** Copy for page.js's controls (EN / JA / ID). */
export const TEXT = {
  en: { city: '3D city', underground: 'Underground', undergroundOn: 'Showing the underground', presets: 'Fly to', scheduled: 'Scheduled', weak: 'This device cannot draw the 3D city', zoomIn: 'Zoom in to see the underground', trueScale: 'True scale', ride: 'Ride a train', stopRide: 'Stop riding', rideNone: 'No subway train in view', behind: 'Behind', cab: 'Cab',
    // the free camera chip, its key card ([X] = a key) and the phone's buttons
    fly: 'Fly', flyMove: 'Move: [W] [A] [S] [D] or the arrows', flyUpDown: 'Up / down: [E] / [Q] (or [Space] / [C])', flyLook: 'Look: drag, or [J] [L] [I] [K]',
    flyFast: 'Faster: [Shift] · stop: [Esc]', flyTouch: 'Pad: move · drag: look · pinch: forward / back', flyUp: 'Fly up', flyDown: 'Fly down', flyHide: 'Hide the keys' },
  ja: { city: '3D都市', underground: '地下', undergroundOn: '地下を表示中', presets: '移動', scheduled: '時刻表どおり', weak: 'この端末では3D都市を表示できません', zoomIn: '地下を見るには拡大してください', trueScale: '実寸', ride: '電車に乗る', stopRide: '乗るのをやめる', rideNone: '近くに地下鉄の電車がありません', behind: '後ろから', cab: '運転席',
    fly: '自由視点', flyMove: '移動: [W] [A] [S] [D] または矢印キー', flyUpDown: '上 / 下: [E] / [Q] (または [Space] / [C])', flyLook: '見回す: ドラッグ、または [J] [L] [I] [K]',
    flyFast: '速く: [Shift] · 終了: [Esc]', flyTouch: 'パッド: 移動 · ドラッグ: 見回す · ピンチ: 前後', flyUp: '上へ', flyDown: '下へ', flyHide: 'キーの説明を閉じる' },
  id: { city: 'Kota 3D', underground: 'Bawah tanah', undergroundOn: 'Menampilkan bawah tanah', presets: 'Terbang ke', scheduled: 'Menurut jadwal', weak: 'Perangkat ini belum bisa menampilkan kota 3D', zoomIn: 'Perbesar peta untuk melihat bawah tanah', trueScale: 'Skala asli', ride: 'Ikut kereta', stopRide: 'Berhenti ikut', rideNone: 'Tidak ada kereta bawah tanah di sini', behind: 'Dari belakang', cab: 'Kabin',
    fly: 'Terbang bebas', flyMove: 'Gerak: [W] [A] [S] [D] atau panah', flyUpDown: 'Naik / turun: [E] / [Q] (atau [Space] / [C])', flyLook: 'Lihat: seret, atau [J] [L] [I] [K]',
    flyFast: 'Lebih cepat: [Shift] · berhenti: [Esc]', flyTouch: 'Pad: gerak · seret: lihat · cubit: maju / mundur', flyUp: 'Naik', flyDown: 'Turun', flyHide: 'Sembunyikan tombol' },
};
