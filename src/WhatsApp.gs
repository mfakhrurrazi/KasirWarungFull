/**
 * KasirWarung AI — WhatsApp.gs
 * Customer service over WhatsApp (groups + private chats) through the free
 * Baileys bot in /wa-bot. The bot only relays messages: every answer is
 * decided here, next to the data, so prices, stock, kasbon and the AI key
 * never leave the server.
 *
 *   bot ──POST {secret, action:'message', …}──▶ doPost ─▶ waMessage_() ─▶ {replies, outbox}
 *   bot ──POST {secret, action:'poll'}─────────▶ doPost ─▶ queued notifications
 *
 * Script Properties: WA_BOT_SECRET (shared secret), WA_CONFIG (JSON),
 * WA_STATUS (last heartbeat), WA_OUTBOX (pending notifications).
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const WA_ORDER_STATUS = ['Baru', 'Diproses', 'Selesai', 'Batal'];
const WA_DEFAULTS = {
  enabled: true,      // master switch
  private: true,      // answer private chats
  groups: [],         // allowed group ids; empty = every group the bot is in
  price: true,        // "harga …" / "stok …"
  order: true,        // "pesan …"
  kasbon: true,       // "kasbon" (private chat only)
  ai: true,           // free questions answered by AI (private chat or when mentioned)
  notify: true,       // tell the customer when the order status changes
  stock: 'status'     // 'status' (Tersedia/Sisa sedikit/Habis) | 'angka' | 'sembunyi'
};
const WA_RATE_ = { max: 8, windowSec: 60 };
const WA_OUTBOX_MAX_ = 60;

/* ------------------------------------------------------------------ */
/* Config & status (Script Properties)                                 */
/* ------------------------------------------------------------------ */

function waConfig_() {
  let c = {};
  try { c = JSON.parse(props_().getProperty('WA_CONFIG') || '{}'); } catch (e) { c = {}; }
  const out = Object.assign({}, WA_DEFAULTS, c);
  out.groups = Array.isArray(out.groups) ? out.groups.map(String) : [];
  if (['status', 'angka', 'sembunyi'].indexOf(out.stock) < 0) out.stock = 'status';
  return out;
}

function waCleanConfig_(p) {
  p = p || {};
  const out = {};
  ['enabled', 'private', 'price', 'order', 'kasbon', 'ai', 'notify'].forEach(function (k) {
    out[k] = p[k] === undefined ? WA_DEFAULTS[k] : vBool_(p[k]);
  });
  out.stock = ['status', 'angka', 'sembunyi'].indexOf(p.stock) >= 0 ? p.stock : 'status';
  out.groups = (Array.isArray(p.groups) ? p.groups : []).map(function (g) {
    return vStr_(g, 'ID grup', { max: 80, pattern: /^[\w.-]+@g\.us$/, hint: 'Contoh: 1203630xxxx@g.us' });
  }).filter(Boolean).slice(0, 50);
  return out;
}

function waStatus_() {
  let st = {};
  try { st = JSON.parse(props_().getProperty('WA_STATUS') || '{}'); } catch (e) { st = {}; }
  const at = Number(st.at || 0);
  return {
    lastSeen: at ? new Date(at) : null,
    online: !!at && Date.now() - at < 3 * 60 * 1000,
    me: st.me || '', groups: Array.isArray(st.groups) ? st.groups : [], version: st.version || ''
  };
}

function waTouchStatus_(b) {
  const p = props_();
  let st = {};
  try { st = JSON.parse(p.getProperty('WA_STATUS') || '{}'); } catch (e) { st = {}; }
  const now = Date.now();
  const changed = Array.isArray(b.groups) || (b.me && b.me !== st.me) || now - Number(st.at || 0) > 60000;
  if (!changed) return;
  st.at = now;
  if (b.me) st.me = String(b.me).replace(/[^\d]/g, '').substring(0, 16);
  if (b.version) st.version = String(b.version).substring(0, 20);
  if (Array.isArray(b.groups)) {
    st.groups = b.groups.slice(0, 50).map(function (g) {
      return { id: String(g.id || '').substring(0, 80), name: String(g.name || '').substring(0, 80) };
    }).filter(function (g) { return /@g\.us$/.test(g.id); });
  }
  p.setProperty('WA_STATUS', JSON.stringify(st));
}

/* ------------------------------------------------------------------ */
/* Webhook entry (called from doPost)                                  */
/* ------------------------------------------------------------------ */

function safeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** @return {object} JSON-able answer for the bot. */
function waWebhook_(b) {
  const secret = props_().getProperty('WA_BOT_SECRET');
  if (!secret) return { ok: false, error: 'WA_BOT_SECRET belum dibuat. Buka Pengaturan → Bot WhatsApp.' };
  if (!safeEqual_(b.secret, secret)) return { ok: false, error: 'Kode rahasia bot salah.' };
  if (!isDbReady_()) return { ok: false, error: 'Database belum siap.' };
  waTouchStatus_(b);
  const cfg = waConfig_();
  if (b.action === 'poll' || b.action === 'hello') {
    return { ok: true, enabled: cfg.enabled, outbox: waTakeOutbox_() };
  }
  if (b.action === 'message') {
    let replies = [];
    try {
      replies = cfg.enabled ? waMessage_(b, cfg) : [];
    } catch (e) {
      console.error('waMessage_: ' + ((e && e.stack) || e));
      replies = ['Maaf Kak, sistem warung sedang sibuk. Coba lagi sebentar ya 🙏'];
    }
    return { ok: true, replies: replies, outbox: waTakeOutbox_() };
  }
  return { ok: false, error: 'Aksi tidak dikenal.' };
}

/* ------------------------------------------------------------------ */
/* Message understanding                                               */
/* ------------------------------------------------------------------ */

/**
 * @param {{chat:string, chatName?:string, isGroup:boolean, sender?:string,
 *          name?:string, text:string, mentioned?:boolean, id?:string}} m
 * @return {string[]} replies (empty = stay silent)
 */
function waMessage_(m, cfg) {
  const isGroup = !!m.isGroup;
  const chat = String(m.chat || '');
  if (isGroup ? (cfg.groups.length && cfg.groups.indexOf(chat) < 0) : !cfg.private) return [];

  let text = String(m.text || '').replace(/\r/g, '').trim();
  if (!text) return [];
  if (text.length > 2000) text = text.substring(0, 2000);
  text = text.replace(/@\d{5,}/g, '').trim(); // "@62812… harga beras" → "harga beras"

  const cache = CacheService.getScriptCache();
  if (m.id) {
    const k = 'wa_msg_' + md5Hex_(chat + '|' + m.id);
    if (cache.get(k)) return [];
    cache.put(k, '1', 600);
  }

  const phone = waPhone_(m.sender);
  const who = { phone: phone, name: String(m.name || '').replace(/[*_~`]/g, '').substring(0, 40) || 'Kak', chat: chat,
    chatName: String(m.chatName || '').substring(0, 60), isGroup: isGroup };

  const cmd = waCommand_(text, isGroup, !!m.mentioned);
  if (!cmd) return [];

  // Flood guard per sender (per chat when the number is hidden).
  const rk = 'wa_rate_' + md5Hex_(phone || chat + '|' + who.name);
  const n = Number(cache.get(rk) || 0) + 1;
  cache.put(rk, String(n), WA_RATE_.windowSec);
  if (n > WA_RATE_.max) return n === WA_RATE_.max + 1 ? ['Pelan-pelan ya Kak 🙏 Tunggu 1 menit lalu kirim lagi.'] : [];

  const st = getSettings_();
  switch (cmd.type) {
    case 'menu': return [waMenu_(who, st, cfg)];
    case 'alamat': return [waAlamat_(st)];
    case 'harga': return [cfg.price ? waHarga_(cmd.arg, cfg) : waOff_('Cek harga')];
    case 'pesan': return [cfg.order ? waPesan_(cmd.arg, who, st) : waOff_('Pesan lewat WhatsApp')];
    case 'status': return [waStatusPesanan_(cmd.arg, who)];
    case 'kasbon': return [cfg.kasbon ? waKasbon_(who, st) : waOff_('Cek kasbon')];
    default: return [waFreeText_(text, who, st, cfg)];
  }
}

/** 628xxxxxxxxxx or '' (LID-only senders have no visible number). */
function waPhone_(v) {
  const s = String(v || '').split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  return /^62\d{8,13}$/.test(s) ? s : '';
}

/**
 * Commands work in groups and private chats. Free questions are answered in
 * private chats, or in a group only when the bot is mentioned — the bot never
 * joins ordinary group conversation.
 */
function waCommand_(text, isGroup, mentioned) {
  let t = text.toLowerCase().replace(/^[#!\/.]\s*/, '').trim();
  for (let i = 0; i < 3; i++) t = t.replace(/^(mau|saya|aku|sy|mo|tolong|kak|min|bang|bu|pak|ya)[\s,]+/, '');
  const first = t.split(/\s+/)[0].replace(/[^\w]/g, '');
  const rest = function (re) { return text.replace(re, '').trim(); };
  if (/^(menu|help|bantuan|info|mulai|start)$/.test(t)) return { type: 'menu' };
  if (/^(halo|hai|hi|hello|pagi|siang|sore|malam|assalamu.?alaikum|permisi|p)\b/.test(t) && t.length < 40 && (!isGroup || mentioned)) return { type: 'menu' };
  if (/^(alamat|lokasi|jam|buka)\b/.test(t) && t.length < 40) return { type: 'alamat' };
  if (/^(harga|hrg|cek|stok|stock)$/.test(first)) {
    return { type: 'harga', arg: rest(/^[\s\S]*?\b(harga|hrg|cek|stok|stock)\b\s*/i).replace(/\?+$/, '').trim() };
  }
  if (/^(ada|ready|ready\s+ga)\b/.test(t) && /\?\s*$/.test(t)) {
    return { type: 'harga', arg: rest(/^[\s\S]*?\b(ada|ready)\b\s*/i).replace(/\b(ga|gak|nggak|tidak|kah|nya)\b|\?+/gi, '').trim() };
  }
  if (/^(pesan|pesen|order|beli|psn)$/.test(first)) return { type: 'pesan', arg: rest(/^[\s\S]*?\b(pesan|pesen|order|beli|psn)\b[ \t:]*/i) };
  if (/^status$/.test(first) || /^PSN\d{6}-\d{3,6}$/i.test(text.trim())) return { type: 'status', arg: (text.match(/PSN\d{6}-\d{3,6}/i) || [''])[0].toUpperCase() };
  if (/^(kasbon|utang|hutang|bon|tagihan)\b/.test(t) && t.length < 40) return { type: 'kasbon' };
  if (!isGroup || mentioned) return { type: 'free' };
  return null;
}

function waOff_(what) {
  return what + ' belum diaktifkan oleh warung. Silakan hubungi kasir langsung ya Kak 🙏';
}

function waMenu_(who, st, cfg) {
  const lines = ['Halo ' + who.name + ' 👋 Selamat datang di *' + (st.BUSINESS_NAME || 'warung kami') + '*.', '', 'Ketik salah satu:'];
  if (cfg.price) lines.push('• *harga <barang>* — cek harga & stok', '  contoh: _harga beras_');
  if (cfg.order) lines.push('• *pesan* + daftar belanja per baris', '  contoh:', '  _pesan_', '  _2 indomie goreng_', '  _1 minyak goreng 2L_');
  lines.push('• *status <no. pesanan>* — cek pesanan');
  if (cfg.kasbon) lines.push('• *kasbon* — cek sisa kasbon (chat pribadi)');
  lines.push('• *alamat* — alamat & kontak warung');
  if (cfg.ai && aiConfigured_() && st.AI_ENABLED) lines.push('', 'Atau tanya saja dengan bahasa biasa 😊');
  return lines.join('\n');
}

function waAlamat_(st) {
  const out = ['🏪 *' + (st.BUSINESS_NAME || 'Warung') + '*'];
  if (st.BUSINESS_ADDRESS) out.push('📍 ' + st.BUSINESS_ADDRESS);
  if (st.WHATSAPP) out.push('📞 wa.me/' + String(st.WHATSAPP).replace(/[^\d]/g, ''));
  out.push('', 'Ketik *menu* untuk cek harga atau pesan barang.');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* Product search                                                      */
/* ------------------------------------------------------------------ */

function waNorm_(s) {
  return String(s || '').toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*(liter|litre|ltr|lt)\b/g, '$1l')
    .replace(/(\d+(?:[.,]\d+)?)\s*(kilogram|kilo)\b/g, '$1kg')
    .replace(/(\d+(?:[.,]\d+)?)\s*(gram|gr)\b/g, '$1g')
    .replace(/(\d+(?:[.,]\d+)?)\s+(kg|l|ml|g)\b/g, '$1$2')
    .replace(/\bmie\b/g, 'mi')
    .replace(/[^a-z0-9.,\s]/g, ' ').replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const WA_STOPWORDS_ = { yg: 1, yang: 1, ada: 1, ga: 1, gak: 1, nggak: 1, tidak: 1, berapa: 1, brp: 1, harganya: 1, kak: 1, min: 1, dong: 1,
  ya: 1, nya: 1, mau: 1, beli: 1, dan: 1, sama: 1, merk: 1, merek: 1, isi: 1, ukuran: 1, pcs: 1, bungkus: 1, bks: 1, buah: 1 };

function waTokens_(s) {
  return waNorm_(s).split(' ').filter(function (w) { return w && !WA_STOPWORDS_[w]; });
}

/** Ranked active products for a free-text query. */
function waSearch_(query, limit) {
  const q = waTokens_(query);
  if (!q.length) return [];
  const words = q.filter(function (w) { return /[a-z]/.test(w); });
  const scored = [];
  productsAll_().forEach(function (p) {
    if (!p.active) return;
    const name = ' ' + waNorm_(p.name + ' ' + p.category) + ' ';
    let score = 0, hitWords = 0;
    q.forEach(function (w) {
      if (name.indexOf(' ' + w + ' ') >= 0) { score += 3; if (/[a-z]/.test(w)) hitWords++; }
      else if (name.indexOf(' ' + w) >= 0) { score += 2; if (/[a-z]/.test(w)) hitWords++; }
      else if (w.length >= 4 && name.indexOf(w) >= 0) { score += 1; if (/[a-z]/.test(w)) hitWords++; }
    });
    if (!hitWords || (words.length >= 2 && hitWords * 2 < words.length)) return;
    if (hitWords === words.length) score += 2;
    scored.push({ p: p, score: score });
  });
  scored.sort(function (a, b) { return b.score - a.score || (b.p.stock > 0) - (a.p.stock > 0) || a.p.name.length - b.p.name.length; });
  return scored.slice(0, limit || 5).map(function (x) { return x.p; });
}

function waStockText_(p, cfg) {
  if (cfg.stock === 'sembunyi') return '';
  if (p.stock <= 0) return '❌ Habis';
  if (cfg.stock === 'angka') return '✅ Stok ' + fmtQtyWa_(p.stock) + ' ' + p.unit;
  return p.stock <= Math.max(p.min_stock, 0) ? '⚠️ Sisa sedikit' : '✅ Tersedia';
}

function fmtQtyWa_(n) {
  return (Math.round(n * 100) / 100).toString().replace('.', ',');
}

function waPriceLine_(p, cfg) {
  let s = '• *' + p.name + '* — ' + rupiah_(p.price_retail) + '/' + p.unit;
  const tiers = [];
  if (p.bundle_qty > 0 && p.price_bundle > 0 && p.price_bundle < p.price_retail) tiers.push('beli ' + fmtQtyWa_(p.bundle_qty) + '+: ' + rupiah_(p.price_bundle));
  if (p.wholesale_qty > 0 && p.price_wholesale > 0) tiers.push('grosir ' + fmtQtyWa_(p.wholesale_qty) + '+: ' + rupiah_(p.price_wholesale));
  if (tiers.length) s += ' (' + tiers.join(', ') + ')';
  const stock = waStockText_(p, cfg);
  return s + (stock ? '\n   ' + stock : '');
}

function waHarga_(q, cfg) {
  if (!q) return 'Mau cek harga barang apa Kak? Contoh: *harga beras* atau *harga minyak 2L*';
  const found = waSearch_(q, 5);
  if (!found.length) return 'Maaf Kak, *' + q.substring(0, 40) + '* belum ketemu di daftar barang kami 🙏\nCoba kata lain, misalnya merek atau ukurannya.';
  return 'Hasil cek *' + q.substring(0, 40) + '*:\n' + found.map(function (p) { return waPriceLine_(p, cfg); }).join('\n') +
    '\n\nMau pesan? Ketik *pesan* + daftar barangnya.';
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

const WA_QTY_WORDS_ = { satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
  sepuluh: 10, selusin: 12, lusin: 12, setengah: 0.5, stgh: 0.5 };

/** "2 indomie", "2x indomie", "indomie 2", "indomie x2 bks", "dua aqua", "5kg beras" → {qty, name, explicit}. */
function waParseLine_(line) {
  let s = String(line).replace(/^\s*(?:[-•*]+|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let qty = null, m;
  const units = '(?:pcs|pc|bks|bungkus|buah|biji|btl|botol|dus|renteng|rtg|pack|pak|sachet|saset|kaleng|karung|ikat)';
  if ((m = new RegExp('^(\\d+(?:[.,]\\d+)?)\\s*(?:x|×)?\\s*' + units + '?\\s+(.+)$', 'i').exec(s))) { qty = m[1]; s = m[2]; }
  else if ((m = new RegExp('^(.+?)\\s+(?:x|×)?\\s*(\\d+(?:[.,]\\d+)?)\\s*' + units + '?$', 'i').exec(s)) && !/(kg|l|ml|g)$/i.test(m[0])) { qty = m[2]; s = m[1]; }
  else if ((m = /^(\S+)\s+(.+)$/.exec(s)) && WA_QTY_WORDS_[m[1].toLowerCase()]) { qty = WA_QTY_WORDS_[m[1].toLowerCase()]; s = m[2]; }
  s = s.replace(/^(x|×)\s*/i, '').trim();
  const n = qty === null ? 1 : parseNumberID_(String(qty));
  if (!s || !isFinite(n) || n <= 0) return null;
  return { qty: Math.min(Math.round(n * 100) / 100, 1000), name: s.substring(0, 60), explicit: qty !== null };
}

function waOrderLines_(arg) {
  return String(arg || '').split(/\n|;|,(?!\d)|\s+dan\s+|\s+&\s+/i)
    .map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 30);
}

function waPesan_(arg, who, st) {
  const lines = waOrderLines_(arg);
  if (!lines.length) {
    return 'Siap Kak! Kirim daftar belanjanya per baris ya, contoh:\n\n*pesan*\n2 indomie goreng\n1 minyak goreng 2L\n1 gas 3kg';
  }
  const items = [], missing = [], shortStock = [];
  lines.forEach(function (line) {
    const it = waParseLine_(line);
    if (!it) return;
    const p = waSearch_(it.name, 1)[0];
    if (!p) { missing.push(line.substring(0, 40)); return; }
    let qty = it.qty;
    // "gula 2kg" with a product sold per kg → 2 kg, unless "2kg" is part of the product name.
    const w = /(\d+(?:[.,]\d+)?)(kg|l)\b/.exec(waNorm_(it.name));
    if (!it.explicit && w && waNorm_(p.name).indexOf(w[0]) < 0 && ((w[2] === 'kg' && p.unit === 'kg') || (w[2] === 'l' && p.unit === 'liter'))) {
      qty = parseNumberID_(w[1]);
    }
    const same = items.find(function (x) { return x.product_id === p.product_id; });
    if (same) qty += same.qty;
    const up = unitPrice_(p, qty);
    const row = { product_id: p.product_id, name: p.name, unit: p.unit, qty: qty, price: up.price, tier: up.tier, subtotal: Math.round(up.price * qty) };
    if (same) Object.assign(same, row); else items.push(row);
  });
  items.forEach(function (i) {
    const p = productsAll_().find(function (x) { return x.product_id === i.product_id; });
    if (p && i.qty > p.stock) shortStock.push(i.name + ' (sisa ' + fmtQtyWa_(Math.max(0, p.stock)) + ' ' + p.unit + ')');
  });
  if (!items.length) {
    return 'Maaf Kak, barangnya belum ketemu di daftar kami 🙏\n' + missing.map(function (x) { return '• ' + x; }).join('\n') +
      '\n\nCek dulu dengan *harga <nama barang>*, lalu kirim lagi *pesan* + daftarnya.';
  }
  const total = items.reduce(function (a, i) { return a + i.subtotal; }, 0);
  const order = waSaveOrder_(who, items, total, missing, shortStock, arg);

  const out = ['✅ Pesanan *' + order.order_id + '* sudah dicatat, ' + who.name + '!', ''];
  items.forEach(function (i, k) {
    out.push((k + 1) + '. ' + i.name + ' × ' + fmtQtyWa_(i.qty) + ' = ' + rupiah_(i.subtotal) + (i.tier !== 'Eceran' ? ' _(' + i.tier.toLowerCase() + ')_' : ''));
  });
  out.push('', 'Perkiraan total: *' + rupiah_(total) + '*');
  if (shortStock.length) out.push('⚠️ Stok kurang: ' + shortStock.join(', '));
  if (missing.length) out.push('❓ Belum ketemu: ' + missing.join(', '));
  out.push('', 'Kasir akan cek & konfirmasi ya Kak 🙏' + (who.phone ? '' : ' (nomor Kakak tidak terlihat di grup, kasir akan membalas di sini)'),
    'Cek status: ketik *status ' + order.order_id + '*');
  return out.join('\n');
}

function waCustomerByPhone_(phone) {
  if (!phone) return null;
  const rows = readTable_('Customers').rows;
  for (let i = 0; i < rows.length; i++) {
    let p = String(rows[i].phone || '').replace(/[^\d]/g, '');
    if (p.indexOf('0') === 0) p = '62' + p.substring(1);
    if (p && p === phone) return rows[i];
  }
  return null;
}

/** WaOrders is created on first use, so existing installs need no setup run. */
function waOrdersMeta_() {
  if (!db_().getSheetByName('WaOrders')) {
    ensureSheet_(db_(), 'WaOrders', db_().getSheets().length);
  }
  return meta_('WaOrders');
}

function waSaveOrder_(who, items, total, missing, shortStock, raw) {
  const cust = waCustomerByPhone_(who.phone);
  const notes = [];
  if (missing.length) notes.push('Belum ketemu: ' + missing.join(', '));
  if (shortStock.length) notes.push('Stok kurang: ' + shortStock.join(', '));
  notes.push((who.chat === 'web' ? 'Toko online: ' : 'Pesan asli: ') + String(raw).replace(/\s+/g, ' ').substring(0, 300));
  const row = withLock_(function () {
    const t = waOrdersMeta_();
    const now = new Date();
    const r = {
      order_id: idGen_(t, 'order_id', 'PSN', now)(), datetime: now, customer_name: who.name, phone: who.phone,
      chat_id: who.chat, chat_name: who.chatName || (who.isGroup ? 'Grup' : 'Chat pribadi'),
      items_json: JSON.stringify(items), total: total, status: 'Baru', note: notes.join(' | ').substring(0, 1000),
      customer_id: cust ? String(cust.customer_id) : '', trx_id: '', handled_by: ''
    };
    appendRows_(t, [r]);
    return r;
  });
  logActivity_(who.chat === 'web' ? 'Toko online' : 'WhatsApp', who.chat === 'web' ? 'PESANAN_ONLINE' : 'PESANAN_WA', row.order_id, total, { from: who.name, items: items.length, chat: row.chat_name });
  return row;
}

function waStatusPesanan_(id, who) {
  if (!id) return 'Ketik *status* diikuti nomor pesanan, contoh: *status PSN260927-001*';
  if (!db_().getSheetByName('WaOrders')) return 'Pesanan *' + id + '* tidak ditemukan.';
  const r = findRow_(meta_('WaOrders'), 'order_id', id);
  const mine = r && (who.phone ? String(r.phone) === who.phone : String(r.chat_id) === who.chat && String(r.customer_name) === who.name);
  if (!r || !mine) return 'Pesanan *' + id + '* tidak ditemukan untuk nomor ini 🙏';
  const label = { Baru: '🕐 Menunggu dicek kasir', Diproses: '📦 Sedang disiapkan', Selesai: '✅ Selesai', Batal: '❌ Dibatalkan' }[r.status] || r.status;
  return 'Pesanan *' + id + '*\nStatus: ' + label + '\nTotal: ' + rupiah_(r.total) + (r.trx_id ? '\nNo. transaksi: ' + r.trx_id : '');
}

/* ------------------------------------------------------------------ */
/* Kasbon & free questions                                             */
/* ------------------------------------------------------------------ */

function waKasbon_(who, st) {
  if (who.isGroup) return 'Demi privasi, cek kasbon lewat *chat pribadi* ke nomor ini ya Kak 🙏 Ketik *kasbon* di sana.';
  if (!who.phone) return 'Maaf Kak, nomor Kakak tidak terbaca. Silakan tanya langsung ke kasir 🙏';
  const cust = waCustomerByPhone_(who.phone);
  if (!cust) return 'Nomor ini belum terdaftar sebagai pelanggan kasbon di ' + (st.BUSINESS_NAME || 'warung kami') + '. Silakan tanya kasir ya Kak 🙏';
  const c = customersWithBalance_().find(function (x) { return x.customer_id === String(cust.customer_id); });
  if (!c || !c.outstanding) return 'Halo ' + c.name + ' 😊 Kasbon Kakak sudah *lunas*. Terima kasih!';
  const due = c.oldest_due ? '\nJatuh tempo terdekat: ' + fmtDmy_(c.oldest_due) + (c.days_overdue > 0 ? ' (lewat ' + c.days_overdue + ' hari)' : '') : '';
  return 'Halo ' + c.name + ' 🙏\nSisa kasbon di ' + (st.BUSINESS_NAME || 'warung kami') + ': *' + rupiah_(c.outstanding) + '*' + due +
    '\nBoleh dicicil kapan saja ya Kak. Terima kasih atas kepercayaannya.';
}

function waFreeText_(text, who, st, cfg) {
  const fallback = 'Maaf Kak, saya belum paham 🙏\n\n' + waMenu_(who, st, cfg);
  if (!cfg.ai) return fallback;
  const hits = waSearch_(text, 6);
  const catalog = hits.length
    ? hits.map(function (p) { return p.name + ' | ' + rupiah_(p.price_retail) + '/' + p.unit + ' | ' + (p.stock > 0 ? 'tersedia' : 'habis'); }).join('\n')
    : '(tidak ada barang yang cocok dengan pertanyaan)';
  const messages = [
    {
      role: 'system',
      content: 'Kamu CS WhatsApp yang ramah untuk ' + (st.BUSINESS_NAME || 'warung sembako') + (st.BUSINESS_ADDRESS ? ' di ' + st.BUSINESS_ADDRESS : '') + '. ' +
        'Jawab singkat (maks 3 kalimat), Bahasa Indonesia santai-sopan, panggil "Kak". Jangan mengarang harga, stok, promo, ongkir atau jam buka: ' +
        'pakai hanya data barang di bawah; bila tidak tahu, minta pelanggan ketik "menu" atau tanya kasir. ' +
        'Untuk memesan, arahkan: ketik "pesan" lalu daftar barang per baris. Jangan membahas kasbon orang lain.\n' +
        'Data barang:\n' + catalog
    },
    { role: 'user', content: text.substring(0, 500) }
  ];
  const res = withAiGate_(function () { return callAI(AI_FEATURE.CS, messages, 'WhatsApp'); });
  if (!res.ok) return fallback;
  return res.text.substring(0, 1500);
}

/* ------------------------------------------------------------------ */
/* Outbox: notifications the bot delivers on its next poll             */
/* ------------------------------------------------------------------ */

function waQueue_(to, text) {
  if (!to || !text) return;
  withLock_(function () {
    const p = props_();
    let q = [];
    try { q = JSON.parse(p.getProperty('WA_OUTBOX') || '[]'); } catch (e) { q = []; }
    q.push({ to: String(to), text: String(text).substring(0, 1500), at: Date.now() });
    while (q.length > WA_OUTBOX_MAX_ || JSON.stringify(q).length > 8500) q.shift();
    p.setProperty('WA_OUTBOX', JSON.stringify(q));
  });
}

function waTakeOutbox_() {
  const p = props_();
  if (!p.getProperty('WA_OUTBOX')) return [];
  return withLock_(function () {
    let q = [];
    try { q = JSON.parse(p.getProperty('WA_OUTBOX') || '[]'); } catch (e) { q = []; }
    p.deleteProperty('WA_OUTBOX');
    const fresh = Date.now() - 24 * 3600 * 1000;
    return q.filter(function (x) { return x && x.to && x.at > fresh; }).map(function (x) { return { to: x.to, text: x.text }; });
  });
}

function waNotifyText_(r, status, reason, st) {
  const biz = st.BUSINESS_NAME || 'warung kami';
  const hi = 'Halo ' + (r.customer_name || 'Kak') + ' 🙏\n';
  if (status === 'Diproses') return hi + 'Pesanan *' + r.order_id + '* sedang disiapkan oleh ' + biz + '. Nanti kami kabari lagi ya.';
  if (status === 'Selesai') return hi + 'Pesanan *' + r.order_id + '* sudah *selesai*' + (r.trx_id ? ' (no. transaksi ' + r.trx_id + ')' : '') +
    '. Total ' + rupiah_(r.total) + '.\nTerima kasih sudah belanja di ' + biz + ' 😊';
  if (status === 'Batal') return hi + 'Mohon maaf, pesanan *' + r.order_id + '* dibatalkan' + (reason ? ': ' + reason : '') + '.\nSilakan hubungi kami bila ada pertanyaan.';
  return '';
}

/* ------------------------------------------------------------------ */
/* App API (browser)                                                   */
/* ------------------------------------------------------------------ */

function waOrderOut_(r) {
  let items = [];
  try { items = JSON.parse(String(r.items_json || '[]')); } catch (e) { items = []; }
  return {
    order_id: String(r.order_id), datetime: r.datetime instanceof Date ? r.datetime : null, customer_name: String(r.customer_name || ''),
    phone: String(r.phone || ''), chat_id: String(r.chat_id || ''), chat_name: String(r.chat_name || ''), items: items,
    total: num_(r.total), status: String(r.status || 'Baru'), note: String(r.note || ''), customer_id: String(r.customer_id || ''),
    trx_id: String(r.trx_id || ''), handled_by: String(r.handled_by || '')
  };
}

function apiWaOrders(token) {
  return run_(token, 'wa.order', function () {
    if (!db_().getSheetByName('WaOrders')) return { orders: [], bot: waStatus_() };
    const rows = readTable_('WaOrders').rows.map(waOrderOut_);
    rows.sort(function (a, b) { return (b.datetime ? b.datetime.getTime() : 0) - (a.datetime ? a.datetime.getTime() : 0); });
    return { orders: rows.slice(0, 300), bot: waStatus_() };
  });
}

function waSetStatus_(s, orderId, status, extra) {
  extra = extra || {};
  const id = vId_(orderId, 'PSN', 'No. pesanan');
  const next = vOneOf_(status, WA_ORDER_STATUS, 'Status pesanan');
  const reason = vStr_(extra.reason, 'Alasan', { max: 200, single: true });
  const trxId = extra.trx_id ? vId_(extra.trx_id, 'TRX', 'No. transaksi') : '';
  const r = withLock_(function () {
    const t = waOrdersMeta_();
    const row = findRow_(t, 'order_id', id);
    if (!row) throw appError_('NOT_FOUND', 'Pesanan ' + id + ' tidak ditemukan.');
    if (row.status === 'Selesai' || row.status === 'Batal') {
      if (row.status === next) return null;
      throw appError_('INVALID', 'Pesanan ' + id + ' sudah ' + row.status.toLowerCase() + '.');
    }
    if (row.status === next && !trxId) return null;
    row.status = next;
    row.handled_by = s.username;
    if (trxId) { row.trx_id = trxId; if (extra.total !== undefined) row.total = num_(extra.total); }
    if (reason) row.note = ('Alasan batal: ' + reason + ' | ' + String(row.note || '')).substring(0, 1000);
    rewriteRows_(t, [row]);
    return row;
  });
  if (!r) return { changed: false };
  logActivity_(s.username, 'PESANAN_WA_' + next.toUpperCase(), id, r.total, reason || trxId || '');
  const cfg = waConfig_();
  let notified = false;
  if (cfg.enabled && cfg.notify && props_().getProperty('WA_BOT_SECRET')) {
    const text = waNotifyText_(r, next, reason, getSettings_());
    const to = String(r.chat_id) === 'web' ? '' : (r.phone ? String(r.phone) : String(r.chat_id || ''));
    if (text && to) { waQueue_(to, text); notified = true; }
  }
  return { changed: true, notified: notified, order: waOrderOut_(r) };
}

function apiWaSetStatus(token, orderId, status, reason) {
  return run_(token, 'wa.order', function (s) {
    return waSetStatus_(s, orderId, status, { reason: reason });
  });
}

/** Owner: bot settings page. The secret itself is only shown right after it is created. */
function apiWaGetConfig(token) {
  return run_(token, 'settings', function () {
    return { config: waConfig_(), status: waStatus_(), hasSecret: !!props_().getProperty('WA_BOT_SECRET'), url: ScriptApp.getService().getUrl() || '' };
  });
}

function apiWaSaveConfig(token, payload) {
  return run_(token, 'settings', function (s) {
    const cfg = waCleanConfig_(payload);
    props_().setProperty('WA_CONFIG', JSON.stringify(cfg));
    logActivity_(s.username, 'UBAH_BOT_WA', '', '', cfg);
    return { config: waConfig_() };
  });
}

function apiWaNewSecret(token) {
  return run_(token, 'settings', function (s) {
    const secret = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props_().setProperty('WA_BOT_SECRET', secret);
    logActivity_(s.username, 'KODE_BOT_WA', '', '', 'Kode rahasia bot WhatsApp dibuat ulang');
    return { secret: secret, url: ScriptApp.getService().getUrl() || '' };
  });
}
