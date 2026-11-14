# Uji end-to-end manual

Uji lewat browser (Chromium, dikendalikan Playwright MCP dari luar repo) terhadap server dev `PORT=4793 bun web/dev-server.mjs`, 15 November 2026, dengan data hasil `bun run data` termasuk `elev-v1.json` (OSM per 14 November 2026). Jam nyata saat uji 00.50 WIB (hampir tidak ada kereta), jadi sebagian besar butir memakai pemutaran waktu ke 08.10 (jadwal akhir pekan).

Bukti: tangkapan layar di `var/shots/` (tidak di-commit) dan nilai yang dibaca dari halaman lewat `window.__tokyo`. Galat konsol dicatat dengan pendengar `console` dan `pageerror` di tiap langkah.

**Hasil: 31 butir, 29 lulus pada percobaan pertama, 2 gagal lalu diperbaiki dan lulus saat diulang. Tidak ada butir yang masih gagal.**

## Daftar periksa

Desktop 1440×900, bahasa Indonesia, kecuali disebut lain.

| # | Butir | Hasil | Bukti |
|---|---|---|---|
| 1 | Beranda memuat tanpa galat konsol (penyimpanan lokal kosong) | Lulus | `e2e-01-beranda.png`; `stats().errors = []`, 0 pesan error/warning |
| 2 | Daftar operator memuat TransJakarta | Lulus | Cip: Semua, KAI Commuter, KAI, TransJakarta 863 (00.50); pada 08.10 juga MRT Jakarta, LRT Jabodebek, LRT Jakarta |
| 3 | Bus menyala bawaan | Lulus | `buses.on = true`, 863 bus tergambar |
| 4 | Pemutaran waktu: kereta ikut | Lulus | `e2e-02-pemutaran-0810.png`; 10 kereta (00.50) → 102 kereta (08.10) |
| 5 | Pemutaran waktu: bus ikut | Lulus | 863 bus → 5.651 bus; saat diputar 60× selama 4 detik, 08.10 → 08.14 dan 5.651 → 5.728 bus |
| 6 | Tab Jalur | Lulus | `e2e-03-tab-jalur.png`; enam kelompok operator, 16 jalur kereta, 241 rute bus |
| 7 | Saringan operator | Lulus | `e2e-04-saring-operator-mrt.png`; cip MRT Jakarta → hanya judul "MRT Jakarta" |
| 8 | Saringan jenis bus | Lulus | `e2e-05-saring-jenis-bus.png`; cip Mikrotrans → 98 rute (JAK.01…), lapisan bus ikut (`kind = Mikrotrans`) |
| 9 | Pencarian stasiun | Lulus setelah perbaikan | `e2e-06-cari-stasiun.png`; "Blok M" → "Stasiun Blok M. MRT Lin Utara-Selatan". Gagal pertama: lihat G1 |
| 10 | Pencarian rute bus | Lulus | `e2e-07-cari-rute-bus.png`; "6V" → "6V, Ragunan - Senayan Bank Jakarta, BRT" |
| 11 | Pencarian halte | Lulus | `e2e-08-cari-halte.png`; "Bundaran Senayan" → enam halte bus |
| 12 | Papan stasiun | Lulus setelah perbaikan | `e2e-09-papan-stasiun.png`; Blok M: 3 keberangkatan per arah, kereta terakhir 23.40 / 23.47. Gagal pertama: lihat G2 |
| 13 | Detail kereta | Lulus | `e2e-10-detail-kereta.png`; M-L0800-LBB ke Bundaran HI, 6 gerbong, daftar halte dengan jam |
| 14 | Ikuti kereta | Lulus | `e2e-11-ikuti-pemutaran.png`; tombol "Berhenti mengikuti" aktif, pusat peta pindah dari −6,2558 ke −6,2428 mengikuti kereta |
| 15 | 3D: viaduk LRT Jabodebek | Lulus | `e2e-19-3d-lrt-jabodebek-viaduk.png`; dek dan tiang di Pancoran, kereta di atas dek |
| 16 | 3D: viaduk LRT Jakarta | Lulus | `e2e-20-3d-lrt-jakarta-viaduk.png` (Velodrome) |
| 17 | 3D: MRT layang | Lulus | `e2e-21-3d-mrt-layang-blokm.png`, `e2e-12-3d-ikuti-mrt.png`; `elev = "elev"`, 518 dek, 2.107 tiang |
| 18 | 3D: peralihan MRT dari viaduk ke terowongan | Lulus | `e2e-22-3d-mrt-peralihan.png`; viaduk berakhir di antara ASEAN dan Senayan |
| 19 | 3D: KRL layang Jakarta Kota–Manggarai | Lulus | `e2e-23-3d-krl-layang-gambir.png`; kereta di atas viaduk di Gambir |
| 20 | 3D: Lin Cibubur di permukaan dekat Taman Mini | Lulus (dari data) | `elev-v1.json`: celah km 11,1–11,8 di `jbdb.Cibubur.11`. `e2e-24-3d-lrt-cibubur-permukaan.png` diambil dari jauh; ruas tanpa dek tidak mudah dibedakan di gambar itu |
| 21 | Bawah tanah: terowongan | Lulus | `e2e-16-bawah-tanah-terowongan.png`; satu ruas terowongan Senayan–Bundaran HI; lapisan viaduk dan gedung disembunyikan |
| 22 | Bawah tanah: kotak stasiun | Lulus | `e2e-17-bawah-tanah-kotak-stasiun.png`; `platforms = 6` |
| 23 | Bawah tanah: ruas layang bukan terowongan | Lulus | `e2e-18-bawah-tanah-mulut-terowongan.png`; terowongan berhenti di mulutnya, ±600 m di selatan Senayan (sebelumnya menjulur setengah jalan ke ASEAN: `sebelum-bawah-tanah-peralihan.png`) |
| 24 | Bawah tanah: kereta bercorak | Lulus | `e2e-14-ride-dari-belakang.png`; kereta MRT abu-abu dengan pita biru di dalam terowongan |
| 25 | Ride "Dari belakang" | Lulus | `e2e-13-ride-awal.png` (di ASEAN, permukaan), `e2e-14-ride-dari-belakang.png` (terowongan); `rideView = "behind"` |
| 26 | Ride "Kabin" | Lulus | `e2e-15-ride-kabin.png`; `rideView = "cab"`; "Berhenti ikut" mengakhiri ride |
| 27 | Lapisan bus mati dan nyala | Lulus | `e2e-25-bus-mati.png` (0 bus), `e2e-26-bus-nyala.png` (5.803 bus) |
| 28 | Ketuk bus | Lulus | `e2e-27-bus-ketuk.png`; lembar rute 1 Blok M - Kota dengan halte berikutnya dan label "SIMULASI" |
| 29 | Lapisan CCTV nyala dan panel kamera | Lulus | `e2e-28-cctv-nyala.png`, `e2e-29-cctv-panel.png`; kamera Cideng Timur, video berjalan (`readyState 4`), tautan ke situs pemilik |
| 30 | Ponsel 390×844 | Lulus | `e2e-31-ponsel-beranda.png`, `e2e-32-ponsel-3d-mrt-layang.png`, `e2e-33-ponsel-bawah-tanah.png`, `e2e-34-ponsel-tab-jalur.png`; tanpa gulir mendatar (`scrollWidth = 390`) |
| 31 | Bahasa ID dan EN | Lulus | `e2e-35-bahasa-en.png`, `e2e-36-bahasa-id.png`; judul, tab, tombol, dan kotak cari berganti; `<html lang>` ikut |

Tambahan: kredit "Ketinggian rel … © kontributor OpenStreetMap, ODbL" tampil di Tentang (`e2e-30-kredit-ketinggian.png`), juga dalam bahasa Inggris.

## Kegagalan yang ditemukan dan diperbaiki

Keduanya sudah ada sebelum pekerjaan ketinggian, dan keduanya di luar daftar berkas yang boleh diubah (`web/src/tokyo/page.js`). Diperbaiki karena kecil dan jelas; mohon ditinjau.

- **G1. Pencarian pertama memicu 404 di konsol.** Halaman meminta `network-v1-names.json` (nama Korea/Tionghoa, bawaan Tokyo) yang tidak dibangun untuk Jakarta: satu `error` dan satu `warning [tokyo] names`. Perbaikan: `moreNames()` memeriksa `packs.json` dulu (`hasPack`), seperti berkas opsional lain.
- **G2. Membuka papan stasiun memicu 404 di konsol.** Halaman meminta `exits-v1.json` (pintu keluar stasiun, bawaan Tokyo): satu `error` dan satu `warning [exits] data not loaded`. Perbaikan: `ensureExits()` memeriksa `packs.json` dulu.

Setelah perbaikan, butir 9 dan 12 diulang dari muat halaman baru: 0 pesan error/warning.

## Catatan, tidak dihitung gagal

- **Peringatan MapLibre saat ride.** Satu kali `Too many glyphs being rendered in a tile` muncul di konsol saat kamera ride berada di zoom ±23. Berasal dari label peta dasar, tidak terlihat akibatnya di layar.
- **Bus menutupi pin CCTV.** Bila bus sedang berada tepat di atas pin kamera, ketukan membuka bus, bukan kamera. Dengan lapisan bus mati, pin yang sama membuka kamera. Belum diperbaiki (kode bus/CCTV).
- **Label arah di papan stasiun MRT terasa terbalik**: "Arah luar kota · ke Bundaran HI" dan "Arah pusat · ke Lebak Bulus". Sudah ada sebelumnya; belum diperbaiki.
- **Di mode Bawah tanah, kereta di ruas layang digambar di permukaan**, karena viaduk dan gedung disembunyikan di mode itu (perilaku kode asal).
- **Tab Stasiun dan lembar "Cari rute"** hanya dibuka sekilas (`e2e-06a-tab-stasiun.png`), tidak diuji mendalam.
- **Yang tidak diuji:** peramban selain Chromium, perangkat sungguhan (ponsel diuji sebagai ukuran jendela 390×844), mode luring, lokasi "di dekatku", posisi langsung, dan hasil `bun run build` di server statis.

## Usulan: suite e2e otomatis

Tidak ada dependensi yang ditambahkan. Bila pemilik menginginkan suite otomatis, usulnya:

- Playwright sebagai `devDependency` (perambannya diunduh terpisah), satu berkas `e2e/jaktrack.spec.mjs` berisi ±15 butir dari tabel di atas.
- Halaman sudah punya kait uji `window.__tokyo` (`stats()`, `playback.setSec()`, `set3d()`, `setBuses()`, `state.city3d.state()`), jadi uji bisa memeriksa angka (jumlah kereta, `elev`, jumlah dek viaduk, `platforms`) tanpa membandingkan gambar.
- Jalankan terhadap `bun run dev` dengan data contoh yang kecil dan tetap, supaya tidak bergantung pada berkas `var/` milik tiap orang. Itu berarti perlu fixture data yang boleh di-commit, dan itu keputusan lisensi (data trafik.live dan turunan OSM saat ini sengaja tidak di-commit).

Keputusan ada di pemilik repo.

## Uji ulang setelah perbaikan lanjutan (trase OSM, garis rute di atas dek, label ride)

15 November 2026, data dibangun ulang dengan trase yang diselaraskan. Desktop 1440×900, bahasa Indonesia, pemutaran 08.10. **12 butir, 12 lulus.** Bukti berawalan `v2-` di `var/shots/`.

| # | Butir | Hasil | Bukti |
|---|---|---|---|
| 1 | Pemutaran waktu: kereta dan bus ikut | Lulus | 4 kereta (01.30) → 102 kereta dan 5.651 bus (08.10); diputar 60× selama 3 detik: 08.10 → 08.13 |
| 2 | Papan stasiun | Lulus | `v2-e2e-papan-stasiun.png`; Blok M, 6 keberangkatan |
| 3 | Detail kereta dan ikuti, 2D | Lulus | `v2-e2e-detail-kereta-2d.png`; garis rute utuh di 2D (ruas layang ikut tergambar), "Berhenti mengikuti" aktif |
| 4 | Label ride di ruas layang | Lulus | Tombol "Ikut kereta dari dekat" (EN: "Ride along") saat kereta di antara Blok A dan Blok M |
| 5 | Label ride di terowongan | Lulus | Tombol "Ikut di terowongan" pada 08.18 (Senayan–Istora) |
| 6 | 3D: garis rute dan stasiun di atas dek | Lulus | `v2-sesudah-mrt-lebak-bulus-dekat.png`, `v2-sesudah-mrt-blokm-terpilih.png`; 0 fitur `tk-pick` ruas layang dan 0 fitur `tk-via-deck` tergambar di tanah; 60 titik stasiun di dek |
| 7 | 3D: viaduk MRT, LRT Jakarta, KRL Juanda, Manggarai | Lulus | `v2-sesudah-mrt-peralihan-dekat.png`, `v2-sesudah-lrt-jakarta.png`, `v2-sesudah-krl-juanda.png`, `v2-sesudah-krl-manggarai.png`; `elev = "elev"`, 502 dek, 2.194 tiang |
| 8 | Ride "Dari belakang" | Lulus | `v2-e2e-ride-dari-belakang.png`; `rideView = "behind"` |
| 9 | Ride "Kabin" | Lulus | `v2-e2e-ride-kabin.png`; `rideView = "cab"` |
| 10 | Mode Bawah tanah (Dukuh Atas) | Lulus | `v2-sesudah-bawah-tanah-dukuh-atas.png`, `v2-e2e-bawah-tanah-dukuh-atas.png`; 6 kotak stasiun, 1 ruas terowongan; filter lapisan 2D kembali seperti semula di mode ini |
| 11 | 2D tidak rusak setelah 3D dimatikan | Lulus | `v2-e2e-2d-sesudah-3d.png`; filter ketujuh lapisan 2D sama persis dengan sebelum 3D dinyalakan |
| 12 | Tanpa galat konsol | Lulus | 0 error; satu peringatan MapLibre `Too many glyphs` saat ride (sudah dicatat di atas) |

Tidak diuji ulang: bus, CCTV, pencarian, tampilan ponsel, dan bahasa EN selain label tombol ride.
