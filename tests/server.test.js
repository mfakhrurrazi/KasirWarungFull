/**
 * Server-side tests for KasirWarung AI running on the in-memory GAS emulator.
 *   TZ=Asia/Jakarta node --test tests/
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');
const { makeKey } = require('../tools/generate-license');

function boot(options) {
  const gas = createGas(options);
  gas.call('setupDatabase');
  return gas;
}
function login(gas, u, p) {
  const r = gas.api('apiLogin', u || 'admin', p || 'admin123');
  assert.equal(r.ok, true, r.error);
  return r.data.token;
}
function ok(r) { assert.equal(r.ok, true, r.error); return r.data; }

test('setupDatabase creates all sheets, headers, formats and 10 sample rows', () => {
  const gas = boot();
  const ss = gas.ss();
  assert.equal(ss.getName(), 'DB_KasirWarung');
  assert.equal(ss.locale, 'id_ID');
  const expected = ['Products', 'Customers', 'Sales', 'Credits', 'StockMoves', 'Users', 'Settings', 'Log_AI', 'Log_Activity'];
  expected.forEach((n) => assert.ok(ss.getSheetByName(n), 'missing ' + n));
  assert.equal(ss.getSheetByName('Sheet1'), null, 'default sheet removed');
  const p = gas.sheet('Products');
  assert.equal(p.get(1, 1), 'product_id');
  assert.equal(p.frozen, 1);
  assert.equal(p.headerBg, '#F97316');
  ['Products', 'Customers', 'Sales', 'Credits', 'Users', 'Settings', 'Log_AI', 'Log_Activity'].forEach((n) => {
    assert.equal(gas.rows(n).length, 10, n + ' should have 10 rows');
  });
  // money / date formats and dropdowns
  assert.equal(p.fmt['2:6'], '"Rp "#,##0');
  assert.equal(p.fmt['2:14'], 'dd/mm/yyyy');
  const cat = p.validations.find((v) => v.col === 4 && v.rule.list);
  assert.equal(cat.rule.list.join(), 'Sembako,Minuman,Rokok,Snack,Toiletries,Gas & Air,Lainnya');
  assert.ok(p.validations.find((v) => v.col === 15 && v.rule.checkbox), 'active checkbox');
  assert.ok(gas.sheet('Sales').validations.find((v) => v.rule.list && v.rule.list.join() === 'Tunai,QRIS,Transfer,Kasbon'));
  assert.ok(gas.sheet('Credits').validations.find((v) => v.rule.list && v.rule.list.join() === 'Belum Lunas,Cicil,Lunas'));
  // protection
  assert.equal(gas.sheet('Users').protections.length, 1);
  assert.equal(gas.sheet('Settings').protections.length, 1);
  assert.equal(gas.sheet('Products').protections.length, 0);
  // settings keys
  const keys = gas.rows('Settings').map((r) => r.key);
  ['BUSINESS_NAME', 'LOGO_URL', 'WHATSAPP', 'TAX_PERCENT', 'AI_ENABLED'].forEach((k) => assert.ok(keys.includes(k)));
});

test('sample data is internally consistent', () => {
  const gas = boot();
  const products = gas.rows('Products');
  const moves = gas.rows('StockMoves');
  products.forEach((p) => {
    assert.match(p.product_id, /^PRD\d{6}-\d{3}$/);
    const sum = moves.filter((m) => m.product_id === p.product_id).reduce((a, m) => a + m.qty, 0);
    assert.equal(Math.round(sum * 100) / 100, p.stock, 'stock ledger for ' + p.name);
  });
  const sales = gas.rows('Sales');
  const credits = gas.rows('Credits');
  sales.forEach((s) => {
    assert.match(s.trx_id, /^TRX\d{6}-\d{3}$/);
    const items = JSON.parse(s.items_json);
    const sub = items.reduce((a, i) => a + i.total, 0);
    assert.equal(sub, s.subtotal);
    assert.equal(s.total, s.subtotal - s.discount);
    if (s.method === 'Kasbon') {
      const k = credits.find((c) => c.trx_id === s.trx_id);
      assert.ok(k, 'kasbon credit for ' + s.trx_id);
      assert.equal(k.amount, s.total - s.paid);
    }
  });
  credits.forEach((c) => assert.match(c.credit_id, /^KSB\d{6}-\d{3}$/));
  gas.rows('Customers').forEach((c) => assert.match(c.customer_id, /^PLG\d{6}-\d{3}$/));
  const admin = gas.rows('Users').find((u) => u.username === 'admin');
  assert.equal(admin.role, 'Owner');
  assert.equal(admin.active, true);
  assert.equal(admin.password_hash.length, 64);
});

test('setupDatabase is idempotent', () => {
  const gas = boot();
  const before = ['Products', 'Sales', 'Users', 'Settings', 'StockMoves'].map((n) => gas.rows(n).length);
  gas.resetMemo();
  gas.call('setupDatabase');
  const after = ['Products', 'Sales', 'Users', 'Settings', 'StockMoves'].map((n) => gas.rows(n).length);
  assert.deepEqual(after, before);
  assert.equal(gas.sheet('Users').protections.length, 1, 'protection not duplicated');
});

test('login, lockout and session checks', () => {
  const gas = boot();
  const bad = gas.api('apiLogin', 'admin', 'salah');
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'LOGIN');
  const token = login(gas);
  assert.match(token, /^[a-f0-9]{48}$/);
  const me = ok(gas.api('apiMe', token));
  assert.equal(me.user.role, 'Owner');
  assert.equal(me.perms.dashboard, true);
  assert.equal(gas.api('apiMe', 'nope').code, 'AUTH');
  for (let i = 0; i < 5; i++) gas.api('apiLogin', 'kasir', 'x');
  assert.equal(gas.api('apiLogin', 'kasir', 'kasir123').code, 'LOCKED');
  // expired session
  const raw = JSON.parse(gas.state.cache.get('sess_' + token).v);
  raw.exp = Date.now() - 1;
  gas.state.cache.set('sess_' + token, { v: JSON.stringify(raw) });
  assert.equal(gas.api('apiMe', token).code, 'AUTH');
});

test('role checks are enforced on the server for Kasir', () => {
  const gas = boot();
  const t = login(gas, 'kasir', 'kasir123');
  assert.equal(gas.api('apiDashboard', t).code, 'FORBIDDEN');
  assert.equal(gas.api('apiReport', t, '2026-01-01', '2026-01-31').code, 'FORBIDDEN');
  assert.equal(gas.api('apiSaveProduct', t, { name: 'X', category: 'Sembako', unit: 'pcs', price_retail: 1000 }).code, 'FORBIDDEN');
  assert.equal(gas.api('apiStockIn', t, { items: [] }).code, 'FORBIDDEN');
  assert.equal(gas.api('apiSaveSettings', t, { BUSINESS_NAME: 'X' }).code, 'FORBIDDEN');
  assert.equal(gas.api('apiAiSaranKulakan', t).code, 'FORBIDDEN');
  const prods = ok(gas.api('apiProducts', t));
  assert.equal('cost_price' in prods[0], false, 'kasir must not see cost price');
  const c = ok(gas.api('apiSaveCustomer', t, { name: 'Bu Ani', phone: '081200001111', credit_limit: 999999 }));
  assert.equal(c.limitIgnored, true);
  const cust = gas.rows('Customers').find((x) => x.customer_id === c.customer_id);
  assert.equal(cust.credit_limit, 0);
  assert.equal(cust.phone, '6281200001111');
});

test('20-item sale with kasbon: tier pricing, stock, moves and credit balance', () => {
  const gas = boot();
  const t = login(gas);
  // Start clean with the 300-item template, then stock in 20 products.
  ok(gas.api('apiResetData', t, 'RESET', false));
  const tpl = ok(gas.api('apiTemplateCsv', t)).csv.trim().split('\n');
  const head = tpl.shift().split(',');
  assert.equal(tpl.length, 300);
  const parse = gas.call('parseCsvLine_', tpl[0]);
  assert.equal(parse.length, head.length);
  const rows = tpl.map((l) => { const c = gas.call('parseCsvLine_', l); const o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
  const imp = ok(gas.api('apiImportProducts', t, rows));
  assert.equal(imp.created, 300);
  assert.equal(imp.errorCount, 0);

  let products = ok(gas.api('apiProducts', t)).filter((p) => p.unit === 'pcs' && p.bundle_qty > 0).slice(0, 20);
  assert.equal(products.length, 20);
  const si = ok(gas.api('apiStockIn', t, { supplier: 'Grosir Sinar', items: products.map((p) => ({ product_id: p.product_id, qty: 50, cost_price: p.cost_price })) }));
  assert.equal(si.lines.length, 20);

  const cust = ok(gas.api('apiSaveCustomer', t, { name: 'Bu Tes', phone: '0812 3456 7000', credit_limit: 5000000 }));
  const items = products.map((p, i) => ({ product_id: p.product_id, qty: i === 0 ? p.bundle_qty : 1 }));
  const t0 = Date.now();
  const sale = ok(gas.api('apiCheckout', t, { items, method: 'Kasbon', paid: 10000, discount: 0, customer_id: cust.customer_id }));
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, 'checkout took ' + ms + 'ms');
  assert.equal(sale.items.length, 20);
  assert.equal(sale.items[0].tier, 'Paket');
  assert.equal(sale.items[0].price, products[0].price_bundle);
  const expected = products.reduce((a, p, i) => a + (i === 0 ? p.price_bundle * p.bundle_qty : p.price_retail), 0);
  assert.equal(sale.total, expected);
  assert.equal(sale.credit.amount, expected - 10000);

  const after = ok(gas.api('apiProducts', t));
  products.forEach((p, i) => {
    const a = after.find((x) => x.product_id === p.product_id);
    assert.equal(a.stock, 50 - (i === 0 ? p.bundle_qty : 1));
  });
  const moves = gas.rows('StockMoves').filter((m) => m.note === sale.trx_id);
  assert.equal(moves.length, 20);
  assert.ok(moves.every((m) => m.type === 'JUAL' && m.qty < 0));
  const credit = gas.rows('Credits').find((k) => k.trx_id === sale.trx_id);
  assert.equal(credit.status, 'Belum Lunas');
  assert.equal(credit.amount, expected - 10000);
  const c2 = ok(gas.api('apiCustomers', t)).find((x) => x.customer_id === cust.customer_id);
  assert.equal(c2.outstanding, expected - 10000);

  // Partial then full payment (FIFO)
  const pay1 = ok(gas.api('apiPayCredit', t, { customer_id: cust.customer_id, amount: 20000, method: 'Tunai' }));
  assert.equal(pay1.remaining, expected - 30000);
  assert.equal(gas.rows('Credits').find((k) => k.trx_id === sale.trx_id).status, 'Cicil');
  const pay2 = ok(gas.api('apiPayCredit', t, { customer_id: cust.customer_id, amount: expected - 30000, method: 'QRIS' }));
  assert.equal(pay2.remaining, 0);
  assert.equal(gas.rows('Credits').find((k) => k.trx_id === sale.trx_id).status, 'Lunas');
  assert.equal(gas.api('apiPayCredit', t, { customer_id: cust.customer_id, amount: 1000 }).ok, false);

  // Closing summary counts the DP and the cash kasbon payment.
  const cl = ok(gas.api('apiClosingSummary', t, ''));
  assert.equal(cl.kasbonDp, 10000);
  assert.equal(cl.payCash, 20000);
  assert.equal(cl.payNonCash, expected - 30000);
  assert.equal(cl.systemCash, 30000);
  const saved = ok(gas.api('apiSaveClosing', t, { opening_cash: 100000, counted_cash: 130000 }));
  assert.equal(saved.diff, 0);
});

test('credit limit, stock and cash validation on checkout', () => {
  const gas = boot();
  const t = login(gas);
  const p = ok(gas.api('apiProducts', t));
  const c = ok(gas.api('apiCustomers', t));
  const noKasbon = c.find((x) => x.credit_limit === 0);
  const r1 = gas.api('apiCheckout', t, { items: [{ product_id: p[0].product_id, qty: 1 }], method: 'Kasbon', paid: 0, customer_id: noKasbon.customer_id });
  assert.equal(r1.code, 'LIMIT');
  const andi = c.find((x) => x.name.indexOf('Andi') >= 0); // limit 100.000
  const r2 = gas.api('apiCheckout', t, { items: [{ product_id: p[0].product_id, qty: 10 }], method: 'Kasbon', paid: 0, customer_id: andi.customer_id });
  assert.equal(r2.code, 'LIMIT');
  const lpg = p.find((x) => x.name.indexOf('LPG') >= 0);
  const r3 = gas.api('apiCheckout', t, { items: [{ product_id: lpg.product_id, qty: lpg.stock + 1 }], method: 'Tunai', paid: 10000000 });
  assert.equal(r3.code, 'STOCK');
  const r4 = gas.api('apiCheckout', t, { items: [{ product_id: p[0].product_id, qty: 1 }], method: 'Tunai', paid: 100 });
  assert.equal(r4.ok, false);
  const r5 = gas.api('apiCheckout', t, { items: [{ product_id: p[3].product_id, qty: 1.5 }], method: 'Tunai', paid: 100000 });
  assert.equal(r5.ok, false, 'pcs must be whole numbers');
  const r6 = ok(gas.api('apiCheckout', t, { items: [{ product_id: p[0].product_id, qty: 2.5 }], method: 'Tunai', paid: 50000 }));
  assert.equal(r6.change, 50000 - r6.total);
});

test('stock in recalculates average cost; opname and void restore stock', () => {
  const gas = boot();
  const t = login(gas);
  const p = ok(gas.api('apiProducts', t)).find((x) => x.name.indexOf('Indomie') >= 0);
  const r = ok(gas.api('apiStockIn', t, { items: [{ product_id: p.product_id, qty: 40, cost_price: 3100, expiry_date: '2027-01-31' }] }));
  const expectAvg = Math.round((p.stock * p.cost_price + 40 * 3100) / (p.stock + 40));
  assert.equal(r.lines[0].new_avg, expectAvg);
  let q = ok(gas.api('apiProducts', t)).find((x) => x.product_id === p.product_id);
  assert.equal(q.stock, p.stock + 40);
  assert.equal(q.cost_price, expectAvg);
  assert.equal(q.expiry_date, '2027-01-31');

  const adj = ok(gas.api('apiStockAdjust', t, { product_id: p.product_id, actual_stock: q.stock - 2, note: 'rusak' }));
  assert.equal(adj.delta, -2);

  const sale = ok(gas.api('apiCheckout', t, { items: [{ product_id: p.product_id, qty: 5 }], method: 'Tunai', paid: 50000 }));
  q = ok(gas.api('apiProducts', t)).find((x) => x.product_id === p.product_id);
  const stockAfterSale = q.stock;
  ok(gas.api('apiVoidSale', t, sale.trx_id, 'salah input'));
  q = ok(gas.api('apiProducts', t)).find((x) => x.product_id === p.product_id);
  assert.equal(q.stock, stockAfterSale + 5);
  assert.equal(gas.rows('Sales').find((s) => s.trx_id === sale.trx_id).status, 'Batal');
  assert.equal(gas.api('apiVoidSale', t, sale.trx_id, 'lagi').ok, false);
});

test('dashboard, report, pdf and exports', () => {
  const gas = boot();
  const t = login(gas);
  const d = ok(gas.api('apiDashboard', t));
  assert.equal(d.week.length, 7);
  assert.ok(d.kpi.omzet > 0, 'today has sample sales');
  assert.ok(d.top.length > 0 && d.top.length <= 10);
  assert.equal(d.methods.length, 4);
  assert.ok(d.kasbon.outstanding > 0);
  assert.ok(d.stock.low.length >= 1, 'sample has low stock items');
  assert.ok(d.stock.expiry.length >= 1, 'sample has near-expiry items');
  const today = gas.call('ymdKey_', new Date());
  const from = gas.call('ymdKey_', new Date(Date.now() - 6 * 86400000));
  const r = ok(gas.api('apiReport', t, from, today));
  assert.equal(r.summary.trx, 10);
  assert.ok(r.byProduct.length > 0);
  const pdf = ok(gas.api('apiReportPdf', t, from, today));
  assert.match(pdf.filename, /^Laporan_\d{8}_\d{8}\.pdf$/);
  assert.ok(pdf.base64.length > 10);
  const csv = ok(gas.api('apiExportSheet', t, 'Sales'));
  assert.equal(csv.csv.split('\n').length, 11);
  assert.equal(gas.api('apiExportSheet', t, 'Users').ok, false, 'users sheet cannot be exported');
  const drive = ok(gas.api('apiSaveToDrive', t, 'x.csv', 'a,b', 'text/csv', false));
  assert.match(drive.url, /^https:\/\/drive/);
});

test('AI features fall back when disabled, unconfigured or failing, and log to Log_AI', () => {
  const gas = boot();
  const t = login(gas);
  const logCount = () => gas.rows('Log_AI').length;
  // no key configured
  let n = logCount();
  let k = ok(gas.api('apiAiSaranKulakan', t));
  assert.equal(k.source, 'rule');
  assert.equal(logCount(), n + 1);
  assert.equal(gas.rows('Log_AI').pop().status, 'NO_CONFIG → fallback');
  // rule: avg × 7 − stock
  k.items.forEach((i) => assert.equal(i.qty, Math.ceil(i.avg_daily * 7 - i.stock) || i.qty));

  const cust = ok(gas.api('apiCustomers', t)).find((c) => c.outstanding > 0 && c.days_overdue > 0);
  const tg = ok(gas.api('apiAiPesanTagih', t, cust.customer_id));
  assert.equal(tg.source, 'template');
  assert.ok(tg.message.indexOf(cust.name) >= 0);
  const om = ok(gas.api('apiAiCeritaOmzet', t));
  assert.equal(om.source, 'template');
  assert.equal(om.text.split(/(?<=\.)\s/).length, 3, 'three sentences: ' + om.text);

  // configured + working endpoint
  gas.state.props.set('AI_API_KEY', 'sk-test');
  gas.state.props.set('AI_MODEL', 'test-model');
  let calls = 0;
  gas.state.fetchHandler = (url, opts) => {
    calls++;
    assert.equal(url, 'http://43.133.148.28:20128/v1/chat/completions');
    assert.equal(opts.headers.Authorization, 'Bearer sk-test');
    assert.equal(opts.muteHttpExceptions, true);
    const body = JSON.parse(opts.payload);
    assert.equal(body.model, 'test-model');
    assert.equal(body.temperature, 0.4);
    const sys = body.messages[0].content;
    let content = 'Pesan dari AI untuk Bapak/Ibu.';
    if (sys.indexOf('kulakan') >= 0) {
      const id = body.messages[1].content.split('\n')[2].split('|')[0];
      content = '```json\n{"ringkasan":"Stok aman, tambah mi instan.","items":[{"product_id":"' + id + '","qty":12,"alasan":"paling laris"}]}\n```';
    }
    return { code: 200, body: { choices: [{ message: { content } }] } };
  };
  k = ok(gas.api('apiAiSaranKulakan', t));
  assert.equal(k.source, 'ai');
  assert.equal(k.items[0].qty, 12);
  const k2 = ok(gas.api('apiAiSaranKulakan', t));
  assert.equal(k2.source, 'ai');
  assert.equal(calls, 1, 'second call served from 6h cache');
  assert.equal(gas.rows('Log_AI').pop().status, 'CACHE');
  const tg2 = ok(gas.api('apiAiPesanTagih', t, cust.customer_id));
  assert.equal(tg2.source, 'ai');

  // failing endpoint → one retry then fallback
  calls = 0;
  gas.state.fetchHandler = () => { calls++; return { code: 502, body: 'bad gateway' }; };
  const om2 = ok(gas.api('apiAiCeritaOmzet', t));
  assert.equal(om2.source, 'template');
  assert.equal(calls, 2, 'one retry');
  assert.match(gas.rows('Log_AI').pop().status, /^ERROR: HTTP 502/);

  // disabled in settings
  ok(gas.api('apiSaveSettings', t, { AI_ENABLED: false }));
  calls = 0;
  const off = ok(gas.api('apiAiPesanTagih', t, cust.customer_id));
  assert.equal(off.source, 'template');
  assert.equal(calls, 0);

  // callAI cannot be invoked directly from the browser
  assert.throws(() => gas.call('callAI', 'x', [{ role: 'user', content: 'hi' }]), /hanya dapat dipanggil/);
  // key never leaks through the settings API
  const st = JSON.stringify(gas.api('apiGetSettings', t));
  assert.equal(st.indexOf('sk-test'), -1);
});

test('input is validated and formula injection is neutralised', () => {
  const gas = boot();
  const t = login(gas);
  const c = ok(gas.api('apiSaveCustomer', t, { name: '=IMPORTXML("http://x","//a")', phone: '', notes: '+cek', credit_limit: 0 }));
  const row = gas.rows('Customers').find((x) => x.customer_id === c.customer_id);
  assert.equal(row.name, '=IMPORTXML("http://x","//a")', 'stored as plain text, not a formula');
  assert.equal(gas.api('apiSaveCustomer', t, { name: '', phone: '' }).code, 'INVALID');
  assert.equal(gas.api('apiSaveCustomer', t, { name: 'A', phone: '123' }).code, 'INVALID');
  assert.equal(gas.api('apiSaveProduct', t, { name: 'X', category: 'Mainan', unit: 'pcs', price_retail: 1000 }).code, 'INVALID');
  assert.equal(gas.api('apiSaveProduct', t, { name: 'X', category: 'Snack', unit: 'pcs', price_retail: 1000, price_bundle: 1200, bundle_qty: 3 }).code, 'INVALID');
  assert.equal(gas.api('apiSaveSettings', t, { LOGO_URL: 'javascript:alert(1)' }).code, 'INVALID');
  assert.equal(gas.api('apiCheckout', t, { items: [{ product_id: 'PRD<script>', qty: 1 }], method: 'Tunai', paid: 1 }).code, 'INVALID');
});

test('users: owner can add kasir; revoked sessions end; last owner protected', () => {
  const gas = boot();
  const t = login(gas);
  ok(gas.api('apiSaveUser', t, { username: 'sari', full_name: 'Sari', role: 'Kasir', password: 'rahasia1', active: true }));
  const ts = login(gas, 'sari', 'rahasia1');
  ok(gas.api('apiMe', ts));
  // make revocation strictly newer than the login timestamp
  const s = JSON.parse(gas.state.cache.get('sess_' + ts).v);
  s.iat -= 1000;
  gas.state.cache.set('sess_' + ts, { v: JSON.stringify(s) });
  ok(gas.api('apiSaveUser', t, { username: 'sari', full_name: 'Sari', role: 'Kasir', password: '', active: false }));
  assert.equal(gas.api('apiMe', ts).code, 'AUTH');
  assert.equal(gas.api('apiSaveUser', t, { username: 'admin', full_name: 'Pemilik', role: 'Kasir', active: true }).ok, false);
  ok(gas.api('apiChangePassword', t, 'admin123', 'barubaru'));
  assert.equal(gas.api('apiLogin', 'admin', 'admin123').ok, false);
  login(gas, 'admin', 'barubaru');
});

test('setup wizard, demo data, backup and licence', () => {
  const gas = boot();
  const t = login(gas);
  const w = ok(gas.api('apiSetupWizard', t, {
    settings: { BUSINESS_NAME: 'Toko Maju', WHATSAPP: '081299990000', TAX_PERCENT: 0, AI_ENABLED: true },
    new_password: 'rahasia99', disable_demo_kasir: true, data_mode: 'demo'
  }));
  assert.equal(w.setupDone, true);
  assert.equal(w.settings.BUSINESS_NAME, 'Toko Maju');
  assert.equal(gas.api('apiLogin', 'kasir', 'kasir123').ok, false, 'demo kasir disabled');
  assert.ok(gas.rows('Sales').length > 100, 'demo has 28 days of sales');
  const k = ok(gas.api('apiAiSaranKulakan', t));
  assert.ok(k.items.length > 0);

  const b = ok(gas.api('apiBackupNow', t));
  assert.match(b.name, /^Backup DB_KasirWarung /);
  const trig = ok(gas.api('apiSetBackupTrigger', t, true));
  assert.equal(trig.trigger, true);
  assert.equal(gas.state.triggers.length, 1);
  ok(gas.api('apiSetBackupTrigger', t, true));
  assert.equal(gas.state.triggers.length, 1, 'no duplicate triggers');
  assert.equal(gas.call('dailyBackup'), 'skip', 'skips within 20h of last backup');

  let lic = ok(gas.api('apiLicense', t)).license;
  assert.equal(lic.status, 'TRIAL');
  assert.equal(gas.api('apiSaveLicense', t, 'KWAI-PRO-20271231-ABCDEF-00000000').ok, false);
  const key = makeKey('PRO', '2027-12-31');
  lic = ok(gas.api('apiSaveLicense', t, key));
  assert.equal(lic.status, 'ACTIVE');
  gas.state.props.set('LICENSE_KEY', makeKey('STD', '2025-01-01'));
  assert.equal(ok(gas.api('apiLicense', t)).license.status, 'EXPIRED');
});

test('doGet renders the web app with branding and every partial', () => {
  const gas = boot();
  const out = gas.call('doGet', { parameter: { page: 'kasir' } });
  const html = out.getContent();
  assert.ok(html.indexOf('<?') < 0, 'no unresolved scriptlets');
  ['page-login', 'page-setup', 'page-dashboard', 'page-kasir', 'page-produk', 'page-stok', 'page-pelanggan', 'page-laporan',
    'page-pengaturan', 'page-panduan', 'page-lisensi', 'page-tentang', 'page-syarat', 'page-privasi'].forEach((id) => {
    assert.ok(html.indexOf('id="' + id + '"') >= 0, 'missing ' + id);
  });
  assert.ok(html.indexOf('"page":"kasir"') >= 0);
  assert.ok(html.indexOf('Warung Berkah Jaya') >= 0);
  assert.ok(html.indexOf('AI_API_KEY') < 0 || html.indexOf('sk-') < 0);
  const evil = gas.call('doGet', { parameter: { page: '"><script>' } }).getContent();
  assert.ok(evil.indexOf('"page":""') >= 0, 'unknown page ignored');
});

test('1,000+ rows: dashboard and report stay within a handful of sheet calls', () => {
  const gas = boot();
  const t = login(gas);
  ok(gas.api('apiLoadDemo', t, 'DEMO'));
  const ts = gas.call('meta_', 'Sales');
  const base = gas.rows('Sales');
  const extra = [];
  for (let i = 0; i < 1200; i++) {
    const s = Object.assign({}, base[i % base.length]);
    s.trx_id = 'TRX990101-' + (1000 + i);
    extra.push(s);
  }
  gas.call('appendRows_', ts, extra);
  const products = [];
  for (let i = 0; i < 1000; i++) products.push({ product_id: 'PRD990101-' + (1000 + i), barcode: '', name: 'Barang ' + i, category: 'Lainnya', unit: 'pcs', price_retail: 1000, price_bundle: 0, bundle_qty: 0, price_wholesale: 0, wholesale_qty: 0, cost_price: 800, stock: 10, min_stock: 1, expiry_date: '', active: true });
  gas.call('appendRows_', gas.call('meta_', 'Products'), products);
  gas.call('invalidateProducts_');
  const ss = gas.ss();
  let before = ss.stats.calls;
  let t0 = Date.now();
  ok(gas.api('apiDashboard', t));
  const dashCalls = ss.stats.calls - before;
  const dashMs = Date.now() - t0;
  before = ss.stats.calls;
  t0 = Date.now();
  const today = gas.call('ymdKey_', new Date());
  const from = gas.call('ymdKey_', new Date(Date.now() - 29 * 86400000));
  ok(gas.api('apiReport', t, from, today));
  const repCalls = ss.stats.calls - before;
  assert.ok(dashCalls < 20, 'dashboard range calls: ' + dashCalls);
  assert.ok(repCalls < 25, 'report range calls: ' + repCalls);
  assert.ok(dashMs < 3000, 'dashboard ms ' + dashMs);
  const prods = ok(gas.api('apiProducts', t));
  assert.ok(prods.length >= 1010);
  // products list is cached in chunks (> 100 KB)
  assert.ok(gas.state.cache.has('products_v1#0'), 'chunked cache used');
});
