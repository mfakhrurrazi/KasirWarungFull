import test from 'node:test';
import assert from 'node:assert/strict';
import { toPayload, senderPhone, isMentioned, toJid, handleMessage, deliverOutbox, extractText } from '../lib/handler.js';
import { Bridge } from '../lib/bridge.js';
import { readConfig } from '../lib/env.js';

const ME = { id: '6281111111111:7@s.whatsapp.net', lid: '99887766554433:7@lid' };
const GROUP = '120363000000001@g.us';

test('extracts text from plain, extended, caption and ephemeral messages', () => {
  assert.equal(extractText({ conversation: ' menu ' }), 'menu');
  assert.equal(extractText({ extendedTextMessage: { text: 'harga beras' } }), 'harga beras');
  assert.equal(extractText({ imageMessage: { caption: 'pesan 2 indomie' } }), 'pesan 2 indomie');
  assert.equal(extractText({ ephemeralMessage: { message: { conversation: 'kasbon' } } }), 'kasbon');
  assert.equal(extractText({ stickerMessage: {} }), '');
});

test('sender phone survives LID addressing', () => {
  assert.equal(senderPhone({ remoteJid: '6281234567801@s.whatsapp.net' }), '6281234567801');
  assert.equal(senderPhone({ remoteJid: '1234567@lid', remoteJidAlt: '6281234567801@s.whatsapp.net' }), '6281234567801');
  assert.equal(senderPhone({ remoteJid: GROUP, participant: '1234567@lid', participantAlt: '6285712345678@s.whatsapp.net' }), '6285712345678');
  assert.equal(senderPhone({ remoteJid: GROUP, participant: '1234567@lid' }), '', 'hidden number stays empty');
  assert.equal(senderPhone({ remoteJid: GROUP, participant: '6285712345678:3@s.whatsapp.net' }), '6285712345678');
});

test('mention detection by number, LID or reply to the bot', () => {
  assert.equal(isMentioned({ extendedTextMessage: { text: '@628 halo', contextInfo: { mentionedJid: ['6281111111111@s.whatsapp.net'] } } }, ME), true);
  assert.equal(isMentioned({ extendedTextMessage: { text: '@x halo', contextInfo: { mentionedJid: ['99887766554433@lid'] } } }, ME), true);
  assert.equal(isMentioned({ extendedTextMessage: { text: 'ok', contextInfo: { participant: '6281111111111@s.whatsapp.net' } } }, ME), true);
  assert.equal(isMentioned({ extendedTextMessage: { text: 'hi', contextInfo: { mentionedJid: ['6280000000000@s.whatsapp.net'] } } }, ME), false);
  assert.equal(isMentioned({ conversation: 'hi' }, ME), false);
});

test('payload: ignores own, status, newsletter and empty messages', () => {
  const base = { key: { remoteJid: GROUP, participant: '6281234567801@s.whatsapp.net', id: 'A1' }, pushName: 'Siti', message: { conversation: 'harga beras' } };
  assert.deepEqual(toPayload(base, ME, 'Pelanggan'), { chat: GROUP, chatName: 'Pelanggan', isGroup: true, sender: '6281234567801', name: 'Siti', text: 'harga beras', mentioned: false, id: 'A1' });
  assert.equal(toPayload({ ...base, key: { ...base.key, fromMe: true } }, ME), null);
  assert.equal(toPayload({ ...base, key: { remoteJid: 'status@broadcast', id: 'x' } }, ME), null);
  assert.equal(toPayload({ ...base, key: { remoteJid: '1203@newsletter', id: 'x' } }, ME), null);
  assert.equal(toPayload({ ...base, message: { reactionMessage: {} } }, ME), null);
  assert.equal(toPayload({ key: base.key }, ME), null);
});

test('outbox targets', () => {
  assert.equal(toJid('6281234567801'), '6281234567801@s.whatsapp.net');
  assert.equal(toJid(GROUP), GROUP);
  assert.equal(toJid(''), '');
});

function fakeSock() {
  const out = [];
  return { out, sendPresenceUpdate: async () => {}, sendMessage: async (jid, content, opts) => { out.push({ jid, content, opts }); return { key: { id: 'S' + out.length } }; } };
}

test('handleMessage relays to the server, replies quoted, then delivers outbox', async () => {
  const sock = fakeSock();
  const calls = [];
  const bridge = { call: async (action, data) => { calls.push({ action, data }); return { ok: true, replies: ['Halo Siti'], outbox: [{ to: '6285712345678', text: 'Pesanan siap' }] }; } };
  const msg = { key: { remoteJid: GROUP, participant: '6281234567801@s.whatsapp.net', id: 'B1' }, pushName: 'Siti', message: { conversation: 'menu' } };
  const r = await handleMessage(msg, { sock, bridge, me: ME, delayMs: 0, groupName: async () => 'Pelanggan' });
  assert.equal(r.replies, 1);
  assert.equal(calls[0].action, 'message');
  assert.equal(calls[0].data.chatName, 'Pelanggan');
  assert.deepEqual(sock.out.map((o) => [o.jid, o.content.text, !!o.opts?.quoted]), [[GROUP, 'Halo Siti', true], ['6285712345678@s.whatsapp.net', 'Pesanan siap', false]]);
  const skipped = await handleMessage({ key: { remoteJid: GROUP, fromMe: true, id: 'B2' }, message: { conversation: 'x' } }, { sock, bridge, me: ME, delayMs: 0 });
  assert.equal(skipped.skipped, true);
  assert.equal(calls.length, 1);
});

test('deliverOutbox keeps going when one send fails', async () => {
  let n = 0;
  const sock = { sendPresenceUpdate: async () => {}, sendMessage: async () => { if (n++ === 0) throw new Error('boom'); } };
  const sent = await deliverOutbox([{ to: '62811', text: 'a' }, { to: '62812', text: 'b' }], { sock, delayMs: 0, log: { error() {} } });
  assert.equal(sent, 1);
});

test('bridge: sends secret + kw, retries network errors, explains HTML answers, stops on a wrong secret', async () => {
  const seen = [];
  let fail = 1;
  const okFetch = async (url, o) => {
    seen.push(JSON.parse(o.body));
    if (fail-- > 0) throw new Error('ECONNRESET');
    return { status: 200, text: async () => JSON.stringify({ ok: true, replies: ['x'] }) };
  };
  const b = new Bridge({ url: 'https://script.google.com/macros/s/X/exec', secret: 'abc', fetchImpl: okFetch });
  assert.deepEqual((await b.call('message', { text: 'hi' })).replies, ['x']);
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], { kw: 'wa', secret: 'abc', action: 'message', text: 'hi' });

  const html = new Bridge({ url: 'u', secret: 's', fetchImpl: async () => ({ status: 200, text: async () => '<html>Sign in</html>' }) });
  await assert.rejects(html.call('poll', {}, { retries: 0 }), /Who has access: Anyone/);

  let n = 0;
  const bad = new Bridge({ url: 'u', secret: 's', fetchImpl: async () => { n++; return { status: 200, text: async () => '{"ok":false,"error":"Kode rahasia bot salah."}' }; } });
  await assert.rejects(bad.call('poll'), (e) => e.fatal === true);
  assert.equal(n, 1, 'no retry on a wrong secret');
});

test('config validation', () => {
  const good = readConfig({ APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfy123/exec', BOT_SECRET: 'a'.repeat(64), PAIRING_NUMBER: '0812-3456-7890'.replace(/^0/, '62') });
  assert.deepEqual(good.problems, []);
  assert.equal(good.cfg.pollSeconds, 30);
  const bad = readConfig({ APPS_SCRIPT_URL: 'http://x', BOT_SECRET: '', PAIRING_NUMBER: '0812' });
  assert.equal(bad.problems.length, 3);
});
