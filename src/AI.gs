/**
 * KasirWarung AI — AI.gs
 * Optional AI value-add through an OpenAI-compatible endpoint.
 * The app works 100% without AI: every feature has a rule/template fallback.
 *
 * Script Properties (never stored in sheets or sent to the browser):
 *   AI_BASE_URL  default http://43.133.148.28:20128/v1  (plain HTTP → use an HTTPS proxy in production)
 *   AI_API_KEY   bearer token
 *   AI_MODEL     model name
 *
 * © 2026 KasirWarung AI · Made by Piyu
 */

const AI_DEFAULT_BASE_URL = 'http://43.133.148.28:20128/v1';
const AI_FEATURE = {
  KULAKAN: 'Saran Kulakan',
  TAGIH: 'Pesan Tagih Halus',
  OMZET: 'Cerita Omzet Hari Ini',
  TEST: 'Tes Koneksi AI'
};

// callAI() is a top-level function (as specified) and therefore visible to
// google.script.run. This gate is only opened by authenticated server
// features, so a direct browser call is rejected.
let AI_GATE_ = false;

function withAiGate_(fn) {
  AI_GATE_ = true;
  try { return fn(); } finally { AI_GATE_ = false; }
}

function aiConfig_() {
  const p = props_();
  return {
    base: String(p.getProperty('AI_BASE_URL') || AI_DEFAULT_BASE_URL).trim().replace(/\/+$/, ''),
    key: String(p.getProperty('AI_API_KEY') || '').trim(),
    model: String(p.getProperty('AI_MODEL') || '').trim()
  };
}

function aiConfigured_() {
  const c = aiConfig_();
  return !!(c.key && c.model);
}

/** Safe status for the settings page — the key itself is never returned. */
function aiStatus_() {
  const c = aiConfig_();
  let host = '';
  try { host = c.base.replace(/^https?:\/\//i, '').split('/')[0]; } catch (e) { host = ''; }
  return {
    enabled: !!getSettings_().AI_ENABLED, configured: !!(c.key && c.model), keySet: !!c.key,
    model: c.model, host: host, https: /^https:\/\//i.test(c.base)
  };
}

function logAi_(user, feature, status) {
  try {
    appendRows_(meta_('Log_AI'), [{ timestamp: new Date(), user: user || 'system', feature: feature, status: String(status).substring(0, 250) }]);
  } catch (e) {
    console.error('logAi_ gagal: ' + e.message);
  }
}

function md5Hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * POST {AI_BASE_URL}/chat/completions with temperature 0.4, one retry,
 * 6-hour cache and Log_AI logging.
 * @return {{ok:boolean, text?:string, cached?:boolean, reason?:string}}
 */
function callAI(feature, messages, user) {
  if (!AI_GATE_) throw new Error('callAI hanya dapat dipanggil dari fitur AI di server.');
  user = user || 'system';
  if (!getSettings_().AI_ENABLED) {
    logAi_(user, feature, 'OFF → fallback');
    return { ok: false, reason: 'OFF' };
  }
  const cfg = aiConfig_();
  if (!cfg.key || !cfg.model) {
    logAi_(user, feature, 'NO_CONFIG → fallback');
    return { ok: false, reason: 'NO_CONFIG' };
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'ai_' + md5Hex_(feature + '|' + cfg.model + '|' + JSON.stringify(messages));
  const hit = cache.get(cacheKey);
  if (hit) {
    logAi_(user, feature, 'CACHE');
    return { ok: true, text: hit, cached: true };
  }

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.key },
    payload: JSON.stringify({ model: cfg.model, messages: messages, temperature: 0.4, stream: false }),
    muteHttpExceptions: true,
    followRedirects: true
  };
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = UrlFetchApp.fetch(cfg.base + '/chat/completions', options);
      const code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        let text = aiReplyText_(res.getContentText());
        text = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        if (text) {
          if (text.length < 90000) cache.put(cacheKey, text, 21600);
          logAi_(user, feature, 'OK');
          return { ok: true, text: text };
        }
        lastErr = 'jawaban kosong';
      } else {
        lastErr = 'HTTP ' + code;
        if (code >= 400 && code < 500 && code !== 408 && code !== 429) break;
      }
    } catch (e) {
      lastErr = e.message;
    }
    if (attempt === 0) Utilities.sleep(1200);
  }
  logAi_(user, feature, 'ERROR: ' + lastErr + ' → fallback');
  return { ok: false, reason: lastErr };
}

/**
 * Extracts the assistant text from a chat/completions response body.
 * Besides plain JSON it accepts what some OpenAI-compatible gateways send:
 * keep-alive whitespace before the JSON, extra data after it, SSE
 * ("data: {...}" lines, even when stream:false was requested) and several
 * concatenated JSON objects (streaming chunks with choices[].delta).
 */
function aiReplyText_(body) {
  body = String(body || '').replace(/^\uFEFF/, '').trim();
  let objs = [];
  try {
    objs = [JSON.parse(body)];
  } catch (e) {
    const src = body.split(/\r?\n/)
      .filter(function (l) { return !/^(event|id|retry)\s*:|^:/.test(l); })
      .map(function (l) { return l.replace(/^data\s*:\s?/, ''); }).join('\n');
    objs = jsonObjects_(src);
    if (!objs.length) throw new Error('format jawaban AI tidak dikenal: ' + body.substring(0, 80));
  }
  let full = '';
  let delta = '';
  objs.forEach(function (j) {
    if (j && j.error) throw new Error('AI: ' + String(j.error.message || j.error).substring(0, 150));
    const c = j && j.choices && j.choices[0];
    if (!c) return;
    if (c.message && c.message.content && !full) full = String(c.message.content);
    else if (c.delta && c.delta.content) delta += String(c.delta.content);
    else if (typeof c.text === 'string' && !full) full = c.text;
  });
  return full || delta;
}

/** Parses every top-level {...} object in a string (string/escape aware). */
function jsonObjects_(s) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { if (depth > 0) inStr = true; }
    else if (ch === '{') { if (depth++ === 0) start = i; }
    else if (ch === '}' && depth > 0 && --depth === 0) {
      try { out.push(JSON.parse(s.substring(start, i + 1))); } catch (e) { /* skip */ }
    }
  }
  return out;
}

function fallbackReason_(reason) {
  if (reason === 'OFF') return 'AI dimatikan di Pengaturan — memakai hitungan otomatis.';
  if (reason === 'NO_CONFIG') return 'Kunci AI belum diatur — memakai hitungan otomatis.';
  if (reason === 'PARSE') return 'Jawaban AI tidak terbaca — memakai hitungan otomatis.';
  const why = /^HTTP \d+$/.test(String(reason || '')) ? ' (' + reason + ')' : '';
  return 'AI sedang tidak bisa dihubungi' + why + ' — memakai hitungan otomatis.';
}

function fmtQty_(n) {
  return (Math.round(n * 10) / 10).toString().replace('.', ',');
}

/* ------------------------------------------------------------------ */
/* 1) Saran Kulakan                                                    */
/* ------------------------------------------------------------------ */

function kulakanData_() {
  const today = today0_();
  const from = addDays_(today, -27); // 28 days including today
  const sold = {};
  salesInRange_(from, addDays_(today, 1)).forEach(function (s) {
    if (s.status === 'Batal') return;
    s.items.forEach(function (i) { sold[i.product_id] = (sold[i.product_id] || 0) + num_(i.qty); });
  });
  return productsAll_().filter(function (p) { return p.active; }).map(function (p) {
    const q = round2_(sold[p.product_id] || 0);
    return { product_id: p.product_id, name: p.name, unit: p.unit, stock: p.stock, min_stock: p.min_stock, cost: p.cost_price, sold28: q, avg: q / 28 };
  });
}

/** Rule: avg daily sales × 7 − stock (rounded up). */
function kulakanRule_(rows) {
  return rows.map(function (r) {
    const need = Math.ceil(r.avg * 7 - r.stock);
    if (need <= 0) return null;
    const cover = r.avg > 0 ? Math.floor(Math.max(0, r.stock) / r.avg) : 0;
    return {
      product_id: r.product_id, name: r.name, unit: r.unit, stock: r.stock, avg_daily: round2_(r.avg), qty: need,
      reason: 'Laku ±' + fmtQty_(r.avg) + ' ' + r.unit + '/hari, stok cukup ±' + cover + ' hari.',
      est_cost: Math.round(need * r.cost), _cover: cover
    };
  }).filter(Boolean).sort(function (a, b) { return a._cover - b._cover || b.avg_daily - a.avg_daily; })
    .map(function (x) { delete x._cover; return x; });
}

function aiSaranKulakan_(s) {
  const rows = kulakanData_();
  const byId = {};
  rows.forEach(function (r) { byId[r.product_id] = r; });
  const rule = kulakanRule_(rows);
  const total = function (items) { return items.reduce(function (a, i) { return a + i.est_cost; }, 0); };

  const candidates = rows.filter(function (r) { return r.sold28 > 0 || r.stock <= r.min_stock; })
    .sort(function (a, b) { return b.sold28 - a.sold28; }).slice(0, 80);
  if (!candidates.length) {
    return { source: 'rule', note: 'Belum ada data penjualan 28 hari terakhir.', summary: '', items: [], total_cost: 0 };
  }
  const table = candidates.map(function (r) {
    return [r.product_id, r.name, r.unit, r.stock, r.sold28, r.min_stock].join('|');
  }).join('\n');
  const messages = [
    {
      role: 'system',
      content: 'Kamu asisten kulakan (belanja stok) untuk warung sembako di Indonesia. Jawab dalam Bahasa Indonesia sederhana. ' +
        'Balas HANYA dengan JSON valid tanpa teks lain, format: {"ringkasan":"1-2 kalimat","items":[{"product_id":"...","qty":angka,"alasan":"maks 12 kata"}]}. ' +
        'Rencanakan stok untuk 7 hari ke depan, perhatikan stok minimum, hindari kulakan berlebihan untuk barang lambat laku. Maksimal 25 barang.'
    },
    {
      role: 'user',
      content: 'Tanggal: ' + fmtDmy_(today0_()) + '. Data 28 hari terakhir:\nproduct_id|nama|satuan|stok_sekarang|terjual_28_hari|stok_minimum\n' + table
    }
  ];
  const res = callAI(AI_FEATURE.KULAKAN, messages, s.username);
  if (res.ok) {
    try {
      const txt = res.text;
      const j = JSON.parse(txt.substring(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
      const items = (j.items || []).map(function (it) {
        const r = byId[String(it.product_id)];
        let q = Number(it.qty);
        if (!r || !isFinite(q) || q <= 0) return null;
        q = (r.unit === 'kg' || r.unit === 'liter') ? Math.ceil(q * 2) / 2 : Math.ceil(q);
        return {
          product_id: r.product_id, name: r.name, unit: r.unit, stock: r.stock, avg_daily: round2_(r.avg), qty: q,
          reason: String(it.alasan || it.reason || '').substring(0, 140), est_cost: Math.round(q * r.cost)
        };
      }).filter(Boolean);
      if (items.length) {
        return { source: 'ai', note: res.cached ? 'Dari cache AI (6 jam).' : '', summary: String(j.ringkasan || '').substring(0, 400), items: items, total_cost: total(items) };
      }
    } catch (e) { /* fall through */ }
    logAi_(s.username, AI_FEATURE.KULAKAN, 'PARSE_FAIL → aturan');
    return { source: 'rule', note: fallbackReason_('PARSE'), summary: '', items: rule, total_cost: total(rule) };
  }
  return { source: 'rule', note: fallbackReason_(res.reason), summary: '', items: rule, total_cost: total(rule) };
}

/* ------------------------------------------------------------------ */
/* 2) Pesan Tagih Halus                                                */
/* ------------------------------------------------------------------ */

function templateTagih_(name, amount, days, due, biz) {
  const when = days > 0 ? ' yang sudah lewat ' + days + ' hari dari jatuh tempo' : (due ? ' yang jatuh tempo ' + due : '');
  return 'Halo ' + name + ', semoga sehat selalu 🙏\n' +
    'Kami dari ' + biz + ' ingin mengingatkan catatan kasbon sebesar ' + rupiah_(amount) + when + '.\n' +
    'Kalau ada rezeki, boleh dibayar sebagian dulu ya. Terima kasih banyak atas kepercayaannya 😊';
}

function aiPesanTagih_(s, customerId) {
  const id = vId_(customerId, 'PLG', 'Pelanggan');
  const c = customersWithBalance_().filter(function (x) { return x.customer_id === id; })[0];
  if (!c) throw appError_('NOT_FOUND', 'Pelanggan tidak ditemukan.');
  if (c.outstanding <= 0) throw appError_('INVALID', c.name + ' tidak punya kasbon terbuka.');
  const biz = getSettings_().BUSINESS_NAME;
  const days = Math.max(0, c.days_overdue || 0);
  const due = c.oldest_due ? fmtDmy_(c.oldest_due) : '';
  const base = { name: c.name, phone: c.phone, amount: c.outstanding, days: days, customer_id: id };

  const messages = [
    {
      role: 'system',
      content: 'Kamu membantu pemilik warung menulis pesan WhatsApp pengingat kasbon (utang belanja). ' +
        'Gunakan Bahasa Indonesia santai, sopan, hangat, tidak mengancam dan tidak mempermalukan. Maksimal 4 kalimat, boleh 1-2 emoji. ' +
        'Tulis nominal persis seperti diberikan. Tawarkan boleh dicicil. Tutup dengan nama warung. Jawab hanya isi pesannya.'
    },
    {
      role: 'user',
      content: 'Nama pelanggan: ' + c.name + '\nSisa kasbon: ' + rupiah_(c.outstanding) + '\n' +
        (days > 0 ? 'Terlambat: ' + days + ' hari dari jatuh tempo' : 'Belum lewat jatuh tempo' + (due ? ' (jatuh tempo ' + due + ')' : '')) +
        '\nNama warung: ' + biz
    }
  ];
  const res = callAI(AI_FEATURE.TAGIH, messages, s.username);
  if (res.ok) {
    const msg = res.text.replace(/^["'“”]+|["'“”]+$/g, '').trim().substring(0, 1000);
    if (msg) return Object.assign(base, { source: 'ai', message: msg, note: res.cached ? 'Dari cache AI (6 jam).' : '' });
  }
  return Object.assign(base, { source: 'template', message: templateTagih_(c.name, c.outstanding, days, due, biz), note: fallbackReason_(res.reason).replace('hitungan otomatis', 'template pesan') });
}

/* ------------------------------------------------------------------ */
/* 3) Cerita Omzet Hari Ini                                            */
/* ------------------------------------------------------------------ */

function omzetData_() {
  const today = today0_();
  const sales = salesInRange_(addDays_(today, -1), addDays_(today, 1)).filter(function (x) { return x.status !== 'Batal'; });
  const tk = ymdKey_(today);
  const d = { omzet: 0, profit: 0, trx: 0, yesterday: 0, methods: {}, best: null, kasbon: 0 };
  const prod = {};
  sales.forEach(function (x) {
    if (x.day !== tk) { d.yesterday += x.total; return; }
    d.omzet += x.total; d.profit += x.profit; d.trx++;
    d.methods[x.method] = (d.methods[x.method] || 0) + x.total;
    if (x.method === 'Kasbon') d.kasbon += x.total - x.paid;
    x.items.forEach(function (i) {
      const p = prod[i.product_id] || (prod[i.product_id] = { name: i.name, unit: i.unit, qty: 0, omzet: 0 });
      p.qty = round2_(p.qty + num_(i.qty)); p.omzet += num_(i.total);
    });
  });
  const list = Object.keys(prod).map(function (k) { return prod[k]; }).sort(function (a, b) { return b.omzet - a.omzet; });
  d.best = list[0] || null;
  d.margin = d.omzet ? Math.round(d.profit / d.omzet * 1000) / 10 : 0;
  return d;
}

function templateOmzet_(d, biz) {
  if (!d.trx) {
    return 'Hari ini ' + biz + ' belum mencatat transaksi. ' +
      (d.yesterday ? 'Kemarin omzetnya ' + rupiah_(d.yesterday) + ', jadi masih ada waktu mengejar. ' : 'Semangat membuka warung hari ini. ') +
      'Pastikan barang laris seperti mi instan, telur dan minyak goreng tersedia di rak depan.';
  }
  let cmp = '';
  if (d.yesterday > 0) {
    const pct = Math.round((d.omzet - d.yesterday) / d.yesterday * 100);
    cmp = pct > 0 ? ', naik ' + pct + '% dibanding kemarin' : (pct < 0 ? ', turun ' + Math.abs(pct) + '% dibanding kemarin' : ', sama seperti kemarin');
  }
  const s1 = 'Hari ini ' + biz + ' mencatat omzet ' + rupiah_(d.omzet) + ' dari ' + d.trx + ' transaksi' + cmp + '.';
  const s2 = d.best ? 'Barang paling laris adalah ' + d.best.name + ' sebanyak ' + fmtQty_(d.best.qty) + ' ' + d.best.unit + ' senilai ' + rupiah_(d.best.omzet) + '.' : '';
  const note = d.margin >= 15 ? 'cukup sehat, pertahankan' : (d.margin >= 8 ? 'masih wajar, coba cek lagi harga modal barang laris' : 'masih tipis, pertimbangkan menyesuaikan harga jual');
  const s3 = 'Laba kotor sekitar ' + rupiah_(d.profit) + ' dengan margin ' + String(d.margin).replace('.', ',') + '%, ' + note + '.';
  return [s1, s2, s3].filter(String).join(' ');
}

function aiCeritaOmzet_(s) {
  const d = omzetData_();
  const biz = getSettings_().BUSINESS_NAME;
  const data = { omzet: d.omzet, trx: d.trx, profit: d.profit, margin: d.margin, yesterday: d.yesterday, best: d.best };
  if (!d.trx) return { source: 'template', text: templateOmzet_(d, biz), note: 'Belum ada transaksi hari ini.', data: data };
  const lines = [
    'Nama warung: ' + biz,
    'Omzet hari ini: ' + rupiah_(d.omzet) + ' dari ' + d.trx + ' transaksi',
    'Omzet kemarin: ' + rupiah_(d.yesterday),
    'Barang terlaris: ' + (d.best ? d.best.name + ' (' + fmtQty_(d.best.qty) + ' ' + d.best.unit + ', ' + rupiah_(d.best.omzet) + ')' : '-'),
    'Laba kotor: ' + rupiah_(d.profit) + ' (margin ' + d.margin + '%)',
    'Per metode: ' + Object.keys(d.methods).map(function (m) { return m + ' ' + rupiah_(d.methods[m]); }).join(', '),
    'Kasbon baru hari ini: ' + rupiah_(d.kasbon)
  ];
  const messages = [
    {
      role: 'system',
      content: 'Kamu asisten keuangan yang ramah untuk pemilik warung. Tulis TEPAT 3 kalimat Bahasa Indonesia sederhana, tanpa judul, tanpa poin-poin: ' +
        '(1) omzet dan jumlah transaksi dibanding kemarin, (2) barang terlaris, (3) laba kotor dan margin plus satu saran praktis. Gunakan format Rupiah seperti Rp 1.250.000.'
    },
    { role: 'user', content: lines.join('\n') }
  ];
  const res = callAI(AI_FEATURE.OMZET, messages, s.username);
  if (res.ok) return { source: 'ai', text: res.text.substring(0, 1200), note: res.cached ? 'Dari cache AI (6 jam).' : '', data: data };
  return { source: 'template', text: templateOmzet_(d, biz), note: fallbackReason_(res.reason).replace('hitungan otomatis', 'ringkasan otomatis'), data: data };
}

/* ------------------------------------------------------------------ */
/* Browser API                                                         */
/* ------------------------------------------------------------------ */

function apiAiSaranKulakan(token) {
  return run_(token, 'ai.owner', function (s) { return withAiGate_(function () { return aiSaranKulakan_(s); }); });
}

function apiAiPesanTagih(token, customerId) {
  return run_(token, 'ai.reminder', function (s) { return withAiGate_(function () { return aiPesanTagih_(s, customerId); }); });
}

function apiAiCeritaOmzet(token) {
  return run_(token, 'ai.owner', function (s) { return withAiGate_(function () { return aiCeritaOmzet_(s); }); });
}

function apiAiTest(token) {
  return run_(token, 'settings', function (s) {
    return withAiGate_(function () {
      const t0 = Date.now();
      const res = callAI(AI_FEATURE.TEST, [
        { role: 'system', content: 'Jawab singkat dalam Bahasa Indonesia.' },
        { role: 'user', content: 'Balas persis: SIAP MEMBANTU WARUNG (' + t0 + '-' + Math.floor(Math.random() * 1e6) + ')' }
      ], s.username);
      return { ok: res.ok, reply: res.ok ? res.text.substring(0, 200) : '', reason: res.ok ? '' : fallbackReason_(res.reason), detail: res.ok ? '' : String(res.reason || '').substring(0, 200), ms: Date.now() - t0, status: aiStatus_() };
    });
  });
}
