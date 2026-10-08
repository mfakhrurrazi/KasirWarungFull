/**
 * Minimal in-memory emulator of the Google Apps Script services used by
 * KasirWarung AI, so the server code (src/*.gs) can be exercised with Node.
 * Not a full implementation — just enough behaviour to test the app logic.
 *
 * Run node with TZ=Asia/Jakarta so local Date math matches the script.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const GS_ORDER = ['Data.gs', 'Setup.gs', 'Code.gs', 'Reports.gs', 'AI.gs', 'WhatsApp.gs', 'PublicApi.gs', 'TemplateData.gs'];
const DIST = path.join(__dirname, '..', 'dist');
const BUNDLE_FILES = ['KasirWarung_1_Server.gs', 'KasirWarung_2_Tampilan.gs'];

function signed(buf) { return Array.from(buf).map((b) => (b > 127 ? b - 256 : b)); }
function unsigned(arr) { return Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b))); }

function formatDate(date, tz, pattern) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });
  const p = {};
  f.formatToParts(date).forEach((x) => { p[x.type] = x.value; });
  return pattern.replace(/'([^']*)'|yyyy|yy|MM|dd|HH|mm|ss/g, (m, lit) => {
    if (lit !== undefined) return lit;
    switch (m) {
      case 'yyyy': return p.year;
      case 'yy': return p.year.slice(2);
      case 'MM': return p.month;
      case 'dd': return p.day;
      case 'HH': return p.hour;
      case 'mm': return p.minute;
      case 'ss': return p.second;
      default: return m;
    }
  });
}

function cloneVal(v) { return v instanceof Date ? new Date(v.getTime()) : v; }

class Range {
  constructor(sheet, row, col, nr, nc) {
    if (row < 1 || col < 1 || nr < 1 || nc < 1) throw new Error('Range invalid: ' + [row, col, nr, nc]);
    if (row + nr - 1 > sheet.maxRows || col + nc - 1 > sheet.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet (' + sheet.name + ')');
    }
    Object.assign(this, { sheet, row, col, nr, nc });
    sheet.ss.stats.calls++;
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const row = [];
      for (let c = 0; c < this.nc; c++) row.push(cloneVal(this.sheet.get(this.row + r, this.col + c)));
      out.push(row);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) {
      throw new Error('setValues dimension mismatch: data ' + vals.length + 'x' + (vals[0] || []).length + ' range ' + this.nr + 'x' + this.nc);
    }
    for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.set(this.row + r, this.col + c, vals[r][c]);
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setNumberFormat(f) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.fmt[(this.row + r) + ':' + (this.col + c)] = f; return this; }
  setNumberFormats(fs2) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) this.sheet.fmt[(this.row + r) + ':' + (this.col + c)] = fs2[r][c]; return this; }
  setDataValidation(rule) {
    this.sheet.validations.push({ row: this.row, col: this.col, nr: this.nr, nc: this.nc, rule });
    this.each((k, r, c) => {
      if (rule.checkbox) {
        this.sheet.checkbox.add(k);
        // Real Sheets: an empty cell with checkbox validation holds FALSE.
        if (this.sheet.get(r, c) === '') this.sheet.cells.set(k, false);
      } else this.sheet.checkbox.delete(k);
    });
    return this;
  }
  clearDataValidations() { this.each((k) => this.sheet.checkbox.delete(k)); return this; }
  clearContent() {
    this.each((k, r, c) => { if (this.sheet.checkbox.has(k)) this.sheet.cells.set(k, false); else this.sheet.set(r, c, ''); });
    return this;
  }
  each(fn) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) fn((this.row + r) + ':' + (this.col + c), this.row + r, this.col + c); }
  setFontWeight() { return this; }
  setBackground(c) { this.sheet.headerBg = c; return this; }
  setFontColor() { return this; }
  setHorizontalAlignment() { return this; }
  setVerticalAlignment() { return this; }
  setWrap() { return this; }
}

class Sheet {
  constructor(ss, name, rows, cols) {
    Object.assign(this, { ss, name, maxRows: rows || 1000, maxCols: cols || 26 });
    this.cells = new Map();
    this.fmt = {};
    this.validations = [];
    this.checkbox = new Set();
    this.protections = [];
    this.frozen = 0;
  }
  key(r, c) { return r + ':' + c; }
  get(r, c) { const v = this.cells.get(this.key(r, c)); return v === undefined ? '' : v; }
  set(r, c, v) {
    if (v === null || v === undefined) v = '';
    if (typeof v === 'string') {
      if (v.charAt(0) === "'") v = v.slice(1);
      else if (v.charAt(0) === '=') throw new Error('Formula written to sheet ' + this.name + ': ' + v);
      else if (this.fmt[this.key(r, c)] !== '@' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16) v = Number(v);
    }
    if (v === '') this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), cloneVal(v));
  }
  getName() { return this.name; }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) { const r = +k.split(':')[0]; if (r > m) m = r; } return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) { const c = +k.split(':')[1]; if (c > m) m = c; } return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  setFrozenRows(n) { this.frozen = n; }
  setRowHeight() {}
  setColumnWidth() {}
  setTabColor() {}
  getProtections() { return this.protections; }
  protect() {
    const editors = [{ getEmail: () => 'owner@example.com' }, { getEmail: () => 'staff@example.com' }];
    const p = {
      description: '', domainEdit: true, editors: editors,
      setDescription(d) { this.description = d; return this; },
      addEditor(u) { this.editors.push(u); return this; },
      removeEditors(list) { this.editors = this.editors.filter((e) => list.indexOf(e) < 0); return this; },
      getEditors() { return this.editors.slice(); },
      canDomainEdit() { return this.domainEdit; },
      setDomainEdit(b) { this.domainEdit = b; return this; }
    };
    this.protections.push(p);
    return p;
  }
  // helpers for tests
  rowsAsObjects() {
    const lastCol = this.getLastColumn();
    const headers = [];
    for (let c = 1; c <= lastCol; c++) headers.push(String(this.get(1, c)));
    const out = [];
    for (let r = 2; r <= this.getLastRow(); r++) {
      const o = {};
      let any = false;
      headers.forEach((h, i) => { const v = this.get(r, i + 1); if (v !== '') any = true; o[h] = v; });
      if (any) out.push(o);
    }
    return out;
  }
}

class Spreadsheet {
  constructor(name, id) {
    this.name = name; this.id = id; this.sheets = []; this.locale = 'en_US'; this.tz = 'UTC';
    this.stats = { calls: 0 };
    this.sheets.push(new Sheet(this, 'Sheet1', 1000, 26));
  }
  getName() { return this.name; }
  rename(n) { this.name = n; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n, idx) { const s = new Sheet(this, n, 1000, 26); this.sheets.splice(idx === undefined ? this.sheets.length : idx, 0, s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setSpreadsheetLocale(l) { this.locale = l; }
  setSpreadsheetTimeZone(t) { this.tz = t; }
}

function createGas(options) {
  options = options || {};
  const state = {
    props: new Map(), cache: new Map(), spreadsheets: new Map(), triggers: [], files: new Map(), folders: new Map(),
    fetchHandler: options.fetchHandler || null, fetchLog: [], logs: []
  };
  let idSeq = 1;
  const newId = (p) => (p || 'id') + '_' + (idSeq++);

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (state.props.has(k) ? state.props.get(k) : null),
      setProperty: (k, v) => { state.props.set(k, String(v)); },
      deleteProperty: (k) => { state.props.delete(k); },
      getProperties: () => Object.fromEntries(state.props)
    })
  };

  const scriptCache = {
    get: (k) => { const e = state.cache.get(k); return e ? e.v : null; },
    put: (k, v, ttl) => {
      if (ttl !== undefined && ttl > 21600) throw new Error('Cache TTL too long: ' + ttl);
      if (Buffer.byteLength(String(v)) > 100 * 1024) throw new Error('Argument too large: value');
      state.cache.set(k, { v: String(v) });
    },
    putAll: (m, ttl) => { Object.keys(m).forEach((k) => scriptCache.put(k, m[k], ttl)); },
    getAll: (keys) => { const o = {}; keys.forEach((k) => { const v = scriptCache.get(k); if (v !== null) o[k] = v; }); return o; },
    remove: (k) => { state.cache.delete(k); },
    removeAll: (keys) => { keys.forEach((k) => state.cache.delete(k)); }
  };
  const CacheService = { getScriptCache: () => scriptCache };

  const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) };

  const validationBuilder = () => {
    const rule = {};
    const b = {
      requireValueInList: (list, show) => { rule.list = list; return b; },
      requireCheckbox: () => { rule.checkbox = true; return b; },
      setAllowInvalid: (x) => { rule.allowInvalid = x; return b; },
      build: () => rule
    };
    return b;
  };

  const SpreadsheetApp = {
    create: (name) => {
      const ss = new Spreadsheet(name, newId('ss'));
      state.spreadsheets.set(ss.id, ss);
      const f = makeFile(name, null, null);
      state.files.delete(f.id); f.id = ss.id; f.mimeType = 'application/vnd.google-apps.spreadsheet'; state.files.set(ss.id, f);
      return ss;
    },
    openById: (id) => { const ss = state.spreadsheets.get(id); if (!ss) throw new Error('Spreadsheet not found ' + id); return ss; },
    getActiveSpreadsheet: () => null,
    flush: () => {},
    newDataValidation: validationBuilder,
    ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
  };

  const makeIter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const makeFile = (name, blob, folder) => {
    const f = {
      id: newId('file'), name, blob, trashed: false, created: new Date(), folder,
      getId() { return this.id; }, getName() { return this.name; }, getUrl() { return 'https://drive.google.com/file/d/' + this.id; },
      getDateCreated() { return this.created; }, setTrashed(b) { this.trashed = b; }, isTrashed() { return this.trashed; },
      getMimeType() { return this.mimeType || 'application/octet-stream'; },
      getParents() { return makeIter(this.folder ? [this.folder] : []); },
      moveTo(fold) { if (this.folder) this.folder.files = this.folder.files.filter((x) => x !== this); this.folder = fold; fold.files.push(this); return this; },
      makeCopy(n, fold) { const c = makeFile(n, null, fold); fold.files.push(c); return c; }
    };
    state.files.set(f.id, f);
    return f;
  };
  const makeFolder = (name) => {
    const fo = {
      id: newId('folder'), name, files: [], trashed: false,
      getId() { return this.id; }, getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }, isTrashed() { return this.trashed; },
      getFiles() { return makeIter(this.files.filter((f) => !f.trashed)); },
      getFilesByName(n) { return makeIter(this.files.filter((f) => !f.trashed && f.name === n)); },
      createFolder(n) { const sub = makeFolder(n); sub.parent = this; return sub; },
      createFile(blob) { const f = makeFile(blob.getName(), blob, this); this.files.push(f); return f; }
    };
    state.folders.set(fo.id, fo);
    return fo;
  };
  const rootFolder = makeFolder('My Drive');
  const DriveApp = {
    getRootFolder: () => rootFolder,
    getFilesByName: () => makeIter([]),
    getFileById: (id) => state.files.get(id) || makeFile('ss-' + id, null, null),
    createFolder: makeFolder,
    getFolderById: (id) => { const f = state.folders.get(id); if (!f) throw new Error('no folder'); return f; }
  };

  const makeBlob = (data, type, name) => {
    const bytes = Array.isArray(data) ? unsigned(data) : Buffer.from(String(data));
    const b = {
      bytes, type, name,
      getAs(t) { return makeBlob('%PDF-1.4 fake pdf of ' + bytes.length + ' bytes', t, name); },
      setName(n) { this.name = n; return this; }, getName() { return this.name; },
      getBytes() { return signed(this.bytes); }, getDataAsString() { return this.bytes.toString('utf8'); }
    };
    return b;
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
    Charset: { UTF_8: 'utf8' },
    formatDate,
    computeDigest: (alg, s) => signed(crypto.createHash(alg).update(String(s), 'utf8').digest()),
    computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', String(k)).update(String(v), 'utf8').digest()),
    getUuid: () => crypto.randomUUID(),
    base64Encode: (x) => (Array.isArray(x) ? unsigned(x) : Buffer.from(String(x))).toString('base64'),
    base64Decode: (s) => signed(Buffer.from(String(s), 'base64')),
    newBlob: makeBlob,
    sleep: () => {}
  };

  // The script file itself, optionally placed in an app folder (options.appFolderName).
  const scriptFile = makeFile('KasirWarung AI', null, null);
  state.scriptId = scriptFile.id;
  if (options.appFolderName) { state.appFolder = makeFolder(options.appFolderName); scriptFile.moveTo(state.appFolder); }

  const makeTrigger = (fn) => ({ fn, getHandlerFunction() { return this.fn; } });
  const ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
    newTrigger: (fn) => {
      const chain = {
        timeBased: () => chain, everyDays: () => chain, atHour: () => chain, inTimezone: () => chain,
        forSpreadsheet: () => chain, onEdit: () => { chain.kind = 'onEdit'; return chain; },
        create: () => { const t = makeTrigger(fn); t.kind = chain.kind || 'time'; state.triggers.push(t); return t; }
      };
      return chain;
    },
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec' }),
    getScriptId: () => state.scriptId
  };

  const UrlFetchApp = {
    fetch: (url, opts) => {
      state.fetchLog.push({ url, opts });
      if (!state.fetchHandler) throw new Error('Network disabled in test');
      const r = state.fetchHandler(url, opts);
      return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
    }
  };

  const ctx = {
    console: { log() {}, warn() {}, error: (...a) => state.logs.push(a.join(' ')), info() {} },
    Logger: { log: (m) => state.logs.push(String(m)) },
    PropertiesService, CacheService, LockService, SpreadsheetApp, DriveApp, Utilities, ScriptApp, UrlFetchApp,
    Session: {
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
      getActiveUser: () => ({ getEmail: () => (state.activeUser === undefined ? 'owner@example.com' : state.activeUser) }),
      getScriptTimeZone: () => 'Asia/Jakarta'
    },
    MimeType: { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    ContentService: {
      MimeType: { JSON: 'application/json', TEXT: 'text/plain', JAVASCRIPT: 'application/javascript' },
      createTextOutput: (text) => {
        const o = { text: String(text), mime: 'text/plain', getContent: () => o.text, setMimeType: (m) => { o.mime = m; return o; } };
        return o;
      }
    },
    HtmlService: null
  };

  // HtmlService: minimal template engine for <?!= expr ?> scriptlets.
  const readHtml = (name) => fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');
  ctx.HtmlService = {
    XFrameOptionsMode: { DEFAULT: 'DEFAULT', ALLOWALL: 'ALLOWALL' },
    createHtmlOutputFromFile: (name) => {
      if (options.bundle) throw new Error('Bundle mode: HTML file "' + name + '" must come from KW_BUNDLED_HTML');
      const c = readHtml(name); return { getContent: () => c };
    },
    createTemplateFromFile: (name) => {
      if (options.bundle) throw new Error('Bundle mode: template "' + name + '" must come from KW_BUNDLED_HTML');
      return ctx.HtmlService.createTemplate(readHtml(name));
    },
    createTemplate: (source) => {
      const tpl = { _src: String(source) };
      tpl.evaluate = () => {
        const vars = Object.assign({}, tpl);
        delete vars.evaluate; delete vars._src;
        const html = tpl._src.replace(/<\?!=\s*([\s\S]*?)\s*;?\s*\?>/g, (m, expr) => {
          const fn = vm.runInContext('(function(__v){ with(__v){ return (' + expr + '); } })', context);
          return String(fn(vars));
        });
        const out = { title: '', meta: {}, getContent: () => html, setTitle(t) { this.title = t; return this; }, addMetaTag(k, v) { this.meta[k] = v; return this; }, setXFrameOptionsMode() { return this; } };
        return out;
      };
      return tpl;
    }
  };

  const context = vm.createContext(ctx);
  // options.bundle: load the 2-file all-in-one build (dist/) instead of src/*.gs
  const code = options.bundle
    ? BUNDLE_FILES.map((f) => fs.readFileSync(path.join(DIST, f), 'utf8')).join('\n')
    : GS_ORDER.map((f) => '// ---- ' + f + '\n' + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  vm.runInContext(code, context, { filename: 'project.gs' });

  const gas = {
    state, context,
    call: (fn, ...args) => {
      const f = vm.runInContext(fn, context);
      if (typeof f !== 'function') throw new Error('No function ' + fn);
      return f(...args);
    },
    api: (fn, ...args) => {
      const raw = gas.call(fn, ...args);
      return JSON.parse(raw);
    },
    /** POST to the web app like the WhatsApp bot does; returns the parsed JSON. */
    post: (body) => JSON.parse(gas.call('doPost', { postData: { contents: JSON.stringify(body), type: 'application/json' } }).getContent()),
    /** Public API like an outside app: GET ?api=… (params) or POST (JSON body). Returns parsed JSON. */
    apiGet: (params) => {
      const out = gas.call('doGet', { parameter: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])) });
      return { body: out.getContent(), mime: out.mime, json: () => JSON.parse(out.getContent()) };
    },
    apiPost: (body, params) => JSON.parse(gas.call('doPost', { parameter: params || {}, postData: { contents: JSON.stringify(body), type: 'text/plain' } }).getContent()),
    ss: () => state.spreadsheets.get(state.props.get('SPREADSHEET_ID')),
    sheet: (name) => gas.ss().getSheetByName(name),
    rows: (name) => gas.sheet(name).rowsAsObjects(),
    resetMemo: () => vm.runInContext('SS_CACHE_ = null;', context)
  };
  return gas;
}

module.exports = { createGas, formatDate };
