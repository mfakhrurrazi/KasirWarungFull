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
