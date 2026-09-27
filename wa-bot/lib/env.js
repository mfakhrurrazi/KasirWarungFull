// Minimal .env loader (no extra dependency). Existing environment variables win.
import fs from 'node:fs';

export function loadEnv(file) {
  if (!fs.existsSync(file)) return false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return true;
}

export function readConfig(env = process.env) {
  const cfg = {
    url: String(env.APPS_SCRIPT_URL || '').trim(),
    secret: String(env.BOT_SECRET || '').trim(),
    pairingNumber: String(env.PAIRING_NUMBER || '').replace(/[^\d]/g, ''),
    authDir: String(env.AUTH_DIR || 'auth').trim(),
    pollSeconds: Math.max(10, Number(env.POLL_SECONDS) || 30),
    replyDelayMs: Math.max(0, Number(env.REPLY_DELAY_MS) || 1200)
  };
  const problems = [];
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(cfg.url)) problems.push('APPS_SCRIPT_URL harus alamat web app yang berakhiran /exec');
  if (!/^[a-f0-9]{32,}$/.test(cfg.secret)) problems.push('BOT_SECRET belum diisi (buat di Pengaturan → Bot WhatsApp)');
  if (cfg.pairingNumber && !/^62\d{8,13}$/.test(cfg.pairingNumber)) problems.push('PAIRING_NUMBER harus format 62xxxxxxxxxx');
  return { cfg, problems };
}
