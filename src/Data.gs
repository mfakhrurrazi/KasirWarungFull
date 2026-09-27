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
  const keyCol = need.length ? idx[need[0]] + 1 : 1;
  return { name: name, sheet: sh, headers: headers, idx: idx, lastRow: lastDataRow_(sh, keyCol), rows: null };
}

/**
 * Last row that holds a record, judged by the key column (first schema column:
 * product_id, username, key, timestamp…). getLastRow() alone is not reliable:
 * checkbox cells hold FALSE even on empty rows.
 */
function lastDataRow_(sh, keyCol) {
  const last = sh.getLastRow();
  if (last < 2) return last;
  const vals = sh.getRange(2, keyCol, last - 1, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i][0];
    if (v !== '' && v !== null && v !== false) return i + 2;
  }
  return 1;
}

function checkboxRule_() {
  return SpreadsheetApp.newDataValidation().requireCheckbox().build();
}

/** Checkbox validation only on rows that hold data (never on empty rows). */
function applyCheckboxes_(t, fromRow, numRows) {
  if (numRows < 1) return;
  const types = (SCHEMA[t.name] && SCHEMA[t.name].types) || {};
  Object.keys(types).forEach(function (col) {
    if (types[col] !== 'bool' || !(col in t.idx)) return;
    t.sheet.getRange(fromRow, t.idx[col] + 1, numRows, 1).setDataValidation(checkboxRule_());
  });
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
  const start = Math.max(t.lastRow, 1) + 1;
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
  applyCheckboxes_(t, start, objs.length);
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
  if (last < 2) return;
  const range = sh.getRange(2, 1, last - 1, sh.getLastColumn());
  range.clearDataValidations(); // checkboxes first, otherwise cleared cells stay FALSE
  range.clearContent();
  if (typeof applyValidations_ === 'function') applyValidations_(sh, name, 2, sh.getMaxRows() - 1);
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

/**
 * Products list, cached 5 minutes for speed. The cache is cleared by every
 * write in the app and by onDbEdit() when someone edits the sheet by hand;
 * fresh=true always reads the sheet.
 */
function productsAll_(fresh) {
  let list = fresh ? null : cacheGetJSON_(CACHE_KEYS.PRODUCTS);
  if (list) return list;
  list = readTable_('Products').rows.map(productOut_);
  cachePutJSON_(CACHE_KEYS.PRODUCTS, list, 300);
  return list;
}

function productsForRole_(role, fresh) {
  const list = productsAll_(fresh);
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
