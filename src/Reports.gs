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
