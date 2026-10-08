/**
 * End-to-end UI check: renders the real web app (Index.html + partials) in
 * Chromium, with google.script.run bridged to the in-memory GAS emulator.
 *
 *   TZ=Asia/Jakarta NODE_PATH=$(npm root -g) node tests/ui.e2e.js [screenshotDir]
 *
 * Chart.js is served from a local copy when CHARTJS_PATH is set (CDN may be blocked in CI).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { createGas } = require('./gas-mock');

const OUT = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const SHIM = `
(() => {
  const mk = (ok, fail) => new Proxy({}, { get(_, prop) {
    if (prop === 'withSuccessHandler') return (h) => mk(h, fail);
    if (prop === 'withFailureHandler') return (h) => mk(ok, h);
    return (...args) => { window.__gasCall(String(prop), JSON.stringify(args)).then((r) => ok && ok(r), (e) => fail && fail(e)); };
  }});
  window.google = { script: { run: mk(null, null), history: { push() {}, replace() {}, setChangeHandler() {} } } };
})();`;

async function main() {
  const gas = createGas({ bundle: !!process.env.KW_BUNDLE }); // KW_BUNDLE=1 tests the 2-file all-in-one build
  gas.call('setupDatabase');
  const errors = [];
  global.__uiErrors = errors;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const results = [];

  async function newPage(viewport, params) {
    const ctx = await browser.newContext(viewport);
    const page = await ctx.newPage();
    await page.exposeFunction('__gasCall', (fn, argsJson) => {
      const args = JSON.parse(argsJson);
      return gas.call(fn, ...args);
    });
    await page.route('**/cdn.jsdelivr.net/**', (route) => {
      if (process.env.CHARTJS_PATH) route.fulfill({ path: process.env.CHARTJS_PATH, contentType: 'application/javascript' });
      else route.continue();
    });
    await page.route('**/fonts.g*/**', (route) => route.abort());
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    page.on('dialog', (d) => d.dismiss());
    // setContent() does not run init scripts on about:blank, so inject the shim into <head>.
    const html = gas.call('doGet', { parameter: params || {} }).getContent().replace('<head>', '<head><script>' + SHIM + '</script>');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#bootSplash', { state: 'detached' });
    return page;
  }
  const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: false }); results.push(name); };
  const noHScroll = async (page, label) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    if (w[0] > w[1] + 1) errors.push('horizontal scroll on ' + label + ': ' + w[0] + ' > ' + w[1]);
  };

  // ---------------- 5-inch Android phone ----------------
  const phone = devices['Galaxy S5'];
  const page = await newPage({ ...phone });
  await shot(page, '01-login-phone');
  await page.fill('#loginUser', 'admin');
  await page.fill('#loginPass', 'admin123');
  await page.click('#loginBtn');
  await page.waitForSelector('#page-setup:not([hidden])');
  await shot(page, '02-setup-wizard');
  await page.click('#suNext');
  await page.fill('#suPw', 'rahasia123');
  await page.fill('#suPw2', 'rahasia123');
  await page.uncheck('#suNoDemo'); // keep the demo kasir account for the role test below
  await page.click('#suNext');
  await page.click('#suNext');
  await page.click('#suNext');
  await page.waitForSelector('#page-dashboard:not([hidden])');
  await page.waitForSelector('#dbKpis .kpi');
  await page.waitForTimeout(800);
  await shot(page, '03-dashboard-phone');
  await noHScroll(page, 'dashboard');
  await page.click('#dbStoryBtn');
  await page.waitForSelector('#dbStoryBadge .badge');
  const badge = await page.textContent('#dbStoryBadge');
  if (badge.indexOf('AI tidak aktif') < 0) errors.push('expected fallback badge, got ' + badge);

  // ---------------- Kasir: 20-item sale with kasbon ----------------
  await page.click('#bottomnav [data-go="kasir"]');
  await page.waitForSelector('#posGrid .prod');
  const t0 = Date.now();
  const barcodes = await page.evaluate(() => Pages.kasir.products.filter((p) => p.barcode && p.stock >= 3).map((p) => p.barcode));
  let count = 0;
  for (let i = 0; count < 20; i++) {
    const bc = barcodes[i % barcodes.length];
    await page.fill('#posSearch', bc);
    await page.press('#posSearch', 'Enter');
    count++;
  }
  await shot(page, '04-kasir-phone');
  await noHScroll(page, 'kasir');
  await page.click('#cartBarBtn');
  await shot(page, '05-cart-phone');
  await page.click('#cartPay');
  await page.click('.pay-methods [data-m="Kasbon"]');
  await page.click('#payChangeCust');
  await page.waitForSelector('[data-pick]');
  await page.click('[data-pick]');
  await page.waitForSelector('#payLimit .notice');
  await shot(page, '06-pay-kasbon-phone');
  await page.click('#payDo');
  await page.waitForSelector('.success-burst');
  const elapsed = Date.now() - t0;
  await shot(page, '07-success-phone');
  const lastSale = await page.evaluate(() => Pages.kasir.lastSale);
  const units = lastSale.items.reduce((a, i) => a + i.qty, 0);
  if (units !== 20) errors.push('expected 20 units, got ' + units);
  if (!lastSale.credit) errors.push('kasbon credit missing');
  results.push('20-item kasbon sale in ' + elapsed + ' ms (automated)');
  await page.click('.modal-foot [data-close]');

  // ---------------- Other screens ----------------
  const visit = async (pageName, name, waitSel) => {
    await page.evaluate((p) => App.go(p), pageName);
    if (waitSel) await page.waitForSelector(waitSel);
    await page.waitForTimeout(400);
    await shot(page, name);
    await noHScroll(page, pageName);
  };
  await visit('pelanggan', '08-kasbon-phone', '.cust-card');
  await page.click('[data-act-c="ai"]');
  await page.waitForSelector('#aiMsg');
  await shot(page, '09-pesan-tagih-phone');
  await page.click('.modal-foot [data-close]');
  await visit('produk', '10-produk-phone', '#prTable table');
  await visit('stok', '11-stok-phone', '#skLines');
  await page.click('[data-tab="saran"]');
  await page.click('#sgRun');
  await page.waitForSelector('#sgBadge .badge');
  await shot(page, '12-saran-kulakan-phone');
  await visit('laporan', '13-laporan-phone', '#rpOut .kpi');
  await visit('pengaturan', '14-pengaturan-phone', '#sgName');
  await visit('panduan', '15-panduan-phone');
  await visit('lisensi', '16-lisensi-phone', '#lcStatus h2');
  await visit('tentang', '17-tentang-phone');
  await page.evaluate(() => App.go('kasir'));
  await page.evaluate(() => Pages.kasir.closing());
  await page.waitForSelector('#clCount');
  await page.fill('#clCount', '100000');
  await shot(page, '18-closing-phone');
  await page.click('.modal-foot [data-close]');
  await page.evaluate(() => { printHtml(receiptHtml(Pages.kasir.lastSale)); });
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: path.join(OUT, '19-receipt-print.png') });
  await page.emulateMedia({ media: 'screen' });

  // ---------------- WhatsApp bot: settings, incoming order → Kasir → closed ----------------
  await visit('pengaturan', '14b-pengaturan-wa-phone');
  await page.click('#stTabs [data-tab="wa"]');
  await page.click('#waSecret');
  await page.waitForSelector('#waEnv');
  const env = await page.inputValue('#waEnv');
  const secret = (env.match(/BOT_SECRET=([a-f0-9]{64})/) || [])[1];
  if (!secret) errors.push('secret not shown: ' + env);
  gas.post({ kw: 'wa', secret, action: 'hello', me: '6281111111111', groups: [{ id: '120363000000001@g.us', name: 'Pelanggan Warung' }] });
  await page.click('#waReload');
  await page.waitForSelector('[data-wa-group]');
  await shot(page, '14c-pengaturan-wa-status-phone');
  await noHScroll(page, 'pengaturan wa');
  const waReply = gas.post({ kw: 'wa', secret, action: 'message', chat: '120363000000001@g.us', chatName: 'Pelanggan Warung', isGroup: true,
    sender: '6281234567801', name: 'Siti', text: 'pesan\n2 indomie goreng\n1 gas 3kg', id: 'UI1' }).replies[0] || '';
  const waId = (waReply.match(/PSN\d{6}-\d{3}/) || [])[0];
  if (!waId) errors.push('WA order not created: ' + waReply);
  await visit('pesanan', '14d-pesanan-wa-phone', '#poList .cust-card');
  await page.click('[data-po="kasir"][data-id="' + waId + '"]');
  await page.waitForSelector('#page-kasir:not([hidden])');
  await page.click('#cartBarBtn');
  await page.waitForSelector('[data-clear-wa]');
  await shot(page, '14e-kasir-dari-pesanan-wa-phone');
  await page.click('#cartPay');
  await page.click('.pay-methods [data-m="Tunai"]');
  await page.click('#payQuick [data-cash]');
  await page.click('#payDo');
  await page.waitForSelector('.success-burst');
  await page.click('.modal-foot [data-close]');
  const waRow = gas.rows('WaOrders').find((o) => o.order_id === waId);
  if (!waRow || waRow.status !== 'Selesai' || !waRow.trx_id) errors.push('WA order not closed by checkout: ' + JSON.stringify(waRow));
  const outbox = gas.post({ kw: 'wa', secret, action: 'poll' }).outbox;
  if (!outbox.some((m) => /selesai/.test(m.text))) errors.push('no thank-you notification: ' + JSON.stringify(outbox));

  // ---------------- Akses publik: settings + API key ----------------
  await page.evaluate(() => App.go('pengaturan'));
  await page.click('#stTabs [data-tab="publik"]');
  await page.waitForSelector('#pbShopLink .notice');
  await page.fill('#pbKeyName', 'Website warung');
  await page.selectOption('#pbKeyAccess', 'baca');
  await page.click('#pbKeyNew');
  await page.waitForSelector('#pbKeyVal');
  const apiKey = await page.inputValue('#pbKeyVal');
  const viaKey = gas.apiGet({ api: 'produk', key: apiKey }).json();
  if (!viaKey.ok || !viaKey.data.length) errors.push('API key from the settings page does not work: ' + JSON.stringify(viaKey).slice(0, 200));
  await page.waitForSelector('#pbKeys [data-revoke]');
  await shot(page, '14f-akses-publik-phone');
  await noHScroll(page, 'akses publik');

  // ---------------- Kasir role ----------------
  const kp = await newPage({ ...phone });
  await kp.fill('#loginUser', 'kasir');
  await kp.fill('#loginPass', 'kasir123');
  await kp.click('#loginBtn');
  await kp.waitForSelector('#page-kasir:not([hidden])');
  const navs = await kp.$$eval('#bottomnav [data-go]', (b) => b.map((x) => x.getAttribute('data-go')));
  if (navs.indexOf('dashboard') >= 0) errors.push('kasir sees dashboard nav');
  await kp.evaluate(() => App.go('laporan'));
  const cur = await kp.evaluate(() => App.page);
  if (cur !== 'kasir') errors.push('kasir reached ' + cur);
  await kp.evaluate(() => App.go('produk'));
  await kp.waitForSelector('#prTable table');
  await shot(kp, '20-kasir-role-produk');
  await kp.evaluate(() => App.go('pesanan'));
  await kp.waitForSelector('#poList .card');
  if (await kp.evaluate(() => App.page) !== 'pesanan') errors.push('kasir cannot open Pesanan WA');

  // ---------------- Public shop, anonymous visitor ----------------
  const sp = await newPage({ ...phone }, { page: 'toko' });
  await sp.waitForSelector('#page-toko:not([hidden]) .shop-prod [data-tk-add]');
  await shot(sp, '23-toko-phone');
  await noHScroll(sp, 'toko');
  await sp.fill('#tkSearch', 'indomie');
  await sp.waitForFunction(() => [...document.querySelectorAll('#tkGrid .p-name')].every((n) => /Indomie/.test(n.textContent)));
  await sp.click('#tkGrid [data-tk-add="1"]');
  for (let i = 0; i < 4; i++) await sp.click('#tkGrid [data-tk-add="1"]');
  await sp.fill('#tkSearch', '');
  await sp.click('#tkBarBtn');
  await sp.fill('#tkName', 'Rina');
  await sp.fill('#tkPhone', '085712345678');
  await sp.click('[data-dl="Antar"]');
  await sp.fill('#tkAddr', 'Jl. Mawar 3');
  await shot(sp, '24-toko-checkout-phone');
  await sp.click('#tkSend');
  await sp.waitForSelector('.success-burst');
  await shot(sp, '25-toko-sukses-phone');
  const shopRow = gas.rows('WaOrders').pop();
  if (shopRow.chat_name !== 'Toko online' || shopRow.total !== 5 * 3300) errors.push('shop order wrong: ' + JSON.stringify(shopRow));
  await sp.click('.modal-foot [data-close]');
  await sp.click('#tkTabs [data-tab="status"]');
  await sp.click('#tkStBtn');
  await sp.waitForSelector('#tkStOut .badge');
  if ((await sp.textContent('#tkStOut')).indexOf('Menunggu') < 0) errors.push('shop status not shown');
  await shot(sp, '26-toko-status-phone');
  const navAnon = await sp.$$eval('#bottomnav [data-go]', (b) => b.length);
  if (navAnon) errors.push('anonymous shop visitor sees app navigation');

  // ---------------- Desktop ----------------
  const dp = await newPage({ viewport: { width: 1366, height: 860 } });
  await dp.fill('#loginUser', 'admin');
  await dp.fill('#loginPass', 'rahasia123');
  await dp.click('#loginBtn');
  await dp.waitForSelector('#dbKpis .kpi');
  await dp.waitForTimeout(900);
  await shot(dp, '21-dashboard-desktop');
  await dp.evaluate(() => App.go('kasir'));
  await dp.waitForSelector('#posGrid .prod');
  await dp.click('#posGrid .prod');
  await dp.click('#posGrid .prod:nth-child(2)');
  await shot(dp, '22-kasir-desktop');

  await browser.close();
  console.log(results.join('\n'));
  if (errors.length) {
    console.error('\nUI ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\nUI OK — screenshots in ' + OUT);
}

main().catch((e) => { console.error(e); console.error('Collected errors:\n' + (global.__uiErrors || []).join('\n')); process.exit(1); });
