/**
 * KasirWarung AI — PublicApi.gs
 * Public access, two ways:
 *
 * 1) JSON API for other apps (website, n8n, Zapier, spreadsheet, another
 *    POS…):  <web app URL>?api=<aksi>&key=<kunci API>&<parameter…>
 *    Keys are created by the owner (Pengaturan → Akses Publik) with an access
 *    level: "baca" (read everything), "kasir" or "owner". A request runs the
 *    SAME api* function the app uses, under a short-lived session with the
 *    key's role, so every permission and validation rule still applies.
 *    Read actions: GET or POST. Write actions: POST only.
 *
 * 2) Public shop (no key, no login): <web app URL>?page=toko — catalogue,
 *    online order, order status. Also available as API actions toko_*.
 *
 * Script Properties: API_KEYS (hashed keys, never the key itself),
 * PUBLIC_CONFIG (shop + API switches).
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const API_RATE_ = { perMin: 120 };
const SHOP_RATE_ = { perPhoneHour: 5, perHour: 60 };
const API_ACCESS = {
  baca: { role: 'Owner', write: false, label: 'Baca saja (semua data)' },
  kasir: { role: 'Kasir', write: true, label: 'Kasir (jual, stok lihat, pelanggan, kasbon)' },
  owner: { role: 'Owner', write: true, label: 'Owner (penuh)' }
};

/**
 * aksi → api function, parameters in order ('*' = the whole parameter object
 * as payload), write = changes data (POST only, not for "baca" keys).
 * Deliberately NOT exposed: reset/demo data, users & passwords, licence,
 * WhatsApp secret, API keys — those stay inside the app.
 */
const API_ACTIONS = {
  // Produk & stok
  produk: { fn: 'apiProducts', args: ['fresh'], info: 'Daftar produk (harga modal hanya untuk akses owner/baca)' },
  produk_simpan: { fn: 'apiSaveProduct', args: '*', write: true, info: 'Tambah/ubah produk. Tanpa product_id = produk baru' },
  produk_aktif: { fn: 'apiSetProductActive', args: ['product_id', 'active'], write: true, info: 'Aktif/nonaktifkan produk' },
  produk_impor: { fn: 'apiImportProducts', args: ['rows', 'update_stock'], write: true, info: 'Impor banyak produk (rows = array objek)' },
  stok_masuk: { fn: 'apiStockIn', args: '*', write: true, info: 'Nota stok masuk: items[{product_id, qty, cost_price, expiry_date}], supplier, note' },
  stok_opname: { fn: 'apiStockAdjust', args: '*', write: true, info: 'Opname: product_id, actual_stock, note' },
  stok_riwayat: { fn: 'apiStockMoves', args: ['limit'], info: 'Riwayat mutasi stok' },
  // Penjualan
  jual: { fn: 'apiCheckout', args: '*', write: true, info: 'Transaksi: items[{product_id, qty}], method (Tunai/QRIS/Transfer/Kasbon), paid, discount, customer_id' },
  penjualan_hari_ini: { fn: 'apiRecentSales', args: [], info: 'Transaksi hari ini' },
  penjualan: { fn: 'apiGetSale', args: ['trx_id'], info: 'Detail satu transaksi' },
  penjualan_batal: { fn: 'apiVoidSale', args: ['trx_id', 'reason'], write: true, info: 'Batalkan transaksi (stok kembali)' },
  tutup_kasir: { fn: 'apiClosingSummary', args: ['date'], info: 'Ringkasan tutup kasir (date = yyyy-mm-dd)' },
  tutup_kasir_simpan: { fn: 'apiSaveClosing', args: '*', write: true, info: 'Simpan tutup kasir' },
  // Pelanggan & kasbon
  pelanggan: { fn: 'apiCustomers', args: [], info: 'Pelanggan + sisa kasbon' },
  pelanggan_detail: { fn: 'apiCustomerDetail', args: ['customer_id'], info: 'Detail pelanggan, kasbon & pembayaran' },
  pelanggan_simpan: { fn: 'apiSaveCustomer', args: '*', write: true, info: 'Tambah/ubah pelanggan' },
  kasbon_bayar: { fn: 'apiPayCredit', args: '*', write: true, info: 'Bayar kasbon: customer_id, amount, method, note' },
  kasbon_awal: { fn: 'apiAddOpeningCredit', args: '*', write: true, info: 'Catat kasbon lama (saldo awal)' },
  kasbon_diingatkan: { fn: 'apiMarkReminded', args: ['customer_id'], write: true, info: 'Tandai sudah ditagih hari ini' },
  // Laporan
  dashboard: { fn: 'apiDashboard', args: [], info: 'KPI beranda, grafik, stok menipis' },
  laporan: { fn: 'apiReport', args: ['from', 'to'], info: 'Laporan periode (yyyy-mm-dd)' },
  laporan_pdf: { fn: 'apiReportPdf', args: ['from', 'to'], info: 'Laporan periode sebagai PDF (base64)' },
  ekspor: { fn: 'apiExportSheet', args: ['sheet'], info: 'Ekspor CSV: Products, Customers, Sales, Credits, StockMoves, WaOrders, Log_Activity, Log_AI' },
  aktivitas: { fn: 'apiActivity', args: ['limit'], info: 'Log aktivitas' },
  // Pesanan WhatsApp / toko online
  pesanan: { fn: 'apiWaOrders', args: [], info: 'Pesanan dari WhatsApp & toko online' },
  pesanan_status: { fn: 'apiWaSetStatus', args: ['order_id', 'status', 'reason'], write: true, info: 'Ubah status pesanan: Diproses / Selesai / Batal' },
  // AI
  ai_saran_kulakan: { fn: 'apiAiSaranKulakan', args: [], info: 'Saran kulakan 7 hari' },
  ai_pesan_tagih: { fn: 'apiAiPesanTagih', args: ['customer_id'], info: 'Pesan tagih halus untuk pelanggan' },
  ai_cerita_omzet: { fn: 'apiAiCeritaOmzet', args: [], info: 'Cerita omzet hari ini' },
  // Pengaturan (lihat & ubah profil warung)
  pengaturan: { fn: 'apiGetSettings', args: [], info: 'Profil warung, status AI & backup' },
  pengaturan_simpan: { fn: 'apiSaveSettings', args: '*', write: true, info: 'Ubah profil warung (BUSINESS_NAME, WHATSAPP, TAX_PERCENT, …)' },
  backup: { fn: 'apiBackupNow', args: [], write: true, info: 'Backup database ke Google Drive sekarang' }
};

/** Public shop actions: no key needed (only when the shop is switched on). */
const SHOP_ACTIONS = {
  toko_info: { fn: 'apiShopCatalog', args: [], info: 'Profil warung + katalog (tanpa harga modal)' },
  toko_katalog: { fn: 'apiShopCatalog', args: [], info: 'Sama dengan toko_info' },
  toko_pesan: { fn: 'apiShopOrder', args: '*', write: true, info: 'Pesan online: name, phone, items[{product_id, qty}], delivery (Ambil/Antar), address, note' },
  toko_status: { fn: 'apiShopStatus', args: ['order_id', 'phone'], info: 'Status pesanan (no. pesanan + nomor HP pemesan)' }
};

const PUBLIC_DEFAULTS = {
  shop: true,          // ?page=toko and toko_* actions
  shopOrders: true,    // accept online orders
  shopStock: 'status', // 'status' | 'angka' | 'sembunyi'
  shopNote: '',        // e.g. "Antar gratis radius 1 km, min. belanja Rp 50.000"
  api: true            // key-based JSON API
};

/* ------------------------------------------------------------------ */
/* Config & keys                                                       */
/* ------------------------------------------------------------------ */

function publicConfig_() {
  let c = {};
  try { c = JSON.parse(props_().getProperty('PUBLIC_CONFIG') || '{}'); } catch (e) { c = {}; }
  const out = Object.assign({}, PUBLIC_DEFAULTS, c);
  if (['status', 'angka', 'sembunyi'].indexOf(out.shopStock) < 0) out.shopStock = 'status';
  return out;
}

function apiKeys_() {
  try { const k = JSON.parse(props_().getProperty('API_KEYS') || '[]'); return Array.isArray(k) ? k : []; } catch (e) { return []; }
}

function saveApiKeys_(list) {
  props_().setProperty('API_KEYS', JSON.stringify(list));
}

function sha256Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function findApiKey_(key) {
  key = String(key || '').trim();
  if (!/^kw_[a-f0-9]{40}$/.test(key)) return null;
  const h = sha256Hex_(key);
  const list = apiKeys_();
  for (let i = 0; i < list.length; i++) if (safeEqual_(list[i].hash, h)) return list[i];
  return null;
}

function apiKeyOut_(k) {
  return { id: k.id, label: k.label, access: k.access, accessLabel: (API_ACCESS[k.access] || {}).label || k.access,
    prefix: k.prefix, created: k.created ? new Date(k.created) : null, lastUsed: k.lastUsed ? new Date(k.lastUsed) : null };
}

/* ------------------------------------------------------------------ */
/* Router (called from doGet / doPost)                                 */
/* ------------------------------------------------------------------ */

/** Merges query-string and JSON body parameters (body wins). */
function apiParams_(e, isPost) {
  const p = Object.assign({}, (e && e.parameter) || {});
  if (isPost && e && e.postData && e.postData.contents) {
    let body = null;
    try { body = JSON.parse(e.postData.contents); } catch (err) { body = null; }
    if (body && typeof body === 'object' && !Array.isArray(body)) Object.assign(p, body);
  }
  // Query-string JSON for nested parameters, e.g. &items=[{"product_id":"…","qty":2}]
  Object.keys(p).forEach(function (k) {
    const v = p[k];
    if (typeof v === 'string' && /^\s*[\[{]/.test(v)) { try { p[k] = JSON.parse(v); } catch (err) { /* keep text */ } }
  });
  return p;
}

function apiOut_(obj, callback) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj, jsonReplacer_);
  if (callback && /^[A-Za-z_$][\w$.]{0,60}$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function apiErr_(code, msg) {
  return { ok: false, code: code, error: msg };
}

/** @return {object|string} JSON-able response (string = already ok_/fail_ JSON). */
function apiRoute_(e, isPost) {
  const p = apiParams_(e, isPost);
  const action = String(p.api || '').trim().toLowerCase();
  if (!action || action === 'help' || action === 'bantuan') return { ok: true, data: apiCatalog_() };
  if (!isDbReady_()) return apiErr_('NO_DB', 'Database belum siap.');
  const cfg = publicConfig_();

  const shop = SHOP_ACTIONS[action];
  if (shop) {
    if (!cfg.shop) return apiErr_('OFF', 'Toko online sedang ditutup.');
    if (shop.write && !isPost) return apiErr_('METHOD', 'Aksi ' + action + ' harus memakai POST.');
    return apiInvoke_(shop, p, null);
  }

  const spec = API_ACTIONS[action];
  if (!spec) return apiErr_('UNKNOWN', 'Aksi "' + action + '" tidak dikenal. Lihat daftar: ?api=bantuan');
  if (!cfg.api) return apiErr_('OFF', 'API dimatikan oleh pemilik warung.');
  const k = findApiKey_(p.key);
  if (!k) return apiErr_('AUTH', 'Kunci API salah atau sudah dicabut.');
  const access = API_ACCESS[k.access];
  if (!access) return apiErr_('AUTH', 'Kunci API tidak valid.');
  if (spec.write && !access.write) return apiErr_('FORBIDDEN', 'Kunci "' + k.label + '" hanya boleh membaca data.');
  if (spec.write && !isPost) return apiErr_('METHOD', 'Aksi ' + action + ' mengubah data, harus memakai POST.');

  const cache = CacheService.getScriptCache();
  const rk = 'apirate_' + k.id + '_' + Math.floor(Date.now() / 60000);
  const n = Number(cache.get(rk) || 0) + 1;
  cache.put(rk, String(n), 120);
  if (n > API_RATE_.perMin) return apiErr_('RATE', 'Terlalu banyak permintaan (maks ' + API_RATE_.perMin + '/menit). Coba lagi sebentar.');

  // Short-lived session with the key's role: every api* function keeps its own permission checks.
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 48);
  const now = Date.now();
  cache.put('sess_' + token, JSON.stringify({
    token: token, username: 'api:' + k.id, full_name: 'API ' + k.label, role: access.role, iat: now, exp: now + 120000
  }), 120);
  try {
    return apiInvoke_(spec, p, token);
  } finally {
    cache.remove('sess_' + token);
    if (!k.lastUsed || now - k.lastUsed > 10 * 60 * 1000) {
      try {
        const list = apiKeys_();
        list.forEach(function (x) { if (x.id === k.id) x.lastUsed = now; });
        saveApiKeys_(list);
      } catch (err) { /* best effort */ }
    }
  }
}

function apiInvoke_(spec, p, token) {
  const fn = globalThis[spec.fn];
  if (typeof fn !== 'function') return apiErr_('ERR', 'Fungsi ' + spec.fn + ' tidak tersedia.');
  let args;
  if (spec.args === '*') {
    const payload = Object.assign({}, p);
    delete payload.api; delete payload.key; delete payload.callback;
    args = [payload];
  } else {
    args = spec.args.map(function (a) {
      const v = p[a];
      return v === 'true' ? true : (v === 'false' ? false : v);
    });
  }
  return token ? fn.apply(null, [token].concat(args)) : fn.apply(null, args);
}

/** Self-documenting list for ?api=bantuan. */
function apiCatalog_() {
  const list = function (o, needKey) {
    return Object.keys(o).map(function (k) {
      return { aksi: k, parameter: o[k].args === '*' ? 'objek (JSON body)' : o[k].args.join(', '), metode: o[k].write ? 'POST' : 'GET/POST',
        kunci: needKey ? (o[k].write ? 'kasir/owner' : 'baca/kasir/owner') : 'tidak perlu', keterangan: o[k].info };
    });
  };
  return {
    app: APP.NAME + ' ' + APP.VERSION,
    cara: 'GET  <url>?api=<aksi>&key=<kunci>&<parameter>=…   |   POST <url> body JSON {"api":"<aksi>","key":"<kunci>", …} (Content-Type: text/plain agar tanpa CORS preflight)',
    respon: '{"ok":true,"data":…} atau {"ok":false,"code":"…","error":"…"}',
    toko: list(SHOP_ACTIONS, false),
    aksi: list(API_ACTIONS, true)
  };
}

/* ------------------------------------------------------------------ */
/* Public shop                                                         */
/* ------------------------------------------------------------------ */

function shopStockLabel_(p, mode) {
  if (p.stock <= 0) return 'Habis';
  if (mode === 'angka') return 'Stok ' + fmtQtyWa_(p.stock) + ' ' + p.unit;
  if (mode === 'sembunyi') return '';
  return p.stock <= Math.max(p.min_stock, 0) ? 'Sisa sedikit' : 'Tersedia';
}

function apiShopCatalog() {
  try {
    const cfg = publicConfig_();
    if (!cfg.shop) throw appError_('OFF', 'Toko online sedang ditutup.');
    const st = getSettings_();
    const products = productsAll_().filter(function (p) { return p.active; }).map(function (p) {
      const o = {
        product_id: p.product_id, name: p.name, category: p.category, unit: p.unit, price_retail: p.price_retail,
        price_bundle: p.price_bundle, bundle_qty: p.bundle_qty, price_wholesale: p.price_wholesale, wholesale_qty: p.wholesale_qty,
        available: p.stock > 0, stock_label: shopStockLabel_(p, cfg.shopStock)
      };
      if (cfg.shopStock === 'angka') o.stock = p.stock;
      return o;
    });
    return ok_({
      business: { name: st.BUSINESS_NAME, address: st.BUSINESS_ADDRESS, whatsapp: st.WHATSAPP, logo: safeUrl_(st.LOGO_URL) },
      note: cfg.shopNote, orders: !!cfg.shopOrders, categories: CATEGORIES, products: products
    });
  } catch (e) { return fail_(e); }
}

function apiShopOrder(payload) {
  try {
    const cfg = publicConfig_();
    if (!cfg.shop || !cfg.shopOrders) throw appError_('OFF', 'Pesan online sedang ditutup. Silakan hubungi warung lewat WhatsApp.');
    const p = payload || {};
    if (p.website) throw appError_('INVALID', 'Permintaan ditolak.'); // honeypot field, invisible to people
    const name = vStr_(p.name, 'Nama', { required: true, max: 40, single: true });
    const phone = vPhone_(p.phone, 'Nomor WhatsApp', { required: true });
    const delivery = vOneOf_(p.delivery || 'Ambil', ['Ambil', 'Antar'], 'Pengambilan');
    const address = vStr_(p.address, 'Alamat', { required: delivery === 'Antar', max: 160, single: true });
    const note = vStr_(p.note, 'Catatan', { max: 200, single: true });
    if (!Array.isArray(p.items) || !p.items.length) throw appError_('INVALID', 'Keranjang masih kosong.');
    if (p.items.length > 30) throw appError_('INVALID', 'Maksimal 30 jenis barang per pesanan.');

    const cache = CacheService.getScriptCache();
    const hour = Math.floor(Date.now() / 3600000);
    const kp = 'shop_p_' + phone + '_' + hour, kg = 'shop_all_' + hour;
    const np = Number(cache.get(kp) || 0), ng = Number(cache.get(kg) || 0);
    if (np >= SHOP_RATE_.perPhoneHour) throw appError_('RATE', 'Nomor ini sudah memesan ' + np + ' kali dalam 1 jam. Silakan hubungi warung lewat WhatsApp.');
    if (ng >= SHOP_RATE_.perHour) throw appError_('RATE', 'Pesanan sedang ramai. Coba lagi beberapa menit lagi.');

    const byId = {};
    productsAll_().forEach(function (x) { byId[x.product_id] = x; });
    const items = [], shortStock = [];
    p.items.forEach(function (it) {
      const id = vId_(it && it.product_id, 'PRD', 'Produk');
      const q = vNum_(it.qty, 'Jumlah', { required: true, min: 0.01, max: 1000 });
      const prod = byId[id];
      if (!prod || !prod.active) throw appError_('INVALID', 'Ada barang yang sudah tidak dijual. Muat ulang halaman.');
      const same = items.find(function (x) { return x.product_id === id; });
      const qty = round2_(q + (same ? same.qty : 0));
      const up = unitPrice_(prod, qty);
      const row = { product_id: id, name: prod.name, unit: prod.unit, qty: qty, price: up.price, tier: up.tier, subtotal: Math.round(up.price * qty) };
      if (same) Object.assign(same, row); else items.push(row);
    });
    items.forEach(function (i) {
      const prod = byId[i.product_id];
      if (i.qty > prod.stock) shortStock.push(i.name + ' (sisa ' + fmtQtyWa_(Math.max(0, prod.stock)) + ' ' + prod.unit + ')');
    });
    const total = items.reduce(function (a, i) { return a + i.subtotal; }, 0);
    const extra = [delivery === 'Antar' ? 'Antar ke: ' + address : 'Ambil di warung'];
    if (note) extra.push('Catatan: ' + note);
    const row = waSaveOrder_({ name: name, phone: phone, chat: 'web', chatName: 'Toko online', isGroup: false }, items, total, [], shortStock, extra.join(' · '));
    cache.put(kp, String(np + 1), 3700);
    cache.put(kg, String(ng + 1), 3700);
    return ok_({ order_id: row.order_id, total: total, items: items, shortStock: shortStock, delivery: delivery, whatsapp: getSettings_().WHATSAPP });
  } catch (e) { return fail_(e); }
}

function apiShopStatus(orderId, phone) {
  try {
    if (!publicConfig_().shop) throw appError_('OFF', 'Toko online sedang ditutup.');
    const id = vId_(String(orderId || '').trim().toUpperCase(), 'PSN', 'No. pesanan');
    const ph = vPhone_(phone, 'Nomor WhatsApp', { required: true });
    const r = db_().getSheetByName('WaOrders') ? findRow_(meta_('WaOrders'), 'order_id', id) : null;
    if (!r || String(r.phone) !== ph) throw appError_('NOT_FOUND', 'Pesanan tidak ditemukan untuk nomor ini.');
    const o = waOrderOut_(r);
    return ok_({ order_id: o.order_id, datetime: o.datetime, status: o.status, total: o.total, trx_id: o.trx_id,
      items: o.items.map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit, subtotal: i.subtotal }; }) });
  } catch (e) { return fail_(e); }
}

/* ------------------------------------------------------------------ */
/* Owner settings (browser)                                            */
/* ------------------------------------------------------------------ */

function apiPublicGetConfig(token) {
  return run_(token, 'settings', function () {
    const url = ScriptApp.getService().getUrl() || '';
    return { config: publicConfig_(), keys: apiKeys_().map(apiKeyOut_), url: url,
      access: Object.keys(API_ACCESS).map(function (k) { return { id: k, label: API_ACCESS[k].label }; }) };
  });
}

function apiPublicSaveConfig(token, payload) {
  return run_(token, 'settings', function (s) {
    const p = payload || {};
    const cfg = {
      shop: p.shop === undefined ? PUBLIC_DEFAULTS.shop : vBool_(p.shop),
      shopOrders: p.shopOrders === undefined ? PUBLIC_DEFAULTS.shopOrders : vBool_(p.shopOrders),
      shopStock: ['status', 'angka', 'sembunyi'].indexOf(p.shopStock) >= 0 ? p.shopStock : 'status',
      shopNote: vStr_(p.shopNote, 'Catatan toko', { max: 200, single: true }),
      api: p.api === undefined ? PUBLIC_DEFAULTS.api : vBool_(p.api)
    };
    props_().setProperty('PUBLIC_CONFIG', JSON.stringify(cfg));
    logActivity_(s.username, 'AKSES_PUBLIK', '', '', cfg);
    return { config: publicConfig_() };
  });
}

/** Creates a key; the key itself is returned only this once (only its hash is stored). */
function apiPublicNewKey(token, label, access) {
  return run_(token, 'settings', function (s) {
    const name = vStr_(label, 'Nama kunci', { required: true, max: 40, single: true });
    const acc = vOneOf_(access || 'baca', Object.keys(API_ACCESS), 'Hak akses');
    const list = apiKeys_();
    if (list.length >= 20) throw appError_('INVALID', 'Maksimal 20 kunci API. Cabut kunci yang tidak dipakai.');
    const key = 'kw_' + (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 40);
    const rec = { id: Utilities.getUuid().replace(/-/g, '').substring(0, 10), label: name, access: acc, hash: sha256Hex_(key),
      prefix: key.substring(0, 9) + '…', created: Date.now(), lastUsed: 0 };
    list.push(rec);
    saveApiKeys_(list);
    logActivity_(s.username, 'KUNCI_API_BARU', rec.id, '', name + ' (' + acc + ')');
    return { key: key, item: apiKeyOut_(rec), url: ScriptApp.getService().getUrl() || '' };
  });
}

function apiPublicRevokeKey(token, id) {
  return run_(token, 'settings', function (s) {
    const list = apiKeys_();
    const k = list.filter(function (x) { return x.id === String(id); })[0];
    if (!k) throw appError_('NOT_FOUND', 'Kunci tidak ditemukan.');
    saveApiKeys_(list.filter(function (x) { return x.id !== k.id; }));
    revokeUser_('api:' + k.id);
    logActivity_(s.username, 'KUNCI_API_CABUT', k.id, '', k.label);
    return { keys: apiKeys_().map(apiKeyOut_) };
  });
}
