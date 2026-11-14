# jaktrack

Riset untuk pelacak transportasi umum Jakarta: bus TransJakarta, kereta (KRL, MRT, LRT), dan data pendukung seperti CCTV lalu lintas dan tinggi air sungai.

> **Status: purwarupa.** Peta kereta Jabodetabek (KRL, MRT, LRT, KA antarkota) yang bergerak **menurut jadwal**, bukan posisi asli.
> Halamannya adalah adaptasi [tokyo-rail-twin](https://github.com/lucacadalora/tokyo-rail-twin) (MIT) untuk Jakarta.

## Menjalankan

Butuh [Bun](https://bun.sh).

```bash
bun install
# simpan berkas data kereta trafik.live ke var/src/trafik/ (lihat "Data" di bawah)
bun run data   # bangun var/static/tokyo/ dari berkas itu
bun run dev    # buka http://127.0.0.1:4776
bun test       # periksa berkas hasil bangun
bun run build  # situs statis di web/dist
```

## Data

Repo ini hanya berisi kode. Berkas data tidak ikut di-commit.

- **Sumber:** berkas data kereta yang dimuat halaman `trafik.live/kereta` (`asset-krl-*.json`, 296 kB). Isinya jadwal KRL dari [Open-KRL](https://github.com/open-krl/pipeline) (CC BY 4.0), ditambah jadwal MRT, LRT, dan KA antarkota yang dihimpun trafik.live, serta geometri rel.
- **Cara mengambil:** buka `https://trafik.live/kereta` di browser, lalu simpan berkas `asset-krl-*.json` dari tab Network ke `var/src/trafik/`. Server trafik.live menolak klien selain browser, jadi tidak ada skrip unduh.
- **Batasan pakai:** `robots.txt` trafik.live melarang pengumpulan konten untuk membangun korpus atau dijual ulang. Berkas itu dipakai lokal sebagai masukan; jangan disebarkan ulang. Untuk jadwal KRL saja, Open-KRL menyediakan GTFS-nya langsung.
- **Atribusi** tampil di halaman (About → Data dan kredit) dan wajib dipertahankan.

`data-build/jakarta.mjs` mengubah berkas itu menjadi format yang dibaca halaman: 16 jalur, 207 stasiun, 2.622 perjalanan pada dua kalender (hari kerja dan akhir pekan).

## Cara kerja

```
asset-krl-*.json ─► data-build/jakarta.mjs ─► var/static/tokyo/ ─► web/ (MapLibre GL)
 (trafik.live)        jalur, stasiun,            network-v1.json     peta 2D, kota 3D,
                      jadwal per jam             tt-v1/<kalender>/   papan stasiun, pencarian
```

- Browser menaruh tiap kereta di relnya menurut jadwal, setiap frame. Tidak ada server selain penyaji berkas statis.
- Jalur yang bercabang dipecah menjadi beberapa jalur lurus (misalnya Bogor menjadi "Jakarta Kota–Bogor" dan "Nambo–Jakarta Kota"), karena halaman asalnya mengandaikan satu jalur = satu lintasan.

## Yang belum disesuaikan

- **Sisa Tokyo di antarmuka:** kelompok operator "JR / Metro / Toei / Private", penjelasan jenis kereta Jepang di About, dan sebagian teks bahasa Jepang. Nama folder dan berkas internal masih `tokyo`.
- **Hari libur nasional** belum dimasukkan; hanya Sabtu dan Minggu yang memakai jadwal akhir pekan. Jadwal KRL hari Sabtu memakai tangkapan hari Minggu (sumbernya tidak punya tangkapan Sabtu).
- **Bawah tanah dan ketinggian rel** memakai perkiraan, bukan data OpenStreetMap. Pintu keluar stasiun, bus, dan data live tidak ada.
- **Jalur yang berbagi rel digambar bertumpuk.**
- **Uji bawaan tokyo-rail-twin dihapus** karena mengunci perilaku Tokyo (zona waktu JST, data Tokyo). Yang ada hanya uji berkas hasil bangun.
- **Bus TransJakarta** dari purwarupa sebelumnya dilepas dulu; ada di riwayat git (`e2ae3e6`).

## Lisensi dan asal kode

Kode di `web/` diadaptasi dari tokyo-rail-twin (MIT), yang sebagian diadaptasi dari Mini Tokyo 3D karya Akihiko Kusanagi (MIT). Teks lisensi dan pemberitahuannya ada di `third_party/tokyo-rail-twin/` dan `web/public/LICENSES.txt`.

## Temuan utama

1. **Tidak ada feed posisi bus TransJakarta yang publik di situs itu.** Posisi "live" mereka dibuat sendiri dari CCTV: YOLO mendeteksi kendaraan, lalu model visi (Qwen3-VL-32B) memutuskan apakah itu bus TransJakarta, di satu GPU NVIDIA H200.
2. **Saat diamati (14 November 2026) jalur itu mati**: 0 dari 169 kamera menyala, dan peta menampilkan ±3.100 bus hasil simulasi dari jadwal. Situsnya sendiri menulis posisi itu "bukan posisi asli".
3. **Kereta sepenuhnya dari jadwal**, tanpa data posisi langsung.
4. **Data dasarnya publik**, jadi bisa dipakai langsung dari sumber aslinya (lihat di bawah).

## Sumber data publik

Ini sumber asli yang dipakai trafik.live. jaktrack sebaiknya mengambil dari sini, bukan dari server trafik.live.

| Data | Sumber | Catatan |
|---|---|---|
| Rute, halte, jadwal bus | GTFS TransJakarta, `gtfs.transjakarta.co.id` | 241 rute, 7.546 halte, 694 pola trip pada 13 November 2026 |
| Jadwal KRL | [open-krl/pipeline](https://github.com/open-krl/pipeline) | Lisensi CC-BY 4.0, wajib atribusi |
| Peta dasar | OpenStreetMap | Wajib atribusi |
| Tempat (pencarian) | OpenStreetMap, Overture Maps | |
| CCTV lalu lintas | Pemprov DKI, BPJT, Bina Marga, Jasa Marga, pemkot sekitar | 11 sumber untuk Jakarta; syarat pakai tiap pemilik belum dicek |
| Tinggi air, hujan, pompa | Dinas SDA DKI dan sumber lain | 7 sumber; baru satu yang teridentifikasi |

Angka di atas berasal dari pengamatan satu kali. Verifikasi ke sumber resminya sebelum dipakai.

## Arsitektur trafik.live secara ringkas

```
GTFS TransJakarta ─┐
open-krl ──────────┼─► JSON statis berversi ──► browser (MapLibre GL)
OpenStreetMap ─────┘      /data/{core,rest,patterns}-<versi>.json
                                                    ▲
CCTV ─► YOLO ─► Qwen ─► feed posisi ─► WebSocket /api/live
                         (mati saat diamati)        │
                                                    └─ cadangan: simulasi dari jadwal di browser
```

- **Peta:** MapLibre GL dengan tile vektor yang di-hosting sendiri.
- **Data statis:** tiga berkas JSON berversi, dimuat bertahap; alamatnya diumumkan oleh `/api/meta`.
- **Live:** satu WebSocket. Klien mengirim area peta yang terlihat (`view`), server membalas keadaan penuh (`snap`) lalu perubahan (`delta`) tiap ±1 detik.
- **Hemat data:** identitas bus (`info`) dipisah dari posisi (`pos`); koordinat dikirim sebagai bilangan bulat (derajat × 100.000).
- **Cadangan:** saat feed mati, simulator di browser menghitung posisi dari jadwal dan menjawab sendiri permintaan yang biasanya ke server.

Rinciannya, termasuk bentuk tiap pesan dan endpoint, ada di [`KNOWLEDGE.md`](KNOWLEDGE.md).

## Pola yang layak ditiru

- Data statis berversi ditambah satu endpoint meta, sehingga cache bisa permanen.
- WebSocket yang difilter per area peta, dengan `snap` lalu `delta`.
- Waktu server (`now`) di tiap pesan, agar klien tidak bergantung pada jam perangkat.
- Status feed yang eksplisit, dan label "simulasi" yang jujur saat data asli tidak ada.

## Yang realistis untuk jaktrack

| Pilihan | Butuh | Hasil |
|---|---|---|
| Simulasi dari jadwal | GTFS + open-krl | Perkiraan posisi; bisa meleset dari kondisi nyata |
| Deteksi dari CCTV | GPU kelas atas, izin pemilik kamera | Posisi nyata sebagian, hanya di titik yang ada kamera |
| Feed resmi operator | Kerja sama dengan TransJakarta | Posisi nyata; belum diketahui tersedia atau tidak |

Yang dipilih untuk purwarupa ini adalah baris pertama: simulasi dari jadwal, dimulai dari kereta.

## Metode dan batasan riset

- Diamati 14 November 2026 lewat browser biasa, tanpa login, satu kunjungan per halaman.
- Yang dicatat adalah **struktur dan bentuk data**, bukan salinan datanya.
- `robots.txt` trafik.live melarang pengumpulan konten untuk melatih model atau membangun korpus, dan servernya menolak klien otomatis (403). Repo ini tidak memuat data mereka dan tidak menyediakan alat untuk mengambilnya.
- Tiap butir di `KNOWLEDGE.md` ditandai **[teramati]** atau **[dugaan]**.
- Feed live sedang mati saat diamati, jadi isi pesan posisi bus belum pernah terlihat; nama field-nya dibaca dari kode klien.

## Yang belum diketahui

- Algoritma simulasi posisi dari jadwal.
- Arti `flags` pada pesan posisi dan bentuk daftar kedatangan di halte.
- Apakah feed live sepenuhnya dari CCTV atau ada sumber lain.
- Syarat pakai tiap pemilik kamera CCTV dan sumber data banjir.

## Penafian

jaktrack tidak berafiliasi dengan trafik.live, pengelolanya, TransJakarta, KAI Commuter, atau instansi pemilik data mana pun. Catatan di sini adalah hasil pengamatan pihak ketiga dan bisa keliru atau usang.
