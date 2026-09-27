// Pure message logic, testable without a WhatsApp connection.
import { normalizeMessageContent, jidNormalizedUser, isJidGroup } from 'baileys';

const IGNORE_JID = /@(broadcast|newsletter)$|^status@/;

export function extractText(message) {
  const m = normalizeMessageContent(message);
  if (!m) return '';
  return String(
    m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption ||
    m.documentMessage?.caption || m.buttonsResponseMessage?.selectedDisplayText || m.listResponseMessage?.title || ''
  ).trim();
}

function contextInfo(message) {
  const m = normalizeMessageContent(message);
  if (!m) return null;
  for (const k of Object.keys(m)) if (m[k] && typeof m[k] === 'object' && m[k].contextInfo) return m[k].contextInfo;
  return null;
}

/** Phone number (62…) of a JID, or '' for LID / unknown. */
export function phoneOf(jid) {
  const s = String(jid || '');
  if (!s.endsWith('@s.whatsapp.net')) return '';
  const n = s.split('@')[0].split(':')[0];
  return /^\d{8,16}$/.test(n) ? n : '';
}

/** The sender's real number: WhatsApp may hide it behind a LID, Baileys 7 exposes the PN in *Alt fields. */
export function senderPhone(key) {
  const group = isJidGroup(key.remoteJid);
  const candidates = group
    ? [key.participantAlt, key.participantPn, key.participant]
    : [key.remoteJidAlt, key.senderPn, key.remoteJid];
  for (const c of candidates) { const p = phoneOf(c); if (p) return p; }
  return '';
}

/** Mentioned by number or LID, or the message replies to one of the bot's messages. */
export function isMentioned(message, me) {
  const ci = contextInfo(message);
  if (!ci || !me) return false;
  const mine = [me.id, me.lid, me.phoneNumber].filter(Boolean).map((j) => jidNormalizedUser(j));
  const hit = (j) => !!j && mine.includes(jidNormalizedUser(j));
  return (ci.mentionedJid || []).some(hit) || hit(ci.participant);
}

/** Converts a raw Baileys message into the payload for the server, or null to ignore it. */
export function toPayload(msg, me, groupName) {
  const key = msg?.key || {};
  const jid = key.remoteJid || '';
  if (!msg?.message || key.fromMe || !jid || IGNORE_JID.test(jid)) return null;
  const text = extractText(msg.message);
  if (!text) return null;
  const group = !!isJidGroup(jid);
  return {
    chat: jid, chatName: group ? (groupName || '') : '', isGroup: group,
    sender: senderPhone(key), name: String(msg.pushName || '').slice(0, 40),
    text: text.slice(0, 2000), mentioned: group ? isMentioned(msg.message, me) : false, id: key.id || ''
  };
}

/** Outbox target: "62812…" → personal chat, "…@g.us" → group. */
export function toJid(to) {
  const s = String(to || '');
  if (s.endsWith('@g.us') || s.endsWith('@s.whatsapp.net')) return s;
  const d = s.replace(/[^\d]/g, '');
  return d ? d + '@s.whatsapp.net' : '';
}

/**
 * Handles one incoming message end to end.
 * deps: { sock, bridge, me, groupName(jid), delayMs, log }
 */
export async function handleMessage(msg, deps) {
  const payload = toPayload(msg, deps.me, deps.groupName ? await deps.groupName(msg.key.remoteJid) : '');
  if (!payload) return { skipped: true };
  const res = await deps.bridge.call('message', payload);
  const replies = (res.replies || []).filter(Boolean);
  for (const text of replies) {
    await sendHuman(deps, payload.chat, { text }, { quoted: msg });
  }
  await deliverOutbox(res.outbox, deps);
  return { replies: replies.length };
}

export async function deliverOutbox(outbox, deps) {
  let sent = 0;
  for (const item of outbox || []) {
    const jid = toJid(item.to);
    if (!jid || !item.text) continue;
    try {
      await sendHuman(deps, jid, { text: item.text });
      sent++;
    } catch (e) {
      (deps.log || console).error('Gagal mengirim notifikasi ke ' + jid + ': ' + e.message);
    }
  }
  return sent;
}

/** "Typing…" then send, with a short human-like pause (reduces ban risk). */
async function sendHuman(deps, jid, content, opts) {
  const delay = deps.delayMs ?? 1200;
  try { await deps.sock.sendPresenceUpdate('composing', jid); } catch { /* optional */ }
  if (delay) await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * delay)));
  try { await deps.sock.sendPresenceUpdate('paused', jid); } catch { /* optional */ }
  return deps.sock.sendMessage(jid, content, opts);
}
