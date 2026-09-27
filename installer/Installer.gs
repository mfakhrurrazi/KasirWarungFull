/**
 * KasirWarung AI — Installer (sekali pakai)
 * © 2026 KasirWarung AI · Made by Piyu
 *
 * Mengisi project Apps Script ini dengan seluruh file KasirWarung AI
 * (24 file) yang diunduh dari GitHub, versi terkunci (commit KW_REF).
 *
 * LANGKAH:
 *  1. Aktifkan "Google Apps Script API": https://script.google.com/home/usersettings  (sekali saja)
 *  2. Project Settings (roda gigi) → centang "Show appsscript.json manifest file in editor".
 *  3. Tempel file ini sebagai Code.gs, dan GANTI SELURUH isi appsscript.json dengan
 *     isi "Installer_appsscript.json" → Ctrl+S. (Wajib — tanpa ini muncul error izin.)
 *  4. Pilih fungsi install → Run → izinkan akses.
 *  5. Setelah "SELESAI" di log: tekan F5 (muat ulang editor), pilih setupDatabase → Run → izinkan.
 *  6. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy.
 */

const KW_REPO = 'mfakhrurrazi/KasirWarungFull';
const KW_REF = '7a4e8a2f76a48cc1bdb2a2a54a6f0c5a5a974178';
const KW_FILES = ["AI.gs", "Code.gs", "Data.gs", "Index.html", "Page_Dashboard.html", "Page_Kasir.html", "Page_Laporan.html", "Page_Lisensi.html", "Page_Login.html", "Page_Panduan.html", "Page_Pelanggan.html", "Page_Pengaturan.html", "Page_Privasi.html", "Page_Produk.html", "Page_Setup.html", "Page_StokMasuk.html", "Page_Syarat.html", "Page_Tentang.html", "Reports.gs", "Scripts.html", "Setup.gs", "Styles.html", "TemplateData.gs", "appsscript.json"];

function install() {
  checkInstallerScopes_();
  const base = 'https://raw.githubusercontent.com/' + KW_REPO + '/' + KW_REF + '/src/';
  const requests = KW_FILES.map(function (f) { return { url: base + encodeURIComponent(f), muteHttpExceptions: true }; });
  const responses = UrlFetchApp.fetchAll(requests);
  const files = responses.map(function (res, i) {
    const f = KW_FILES[i];
    if (res.getResponseCode() !== 200) throw new Error('Gagal mengunduh ' + f + ' (HTTP ' + res.getResponseCode() + '). Periksa internet lalu Run lagi.');
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
    const body = res.getContentText();
    let hint = '';
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(body)) {
      hint = ' → Isi appsscript.json belum diganti dengan Installer_appsscript.json (lihat LANGKAH 2 & 3 di panduan).';
    } else if (/SERVICE_DISABLED|has not been used|is disabled|User has not enabled the Apps Script API/i.test(body)) {
      hint = ' → Aktifkan "Google Apps Script API" di https://script.google.com/home/usersettings, tunggu 1–2 menit, lalu Run install lagi.';
    }
    throw new Error('Apps Script API menolak (HTTP ' + code + ')' + hint + '\nDetail: ' + body.slice(0, 300));
  }
  Logger.log('SELESAI: ' + files.length + ' file KasirWarung AI terpasang. Tekan F5 untuk memuat ulang editor, lalu jalankan setupDatabase().');
}

/**
 * Stops early with a clear message when the project manifest does not request
 * the script.projects scope (appsscript.json not replaced yet).
 */
function checkInstallerScopes_() {
  const info = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + ScriptApp.getOAuthToken(), { muteHttpExceptions: true });
  if (info.getResponseCode() !== 200) return; // cannot check — let the API call report the real error
  const scopes = String(JSON.parse(info.getContentText()).scope || '');
  if (scopes.indexOf('https://www.googleapis.com/auth/script.projects') < 0) {
    throw new Error(
      'Izin "script.projects" belum ada. Caranya:\n' +
      '1) Project Settings (ikon roda gigi) → centang "Show appsscript.json manifest file in editor".\n' +
      '2) Buka appsscript.json di editor → hapus semua isinya → tempel isi file Installer_appsscript.json → Ctrl+S.\n' +
      '3) Run install lagi → akan muncul permintaan izin baru → Allow.');
  }
}
