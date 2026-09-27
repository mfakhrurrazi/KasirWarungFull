// KasirWarung AI — bot WhatsApp (Baileys, gratis).
// Meneruskan pesan grup/chat pribadi ke web app KasirWarung dan mengirim balasannya.
// © 2026 KasirWarung AI · Made by Piyu
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, useMultiFileAuthState
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { loadEnv, readConfig } from './lib/env.js';
import { Bridge } from './lib/bridge.js';
import { deliverOutbox, handleMessage } from './lib/handler.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(DIR, '.env'));
const { cfg, problems } = readConfig();
const log = {
  info: (...a) => console.log(new Date().toLocaleString('id-ID'), '·', ...a),
  error: (...a) => console.error(new Date().toLocaleString('id-ID'), '✖', ...a)
};
if (problems.length) {
  log.error('Pengaturan .env belum lengkap:\n  - ' + problems.join('\n  - ') + '\nSalin .env.example menjadi .env lalu isi.');
  process.exit(1);
}

const bridge = new Bridge({ url: cfg.url, secret: cfg.secret, log });
const groups = new Map(); // jid → metadata (cache: fewer requests to WhatsApp)
const sent = new Map();   // id → message, for WhatsApp's re-send requests
const chains = new Map(); // jid → promise, keeps replies in order per chat
let sock = null;
let pollTimer = null;
let helloTimer = null;
let retryDelay = 2000;
let pairingAsked = false;
let stopping = false;

async function hello() {
  if (!sock?.user) return;
  try {
    const all = await sock.groupFetchAllParticipating();
    for (const [id, meta] of Object.entries(all)) groups.set(id, meta);
    const res = await bridge.call('hello', {
      me: String(sock.user.id || '').split(':')[0].split('@')[0], version: 'bot-1.0.0',
      groups: [...groups.values()].map((g) => ({ id: g.id, name: g.subject || '' }))
    });
    await deliverOutbox(res.outbox, deps());
    log.info('Tersambung ke web app. Grup: ' + (groups.size ? [...groups.values()].map((g) => g.subject).join(', ') : '(belum ada)'));
  } catch (e) {
    log.error('Gagal lapor ke web app: ' + e.message);
    if (e.fatal) shutdown(1);
  }
}

async function poll() {
  if (!sock?.user) return;
  try {
    const res = await bridge.call('poll', {}, { retries: 0 });
    const n = await deliverOutbox(res.outbox, deps());
    if (n) log.info(n + ' notifikasi pesanan terkirim');
  } catch (e) {
    log.error('Cek notifikasi gagal: ' + e.message);
    if (e.fatal) shutdown(1);
  }
}

function deps() {
  return {
    sock, bridge, log, me: sock?.user, delayMs: cfg.replyDelayMs,
    groupName: async (jid) => {
      if (!jid.endsWith('@g.us')) return '';
      if (!groups.has(jid)) { try { groups.set(jid, await sock.groupMetadata(jid)); } catch { return ''; } }
      return groups.get(jid)?.subject || '';
    }
  };
}

function enqueue(jid, task) {
  const next = (chains.get(jid) || Promise.resolve()).then(task).catch((e) => log.error('Pesan dari ' + jid + ': ' + e.message));
  chains.set(jid, next);
  next.finally(() => { if (chains.get(jid) === next) chains.delete(jid); });
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.resolve(DIR, cfg.authDir));
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }
  const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

  sock = makeWASocket({
    version, logger, browser: Browsers.ubuntu('KasirWarung'),
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    markOnlineOnConnect: false, syncFullHistory: false, generateHighQualityLinkPreview: false,
    getMessage: async (key) => sent.get(key.id)?.message,
    cachedGroupMetadata: async (jid) => groups.get(jid)
  });

  sock.ev.on('creds.update', saveCreds);

  // Without internet/when web.whatsapp.com is blocked the socket can hang for minutes: say so and retry.
  const thisSock = sock;
  const watchdog = setTimeout(() => {
    log.error('Belum bisa terhubung ke server WhatsApp setelah 60 detik. Periksa internet / firewall (web.whatsapp.com:443). Mencoba lagi…');
    try { thisSock.end(new Error('connect timeout')); } catch { /* ignore */ }
  }, 60000);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr || connection === 'open' || connection === 'close') clearTimeout(watchdog);
    if (qr) {
      if (cfg.pairingNumber && !state.creds.registered) {
        if (!pairingAsked) {
          pairingAsked = true;
          try {
            const code = await sock.requestPairingCode(cfg.pairingNumber);
            log.info('KODE PAIRING: ' + code.match(/.{1,4}/g).join('-') +
              '\n   Di HP nomor ' + cfg.pairingNumber + ': WhatsApp → ⋮ / Setelan → Perangkat tertaut → Tautkan perangkat → "Tautkan dengan nomor telepon saja" → masukkan kode.');
          } catch (e) { log.error('Gagal meminta kode pairing: ' + e.message); }
        }
      } else {
        log.info('Scan QR ini dari WhatsApp → Perangkat tertaut → Tautkan perangkat:');
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === 'open') {
      retryDelay = 2000;
      log.info('WhatsApp tersambung sebagai ' + String(sock.user?.id || '').split(':')[0]);
      await hello();
      clearInterval(pollTimer); clearInterval(helloTimer);
      pollTimer = setInterval(poll, cfg.pollSeconds * 1000);
      helloTimer = setInterval(hello, 30 * 60 * 1000);
    }
    if (connection === 'close') {
      clearInterval(pollTimer); clearInterval(helloTimer);
      if (!state.creds.registered) pairingAsked = false; // code expired → ask again after reconnect
      const code = lastDisconnect?.error?.output?.statusCode;
      if (stopping) return;
      if (code === DisconnectReason.loggedOut) {
        log.error('Perangkat dikeluarkan dari WhatsApp. Hapus folder "' + cfg.authDir + '" lalu jalankan lagi untuk pairing ulang.');
        return shutdown(1);
      }
      log.info('Koneksi terputus (' + (code || lastDisconnect?.error?.message || '?') + '), menyambung ulang dalam ' + retryDelay / 1000 + ' dtk…');
      setTimeout(() => start().catch((e) => log.error(e.message)), retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    }
  });

  sock.ev.on('groups.update', (list) => {
    for (const g of list) if (g.id && groups.has(g.id)) groups.set(g.id, { ...groups.get(g.id), ...g });
  });
  sock.ev.on('group-participants.update', ({ id }) => { groups.delete(id); });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return; // skip history/backlog sync
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid) continue;
      const ageSec = Date.now() / 1000 - Number(msg.messageTimestamp || 0);
      if (ageSec > 300) continue; // ignore messages older than 5 minutes (bot was offline)
      enqueue(jid, async () => {
        const r = await handleMessage(msg, deps());
        if (!r.skipped && r.replies) log.info('Balas ' + (msg.pushName || jid) + ' (' + r.replies + ' pesan)');
      });
    }
  });

  // Keep what we send for retry requests (bounded).
  const origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...args) => {
    const m = await origSend(...args);
    if (m?.key?.id) { sent.set(m.key.id, m); if (sent.size > 500) sent.delete(sent.keys().next().value); }
    return m;
  };
}

function shutdown(code = 0) {
  stopping = true;
  clearInterval(pollTimer); clearInterval(helloTimer);
  try { sock?.end(undefined); } catch { /* ignore */ }
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => { log.info('Bot dihentikan.'); shutdown(0); });
process.on('SIGTERM', () => shutdown(0));

log.info('KasirWarung WA bot mulai… (web app: ' + cfg.url.replace(/\/s\/(.{6}).+\/exec$/, '/s/$1…/exec') + ')');
start().catch((e) => { log.error(e.stack || e.message); process.exit(1); });
