# Bot WhatsApp KasirWarung AI (gratis, Baileys)

Bot ini membuat nomor WhatsApp warung menjadi **customer service otomatis** di grup pelanggan dan chat pribadi:

| Pelanggan mengetik | Bot membalas |
|---|---|
| `menu` / `halo` | Daftar perintah |
| `harga beras` · `ada gas 3kg?` | Harga eceran/paket/grosir + ketersediaan stok |
| `pesan` + daftar belanja per baris | Pesanan tercatat (no. `PSN…`) → muncul di menu **Pesanan WA** di aplikasi |
| `status PSN260927-001` | Status pesanan (hanya untuk pemesannya) |
| `kasbon` | Sisa kasbon — **hanya di chat pribadi**, hanya milik nomor itu sendiri |
| `alamat` | Alamat & kontak warung |
| Pertanyaan bebas | Dijawab AI (chat pribadi, atau di grup bila bot di-*mention*); tanpa AI → menu |

Di grup, bot **tidak ikut ngobrol**: hanya menjawab perintah di atas atau bila di-*mention*.
Saat kasir memproses/menyelesaikan/membatalkan pesanan, pelanggan otomatis dikabari.

```
Pelanggan ──WhatsApp──▶ bot (HP/PC/VPS ini) ──HTTPS──▶ web app KasirWarung (Apps Script) ──▶ DB_KasirWarung
          ◀──balasan───                    ◀──────── jawaban + notifikasi ─────────────┘
```

Semua jawaban diputuskan oleh web app (harga, stok, kasbon, kunci AI tetap di server). Bot hanya meneruskan pesan.

> ⚠️ Baileys **bukan layanan resmi WhatsApp**. Pakai **nomor khusus warung** (bukan nomor pribadi utama),
> jangan dipakai untuk broadcast/promosi massal. Bot ini hanya membalas & mengabari pemesan, sehingga risikonya kecil,
> tetapi pemblokiran nomor tetap mungkin terjadi.

---

## 1. Siapkan di aplikasi (Owner)

1. Perbarui aplikasi ke versi terbaru (Code.gs + Tampilan) lalu **Deploy → Manage deployments → Edit → New version**.
   Web app harus: *Execute as: Me* · *Who has access: Anyone*.
2. Buka **Pengaturan → Bot WhatsApp → Buat kode rahasia bot**. Salin 3 baris `.env` yang muncul (hanya tampil sekali).

## 2. Pilih tempat bot berjalan (harus menyala terus)

### A. HP Android bekas (Termux) — paling murah
1. Pasang **Termux** dari F-Droid (bukan Play Store).
2. Di Termux:
   ```sh
   pkg update && pkg install -y nodejs-lts git
   git clone https://github.com/mfakhrurrazi/KasirWarungFull.git
   cd KasirWarungFull/wa-bot
   npm install
   cp .env.example .env
   nano .env          # tempel APPS_SCRIPT_URL, BOT_SECRET, PAIRING_NUMBER → Ctrl+O, Enter, Ctrl+X
   termux-wake-lock   # agar tidak tertidur
   npm start
   ```
3. Nonaktifkan optimasi baterai untuk Termux (Setelan → Aplikasi → Termux → Baterai → Tidak dibatasi).

### B. PC/Laptop Windows / Mac / Linux
1. Pasang **Node.js 20 atau lebih baru** dari nodejs.org.
2. Unduh folder `wa-bot` (atau `git clone` seperti di atas), buka terminal di folder itu:
   ```sh
   npm install
   copy .env.example .env      (Mac/Linux: cp .env.example .env)
   ```
   Isi `.env` dengan Notepad, lalu `npm start`.

### C. VPS Linux (paling stabil)
```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs git
git clone https://github.com/mfakhrurrazi/KasirWarungFull.git && cd KasirWarungFull/wa-bot
npm install && cp .env.example .env && nano .env
sudo npm i -g pm2
pm2 start index.js --name kasirwarung-wa && pm2 save && pm2 startup   # jalan otomatis setelah reboot
pm2 logs kasirwarung-wa                                               # lihat kode pairing / log
```

## 3. Tautkan nomor WhatsApp bot

Saat `npm start`, terminal menampilkan **KODE PAIRING** (bila `PAIRING_NUMBER` diisi) atau **QR**.
Di HP nomor bot: **WhatsApp → ⋮ / Setelan → Perangkat tertaut → Tautkan perangkat**
→ *Tautkan dengan nomor telepon saja* → masukkan kode (atau scan QR).

Setelah tersambung terminal menulis `Tersambung ke web app. Grup: …` dan status di
**Pengaturan → Bot WhatsApp** menjadi **Aktif**. Sesi disimpan di folder `auth/` — **jangan dibagikan**.

## 4. Masukkan bot ke grup pelanggan

Tambahkan nomor bot ke grup WhatsApp pelanggan (atau buat grup baru, mis. "Belanja Warung Berkah").
Pilih grup mana yang dilayani di **Pengaturan → Bot WhatsApp** (tidak dicentang = semua grup).
Contoh pesan sambutan untuk grup:

```
Belanja lewat WA sekarang bisa otomatis 🙌
• Cek harga: ketik  harga <barang>
• Pesan: ketik  pesan  lalu daftar belanja per baris
• Cek pesanan: status <no. pesanan>
• Cek kasbon: chat pribadi ke nomor ini, ketik  kasbon
```

## 5. Alur kasir

Pesanan baru masuk ke menu **Pesanan WA** (aplikasi memuat ulang tiap 30 detik).
**Proses di Kasir** → keranjang terisi otomatis (pelanggan terdaftar ikut terpilih) → cek stok/jumlah → bayar.
Setelah dibayar pesanan otomatis **Selesai** dan pelanggan menerima ucapan terima kasih + nomor transaksi.
**Tandai disiapkan** / **Batalkan** juga mengirim kabar ke pelanggan (bisa dimatikan di pengaturan).

## Masalah umum

| Pesan di terminal | Solusi |
|---|---|
| `Pengaturan .env belum lengkap` | Isi `.env` (langkah 1 & 2). |
| `Kode rahasia bot salah` | Kode dibuat ulang di aplikasi → salin `BOT_SECRET` terbaru ke `.env`, jalankan ulang. |
| `Web app membalas halaman HTML` | Deploy web app dengan akses **Anyone**, pakai URL `/exec` terbaru. |
| `Belum bisa terhubung ke server WhatsApp` | Periksa internet; jaringan kantor/sekolah kadang memblokir WhatsApp Web. |
| `Perangkat dikeluarkan dari WhatsApp` | Hapus folder `auth/`, jalankan `npm start`, tautkan ulang. |
| Bot diam di grup | Pastikan grup dicentang (atau tidak ada yang dicentang), bot aktif, dan pesan diawali perintah (`harga`, `pesan`, …) atau mention bot. |

Tes otomatis: `npm test`.

© 2026 KasirWarung AI · Made by Piyu
