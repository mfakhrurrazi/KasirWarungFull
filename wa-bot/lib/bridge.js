// Talks to the KasirWarung web app (Apps Script doPost). The server decides
// every answer; the bot only relays.

export class Bridge {
  constructor({ url, secret, fetchImpl = globalThis.fetch, timeoutMs = 30000, log = console } = {}) {
    this.url = url;
    this.secret = secret;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.log = log;
  }

  async call(action, data = {}, { retries = 1 } = {}) {
    const body = JSON.stringify({ kw: 'wa', secret: this.secret, action, ...data });
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Apps Script answers 302 → script.googleusercontent.com; fetch follows it with GET, as required.
        const res = await this.fetch(this.url, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body, redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch {
          throw new Error(/<html/i.test(text)
            ? 'Web app membalas halaman HTML (HTTP ' + res.status + '). Pastikan deploy "Execute as: Me" dan "Who has access: Anyone", lalu pakai URL /exec terbaru.'
            : 'Balasan server tidak terbaca (HTTP ' + res.status + ')');
        }
        if (!json.ok) {
          const e = new Error(json.error || 'Server menolak permintaan');
          e.fatal = /rahasia|WA_BOT_SECRET/.test(e.message);
          throw e;
        }
        return json;
      } catch (e) {
        lastErr = e;
        if (e.fatal || attempt === retries) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}
