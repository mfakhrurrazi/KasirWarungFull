# Akses Publik KasirWarung AI — Toko Online & API

Ada dua cara mengakses aplikasi dari luar:

| | Toko online | API dengan kunci |
|---|---|---|
| Untuk | Pelanggan (siapa saja) | Aplikasi lain: website, n8n, Zapier, Google Sheets, POS lain |
| Alamat | `<URL web app>?page=toko` | `<URL web app>?api=<aksi>&key=<kunci>` |
| Login / kunci | Tidak perlu | Kunci API dari Pengaturan |
| Data | Katalog & harga jual, pesan, status pesanan | Semua fitur sesuai hak akses kunci |

`<URL web app>` = alamat deploy yang berakhiran **/exec**, misalnya
`https://script.google.com/macros/s/AKfycb…/exec`. Web app harus di-deploy dengan
*Execute as: Me* dan *Who has access: Anyone*.

Atur semuanya di **Pengaturan → Akses Publik** (hanya Owner):
buka/tutup toko, terima pesanan online, cara menampilkan stok, catatan toko, API on/off, buat & cabut kunci.

---

## 1. Toko online (tanpa login)

Bagikan link `…/exec?page=toko` lewat WhatsApp, Instagram, Google Maps atau QR di etalase.

- Pelanggan melihat katalog (cari & kategori), harga eceran/paket/grosir, status stok, lalu **Pesan**:
  nama, nomor WhatsApp, *Ambil di warung* / *Diantar* (+ alamat), catatan.
- Harga dihitung ulang di server (harga yang dikirim browser diabaikan).
- Pesanan masuk ke menu **Pesanan WA** dengan sumber **Toko online** → *Proses di Kasir* → bayar → selesai.
- Pelanggan cek status di tab **Cek pesanan** (no. pesanan + nomor WhatsApp yang sama).
- Setelah memesan, pelanggan bisa menekan **Konfirmasi via WhatsApp** (pesan ke nomor warung).
  Bot WA **tidak** mengirim pesan otomatis ke nomor yang diketik di form, supaya tidak dipakai untuk spam.

Tidak pernah tampil di toko: harga modal, barcode, stok minimum, kasbon, laporan, data pelanggan.
Batas penyalahgunaan: maks **5 pesanan/jam per nomor** dan **60 pesanan/jam** total, maks 30 jenis barang per pesanan.

---

## 2. API dengan kunci

### Membuat kunci

Pengaturan → Akses Publik → **Buat kunci API** → beri nama → pilih hak akses:

| Hak akses | Boleh |
|---|---|
| `baca` — Baca saja | Semua aksi **baca** (produk termasuk harga modal, penjualan, pelanggan & kasbon, laporan, dashboard, ekspor, pesanan, AI). Tidak bisa mengubah apa pun. |
| `kasir` | Seperti pengguna Kasir: jual, lihat produk (tanpa harga modal), pelanggan, bayar kasbon, tutup kasir, pesanan. |
| `owner` | Semua aksi di daftar ini. |

Kunci (`kw_` + 40 karakter) **hanya tampil sekali**. Yang disimpan hanya hash-nya. Bila bocor: **Cabut**, lalu buat yang baru.

Tidak tersedia lewat API (hanya dari aplikasi): reset/muat data demo, kelola pengguna & password,
lisensi, kode rahasia bot WA, pembuatan kunci API.

### Cara memanggil

```
GET  <URL>?api=<aksi>&key=<kunci>&<parameter>=<nilai>
POST <URL>          body: {"api":"<aksi>","key":"<kunci>", ...parameter}
```

- Aksi **baca** boleh GET atau POST. Aksi yang **mengubah data wajib POST**.
- Untuk POST dari browser, pakai `Content-Type: text/plain` (isi tetap JSON) agar tidak terkena CORS preflight.
- Parameter bertingkat lewat GET boleh berupa JSON: `&items=[{"product_id":"PRD…","qty":2}]`.
- JSONP (widget di website): tambahkan `&callback=namaFungsi`.
- Apps Script membalas lewat redirect 302: aktifkan *follow redirects* (curl `-L`).
- Batas: 120 permintaan/menit per kunci.

Respon selalu JSON:

```json
{"ok": true, "data": ...}
{"ok": false, "code": "AUTH|FORBIDDEN|METHOD|INVALID|NOT_FOUND|RATE|OFF|UNKNOWN|STOCK|ERR", "error": "pesan"}
```

Daftar aksi selalu terbaru: `GET <URL>?api=bantuan` (tanpa kunci).

### Daftar aksi & parameter

Tanggal memakai format `yyyy-mm-dd`. ID: produk `PRD…`, pelanggan `PLG…`, transaksi `TRX…`, pesanan `PSN…`.

#### Produk & stok

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `produk` | GET | baca/kasir/owner | `fresh` (true = baca langsung dari sheet) |
| `produk_simpan` | POST | owner | `product_id` (kosong = baru), `name`*, `category`* (Sembako, Minuman, Rokok, Snack, Toiletries, Gas & Air, Lainnya), `unit`* (pcs, renteng, dus, kg, liter), `price_retail`*, `price_bundle`, `bundle_qty`, `price_wholesale`, `wholesale_qty`, `cost_price`, `min_stock`, `stock` (stok awal produk baru), `barcode`, `expiry_date`, `active` |
| `produk_aktif` | POST | owner | `product_id`*, `active` (true/false) |
| `produk_impor` | POST | owner | `rows`* (array objek kolom template CSV), `update_stock` |
| `stok_masuk` | POST | owner | `items`* `[{product_id, qty, cost_price, expiry_date}]`, `supplier`, `note` |
| `stok_opname` | POST | owner | `product_id`*, `actual_stock`*, `note`* |
| `stok_riwayat` | GET | owner | `limit` |

#### Penjualan

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `jual` | POST | kasir/owner | `items`* `[{product_id, qty}]`, `method`* (Tunai, QRIS, Transfer, Kasbon), `paid` (uang diterima / DP kasbon), `discount`, `customer_id` (wajib untuk Kasbon), `wa_order_id` (tutup pesanan PSN…) |
| `penjualan_hari_ini` | GET | baca/kasir/owner | – |
| `penjualan` | GET | baca/kasir/owner | `trx_id`* |
| `penjualan_batal` | POST | owner | `trx_id`*, `reason`* |
| `tutup_kasir` | GET | baca/kasir/owner | `date` |
| `tutup_kasir_simpan` | POST | kasir/owner | `date`, `opening_cash`, `counted_cash`, `note` |

#### Pelanggan & kasbon

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `pelanggan` | GET | baca/kasir/owner | – (berisi sisa kasbon & jatuh tempo) |
| `pelanggan_detail` | GET | baca/kasir/owner | `customer_id`* |
| `pelanggan_simpan` | POST | kasir/owner | `customer_id` (kosong = baru), `name`*, `phone`, `address`, `credit_limit` (owner), `notes` |
| `kasbon_bayar` | POST | kasir/owner | `customer_id`*, `amount`*, `method` (Tunai/QRIS/Transfer), `note` |
| `kasbon_awal` | POST | owner | `customer_id`*, `amount`*, `due_date`* |
| `kasbon_diingatkan` | POST | kasir/owner | `customer_id`* |

#### Laporan

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `dashboard` | GET | baca/owner | – |
| `laporan` | GET | baca/owner | `from`*, `to`* |
| `laporan_pdf` | GET | baca/owner | `from`*, `to`* |
| `ekspor` | GET | baca/owner | `sheet`* (Products, Customers, Sales, Credits, StockMoves, WaOrders, Log_Activity, Log_AI) → `{filename, csv}` |
| `aktivitas` | GET | baca/owner | `limit` |

#### Pesanan (WhatsApp & toko online)

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `pesanan` | GET | baca/kasir/owner | – |
| `pesanan_status` | POST | kasir/owner | `order_id`*, `status`* (Diproses, Selesai, Batal), `reason` |

#### AI

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `ai_saran_kulakan` | GET | baca/owner | – |
| `ai_pesan_tagih` | GET | baca/kasir/owner | `customer_id`* |
| `ai_cerita_omzet` | GET | baca/owner | – |

#### Pengaturan

| Aksi | Metode | Hak | Parameter |
|---|---|---|---|
| `pengaturan` | GET | baca/owner | – |
| `pengaturan_simpan` | POST | owner | `BUSINESS_NAME`, `BUSINESS_ADDRESS`, `WHATSAPP`, `LOGO_URL`, `TAX_PERCENT`, `KASBON_DUE_DAYS`, `EXPIRY_WARN_DAYS`, `RECEIPT_FOOTER`, `AI_ENABLED` |
| `backup` | POST | owner | – |

#### Toko (tanpa kunci)

| Aksi | Metode | Parameter |
|---|---|---|
| `toko_katalog` / `toko_info` | GET | – |
| `toko_pesan` | POST | `name`*, `phone`*, `items`* `[{product_id, qty}]`, `delivery` (Ambil/Antar), `address` (wajib bila Antar), `note` |
| `toko_status` | GET | `order_id`*, `phone`* |

`*` = wajib.

### Contoh

**curl**

```sh
URL="https://script.google.com/macros/s/AKfycb…/exec"
KEY="kw_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# daftar produk
curl -sL "$URL?api=produk&key=$KEY"

# laporan bulan ini
curl -sL "$URL?api=laporan&key=$KEY&from=2026-10-01&to=2026-10-31"

# transaksi tunai (POST)
curl -sL -H "Content-Type: text/plain" -d '{"api":"jual","key":"'$KEY'","items":[{"product_id":"PRD261008-004","qty":2}],"method":"Tunai","paid":10000}' "$URL"

# pesanan dari website sendiri (tanpa kunci)
curl -sL -H "Content-Type: text/plain" -d '{"api":"toko_pesan","name":"Rina","phone":"085712345678","items":[{"product_id":"PRD261008-004","qty":5}],"delivery":"Ambil"}' "$URL"
```

**JavaScript (browser / Node)**

```js
const URL = 'https://script.google.com/macros/s/AKfycb…/exec';
const KEY = 'kw_…';
const call = async (api, params = {}, write = false) => {
  const res = write
    ? await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ api, key: KEY, ...params }) })
    : await fetch(URL + '?' + new URLSearchParams({ api, key: KEY, ...params }));
  const j = await res.json();
  if (!j.ok) throw new Error(j.code + ': ' + j.error);
  return j.data;
};
const produk = await call('produk');
const nota = await call('jual', { items: [{ product_id: produk[0].product_id, qty: 1 }], method: 'Tunai', paid: 20000 }, true);
```

**Python**

```python
import requests
URL, KEY = "https://script.google.com/macros/s/AKfycb…/exec", "kw_…"
print(requests.get(URL, params={"api": "pelanggan", "key": KEY}).json())
print(requests.post(URL, data='{"api":"kasbon_bayar","key":"%s","customer_id":"PLG261008-003","amount":50000}' % KEY,
                    headers={"Content-Type": "text/plain"}).json())
```

**Google Sheets (Apps Script di sheet lain)**

```js
function stokMenipis() {
  const url = 'https://script.google.com/macros/s/AKfycb…/exec?api=dashboard&key=kw_…';
  const d = JSON.parse(UrlFetchApp.fetch(url).getContentText()).data;
  Logger.log(d);
}
```

**n8n / Zapier / Make**: node *HTTP Request* → Method GET/POST → URL web app →
Query/Body sesuai tabel di atas → aktifkan *Follow redirects*. Untuk POST pilih body *Raw* / *JSON* dengan Content-Type `text/plain`.

---

## Keamanan

- Kunci = password. Jangan ditaruh di website publik kecuali kunci **baca** yang memang boleh dilihat orang (data tetap terbaca semua!). Untuk website pelanggan, pakai aksi `toko_*` yang tidak butuh kunci.
- Setiap permintaan API berjalan dengan hak akses kunci dan pemeriksaan yang sama dengan aplikasi (validasi, stok, limit kasbon, anti rumus spreadsheet).
- Semua perubahan tercatat di Log aktivitas dengan pengguna `api:<id kunci>`; penjualan tercatat atas nama `API <nama kunci>`.
- Matikan seluruh API atau toko kapan saja di Pengaturan → Akses Publik.

© 2026 KasirWarung AI · Made by Piyu
