# KNOWLEDGE — hasil reverse engineering trafik.live

Diamati 2026-11-14 lewat Playwright (browser biasa, tanpa login). Situsnya "Bus Jakarta Live": peta bus TransJakarta, kereta, dan CCTV.

Label bukti: **[teramati]** = terlihat langsung di respons/kode, **[dugaan]** = disimpulkan, belum dibuktikan.

## Catatan akses

- `curl` dan Chrome headless ditolak 403 (nginx di belakang Cloudflare); browser biasa lolos. [teramati]
- Header `x-robots-tag: noindex, nofollow`: pemilik tidak ingin situsnya dirayapi mesin. [teramati]
- Jangan mengambil data dari server mereka untuk jaktrack. Pakai sumber publik di bagian "Sumber data".

## Status feed saat diamati

- Feed live mati: `/api/meta` mengembalikan `feed: {ok:false, connected:false, buses:0, mode:"live"}`; `/api/stats` mengembalikan `buses:0`. [teramati]
- Halaman menampilkan 3.146 bus **simulasi dari jadwal**, bukan posisi asli. Teks situs: "bukan posisi asli, jadi bisa meleset". [teramati]

## Arsitektur

| Lapisan | Detail | Bukti |
|---|---|---|
| Peta | MapLibre GL (chunk 1,1 MB) | teramati |
| Tile | Vektor, di-hosting sendiri: `/tiles/jbd-base-v2/{z}/{x}/{y}.mvt`; font `/tiles/fonts/{nama}/{range}.pbf` | teramati |
| Frontend | Satu `app-*.js` (118 kB) + belasan chunk `lib-*.js`; HTML dirakit dengan template string | teramati |
| Framework | Tidak ada tanda React/Vue/Svelte | dugaan (cek regex saja) |
| Data statis | JSON berversi `/data/{core,rest,patterns}-<tanggal>-<hash>.json`; alamat diumumkan `/api/meta` | teramati |
| Realtime | WebSocket `wss://trafik.live/api/live` | teramati di kode |
| CCTV | 478 kamera di Jakarta; video dari server pemilik kamera, CCTV stasiun lewat `/api/djka/<kamera>/stream.m3u8` (HLS) | teramati |
| Analitik | POST ke `/_e` dan `/_d/{batch,track,vitals}` di domain sendiri | teramati |
| PWA | `manifest.webmanifest` ada | teramati |

Pemuatan bertahap: `core` (28 kB, rute + shape BRT) dulu, lalu `rest` (194 kB, shape lain + halte), lalu `patterns` (41 kB). [teramati]

## Sumber data

- **Bus:** GTFS resmi `gtfs.transjakarta.co.id` (diambil mereka 2026-11-13). 241 rute, 7.546 halte, 694 pola trip. [teramati]
- **Kereta:** `github.com/open-krl/pipeline`, lisensi CC-BY 4.0 (wajib atribusi). 12 jalur, 139 stasiun, 2.622 perjalanan. Posisi kereta juga dari jadwal. [teramati]
- **CCTV stasiun:** jalur `/api/djka/` mengarah ke DJKA Kemenhub. [dugaan dari nama]
- **CCTV jalan, banjir, dan deteksi bus:** lihat bagian "Halaman per halaman".

## Format data statis

`core-*.json`
- `gtfs`: `{url, lastModified, fetchedAt}`
- `routes[]`: `{id, short, long, kind, color, text, sort, headway}`; `kind` mis. `brt`; `headway` berupa array tripel angka (arti tiap elemen belum dipastikan)
- `shapes[]`: `{id, route, dir, p}`; `p` = encoded polyline

`rest-*.json`
- `shapes[]`: sama seperti di atas, untuk rute non-BRT
- `halte`: **per kolom**, bukan per objek: `id[]`, `name[]`, `lat[]`, `lng[]`, `r[]` (indeks rute yang lewat), `brt[]` (indeks halte BRT)
- `lat`/`lng` = bilangan bulat, derajat × 100.000 (mis. `-629915` → -6.29915)
- `trips`: peta `trip_id → shape_id`

`patterns-*.json`
- `trips[trip_id]`: `{s, t, f}`; `s` = urutan id halte, `t` = offset waktu per halte, `f` = array tripel frekuensi (satuan belum dipastikan)

`asset-krl-*.json`
- `meta` (sumber, lisensi, tanggal capture), `lines[]`, `stations[]`, `tracks[]`, `patterns[]`, `trains[]`; semuanya array posisional, bukan objek

## Protokol WebSocket `/api/live`

Ringkasan perilaku klien; pesan nyata ada di bagian "API live data":

- Klien → server: `{t:"view", b:[bbox dibulatkan 5 desimal], z:zoom 1 desimal}`, ditambah `enc:"gzip"` bila didukung. Dikirim ulang saat peta digeser, dibatasi ±250 ms–1,2 s.
- Server → klien: JSON dengan `t` (string) sebagai jenis pesan; frame biner = gzip, dibuka dengan `DecompressionStream`, batas waktu 4 s.
- Baris bus: dua jenis array 6 elemen (`info` dan `pos`); rinciannya di bagian "API live data".
- Sambung ulang: backoff eksponensial 1 s → 30 s dengan jitter; dianggap mati bila 25 s tanpa pesan atau 8 s gagal tersambung.
- Tab tersembunyi > 10 s → koneksi ditutup; tersambung lagi saat tab aktif.
- Server hanya mengirim bus di area yang terlihat. [dugaan dari adanya pesan `view`]

## Endpoint

| Endpoint | Status |
|---|---|
| `GET /api/meta` | dipanggil; versi data + status feed |
| `GET /api/stats` | dipanggil; `{now, buses, byKind, byRoute}` |
| `GET /api/news` | dipanggil; `{v, items[]}` |
| `GET /api/halte/{id}` | dipanggil 1×; lihat "API live data" |
| `GET /api/bus/{id}` | ada di kode, belum dipanggil (tidak ada bus live) |
| `GET /api/places?q=…` | dipanggil 1×; lihat "API live data" |
| `GET /api/djka/{kamera}/stream.m3u8` | ada di kode, belum dipanggil |
| `WS /api/live` | pesan teramati (kosong karena feed mati); lihat "API live data" |
| `/cctv` | halaman terpisah; lihat "Halaman per halaman" |

## Belum diketahui

- Algoritma simulasi posisi dari jadwal (ada di chunk `lib-*.js`, belum dibaca).
- Arti bit pada `flags` di baris `pos`, dan bentuk isi `arrivals[]` (keduanya kosong saat diamati).
- Peran `wss://transit.oyenza.com` dan `wss://transit.vantis.sh`: diizinkan CSP, tetapi klien tidak menyambung ke sana.
- Apakah feed live bus sepenuhnya berasal dari deteksi CCTV (lihat `/blog`) atau ada sumber lain.
- Syarat pakai tiap pemilik kamera CCTV; daftar pemiliknya sudah diketahui, izinnya belum dicek.
- Isi panel `/tentang`, `/layanan`, `/kabar`, `/tampilan`: alamatnya ada, panelnya tidak terbuka otomatis saat dikunjungi.

## Implikasi untuk jaktrack

- GTFS TransJakarta dan open-krl publik: simulasi posisi dari jadwal bisa dibangun tanpa menyentuh trafik.live.
- Pola yang layak ditiru: data statis berversi + satu endpoint meta, halte per kolom dengan koordinat integer, WebSocket yang difilter per area peta.
- Posisi bus asli butuh sumber realtime sendiri; trafik.live pun tidak memilikinya saat diamati.

---

# Halaman per halaman

Dikunjungi 2026-11-14 ±20.50 WIB, satu kali per alamat. Yang dicatat hanya struktur dan bentuk data, bukan isi datanya.

## Aturan pemilik situs (robots.txt)

- Boleh: agen yang mengambil halaman untuk menjawab pertanyaan dan menyebut sumbernya. [teramati]
- Dilarang: mengumpulkan konten untuk melatih model atau membangun/menjual ulang korpus. [teramati]
- Penegakan juga di nginx (`bot-guard-map.conf`), cocok dengan 403 pada `curl` dan headless. [teramati]
- Berkas itu berjudul "vantis.sh"; halaman `/ketemu` menyebut pengelola **Jatevo Labs Limited** (hello@oyenza.com). [teramati]
- Konsekuensi untuk jaktrack: jangan menyalin data mereka secara massal. Catatan ini sengaja berhenti di struktur.

## Peta situs

| Alamat | Jenis | Judul |
|---|---|---|
| `/` | aplikasi utama | Bus Jakarta Live |
| `/rute`, `/halte`, `/bus`, `/cari`, `/tentang`, `/tampilan`, `/layanan`, `/kabar`, `/bawah-tanah` | rute di dalam aplikasi utama (bundle dan permintaan jaringan identik dengan `/`) | sama dengan `/` |
| `/kereta` | halaman tersendiri | Kereta Jakarta |
| `/cctv` | halaman tersendiri | CCTV Live |
| `/river` | halaman tersendiri | Oyen Banjir |
| `/ketemu` | aplikasi terpisah (JS tanpa hash, `?v=`) | Ketemuan |
| `/blog` | halaman tersendiri | Di dalam GPU |
| `iso.trafik.live` | subdomain terpisah | Jakarta Mini |

- Server mengembalikan 200 + HTML untuk alamat apa pun (`/about`, `/privacy`, `/sitemap.xml`), jadi status 200 bukan bukti halaman ada. [teramati]
- Posisi peta disimpan di hash URL: `#@lat,lng,zoom`. [teramati]
- Tautan keluar: oyenza.com, lite.oyenza.com, studio.oyenza.com, TestFlight (promosi produk pengelola). [teramati]

## `/` — Bus Jakarta Live

- Tab: Peta, Rute, Halte. Tombol: 3D, tampilan bawah tanah, tampilan peta, lokasiku dan halte terdekat.
- Filter jenis layanan: Semua, BRT, Non-BRT, Mikrotrans, Transjabodetabek, Royaltrans, Rusun, Wisata.
- Daftar 14 koridor BRT dengan headway ("Tiap ~6 mnt"); 220 dari 241 rute sedang dilayani.
- Kartu "Oyen Anker": kereta berikutnya dari stasiun tersimpan (default Manggarai).
- Banner persetujuan analitik: "Setuju / Tidak, jangan dicatat".
- localStorage: kunci `bjl.oyen`.
- Membuka `wss://trafik.live/api/live` saat dimuat. [teramati]

## `/kereta` — Kereta Jakarta

- Tab: Peta, Jalur, Stasiun. Saat diamati 78 kereta: KRL 53, MRT 5, LRT 12, KA antarkota 8.
- Fitur: simpan stasiun langganan, stasiun terdekat, papan berangkat/tiba Gambir dan Pasar Senen.
- Seluruhnya dari jadwal; tidak ada WebSocket, tidak ada panggilan `/api/`. Satu-satunya data: `asset-krl-*.json`. [teramati]
- Bundle sendiri: `kereta-*.js`.

## `/cctv` — CCTV Live

- 921 kamera, 1.197 sudut: Jakarta 478, Surabaya 192, Bali 133, Kuala Lumpur 107, Singapura 11.
- Satu berkas statis per kota: `asset-cctv-*.json`, `-bali`, `-surabaya`, `-kl`, `-sg` (cache setahun, immutable).
- Bentuk: `{v, checkedAt, sources{kode:{name, owner, page}}, cams[], offline[]}`; kamera = `{id, src, kind, name, sub, lat, lng, views[]}`.
- Video diputar **langsung dari server pemilik kamera**, tidak lewat trafik.live. Pengecualian: Dishub Surabaya diproksi karena servernya belum https. [teramati dari teks situs]
- Tautan langsung ke kamera: `/cctv#cam=<id>`.
- Sumber Jakarta (11): Pemprov DKI (jakcctv.jakarta.go.id), BPJT, Bina Marga (tol dan non-tol), Jasa Marga, Jakarta Tollroad Development, Cimanggis Cibitung Tollways, Pemkot Bekasi, Pemkot Bogor, DPUPR Kota Tangerang, Dishub Depok, Pakuan Network (YouTube).

## `/river` — Oyen Banjir

- 80 pos tinggi air (61 mengirim), status Normal / Siaga 3 / 2 / 1 / Tidak mengirim; dikelompokkan per sungai.
- Tab: Sungai, Air tanah. Juga hujan, rumah pompa, dan pasang surut Tanjung Priok.
- `/river-data/live.json` (`no-cache`): `{at, sources[7], posts[80], rain[86], pumps[221], tide, ground.wells[31]}`.
  - pos: `{id, name, river, area, lat, lng, cm, prev_cm, at, levels, status, owner}`
  - hujan: `{id, name, lat, lng, mm_today, mm_recent, raining, at, owner}`
  - pompa: `{id, name, lat, lng, total, on, idle, at}`
  - `sources[]` memuat kesehatan tiap sumber: `{key, owner, ok, read_at, count, error}`
- `/river/rivers-v2-*.json`: geometri sungai terkompresi, `{origin, scale:1e-9, lines[1134]{n, k, m, d[]}}`; `d` = koordinat integer delta. [dugaan untuk "delta"]
- Sumber yang terlihat: Dinas SDA DKI (awalan `dsda-`); awalan `sib-` pada pompa belum diidentifikasi; 6 sumber lain belum dibaca.

## `/ketemu` — Ketemuan

- Mencari titik temu yang adil untuk 2+ orang; tiap orang memilih moda: motor, mobil, atau umum (KRL/MRT/LRT/TransJakarta).
- Aplikasi terpisah: `/ketemu/app.js`, `flood.js`, `sound.js`, MapLibre versi CSP di `/ketemu/vendor/`.
- Data tempat: OpenStreetMap dan Overture Maps. Klaim situs: titik berangkat dihapus setelah pencarian.
- Endpoint pencariannya belum teramati (pencarian tidak dijalankan).

## `/blog` — Di dalam GPU

Temuan terpenting sesi ini: **posisi bus "live" dihasilkan dari CCTV, bukan dari GPS armada.**

- Alur menurut halaman: YOLO mendeteksi dan mengikuti kendaraan di tiap kamera → calon bus difoto → model visi Qwen3-VL-32B memutuskan apakah itu bus TransJakarta → dipublikasikan. Berjalan di satu GPU NVIDIA H200. [teramati dari teks situs]
- Saringan sebelum Qwen: bukan bus, terlalu kecil, tidak bergerak, di luar jalur, YOLO kurang yakin, jejak terputus, baru saja dicek.
- 169 tampilan kamera dipantau: Jakarta 45, Tol 112, Bekasi 8, Bogor 4.
- Saat diamati **0/169 kamera menyala**, `qwen.ok:false`, `gpu:null`. Ini menjelaskan feed mati dan mode simulasi. [teramati; hubungan sebab-akibatnya dugaan]
- `/blog/data/live.json` (`no-store`): `{v, t, yolo, qwen, gpu, rate, funnel, today, feed[]}`.
- `/blog/data/cams.json`: tabel `{t, cols[8], rows[169]}`.
- Cocok dengan label di kode utama: "Terlihat CCTV … dari kamera" pada kartu bus.

## `iso.trafik.live` — Jakarta Mini

- Peta piksel isometrik; "Simulasi jadwal · 3.092 bus · 79 kereta".
- Memakai data yang sama: `/api/meta`, `/data/{core,rest,patterns}-*.json`, dan `wss://iso.trafik.live/api/live`.
- Aset khusus: `/tiles/current.json` → `/tiles/k150-<waktu>/meta.json`, `/sprites/k150/atlas.json`, `/occl/k150/manifest.json`, `elev-*.json` (ketinggian).
- Analitik berbeda dari situs utama: `/_v/s.js` dan `POST /_v/api/send`.

## Implikasi tambahan untuk jaktrack

- Posisi bus asli TransJakarta tidak tersedia sebagai feed publik di sini; pengelola situs ini pun membuatnya sendiri dari CCTV dengan GPU kelas H200. Itu mahal dan saat diamati sedang mati.
- Yang realistis tanpa GPU: simulasi dari jadwal GTFS (bus) dan open-krl (kereta).
- Data banjir dan CCTV berasal dari instansi publik yang tercantum di atas; ambil dari sumber aslinya dan cek syarat pakainya.


---

# API live data

Diamati 2026-11-14 ±21.00 WIB dari satu pemuatan halaman `/` (9 detik) dan dua panggilan tunggal. Feed sedang mati, jadi semua daftar bus kosong: **nama field berasal dari kode klien, nilainya belum pernah terlihat.**

## Ringkasan

| Sumber | Cara | Irama | Cache |
|---|---|---|---|
| `WS /api/live` | WebSocket, server mendorong | `delta` tiap ±1 dtk, `feed` berkala | — |
| `GET /api/meta` | fetch saat mulai | sekali (timeout 6 dtk) | `no-store` |
| `GET /api/stats` | polling | 60 dtk (konstanta `6e4` di sebelah pemanggilnya; dugaan) | `no-store` |
| `GET /api/news` | polling, berhenti saat tab tersembunyi | belum dipastikan | `no-store` |
| `GET /api/halte/{id}` | polling saat panel halte / halte dekat terbuka | 20 dtk | `no-store` |
| `GET /api/bus/{id}` | polling saat kartu bus terbuka | 10 dtk | belum teramati |
| `GET /api/places?q=` | saat mengetik pencarian | per ketikan (timeout 6 dtk) | `no-store` |
| `GET /river-data/live.json` | fetch di `/river` | belum dipastikan | `no-cache` |
| `GET /blog/data/live.json`, `cams.json` | fetch di `/blog` | belum dipastikan | `no-store` |

Semua `fetch` JSON lewat satu pembungkus dengan timeout (bawaan 10 dtk) dan `AbortSignal`. [teramati]

## WebSocket `/api/live`

Alamat: `wss://<host>/api/live` (sama di `iso.trafik.live`). Semua pesan JSON dengan `t` sebagai jenis dan `now` (epoch ms server).

Urutan yang teramati:

```
> {"t":"view","b":[106.38397,-6.48162,107.27633,-5.92105],"z":11.3}
< {"t":"hello","v":1,"static":"20261113-fd20783e-b4","now":…,"feed":{…}}
< {"t":"snap","now":…,"info":[],"pos":[]}
< {"t":"delta","now":…,"info":[],"pos":[],"rm":[]}      ← berulang tiap ±1 detik
< {"t":"feed","now":…,"feed":{"ok":false,"connected":false,"lastMsgAt":null,"buses":0,"mode":"live"}}
```

Klien → server
- `view`: `b` = `[barat, selatan, timur, utara]` (derajat, 5 desimal), `z` = zoom 1 desimal. Dikirim saat tersambung dan tiap peta digeser; server membalas `snap` baru. Ditambah `enc:"gzip"` bila klien mau frame biner gzip.

Server → klien
- `hello`: `v` versi protokol, `static` versi data statis (bila berbeda dari yang dimuat, klien memuat ulang data), `feed` status.
- `snap`: keadaan penuh untuk area `view`; klien mengosongkan daftar lalu mengisi dari `info` + `pos`.
- `delta`: perubahan; `info` dan `pos` yang berubah, `rm` = daftar `n` yang dihapus.
- `feed`: `{ok, connected, lastMsgAt, buses, mode}`.
- `now` dipakai menghitung selisih jam: `serverOffset = now - Date.now()`.

Baris `info` (identitas, jarang berubah): `[n, id, route, trip, head, kind]`
- `n` nomor urut sesi (kunci penghubung ke `pos`), `id` id bus, `route` id rute, `trip` id trip (kunci ke `patterns`), `head` tujuan, `kind` jenis layanan (bawaan `"other"`).

Baris `pos` (posisi, sering berubah): `[n, lat, lng, bearing, ageS, flags]`
- `lat`/`lng` integer, derajat × 100.000; `bearing` arah; `ageS` umur data dalam detik (klien menghitung `at = sekarang - ageS×1000`); `flags` bitmask, arti bit belum diketahui.

Pemisahan `info`/`pos` membuat pembaruan posisi kecil: identitas dikirim sekali, posisi hanya 6 angka per bus.

## REST

`GET /api/meta`
```json
{"static":"20261113-fd20783e-b4","staticUrl":"/data/static-….json","patternsUrl":"…","coreUrl":"…","restUrl":"…",
 "feed":{"ok":false,"connected":false,"lastMsgAt":null,"buses":0,"mode":"live"}}
```
Cadangan bila gagal: `/data/static-latest.json` (timeout 8 dtk).

`GET /api/stats`
```json
{"now":1794663955919,"buses":0,"byKind":{},"byRoute":{}}
```
`byKind` dan `byRoute` = peta ke jumlah bus.

`GET /api/halte/{id}` (contoh `H00014P`)
```json
{"id":"H00014P","name":"Blok M","now":1794664569805,"arrivals":[]}
```
Dari kode, isi `arrivals[]` memuat sedikitnya `halte`, `name`/`stop`, `etaMin`. 404 diperlakukan sebagai "tidak ada kedatangan". Polling dilewati saat feed mati.

`GET /api/bus/{id}`: dari kode mengembalikan sedikitnya `lat`, `lng`, `trip`, dan daftar halte berikutnya; 404 = bus sudah hilang.

`GET /api/places?q=<teks>&limit=6[&lat=&lng=]` (`q` dipotong 80 karakter)
```json
{"q":"monas","places":[{"id":"w1159084257","name":"Monumen Nasional","kind":"attraction","sub":"Gambir, Jakarta Pusat","lat":-6.1754,"lng":106.82717}]}
```
`id` berawalan `w` + angka cocok dengan id "way" OpenStreetMap. [dugaan]

`GET /api/news`: `{"v":1,"items":[]}`; dari kode tiap item memuat `id`, `title`, `updated`, `routes[]`, `lines[]`, `places[]`.

## Mode simulasi

Saat feed mati, klien **tidak** memanggil server untuk posisi: `/api/stats`, `/api/bus/{id}`, dan `/api/halte/{id}` dijawab oleh simulator di browser (pembungkus fetch punya pengait untuk tiga alamat itu), dan simulator menyuntikkan pesan `feed` tiruan. Posisi 3.000-an bus dihitung lokal dari `patterns` + jadwal. [teramati di kode]

## Yang bisa ditiru jaktrack

- Satu WebSocket dengan `view` (bbox + zoom), `snap` lalu `delta`.
- Pisahkan identitas (`info`) dari posisi (`pos`); koordinat integer ×1e5.
- Kirim `now` server di tiap pesan agar klien tidak bergantung pada jam perangkat.
- Sediakan status feed eksplisit dan jalur cadangan ke simulasi jadwal.
