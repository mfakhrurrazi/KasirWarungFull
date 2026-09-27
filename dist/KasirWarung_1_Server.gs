/**
 * KasirWarung AI v1.0.0 — Kode server (1/2)
 * File hasil build (tools/build_bundle.js) — jangan diedit manual.
 * Pasang: tempel KasirWarung_1_Server.gs dan KasirWarung_2_Tampilan.gs sebagai dua file script,
 * isi appsscript.json dengan src/appsscript.json, lalu jalankan setupDatabase().
 * © 2026 KasirWarung AI · Made by Piyu
 */

// ======================= Data.gs =======================
/**
 * KasirWarung AI — Data.gs
 * Repository layer: schema, table access by header NAME (never by column
 * index), LockService writes, chunked CacheService, ID generation,
 * server-side validation and settings.
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const TZ = 'Asia/Jakarta';

const CATEGORIES = ['Sembako', 'Minuman', 'Rokok', 'Snack', 'Toiletries', 'Gas & Air', 'Lainnya'];
const UNITS = ['pcs', 'renteng', 'dus', 'kg', 'liter'];
const METHODS = ['Tunai', 'QRIS', 'Transfer', 'Kasbon'];
const PAY_METHODS = ['Tunai', 'QRIS', 'Transfer'];
const CREDIT_STATUS = ['Belum Lunas', 'Cicil', 'Lunas'];
const SALE_STATUS = ['Selesai', 'Batal'];
const MOVE_TYPES = ['AWAL', 'MASUK', 'JUAL', 'OPNAME', 'BATAL'];
const ROLES = ['Owner', 'Kasir'];

/** Column types drive number formats (dates dd/MM/yyyy, money "Rp #,##0"). */
const SCHEMA = {
  Products: {
    headers: ['product_id', 'barcode', 'name', 'category', 'unit', 'price_retail', 'price_bundle', 'bundle_qty',
      'price_wholesale', 'wholesale_qty', 'cost_price', 'stock', 'min_stock', 'expiry_date', 'active'],
    types: {
      product_id: 'text', barcode: 'text', price_retail: 'money', price_bundle: 'money', price_wholesale: 'money',
      cost_price: 'money', expiry_date: 'date', active: 'bool'
    },
    lists: { category: CATEGORIES, unit: UNITS },
    widths: { product_id: 130, barcode: 140, name: 280, category: 110, unit: 80, expiry_date: 110 }
  },
  Customers: {
    headers: ['customer_id', 'name', 'phone', 'address', 'credit_limit', 'notes'],
    types: { customer_id: 'text', phone: 'text', credit_limit: 'money' },
    lists: {},
    widths: { customer_id: 130, name: 200, phone: 140, address: 280, notes: 260 }
  },
  Sales: {
    headers: ['trx_id', 'datetime', 'cashier', 'customer_id', 'items_json', 'subtotal', 'discount', 'total', 'paid',
      'change', 'method', 'status'],
    types: {
      trx_id: 'text', datetime: 'datetime', customer_id: 'text', subtotal: 'money', discount: 'money',
      total: 'money', paid: 'money', change: 'money'
    },
    lists: { method: METHODS, status: SALE_STATUS },
    widths: { trx_id: 130, datetime: 140, items_json: 320 }
  },
  Credits: {
    headers: ['credit_id', 'customer_id', 'trx_id', 'amount', 'paid_amount', 'due_date', 'status', 'last_reminder'],
    types: {
      credit_id: 'text', customer_id: 'text', trx_id: 'text', amount: 'money', paid_amount: 'money',
      due_date: 'date', last_reminder: 'datetime'
    },
    lists: { status: CREDIT_STATUS },
    widths: { credit_id: 130, customer_id: 130, trx_id: 130, last_reminder: 140 }
  },
  StockMoves: {
    headers: ['move_id', 'date', 'product_id', 'type', 'qty', 'cost_price', 'note', 'user'],
    types: { move_id: 'text', date: 'datetime', product_id: 'text', cost_price: 'money' },
    lists: { type: MOVE_TYPES },
    widths: { move_id: 130, date: 140, product_id: 130, note: 260 }
  },
  Users: {
    headers: ['username', 'password_hash', 'salt', 'role', 'full_name', 'active'],
    types: { username: 'text', password_hash: 'text', salt: 'text', active: 'bool' },
    lists: { role: ROLES },
    widths: { password_hash: 220, salt: 150, full_name: 200 }
  },
  Settings: {
    headers: ['key', 'value'],
    types: { key: 'text' },
    lists: {},
    widths: { key: 180, value: 320 }
  },
  Log_AI: {
    headers: ['timestamp', 'user', 'feature', 'status'],
    types: { timestamp: 'datetime' },
    lists: {},
    widths: { timestamp: 140, feature: 180, status: 260 }
  },
  Log_Activity: {
    headers: ['timestamp', 'user', 'action', 'ref_id', 'amount', 'details'],
    types: { timestamp: 'datetime', ref_id: 'text', amount: 'money' },
    lists: {},
    widths: { timestamp: 140, action: 150, ref_id: 140, details: 420 }
  }
};

const NUMBER_FORMATS = {
  text: '@',
  money: '"Rp "#,##0',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  bool: 'General'
};

const SETTING_DEFAULTS = {
  BUSINESS_NAME: 'Warung Berkah Jaya',
  BUSINESS_ADDRESS: '',
  LOGO_URL: '',
  WHATSAPP: '',
  TAX_PERCENT: 0,
  AI_ENABLED: true,
  RECEIPT_FOOTER: 'Terima kasih, semoga berkah!',
  KASBON_DUE_DAYS: 14,
  EXPIRY_WARN_DAYS: 30,
  SETUP_DONE: false
};

const CACHE_KEYS = { PRODUCTS: 'products_v1', SETTINGS: 'settings_v1' };

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function appError_(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/* ------------------------------------------------------------------ */
/* Spreadsheet access                                                  */
/* ------------------------------------------------------------------ */

let SS_CACHE_ = null;

function props_() {
  return PropertiesService.getScriptProperties();
}

function db_() {
  if (SS_CACHE_) return SS_CACHE_;
  const id = props_().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw appError_('NO_DB', 'Database belum disiapkan. Tekan "Siapkan Database" di halaman login atau jalankan setupDatabase() di editor.');
  }
  try {
    SS_CACHE_ = SpreadsheetApp.openById(id);
  } catch (e) {
    throw appError_('NO_DB', 'Spreadsheet DB_KasirWarung tidak dapat dibuka. Jalankan setupDatabase() lagi. (' + e.message + ')');
  }
  return SS_CACHE_;
}

function isDbReady_() {
  try {
    if (!props_().getProperty('SPREADSHEET_ID')) return false;
    return !!db_().getSheetByName('Users');
  } catch (e) {
    return false;
  }
}

function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw appError_('NO_DB', 'Sheet "' + name + '" tidak ditemukan. Jalankan setupDatabase() untuk memperbaiki struktur.');
  return sh;
}

/**
 * Reads header row only. Returns a table descriptor with a name→index map.
 * Throws when a schema column is missing so we never write to the wrong column.
 */
function meta_(name) {
  const sh = sheet_(name);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const idx = {};
  headers.forEach(function (h, i) { if (h && !(h in idx)) idx[h] = i; });
  const need = (SCHEMA[name] && SCHEMA[name].headers) || [];
  const missing = need.filter(function (h) { return !(h in idx); });
  if (missing.length) {
    throw appError_('SCHEMA', 'Kolom hilang di sheet ' + name + ': ' + missing.join(', ') + '. Jalankan setupDatabase().');
  }
  return { name: name, sheet: sh, headers: headers, idx: idx, lastRow: sh.getLastRow(), rows: null };
}

function isBlankRow_(v) {
  for (let i = 0; i < v.length; i++) if (v[i] !== '' && v[i] !== null) return false;
  return true;
}

function rowsFromValues_(t, values, firstRow) {
  const out = [];
  for (let r = 0; r < values.length; r++) {
    const v = values[r];
    if (isBlankRow_(v)) continue;
    const o = { _row: firstRow + r };
    for (let c = 0; c < t.headers.length; c++) if (t.headers[c]) o[t.headers[c]] = v[c];
    out.push(o);
  }
  return out;
}

/** Full table read with a single getValues() call. */
function readTable_(name) {
  const t = meta_(name);
  t.rows = [];
  if (t.lastRow < 2) return t;
  const values = t.sheet.getRange(2, 1, t.lastRow - 1, t.headers.length).getValues();
  t.rows = rowsFromValues_(t, values, 2);
  return t;
}

/**
 * Reads only rows whose date column is >= fromDate. Rows are appended
 * chronologically, so we scan one column and fetch the tail block only.
 */
function readTableSince_(name, dateCol, fromDate) {
  const t = meta_(name);
  t.rows = [];
  t.partial = true;
  if (t.lastRow < 2) return t;
  const n = t.lastRow - 1;
  const col = t.sheet.getRange(2, t.idx[dateCol] + 1, n, 1).getValues();
  let start = -1;
  for (let i = 0; i < n; i++) {
    const d = col[i][0];
    if (d instanceof Date && d.getTime() >= fromDate.getTime()) { start = i; break; }
  }
  if (start < 0) return t;
  const values = t.sheet.getRange(2 + start, 1, n - start, t.headers.length).getValues();
  t.rows = rowsFromValues_(t, values, 2 + start).filter(function (r) {
    return r[dateCol] instanceof Date && r[dateCol].getTime() >= fromDate.getTime();
  });
  return t;
}

/** Finds one row by exact value of a column, reading only that column + the row. */
function findRow_(t, col, value) {
  if (t.rows) {
    const want = String(value);
    for (let i = 0; i < t.rows.length; i++) if (String(t.rows[i][col]) === want) return t.rows[i];
    return null;
  }
  if (t.lastRow < 2) return null;
  const vals = t.sheet.getRange(2, t.idx[col] + 1, t.lastRow - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(value)) {
      const rowVals = t.sheet.getRange(i + 2, 1, 1, t.headers.length).getValues();
      return rowsFromValues_(t, rowVals, i + 2)[0] || null;
    }
  }
  return null;
}

/** Prevents formula injection: strings starting with = + - @ are stored as text. */
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function toRow_(t, obj) {
  return t.headers.map(function (h) { return h ? cell_(obj[h]) : ''; });
}

function rowFormats_(t) {
  const types = (SCHEMA[t.name] && SCHEMA[t.name].types) || {};
  return t.headers.map(function (h) { return NUMBER_FORMATS[types[h]] || 'General'; });
}

/** Batch append (one setNumberFormats + one setValues). */
function appendRows_(t, objs) {
  if (!objs || !objs.length) return;
  const sh = t.sheet;
  const start = Math.max(sh.getLastRow(), 1) + 1;
  const end = start + objs.length - 1;
  const maxRows = sh.getMaxRows();
  if (end > maxRows) {
    const add = end - maxRows + 500;
    sh.insertRowsAfter(maxRows, add);
    if (typeof applyValidations_ === 'function') applyValidations_(sh, t.name, maxRows + 1, add);
  }
  const range = sh.getRange(start, 1, objs.length, t.headers.length);
  const fmt = rowFormats_(t);
  range.setNumberFormats(objs.map(function () { return fmt; }));
  range.setValues(objs.map(function (o) { return toRow_(t, o); }));
  objs.forEach(function (o, i) {
    o._row = start + i;
    if (t.rows) t.rows.push(o);
  });
  t.lastRow = end;
}

/**
 * Writes changed rows back. Few rows → one call per row; many rows →
 * one read + one write of the covering block.
 */
function rewriteRows_(t, objs) {
  if (!objs || !objs.length) return;
  const width = t.headers.length;
  if (objs.length <= 8) {
    objs.forEach(function (o) { t.sheet.getRange(o._row, 1, 1, width).setValues([toRow_(t, o)]); });
    return;
  }
  let minR = Infinity, maxR = 0;
  objs.forEach(function (o) { if (o._row < minR) minR = o._row; if (o._row > maxR) maxR = o._row; });
  const range = t.sheet.getRange(minR, 1, maxR - minR + 1, width);
  const vals = range.getValues();
  objs.forEach(function (o) { vals[o._row - minR] = toRow_(t, o); });
  range.setValues(vals);
}

/** Writes a single column for the given changed rows (one read + one write). */
function writeColumn_(t, col, changed) {
  if (!changed || !changed.length) return;
  const c = t.idx[col] + 1;
  if (changed.length === 1) {
    t.sheet.getRange(changed[0]._row, c).setValue(cell_(changed[0][col]));
    return;
  }
  let minR = Infinity, maxR = 0;
  changed.forEach(function (o) { if (o._row < minR) minR = o._row; if (o._row > maxR) maxR = o._row; });
  const range = t.sheet.getRange(minR, c, maxR - minR + 1, 1);
  const vals = range.getValues();
  changed.forEach(function (o) { vals[o._row - minR][0] = cell_(o[col]); });
  range.setValues(vals);
}

/** Deletes every data row but keeps headers, formats and validations. */
function clearData_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
}

/* ------------------------------------------------------------------ */
/* Locking                                                             */
/* ------------------------------------------------------------------ */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw appError_('BUSY', 'Server sedang menyimpan transaksi lain. Coba lagi beberapa detik lagi.');
  }
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Chunked CacheService (values > 100 KB are split)                    */
/* ------------------------------------------------------------------ */

const CACHE_CHUNK_ = 45000;

function cacheGetJSON_(key) {
  try {
    const c = CacheService.getScriptCache();
    const head = c.get(key);
    if (!head) return null;
    const h = JSON.parse(head);
    if (h.n === 0) return h.v;
    const keys = [];
    for (let i = 0; i < h.n; i++) keys.push(key + '#' + i);
    const parts = c.getAll(keys);
    let s = '';
    for (let i = 0; i < keys.length; i++) {
      if (parts[keys[i]] == null) return null;
      s += parts[keys[i]];
    }
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

function cachePutJSON_(key, obj, ttlSec) {
  try {
    const c = CacheService.getScriptCache();
    const s = JSON.stringify(obj);
    const ttl = Math.min(ttlSec || 600, 21600);
    if (s.length <= CACHE_CHUNK_) {
      c.put(key, JSON.stringify({ n: 0, v: obj }), ttl);
      return;
    }
    const map = {};
    const n = Math.ceil(s.length / CACHE_CHUNK_);
    for (let i = 0; i < n; i++) map[key + '#' + i] = s.substr(i * CACHE_CHUNK_, CACHE_CHUNK_);
    c.putAll(map, ttl);
    c.put(key, JSON.stringify({ n: n }), ttl);
  } catch (e) {
    console.warn('cachePutJSON_ gagal: ' + e.message);
  }
}

function cacheDel_(keys) {
  try { CacheService.getScriptCache().removeAll([].concat(keys)); } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* IDs: PREFIX + YYMMDD + '-' + ###                                    */
/* ------------------------------------------------------------------ */

function ymd_(d) {
  return Utilities.formatDate(d || new Date(), TZ, 'yyMMdd');
}

function idGen_(t, col, prefix, date) {
  const stem = prefix + ymd_(date) + '-';
  let vals = [];
  if (t.rows && !t.partial) {
    vals = t.rows.map(function (r) { return r[col]; });
  } else if (t.lastRow >= 2) {
    const n = Math.min(t.lastRow - 1, 3000);
    vals = t.sheet.getRange(t.lastRow - n + 1, t.idx[col] + 1, n, 1).getValues().map(function (r) { return r[0]; });
  }
  let max = 0;
  vals.forEach(function (v) {
    v = String(v || '');
    if (v.indexOf(stem) === 0) {
      const k = parseInt(v.substring(stem.length), 10);
      if (k > max) max = k;
    }
  });
  return function () {
    max++;
    return stem + (max < 1000 ? ('00' + max).slice(-3) : String(max));
  };
}

/** Recovers the creation date encoded in an ID such as KSB260926-001. */
function dateFromId_(id) {
  const m = /^[A-Z]{3}(\d{2})(\d{2})(\d{2})-/.exec(String(id || ''));
  if (!m) return null;
  return new Date(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/* ------------------------------------------------------------------ */
/* Dates & numbers                                                     */
/* ------------------------------------------------------------------ */

function parseYmd_(s) {
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function today0_() {
  return parseYmd_(Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'));
}

function dayStart_(d) {
  return parseYmd_(Utilities.formatDate(d, TZ, 'yyyy-MM-dd'));
}

function addDays_(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function ymdKey_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function fmtDmy_(d) {
  return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy') : '';
}

function fmtDmyHm_(d) {
  return d instanceof Date ? Utilities.formatDate(d, TZ, 'dd/MM/yyyy HH:mm') : '';
}

/** Whole days from a to b (b - a), both normalised to midnight. */
function daysBetween_(a, b) {
  return Math.round((dayStart_(b).getTime() - dayStart_(a).getTime()) / 86400000);
}

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === '' || v === null || v === undefined) return 0;
  const n = parseNumberID_(v);
  return isFinite(n) ? n : 0;
}

/** Parses "13.500", "Rp 1.250.000", "2,5", "2.5", 13500. */
function parseNumberID_(v) {
  if (typeof v === 'number') return v;
  let s = String(v).replace(/rp/gi, '').replace(/\s/g, '');
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (s.indexOf(',') >= 0 && s.indexOf('.') < 0) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || v === 1 || v === '1';
}

function rupiah_(n) {
  const x = Math.round(num_(n));
  const s = Math.abs(x).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (x < 0 ? '-Rp ' : 'Rp ') + s;
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Validation (every write is validated on the server)                 */
/* ------------------------------------------------------------------ */

function vStr_(v, label, o) {
  o = o || {};
  let s = (v === undefined || v === null) ? '' : String(v);
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (o.single) s = s.replace(/[\r\n\t]+/g, ' ');
  if (o.required && !s) throw appError_('INVALID', label + ' wajib diisi.');
  const max = o.max || 200;
  if (s.length > max) throw appError_('INVALID', label + ' maksimal ' + max + ' karakter.');
  if (o.pattern && s && !o.pattern.test(s)) throw appError_('INVALID', label + ' tidak valid.' + (o.hint ? ' ' + o.hint : ''));
  return s;
}

function vNum_(v, label, o) {
  o = o || {};
  if (v === '' || v === null || v === undefined) {
    if (o.required) throw appError_('INVALID', label + ' wajib diisi.');
    return o.def !== undefined ? o.def : 0;
  }
  const n = typeof v === 'number' ? v : parseNumberID_(v);
  if (!isFinite(n)) throw appError_('INVALID', label + ' harus berupa angka.');
  if (o.int && Math.floor(n) !== n) throw appError_('INVALID', label + ' harus bilangan bulat.');
  if (o.min !== undefined && n < o.min) throw appError_('INVALID', label + ' minimal ' + o.min + '.');
  if (o.max !== undefined && n > o.max) throw appError_('INVALID', label + ' maksimal ' + o.max + '.');
  return n;
}

/** Accepts yyyy-mm-dd, dd/mm/yyyy or Date. Returns a Date at midnight or ''. */
function vDate_(v, label, o) {
  o = o || {};
  if (v instanceof Date) return dayStart_(v);
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) {
    if (o.required) throw appError_('INVALID', label + ' wajib diisi.');
    return '';
  }
  let y, m, d, mt;
  if ((mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else throw appError_('INVALID', label + ' harus berformat dd/MM/yyyy.');
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d || y < 2000 || y > 2100) {
    throw appError_('INVALID', label + ' bukan tanggal yang valid.');
  }
  return dt;
}

function vOneOf_(v, list, label) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  for (let i = 0; i < list.length; i++) if (list[i].toLowerCase() === s.toLowerCase()) return list[i];
  throw appError_('INVALID', label + ' harus salah satu dari: ' + list.join(', ') + '.');
}

/** Normalises an Indonesian phone number to 62xxxxxxxxxx (wa.me format). */
function vPhone_(v, label, o) {
  o = o || {};
  let s = String(v === undefined || v === null ? '' : v).replace(/[^\d]/g, '');
  if (!s) {
    if (o.required) throw appError_('INVALID', (label || 'Nomor HP') + ' wajib diisi.');
    return '';
  }
  if (s.indexOf('0') === 0) s = '62' + s.substring(1);
  else if (s.indexOf('8') === 0) s = '62' + s;
  if (!/^62\d{8,13}$/.test(s)) throw appError_('INVALID', (label || 'Nomor HP') + ' tidak valid. Contoh: 081234567890');
  return s;
}

function vBool_(v) {
  return isTrue_(v);
}

function vId_(v, prefix, label) {
  const re = new RegExp('^' + prefix + '\\d{6}-\\d{3,6}$');
  return vStr_(v, label, { required: true, max: 20, pattern: re });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function coerceSetting_(key, v) {
  const def = SETTING_DEFAULTS[key];
  if (typeof def === 'boolean') return isTrue_(v);
  if (typeof def === 'number') { const n = num_(v); return isFinite(n) ? n : def; }
  return v === undefined || v === null ? '' : String(v);
}

function getSettings_() {
  const cached = cacheGetJSON_(CACHE_KEYS.SETTINGS);
  if (cached) return cached;
  const out = Object.assign({}, SETTING_DEFAULTS);
  const t = readTable_('Settings');
  t.rows.forEach(function (r) {
    const k = String(r.key || '').trim();
    if (k) out[k] = coerceSetting_(k, r.value);
  });
  cachePutJSON_(CACHE_KEYS.SETTINGS, out, 600);
  return out;
}

function saveSettings_(changes) {
  withLock_(function () {
    const t = readTable_('Settings');
    const byKey = {};
    t.rows.forEach(function (r) { byKey[String(r.key).trim()] = r; });
    const updates = [], adds = [];
    Object.keys(changes).forEach(function (k) {
      if (byKey[k]) { byKey[k].value = changes[k]; updates.push(byKey[k]); }
      else adds.push({ key: k, value: changes[k] });
    });
    rewriteRows_(t, updates);
    appendRows_(t, adds);
  });
  cacheDel_(CACHE_KEYS.SETTINGS);
}

/* ------------------------------------------------------------------ */
/* Products (serialised for the browser, cached)                       */
/* ------------------------------------------------------------------ */

function productOut_(r) {
  return {
    product_id: String(r.product_id || ''),
    barcode: String(r.barcode || ''),
    name: String(r.name || ''),
    category: String(r.category || 'Lainnya'),
    unit: String(r.unit || 'pcs'),
    price_retail: num_(r.price_retail),
    price_bundle: num_(r.price_bundle),
    bundle_qty: num_(r.bundle_qty),
    price_wholesale: num_(r.price_wholesale),
    wholesale_qty: num_(r.wholesale_qty),
    cost_price: num_(r.cost_price),
    stock: num_(r.stock),
    min_stock: num_(r.min_stock),
    expiry_date: r.expiry_date instanceof Date ? ymdKey_(r.expiry_date) : '',
    active: isTrue_(r.active)
  };
}

function productsAll_() {
  let list = cacheGetJSON_(CACHE_KEYS.PRODUCTS);
  if (list) return list;
  list = readTable_('Products').rows.map(productOut_);
  cachePutJSON_(CACHE_KEYS.PRODUCTS, list, 1800);
  return list;
}

function productsForRole_(role) {
  const list = productsAll_();
  if (role === 'Owner') return list;
  return list.map(function (p) {
    const c = Object.assign({}, p);
    delete c.cost_price;
    return c;
  });
}

function invalidateProducts_() {
  cacheDel_(CACHE_KEYS.PRODUCTS);
}

/** Automatic tier pricing: the cheapest eligible unit price wins. */
function unitPrice_(p, qty) {
  let price = num_(p.price_retail), tier = 'Eceran';
  const bq = num_(p.bundle_qty), bp = num_(p.price_bundle);
  const wq = num_(p.wholesale_qty), wp = num_(p.price_wholesale);
  if (bq > 0 && bp > 0 && qty >= bq && bp < price) { price = bp; tier = 'Paket'; }
  if (wq > 0 && wp > 0 && qty >= wq && wp < price) { price = wp; tier = 'Grosir'; }
  return { price: price, tier: tier };
}

/* ------------------------------------------------------------------ */
/* Activity log                                                        */
/* ------------------------------------------------------------------ */

function logActivity_(user, action, refId, amount, details) {
  try {
    const t = meta_('Log_Activity');
    let d = details === undefined || details === null ? '' : (typeof details === 'string' ? details : JSON.stringify(details));
    if (d.length > 4000) d = d.substring(0, 4000);
    appendRows_(t, [{
      timestamp: new Date(), user: user || 'system', action: action, ref_id: refId || '',
      amount: amount === undefined || amount === null || amount === '' ? '' : Number(amount), details: d
    }]);
  } catch (e) {
    console.error('logActivity_ gagal: ' + e.message);
  }
}

// ======================= Setup.gs =======================
/**
 * KasirWarung AI — Setup.gs
 * Idempotent setupDatabase(), sample/demo data, reset, protection and
 * Drive backups.
 *
 * Run setupDatabase() from the Apps Script editor (or press
 * "Siapkan Database" on the login page). Running it again never deletes
 * data: it only adds missing sheets/columns and re-applies formatting.
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const DB_NAME = 'DB_KasirWarung';
const HEADER_BG = '#F97316';

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Creates (or repairs) the spreadsheet "DB_KasirWarung".
 * Safe to run many times.
 */
function setupDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = openOrCreateDb_();
    try { ss.setSpreadsheetLocale('id_ID'); } catch (e) { /* locale optional */ }
    ss.setSpreadsheetTimeZone(TZ);

    const created = [];
    Object.keys(SCHEMA).forEach(function (name, i) {
      if (ensureSheet_(ss, name, i)) created.push(name);
    });
    removeDefaultSheets_(ss);

    const seeded = seedIfEmpty_();
    formatSettingsSheet_();
    protectSheets_(ss);

    const p = props_();
    if (!p.getProperty('INSTALL_DATE')) p.setProperty('INSTALL_DATE', ymdKey_(new Date()));

    cacheDel_([CACHE_KEYS.PRODUCTS, CACHE_KEYS.SETTINGS]);
    SpreadsheetApp.flush();

    const result = { id: ss.getId(), url: ss.getUrl(), created: created, seeded: seeded };
    Logger.log('DB_KasirWarung siap: ' + ss.getUrl() + ' | sheet baru: ' + (created.join(', ') || '-') +
      ' | data contoh: ' + (seeded.join(', ') || '-'));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/* Spreadsheet & sheet structure                                       */
/* ------------------------------------------------------------------ */

function openOrCreateDb_() {
  const p = props_();
  let ss = null;
  const id = p.getProperty('SPREADSHEET_ID');
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  }
  const home = appFolder_();
  if (!ss) {
    const it = home ? home.getFilesByName(DB_NAME) : DriveApp.getFilesByName(DB_NAME);
    while (it.hasNext()) {
      const f = it.next();
      if (!f.isTrashed() && f.getMimeType() === MimeType.GOOGLE_SHEETS) { ss = SpreadsheetApp.openById(f.getId()); break; }
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(DB_NAME, 1000, 26);
    if (home) {
      try { DriveApp.getFileById(ss.getId()).moveTo(home); } catch (e) { console.warn('Tidak bisa memindah DB ke folder aplikasi: ' + e.message); }
    }
  }
  if (ss.getName() !== DB_NAME) ss.rename(DB_NAME);
  p.setProperty('SPREADSHEET_ID', ss.getId());
  SS_CACHE_ = ss;
  return ss;
}

/** Returns true when the sheet was newly created. */
function ensureSheet_(ss, name, position) {
  const def = SCHEMA[name];
  let sh = ss.getSheetByName(name);
  const created = !sh;
  if (!sh) sh = ss.insertSheet(name, Math.min(position, ss.getSheets().length));

  const lastCol = sh.getLastColumn();
  let headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  if (headers.every(function (h) { return !h; })) headers = [];
  if (!headers.length) {
    sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers]);
    headers = def.headers.slice();
  } else {
    const missing = def.headers.filter(function (h) { return headers.indexOf(h) < 0; });
    if (missing.length) {
      if (sh.getMaxColumns() < headers.length + missing.length) {
        sh.insertColumnsAfter(sh.getMaxColumns(), headers.length + missing.length - sh.getMaxColumns());
      }
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      headers = headers.concat(missing);
    }
  }

  if (sh.getMaxRows() < 1000) sh.insertRowsAfter(sh.getMaxRows(), 1000 - sh.getMaxRows());

  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground(HEADER_BG).setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 30);
  sh.setTabColor(HEADER_BG);

  const body = sh.getMaxRows() - 1;
  headers.forEach(function (h, i) {
    const fmt = NUMBER_FORMATS[def.types[h]];
    if (fmt) sh.getRange(2, i + 1, body, 1).setNumberFormat(fmt);
    const w = (def.widths && def.widths[h]) || (def.types[h] === 'money' ? 120 : 100);
    sh.setColumnWidth(i + 1, w);
  });
  applyValidations_(sh, name, 2, body);
  return created;
}

/** Dropdowns and checkboxes. Also used when appendRows_ grows a sheet. */
function applyValidations_(sh, name, fromRow, numRows) {
  const def = SCHEMA[name];
  if (!def || numRows < 1) return;
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(function (h) { return String(h).trim(); });
  Object.keys(def.lists).forEach(function (col) {
    const i = headers.indexOf(col);
    if (i < 0) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(def.lists[col], true).setAllowInvalid(false).build();
    sh.getRange(fromRow, i + 1, numRows, 1).setDataValidation(rule);
  });
  Object.keys(def.types).forEach(function (col) {
    if (def.types[col] !== 'bool') return;
    const i = headers.indexOf(col);
    if (i < 0) return;
    const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sh.getRange(fromRow, i + 1, numRows, 1).setDataValidation(rule);
  });
}

function removeDefaultSheets_(ss) {
  ['Sheet1', 'Lembar1', 'Lembar 1', 'Sheet 1'].forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

/** Checkbox for boolean settings, plain text for phone/URL values. */
function formatSettingsSheet_() {
  const t = readTable_('Settings');
  const vcol = t.idx.value + 1;
  t.rows.forEach(function (r) {
    const key = String(r.key).trim();
    const cell = t.sheet.getRange(r._row, vcol);
    if (typeof SETTING_DEFAULTS[key] === 'boolean') {
      cell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
      if (typeof r.value !== 'boolean') cell.setValue(isTrue_(r.value));
    } else if (key === 'WHATSAPP' || key === 'LOGO_URL') {
      cell.setNumberFormat('@');
    }
  });
}

function protectSheets_(ss) {
  ['Users', 'Settings'].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    const p = existing.length ? existing[0] : sh.protect();
    p.setDescription('KasirWarung AI: sheet ' + name + ' hanya boleh diubah pemilik lewat aplikasi.');
    try {
      const me = Session.getEffectiveUser();
      p.addEditor(me);
      p.removeEditors(p.getEditors());
      if (p.canDomainEdit()) p.setDomainEdit(false);
    } catch (e) {
      console.warn('Proteksi ' + name + ': ' + e.message);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

const BUSINESS_SHEETS_ = ['Products', 'Customers', 'Sales', 'Credits', 'StockMoves'];

function isEmpty_(name) {
  return sheet_(name).getLastRow() < 2;
}

/** Seeds only empty sheets so running setup again never duplicates data. */
function seedIfEmpty_() {
  const seeded = [];

  // Settings: add any missing key.
  const ts = readTable_('Settings');
  const have = {};
  ts.rows.forEach(function (r) { have[String(r.key).trim()] = true; });
  const sample = sampleSettings_();
  const addS = Object.keys(sample).filter(function (k) { return !have[k]; }).map(function (k) { return { key: k, value: sample[k] }; });
  if (addS.length) { appendRows_(ts, addS); seeded.push('Settings'); }

  // Users: only when the sheet has no users at all (never re-creates admin later).
  if (isEmpty_('Users')) {
    appendRows_(meta_('Users'), sampleUsers_());
    seeded.push('Users');
  }

  // Business data: all-or-nothing so IDs stay consistent across sheets.
  const allEmpty = BUSINESS_SHEETS_.every(isEmpty_);
  if (allEmpty) {
    writeBusinessData_(buildSampleData_({ extended: false }));
    Array.prototype.push.apply(seeded, BUSINESS_SHEETS_);
  }

  if (isEmpty_('Log_AI')) { appendRows_(meta_('Log_AI'), sampleLogAi_()); seeded.push('Log_AI'); }
  if (isEmpty_('Log_Activity')) { appendRows_(meta_('Log_Activity'), sampleLogActivity_()); seeded.push('Log_Activity'); }
  return seeded;
}

function writeBusinessData_(d) {
  appendRows_(meta_('Products'), d.products);
  appendRows_(meta_('Customers'), d.customers);
  appendRows_(meta_('Sales'), d.sales);
  appendRows_(meta_('Credits'), d.credits);
  appendRows_(meta_('StockMoves'), d.moves);
}

function sampleSettings_() {
  return {
    BUSINESS_NAME: 'Warung Berkah Jaya',
    BUSINESS_ADDRESS: 'Jl. Melati No. 10, RT 03/RW 05, Bekasi',
    LOGO_URL: '',
    WHATSAPP: '6281298765400',
    TAX_PERCENT: 0,
    AI_ENABLED: true,
    RECEIPT_FOOTER: 'Terima kasih, semoga berkah! Barang yang sudah dibeli tidak dapat ditukar.',
    KASBON_DUE_DAYS: 14,
    EXPIRY_WARN_DAYS: 30,
    SETUP_DONE: false
  };
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + String(password), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

function userRow_(username, password, role, fullName, active) {
  const salt = newSalt_();
  return { username: username, password_hash: hashPassword_(password, salt), salt: salt, role: role, full_name: fullName, active: active };
}

function sampleUsers_() {
  const rnd = function () { return Utilities.getUuid(); };
  return [
    userRow_('admin', 'admin123', 'Owner', 'Pemilik Warung', true),
    userRow_('kasir', 'kasir123', 'Kasir', 'Sari Wulandari (Kasir Demo)', true),
    userRow_('dewi.pagi', rnd(), 'Kasir', 'Dewi Anggraini', false),
    userRow_('rudi.sore', rnd(), 'Kasir', 'Rudi Hartono', false),
    userRow_('lina', rnd(), 'Kasir', 'Lina Marlina', false),
    userRow_('agus', rnd(), 'Kasir', 'Agus Salim', false),
    userRow_('nita', rnd(), 'Kasir', 'Nita Puspitasari', false),
    userRow_('bayu', rnd(), 'Kasir', 'Bayu Saputra', false),
    userRow_('wati', rnd(), 'Kasir', 'Suwati', false),
    userRow_('eko', rnd(), 'Kasir', 'Eko Prasetyo', false)
  ];
}

function ean13_(twelve) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve.charAt(i)) * (i % 2 ? 3 : 1);
  return twelve + ((10 - (sum % 10)) % 10);
}

/** [barcode12, name, category, unit, retail, bundle, bundleQty, wholesale, wholesaleQty, cost, finalStock, minStock, expiryInDays] */
const SAMPLE_PRODUCTS_ = [
  ['200000000011', 'Beras Medium Curah', 'Sembako', 'kg', 13500, 13200, 5, 12900, 25, 12000, 118, 25, 300],
  ['899270100012', 'Minyakita Minyak Goreng 1 L', 'Sembako', 'liter', 15700, 15500, 6, 15200, 12, 14600, 46, 12, 240],
  ['200000000028', 'Telur Ayam Negeri', 'Sembako', 'kg', 29000, 28500, 3, 28000, 10, 26800, 23, 10, 12],
  ['899634100015', 'Indomie Goreng 85 g', 'Sembako', 'pcs', 3500, 3300, 5, 3150, 40, 2950, 150, 40, 210],
  ['899100800107', 'Kapal Api Special Mix 10x24 g', 'Minuman', 'renteng', 14500, 14200, 3, 13800, 12, 12900, 18, 6, 25],
  ['899354110234', 'Teh Pucuk Harum 350 ml', 'Minuman', 'pcs', 4000, 3700, 6, 3450, 24, 3150, 9, 24, 180],
  ['897400110012', 'Gudang Garam Surya 12', 'Rokok', 'pcs', 27000, 26700, 5, 26300, 10, 25400, 28, 10, null],
  ['899270300158', 'Chitato Sapi Panggang 68 g', 'Snack', 'pcs', 11500, 11000, 3, 10500, 10, 9600, 4, 10, 95],
  ['899999900110', 'Sabun Mandi Lifebuoy Merah 110 g', 'Toiletries', 'pcs', 5000, 4700, 3, 4400, 12, 3900, 36, 12, 540],
  ['200000000035', 'Gas LPG 3 kg (Isi Ulang)', 'Gas & Air', 'pcs', 22000, 21500, 3, 0, 0, 19000, 5, 10, null]
];

/** [name, phone, address, credit_limit, notes] */
const SAMPLE_CUSTOMERS_ = [
  ['Bu Siti Aminah', '6281234567801', 'Jl. Melati No. 12, RT 03/RW 05', 500000, 'Langganan beras tiap minggu'],
  ['Pak Joko Susilo', '6281298765432', 'Gg. Kenanga No. 7', 300000, 'Ojek pangkalan depan gang'],
  ['Mbak Rina Wulandari', '6285712345678', 'Perum Griya Asri Blok C2', 250000, ''],
  ['Pak Ahmad Fauzi', '6287812340099', 'Jl. Masjid Al-Ikhlas No. 3', 400000, 'Ketua RT 03'],
  ['Bu Dewi Lestari', '6281377788899', 'Jl. Mawar No. 21', 200000, 'Warung nasi uduk, sering beli grosir'],
  ['Pak Budi Santoso', '6282145678901', 'Jl. Pahlawan No. 45', 350000, ''],
  ['Bu Yuni Rahayu', '6289612345670', 'Kontrakan Pak Haji Blok B No. 2', 150000, 'Bayar tiap tanggal 1'],
  ['Mas Andi Pratama', '6281511223344', 'Kos Putra Barokah Kamar 4', 100000, 'Mahasiswa'],
  ['Bu Sri Wahyuni', '6285266677788', 'Jl. Anggrek No. 9', 300000, 'Pesan telur tiap Jumat'],
  ['Pak Hendra Gunawan', '6281399900011', 'Jl. Kamboja No. 17', 0, 'Tidak menerima kasbon']
];

/** [dayOffset, minutesOffsetOrHHmm, cashier, customerIndex|null, [[productIndex, qty]...], discount, method, paid] */
const SAMPLE_SALES_ = [
  [-6, '07:15', 'kasir', null, [[3, 5], [5, 2]], 0, 'Tunai', 30000],
  [-5, '08:40', 'admin', 0, [[0, 5], [2, 2], [1, 2]], 0, 'Kasbon', 0],
  [-4, '10:05', 'kasir', null, [[6, 1], [7, 2]], 0, 'QRIS', null],
  [-3, '16:30', 'kasir', 1, [[6, 2], [4, 1]], 0, 'Kasbon', 20000],
  [-2, '09:12', 'admin', null, [[9, 1], [8, 2]], 0, 'Tunai', 35000],
  [-2, '19:45', 'kasir', 4, [[3, 40], [1, 6]], 4000, 'Transfer', null],
  [-1, '07:30', 'kasir', 2, [[2, 1], [3, 5], [5, 3]], 0, 'Kasbon', 0],
  [-1, '13:20', 'admin', null, [[0, 10], [8, 1]], 0, 'Tunai', 150000],
  [0, -95, 'kasir', null, [[4, 1], [7, 1], [5, 2]], 0, 'QRIS', null],
  [0, -35, 'kasir', 5, [[9, 1], [3, 10]], 0, 'Kasbon', 0]
];

/** Opening balances copied from the old paper kasbon book (trx_id empty). [customerIndex, amount, paid, createdOffset, dueOffset, reminderOffset|null] */
const SAMPLE_OPENING_CREDITS_ = [
  [3, 120000, 50000, -30, -16, -3],
  [6, 85000, 0, -20, -6, -1],
  [7, 45000, 45000, -25, -11, null],
  [8, 210000, 100000, -15, -1, null],
  [0, 60000, 60000, -28, -14, null],
  [1, 35000, 0, -12, 2, null]
];

function mulberry32_(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function atTime_(day, spec) {
  const d = new Date(day.getTime());
  if (typeof spec === 'number') {
    const now = new Date();
    const t = new Date(now.getTime() + spec * 60000);
    return t < day ? new Date(day.getTime() + 60000) : t;
  }
  const hm = String(spec).split(':');
  d.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
  return d;
}

/**
 * Builds a fully consistent dataset: stock = opening stock − sales,
 * every Kasbon sale has a Credits row, IDs follow PREFIX+YYMMDD-###.
 */
function buildSampleData_(opts) {
  opts = opts || {};
  const today = today0_();
  const settings = sampleSettings_();

  const products = SAMPLE_PRODUCTS_.map(function (p, i) {
    return {
      product_id: 'PRD' + ymd_(addDays_(today, -30)) + '-' + ('00' + (i + 1)).slice(-3),
      barcode: ean13_(p[0]), name: p[1], category: p[2], unit: p[3],
      price_retail: p[4], price_bundle: p[5], bundle_qty: p[6], price_wholesale: p[7], wholesale_qty: p[8],
      cost_price: p[9], stock: p[10], min_stock: p[11],
      expiry_date: p[12] === null ? '' : addDays_(today, p[12]), active: true
    };
  });

  const customers = SAMPLE_CUSTOMERS_.map(function (c, i) {
    return {
      customer_id: 'PLG' + ymd_(addDays_(today, -30)) + '-' + ('00' + (i + 1)).slice(-3),
      name: c[0], phone: c[1], address: c[2], credit_limit: c[3], notes: c[4]
    };
  });

  // Sale specs: the 10 sample rows plus (optionally) 28 days of demo history.
  const specs = SAMPLE_SALES_.map(function (s) {
    return { at: atTime_(addDays_(today, s[0]), s[1]), cashier: s[2], cust: s[3], items: s[4], discount: s[5], method: s[6], paid: s[7] };
  });
  if (opts.extended) {
    const rnd = mulberry32_(20260926);
    const weights = [6, 4, 3, 9, 3, 7, 5, 4, 3, 2];
    const pick = function () {
      const total = weights.reduce(function (a, b) { return a + b; }, 0);
      let x = rnd() * total;
      for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return i; }
      return 0;
    };
    for (let d = -27; d <= -1; d++) {
      const n = 4 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        const lines = {};
        const nl = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < nl; j++) {
          const pi = pick();
          const unit = products[pi].unit;
          const q = unit === 'kg' || unit === 'liter' ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * (pi === 3 ? 8 : 3));
          lines[pi] = (lines[pi] || 0) + q;
        }
        const r = rnd();
        const hh = 6 + Math.floor(rnd() * 15), mm = Math.floor(rnd() * 60);
        specs.push({
          at: atTime_(addDays_(today, d), hh + ':' + ('0' + mm).slice(-2)),
          cashier: rnd() < 0.7 ? 'kasir' : 'admin', cust: null,
          items: Object.keys(lines).map(function (pi) { return [Number(pi), lines[pi]]; }),
          discount: 0, method: r < 0.6 ? 'Tunai' : (r < 0.88 ? 'QRIS' : 'Transfer'), paid: null
        });
      }
    }
  }
  specs.sort(function (a, b) { return a.at - b.at; });

  const counters = {};
  const nextId = function (prefix, date) {
    const stem = prefix + ymd_(date) + '-';
    counters[stem] = (counters[stem] || 0) + 1;
    return stem + ('00' + counters[stem]).slice(-3);
  };

  const sold = products.map(function () { return 0; });
  const sales = [], credits = [], saleMoves = [];
  specs.forEach(function (s) {
    const items = s.items.map(function (it) {
      const p = products[it[0]];
      const pr = unitPrice_(p, it[1]);
      sold[it[0]] += it[1];
      return { product_id: p.product_id, name: p.name, unit: p.unit, qty: it[1], price: pr.price, tier: pr.tier, cost: p.cost_price, total: pr.price * it[1] };
    });
    const subtotal = items.reduce(function (a, i) { return a + i.total; }, 0);
    const total = subtotal - s.discount;
    const paid = s.method === 'Kasbon' ? (s.paid || 0) : (s.method === 'Tunai' ? s.paid || total : total);
    const trx = nextId('TRX', s.at);
    const cust = s.cust === null ? null : customers[s.cust];
    sales.push({
      trx_id: trx, datetime: s.at, cashier: s.cashier, customer_id: cust ? cust.customer_id : '',
      items_json: JSON.stringify(items), subtotal: subtotal, discount: s.discount, total: total,
      paid: paid, change: s.method === 'Tunai' ? paid - total : 0, method: s.method, status: 'Selesai'
    });
    items.forEach(function (i) {
      saleMoves.push({ at: s.at, product_id: i.product_id, type: 'JUAL', qty: -i.qty, cost_price: i.cost, note: trx, user: s.cashier });
    });
    if (s.method === 'Kasbon') {
      credits.push({
        credit_id: nextId('KSB', s.at), customer_id: cust.customer_id, trx_id: trx, amount: total - paid,
        paid_amount: 0, due_date: addDays_(dayStart_(s.at), settings.KASBON_DUE_DAYS), status: 'Belum Lunas', last_reminder: ''
      });
    }
  });

  SAMPLE_OPENING_CREDITS_.forEach(function (c) {
    const created = addDays_(today, c[3]);
    credits.push({
      credit_id: nextId('KSB', created), customer_id: customers[c[0]].customer_id, trx_id: '',
      amount: c[1], paid_amount: c[2], due_date: addDays_(today, c[4]),
      status: c[2] >= c[1] ? 'Lunas' : (c[2] > 0 ? 'Cicil' : 'Belum Lunas'),
      last_reminder: c[5] === null ? '' : atTime_(addDays_(today, c[5]), '10:00')
    });
  });
  credits.sort(function (a, b) { return a.credit_id < b.credit_id ? -1 : 1; });

  const firstSale = specs.length ? specs[0].at : today;
  const openAt = atTime_(addDays_(dayStart_(firstSale), -1), '06:00');
  const moves = [];
  products.forEach(function (p, i) {
    moves.push({ at: openAt, product_id: p.product_id, type: 'AWAL', qty: p.stock + sold[i], cost_price: p.cost_price, note: 'Stok awal (data contoh)', user: 'admin' });
  });
  Array.prototype.push.apply(moves, saleMoves);
  const moveRows = moves.map(function (m) {
    return { move_id: nextId('STK', m.at), date: m.at, product_id: m.product_id, type: m.type, qty: m.qty, cost_price: m.cost_price, note: m.note, user: m.user };
  });

  return { products: products, customers: customers, sales: sales, credits: credits, moves: moveRows };
}

function sampleLogAi_() {
  const today = today0_();
  const at = function (d, hm) { return atTime_(addDays_(today, d), hm); };
  return [
    { timestamp: at(-6, '20:05'), user: 'admin', feature: 'Cerita Omzet Hari Ini', status: 'OK' },
    { timestamp: at(-5, '21:10'), user: 'admin', feature: 'Saran Kulakan', status: 'OK' },
    { timestamp: at(-5, '21:12'), user: 'admin', feature: 'Saran Kulakan', status: 'CACHE' },
    { timestamp: at(-4, '09:30'), user: 'kasir', feature: 'Pesan Tagih Halus', status: 'OK' },
    { timestamp: at(-4, '20:00'), user: 'admin', feature: 'Cerita Omzet Hari Ini', status: 'ERROR: HTTP 502 → template' },
    { timestamp: at(-3, '10:15'), user: 'admin', feature: 'Pesan Tagih Halus', status: 'OK' },
    { timestamp: at(-3, '20:40'), user: 'admin', feature: 'Cerita Omzet Hari Ini', status: 'OK' },
    { timestamp: at(-2, '08:05'), user: 'admin', feature: 'Saran Kulakan', status: 'OFF → aturan' },
    { timestamp: at(-1, '10:00'), user: 'kasir', feature: 'Pesan Tagih Halus', status: 'OK' },
    { timestamp: at(-1, '20:30'), user: 'admin', feature: 'Cerita Omzet Hari Ini', status: 'CACHE' }
  ];
}

function sampleLogActivity_() {
  const today = today0_();
  const at = function (d, hm) { return atTime_(addDays_(today, d), hm); };
  const c = function (i) { return 'PLG' + ymd_(addDays_(today, -30)) + '-' + ('00' + (i + 1)).slice(-3); };
  return [
    { timestamp: at(-7, '05:50'), user: 'admin', action: 'SETUP_DB', ref_id: DB_NAME, amount: '', details: 'Database dibuat dengan data contoh' },
    { timestamp: at(-7, '06:00'), user: 'admin', action: 'LOGIN', ref_id: '', amount: '', details: '{"role":"Owner"}' },
    { timestamp: at(-26, '17:00'), user: 'admin', action: 'KASBON_BAYAR', ref_id: c(0), amount: 60000, details: '{"method":"Tunai","note":"Pelunasan buku lama"}' },
    { timestamp: at(-18, '18:20'), user: 'admin', action: 'KASBON_BAYAR', ref_id: c(7), amount: 45000, details: '{"method":"Transfer","note":"Pelunasan buku lama"}' },
    { timestamp: at(-10, '08:15'), user: 'kasir', action: 'KASBON_BAYAR', ref_id: c(3), amount: 50000, details: '{"method":"Tunai","note":"Cicilan buku lama"}' },
    { timestamp: at(-4, '19:00'), user: 'kasir', action: 'KASBON_BAYAR', ref_id: c(8), amount: 100000, details: '{"method":"QRIS","note":"Cicilan buku lama"}' },
    { timestamp: at(-3, '10:15'), user: 'admin', action: 'REMINDER', ref_id: c(3), amount: '', details: 'Pengingat WA dikirim' },
    { timestamp: at(-1, '10:00'), user: 'kasir', action: 'REMINDER', ref_id: c(6), amount: '', details: 'Pengingat WA dikirim' },
    { timestamp: at(-1, '21:30'), user: 'kasir', action: 'CLOSING', ref_id: ymdKey_(addDays_(today, -1)), amount: 434000, details: '{"opening":150000,"system_cash":284000,"expected":434000,"counted":434000,"diff":0}' },
    { timestamp: at(0, '06:30'), user: 'admin', action: 'LOGIN', ref_id: '', amount: '', details: '{"role":"Owner"}' }
  ].sort(function (a, b) { return a.timestamp - b.timestamp; });
}

/* ------------------------------------------------------------------ */
/* Demo data & reset (owner only, called from Code.gs)                 */
/* ------------------------------------------------------------------ */

function loadDemoData_(user) {
  withLock_(function () {
    BUSINESS_SHEETS_.forEach(clearData_);
    writeBusinessData_(buildSampleData_({ extended: true }));
  });
  invalidateProducts_();
  logActivity_(user, 'DEMO_DATA', '', '', 'Data demo 28 hari dimuat');
  return { ok: true };
}

function resetData_(user, keepCatalog) {
  withLock_(function () {
    ['Sales', 'Credits', 'StockMoves', 'Customers', 'Log_AI'].forEach(clearData_);
    if (!keepCatalog) clearData_('Products');
    else {
      const t = readTable_('Products');
      t.rows.forEach(function (r) { r.stock = 0; });
      writeColumn_(t, 'stock', t.rows);
    }
  });
  invalidateProducts_();
  logActivity_(user, 'RESET_DATA', '', '', keepCatalog ? 'Transaksi dihapus, katalog produk disimpan (stok 0)' : 'Semua data usaha dihapus');
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Backups to Google Drive                                             */
/* ------------------------------------------------------------------ */

function folderByProp_(prop, name) {
  const p = props_();
  const id = p.getProperty(prop);
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* recreate below */ }
  }
  const home = appFolder_();
  const folder = home ? home.createFolder(name) : DriveApp.createFolder(name);
  p.setProperty(prop, folder.getId());
  return folder;
}

/**
 * The Drive folder that holds this standalone script (e.g. "01. KasirWarung Claude").
 * DB_KasirWarung, backups and exports are created next to the script so the
 * whole app lives in one folder. Returns null for My Drive root or bound scripts.
 */
function appFolder_() {
  try {
    const parents = DriveApp.getFileById(ScriptApp.getScriptId()).getParents();
    if (!parents.hasNext()) return null;
    const folder = parents.next();
    return folder.getId() === DriveApp.getRootFolder().getId() ? null : folder;
  } catch (e) {
    return null;
  }
}

function backupFolder_() {
  return folderByProp_('BACKUP_FOLDER_ID', 'KasirWarung AI - Backup');
}

function exportFolder_() {
  return folderByProp_('EXPORT_FOLDER_ID', 'KasirWarung AI - Ekspor');
}

function backupNow_(user) {
  const ss = db_();
  const folder = backupFolder_();
  const name = 'Backup ' + DB_NAME + ' ' + Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm');
  const copy = DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  pruneBackups_(folder, 30);
  props_().setProperty('LAST_BACKUP', String(Date.now()));
  logActivity_(user, 'BACKUP', copy.getId(), '', name);
  return { name: name, url: copy.getUrl(), folderUrl: folder.getUrl(), at: new Date() };
}

function pruneBackups_(folder, keep) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf('Backup ' + DB_NAME) === 0) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(keep).forEach(function (f) { f.setTrashed(true); });
}

/** Time-driven trigger target. Skips when a backup ran in the last 20 hours. */
function dailyBackup() {
  const last = Number(props_().getProperty('LAST_BACKUP') || 0);
  if (Date.now() - last < 20 * 3600 * 1000) return 'skip';
  backupNow_('trigger');
  return 'ok';
}

function setBackupTrigger_(on) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  if (on) {
    ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(23).inTimezone(TZ).create();
  }
  return backupStatus_();
}

function backupStatus_() {
  const p = props_();
  const active = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dailyBackup'; });
  const last = Number(p.getProperty('LAST_BACKUP') || 0);
  let folderUrl = '';
  const fid = p.getProperty('BACKUP_FOLDER_ID');
  if (fid) { try { folderUrl = DriveApp.getFolderById(fid).getUrl(); } catch (e) { folderUrl = ''; } }
  return { trigger: active, last: last ? new Date(last) : null, folderUrl: folderUrl };
}

// ======================= Code.gs =======================
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

const PAGES = ['login', 'setup', 'dashboard', 'kasir', 'produk', 'stok', 'pelanggan', 'laporan',
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

function apiProducts(token) {
  return run_(token, 'product.view', function (s) {
    return productsForRole_(s.role);
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

// ======================= Reports.gs =======================
/**
 * KasirWarung AI — Reports.gs
 * Dashboard KPIs & charts, period reports, PDF export and daily cash closing.
 * Reads only the rows it needs (readTableSince_) so 1,000+ rows stay fast.
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

function enrichSale_(r) {
  let items = [];
  try { items = JSON.parse(String(r.items_json || '[]')); } catch (e) { items = []; }
  const subtotal = num_(r.subtotal), discount = num_(r.discount), total = num_(r.total);
  const cogs = items.reduce(function (a, i) { return a + num_(i.cost) * num_(i.qty); }, 0);
  return {
    trx_id: String(r.trx_id), datetime: r.datetime, day: ymdKey_(r.datetime), cashier: String(r.cashier || ''),
    customer_id: String(r.customer_id || ''), items: items, subtotal: subtotal, discount: discount, total: total,
    tax: Math.max(0, total - (subtotal - discount)), paid: num_(r.paid), change: num_(r.change),
    method: String(r.method), status: String(r.status || 'Selesai'), cogs: Math.round(cogs),
    profit: Math.round(subtotal - discount - cogs)
  };
}

function salesInRange_(from, toExclusive) {
  return readTableSince_('Sales', 'datetime', from).rows
    .filter(function (r) { return r.datetime < toExclusive; })
    .map(enrichSale_);
}

function creditsSummary_() {
  const today = today0_();
  let outstanding = 0, overdue = 0, overdueAmount = 0;
  const customers = {};
  readTable_('Credits').rows.forEach(function (k) {
    const c = creditOut_(k, today);
    if (!c.open) return;
    outstanding += c.balance;
    customers[c.customer_id] = true;
    if (c.days_overdue !== null && c.days_overdue > 0) { overdue++; overdueAmount += c.balance; }
  });
  return { outstanding: outstanding, customers: Object.keys(customers).length, overdue: overdue, overdueAmount: overdueAmount };
}

function stockAlerts_(warnDays) {
  const today = today0_();
  const low = [], expiry = [];
  let stockValue = 0;
  productsAll_().forEach(function (p) {
    if (!p.active) return;
    stockValue += Math.max(0, p.stock) * p.cost_price;
    if (p.stock <= p.min_stock) low.push({ product_id: p.product_id, name: p.name, unit: p.unit, stock: p.stock, min_stock: p.min_stock });
    if (p.expiry_date) {
      const days = daysBetween_(today, parseYmd_(p.expiry_date));
      if (days <= warnDays) expiry.push({ product_id: p.product_id, name: p.name, unit: p.unit, stock: p.stock, expiry_date: p.expiry_date, days: days });
    }
  });
  low.sort(function (a, b) { return (a.stock / (a.min_stock || 1)) - (b.stock / (b.min_stock || 1)); });
  expiry.sort(function (a, b) { return a.days - b.days; });
  return { low: low.slice(0, 50), lowCount: low.length, expiry: expiry.slice(0, 50), expiryCount: expiry.length, stockValue: Math.round(stockValue) };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function dashboard_() {
  const st = getSettings_();
  const today = today0_();
  const from = addDays_(today, -29);
  const sales = salesInRange_(from, addDays_(today, 1)).filter(function (s) { return s.status !== 'Batal'; });
  const todayKey = ymdKey_(today), yKey = ymdKey_(addDays_(today, -1));

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays_(today, -i);
    days.push({ key: ymdKey_(d), label: Utilities.formatDate(d, TZ, 'dd/MM'), omzet: 0, profit: 0, trx: 0 });
  }
  const dayIdx = {};
  days.forEach(function (d, i) { dayIdx[d.key] = i; });

  const kToday = { omzet: 0, profit: 0, trx: 0 };
  let yOmzet = 0;
  const prod = {}, methods = {};
  METHODS.forEach(function (m) { methods[m] = 0; });

  sales.forEach(function (s) {
    if (s.day in dayIdx) {
      const d = days[dayIdx[s.day]];
      d.omzet += s.total; d.profit += s.profit; d.trx++;
    }
    if (s.day === todayKey) { kToday.omzet += s.total; kToday.profit += s.profit; kToday.trx++; }
    if (s.day === yKey) yOmzet += s.total;
    methods[s.method] = (methods[s.method] || 0) + s.total;
    s.items.forEach(function (i) {
      const p = prod[i.product_id] || (prod[i.product_id] = { name: i.name, unit: i.unit, qty: 0, omzet: 0 });
      p.qty += num_(i.qty);
      p.omzet += num_(i.total);
    });
  });

  const top = Object.keys(prod).map(function (k) { return prod[k]; })
    .sort(function (a, b) { return b.qty - a.qty || b.omzet - a.omzet; }).slice(0, 10);
  const recent = sales.filter(function (s) { return s.day === todayKey; }).slice(-6).reverse()
    .map(function (s) { return { trx_id: s.trx_id, datetime: s.datetime, total: s.total, method: s.method, items: s.items.length, cashier: s.cashier }; });

  return {
    today: todayKey,
    kpi: {
      omzet: kToday.omzet, profit: kToday.profit, trx: kToday.trx,
      avg: kToday.trx ? Math.round(kToday.omzet / kToday.trx) : 0, yesterdayOmzet: yOmzet,
      margin: kToday.omzet ? Math.round(kToday.profit / kToday.omzet * 1000) / 10 : 0
    },
    kasbon: creditsSummary_(),
    week: days,
    top: top,
    methods: METHODS.map(function (m) { return { method: m, total: methods[m] || 0 }; }),
    stock: stockAlerts_(num_(st.EXPIRY_WARN_DAYS) || 30),
    recent: recent
  };
}

/* ------------------------------------------------------------------ */
/* Period report                                                       */
/* ------------------------------------------------------------------ */

function reportRange_(from, to) {
  const f = vDate_(from, 'Tanggal awal', { required: true });
  const t = vDate_(to, 'Tanggal akhir', { required: true });
  if (t < f) throw appError_('INVALID', 'Tanggal akhir harus setelah tanggal awal.');
  if (daysBetween_(f, t) > 366) throw appError_('INVALID', 'Rentang laporan maksimal 1 tahun.');
  return { from: f, to: t, end: addDays_(t, 1) };
}

function report_(from, to) {
  const rg = reportRange_(from, to);
  const all = salesInRange_(rg.from, rg.end);
  const cm = customersMap_();
  const cat = {};
  productsAll_().forEach(function (p) { cat[p.product_id] = p.category; });

  const ok = all.filter(function (s) { return s.status !== 'Batal'; });
  const voided = all.filter(function (s) { return s.status === 'Batal'; });
  const sum = function (arr, k) { return arr.reduce(function (a, x) { return a + num_(x[k]); }, 0); };

  const summary = {
    omzet: sum(ok, 'total'), profit: sum(ok, 'profit'), cogs: sum(ok, 'cogs'), discount: sum(ok, 'discount'),
    tax: sum(ok, 'tax'), trx: ok.length, voidCount: voided.length, voidTotal: sum(voided, 'total')
  };
  summary.avg = summary.trx ? Math.round(summary.omzet / summary.trx) : 0;
  const net = summary.omzet - summary.tax;
  summary.margin = net ? Math.round(summary.profit / net * 1000) / 10 : 0;

  const byDay = {};
  const span = daysBetween_(rg.from, rg.to);
  if (span <= 92) for (let i = 0; i <= span; i++) byDay[ymdKey_(addDays_(rg.from, i))] = { day: ymdKey_(addDays_(rg.from, i)), omzet: 0, profit: 0, trx: 0 };
  const byProduct = {}, byMethod = {}, byCashier = {}, byCategory = {};
  let kasbonIssued = 0;
  ok.forEach(function (s) {
    const d = byDay[s.day] || (byDay[s.day] = { day: s.day, omzet: 0, profit: 0, trx: 0 });
    d.omzet += s.total; d.profit += s.profit; d.trx++;
    const m = byMethod[s.method] || (byMethod[s.method] = { method: s.method, total: 0, trx: 0 });
    m.total += s.total; m.trx++;
    const c = byCashier[s.cashier] || (byCashier[s.cashier] = { cashier: s.cashier, total: 0, trx: 0 });
    c.total += s.total; c.trx++;
    if (s.method === 'Kasbon') kasbonIssued += s.total - s.paid;
    s.items.forEach(function (i) {
      const p = byProduct[i.product_id] || (byProduct[i.product_id] = { product_id: i.product_id, name: i.name, unit: i.unit, qty: 0, omzet: 0, cogs: 0, profit: 0 });
      const cogs = num_(i.cost) * num_(i.qty);
      p.qty = round2_(p.qty + num_(i.qty)); p.omzet += num_(i.total); p.cogs += cogs; p.profit += num_(i.total) - cogs;
      const k = cat[i.product_id] || 'Lainnya';
      const cg = byCategory[k] || (byCategory[k] = { category: k, omzet: 0, qty: 0 });
      cg.omzet += num_(i.total); cg.qty += num_(i.qty);
    });
  });

  let kasbonPaid = 0;
  readTableSince_('Log_Activity', 'timestamp', rg.from).rows.forEach(function (l) {
    if (l.action === 'KASBON_BAYAR' && l.timestamp < rg.end) kasbonPaid += num_(l.amount);
  });

  const vals = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
  const products = vals(byProduct).sort(function (a, b) { return b.omzet - a.omzet; });
  products.forEach(function (p) { p.cogs = Math.round(p.cogs); p.profit = Math.round(p.profit); });

  return {
    from: ymdKey_(rg.from), to: ymdKey_(rg.to),
    summary: summary,
    byDay: vals(byDay).sort(function (a, b) { return a.day < b.day ? -1 : 1; }),
    byProduct: products,
    byMethod: vals(byMethod).sort(function (a, b) { return b.total - a.total; }),
    byCashier: vals(byCashier).sort(function (a, b) { return b.total - a.total; }),
    byCategory: vals(byCategory).sort(function (a, b) { return b.omzet - a.omzet; }),
    kasbon: { issued: kasbonIssued, paid: kasbonPaid, outstanding: creditsSummary_().outstanding },
    stockValue: stockAlerts_(30).stockValue,
    transactions: all.slice().reverse().slice(0, 1000).map(function (s) {
      const c = cm[s.customer_id];
      return {
        trx_id: s.trx_id, datetime: s.datetime, cashier: s.cashier, customer_name: c ? String(c.name) : '',
        items: s.items.length, total: s.total, profit: s.profit, method: s.method, status: s.status
      };
    }),
    truncated: all.length > 1000
  };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reportPdf_(s, from, to) {
  const r = report_(from, to);
  const st = getSettings_();
  const d = function (k) { return fmtDmy_(parseYmd_(k)); };
  const rows = function (arr, cols) {
    return arr.map(function (x) {
      return '<tr>' + cols.map(function (c) { return '<td class="' + (c.num ? 'n' : '') + '">' + esc_(c.f ? c.f(x[c.k], x) : x[c.k]) + '</td>'; }).join('') + '</tr>';
    }).join('');
  };
  const head = function (cols) { return '<tr>' + cols.map(function (c) { return '<th class="' + (c.num ? 'n' : '') + '">' + esc_(c.t) + '</th>'; }).join('') + '</tr>'; };
  const R = function (v) { return rupiah_(v); };
  const sm = r.summary;

  const dayCols = [{ t: 'Tanggal', k: 'day', f: d }, { t: 'Transaksi', k: 'trx', num: true }, { t: 'Omzet', k: 'omzet', num: true, f: R }, { t: 'Laba kotor', k: 'profit', num: true, f: R }];
  const prodCols = [{ t: 'Produk', k: 'name' }, { t: 'Terjual', k: 'qty', num: true, f: function (v, x) { return v + ' ' + x.unit; } }, { t: 'Omzet', k: 'omzet', num: true, f: R }, { t: 'Laba kotor', k: 'profit', num: true, f: R }];
  const methCols = [{ t: 'Metode', k: 'method' }, { t: 'Transaksi', k: 'trx', num: true }, { t: 'Total', k: 'total', num: true, f: R }];

  const html = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:11px;margin:24px}' +
    'h1{color:#EA580C;font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #F97316;padding-bottom:3px}' +
    '.muted{color:#6b7280}.kpi{display:inline-block;width:23%;margin:6px 1% 6px 0;padding:8px;border:1px solid #fed7aa;border-radius:8px;background:#fff7ed;vertical-align:top}' +
    '.kpi b{display:block;font-size:14px;margin-top:2px}table{width:100%;border-collapse:collapse}th{background:#F97316;color:#fff;text-align:left;padding:5px}' +
    'td{padding:4px 5px;border-bottom:1px solid #eee}.n{text-align:right}.foot{margin-top:24px;font-size:9px;color:#6b7280;text-align:center}' +
    '</style></head><body>' +
    '<h1>' + esc_(st.BUSINESS_NAME) + '</h1><div class="muted">' + esc_(st.BUSINESS_ADDRESS) + '</div>' +
    '<p><b>Laporan Penjualan</b> ' + esc_(d(r.from)) + ' s/d ' + esc_(d(r.to)) + ' · dicetak ' + esc_(fmtDmyHm_(new Date())) + ' oleh ' + esc_(s.full_name) + '</p>' +
    '<div class="kpi">Omzet<b>' + R(sm.omzet) + '</b></div><div class="kpi">Laba kotor<b>' + R(sm.profit) + '</b></div>' +
    '<div class="kpi">Transaksi<b>' + sm.trx + '</b></div><div class="kpi">Rata-rata/transaksi<b>' + R(sm.avg) + '</b></div>' +
    '<div class="kpi">Diskon<b>' + R(sm.discount) + '</b></div><div class="kpi">Pajak<b>' + R(sm.tax) + '</b></div>' +
    '<div class="kpi">Kasbon baru<b>' + R(r.kasbon.issued) + '</b></div><div class="kpi">Kasbon dibayar<b>' + R(r.kasbon.paid) + '</b></div>' +
    '<h2>Per hari</h2><table>' + head(dayCols) + rows(r.byDay, dayCols) + '</table>' +
    '<h2>Per metode bayar</h2><table>' + head(methCols) + rows(r.byMethod, methCols) + '</table>' +
    '<h2>Produk terlaris</h2><table>' + head(prodCols) + rows(r.byProduct.slice(0, 50), prodCols) + '</table>' +
    '<p class="muted">Sisa kasbon seluruh pelanggan saat ini: <b>' + R(r.kasbon.outstanding) + '</b> · Nilai stok (harga modal): <b>' + R(r.stockValue) + '</b>' +
    (sm.voidCount ? ' · Transaksi dibatalkan: ' + sm.voidCount + ' (' + R(sm.voidTotal) + ')' : '') + '</p>' +
    '<div class="foot">© ' + APP.YEAR + ' ' + APP.NAME + ' · Made by ' + APP.MAKER + ' · v' + APP.VERSION + '</div>' +
    '</body></html>';

  const name = 'Laporan_' + r.from.replace(/-/g, '') + '_' + r.to.replace(/-/g, '') + '.pdf';
  const pdf = Utilities.newBlob(html, 'text/html', 'laporan.html').getAs('application/pdf').setName(name);
  logActivity_(s.username, 'EKSPOR_PDF', name, '', '');
  return { filename: name, base64: Utilities.base64Encode(pdf.getBytes()) };
}

/* ------------------------------------------------------------------ */
/* Daily closing: cash in drawer vs system                             */
/* ------------------------------------------------------------------ */

function closingSummary_(dateStr) {
  const day = dateStr ? vDate_(dateStr, 'Tanggal', { required: true }) : today0_();
  const end = addDays_(day, 1);
  const sales = salesInRange_(day, end);
  const out = {
    date: ymdKey_(day), trx: 0, voidCount: 0, omzet: 0, cashSales: 0, kasbonDp: 0, qris: 0, transfer: 0,
    kasbonNew: 0, payCash: 0, payNonCash: 0, closings: []
  };
  sales.forEach(function (s) {
    if (s.status === 'Batal') { out.voidCount++; return; }
    out.trx++;
    out.omzet += s.total;
    if (s.method === 'Tunai') out.cashSales += s.total;
    else if (s.method === 'QRIS') out.qris += s.total;
    else if (s.method === 'Transfer') out.transfer += s.total;
    else if (s.method === 'Kasbon') { out.kasbonDp += s.paid; out.kasbonNew += s.total - s.paid; }
  });
  readTableSince_('Log_Activity', 'timestamp', day).rows.forEach(function (l) {
    if (l.timestamp >= end) return;
    if (l.action === 'KASBON_BAYAR') {
      let d = {};
      try { d = JSON.parse(String(l.details || '{}')); } catch (e) { d = {}; }
      if ((d.method || 'Tunai') === 'Tunai') out.payCash += num_(l.amount); else out.payNonCash += num_(l.amount);
    } else if (l.action === 'CLOSING' && String(l.ref_id) === out.date) {
      let d = {};
      try { d = JSON.parse(String(l.details || '{}')); } catch (e) { d = {}; }
      out.closings.push({ at: l.timestamp, user: String(l.user), counted: num_(l.amount), expected: num_(d.expected), diff: num_(d.diff), opening: num_(d.opening), note: d.note || '' });
    }
  });
  out.systemCash = out.cashSales + out.kasbonDp + out.payCash;
  return out;
}

function saveClosing_(s, p) {
  const opening = Math.round(vNum_(p.opening_cash, 'Modal awal laci', { min: 0, max: 1000000000 }));
  const counted = Math.round(vNum_(p.counted_cash, 'Uang di laci', { required: true, min: 0, max: 1000000000 }));
  const note = vStr_(p.note, 'Catatan', { max: 160, single: true });
  const sum = closingSummary_(p.date || '');
  const expected = opening + sum.systemCash;
  const diff = counted - expected;
  logActivity_(s.username, 'CLOSING', sum.date, counted, {
    opening: opening, system_cash: sum.systemCash, expected: expected, counted: counted, diff: diff,
    omzet: sum.omzet, qris: sum.qris, transfer: sum.transfer, kasbon_new: sum.kasbonNew, note: note
  });
  sum.opening = opening; sum.counted = counted; sum.expected = expected; sum.diff = diff;
  sum.closings.unshift({ at: new Date(), user: s.username, counted: counted, expected: expected, diff: diff, opening: opening, note: note });
  return sum;
}

// ======================= AI.gs =======================
/**
 * KasirWarung AI — AI.gs
 * Optional AI value-add through an OpenAI-compatible endpoint.
 * The app works 100% without AI: every feature has a rule/template fallback.
 *
 * Script Properties (never stored in sheets or sent to the browser):
 *   AI_BASE_URL  default http://43.133.148.28:20128/v1  (plain HTTP → use an HTTPS proxy in production)
 *   AI_API_KEY   bearer token
 *   AI_MODEL     model name
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const AI_DEFAULT_BASE_URL = 'http://43.133.148.28:20128/v1';
const AI_FEATURE = {
  KULAKAN: 'Saran Kulakan',
  TAGIH: 'Pesan Tagih Halus',
  OMZET: 'Cerita Omzet Hari Ini',
  TEST: 'Tes Koneksi AI'
};

// callAI() is a top-level function (as specified) and therefore visible to
// google.script.run. This gate is only opened by authenticated server
// features, so a direct browser call is rejected.
let AI_GATE_ = false;

function withAiGate_(fn) {
  AI_GATE_ = true;
  try { return fn(); } finally { AI_GATE_ = false; }
}

function aiConfig_() {
  const p = props_();
  return {
    base: String(p.getProperty('AI_BASE_URL') || AI_DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    key: String(p.getProperty('AI_API_KEY') || '').trim(),
    model: String(p.getProperty('AI_MODEL') || '').trim()
  };
}

function aiConfigured_() {
  const c = aiConfig_();
  return !!(c.key && c.model);
}

/** Safe status for the settings page — the key itself is never returned. */
function aiStatus_() {
  const c = aiConfig_();
  let host = '';
  try { host = c.base.replace(/^https?:\/\//i, '').split('/')[0]; } catch (e) { host = ''; }
  return {
    enabled: !!getSettings_().AI_ENABLED, configured: !!(c.key && c.model), keySet: !!c.key,
    model: c.model, host: host, https: /^https:\/\//i.test(c.base)
  };
}

function logAi_(user, feature, status) {
  try {
    appendRows_(meta_('Log_AI'), [{ timestamp: new Date(), user: user || 'system', feature: feature, status: String(status).substring(0, 250) }]);
  } catch (e) {
    console.error('logAi_ gagal: ' + e.message);
  }
}

function md5Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * POST {AI_BASE_URL}/chat/completions with temperature 0.4, one retry,
 * 6-hour cache and Log_AI logging.
 * @return {{ok:boolean, text?:string, cached?:boolean, reason?:string}}
 */
function callAI(feature, messages, user) {
  if (!AI_GATE_) throw new Error('callAI hanya dapat dipanggil dari fitur AI di server.');
  user = user || 'system';
  if (!getSettings_().AI_ENABLED) {
    logAi_(user, feature, 'OFF → fallback');
    return { ok: false, reason: 'OFF' };
  }
  const cfg = aiConfig_();
  if (!cfg.key || !cfg.model) {
    logAi_(user, feature, 'NO_CONFIG → fallback');
    return { ok: false, reason: 'NO_CONFIG' };
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'ai_' + md5Hex_(feature + '|' + cfg.model + '|' + JSON.stringify(messages));
  const hit = cache.get(cacheKey);
  if (hit) {
    logAi_(user, feature, 'CACHE');
    return { ok: true, text: hit, cached: true };
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.key },
    payload: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0.4 }),
    muteHttpExceptions: true,
    followRedirects: true
  };
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(cfg.base + '/chat/completions', options);
      const code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        const j = JSON.parse(res.getContentText());
        let text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        text = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (text) {
          if (text.length < 90000) cache.put(cacheKey, text, 21600);
          logAi_(user, feature, 'OK');
          return { ok: true, text: text };
        }
        lastErr = 'jawaban kosong';
      } else {
        lastErr = 'HTTP ' + code;
        if (code >= 400 && code < 500 && code !== 408 && code !== 429) break;
      }
    } catch (e) {
      lastErr = e.message;
    }
    if (attempt === 0) Utilities.sleep(1200);
  }
  logAi_(user, feature, 'ERROR: ' + lastErr + ' → fallback');
  return { ok: false, reason: lastErr };
}

function fallbackReason_(reason) {
  if (reason === 'OFF') return 'AI dimatikan di Pengaturan — memakai hitungan otomatis.';
  if (reason === 'NO_CONFIG') return 'Kunci AI belum diatur — memakai hitungan otomatis.';
  if (reason === 'PARSE') return 'Jawaban AI tidak terbaca — memakai hitungan otomatis.';
  return 'AI sedang tidak bisa dihubungi — memakai hitungan otomatis.';
}

function fmtQty_(n) {
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

/* ------------------------------------------------------------------ */
/* 1) Saran Kulakan                                                    */
/* ------------------------------------------------------------------ */

function kulakanData_() {
  const today = today0_();
  const from = addDays_(today, -27); // 28 days including today
  const sold = {};
  salesInRange_(from, addDays_(today, 1)).forEach(function (s) {
    if (s.status === 'Batal') return;
    s.items.forEach(function (i) { sold[i.product_id] = (sold[i.product_id] || 0) + num_(i.qty); });
  });
  return productsAll_().filter(function (p) { return p.active; }).map(function (p) {
    const q = round2_(sold[p.product_id] || 0);
    return { product_id: p.product_id, name: p.name, unit: p.unit, stock: p.stock, min_stock: p.min_stock, cost: p.cost_price, sold28: q, avg: q / 28 };
  });
}

/** Rule: avg daily sales × 7 − stock (rounded up). */
function kulakanRule_(rows) {
  return rows.map(function (r) {
    const need = Math.ceil(r.avg * 7 - r.stock);
    if (need <= 0) return null;
    const cover = r.avg > 0 ? Math.floor(Math.max(0, r.stock) / r.avg) : 0;
    return {
      product_id: r.product_id, name: r.name, unit: r.unit, stock: r.stock, avg_daily: round2_(r.avg), qty: need,
      reason: 'Laku ±' + fmtQty_(r.avg) + ' ' + r.unit + '/hari, stok cukup ±' + cover + ' hari.',
      est_cost: Math.round(need * r.cost), _cover: cover
    };
  }).filter(Boolean).sort(function (a, b) { return a._cover - b._cover || b.avg_daily - a.avg_daily; })
    .map(function (x) { delete x._cover; return x; });
}

function aiSaranKulakan_(s) {
  const rows = kulakanData_();
  const byId = {};
  rows.forEach(function (r) { byId[r.product_id] = r; });
  const rule = kulakanRule_(rows);
  const total = function (items) { return items.reduce(function (a, i) { return a + i.est_cost; }, 0); };

  const candidates = rows.filter(function (r) { return r.sold28 > 0 || r.stock <= r.min_stock; })
    .sort(function (a, b) { return b.sold28 - a.sold28; }).slice(0, 80);
  if (!candidates.length) {
    return { source: 'rule', note: 'Belum ada data penjualan 28 hari terakhir.', summary: '', items: [], total_cost: 0 };
  }
  const table = candidates.map(function (r) {
    return [r.product_id, r.name, r.unit, r.stock, r.sold28, r.min_stock].join('|');
  }).join('\n');
  const messages = [
    {
      role: 'system',
      content: 'Kamu asisten kulakan (belanja stok) untuk warung sembako di Indonesia. Jawab dalam Bahasa Indonesia sederhana. ' +
        'Balas HANYA dengan JSON valid tanpa teks lain, format: {"ringkasan":"1-2 kalimat","items":[{"product_id":"...","qty":angka,"alasan":"maks 12 kata"}]}. ' +
        'Rencanakan stok untuk 7 hari ke depan, perhatikan stok minimum, hindari kulakan berlebihan untuk barang lambat laku. Maksimal 25 barang.'
    },
    {
      role: 'user',
      content: 'Tanggal: ' + fmtDmy_(today0_()) + '. Data 28 hari terakhir:\nproduct_id|nama|satuan|stok_sekarang|terjual_28_hari|stok_minimum\n' + table
    }
  ];
  const res = callAI(AI_FEATURE.KULAKAN, messages, s.username);
  if (res.ok) {
    try {
      const txt = res.text;
      const j = JSON.parse(txt.substring(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      const items = (j.items || []).map(function (it) {
        const r = byId[String(it.product_id)];
        let q = Number(it.qty);
        if (!r || !isFinite(q) || q <= 0) return null;
        q = (r.unit === 'kg' || r.unit === 'liter') ? Math.ceil(q * 2) / 2 : Math.ceil(q);
        return {
          product_id: r.product_id, name: r.name, unit: r.unit, stock: r.stock, avg_daily: round2_(r.avg), qty: q,
          reason: String(it.alasan || it.reason || '').substring(0, 140), est_cost: Math.round(q * r.cost)
        };
      }).filter(Boolean);
      if (items.length) {
        return { source: 'ai', note: res.cached ? 'Dari cache AI (6 jam).' : '', summary: String(j.ringkasan || '').substring(0, 400), items: items, total_cost: total(items) };
      }
    } catch (e) { /* fall through */ }
    logAi_(s.username, AI_FEATURE.KULAKAN, 'PARSE_FAIL → aturan');
    return { source: 'rule', note: fallbackReason_('PARSE'), summary: '', items: rule, total_cost: total(rule) };
  }
  return { source: 'rule', note: fallbackReason_(res.reason), summary: '', items: rule, total_cost: total(rule) };
}

/* ------------------------------------------------------------------ */
/* 2) Pesan Tagih Halus                                                */
/* ------------------------------------------------------------------ */

function templateTagih_(name, amount, days, due, biz) {
  const when = days > 0 ? ' yang sudah lewat ' + days + ' hari dari jatuh tempo' : (due ? ' yang jatuh tempo ' + due : '');
  return 'Halo ' + name + ', semoga sehat selalu 🙏\n' +
    'Kami dari ' + biz + ' ingin mengingatkan catatan kasbon sebesar ' + rupiah_(amount) + when + '.\n' +
    'Kalau ada rezeki, boleh dibayar sebagian dulu ya. Terima kasih banyak atas kepercayaannya 😊';
}

function aiPesanTagih_(s, customerId) {
  const id = vId_(customerId, 'PLG', 'Pelanggan');
  const c = customersWithBalance_().filter(function (x) { return x.customer_id === id; })[0];
  if (!c) throw appError_('NOT_FOUND', 'Pelanggan tidak ditemukan.');
  if (c.outstanding <= 0) throw appError_('INVALID', c.name + ' tidak punya kasbon terbuka.');
  const biz = getSettings_().BUSINESS_NAME;
  const days = Math.max(0, c.days_overdue || 0);
  const due = c.oldest_due ? fmtDmy_(c.oldest_due) : '';
  const base = { name: c.name, phone: c.phone, amount: c.outstanding, days: days, customer_id: id };

  const messages = [
    {
      role: 'system',
      content: 'Kamu membantu pemilik warung menulis pesan WhatsApp pengingat kasbon (utang belanja). ' +
        'Gunakan Bahasa Indonesia santai, sopan, hangat, tidak mengancam dan tidak mempermalukan. Maksimal 4 kalimat, boleh 1-2 emoji. ' +
        'Tulis nominal persis seperti diberikan. Tawarkan boleh dicicil. Tutup dengan nama warung. Jawab hanya isi pesannya.'
    },
    {
      role: 'user',
      content: 'Nama pelanggan: ' + c.name + '\nSisa kasbon: ' + rupiah_(c.outstanding) + '\n' +
        (days > 0 ? 'Terlambat: ' + days + ' hari dari jatuh tempo' : 'Belum lewat jatuh tempo' + (due ? ' (jatuh tempo ' + due + ')' : '')) +
        '\nNama warung: ' + biz
    }
  ];
  const res = callAI(AI_FEATURE.TAGIH, messages, s.username);
  if (res.ok) {
    const msg = res.text.replace(/^["'“”]+|["'“”]+$/g, '').trim().substring(0, 1000);
    if (msg) return Object.assign(base, { source: 'ai', message: msg, note: res.cached ? 'Dari cache AI (6 jam).' : '' });
  }
  return Object.assign(base, { source: 'template', message: templateTagih_(c.name, c.outstanding, days, due, biz), note: fallbackReason_(res.reason).replace('hitungan otomatis', 'template pesan') });
}

/* ------------------------------------------------------------------ */
/* 3) Cerita Omzet Hari Ini                                            */
/* ------------------------------------------------------------------ */

function omzetData_() {
  const today = today0_();
  const sales = salesInRange_(addDays_(today, -1), addDays_(today, 1)).filter(function (x) { return x.status !== 'Batal'; });
  const tk = ymdKey_(today);
  const d = { omzet: 0, profit: 0, trx: 0, yesterday: 0, methods: {}, best: null, kasbon: 0 };
  const prod = {};
  sales.forEach(function (x) {
    if (x.day !== tk) { d.yesterday += x.total; return; }
    d.omzet += x.total; d.profit += x.profit; d.trx++;
    d.methods[x.method] = (d.methods[x.method] || 0) + x.total;
    if (x.method === 'Kasbon') d.kasbon += x.total - x.paid;
    x.items.forEach(function (i) {
      const p = prod[i.product_id] || (prod[i.product_id] = { name: i.name, unit: i.unit, qty: 0, omzet: 0 });
      p.qty = round2_(p.qty + num_(i.qty)); p.omzet += num_(i.total);
    });
  });
  const list = Object.keys(prod).map(function (k) { return prod[k]; }).sort(function (a, b) { return b.omzet - a.omzet; });
  d.best = list[0] || null;
  d.margin = d.omzet ? Math.round(d.profit / d.omzet * 1000) / 10 : 0;
  return d;
}

function templateOmzet_(d, biz) {
  if (!d.trx) {
    return 'Hari ini ' + biz + ' belum mencatat transaksi. ' +
      (d.yesterday ? 'Kemarin omzetnya ' + rupiah_(d.yesterday) + ', jadi masih ada waktu mengejar. ' : 'Semangat membuka warung hari ini. ') +
      'Pastikan barang laris seperti mi instan, telur dan minyak goreng tersedia di rak depan.';
  }
  let cmp = '';
  if (d.yesterday > 0) {
    const pct = Math.round((d.omzet - d.yesterday) / d.yesterday * 100);
    cmp = pct > 0 ? ', naik ' + pct + '% dibanding kemarin' : (pct < 0 ? ', turun ' + Math.abs(pct) + '% dibanding kemarin' : ', sama seperti kemarin');
  }
  const s1 = 'Hari ini ' + biz + ' mencatat omzet ' + rupiah_(d.omzet) + ' dari ' + d.trx + ' transaksi' + cmp + '.';
  const s2 = d.best ? 'Barang paling laris adalah ' + d.best.name + ' sebanyak ' + fmtQty_(d.best.qty) + ' ' + d.best.unit + ' senilai ' + rupiah_(d.best.omzet) + '.' : '';
  const note = d.margin >= 15 ? 'cukup sehat, pertahankan' : (d.margin >= 8 ? 'masih wajar, coba cek lagi harga modal barang laris' : 'masih tipis, pertimbangkan menyesuaikan harga jual');
  const s3 = 'Laba kotor sekitar ' + rupiah_(d.profit) + ' dengan margin ' + String(d.margin).replace('.', ',') + '%, ' + note + '.';
  return [s1, s2, s3].filter(String).join(' ');
}

function aiCeritaOmzet_(s) {
  const d = omzetData_();
  const biz = getSettings_().BUSINESS_NAME;
  const data = { omzet: d.omzet, trx: d.trx, profit: d.profit, margin: d.margin, yesterday: d.yesterday, best: d.best };
  if (!d.trx) return { source: 'template', text: templateOmzet_(d, biz), note: 'Belum ada transaksi hari ini.', data: data };
  const lines = [
    'Nama warung: ' + biz,
    'Omzet hari ini: ' + rupiah_(d.omzet) + ' dari ' + d.trx + ' transaksi',
    'Omzet kemarin: ' + rupiah_(d.yesterday),
    'Barang terlaris: ' + (d.best ? d.best.name + ' (' + fmtQty_(d.best.qty) + ' ' + d.best.unit + ', ' + rupiah_(d.best.omzet) + ')' : '-'),
    'Laba kotor: ' + rupiah_(d.profit) + ' (margin ' + d.margin + '%)',
    'Per metode: ' + Object.keys(d.methods).map(function (m) { return m + ' ' + rupiah_(d.methods[m]); }).join(', '),
    'Kasbon baru hari ini: ' + rupiah_(d.kasbon)
  ];
  const messages = [
    {
      role: 'system',
      content: 'Kamu asisten keuangan yang ramah untuk pemilik warung. Tulis TEPAT 3 kalimat Bahasa Indonesia sederhana, tanpa judul, tanpa poin-poin: ' +
        '(1) omzet dan jumlah transaksi dibanding kemarin, (2) barang terlaris, (3) laba kotor dan margin plus satu saran praktis. Gunakan format Rupiah seperti Rp 1.250.000.'
    },
    { role: 'user', content: lines.join('\n') }
  ];
  const res = callAI(AI_FEATURE.OMZET, messages, s.username);
  if (res.ok) return { source: 'ai', text: res.text.substring(0, 1200), note: res.cached ? 'Dari cache AI (6 jam).' : '', data: data };
  return { source: 'template', text: templateOmzet_(d, biz), note: fallbackReason_(res.reason).replace('hitungan otomatis', 'ringkasan otomatis'), data: data };
}

/* ------------------------------------------------------------------ */
/* Browser API                                                         */
/* ------------------------------------------------------------------ */

function apiAiSaranKulakan(token) {
  return run_(token, 'ai.owner', function (s) { return withAiGate_(function () { return aiSaranKulakan_(s); }); });
}

function apiAiPesanTagih(token, customerId) {
  return run_(token, 'ai.reminder', function (s) { return withAiGate_(function () { return aiPesanTagih_(s, customerId); }); });
}

function apiAiCeritaOmzet(token) {
  return run_(token, 'ai.owner', function (s) { return withAiGate_(function () { return aiCeritaOmzet_(s); }); });
}

function apiAiTest(token) {
  return run_(token, 'settings', function (s) {
    return withAiGate_(function () {
      const t0 = Date.now();
      const res = callAI(AI_FEATURE.TEST, [
        { role: 'system', content: 'Jawab singkat dalam Bahasa Indonesia.' },
        { role: 'user', content: 'Balas persis: SIAP MEMBANTU WARUNG (' + t0 + ')' }
      ], s.username);
      return { ok: res.ok, reply: res.ok ? res.text.substring(0, 200) : '', reason: res.ok ? '' : fallbackReason_(res.reason), ms: Date.now() - t0, status: aiStatus_() };
    });
  });
}

// ======================= TemplateData.gs =======================
/**
 * KasirWarung AI — TemplateData.gs
 * 300-item grocery template (generated by tools/build_template.py — do not edit by hand).
 * Prices are per unit; bundle/wholesale prices apply when qty >= bundle_qty / wholesale_qty.
 * Stock is 0: record real stock with Stok Masuk or edit the CSV before importing.
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const GROCERY_TEMPLATE_CSV = `barcode,name,category,unit,price_retail,price_bundle,bundle_qty,price_wholesale,wholesale_qty,cost_price,stock,min_stock,expiry_date
2009000000018,Beras Medium Curah,Sembako,kg,13500,13200,5,12850,25,11900,0,10,
2009000000025,Beras Premium Curah,Sembako,kg,15500,15150,5,14800,25,13650,0,10,
2009000000032,Beras Ketan Putih Curah,Sembako,kg,22000,21550,5,21000,25,19350,0,10,
8991001000019,Beras Pandan Wangi 5 kg,Sembako,pcs,78000,76800,2,75250,5,70200,0,3,
8991001000026,Beras Rojolele 5 kg,Sembako,pcs,82000,80750,2,79100,5,73800,0,3,
8991001000033,Beras Sania Premium 5 kg,Sembako,pcs,80000,78800,2,77200,5,72000,0,3,
8991001000040,Beras Topi Koki 5 kg,Sembako,pcs,79000,77800,2,76200,5,71100,0,3,
8991001000057,Beras SPHP Bulog 5 kg,Sembako,pcs,62500,61550,2,60300,5,56250,0,3,
8991001000064,Minyakita Minyak Goreng 1 L,Sembako,liter,15700,15450,6,15150,12,14150,0,6,
2009000000049,Minyak Goreng Curah,Sembako,liter,17000,16700,6,16400,12,15300,0,6,
8991001000071,Bimoli Minyak Goreng 1 L,Sembako,pcs,21000,20150,3,19300,12,17650,0,10,
8991001000088,Bimoli Minyak Goreng 2 L,Sembako,pcs,40500,38850,3,37250,12,34000,0,10,
8991001000095,Sania Minyak Goreng 1 L,Sembako,pcs,20000,19200,3,18400,12,16800,0,10,
8991001000101,Sania Minyak Goreng 2 L,Sembako,pcs,38500,36950,3,35400,12,32350,0,10,
8991001000118,Filma Minyak Goreng 2 L,Sembako,pcs,39500,37900,3,36300,12,33200,0,10,
8991001000125,Fortune Minyak Goreng 1 L,Sembako,pcs,19500,18700,3,17900,12,16400,0,10,
8991001000132,Fortune Minyak Goreng 2 L,Sembako,pcs,37500,36000,3,34500,12,31500,0,10,
8991001000149,Tropical Minyak Goreng 2 L,Sembako,pcs,39000,37400,3,35850,12,32750,0,10,
2009000000056,Gula Pasir Curah,Sembako,kg,17500,17150,5,16700,25,15400,0,10,
8991001000156,Gulaku Gula Pasir 1 kg,Sembako,pcs,18500,17750,3,17000,12,15550,0,10,
8991001000163,Rose Brand Gula Pasir 1 kg,Sembako,pcs,18000,17250,3,16550,12,15100,0,10,
2009000000063,Gula Merah Jawa,Sembako,kg,24000,23500,5,22900,25,21100,0,10,
2009000000070,Telur Ayam Negeri,Sembako,kg,29000,28400,5,27650,25,25500,0,10,
8991001000170,Telur Ayam Kampung,Sembako,pcs,2500,2400,3,2300,12,2100,0,10,
8991001000187,Telur Bebek,Sembako,pcs,3500,3350,3,3200,12,2950,0,10,
8991001000194,Tepung Terigu Segitiga Biru 1 kg,Sembako,pcs,14000,13400,3,12850,12,11750,0,10,
8991001000200,Tepung Terigu Cakra Kembar 1 kg,Sembako,pcs,15000,14400,3,13800,12,12600,0,10,
8991001000217,Tepung Terigu Kunci Biru 1 kg,Sembako,pcs,13500,12950,3,12400,12,11350,0,10,
8991001000224,Tepung Beras Rose Brand 500 g,Sembako,pcs,8500,8150,3,7800,12,7150,0,10,
8991001000231,Tepung Tapioka Rose Brand 500 g,Sembako,pcs,7500,7200,3,6900,12,6300,0,10,
8991001000248,Sajiku Tepung Bumbu 80 g,Sembako,pcs,3000,2850,3,2750,12,2500,0,10,
8991001000255,Kobe Tepung Bumbu Serbaguna 75 g,Sembako,pcs,3000,2850,3,2750,12,2500,0,10,
8991001000262,Indomie Goreng 85 g,Sembako,pcs,3500,3300,5,3150,40,2950,0,40,
8991001000279,Indomie Soto Mie 70 g,Sembako,pcs,3200,3000,5,2850,40,2700,0,40,
8991001000286,Indomie Ayam Bawang 69 g,Sembako,pcs,3200,3000,5,2850,40,2700,0,40,
8991001000293,Indomie Kari Ayam 72 g,Sembako,pcs,3400,3200,5,3050,40,2850,0,40,
8991001000309,Indomie Rendang 91 g,Sembako,pcs,3700,3500,5,3300,40,3100,0,40,
8991001000316,Indomie Goreng Aceh 90 g,Sembako,pcs,3700,3500,5,3300,40,3100,0,40,
8991001000323,Indomie Goreng Jumbo 129 g,Sembako,pcs,4500,4250,5,4050,40,3800,0,40,
8991001000330,Mie Sedaap Goreng 90 g,Sembako,pcs,3500,3300,5,3150,40,2950,0,40,
8991001000347,Mie Sedaap Soto 75 g,Sembako,pcs,3200,3000,5,2850,40,2700,0,40,
8991001000354,Mie Sedaap Kari Spesial 87 g,Sembako,pcs,3400,3200,5,3050,40,2850,0,40,
8991001000361,Mie Sedaap Korean Spicy Chicken,Sembako,pcs,4500,4250,5,4050,40,3800,0,40,
8991001000378,Sarimi Isi 2 Ayam Kecap,Sembako,pcs,4000,3800,5,3600,40,3350,0,40,
8991001000385,Supermi Ayam Bawang 75 g,Sembako,pcs,3000,2850,5,2700,40,2500,0,40,
8991001000392,Pop Mie Rasa Ayam 75 g,Sembako,pcs,6000,5750,3,5500,12,5050,0,10,
8991001000408,Pop Mie Rasa Baso 75 g,Sembako,pcs,6000,5750,3,5500,12,5050,0,10,
8991001000415,Mie Telur Cap 3 Ayam 200 g,Sembako,pcs,5500,5250,3,5050,12,4600,0,10,
8991001000422,Bihun Jagung Padamu 175 g,Sembako,pcs,5000,4800,3,4600,12,4200,0,10,
8991001000439,Garam Refina 250 g,Sembako,pcs,3500,3350,3,3200,12,2950,0,10,
8991001000446,Garam Dapur Cap Kapal 500 g,Sembako,pcs,3000,2850,3,2750,12,2500,0,10,
8991001000453,Royco Kaldu Ayam 8 g (isi 12),Sembako,renteng,6000,5850,3,5700,12,5200,0,5,
8991001000460,Masako Kaldu Ayam 9 g (isi 12),Sembako,renteng,6000,5850,3,5700,12,5200,0,5,
8991001000477,Masako Kaldu Sapi 9 g (isi 12),Sembako,renteng,6000,5850,3,5700,12,5200,0,5,
8991001000484,Sasa Penyedap 100 g,Sembako,pcs,5500,5250,3,5050,12,4600,0,10,
8991001000491,Ajinomoto 100 g,Sembako,pcs,6000,5750,3,5500,12,5050,0,10,
8991001000507,Kecap Manis Bango 220 ml,Sembako,pcs,11000,10550,3,10100,12,9250,0,10,
8991001000514,Kecap Manis Bango 520 ml,Sembako,pcs,23000,22050,3,21150,12,19300,0,10,
8991001000521,Kecap Manis ABC 135 ml,Sembako,pcs,6500,6200,3,5950,12,5450,0,10,
8991001000538,Kecap Manis Sedaap 200 ml,Sembako,pcs,9000,8600,3,8250,12,7550,0,10,
8991001000545,Saus Sambal ABC 135 ml,Sembako,pcs,8500,8150,3,7800,12,7150,0,10,
8991001000552,Saus Sambal Indofood 135 ml,Sembako,pcs,8000,7650,3,7350,12,6700,0,10,
8991001000569,Saus Tomat ABC 135 ml,Sembako,pcs,7500,7200,3,6900,12,6300,0,10,
8991001000576,Terasi Udang ABC 4 g (isi 10),Sembako,renteng,5000,4900,3,4750,12,4350,0,5,
8991001000583,Bumbu Racik Nasi Goreng Indofood,Sembako,pcs,3000,2850,3,2750,12,2500,0,10,
2009000000087,Bawang Merah,Sembako,kg,38000,37200,5,36250,25,33450,0,10,
2009000000094,Bawang Putih,Sembako,kg,34000,33300,5,32450,25,29900,0,10,
2009000000100,Cabai Rawit Merah,Sembako,kg,60000,58800,5,57300,25,52800,0,10,
8991001000590,Ladaku Merica Bubuk 4 g (isi 10),Sembako,renteng,5000,4900,3,4750,12,4350,0,5,
8991001000606,Desaku Ketumbar Bubuk 4 g (isi 10),Sembako,renteng,5000,4900,3,4750,12,4350,0,5,
8991001000613,Santan Kara 65 ml,Sembako,pcs,3800,3600,3,3450,12,3200,0,10,
8991001000620,Santan Sasa 65 ml,Sembako,pcs,3500,3350,3,3200,12,2950,0,10,
8991001000637,Susu Kental Manis Frisian Flag 370 g,Sembako,pcs,13500,12950,3,12400,12,11350,0,10,
8991001000644,Susu Kental Manis Indomilk 370 g,Sembako,pcs,12500,12000,3,11500,12,10500,0,10,
8991001000651,Susu Kental Manis Frisian Flag Sachet (isi 6),Sembako,renteng,9500,9300,3,9000,12,8250,0,5,
8991001000668,Margarin Blue Band 200 g,Sembako,pcs,10500,10050,3,9650,12,8800,0,10,
8991001000675,Margarin Palmia 200 g,Sembako,pcs,8500,8150,3,7800,12,7150,0,10,
2009000000117,Kacang Hijau Curah,Sembako,kg,26000,25450,5,24800,25,22900,0,10,
2009000000124,Kacang Tanah Curah,Sembako,kg,32000,31350,5,30550,25,28150,0,10,
8991001000682,Sarden ABC Saus Tomat 155 g,Sembako,pcs,11000,10550,3,10100,12,9250,0,10,
8991001000699,Sarden Botan 155 g,Sembako,pcs,11500,11000,3,10550,12,9650,0,10,
8991001000705,Kornet Sapi Pronas 198 g,Sembako,pcs,25000,24000,3,23000,12,21000,0,10,
8992002000015,Aqua Air Mineral 330 ml,Minuman,pcs,3000,2800,6,2600,24,2400,0,24,
8992002000022,Aqua Air Mineral 600 ml,Minuman,pcs,4000,3750,6,3500,24,3200,0,24,
8992002000039,Aqua Air Mineral 1500 ml,Minuman,pcs,7000,6550,6,6150,24,5600,0,24,
8992002000046,Le Minerale 600 ml,Minuman,pcs,4000,3750,6,3500,24,3200,0,24,
8992002000053,Le Minerale 1500 ml,Minuman,pcs,6500,6100,6,5700,24,5200,0,24,
8992002000060,Club Air Mineral 600 ml,Minuman,pcs,3000,2800,6,2600,24,2400,0,24,
8992002000077,Teh Pucuk Harum 350 ml,Minuman,pcs,4000,3750,6,3500,24,3200,0,24,
8992002000084,Teh Botol Sosro 450 ml,Minuman,pcs,5500,5150,6,4800,24,4400,0,24,
8992002000091,Teh Kotak Jasmine 300 ml,Minuman,pcs,4500,4200,6,3950,24,3600,0,24,
8992002000107,Fruit Tea Blackcurrant 500 ml,Minuman,pcs,6000,5600,6,5250,24,4800,0,24,
8992002000114,Frestea Jasmine 500 ml,Minuman,pcs,5500,5150,6,4800,24,4400,0,24,
8992002000121,Teh Gelas Original 170 ml,Minuman,pcs,1500,1400,6,1300,24,1200,0,24,
8992002000138,Coca-Cola 390 ml,Minuman,pcs,6500,6100,6,5700,24,5200,0,24,
8992002000145,Sprite 390 ml,Minuman,pcs,6500,6100,6,5700,24,5200,0,24,
8992002000152,Fanta Stroberi 390 ml,Minuman,pcs,6500,6100,6,5700,24,5200,0,24,
8992002000169,Pocari Sweat 500 ml,Minuman,pcs,8000,7500,6,7000,24,6400,0,24,
8992002000176,Mizone Lychee Lemon 500 ml,Minuman,pcs,6000,5600,6,5250,24,4800,0,24,
8992002000183,Minute Maid Pulpy Orange 300 ml,Minuman,pcs,7000,6550,6,6150,24,5600,0,24,
8992002000190,Floridina Orange 360 ml,Minuman,pcs,4000,3750,6,3500,24,3200,0,24,
8992002000206,Ale-Ale Jeruk 200 ml,Minuman,pcs,1500,1400,6,1300,24,1200,0,24,
8992002000213,Kapal Api Special Mix 10x24 g,Minuman,renteng,14500,14200,3,13750,12,12600,0,5,
8992002000220,Kopi Kapal Api Special 165 g,Minuman,pcs,14500,13600,6,12750,24,11600,0,24,
8992002000237,Kopi ABC Susu 10x31 g,Minuman,renteng,15000,14700,3,14250,12,13050,0,5,
8992002000244,Good Day Cappuccino 10x25 g,Minuman,renteng,17000,16650,3,16150,12,14800,0,5,
8992002000251,Good Day Mocacinno 10x20 g,Minuman,renteng,16500,16150,3,15650,12,14350,0,5,
8992002000268,Luwak White Koffie 10x20 g,Minuman,renteng,15500,15150,3,14700,12,13500,0,5,
8992002000275,Torabika Cappuccino 10x25 g,Minuman,renteng,17500,17150,3,16600,12,15200,0,5,
8992002000282,Indocafe Coffeemix 10x20 g,Minuman,renteng,14500,14200,3,13750,12,12600,0,5,
8992002000299,Nescafe Classic 10x2 g,Minuman,renteng,12000,11750,3,11400,12,10450,0,5,
8992002000305,TOP Kopi Susu 10x25 g,Minuman,renteng,12500,12250,3,11850,12,10900,0,5,
8992002000312,Teh Celup Sariwangi isi 25,Minuman,pcs,7000,6550,6,6150,24,5600,0,24,
8992002000329,Teh Celup Tong Tji isi 25,Minuman,pcs,8500,7950,6,7450,24,6800,0,24,
8992002000336,Teh Celup Sosro isi 30,Minuman,pcs,8000,7500,6,7000,24,6400,0,24,
8992002000343,Milo Sachet 10x22 g,Minuman,renteng,17000,16650,3,16150,12,14800,0,5,
8992002000350,Energen Coklat 10x30 g,Minuman,renteng,16000,15650,3,15200,12,13900,0,5,
8992002000367,Energen Vanila 10x30 g,Minuman,renteng,16000,15650,3,15200,12,13900,0,5,
8992002000374,Nutrisari Jeruk Peras 10x14 g,Minuman,renteng,12000,11750,3,11400,12,10450,0,5,
8992002000381,Pop Ice Coklat 10x25 g,Minuman,renteng,10000,9800,3,9500,12,8700,0,5,
8992002000398,Dancow Fortigro Instant 800 g,Minuman,pcs,105000,103400,2,101300,5,94500,0,3,
8992002000404,Bear Brand Susu Steril 189 ml,Minuman,pcs,10500,9850,6,9200,24,8400,0,24,
8992002000411,Ultra Milk Coklat 250 ml,Minuman,pcs,7000,6550,6,6150,24,5600,0,24,
8992002000428,Ultra Milk Full Cream 1 L,Minuman,pcs,20000,18800,6,17600,24,16000,0,24,
8992002000435,Indomilk Kotak Coklat 190 ml,Minuman,pcs,4500,4200,6,3950,24,3600,0,24,
8992002000442,Frisian Flag UHT Coklat 225 ml,Minuman,pcs,6000,5600,6,5250,24,4800,0,24,
8992002000459,Yakult isi 5,Minuman,pcs,11000,10300,6,9650,24,8800,0,24,
8992002000466,Cimory Yogurt Drink 250 ml,Minuman,pcs,9500,8900,6,8350,24,7600,0,24,
8992002000473,Kratingdaeng 150 ml,Minuman,pcs,7000,6550,6,6150,24,5600,0,24,
8992002000480,Extra Joss 6x4 g,Minuman,renteng,12000,11750,3,11400,12,10450,0,5,
8992002000497,Hemaviton Jreng 6x4 g,Minuman,renteng,12000,11750,3,11400,12,10450,0,5,
8992002000503,Adem Sari Chingku 350 ml,Minuman,pcs,7000,6550,6,6150,24,5600,0,24,
8992002000510,Marjan Sirup Cocopandan 460 ml,Minuman,pcs,23000,21600,6,20200,24,18400,0,24,
8992002000527,ABC Sirup Squash Jeruk 460 ml,Minuman,pcs,22000,20650,6,19350,24,17600,0,24,
8993003000011,Gudang Garam Surya 12,Rokok,pcs,27000,26700,5,26300,10,25100,0,10,
8993003000028,Gudang Garam Surya 16,Rokok,pcs,34500,34150,5,33600,10,32100,0,10,
8993003000035,Gudang Garam Filter International 12,Rokok,pcs,24500,24250,5,23850,10,22800,0,10,
8993003000042,Gudang Garam Merah 12,Rokok,pcs,20000,19800,5,19500,10,18600,0,10,
8993003000059,Sampoerna A Mild 16,Rokok,pcs,34000,33650,5,33150,10,31600,0,10,
8993003000066,Sampoerna A Mild 12,Rokok,pcs,26000,25700,5,25350,10,24200,0,10,
8993003000073,Sampoerna Kretek 12,Rokok,pcs,17500,17300,5,17050,10,16300,0,10,
8993003000080,Sampoerna U Mild 16,Rokok,pcs,26000,25700,5,25350,10,24200,0,10,
8993003000097,Dji Sam Soe Kretek 12,Rokok,pcs,22000,21750,5,21450,10,20450,0,10,
8993003000103,Dji Sam Soe Magnum Filter 12,Rokok,pcs,27000,26700,5,26300,10,25100,0,10,
8993003000110,Djarum Super 12,Rokok,pcs,26500,26200,5,25800,10,24650,0,10,
8993003000127,Djarum Super MLD 16,Rokok,pcs,31000,30650,5,30200,10,28850,0,10,
8993003000134,Djarum 76 Kretek 12,Rokok,pcs,17500,17300,5,17050,10,16300,0,10,
8993003000141,Djarum Coklat 12,Rokok,pcs,16500,16300,5,16050,10,15350,0,10,
8993003000158,LA Lights 16,Rokok,pcs,32000,31650,5,31200,10,29750,0,10,
8993003000165,LA Bold 20,Rokok,pcs,36500,36100,5,35550,10,33950,0,10,
8993003000172,Marlboro Merah 20,Rokok,pcs,42500,42050,5,41400,10,39500,0,10,
8993003000189,Marlboro Filter Black 20,Rokok,pcs,37500,37100,5,36550,10,34900,0,10,
8993003000196,Marlboro Ice Burst 16,Rokok,pcs,38000,37600,5,37050,10,35350,0,10,
8993003000202,Class Mild 16,Rokok,pcs,30000,29700,5,29250,10,27900,0,10,
8993003000219,Esse Change 16,Rokok,pcs,34000,33650,5,33150,10,31600,0,10,
8993003000226,Esse Mild 16,Rokok,pcs,31000,30650,5,30200,10,28850,0,10,
8993003000233,Magnum Filter 12,Rokok,pcs,27000,26700,5,26300,10,25100,0,10,
8993003000240,Dunhill Filter 16,Rokok,pcs,32500,32150,5,31650,10,30200,0,10,
8993003000257,Lucky Strike Filter 16,Rokok,pcs,30000,29700,5,29250,10,27900,0,10,
8993003000264,Camel Filter 16,Rokok,pcs,29500,29200,5,28750,10,27450,0,10,
8993003000271,Wismilak Diplomat 12,Rokok,pcs,23000,22750,5,22400,10,21400,0,10,
8993003000288,Sukun Kretek 12,Rokok,pcs,15000,14850,5,14600,10,13950,0,10,
8994004000017,Chitato Sapi Panggang 68 g,Snack,pcs,11500,11000,3,10550,12,9650,0,10,
8994004000024,Chitato Keju Supreme 68 g,Snack,pcs,11500,11000,3,10550,12,9650,0,10,
8994004000031,Lay's Rumput Laut 68 g,Snack,pcs,11500,11000,3,10550,12,9650,0,10,
8994004000048,Qtela Singkong Balado 60 g,Snack,pcs,8500,8150,3,7800,12,7150,0,10,
8994004000055,Qtela Tempe Original 55 g,Snack,pcs,8500,8150,3,7800,12,7150,0,10,
8994004000062,Taro Net Seaweed 65 g,Snack,pcs,7500,7200,3,6900,12,6300,0,10,
8994004000079,Cheetos Jagung Bakar 40 g,Snack,pcs,5500,5250,3,5050,12,4600,0,10,
8994004000086,Chiki Balls Keju 55 g,Snack,pcs,6500,6200,3,5950,12,5450,0,10,
8994004000093,Potabee BBQ 68 g,Snack,pcs,11000,10550,3,10100,12,9250,0,10,
8994004000109,Kusuka Keripik Singkong Balado 180 g,Snack,pcs,10000,9600,3,9200,12,8400,0,10,
8994004000116,Beng-Beng 20 g,Snack,pcs,2500,2400,3,2300,12,2100,0,10,
8994004000123,SilverQueen Almond 58 g,Snack,pcs,16500,15800,3,15150,12,13850,0,10,
8994004000130,Cadbury Dairy Milk 62 g,Snack,pcs,15000,14400,3,13800,12,12600,0,10,
8994004000147,TOP Coklat 9 g,Snack,pcs,2000,1900,3,1800,12,1700,0,10,
8994004000154,Oreo Vanilla 133 g,Snack,pcs,9500,9100,3,8700,12,8000,0,10,
8994004000161,Oreo Chocolate Cream 133 g,Snack,pcs,9500,9100,3,8700,12,8000,0,10,
8994004000178,Roma Kelapa 300 g,Snack,pcs,11000,10550,3,10100,12,9250,0,10,
8994004000185,Roma Malkist Crackers 105 g,Snack,pcs,6500,6200,3,5950,12,5450,0,10,
8994004000192,Biskuat Coklat 134 g,Snack,pcs,6500,6200,3,5950,12,5450,0,10,
8994004000208,Tango Wafer Coklat 130 g,Snack,pcs,9500,9100,3,8700,12,8000,0,10,
8994004000215,Nabati Richeese Wafer 50 g,Snack,pcs,2500,2400,3,2300,12,2100,0,10,
8994004000222,Good Time Chocochips 72 g,Snack,pcs,8000,7650,3,7350,12,6700,0,10,
8994004000239,Chocolatos Wafer Roll 24 g,Snack,pcs,2000,1900,3,1800,12,1700,0,10,
8994004000246,Gery Saluut Malkist Coklat 100 g,Snack,pcs,5500,5250,3,5050,12,4600,0,10,
8994004000253,Better Vanilla 100 g,Snack,pcs,5500,5250,3,5050,12,4600,0,10,
8994004000260,Kacang Garuda Kulit 200 g,Snack,pcs,15000,14400,3,13800,12,12600,0,10,
8994004000277,Kacang Atom Garuda 100 g,Snack,pcs,7500,7200,3,6900,12,6300,0,10,
8994004000284,Sukro Kacang Oven 100 g,Snack,pcs,6500,6200,3,5950,12,5450,0,10,
8994004000291,Pilus Garuda Tic Tac 95 g,Snack,pcs,5500,5250,3,5050,12,4600,0,10,
8994004000307,Momogi Jagung Bakar 8 g,Snack,pcs,1000,950,3,900,12,850,0,10,
8994004000314,Tos Tos Nacho Cheese 140 g,Snack,pcs,10000,9600,3,9200,12,8400,0,10,
8994004000321,Kerupuk Udang Finna 100 g,Snack,pcs,9000,8600,3,8250,12,7550,0,10,
8994004000338,Sari Roti Tawar Kupas,Snack,pcs,22000,21100,3,20200,12,18500,0,10,
8994004000345,Sari Roti Sobek Coklat,Snack,pcs,16000,15350,3,14700,12,13450,0,10,
8994004000352,Sari Roti Sandwich Coklat,Snack,pcs,5500,5250,3,5050,12,4600,0,10,
8994004000369,Roti Aoka Coklat,Snack,pcs,3000,2850,3,2750,12,2500,0,10,
8994004000376,Permen Kopiko 150 g,Snack,pcs,10000,9600,3,9200,12,8400,0,10,
8994004000383,Permen Relaxa 125 g,Snack,pcs,8000,7650,3,7350,12,6700,0,10,
8994004000390,Permen Milkita 30 pcs,Snack,pcs,10000,9600,3,9200,12,8400,0,10,
8994004000406,Mentos Mint Roll,Snack,pcs,3000,2850,3,2750,12,2500,0,10,
8994004000413,Yupi Gummy 20 g,Snack,pcs,3000,2850,3,2750,12,2500,0,10,
8994004000420,Selai Morin Strawberry 150 g,Snack,pcs,20000,19200,3,18400,12,16800,0,10,
8995005000013,Sabun Mandi Lifebuoy Merah 110 g,Toiletries,pcs,5000,4800,3,4600,12,4200,0,10,
8995005000020,Lifebuoy Body Wash Refill 450 ml,Toiletries,pcs,25000,24000,3,23000,12,21000,0,10,
8995005000037,Sabun Lux Batang 110 g,Toiletries,pcs,5000,4800,3,4600,12,4200,0,10,
8995005000044,Sabun Giv Batang 76 g,Toiletries,pcs,3500,3350,3,3200,12,2950,0,10,
8995005000051,Sabun Nuvo Batang 72 g,Toiletries,pcs,3500,3350,3,3200,12,2950,0,10,
8995005000068,Sabun Dettol Batang 105 g,Toiletries,pcs,6500,6200,3,5950,12,5450,0,10,
8995005000075,Biore Body Foam Refill 450 ml,Toiletries,pcs,26000,24950,3,23900,12,21850,0,10,
8995005000082,Sunsilk Black Shine 170 ml,Toiletries,pcs,26000,24950,3,23900,12,21850,0,10,
8995005000099,Sunsilk Sachet (isi 12),Toiletries,renteng,6000,5850,3,5700,12,5200,0,5,
8995005000105,Pantene Sachet (isi 12),Toiletries,renteng,7000,6850,3,6650,12,6100,0,5,
8995005000112,Clear Men Sachet (isi 12),Toiletries,renteng,7500,7350,3,7100,12,6500,0,5,
8995005000129,Lifebuoy Shampoo 170 ml,Toiletries,pcs,22000,21100,3,20200,12,18500,0,10,
8995005000136,Pepsodent 190 g,Toiletries,pcs,13500,12950,3,12400,12,11350,0,10,
8995005000143,Pepsodent 75 g,Toiletries,pcs,6500,6200,3,5950,12,5450,0,10,
8995005000150,Ciptadent 190 g,Toiletries,pcs,10000,9600,3,9200,12,8400,0,10,
8995005000167,Close Up 160 g,Toiletries,pcs,14000,13400,3,12850,12,11750,0,10,
8995005000174,Formula Pasta Gigi 190 g,Toiletries,pcs,12000,11500,3,11000,12,10100,0,10,
8995005000181,Sikat Gigi Formula Soft,Toiletries,pcs,5000,4800,3,4600,12,4200,0,10,
8995005000198,Rinso Anti Noda 770 g,Toiletries,pcs,24000,23000,3,22050,12,20150,0,10,
8995005000204,Rinso Cair 800 ml,Toiletries,pcs,18000,17250,3,16550,12,15100,0,10,
8995005000211,Rinso Sachet (isi 6),Toiletries,renteng,12000,11750,3,11400,12,10450,0,5,
8995005000228,So Klin Pembersih Lantai 800 ml,Toiletries,pcs,12500,12000,3,11500,12,10500,0,10,
8995005000235,So Klin Softergent 770 g,Toiletries,pcs,21000,20150,3,19300,12,17650,0,10,
8995005000242,Daia Deterjen Putih 850 g,Toiletries,pcs,20000,19200,3,18400,12,16800,0,10,
8995005000259,Attack Easy 800 g,Toiletries,pcs,22000,21100,3,20200,12,18500,0,10,
8995005000266,Sunlight Jeruk Nipis 755 ml,Toiletries,pcs,18500,17750,3,17000,12,15550,0,10,
8995005000273,Sunlight Jeruk Nipis 210 ml,Toiletries,pcs,5000,4800,3,4600,12,4200,0,10,
8995005000280,Mama Lemon 780 ml,Toiletries,pcs,17000,16300,3,15600,12,14300,0,10,
8995005000297,Molto Pewangi Refill 800 ml,Toiletries,pcs,21000,20150,3,19300,12,17650,0,10,
8995005000303,Molto Sachet (isi 6),Toiletries,renteng,7000,6850,3,6650,12,6100,0,5,
8995005000310,Downy Pewangi Refill 720 ml,Toiletries,pcs,28000,26850,3,25750,12,23500,0,10,
8995005000327,Wipol Karbol 780 ml,Toiletries,pcs,13500,12950,3,12400,12,11350,0,10,
8995005000334,Harpic Pembersih Kloset 450 ml,Toiletries,pcs,17000,16300,3,15600,12,14300,0,10,
8995005000341,Bayclin Pemutih 500 ml,Toiletries,pcs,9500,9100,3,8700,12,8000,0,10,
8995005000358,Vixal Pembersih Porselen 780 ml,Toiletries,pcs,13000,12450,3,11950,12,10900,0,10,
8995005000365,Stella Pengharum Ruangan 70 g,Toiletries,pcs,11000,10550,3,10100,12,9250,0,10,
8995005000372,Softex Daun Sirih 20 pcs,Toiletries,pcs,11500,11000,3,10550,12,9650,0,10,
8995005000389,Charm Extra Maxi 10 pcs,Toiletries,pcs,12000,11500,3,11000,12,10100,0,10,
8995005000396,Laurier Relax Night 8 pcs,Toiletries,pcs,10500,10050,3,9650,12,8800,0,10,
8995005000402,MamyPoko Pants M 20 pcs,Toiletries,pcs,55000,54150,2,53050,5,49500,0,3,
8995005000419,Sweety Silver Pants L 20 pcs,Toiletries,pcs,52000,51200,2,50150,5,46800,0,3,
8995005000426,Rexona Men Roll On 50 ml,Toiletries,pcs,19000,18200,3,17450,12,15950,0,10,
8995005000433,Marina Hand Body Lotion 200 ml,Toiletries,pcs,13000,12450,3,11950,12,10900,0,10,
8995005000440,Citra Hand Body Lotion 230 ml,Toiletries,pcs,17000,16300,3,15600,12,14300,0,10,
8995005000457,Zwitsal Baby Oil 100 ml,Toiletries,pcs,18000,17250,3,16550,12,15100,0,10,
8995005000464,Minyak Telon Konicare 60 ml,Toiletries,pcs,17000,16300,3,15600,12,14300,0,10,
8995005000471,Minyak Kayu Putih Cap Lang 60 ml,Toiletries,pcs,22500,21600,3,20700,12,18900,0,10,
8995005000488,Tissue Paseo 250 Sheets,Toiletries,pcs,15500,14850,3,14250,12,13000,0,10,
8995005000495,Tissue Nice 180 Sheets,Toiletries,pcs,9000,8600,3,8250,12,7550,0,10,
8995005000501,Tissue Basah Mitu 50 pcs,Toiletries,pcs,13000,12450,3,11950,12,10900,0,10,
8995005000518,Sabun Colek Ekonomi 400 g,Toiletries,pcs,7000,6700,3,6400,12,5900,0,10,
8996006000019,Gas LPG 3 kg (Isi Ulang),Gas & Air,pcs,22000,0,0,0,0,18900,0,5,
8996006000026,"Bright Gas 5,5 kg (Isi Ulang)",Gas & Air,pcs,98000,0,0,0,0,84300,0,5,
8996006000033,Gas LPG 12 kg (Isi Ulang),Gas & Air,pcs,205000,0,0,0,0,176300,0,5,
8996006000040,Tabung LPG 3 kg + Isi (Baru),Gas & Air,pcs,180000,0,0,0,0,154800,0,5,
8996006000057,Aqua Galon 19 L (Isi Ulang),Gas & Air,pcs,21000,0,0,0,0,18050,0,5,
8996006000064,Le Minerale Galon 15 L (Isi Ulang),Gas & Air,pcs,20000,0,0,0,0,17200,0,5,
8996006000071,Club Galon 19 L (Isi Ulang),Gas & Air,pcs,17000,0,0,0,0,14600,0,5,
8996006000088,Cleo Galon 19 L (Isi Ulang),Gas & Air,pcs,20000,0,0,0,0,17200,0,5,
8996006000095,Vit Galon 19 L (Isi Ulang),Gas & Air,pcs,17000,0,0,0,0,14600,0,5,
8996006000101,Air Isi Ulang Depot per Galon,Gas & Air,pcs,6000,0,0,0,0,5150,0,5,
8996006000118,Galon Kosong Aqua (Jaminan),Gas & Air,pcs,45000,0,0,0,0,38700,0,5,
8997007000015,Korek Api Gas Tokai,Lainnya,pcs,3000,2850,3,2750,12,2500,0,10,
8997007000022,Korek Api Kayu Cap Tiga (isi 10),Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000039,Lilin Batang Kecil (isi 10),Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000046,Baterai ABC AA isi 2,Lainnya,pcs,7000,6700,3,6400,12,5900,0,10,
8997007000053,Baterai ABC Alkaline AA isi 2,Lainnya,pcs,15000,14400,3,13800,12,12600,0,10,
8997007000060,Baterai ABC AAA isi 2,Lainnya,pcs,7000,6700,3,6400,12,5900,0,10,
8997007000077,Obat Nyamuk Bakar Baygon (isi 10),Lainnya,pcs,7500,7200,3,6900,12,6300,0,10,
8997007000084,HIT Aerosol 600 ml,Lainnya,pcs,36000,34550,3,33100,12,30250,0,10,
8997007000091,Autan Lotion Sachet (isi 6),Lainnya,renteng,6000,5850,3,5700,12,5200,0,5,
8997007000107,Tolak Angin Cair Sachet,Lainnya,pcs,4000,3800,3,3650,12,3350,0,10,
8997007000114,Antangin JRG Sachet,Lainnya,pcs,4000,3800,3,3650,12,3350,0,10,
8997007000121,Bodrex Strip 4 Tablet,Lainnya,pcs,3000,2850,3,2750,12,2500,0,10,
8997007000138,Paramex Strip 4 Tablet,Lainnya,pcs,3000,2850,3,2750,12,2500,0,10,
8997007000145,Promag Strip 12 Tablet,Lainnya,pcs,10000,9600,3,9200,12,8400,0,10,
8997007000152,Mixagrip Flu Strip 4 Kaplet,Lainnya,pcs,3000,2850,3,2750,12,2500,0,10,
8997007000169,Panadol Biru Strip 10 Kaplet,Lainnya,pcs,12500,12000,3,11500,12,10500,0,10,
8997007000176,Oskadon Strip 4 Tablet,Lainnya,pcs,3000,2850,3,2750,12,2500,0,10,
8997007000183,Diapet Strip 4 Kapsul,Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000190,Balsem Geliga 20 g,Lainnya,pcs,11000,10550,3,10100,12,9250,0,10,
8997007000206,Koyo Cabe Hansaplast,Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000213,Kantong Plastik Kresek Hitam 15,Lainnya,pcs,7000,6700,3,6400,12,5900,0,10,
8997007000220,Plastik Klip Ukuran Sedang (isi 100),Lainnya,pcs,8000,7650,3,7350,12,6700,0,10,
8997007000237,Karet Gelang 100 g,Lainnya,pcs,6000,5750,3,5500,12,5050,0,10,
8997007000244,Sedotan Plastik (isi 100),Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000251,Kertas Nasi Coklat (isi 100),Lainnya,pcs,12000,11500,3,11000,12,10100,0,10,
8997007000268,Sendok Plastik (isi 50),Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000275,Gelas Plastik Cup 16 oz (isi 50),Lainnya,pcs,10000,9600,3,9200,12,8400,0,10,
8997007000282,Pulpen Standard AE7,Lainnya,pcs,2500,2400,3,2300,12,2100,0,10,
8997007000299,Buku Tulis Sidu 38 Lembar,Lainnya,pcs,4000,3800,3,3650,12,3350,0,10,
8997007000305,Lem Castol 30 g,Lainnya,pcs,3000,2850,3,2750,12,2500,0,10,
8997007000312,Isolasi Bening Nachi,Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000329,Kapur Barus Bagus (isi 6),Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
8997007000336,Obat Nyamuk Semprot Baygon 600 ml,Lainnya,pcs,38000,36450,3,34950,12,31900,0,10,
8997007000343,Spons Cuci Piring Scotch-Brite,Lainnya,pcs,5000,4800,3,4600,12,4200,0,10,
`;
