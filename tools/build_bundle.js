#!/usr/bin/env node
/**
 * Builds the 2-file "all-in-one" install of KasirWarung AI:
 *   dist/KasirWarung_1_Server.gs   — all server code (src/*.gs, in load order)
 *   dist/KasirWarung_2_Tampilan.gs — all HTML pages as KW_BUNDLED_HTML (read by htmlSource_)
 * Paste both into an Apps Script project (plus src/appsscript.json) — no
 * Apps Script API or clasp needed.
 *
 *   node tools/build_bundle.js          # write dist/
 *   node tools/build_bundle.js --check  # exit 1 if dist/ is out of date
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const GS_ORDER = ['Data.gs', 'Setup.gs', 'Code.gs', 'Reports.gs', 'AI.gs', 'TemplateData.gs'];

function build() {
  const version = (/VERSION:\s*'([^']+)'/.exec(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8')) || [])[1] || '';
  const head = (title) => '/**\n * KasirWarung AI v' + version + ' — ' + title + '\n' +
    ' * File hasil build (tools/build_bundle.js) — jangan diedit manual.\n' +
    ' * Pasang: tempel KasirWarung_1_Server.gs dan KasirWarung_2_Tampilan.gs sebagai dua file script,\n' +
    ' * isi appsscript.json dengan src/appsscript.json, lalu jalankan setupDatabase().\n' +
    ' * © 2026 KasirWarung AI · Made by Piyu\n */\n\n';
  const server = head('Kode server (1/2)') + GS_ORDER.map((f) =>
    '// ======================= ' + f + ' =======================\n' + fs.readFileSync(path.join(SRC, f), 'utf8').trimEnd() + '\n'
  ).join('\n');
  const html = {};
  fs.readdirSync(SRC).filter((f) => f.endsWith('.html')).sort().forEach((f) => {
    html[f.replace(/\.html$/, '')] = fs.readFileSync(path.join(SRC, f), 'utf8');
  });
  // JSON string literals are valid JS and need no escaping of backticks or ${...}.
  const pages = head('Tampilan / halaman HTML (2/2)') + 'const KW_BUNDLED_HTML = {\n' +
    Object.keys(html).map((k) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(html[k])).join(',\n') + '\n};\n';
  return { 'KasirWarung_1_Server.gs': server, 'KasirWarung_2_Tampilan.gs': pages };
}

if (require.main === module) {
  const out = build();
  if (process.argv.includes('--check')) {
    const stale = Object.keys(out).filter((f) => !fs.existsSync(path.join(DIST, f)) || fs.readFileSync(path.join(DIST, f), 'utf8') !== out[f]);
    if (stale.length) { console.error('dist/ is out of date: ' + stale.join(', ') + ' — run node tools/build_bundle.js'); process.exit(1); }
    console.log('dist/ is up to date');
  } else {
    fs.mkdirSync(DIST, { recursive: true });
    Object.keys(out).forEach((f) => fs.writeFileSync(path.join(DIST, f), out[f]));
    Object.keys(out).forEach((f) => console.log(f, Buffer.byteLength(out[f]), 'bytes'));
  }
}

module.exports = { build };
