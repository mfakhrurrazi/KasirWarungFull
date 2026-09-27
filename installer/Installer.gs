/**
 * KasirWarung AI — Installer (sekali pakai)
 * © 2026 KasirWarung AI · Made by Piyu
 *
 * Mengisi project Apps Script ini dengan seluruh file KasirWarung AI
 * (24 file) yang diunduh dari GitHub, versi terkunci (commit KW_REF).
 *
 * LANGKAH:
 *  1. Aktifkan "Google Apps Script API": https://script.google.com/home/usersettings  (sekali saja)
 *  2. Tempel file ini sebagai Code.gs, dan isi appsscript.json dengan
 *     "Installer_appsscript.json" (Project Settings → centang "Show appsscript.json").
 *  3. Pilih fungsi install → Run → izinkan akses.
 *  4. Setelah "SELESAI" di log: tekan F5 (muat ulang editor), pilih setupDatabase → Run → izinkan.
 *  5. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy.
 */

const KW_REPO = 'mfakhrurrazi/KasirWarungFull';
const KW_REF = '7a4e8a2f76a48cc1bdb2a2a54a6f0c5a5a974178';
const KW_FILES = ["AI.gs", "Code.gs", "Data.gs", "Index.html", "Page_Dashboard.html", "Page_Kasir.html", "Page_Laporan.html", "Page_Lisensi.html", "Page_Login.html", "Page_Panduan.html", "Page_Pelanggan.html", "Page_Pengaturan.html", "Page_Privasi.html", "Page_Produk.html", "Page_Setup.html", "Page_StokMasuk.html", "Page_Syarat.html", "Page_Tentang.html", "Reports.gs", "Scripts.html", "Setup.gs", "Styles.html", "TemplateData.gs", "appsscript.json"];

function install() {
  const base = 'https://raw.githubusercontent.com/' + KW_REPO + '/' + KW_REF + '/src/';
  const requests = KW_FILES.map(function (f) { return { url: base + encodeURIComponent(f), muteHttpExceptions: true }; });
  const responses = UrlFetchApp.fetchAll(requests);
  const files = responses.map(function (res, i) {
    const f = KW_FILES[i];
    if (res.getResponseCode() !== 200) throw new Error('Gagal mengunduh ' + f + ' (HTTP ' + res.getResponseCode() + ').');
    const source = res.getContentText('UTF-8');
    if (f === 'appsscript.json') return { name: 'appsscript', type: 'JSON', source: source };
    const m = /^(.+)\.(gs|html)$/.exec(f);
    return { name: m[1], type: m[2] === 'gs' ? 'SERVER_JS' : 'HTML', source: source };
  });

  const url = 'https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content';
  const res = UrlFetchApp.fetch(url, {
    method: 'put',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ files: files }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    const hint = code === 403
      ? ' Aktifkan dulu "Google Apps Script API" di https://script.google.com/home/usersettings lalu jalankan install() lagi.'
      : '';
    throw new Error('Apps Script API menolak (HTTP ' + code + '): ' + res.getContentText().slice(0, 300) + hint);
  }
  Logger.log('SELESAI: ' + files.length + ' file KasirWarung AI terpasang. Tekan F5 untuk memuat ulang editor, lalu jalankan setupDatabase().');
}
