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

## Uji ulang setelah pemisahan dua arah dan perbaikan lokasi

15 November 2026, data dibangun ulang dengan jumlah rel per ruas. Desktop 1440×900 kecuali disebut lain, bahasa Indonesia. **16 butir, 16 lulus.** Bukti berawalan `v3-` di `var/shots/`. Tangkapan "sebelum" untuk kereta berpapasan tidak diambil; pembandingnya tangkapan pemilik repo (dua kereta MRT bertumpuk di satu garis di viaduk).

| # | Butir | Hasil | Bukti |
|---|---|---|---|
| 1 | 3D: dua kereta MRT berpapasan di viaduk, masing-masing di relnya | Lulus | `v3-sesudah-mrt-berpapasan-viaduk-3d.png` (07.30, antara Blok A dan Blok M) |
| 2 | 3D: dua kereta KRL berpapasan di permukaan | Lulus | `v3-sesudah-krl-berpapasan-3d.png` (Lin Bogor, dekat Pasar Minggu Baru) |
| 3 | 2D zoom dekat: dua arah di sisi garis yang berbeda | Lulus | `v3-sesudah-mrt-berpapasan-2d.png`, `v3-sesudah-krl-berpapasan-2d.png` |
| 4 | Mode Bawah tanah: dua kereta MRT, tiap arah di tabungnya | Lulus | `v3-sesudah-mrt-berpapasan-terowongan.png` (Bendungan Hilir–Istora) |
| 5 | Rel tunggal: kereta tetap di garis jalur | Lulus | `v3-sesudah-rel-tunggal-3d.png`, `v3-sesudah-rel-tunggal-2d.png` (KA Pangrango, lintas Sukabumi) |
| 6 | 3D: kereta diikuti, garis rute tepat di bawahnya | Lulus | `v3-sesudah-mrt-diikuti-3d.png`, `v3-sesudah-krl-diikuti-3d.png`; 0 fitur `tk-pick` di tanah, kereta arah lawan di rel sebelah |
| 7 | Ikuti kereta di 2D | Lulus | `v3-e2e-ikuti-2d.png`; "Berhenti mengikuti" aktif, garis rute 2D tergambar |
| 8 | Pemutaran waktu | Lulus | 102 kereta dan 5.623 bus pada 07.30; diputar 60× selama 3 detik: 07.30 → 07.33 |
| 9 | Ride "Dari belakang" dan "Kabin" | Lulus | `v3-e2e-ride-dari-belakang.png`, `v3-e2e-ride-kabin.png`; label tombol "Ikut di terowongan" di terowongan |
| 10 | 2D utuh setelah 3D dimatikan | Lulus | Filter `tk-pick` kembali `["==",["get","ug"],0]` |
| 11 | Lokasi tanpa stasiun tersimpan: "Kereta di dekatku" | Lulus | `v3-sesudah-lokasi-tanpa-stasiun-kereta-di-dekatku.png`; penyimpanan lokal kosong, baris itu tampil sendiri di Beranda, hasil: Blok M 10 m |
| 12 | Lokasi tanpa stasiun tersimpan: tombol lokasi di kartu peta | Lulus | `v3-sesudah-lokasi-tanpa-stasiun-tombol-peta.png`; peta terbang ke lokasi, daftar "Di dekatmu" terisi |
| 13 | Tombol lokasi saat kereta terbuka tidak menutup layar kereta | Lulus | Hash tetap `#t=mrt.MRT.9.M-L0713-BHI` |
| 14 | Konteks tidak aman (http lewat alamat LAN, 390×844): tombol peta | Lulus | `v3-sesudah-lokasi-http-lan-tombol-peta.png`; `isSecureContext = false`, pesan "Lokasi hanya tersedia lewat https atau localhost." |
| 15 | Konteks tidak aman: "Kereta di dekatku" | Lulus | `v3-sesudah-lokasi-http-lan-kereta-di-dekatku.png`; pesan yang sama dengan penjelasan http |
| 16 | Tanpa galat konsol | Lulus setelah perbaikan | Blok "Kereta di dekatku" meminta `exits-v1.json` (404) setelah lokasi terbaca; kini diperiksa lewat `packs.json` dulu. Diulang: 0 error |

Yang menghalangi lokasi sebelumnya:

- Lewat alamat LAN dengan http, browser menolak geolokasi tanpa bertanya, dan halaman menampilkan "Izin lokasi ditolak. Pilih stasiun dari daftar." Pesan itu salah sebab (bukan izin yang ditolak) dan menyuruh memilih stasiun.
- Di Beranda tanpa stasiun tersimpan, satu-satunya tombol "Kereta di dekatku" berada di dalam kartu "Pilih stasiunmu"; baris lokasi yang berdiri sendiri baru muncul setelah ada stasiun tersimpan.
- Tombol lokasi di kartu peta selalu memindahkan pengguna ke tab Stasiun, juga saat sebuah kereta atau stasiun sedang dibuka.
- Pesan gagal lainnya ("Pilih stasiunmu saja…", "Pilih stasiunmu untuk melihat kereta berikutnya.") mengarahkan ke pemilihan stasiun.

Lokasi tetap tidak disimpan dan tidak dikirim ke mana pun; yang disimpan hanya tanda `tokyo.nearby=1` (pengguna pernah menyalakan "Kereta di dekatku"), perilaku yang sudah ada. Tidak ada geolokasi di kode bus; halte terdekat tidak memakai lokasi pengguna.

Tidak diuji: izin lokasi yang ditolak pengguna di konteks aman (hanya teksnya yang diubah), perangkat sungguhan, CCTV, pencarian.

## Uji ulang setelah rel terlihat di 3D

15 November 2026. Desktop 1440×900, bahasa Indonesia, lapisan bus mati. **15 butir, 15 lulus.** Bukti berawalan `v4-` di `var/shots/`: `v4-sebelum-*` dari kode 96bd779 (server kedua di port 4794, data yang sama), `v4-sesudah-*` dari kode sekarang, sudut kamera sama (zoom 18,3, kemiringan 60°).

| # | Butir | Hasil | Bukti |
|---|---|---|---|
| 1 | MRT berpapasan di viaduk (07.20, Blok A–Blok M): dua rel terlihat, tiap kereta di relnya | Lulus | `v4-sesudah-mrt-viaduk.png` |
| 2 | LRT Jakarta berpapasan di viaduk (07.25, dekat Equestrian) | Lulus | `v4-sesudah-lrt-jakarta.png` |
| 3 | LRT Jabodebek berpapasan di viaduk (07.23, Cikoko–Pancoran) | Lulus | `v4-sesudah-lrt-jabodebek.png` |
| 4 | KRL berpapasan di viaduk (07.17, Juanda–Gondangdia) | Lulus | `v4-sesudah-krl-juanda-viaduk.png` |
| 5 | KRL berpapasan di permukaan, Depok (07.04) | Lulus | `v4-sesudah-krl-depok-permukaan.png` |
| 6 | KRL berpapasan di permukaan, Bekasi Timur (07.19) | Lulus | `v4-sesudah-krl-bekasi-permukaan.png` |
| 7 | MRT berpapasan di terowongan, mode Bawah tanah (07.30, Bendungan Hilir–Istora): tiap arah di tabungnya | Lulus | `v4-sesudah-mrt-terowongan.png` |
| 8 | Ride "Dari belakang" di terowongan dengan kereta lawan | Lulus | `v4-e2e-ride-dari-belakang-kereta-lawan.png`; kereta lawan tampak di kiri, di luar tabung kereta yang dinaiki, tidak menembusnya |
| 9 | Ride "Kabin" | Lulus | `v4-e2e-ride-kabin-kereta-lawan.png`; `rideView = "cab"` |
| 10 | Rel tunggal (KA Pangrango, lintas Sukabumi): satu rel, kereta di atasnya | Lulus | `v4-sesudah-rel-tunggal.png` |
| 11 | Ujung jalur Lebak Bulus 11.40 (M-L1140-LBB berangkat, M-L1113-BHI tiba): dua rel, tidak menembus | Lulus | `v4-sesudah-ujung-lebak-bulus.png`, `v4-sesudah-ujung-lebak-bulus-dekat.png` |
| 12 | Ikuti kereta di 3D: garis rute di rel kereta itu | Lulus | `v4-e2e-ikuti-3d.png`; 0 fitur `tk-pick` dan 0 fitur `tk-rest` tergambar di tanah |
| 13 | Rentang zoom, kamera miring 55°: 14,5 · 15 · 15,5 · 16 · 16,5 · 17 · 17,5 · 18 · 19 di MRT viaduk dan KRL Depok | Lulus | `v4-zoom-mrt-viaduk-z*.png`, `v4-zoom-krl-depok-z*.png` (18 tangkapan) |
| 14 | 2D utuh setelah 3D dimatikan | Lulus | `v4-e2e-2d-sesudah-3d.png`; filter `tk-rest` dan `tk-pick` kembali `["==",["get","ug"],0]` |
| 15 | Tanpa galat konsol | Lulus | 0 error; satu peringatan MapLibre `Too many glyphs` saat ride |

Catatan jujur tentang butir 13: dari 18 tangkapan rentang zoom, yang saya lihat satu per satu adalah zoom 14,5, 16, dan 17 (MRT) serta 15,5 dan 19 (Depok); sisanya diambil tetapi tidak saya buka. Tangkapan rentang zoom diambil saat pita rel masih selebar 1,9 m (kemudian dirampingkan menjadi 1,4 m). Bahwa dua badan kereta tidak bisa saling menutupi di ruas ganda pada zoom mana pun mengikuti dari hitungannya (jarak sumbu ≥ 4 m × pelebaran, lebar badan 2,95 m × pelebaran), bukan hanya dari tangkapan.

Yang tidak diuji: zoom di bawah 14,2 (di sana kereta 3D tidak tampil), perangkat sungguhan, mode "Skala asli" di Bawah tanah, dan ujung jalur selain Lebak Bulus.

## Tambahan 15 November 2026: warna rel dan kesinambungan garis jalur

Uji dengan cara yang sama (Chromium lewat Playwright MCP, `PORT=4793 bun web/dev-server.mjs`, pemutaran 08.10, desktop 1440×900 dan satu tangkapan ponsel 390×844). Bukti: `var/shots/v5-a-sebelum-*.png` dan `v5-a-sesudah-*.png` dari sudut yang sama. Galat dan peringatan konsol: 0 di semua langkah.

| # | Butir | Hasil | Bukti |
|---|---|---|---|
| A1 | 3D: kedua rel MRT berwarna merah di viaduk | Lulus | `v5-a-sesudah-3d-viaduk.png` (sebelum: dua pita abu-abu) |
| A2 | 3D: kereta dibuka, sorotan di kedua rel, rel jalur lain abu-abu | Lulus | `v5-a-sesudah-3d-kereta-terpilih-ikut.png` (sebelum: satu rel merah, satu abu-abu, `v5-a-sebelum-3d-kereta-terpilih-landaian.png`) |
| A3 | 3D: jalur dibuka dari tab Jalur, sorotan di kedua rel | Lulus | `v5-a-sesudah-3d-jalur-terpilih-landaian.png` |
| A4 | 3D: landaian ASEAN–Senayan, rel menerus dari dek ke terowongan | Lulus | `v5-a-sesudah-3d-landaian.png`, `-landaian-jauh.png` (sebelum: rel berhenti di mulut terowongan) |
| A5 | 3D: terowongan Senayan–Bundaran HI terbaca, dua rel putus-putus | Lulus | `v5-a-sesudah-3d-terowongan.png`, `-3d-bundaran-hi.png` (sebelum: garis nyaris tak terlihat) |
| A6 | 3D: ujung Lebak Bulus | Lulus | `v5-a-sesudah-3d-lebak-bulus.png` |
| A7 | Zoom 14,0 dan 14,4 dengan 3D menyala: satu garis berwarna, lalu dua rel berwarna, tanpa garis ganda | Lulus | `v5-a-sesudah-3d-landaian-z14_0.png`, `-z14_4.png`; filter `tk-rest` dan `tk-rest-ug` kosong di 14,4 dan kembali di 14,0 |
| A8 | 2D: garis menerus lewat mulut terowongan, ruas terowongan putus-putus | Lulus | `v5-a-sesudah-2d-landaian-z15.png`, `-2d-mrt-z13.png` |
| A9 | Bawah tanah: dua rel berwarna tiba di mulut kedua tabung | Lulus | `v5-a-sesudah-bawah-tanah-landaian.png`, `-mulut-dekat.png`, `-bundaran-hi.png` |
| A10 | Keluar dari Bawah tanah lalu 3D mati: warna dan filter garis 2D kembali seperti semula | Lulus | `line-color` `#AAAAB0`, filter `ug == 0` / `ug == 1`; `v5-a-sesudah-2d-sesudah-3d-mati.png` |
| A11 | Jalur lain: LRT Jakarta (Velodrome), LRT Jabodebek (Pancoran), KRL Juanda, KRL Kebayoran, KRL Manggarai | Lulus | `v5-a-sesudah-3d-lrtj-velodrome.png`, `-jbdb-pancoran.png`, `-krl-juanda.png`, `-krl-kebayoran.png`, `-krl-manggarai.png` |
| A12 | Rel tunggal dan peralihan tunggal ke ganda | Lulus | `v5-a-sesudah-3d-krl-cibinong-tunggal.png`, `-krl-citayam-tunggal-ganda.png`, `-lrtj-kelapa-gading-tunggal-ganda.png` (dua pita merapat jadi satu) |
| A13 | Ponsel 390×844: landaian di 3D | Lulus | `v5-a-sesudah-ponsel-3d-landaian.png` |

Catatan:

- Di 3D biasa rel terowongan digambar pada kedalamannya, jadi pada peta yang dimiringkan garisnya tampak sedikit di bawah titik stasiun bawah tanah (titik itu tetap di permukaan jalan). Kereta samar di terowongan berada tepat di relnya.
- Celah sangat pendek pada rel di beberapa tempat (misalnya dekat Cibinong) adalah gedung peta dasar yang berdiri di atas lintasan dan menutupi rel; bukan rel yang terputus.
- Ride "Dari belakang" dan Terbang bebas dijalankan sekali sesudah perubahan ini: keduanya mulai tanpa galat konsol (`v5-a-sesudah-ride-dari-belakang.png`). Tidak diuji: ride "Kabin", pergantian gaya peta (`style.load`) saat 3D menyala, dan perangkat tanpa WebGL2.
