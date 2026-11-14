# Lokasi ("Kereta di dekatku") dari perangkat lain di jaringan yang sama

Browser hanya mau membagikan lokasi di *secure context*: `https://…` atau `http://localhost`. Kalau aplikasi dibuka dari ponsel lewat `http://<IP-LAN>:<port>`, browser menolak tanpa bertanya, dan aplikasi menampilkan "Lokasi hanya tersedia lewat https atau localhost." beserta petunjuk di bawah ini.

## Cara menyalakan

```sh
bun run dev:https            # sama dengan: HTTPS=1 bun web/dev-server.mjs  (atau --https)
```

Server lalu mendengarkan di semua antarmuka dan mencetak satu alamat per antarmuka, misalnya:

```
[dev] open https://localhost:4776/
[dev] open https://192.168.1.166:4776/
```

Buka alamat `https://<IP-LAN>:<port>/` itu di ponsel atau laptop lain yang berada di Wi-Fi/LAN yang sama, lalu ketuk "Kereta di dekatku" dan izinkan lokasi.

- `PORT` dan `HOST` tetap berlaku (`HOST` bawaan menjadi `0.0.0.0` dalam mode ini). Tanpa `HTTPS=1` tidak ada yang berubah: `bun run dev` tetap http di `127.0.0.1`.
- Sertifikat self-signed dibuat sekali dengan `openssl` milik sistem ke `var/tls/` (`dev-key.pem`, `dev-cert.pem`; `var/` tidak pernah di-commit). Isinya mencakup `localhost`, `127.0.0.1`, dan semua alamat IPv4 LAN mesin; berlaku 365 hari dan dibuat ulang sendiri bila alamat LAN berubah atau masa berlakunya hampir habis.
- Kalau `openssl` tidak terpasang, server berhenti dengan pesan yang jelas dan kode keluar 1.
- Firewall mesin harus mengizinkan koneksi masuk ke port itu.

## Peringatan sertifikat di ponsel

Sertifikatnya tidak ditandatangani otoritas mana pun, jadi tiap perangkat memberi peringatan sekali:

- Chrome (Android/desktop): "Koneksi Anda tidak pribadi" → **Lanjutan** → **Lanjutkan ke … (tidak aman)**.
- Safari (iOS/macOS): "Koneksi ini tidak pribadi" → **Tampilkan Detail** → **kunjungi situs web ini**.

Setelah itu halaman berjalan sebagai secure context dan lokasi bisa diminta. Peringatan muncul lagi bila sertifikat dibuat ulang. Service worker (mode luring) biasanya tidak terdaftar di balik sertifikat yang tidak dipercaya; itu hanya memunculkan satu peringatan di konsol dan tidak memengaruhi lokasi. Pakai mode ini hanya di jaringan yang kamu percaya; jangan memasang sertifikat ini sebagai tepercaya di perangkat.

## Produksi / pratinjau

Repo ini tidak punya server produksi sendiri: `bun run build` menulis berkas statis ke `web/dist/`, dan `bun web/dev-server.mjs --dist` menyajikannya (dengan `HTTPS=1` bila perlu diuji dari ponsel). Di hosting mana pun yang menyajikan `web/dist/` lewat https dengan sertifikat sah, lokasi berfungsi tanpa pengaturan tambahan; lewat http biasa pesan di atas yang muncul.

## Privasi

Lokasi hanya dipakai di browser itu sendiri, untuk dibandingkan dengan koordinat stasiun dan menggambar titik "kamu di sini" di peta. Koordinat tidak dikirim ke server mana pun, tidak dicatat, dan tidak disimpan. Yang disimpan di `localStorage` hanya penanda bahwa fitur ini pernah dinyalakan (`tokyo.nearby = 1`), dan "Matikan" menghapusnya. Lokasi baru diminta saat tombolnya diketuk, tidak pernah saat halaman dimuat.

## Yang sudah diuji

15 November 2026, Chrome headless lewat Playwright, 390×844, lokasi tiruan dekat Bundaran HI, `PORT=4794`. Tangkapan di `var/shots/v5-b-*`.

| Alamat | Izin | Hasil |
| --- | --- | --- |
| `https://<IP-LAN>:4794` | diberi | `isSecureContext = true`; "Kereta di dekatku" menampilkan Bundaran HI, Dukuh Atas, Sudirman Baru; tombol lokasi di peta membuka "Di dekatmu"; 0 error konsol |
| `https://<IP-LAN>:4794` | ditolak | "Akses lokasi untuk situs ini nonaktif." + cara mengizinkan; 0 error konsol |
| `http://localhost:4794` | diberi | sama dengan baris pertama |
| `http://<IP-LAN>:4794` | – | `isSecureContext = false`; pesan `loc.insecure` + petunjuk `bun run dev:https`; 0 error konsol |

Belum diuji: ponsel sungguhan (Safari iOS, Chrome Android) dan langkah menerima peringatan sertifikat di sana; uji memakai `ignoreHTTPSErrors`. Uji dijalankan sekitar 02.40 WIB, di luar jam operasi, jadi kartu stasiun menampilkan "Tidak ada kereta lagi dalam jadwal hari ini" dan baris keberangkatan tidak ikut teruji lewat https.
