// Renders docs/webinar/_print.html to docs/webinar/Webinar_KasirWarung_AI.pdf (A4, print styles).
//   NODE_PATH=$(npm root -g) node docs/webinar/make_pdf.js
// Offline? Set FONT_DIR to a folder with @fontsource woff2 files
// (nunito-latin-{400..900}-normal.woff2, baloo-2-latin-{600..800}-normal.woff2).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

function localFontCss(dir) {
  const face = (family, file, weight) => {
    const data = fs.readFileSync(path.join(dir, file)).toString('base64');
    return "@font-face{font-family:'" + family + "';font-weight:" + weight + ";font-style:normal;font-display:block;src:url(data:font/woff2;base64," + data + ") format('woff2')}";
  };
  return [400, 600, 700, 800, 900].map((w) => face('Nunito', 'nunito-latin-' + w + '-normal.woff2', w))
    .concat([600, 700, 800].map((w) => face('Baloo 2', 'baloo-2-latin-' + w + '-normal.woff2', w))).join('\n');
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ colorScheme: 'light' });
  if (process.env.FONT_DIR) {
    const css = localFontCss(process.env.FONT_DIR);
    await p.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: css }));
  }
  await p.goto('file://' + path.join(__dirname, '_print.html'), { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.emulateMedia({ media: 'print', colorScheme: 'light' });
  await p.pdf({
    path: path.join(__dirname, 'Webinar_KasirWarung_AI.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#7E6857;padding:0 12mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>Webinar KasirWarung AI · Made by Piyu</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'
  });
  const fonts = await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight));
  console.log('fonts loaded:', [...new Set(fonts)].join(', '));
  await b.close();
})();
