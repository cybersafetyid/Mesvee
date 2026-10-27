# Audit UI & Service Webview — 26 Oktober 2026

Audit ini meninjau dua hal sekaligus: **kualitas antarmuka** shell React dan **perilaku
end-to-end** webview layanan (pembuatan, isolasi sesi, navigasi, notifikasi, unread, kunci,
zoom, penghapusan data). Setiap temuan di bawah berasal dari kode yang dibaca, dijalankan,
atau keduanya — bukan dari asumsi.

Ringkasan: **9 cacat diperbaiki** (3 di antaranya terlihat langsung oleh pengguna pada
setiap peluncuran), **1 cacat dokumentasi rilis** diperbaiki, dan **8 rekomendasi** masih
terbuka dengan prioritas masing-masing.

## Metode

| Lapisan | Instrumen |
| --- | --- |
| Renderer | Playwright (Chromium) terhadap bridge mock: screenshot, hit-test, computed style, keyboard |
| Unit | `vitest` (15 test) dan `cargo test` (29 test) |
| Native | `tauri build --release`, aplikasi dijalankan, log tracing, inspeksi `WKWebsiteDataStore` |
| Bukti visual | `screenshots/01-home-dark.png` … `screenshots/13-home-fixed.png` |

Akun Telegram sementara ditanam ke `settings.json` untuk menguji pembuatan webview; berkas
pengaturan asli dicadangkan lalu dipulihkan, dan direktori sesi uji dihapus.

## Temuan yang diperbaiki

| # | Severitas | Temuan | Berkas |
| --- | --- | --- | --- |
| 1 | Kritis (UI) | Reset `button { color: inherit }` ditulis **di luar layer CSS** sehingga mengalahkan seluruh utility `text-*`. Akibatnya CTA primer putih dengan teks putih, tile layanan aktif putih tanpa ikon, dan tombol bahaya kehilangan warnanya. | `src/index.css` |
| 2 | Tinggi (UI) | Menu dropdown toolbar layanan tertimpa area layanan. `backdrop-filter` pada `.glass` membentuk stacking context, sehingga `z-40` menu terkurung di bawah surface. Menu hanya terlihat sebagian dan tidak bisa diklik. | `src/features/service/ServiceScreen.tsx` |
| 3 | Tinggi (UI) | Menu toolbar tidak bisa ditutup dengan Escape maupun klik di luar. Karena webview native disembunyikan selama overlay terbuka, aplikasi tampak kosong/macet. | `src/features/service/ServiceScreen.tsx` |
| 4 | Sedang (a11y) | Dialog konfirmasi destruktif adalah `alertdialog` buatan sendiri: tanpa focus trap, tanpa Escape, tanpa autofocus, tanpa `aria-labelledby`. | `src/features/service/ServiceScreen.tsx`, `src/ui/Modal.tsx` |
| 5 | Tinggi (E2E) | Setelah **unlock**, webview layanan tetap tersembunyi. Rust menyembunyikannya saat lock, tetapi renderer tidak pernah meminta sync ulang karena efek workspace tidak bergantung pada status kunci. | `src/features/service/ServiceScreen.tsx` |
| 6 | Tinggi (E2E) | Setelah **hapus data sesi** dari toolbar, area layanan kosong selamanya: Rust menutup webview, renderer tidak pernah membuat ulang. | `src/features/service/ServiceScreen.tsx` |
| 7 | Sedang (E2E) | Zoom per layanan tidak diterapkan ulang saat webview dibuat ulang, sehingga UI menampilkan 125% sementara halaman render 100%. | `src-tauri/src/services/views.rs` |
| 8 | Sedang (keamanan) | `on_navigation` menerima `http://`. Satu hop plaintext cukup bagi penyerang on-path untuk menulis ulang halaman yang baru saja menerima cookie sesi. | `src-tauri/src/services/catalog.rs`, `views.rs` |
| 9 | Sedang (data) | Parser judul **membulatkan** angka besar ke 999, sehingga judul seperti `(2026) Year in review` memunculkan badge 999 permanen. | `src-tauri/src/services/unread.rs` |
| 10 | Rendah (UI) | Tombol zoom menampilkan `100`, bukan `100%`. | `src/features/service/ServiceScreen.tsx` |
| 11 | Rendah (UI) | Placeholder menampilkan spinner "Membuka …" di balik menu/dialog, seolah layanan sedang terputus. | `src/features/service/ServiceScreen.tsx` |
| 12 | Dokumentasi | `docs/RELEASE.md` mengekspor **path** ke `TAURI_SIGNING_PRIVATE_KEY`; variabel itu harus berisi isi kunci. Build gagal setelah bundel jadi. | `docs/RELEASE.md` |

### Akar masalah #1

CSS tanpa `@layer` selalu menang atas CSS berlayer. `@layer base { button { color: inherit } }`
membuat utility Tailwind kembali berkuasa. Sesudah perbaikan, `getComputedStyle` pada CTA
primer mengembalikan `color: rgb(8, 8, 10)` di atas `background: rgb(247, 247, 244)`
(rasio kontras ±19:1), dan glyph layanan aktif memakai `fill: rgb(8, 8, 10)`.

### Akar masalah #5 dan #6

Keduanya adalah kegagalan yang sama: **native state berubah tanpa renderer tahu**. Perbaikan
memakai dependensi eksplisit pada efek sinkronisasi — `isLocked` untuk kunci dan
`sessionEpoch` untuk data sesi yang dihapus — sehingga kontraknya terlihat di kode, bukan
tersembunyi di urutan event.

## Putaran kedua — UI dan sisa temuan

| # | Perubahan | Berkas |
| --- | --- | --- |
| 13 | **Kilatan hitam saat toolbar diklik hilang.** Menu dropdown yang menutupi webview diganti *action tray* yang mengembang di dalam toolbar: header tumbuh, webview terdorong dan di-resize, halaman tetap terlihat. Hanya dialog konfirmasi yang masih menyembunyikan surface. | `src/features/service/ServiceScreen.tsx` |
| 14 | Catatan “setiap akun memakai penyimpanan terisolasi” dihapus; tepi bawah webview kini sejajar dengan tepi bawah sidebar (keduanya 8 px dari window). | `ServiceScreen.tsx`, `Rail.tsx` |
| 15 | **Titlebar kustom penuh.** Window memakai `decorations: false`, jadi OS tidak menggambar tombol apa pun; sekarang macOS mendapat traffic light monokrom di kiri (warna muncul saat hover) dan Windows/Linux mendapat caption buttons di kanan. Semua kontrol berbagi tinggi 28 px dan sejajar tengah dengan breadcrumb, search, dan aksi kanan. | `src/app/Titlebar.tsx` |
| 16 | Sidebar menjadi tray kaca melayang dengan kartu akun terpisah dan kapsul kontrol aplikasi di bawah. | `src/app/Rail.tsx` |
| 17 | Settings memakai bahasa visual yang sama: rail bagian dan kartu isi melayang di atas kanvas, bukan panel yang menempel ke tepi. | `src/features/settings/SettingsScreen.tsx` |
| 18 | Badge ikon aplikasi tidak lagi menampilkan “0”: `set_badge_count(None)` saat total nol (sebelumnya `Some(0)` membuat macOS/Linux menggambar angka 0). | `src-tauri/src/services/views.rs` |
| 19 | **Batas IPC berlapis.** Semua 33 command shell dideklarasikan lewat `AppManifest::commands`; hanya `capabilities/main.json` yang memberinya izin, dan hanya untuk webview `main`. Halaman layanan kini ditolak oleh ACL sebelum kode Rust berjalan. `service_notification` sengaja di luar manifest karena harus dijangkau halaman, dan tetap diautentikasi label + token. | `build.rs`, `capabilities/main.json` |
| 20 | Unduhan diarahkan ke folder Downloads pengguna dengan nama berkas yang dibersihkan dan bebas tabrakan; macOS yang melaporkan path kosong kini tetap menampilkan lokasi berkas di toast. | `views.rs` |
| 21 | `thread::sleep` pada hapus layanan/data sesi diganti `spawn_blocking`, sehingga thread runtime async tidak tertahan 550 ms. | `commands/services.rs`, `views.rs` |

## Temuan yang sengaja belum diubah

| Prioritas | Temuan | Alasan keputusan |
| --- | --- | --- |
| P1 | Isolasi sesi di macOS 11–13 | `WKWebsiteDataStore(forIdentifier:)` baru ada di macOS 14, sementara `minimumSystemVersion` 11.0 dipakai agar toolchain lokal bisa menautkan proc-macro. Menaikkannya merusak build di mesin ini, jadi batas ini didokumentasikan di `docs/SECURITY.md` §4 sampai build rilis memakai Xcode yang mendukung target 14.0. |
| P2 | Webview idle tidak dibuang | Menutup webview yang tidak aktif akan mematikan penerimaan pesan latar — justru nilai utama Mesvee. Throttling juga menunda notifikasi. Biaya RAM 16 renderer perlu diukur dulu sebelum ada kebijakan. |
| P2 | Klik notifikasi membuka akun asal | `tauri-plugin-notification` tidak mengekspos callback klik; ini butuh delegate notifikasi native per platform, bukan perubahan kecil. |
| P2 | Status back/forward | Layanan yang didukung adalah SPA, di mana `on_navigation` hampir tidak pernah menyala. Heuristik akan salah menonaktifkan Back, jadi tombol dibiarkan aktif sampai Tauri mengekspos state riwayat native. |
| P3 | Uji bridge notifikasi di runtime | Butuh self-test khusus mode debug; unit test sudah mengunci escaping dan kebijakan izin, dan jalur ACL kini terisolasi dari command lain. |

## Verifikasi yang dijalankan

```text
pnpm run typecheck            → bersih
pnpm run test                 → 15 lulus
cargo test (via pnpm run check) → 29 lulus
pnpm exec playwright test       → 6 lulus (termasuk spec regresi baru)
pnpm exec tauri build           → Mesvee.app 6.64 MiB, .dmg 3.50 MiB, .app.tar.gz 3.47 MiB
```

Bukti native (aplikasi rilis dijalankan dengan satu akun Telegram sementara, zoom 125%):

* `service webview created service_kind="telegram" service_id="1111…5555"` — webview dibuat,
  tanpa peringatan `failed to restore service zoom`.
* `~/Library/WebKit/app.mesvee.desktop/WebsiteDataStore/1111…5555` terbentuk dengan
  `NetworkCache` 2.9 MB / 79 berkas, `ResourceLoadStatistics`, `Origins` — halaman benar-benar
  dimuat dan datanya terkurung per akun.
* ID layanan yang tidak valid ditolak dengan `service identifier is not a valid UUID` dan
  muncul sebagai error command, bukan panic.
* Log peluncuran hanya memuat `Mesvee starting` + `startup complete`; tidak ada lagi
  `frontend did not report ready`.

Catatan: satu-satunya ERROR yang tersisa adalah endpoint updater yang belum dipublikasikan —
kondisi yang benar sebelum rilis pertama.

## Regresi yang dijaga

`tests/e2e/smoke.spec.ts` kini memuat spesifikasi **"keeps primary actions legible"** yang
mengunci tiga hal sekaligus: rasio kontras CTA primer, kontras tile akun aktif, dan perilaku
tutup menu lewat Escape maupun klik di luar. Cacat #1 dan #3 tidak dapat kembali tanpa
membuat test merah.
