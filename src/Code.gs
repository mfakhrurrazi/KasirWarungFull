/**
 * KasirWarung AI — Code.gs
 * Web app routing (doGet ?page=), authentication, role checks and the
 * CRUD API called from the browser with google.script.run.
 *
 * Every api* function checks the session AND the role on the server
 * through run_(token, permission, fn) — never only in the menu.
 * Functions ending with "_" are private and cannot be called from the browser.
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const APP = {
  NAME: 'KasirWarung AI',
  VERSION: '1.0.0',
  MAKER: 'Piyu',
  YEAR: 2026,
  SESSION_HOURS: 8,
  TRIAL_DAYS: 30
};

const PAGES = ['login', 'setup', 'dashboard', 'kasir', 'pesanan', 'produk', 'stok', 'pelanggan', 'laporan',
  'pengaturan', 'panduan', 'lisensi', 'tentang', 'syarat', 'privasi'];

/** Permission → roles allowed. Owner = everything, Kasir = sales, customers, view stock. */
const PERMS = {
  'base': ['Owner', 'Kasir'],
  'pos.sell': ['Owner', 'Kasir'],
  'pos.closing': ['Owner', 'Kasir'],
  'product.view': ['Owner', 'Kasir'],
  'product.edit': ['Owner'],
  'stock.in': ['Owner'],
  'customer.view': ['Owner', 'Kasir'],
  'customer.edit': ['Owner', 'Kasir'],
  'credit.pay': ['Owner', 'Kasir'],
  'credit.admin': ['Owner'],
  'dashboard': ['Owner'],
  'report': ['Owner'],
  'sale.void': ['Owner'],
  'settings': ['Owner'],
  'users': ['Owner'],
  'ai.owner': ['Owner'],
  'ai.reminder': ['Owner', 'Kasir'],
  'wa.order': ['Owner', 'Kasir'],
  'license.edit': ['Owner']
};

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

function doGet(e) {
  const requested = e && e.parameter && e.parameter.page ? String(e.parameter.page).toLowerCase() : '';
  const page = PAGES.indexOf(requested) >= 0 ? requested : '';
  const tpl = HtmlService.createTemplate(htmlSource_('Index'));
  const boot = bootInfo_();
  boot.page = page;
  boot.appUrl = ScriptApp.getService().getUrl();
  tpl.bootJson = safeJsonForHtml_(boot);
  return tpl.evaluate()
    .setTitle(APP.NAME + ' — ' + (boot.business.name || 'Kasir Warung'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/**
 * Webhook for the WhatsApp bot (wa-bot/). Anonymous POST, authenticated by
 * the shared secret inside the body — see WhatsApp.gs.
 */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {}; } catch (err) { body = {}; }
  let out;
  try {
    out = body.kw === 'wa' ? waWebhook_(body) : { ok: false, error: 'Permintaan tidak dikenal.' };
  } catch (err) {
    console.error((err && err.stack) || err);
    out = { ok: false, error: 'Server error: ' + ((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out, jsonReplacer_)).setMimeType(ContentService.MimeType.JSON);
}

/** Server-side include for HTML partials: <?!= include('Page_Kasir'); ?> */
function include(filename) {
  return htmlSource_(String(filename));
}

/**
 * HTML source of a page/partial. In the 2-file "all-in-one" install
 * (dist/KasirWarung_2_Tampilan.gs) the pages live in KW_BUNDLED_HTML;
 * in the normal 24-file install they are real HTML files.
 */
function htmlSource_(name) {
  if (typeof KW_BUNDLED_HTML !== 'undefined' && Object.prototype.hasOwnProperty.call(KW_BUNDLED_HTML, name)) {
    return KW_BUNDLED_HTML[name];
  }
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function safeJsonForHtml_(obj) {
  return JSON.stringify(obj, jsonReplacer_)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Public, non-sensitive info needed before login (branding, setup state). */
function bootInfo_() {
  const info = {
    app: { name: APP.NAME, version: APP.VERSION, maker: APP.MAKER, year: APP.YEAR, supportWa: supportWa_() },
    dbReady: false, setupDone: false,
    business: { name: 'KasirWarung AI', logo: '', address: '', whatsapp: '' },
    license: licenseStatus_()
  };
  if (!isDbReady_()) return info;
  info.dbReady = true;
  try {
    const s = getSettings_();
    info.setupDone = !!s.SETUP_DONE;
    info.business = { name: s.BUSINESS_NAME, logo: safeUrl_(s.LOGO_URL), address: s.BUSINESS_ADDRESS, whatsapp: s.WHATSAPP };
  } catch (e) {
    info.dbReady = false;
    info.dbError = e.message;
  }
  return info;
}

function supportWa_() {
  return String(props_().getProperty('SUPPORT_WA') || '').replace(/[^\d]/g, '');
}

function safeUrl_(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}

/* ------------------------------------------------------------------ */
/* Response helpers                                                    */
/* ------------------------------------------------------------------ */

function jsonReplacer_(k, v) {
  const raw = this[k];
  if (raw instanceof Date) return Utilities.formatDate(raw, TZ, "yyyy-MM-dd'T'HH:mm:ss");
  return v;
}

function ok_(data) {
  return JSON.stringify({ ok: true, data: data === undefined ? null : data }, jsonReplacer_);
}

function fail_(e) {
  const code = (e && e.code) || 'ERR';
  if (!e || !e.code) console.error((e && e.stack) || e);
  const msg = e && e.code ? e.message : 'Terjadi kesalahan di server: ' + ((e && e.message) || e);
  return JSON.stringify({ ok: false, code: code, error: msg });
}

/** Auth + role check + error wrapping for every browser-callable function. */
function run_(token, perm, fn) {
  try {
    const s = auth_(token, perm);
    return ok_(fn(s));
  } catch (e) {
    return fail_(e);
  }
}

/* ------------------------------------------------------------------ */
/* Sessions (CacheService, 8 hours)                                    */
/* ------------------------------------------------------------------ */

function can_(role, perm) {
  const allowed = PERMS[perm];
  return !!allowed && allowed.indexOf(role) >= 0;
}

function permsFor_(role) {
  const out = {};
  Object.keys(PERMS).forEach(function (p) { out[p] = can_(role, p); });
  return out;
}

/**
 * CacheService allows max 6 h per entry, so the session is renewed on each
 * call (sliding) while an absolute 8-hour expiry is enforced via s.exp.
 */
function auth_(token, perm) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) {
    throw appError_('AUTH', 'Silakan login terlebih dahulu.');
  }
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) throw appError_('AUTH', 'Sesi Anda sudah berakhir. Silakan login lagi.');
  const s = JSON.parse(raw);
  const now = Date.now();
  if (now > s.exp) {
    cache.remove('sess_' + token);
    throw appError_('AUTH', 'Sesi 8 jam sudah habis. Silakan login lagi.');
  }
  const revoked = Number(props_().getProperty('REVOKE_' + s.username) || 0);
  if (revoked && revoked > s.iat) {
    cache.remove('sess_' + token);
    throw appError_('AUTH', 'Akun Anda diubah oleh pemilik. Silakan login lagi.');
  }
  cache.put('sess_' + token, raw, Math.max(60, Math.min(21600, Math.floor((s.exp - now) / 1000))));
  if (perm && !can_(s.role, perm)) {
    throw appError_('FORBIDDEN', 'Maaf, fitur ini hanya untuk ' + PERMS[perm].join(' / ') + '.');
  }
  return s;
}

function revokeUser_(username) {
  props_().setProperty('REVOKE_' + username, String(Date.now()));
}

function sessionPayload_(s) {
  const st = getSettings_();
  return {
    token: s.token,
    user: { username: s.username, full_name: s.full_name, role: s.role },
    perms: permsFor_(s.role),
    expiresAt: s.exp,
    settings: publicSettings_(st),
    setupDone: !!st.SETUP_DONE,
    license: licenseStatus_(),
    ai: { enabled: !!st.AI_ENABLED, configured: aiConfigured_() },
    categories: CATEGORIES, units: UNITS, methods: METHODS
  };
}

function publicSettings_(st) {
  return {
    BUSINESS_NAME: st.BUSINESS_NAME, BUSINESS_ADDRESS: st.BUSINESS_ADDRESS, LOGO_URL: safeUrl_(st.LOGO_URL),
    WHATSAPP: st.WHATSAPP, TAX_PERCENT: num_(st.TAX_PERCENT), AI_ENABLED: !!st.AI_ENABLED,
    RECEIPT_FOOTER: st.RECEIPT_FOOTER, KASBON_DUE_DAYS: num_(st.KASBON_DUE_DAYS),
    EXPIRY_WARN_DAYS: num_(st.EXPIRY_WARN_DAYS), SETUP_DONE: !!st.SETUP_DONE
  };
}

/* ------------------------------------------------------------------ */
/* Public API (no token)                                               */
/* ------------------------------------------------------------------ */

function apiBoot() {
  try { return ok_(bootInfo_()); } catch (e) { return fail_(e); }
}

/** First-run only: creates the database when it does not exist yet. */
function apiInitDatabase() {
  try {
    if (isDbReady_()) throw appError_('FORBIDDEN', 'Database sudah siap. Silakan login.');
    const r = setupDatabase();
    logActivity_('system', 'SETUP_DB', r.id, '', 'Database dibuat dari halaman login');
    return ok_({ created: true });
  } catch (e) {
    return fail_(e);
  }
}

function apiLogin(username, password) {
  try {
    const u = vStr_(username, 'Username', { required: true, max: 40 }).toLowerCase();
    const pw = vStr_(password, 'Password', { required: true, max: 100 });
    const cache = CacheService.getScriptCache();
    const failKey = 'fail_' + u;
    const fails = Number(cache.get(failKey) || 0);
    if (fails >= 5) throw appError_('LOCKED', 'Terlalu banyak percobaan gagal. Coba lagi 15 menit lagi.');

    const t = readTable_('Users');
    const row = t.rows.filter(function (r) { return String(r.username).toLowerCase() === u; })[0];
    const valid = row && isTrue_(row.active) && hashPassword_(pw, String(row.salt)) === String(row.password_hash);
    if (!valid) {
      cache.put(failKey, String(fails + 1), 900);
      logActivity_(u, 'LOGIN_GAGAL', '', '', '');
      throw appError_('LOGIN', 'Username atau password salah' + (row && !isTrue_(row.active) ? ' (akun nonaktif).' : '.'));
    }
    cache.remove(failKey);
    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 48);
    const now = Date.now();
    const s = {
      token: token, username: String(row.username), full_name: String(row.full_name || row.username),
      role: ROLES.indexOf(String(row.role)) >= 0 ? String(row.role) : 'Kasir',
      iat: now, exp: now + APP.SESSION_HOURS * 3600 * 1000
    };
    cache.put('sess_' + token, JSON.stringify(s), 21600);
    logActivity_(s.username, 'LOGIN', '', '', { role: s.role });
    return ok_(sessionPayload_(s));
  } catch (e) {
    return fail_(e);
  }
}

/**
 * Jalankan dari editor Apps Script (pilih "bukaKunciLogin" → Run) untuk
 * membuka kunci login setelah 5x salah password, tanpa menunggu 15 menit.
 * Hanya bekerja untuk pemilik script: pengunjung web app (anonim / akun lain)
 * ditolak, jadi fungsi ini tidak bisa dipakai untuk menebak password.
 */
function bukaKunciLogin() {
  const me = Session.getEffectiveUser().getEmail();
  const caller = Session.getActiveUser().getEmail();
  if (!me || caller !== me) throw new Error('Hanya pemilik script yang boleh membuka kunci login (jalankan dari editor).');
  const names = readTable_('Users').rows.map(function (r) { return 'fail_' + String(r.username).toLowerCase(); });
  CacheService.getScriptCache().removeAll(names);
  logActivity_(me, 'BUKA_KUNCI_LOGIN', '', '', names.length + ' akun');
  Logger.log('Kunci login dibuka untuk ' + names.length + ' akun. Silakan login lagi.');
  return names.length;
}

/* ------------------------------------------------------------------ */
/* Session & account                                                   */
/* ------------------------------------------------------------------ */

function apiMe(token) {
  return run_(token, 'base', function (s) {
    const p = sessionPayload_(s);
    p.token = token;
    return p;
  });
}

function apiLogout(token) {
  return run_(token, 'base', function (s) {
    CacheService.getScriptCache().remove('sess_' + token);
    logActivity_(s.username, 'LOGOUT', '', '', '');
    return true;
  });
}

function apiChangePassword(token, oldPw, newPw) {
  return run_(token, 'base', function (s) {
    const o = vStr_(oldPw, 'Password lama', { required: true, max: 100 });
    const n = vStr_(newPw, 'Password baru', { required: true, max: 100 });
    if (n.length < 6) throw appError_('INVALID', 'Password baru minimal 6 karakter.');
    return withLock_(function () {
      const t = readTable_('Users');
      const row = findRow_(t, 'username', s.username);
      if (!row || hashPassword_(o, String(row.salt)) !== String(row.password_hash)) {
        throw appError_('INVALID', 'Password lama salah.');
      }
      row.salt = newSalt_();
      row.password_hash = hashPassword_(n, row.salt);
      rewriteRows_(t, [row]);
      logActivity_(s.username, 'GANTI_PASSWORD', s.username, '', '');
      return true;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Setup wizard & settings                                             */
/* ------------------------------------------------------------------ */

function cleanSettings_(p) {
  const out = {};
  if ('BUSINESS_NAME' in p) out.BUSINESS_NAME = vStr_(p.BUSINESS_NAME, 'Nama usaha', { required: true, max: 60, single: true });
  if ('BUSINESS_ADDRESS' in p) out.BUSINESS_ADDRESS = vStr_(p.BUSINESS_ADDRESS, 'Alamat', { max: 160, single: true });
  if ('LOGO_URL' in p) {
    const u = vStr_(p.LOGO_URL, 'URL logo', { max: 500 });
    if (u && !safeUrl_(u)) throw appError_('INVALID', 'URL logo harus diawali https:// (contoh: link gambar Google Drive publik).');
    out.LOGO_URL = u;
  }
  if ('WHATSAPP' in p) out.WHATSAPP = vPhone_(p.WHATSAPP, 'Nomor WhatsApp usaha');
  if ('TAX_PERCENT' in p) out.TAX_PERCENT = vNum_(p.TAX_PERCENT, 'Pajak (%)', { min: 0, max: 15 });
  if ('AI_ENABLED' in p) out.AI_ENABLED = vBool_(p.AI_ENABLED);
  if ('RECEIPT_FOOTER' in p) out.RECEIPT_FOOTER = vStr_(p.RECEIPT_FOOTER, 'Catatan struk', { max: 160, single: true });
  if ('KASBON_DUE_DAYS' in p) out.KASBON_DUE_DAYS = vNum_(p.KASBON_DUE_DAYS, 'Jatuh tempo kasbon (hari)', { min: 1, max: 90, int: true });
  if ('EXPIRY_WARN_DAYS' in p) out.EXPIRY_WARN_DAYS = vNum_(p.EXPIRY_WARN_DAYS, 'Peringatan kedaluwarsa (hari)', { min: 1, max: 180, int: true });
  return out;
}

function apiSetupWizard(token, payload) {
  return run_(token, 'settings', function (s) {
    const p = payload || {};
    const settings = cleanSettings_(p.settings || {});
    const newPw = vStr_(p.new_password, 'Password baru', { max: 100 });
    if (newPw && newPw.length < 6) throw appError_('INVALID', 'Password baru minimal 6 karakter.');
    const mode = vOneOf_(p.data_mode || 'keep', ['keep', 'demo', 'empty', 'template'], 'Pilihan data awal');

    if (newPw) {
      withLock_(function () {
        const t = readTable_('Users');
        const row = findRow_(t, 'username', s.username);
        row.salt = newSalt_();
        row.password_hash = hashPassword_(newPw, row.salt);
        rewriteRows_(t, [row]);
      });
    }
    if (vBool_(p.disable_demo_kasir)) {
      withLock_(function () {
        const t = readTable_('Users');
        const row = findRow_(t, 'username', 'kasir');
        if (row && isTrue_(row.active)) { row.active = false; rewriteRows_(t, [row]); revokeUser_('kasir'); }
      });
    }
    let imported = null;
    if (mode === 'demo') loadDemoData_(s.username);
    else if (mode === 'empty') resetData_(s.username, false);
    else if (mode === 'template') {
      resetData_(s.username, false);
      imported = importProducts_(s, templateRows_());
    }
    settings.SETUP_DONE = true;
    saveSettings_(settings);
    logActivity_(s.username, 'SETUP_WIZARD', '', '', { data_mode: mode });
    const out = sessionPayload_(s);
    out.token = token;
    out.imported = imported;
    return out;
  });
}

function apiGetSettings(token) {
  return run_(token, 'settings', function () {
    const st = getSettings_();
    return { settings: publicSettings_(st), ai: aiStatus_(), backup: backupStatus_(), dbUrl: db_().getUrl() };
  });
}

function apiSaveSettings(token, payload) {
  return run_(token, 'settings', function (s) {
    const clean = cleanSettings_(payload || {});
    saveSettings_(clean);
    logActivity_(s.username, 'PENGATURAN', '', '', Object.keys(clean).join(', '));
    return publicSettings_(getSettings_());
  });
}

/* ------------------------------------------------------------------ */
/* Users (owner)                                                       */
/* ------------------------------------------------------------------ */

function apiUsers(token) {
  return run_(token, 'users', function () {
    return readTable_('Users').rows.map(function (r) {
      return { username: String(r.username), full_name: String(r.full_name || ''), role: String(r.role), active: isTrue_(r.active) };
    });
  });
}

function apiSaveUser(token, payload) {
  return run_(token, 'users', function (s) {
    const p = payload || {};
    const username = vStr_(p.username, 'Username', { required: true, max: 30, pattern: /^[a-z0-9._]{3,30}$/, hint: 'Gunakan huruf kecil, angka, titik atau garis bawah (3–30).' }).toLowerCase();
    const fullName = vStr_(p.full_name, 'Nama lengkap', { required: true, max: 60, single: true });
    const role = vOneOf_(p.role, ROLES, 'Peran');
    const active = vBool_(p.active);
    const pw = vStr_(p.password, 'Password', { max: 100 });
    if (pw && pw.length < 6) throw appError_('INVALID', 'Password minimal 6 karakter.');
    return withLock_(function () {
      const t = readTable_('Users');
      const row = findRow_(t, 'username', username);
      if (!row) {
        if (!pw) throw appError_('INVALID', 'Password wajib diisi untuk pengguna baru.');
        appendRows_(t, [userRow_(username, pw, role, fullName, active)]);
        logActivity_(s.username, 'USER_TAMBAH', username, '', { role: role });
        return true;
      }
      if (username === s.username && (!active || role !== 'Owner')) {
        throw appError_('INVALID', 'Anda tidak bisa menonaktifkan atau menurunkan peran akun sendiri.');
      }
      const owners = t.rows.filter(function (r) { return r.role === 'Owner' && isTrue_(r.active) && r.username !== username; });
      if (row.role === 'Owner' && (role !== 'Owner' || !active) && !owners.length) {
        throw appError_('INVALID', 'Minimal harus ada satu Owner yang aktif.');
      }
      row.full_name = fullName; row.role = role; row.active = active;
      if (pw) { row.salt = newSalt_(); row.password_hash = hashPassword_(pw, row.salt); }
      rewriteRows_(t, [row]);
      revokeUser_(username);
      logActivity_(s.username, 'USER_UBAH', username, '', { role: role, active: active, reset_password: !!pw });
      return true;
    });
  });
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

function apiProducts(token, fresh) {
  return run_(token, 'product.view', function (s) {
    return productsForRole_(s.role, vBool_(fresh));
  });
}

function cleanProduct_(p) {
  const out = {
    barcode: vStr_(p.barcode, 'Barcode', { max: 32, pattern: /^[0-9A-Za-z][0-9A-Za-z\-]*$/, hint: 'Hanya huruf, angka dan tanda minus.' }),
    name: vStr_(p.name, 'Nama produk', { required: true, max: 120, single: true }),
    category: vOneOf_(p.category, CATEGORIES, 'Kategori'),
    unit: vOneOf_(p.unit, UNITS, 'Satuan'),
    price_retail: vNum_(p.price_retail, 'Harga eceran', { required: true, min: 1, max: 100000000 }),
    price_bundle: vNum_(p.price_bundle, 'Harga paket', { min: 0, max: 100000000 }),
    bundle_qty: vNum_(p.bundle_qty, 'Jumlah paket', { min: 0, max: 100000 }),
    price_wholesale: vNum_(p.price_wholesale, 'Harga grosir', { min: 0, max: 100000000 }),
    wholesale_qty: vNum_(p.wholesale_qty, 'Jumlah grosir', { min: 0, max: 100000 }),
    cost_price: vNum_(p.cost_price, 'Harga modal', { min: 0, max: 100000000 }),
    min_stock: vNum_(p.min_stock, 'Stok minimum', { min: 0, max: 1000000 }),
    expiry_date: vDate_(p.expiry_date, 'Tanggal kedaluwarsa'),
    active: p.active === undefined ? true : vBool_(p.active)
  };
  if (out.price_bundle > 0 && out.bundle_qty < 2) throw appError_('INVALID', 'Isi "Jumlah paket" minimal 2 bila ada harga paket.');
  if (out.price_wholesale > 0 && out.wholesale_qty < 2) throw appError_('INVALID', 'Isi "Jumlah grosir" minimal 2 bila ada harga grosir.');
  if (out.price_bundle > out.price_retail) throw appError_('INVALID', 'Harga paket per satuan tidak boleh lebih mahal dari harga eceran.');
  if (out.price_wholesale > out.price_retail) throw appError_('INVALID', 'Harga grosir per satuan tidak boleh lebih mahal dari harga eceran.');
  if (out.price_bundle === 0) out.bundle_qty = 0;
  if (out.price_wholesale === 0) out.wholesale_qty = 0;
  return out;
}

function apiSaveProduct(token, payload) {
  return run_(token, 'product.edit', function (s) {
    const p = payload || {};
    const clean = cleanProduct_(p);
    const initialStock = vNum_(p.stock, 'Stok awal', { min: 0, max: 1000000 });
    const id = p.product_id ? vId_(p.product_id, 'PRD', 'ID produk') : '';
    const result = withLock_(function () {
      const t = readTable_('Products');
      if (clean.barcode) {
        const dup = t.rows.filter(function (r) { return String(r.barcode) === clean.barcode && String(r.product_id) !== id; })[0];
        if (dup) throw appError_('INVALID', 'Barcode sudah dipakai oleh "' + dup.name + '".');
      }
      if (!id) {
        const row = Object.assign({ product_id: idGen_(t, 'product_id', 'PRD')(), stock: initialStock }, clean);
        appendRows_(t, [row]);
        if (initialStock > 0) {
          const tm = meta_('StockMoves');
          appendRows_(tm, [{ move_id: idGen_(tm, 'move_id', 'STK')(), date: new Date(), product_id: row.product_id, type: 'AWAL', qty: initialStock, cost_price: clean.cost_price, note: 'Stok awal produk baru', user: s.username }]);
        }
        logActivity_(s.username, 'PRODUK_TAMBAH', row.product_id, '', row.name);
        return row;
      }
      const row = findRow_(t, 'product_id', id);
      if (!row) throw appError_('NOT_FOUND', 'Produk tidak ditemukan.');
      Object.assign(row, clean);
      rewriteRows_(t, [row]);
      logActivity_(s.username, 'PRODUK_UBAH', id, '', row.name);
      return row;
    });
    invalidateProducts_();
    const warn = clean.cost_price > clean.price_retail ? 'Perhatian: harga modal lebih tinggi dari harga jual.' : '';
    return { product: productOut_(result), warning: warn };
  });
}

function apiSetProductActive(token, productId, active) {
  return run_(token, 'product.edit', function (s) {
    const id = vId_(productId, 'PRD', 'ID produk');
    withLock_(function () {
      const t = readTable_('Products');
      const row = findRow_(t, 'product_id', id);
      if (!row) throw appError_('NOT_FOUND', 'Produk tidak ditemukan.');
      row.active = vBool_(active);
      rewriteRows_(t, [row]);
      logActivity_(s.username, row.active ? 'PRODUK_AKTIF' : 'PRODUK_NONAKTIF', id, '', row.name);
    });
    invalidateProducts_();
    return true;
  });
}

function apiTemplateCsv(token) {
  return run_(token, 'product.edit', function () {
    return { filename: 'Template_Produk_Warung_300.csv', csv: GROCERY_TEMPLATE_CSV.trim() + '\n' };
  });
}

function apiImportProducts(token, rows, updateStock) {
  return run_(token, 'product.edit', function (s) {
    if (!Array.isArray(rows)) throw appError_('INVALID', 'Data CSV tidak valid.');
    if (rows.length > 2000) throw appError_('INVALID', 'Maksimal 2.000 baris per impor.');
    return importProducts_(s, rows, vBool_(updateStock));
  });
}

/** Parses the bundled 300-item template into row objects. */
function templateRows_() {
  const lines = GROCERY_TEMPLATE_CSV.trim().split(/\r?\n/);
  const head = lines.shift().split(',');
  return lines.map(function (l) {
    const cols = parseCsvLine_(l);
    const o = {};
    head.forEach(function (h, i) { o[h.trim()] = cols[i]; });
    return o;
  });
}

function parseCsvLine_(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (q) {
      if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Upsert by barcode (or by name when barcode is empty). Batch writes.
 * Stock of EXISTING products only changes when updateStock is true
 * (recorded as an OPNAME move); new products start with the CSV stock.
 */
function importProducts_(s, rows, updateStock) {
  const errors = [];
  const cleaned = [];
  rows.forEach(function (raw, i) {
    const r = {};
    Object.keys(raw || {}).forEach(function (k) { r[String(k).trim().toLowerCase()] = raw[k]; });
    if (!r.name && !r.barcode) return;
    try {
      if (!r.category) r.category = 'Lainnya';
      if (!r.unit) r.unit = 'pcs';
      const c = cleanProduct_(r);
      const hasStock = r.stock !== undefined && String(r.stock).trim() !== '';
      c._stock = hasStock ? vNum_(r.stock, 'Stok', { min: 0, max: 1000000 }) : null;
      c._line = i + 2;
      cleaned.push(c);
    } catch (e) {
      errors.push({ line: i + 2, name: String(r.name || r.barcode || ''), error: e.message });
    }
  });

  const res = withLock_(function () {
    const t = readTable_('Products');
    const byBarcode = {}, byName = {};
    t.rows.forEach(function (r) {
      if (r.barcode) byBarcode[String(r.barcode)] = r;
      byName[String(r.name).toLowerCase()] = r;
    });
    const gen = idGen_(t, 'product_id', 'PRD');
    const tm = meta_('StockMoves');
    const genMove = idGen_(tm, 'move_id', 'STK');
    const adds = [], updates = [], moves = [];
    const now = new Date();
    const seen = {};
    cleaned.forEach(function (c) {
      const key = c.barcode ? 'b:' + c.barcode : 'n:' + c.name.toLowerCase();
      if (seen[key]) { errors.push({ line: c._line, name: c.name, error: 'Duplikat di file CSV (baris ' + seen[key] + ').' }); return; }
      seen[key] = c._line;
      const existing = (c.barcode && byBarcode[c.barcode]) || byName[c.name.toLowerCase()];
      const stock = c._stock;
      delete c._stock; delete c._line;
      if (existing) {
        const before = num_(existing.stock);
        Object.assign(existing, c);
        if (updateStock && stock !== null && stock !== before) {
          existing.stock = stock;
          moves.push({ move_id: genMove(), date: now, product_id: existing.product_id, type: 'OPNAME', qty: stock - before, cost_price: c.cost_price, note: 'Impor CSV', user: s.username });
        }
        updates.push(existing);
      } else {
        const row = Object.assign({ product_id: gen(), stock: stock || 0 }, c);
        adds.push(row);
        if (row.barcode) byBarcode[row.barcode] = row;
        byName[row.name.toLowerCase()] = row;
        if (row.stock > 0) moves.push({ move_id: genMove(), date: now, product_id: row.product_id, type: 'AWAL', qty: row.stock, cost_price: c.cost_price, note: 'Impor CSV', user: s.username });
      }
    });
    rewriteRows_(t, updates);
    appendRows_(t, adds);
    appendRows_(tm, moves);
    return { created: adds.length, updated: updates.length };
  });
  invalidateProducts_();
  logActivity_(s.username, 'IMPOR_PRODUK', '', '', { created: res.created, updated: res.updated, errors: errors.length });
  return { created: res.created, updated: res.updated, errors: errors.slice(0, 100), errorCount: errors.length };
}

/* ------------------------------------------------------------------ */
/* POS checkout                                                        */
/* ------------------------------------------------------------------ */

function apiCheckout(token, payload) {
  return run_(token, 'pos.sell', function (s) {
    return checkout_(s, payload || {});
  });
}

function checkout_(s, p) {
  if (!Array.isArray(p.items) || !p.items.length) throw appError_('INVALID', 'Keranjang masih kosong.');
  if (p.items.length > 300) throw appError_('INVALID', 'Maksimal 300 baris barang per transaksi.');
  const method = vOneOf_(p.method, METHODS, 'Metode bayar');
  const discount = Math.round(vNum_(p.discount, 'Diskon', { min: 0, max: 100000000 }));
  const paidIn = Math.round(vNum_(p.paid, 'Uang dibayar', { min: 0, max: 1000000000 }));
  const customerId = p.customer_id ? vId_(p.customer_id, 'PLG', 'Pelanggan') : '';
  if (method === 'Kasbon' && !customerId) throw appError_('INVALID', 'Pilih pelanggan untuk transaksi kasbon.');

  const wanted = {};
  const order = [];
  p.items.forEach(function (it) {
    const id = vId_(it && it.product_id, 'PRD', 'Produk');
    const q = vNum_(it.qty, 'Jumlah', { required: true, min: 0.001, max: 100000 });
    if (!(id in wanted)) { wanted[id] = 0; order.push(id); }
    wanted[id] = round2_(wanted[id] + q);
  });

  const settings = getSettings_();
  const result = withLock_(function () {
    const tp = readTable_('Products');
    const byId = {};
    tp.rows.forEach(function (r) { byId[String(r.product_id)] = r; });

    const items = [];
    order.forEach(function (id) {
      const r = byId[id];
      if (!r || !isTrue_(r.active)) throw appError_('INVALID', 'Produk ' + id + ' tidak ditemukan atau nonaktif.');
      const q = wanted[id];
      if ((r.unit === 'pcs' || r.unit === 'renteng' || r.unit === 'dus') && Math.floor(q) !== q) {
        throw appError_('INVALID', 'Jumlah "' + r.name + '" harus bilangan bulat.');
      }
      if (num_(r.stock) < q) {
        throw appError_('STOCK', 'Stok "' + r.name + '" tinggal ' + num_(r.stock) + ' ' + r.unit + '. Kurangi jumlah atau lakukan Stok Masuk dulu.');
      }
      const pr = unitPrice_(r, q);
      items.push({
        product_id: id, name: String(r.name), unit: String(r.unit), qty: q, price: pr.price, tier: pr.tier,
        cost: num_(r.cost_price), total: Math.round(pr.price * q)
      });
    });

    const subtotal = items.reduce(function (a, i) { return a + i.total; }, 0);
    if (discount > subtotal) throw appError_('INVALID', 'Diskon tidak boleh melebihi subtotal.');
    const taxPct = num_(settings.TAX_PERCENT);
    const tax = Math.round((subtotal - discount) * taxPct / 100);
    const total = subtotal - discount + tax;

    let paid = 0, change = 0, creditAmount = 0, customer = null, outstandingBefore = 0;
    if (method === 'Tunai') {
      if (paidIn < total) throw appError_('INVALID', 'Uang dibayar kurang ' + rupiah_(total - paidIn) + '.');
      paid = paidIn; change = paidIn - total;
    } else if (method === 'QRIS' || method === 'Transfer') {
      paid = total;
    } else {
      if (paidIn >= total) throw appError_('INVALID', 'Uang muka kasbon harus lebih kecil dari total. Gunakan metode Tunai bila dibayar penuh.');
      paid = paidIn;
      creditAmount = total - paid;
    }

    let tk = null;
    if (customerId) {
      const tc = readTable_('Customers');
      customer = findRow_(tc, 'customer_id', customerId);
      if (!customer) throw appError_('INVALID', 'Pelanggan tidak ditemukan.');
    }
    if (method === 'Kasbon') {
      tk = readTable_('Credits');
      tk.rows.forEach(function (k) {
        if (String(k.customer_id) === customerId && k.status !== 'Lunas') outstandingBefore += Math.max(0, num_(k.amount) - num_(k.paid_amount));
      });
      const limit = num_(customer.credit_limit);
      if (limit <= 0) throw appError_('LIMIT', customer.name + ' tidak diberi fasilitas kasbon (limit Rp 0).');
      if (outstandingBefore + creditAmount > limit) {
        throw appError_('LIMIT', 'Melebihi limit kasbon ' + customer.name + '. Limit ' + rupiah_(limit) + ', sisa kasbon ' +
          rupiah_(outstandingBefore) + ', sisa limit ' + rupiah_(Math.max(0, limit - outstandingBefore)) + '.');
      }
    }

    const now = new Date();
    const ts = meta_('Sales');
    const trxId = idGen_(ts, 'trx_id', 'TRX', now)();
    appendRows_(ts, [{
      trx_id: trxId, datetime: now, cashier: s.username, customer_id: customerId, items_json: JSON.stringify(items),
      subtotal: subtotal, discount: discount, total: total, paid: paid, change: change, method: method, status: 'Selesai'
    }]);

    const changed = [];
    items.forEach(function (i) {
      const r = byId[i.product_id];
      r.stock = round2_(num_(r.stock) - i.qty);
      changed.push(r);
    });
    writeColumn_(tp, 'stock', changed);

    const tm = meta_('StockMoves');
    const gm = idGen_(tm, 'move_id', 'STK', now);
    appendRows_(tm, items.map(function (i) {
      return { move_id: gm(), date: now, product_id: i.product_id, type: 'JUAL', qty: -i.qty, cost_price: i.cost, note: trxId, user: s.username };
    }));

    let credit = null;
    if (method === 'Kasbon') {
      credit = {
        credit_id: idGen_(tk, 'credit_id', 'KSB', now)(), customer_id: customerId, trx_id: trxId, amount: creditAmount,
        paid_amount: 0, due_date: addDays_(today0_(), num_(settings.KASBON_DUE_DAYS) || 14), status: 'Belum Lunas', last_reminder: ''
      };
      appendRows_(tk, [credit]);
    }

    const low = changed.filter(function (r) { return num_(r.stock) <= num_(r.min_stock); }).map(function (r) { return { name: r.name, stock: num_(r.stock), unit: r.unit }; });
    return {
      trx_id: trxId, datetime: now, cashier: s.full_name, method: method, items: items, subtotal: subtotal,
      discount: discount, tax: tax, tax_percent: taxPct, total: total, paid: paid, change: change,
      customer: customer ? { customer_id: customerId, name: String(customer.name), phone: String(customer.phone || '') } : null,
      credit: credit ? { credit_id: credit.credit_id, amount: creditAmount, due_date: credit.due_date, balance: outstandingBefore + creditAmount } : null,
      lowStock: low
    };
  });

  invalidateProducts_();
  logActivity_(s.username, 'PENJUALAN', result.trx_id, result.total, { method: method, items: result.items.length });
  result.business = receiptHeader_(settings);
  if (p.wa_order_id) {
    // Sale made from a WhatsApp order: close the order and tell the customer.
    try { result.waOrder = waSetStatus_(s, p.wa_order_id, 'Selesai', { trx_id: result.trx_id, total: result.total }); }
    catch (e) { result.waOrderError = e.message; }
  }
  return result;
}

function receiptHeader_(st) {
  return { name: st.BUSINESS_NAME, address: st.BUSINESS_ADDRESS, whatsapp: st.WHATSAPP, footer: st.RECEIPT_FOOTER };
}

function saleOut_(r, customersById) {
  let items = [];
  try { items = JSON.parse(String(r.items_json || '[]')); } catch (e) { items = []; }
  const cust = r.customer_id && customersById ? customersById[String(r.customer_id)] : null;
  const subtotal = num_(r.subtotal), discount = num_(r.discount), total = num_(r.total);
  return {
    trx_id: String(r.trx_id), datetime: r.datetime, cashier: String(r.cashier), customer_id: String(r.customer_id || ''),
    customer_name: cust ? String(cust.name) : '', items: items, subtotal: subtotal, discount: discount,
    tax: Math.max(0, total - (subtotal - discount)), total: total, paid: num_(r.paid), change: num_(r.change),
    method: String(r.method), status: String(r.status || 'Selesai')
  };
}

function customersMap_() {
  const m = {};
  readTable_('Customers').rows.forEach(function (c) { m[String(c.customer_id)] = c; });
  return m;
}

/** Today's transactions for reprinting receipts at the till. */
function apiRecentSales(token) {
  return run_(token, 'pos.sell', function () {
    const t = readTableSince_('Sales', 'datetime', today0_());
    const cm = customersMap_();
    return t.rows.map(function (r) { return saleOut_(r, cm); }).reverse().slice(0, 100);
  });
}

function apiGetSale(token, trxId) {
  return run_(token, 'pos.sell', function () {
    const id = vId_(trxId, 'TRX', 'Nomor transaksi');
    const r = findRow_(meta_('Sales'), 'trx_id', id);
    if (!r) throw appError_('NOT_FOUND', 'Transaksi tidak ditemukan.');
    const out = saleOut_(r, customersMap_());
    out.business = receiptHeader_(getSettings_());
    return out;
  });
}

/** Owner: cancel a sale, return stock and cancel an unpaid kasbon. */
function apiVoidSale(token, trxId, reason) {
  return run_(token, 'sale.void', function (s) {
    const id = vId_(trxId, 'TRX', 'Nomor transaksi');
    const why = vStr_(reason, 'Alasan pembatalan', { required: true, max: 160, single: true });
    const out = withLock_(function () {
      const ts = meta_('Sales');
      const sale = findRow_(ts, 'trx_id', id);
      if (!sale) throw appError_('NOT_FOUND', 'Transaksi tidak ditemukan.');
      if (sale.status === 'Batal') throw appError_('INVALID', 'Transaksi ini sudah dibatalkan.');
      let items = [];
      try { items = JSON.parse(String(sale.items_json || '[]')); } catch (e) { items = []; }

      let tk = null, credit = null;
      if (sale.method === 'Kasbon') {
        tk = readTable_('Credits');
        credit = findRow_(tk, 'trx_id', id);
        if (credit && num_(credit.paid_amount) > 0) {
          throw appError_('INVALID', 'Kasbon transaksi ini sudah dicicil ' + rupiah_(credit.paid_amount) + '. Selesaikan dulu di Buku Kasbon.');
        }
      }
      sale.status = 'Batal';
      rewriteRows_(ts, [sale]);

      const tp = readTable_('Products');
      const byId = {};
      tp.rows.forEach(function (r) { byId[String(r.product_id)] = r; });
      const changed = [];
      const now = new Date();
      const tm = meta_('StockMoves');
      const gm = idGen_(tm, 'move_id', 'STK', now);
      const moves = [];
      items.forEach(function (i) {
        const r = byId[i.product_id];
        if (!r) return;
        r.stock = round2_(num_(r.stock) + num_(i.qty));
        if (changed.indexOf(r) < 0) changed.push(r);
        moves.push({ move_id: gm(), date: now, product_id: i.product_id, type: 'BATAL', qty: num_(i.qty), cost_price: num_(i.cost), note: id + ' — ' + why, user: s.username });
      });
      writeColumn_(tp, 'stock', changed);
      appendRows_(tm, moves);
      if (credit) {
        credit.amount = 0; credit.status = 'Lunas';
        rewriteRows_(tk, [credit]);
      }
      return { trx_id: id, total: num_(sale.total) };
    });
    invalidateProducts_();
    logActivity_(s.username, 'BATAL_TRANSAKSI', id, out.total, why);
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* Stock in / opname                                                   */
/* ------------------------------------------------------------------ */

function apiStockIn(token, payload) {
  return run_(token, 'stock.in', function (s) {
    const p = payload || {};
    if (!Array.isArray(p.items) || !p.items.length) throw appError_('INVALID', 'Tambahkan minimal satu barang.');
    if (p.items.length > 200) throw appError_('INVALID', 'Maksimal 200 baris per nota.');
    const supplier = vStr_(p.supplier, 'Pemasok', { max: 60, single: true });
    const note = vStr_(p.note, 'Catatan', { max: 120, single: true });
    const lines = p.items.map(function (it) {
      return {
        product_id: vId_(it.product_id, 'PRD', 'Produk'),
        qty: vNum_(it.qty, 'Jumlah', { required: true, min: 0.001, max: 1000000 }),
        cost: vNum_(it.cost_price, 'Harga beli per satuan', { required: true, min: 0, max: 100000000 }),
        expiry: vDate_(it.expiry_date, 'Tanggal kedaluwarsa')
      };
    });
    const out = withLock_(function () {
      const tp = readTable_('Products');
      const byId = {};
      tp.rows.forEach(function (r) { byId[String(r.product_id)] = r; });
      const now = new Date();
      const tm = meta_('StockMoves');
      const gm = idGen_(tm, 'move_id', 'STK', now);
      const moves = [], changed = [], summary = [];
      let totalCost = 0;
      lines.forEach(function (l) {
        const r = byId[l.product_id];
        if (!r) throw appError_('INVALID', 'Produk ' + l.product_id + ' tidak ditemukan.');
        const oldStock = Math.max(0, num_(r.stock));
        const oldCost = num_(r.cost_price);
        const newAvg = oldStock + l.qty > 0 ? Math.round((oldStock * oldCost + l.qty * l.cost) / (oldStock + l.qty)) : l.cost;
        r.stock = round2_(num_(r.stock) + l.qty);
        r.cost_price = newAvg;
        if (l.expiry) r.expiry_date = l.expiry;
        if (changed.indexOf(r) < 0) changed.push(r);
        totalCost += l.qty * l.cost;
        moves.push({ move_id: gm(), date: now, product_id: l.product_id, type: 'MASUK', qty: l.qty, cost_price: l.cost, note: [supplier, note].filter(String).join(' — '), user: s.username });
        summary.push({ product_id: l.product_id, name: String(r.name), qty: l.qty, cost: l.cost, old_cost: oldCost, new_avg: newAvg, stock: r.stock });
      });
      rewriteRows_(tp, changed);
      appendRows_(tm, moves);
      return { lines: summary, total_cost: Math.round(totalCost) };
    });
    invalidateProducts_();
    logActivity_(s.username, 'STOK_MASUK', supplier, out.total_cost, { lines: out.lines.length, note: note });
    return out;
  });
}

function apiStockAdjust(token, payload) {
  return run_(token, 'stock.in', function (s) {
    const p = payload || {};
    const id = vId_(p.product_id, 'PRD', 'Produk');
    const actual = vNum_(p.actual_stock, 'Stok fisik', { required: true, min: 0, max: 1000000 });
    const note = vStr_(p.note, 'Alasan', { required: true, max: 120, single: true });
    const out = withLock_(function () {
      const tp = readTable_('Products');
      const r = findRow_(tp, 'product_id', id);
      if (!r) throw appError_('NOT_FOUND', 'Produk tidak ditemukan.');
      const delta = round2_(actual - num_(r.stock));
      if (delta === 0) return { delta: 0, stock: actual, name: String(r.name) };
      r.stock = actual;
      writeColumn_(tp, 'stock', [r]);
      const tm = meta_('StockMoves');
      appendRows_(tm, [{ move_id: idGen_(tm, 'move_id', 'STK')(), date: new Date(), product_id: id, type: 'OPNAME', qty: delta, cost_price: num_(r.cost_price), note: note, user: s.username }]);
      return { delta: delta, stock: actual, name: String(r.name) };
    });
    invalidateProducts_();
    if (out.delta) logActivity_(s.username, 'OPNAME', id, '', { delta: out.delta, note: note });
    return out;
  });
}

function apiStockMoves(token, limit) {
  return run_(token, 'stock.in', function () {
    const n = Math.min(500, Math.max(10, num_(limit) || 150));
    const t = meta_('StockMoves');
    if (t.lastRow < 2) return [];
    const count = Math.min(n, t.lastRow - 1);
    const vals = t.sheet.getRange(t.lastRow - count + 1, 1, count, t.headers.length).getValues();
    const names = {};
    productsAll_().forEach(function (p) { names[p.product_id] = p.name; });
    return rowsFromValues_(t, vals, t.lastRow - count + 1).reverse().map(function (m) {
      return {
        move_id: String(m.move_id), date: m.date, product_id: String(m.product_id), name: names[String(m.product_id)] || String(m.product_id),
        type: String(m.type), qty: num_(m.qty), cost_price: num_(m.cost_price), note: String(m.note || ''), user: String(m.user || '')
      };
    });
  });
}

/* ------------------------------------------------------------------ */
/* Customers & kasbon                                                  */
/* ------------------------------------------------------------------ */

function creditOut_(k, today) {
  const amount = num_(k.amount), paid = num_(k.paid_amount);
  const due = k.due_date instanceof Date ? k.due_date : null;
  const open = k.status !== 'Lunas' && amount - paid > 0;
  return {
    credit_id: String(k.credit_id), customer_id: String(k.customer_id), trx_id: String(k.trx_id || ''),
    created: dateFromId_(k.credit_id), amount: amount, paid_amount: paid, balance: open ? amount - paid : 0,
    due_date: due, status: String(k.status), open: open,
    days_overdue: open && due ? daysBetween_(due, today) : null,
    last_reminder: k.last_reminder instanceof Date ? k.last_reminder : null
  };
}

function customersWithBalance_() {
  const today = today0_();
  const tc = readTable_('Customers');
  const tk = readTable_('Credits');
  const agg = {};
  tk.rows.forEach(function (k) {
    const c = creditOut_(k, today);
    if (!c.open) return;
    const a = agg[c.customer_id] || (agg[c.customer_id] = { outstanding: 0, open: 0, oldest_due: null, days_overdue: null, last_reminder: null });
    a.outstanding += c.balance;
    a.open++;
    if (c.due_date && (!a.oldest_due || c.due_date < a.oldest_due)) { a.oldest_due = c.due_date; a.days_overdue = c.days_overdue; }
    if (c.last_reminder && (!a.last_reminder || c.last_reminder > a.last_reminder)) a.last_reminder = c.last_reminder;
  });
  return tc.rows.map(function (c) {
    const a = agg[String(c.customer_id)] || { outstanding: 0, open: 0, oldest_due: null, days_overdue: null, last_reminder: null };
    return {
      customer_id: String(c.customer_id), name: String(c.name), phone: String(c.phone || ''), address: String(c.address || ''),
      credit_limit: num_(c.credit_limit), notes: String(c.notes || ''), outstanding: a.outstanding, open_credits: a.open,
      oldest_due: a.oldest_due, days_overdue: a.days_overdue, last_reminder: a.last_reminder
    };
  });
}

function apiCustomers(token) {
  return run_(token, 'customer.view', function () {
    return customersWithBalance_();
  });
}

function apiCustomerDetail(token, customerId) {
  return run_(token, 'customer.view', function () {
    const id = vId_(customerId, 'PLG', 'Pelanggan');
    const all = customersWithBalance_();
    const c = all.filter(function (x) { return x.customer_id === id; })[0];
    if (!c) throw appError_('NOT_FOUND', 'Pelanggan tidak ditemukan.');
    const today = today0_();
    const credits = readTable_('Credits').rows
      .filter(function (k) { return String(k.customer_id) === id; })
      .map(function (k) { return creditOut_(k, today); })
      .sort(function (a, b) { return a.credit_id < b.credit_id ? 1 : -1; });
    const payments = readTable_('Log_Activity').rows
      .filter(function (l) { return l.action === 'KASBON_BAYAR' && String(l.ref_id) === id; })
      .map(function (l) {
        let d = {};
        try { d = JSON.parse(String(l.details || '{}')); } catch (e) { d = {}; }
        return { at: l.timestamp, amount: num_(l.amount), method: d.method || '', user: String(l.user), note: d.note || '' };
      }).reverse().slice(0, 50);
    return { customer: c, credits: credits, payments: payments };
  });
}

function apiSaveCustomer(token, payload) {
  return run_(token, 'customer.edit', function (s) {
    const p = payload || {};
    const clean = {
      name: vStr_(p.name, 'Nama pelanggan', { required: true, max: 60, single: true }),
      phone: vPhone_(p.phone, 'Nomor HP'),
      address: vStr_(p.address, 'Alamat', { max: 160, single: true }),
      notes: vStr_(p.notes, 'Catatan', { max: 200, single: true })
    };
    const limitIn = vNum_(p.credit_limit, 'Limit kasbon', { min: 0, max: 100000000 });
    const id = p.customer_id ? vId_(p.customer_id, 'PLG', 'Pelanggan') : '';
    const row = withLock_(function () {
      const t = readTable_('Customers');
      if (clean.phone) {
        const dup = t.rows.filter(function (r) { return String(r.phone) === clean.phone && String(r.customer_id) !== id; })[0];
        if (dup) throw appError_('INVALID', 'Nomor HP sudah terdaftar atas nama ' + dup.name + '.');
      }
      if (!id) {
        const r = Object.assign({ customer_id: idGen_(t, 'customer_id', 'PLG')(), credit_limit: s.role === 'Owner' ? limitIn : 0 }, clean);
        appendRows_(t, [r]);
        logActivity_(s.username, 'PELANGGAN_TAMBAH', r.customer_id, '', r.name);
        return r;
      }
      const r = findRow_(t, 'customer_id', id);
      if (!r) throw appError_('NOT_FOUND', 'Pelanggan tidak ditemukan.');
      Object.assign(r, clean);
      if (s.role === 'Owner') r.credit_limit = limitIn;
      rewriteRows_(t, [r]);
      logActivity_(s.username, 'PELANGGAN_UBAH', id, '', r.name);
      return r;
    });
    return { customer_id: String(row.customer_id), name: String(row.name), limitIgnored: s.role !== 'Owner' && limitIn > 0 };
  });
}

/** FIFO payment across the customer's open kasbon (oldest due first). */
function apiPayCredit(token, payload) {
  return run_(token, 'credit.pay', function (s) {
    const p = payload || {};
    const id = vId_(p.customer_id, 'PLG', 'Pelanggan');
    const amount = Math.round(vNum_(p.amount, 'Jumlah bayar', { required: true, min: 1, max: 100000000 }));
    const method = vOneOf_(p.method || 'Tunai', PAY_METHODS, 'Metode bayar');
    const note = vStr_(p.note, 'Catatan', { max: 120, single: true });
    const out = withLock_(function () {
      const tk = readTable_('Credits');
      const open = tk.rows.filter(function (k) {
        return String(k.customer_id) === id && k.status !== 'Lunas' && num_(k.amount) - num_(k.paid_amount) > 0;
      }).sort(function (a, b) {
        const da = a.due_date instanceof Date ? a.due_date.getTime() : 0, dbb = b.due_date instanceof Date ? b.due_date.getTime() : 0;
        return da - dbb || (a.credit_id < b.credit_id ? -1 : 1);
      });
      const outstanding = open.reduce(function (a, k) { return a + num_(k.amount) - num_(k.paid_amount); }, 0);
      if (!open.length) throw appError_('INVALID', 'Pelanggan ini tidak punya kasbon terbuka.');
      if (amount > outstanding) throw appError_('INVALID', 'Pembayaran melebihi sisa kasbon (' + rupiah_(outstanding) + ').');
      let left = amount;
      const alloc = [], changed = [];
      open.forEach(function (k) {
        if (left <= 0) return;
        const bal = num_(k.amount) - num_(k.paid_amount);
        const pay = Math.min(bal, left);
        k.paid_amount = num_(k.paid_amount) + pay;
        k.status = k.paid_amount >= num_(k.amount) ? 'Lunas' : 'Cicil';
        left -= pay;
        alloc.push({ credit_id: String(k.credit_id), amount: pay, status: k.status });
        changed.push(k);
      });
      rewriteRows_(tk, changed);
      const cust = findRow_(meta_('Customers'), 'customer_id', id);
      return { customer_id: id, name: cust ? String(cust.name) : id, paid: amount, remaining: outstanding - amount, alloc: alloc, method: method, at: new Date() };
    });
    logActivity_(s.username, 'KASBON_BAYAR', id, amount, { method: method, alloc: out.alloc, note: note });
    out.business = receiptHeader_(getSettings_());
    out.cashier = s.full_name;
    return out;
  });
}

function apiMarkReminded(token, customerId) {
  return run_(token, 'customer.view', function (s) {
    const id = vId_(customerId, 'PLG', 'Pelanggan');
    withLock_(function () {
      const tk = readTable_('Credits');
      const now = new Date();
      const changed = tk.rows.filter(function (k) { return String(k.customer_id) === id && k.status !== 'Lunas'; });
      changed.forEach(function (k) { k.last_reminder = now; });
      rewriteRows_(tk, changed);
    });
    logActivity_(s.username, 'REMINDER', id, '', 'Pengingat WA dikirim');
    return true;
  });
}

/** Owner: record an opening balance from the old paper kasbon book. */
function apiAddOpeningCredit(token, payload) {
  return run_(token, 'credit.admin', function (s) {
    const p = payload || {};
    const id = vId_(p.customer_id, 'PLG', 'Pelanggan');
    const amount = Math.round(vNum_(p.amount, 'Jumlah kasbon', { required: true, min: 1, max: 100000000 }));
    const due = vDate_(p.due_date, 'Jatuh tempo', { required: true });
    const row = withLock_(function () {
      if (!findRow_(meta_('Customers'), 'customer_id', id)) throw appError_('NOT_FOUND', 'Pelanggan tidak ditemukan.');
      const tk = readTable_('Credits');
      const r = { credit_id: idGen_(tk, 'credit_id', 'KSB')(), customer_id: id, trx_id: '', amount: amount, paid_amount: 0, due_date: due, status: 'Belum Lunas', last_reminder: '' };
      appendRows_(tk, [r]);
      return r;
    });
    logActivity_(s.username, 'KASBON_SALDO_AWAL', id, amount, row.credit_id);
    return { credit_id: row.credit_id };
  });
}

/* ------------------------------------------------------------------ */
/* Dashboard, reports, closing (see Reports.gs)                        */
/* ------------------------------------------------------------------ */

function apiDashboard(token) {
  return run_(token, 'dashboard', function () { return dashboard_(); });
}

function apiReport(token, from, to) {
  return run_(token, 'report', function () { return report_(from, to); });
}

function apiReportPdf(token, from, to) {
  return run_(token, 'report', function (s) { return reportPdf_(s, from, to); });
}

function apiClosingSummary(token, dateStr) {
  return run_(token, 'pos.closing', function () { return closingSummary_(dateStr); });
}

function apiSaveClosing(token, payload) {
  return run_(token, 'pos.closing', function (s) { return saveClosing_(s, payload || {}); });
}

function apiActivity(token, limit) {
  return run_(token, 'settings', function () {
    const n = Math.min(500, Math.max(10, num_(limit) || 150));
    const t = meta_('Log_Activity');
    if (t.lastRow < 2) return [];
    const count = Math.min(n, t.lastRow - 1);
    const vals = t.sheet.getRange(t.lastRow - count + 1, 1, count, t.headers.length).getValues();
    return rowsFromValues_(t, vals, t.lastRow - count + 1).reverse().map(function (l) {
      return { at: l.timestamp, user: String(l.user), action: String(l.action), ref_id: String(l.ref_id || ''), amount: l.amount === '' ? null : num_(l.amount), details: String(l.details || '') };
    });
  });
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

function csvCell_(v) {
  let s = v instanceof Date ? fmtDmyHm_(v).replace(' 00:00', '') : (v === null || v === undefined ? '' : String(v));
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function apiExportSheet(token, name) {
  return run_(token, 'report', function () {
    const allowed = ['Products', 'Customers', 'Sales', 'Credits', 'StockMoves', 'Log_Activity', 'Log_AI'];
    const n = vOneOf_(name, allowed, 'Sheet');
    const t = readTable_(n);
    const headers = SCHEMA[n].headers;
    const lines = [headers.join(',')];
    t.rows.forEach(function (r) { lines.push(headers.map(function (h) { return csvCell_(r[h]); }).join(',')); });
    return { filename: n + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmm') + '.csv', csv: lines.join('\n') };
  });
}

/** Saves an export (CSV/PDF) to Drive — fallback when the browser blocks downloads. */
function apiSaveToDrive(token, filename, content, mime, isBase64) {
  return run_(token, 'report', function (s) {
    const name = vStr_(filename, 'Nama file', { required: true, max: 120, pattern: /^[\w\-. ]+\.(csv|pdf)$/i });
    const type = vOneOf_(mime, ['text/csv', 'application/pdf'], 'Jenis file');
    const text = String(content || '');
    if (text.length > 15 * 1024 * 1024) throw appError_('INVALID', 'File terlalu besar.');
    const blob = isBase64 ? Utilities.newBlob(Utilities.base64Decode(text), type, name) : Utilities.newBlob(text, type, name);
    const file = exportFolder_().createFile(blob);
    logActivity_(s.username, 'EKSPOR', name, '', file.getUrl());
    return { url: file.getUrl(), name: name };
  });
}

/* ------------------------------------------------------------------ */
/* Maintenance (owner)                                                 */
/* ------------------------------------------------------------------ */

function apiLoadDemo(token, confirmText) {
  return run_(token, 'settings', function (s) {
    if (String(confirmText) !== 'DEMO') throw appError_('INVALID', 'Ketik DEMO untuk konfirmasi.');
    return loadDemoData_(s.username);
  });
}

function apiResetData(token, confirmText, keepCatalog) {
  return run_(token, 'settings', function (s) {
    if (String(confirmText) !== 'RESET') throw appError_('INVALID', 'Ketik RESET untuk konfirmasi.');
    return resetData_(s.username, vBool_(keepCatalog));
  });
}

function apiBackupNow(token) {
  return run_(token, 'settings', function (s) { return backupNow_(s.username); });
}

function apiSetBackupTrigger(token, enabled) {
  return run_(token, 'settings', function (s) {
    const st = setBackupTrigger_(vBool_(enabled));
    logActivity_(s.username, 'BACKUP_OTOMATIS', '', '', st.trigger ? 'Aktif tiap hari 23:00' : 'Nonaktif');
    return st;
  });
}

function apiRepairDatabase(token) {
  return run_(token, 'settings', function (s) {
    const r = setupDatabase();
    logActivity_(s.username, 'PERBAIKI_DB', '', '', r.created.join(', '));
    return { created: r.created, seeded: r.seeded };
  });
}

/* ------------------------------------------------------------------ */
/* Licence                                                             */
/* ------------------------------------------------------------------ */

// Shared with tools/generate-license.js (vendor side). Change both before selling.
const LICENSE_SECRET = 'KWAI-Piyu-UMKM-2026';
const LICENSE_PLANS = { STD: 'Standar', PRO: 'Pro', LIF: 'Seumur Hidup' };

function licenseSignature_(plan, exp, rand) {
  const sig = Utilities.computeHmacSha256Signature(plan + '|' + exp + '|' + rand, LICENSE_SECRET);
  return sig.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').substring(0, 8).toUpperCase();
}

/** Format: KWAI-<PLAN>-<YYYYMMDD>-<RAND6>-<SIG8>, read from Script Properties LICENSE_KEY. */
function licenseStatus_() {
  const p = props_();
  const key = String(p.getProperty('LICENSE_KEY') || '').trim().toUpperCase();
  const today = today0_();
  if (!key) {
    const inst = p.getProperty('INSTALL_DATE');
    const start = inst ? parseYmd_(inst) : today;
    const left = APP.TRIAL_DAYS - daysBetween_(start, today);
    return {
      status: left > 0 ? 'TRIAL' : 'TRIAL_END', valid: left > 0, plan: 'Trial', daysLeft: Math.max(0, left),
      label: left > 0 ? 'Trial (' + left + ' hari lagi)' : 'Trial berakhir', keyMasked: ''
    };
  }
  const m = /^KWAI-(STD|PRO|LIF)-(\d{8})-([A-Z0-9]{6})-([A-F0-9]{8})$/.exec(key);
  const masked = key.substring(0, 9) + '••••••••' + key.slice(-4);
  if (!m || licenseSignature_(m[1], m[2], m[3]) !== m[4]) {
    return { status: 'INVALID', valid: false, plan: '-', label: 'Kunci lisensi tidak valid', keyMasked: masked };
  }
  const exp = new Date(Number(m[2].substring(0, 4)), Number(m[2].substring(4, 6)) - 1, Number(m[2].substring(6, 8)));
  const left = daysBetween_(today, exp);
  const planName = LICENSE_PLANS[m[1]];
  if (m[1] !== 'LIF' && left < 0) {
    return { status: 'EXPIRED', valid: false, plan: planName, expires: exp, label: 'Lisensi ' + planName + ' kedaluwarsa', keyMasked: masked };
  }
  return {
    status: 'ACTIVE', valid: true, plan: planName, expires: m[1] === 'LIF' ? null : exp, daysLeft: m[1] === 'LIF' ? null : left,
    label: 'Aktif · ' + planName + (m[1] === 'LIF' ? '' : ' s/d ' + fmtDmy_(exp)), keyMasked: masked
  };
}

function apiLicense(token) {
  return run_(token, 'base', function () {
    return { license: licenseStatus_(), installDate: props_().getProperty('INSTALL_DATE') || '' };
  });
}

function apiSaveLicense(token, key) {
  return run_(token, 'license.edit', function (s) {
    const k = vStr_(key, 'Kunci lisensi', { required: true, max: 40 }).toUpperCase().replace(/\s/g, '');
    const m = /^KWAI-(STD|PRO|LIF)-(\d{8})-([A-Z0-9]{6})-([A-F0-9]{8})$/.exec(k);
    if (!m || licenseSignature_(m[1], m[2], m[3]) !== m[4]) throw appError_('INVALID', 'Kunci lisensi tidak valid. Periksa kembali huruf dan angkanya.');
    props_().setProperty('LICENSE_KEY', k);
    logActivity_(s.username, 'LISENSI', k.substring(0, 9), '', 'Kunci lisensi disimpan');
    return licenseStatus_();
  });
}
