# Gestur peta

Berlaku di 2D dan 3D. Kode: `web/src/map/trackpad.js` (dipasang di `web/src/map/tokyo-map.js`), uji: `web/src/map/trackpad.test.mjs`.

## Touchpad (Mac)

| Gestur | Hasil |
|---|---|
| Geser dua jari | Menggeser peta ke segala arah (bukan zoom) |
| Cubit | Zoom, berpusat di kursor |
| Putar dua jari (Safari) | Memutar arah peta |
| Option (⌥) + geser dua jari mendatar | Memutar arah peta. Padanan untuk Chrome dan Firefox, yang tidak mengirim event putar |
| Option (⌥) + geser dua jari tegak | Memiringkan (pitch): jari ke atas makin miring, ke bawah makin tegak, 0° sampai batas pitch peta (70°) |

Option dipilih sebagai satu-satunya tombol pengubah. Shift tidak dipakai, karena di macOS Shift + roda tetikus berarti gulir mendatar dan tidak bisa dibedakan dari geseran touchpad. Dalam satu event hanya sumbu yang lebih besar yang dipakai, jadi memutar tidak ikut memiringkan.

Kelembaman geseran datang dari macOS sendiri (event momentum), tidak ditambah di kode.

## Tetikus dan layar sentuh (tidak berubah)

- Roda tetikus: zoom. Seret kiri: geser. Seret kanan atau Ctrl + seret: putar dan miringkan.
- Layar sentuh: satu jari geser, dua jari cubit / putar / miringkan.

## Mode yang memegang kamera

- **Ikuti kereta**: geser dua jari melepas "ikuti", sama seperti menyeret peta. Cubit, putar, dan miringkan tidak melepasnya.
- **Ride** dan **Fly**: geser dan putar peta dimatikan oleh mode itu, jadi gestur touchpad juga tidak mengambilnya. Geser dua jari di sana bekerja seperti sebelumnya (jarak kamera di Ride, maju-mundur di Fly).

## Roda atau touchpad?

Browser tidak memberi tahu alatnya, jadi ditebak per event (`classify`):

- `deltaMode` baris/halaman, `wheelDeltaY` kelipatan 120, `deltaY` kelipatan satu takik macOS, atau event pertama yang langsung ≥ 50 piksel: roda.
- Ada `deltaX`: touchpad (kecuali Shift + roda).
- Event berikutnya dalam 250 ms mengikuti jenis event sebelumnya.

Bila tebakan meleset, roda tetikus akan menggeser peta alih-alih zoom (atau sebaliknya). Tetikus dengan roda "halus" (mis. Magic Mouse) dibaca sebagai touchpad, dan ini disengaja: perilakunya memang seperti touchpad.

## Gestur halaman

Di atas kanvas peta, zoom halaman saat cubit dan navigasi balik saat geser mendatar dicegah. Panel dan daftar di luar kanvas menggulir seperti biasa.

## Yang sudah dan belum diuji

Diuji di Chromium dengan `WheelEvent` sintetis dan event `gesturestart` / `gesturechange` tiruan, di 2D dan 3D: pusat, zoom, arah, dan pitch berubah sesuai tabel; titik di bawah kursor tetap di tempatnya saat cubit; roda tetikus tetap zoom.

Belum diuji: rasa gestur di touchpad fisik, Safari sungguhan, dan Firefox. Laju putar (0,4° per piksel) dan miring (0,25° per piksel) adalah tebakan awal yang perlu dirasakan di perangkat nyata.
