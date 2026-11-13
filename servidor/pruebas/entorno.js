// Simulación fiel de las APIs de Google Apps Script usadas por Code.gs.
// Sirve para probar la lógica del servidor fuera de Google.
const crypto = require('crypto');

function bytesFirmados(buf) { return Array.from(buf, b => (b > 127 ? b - 256 : b)); }

class Rango {
  constructor(hoja, fila, col, nf, nc) { Object.assign(this, { hoja, fila, col, nf, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nf; r++) {
      const fila = this.hoja.valores[this.fila - 1 + r] || [];
      const arr = [];
      for (let c = 0; c < this.nc; c++) arr.push(fila[this.col - 1 + c] === undefined ? '' : fila[this.col - 1 + c]);
      out.push(arr);
    }
    return out;
  }
  setValues(matriz) {
    matriz.forEach((fila, r) => fila.forEach((v, c) => this.setCelda(this.fila + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.setCelda(this.fila, this.col, v); return this; }
  setCelda(f, c, v) {
    while (this.hoja.valores.length < f) this.hoja.valores.push([]);
    const fila = this.hoja.valores[f - 1];
    while (fila.length < c) fila.push('');
    fila[c - 1] = v;
  }
  clearContent() { for (let r = 0; r < this.nf; r++) for (let c = 0; c < this.nc; c++) this.setCelda(this.fila + r, this.col + c, ''); return this; }
}

class Hoja {
  constructor(nombre) { this.nombre = nombre; this.valores = []; }
  getRange(f, c, nf = 1, nc = 1) { return new Rango(this, f, c, nf, nc); }
  getDataRange() {
    const nc = Math.max(1, ...this.valores.map(r => r.length));
    return new Rango(this, 1, 1, Math.max(1, this.valores.length), nc);
  }
  getLastRow() { return this.valores.length; }
  getLastColumn() { return this.valores.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(arr) { this.valores.push(arr.slice()); }
  deleteRow(n) { this.valores.splice(n - 1, 1); }
}

class Libro {
  constructor() { this.hojas = {}; }
  getSheetByName(n) { return this.hojas[n] || null; }
  insertSheet(n) { this.hojas[n] = new Hoja(n); return this.hojas[n]; }
  getSheets() { return Object.values(this.hojas); }
}

function crearEntorno() {
  const libro = new Libro();
  const props = {};
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, valor) => bytesFirmados(crypto.createHash('sha256').update(String(valor), 'utf8').digest()),
    computeHmacSha256Signature: (valor, clave) => bytesFirmados(crypto.createHmac('sha256', String(clave)).update(String(valor), 'utf8').digest()),
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    formatDate: (d) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  };
  const ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput(s) { return { setMimeType() { return this; }, getContent() { return s; } }; }
  };
  const bloqueos = { activos: 0 };
  const sandbox = {
    console,
    Utilities,
    ContentService,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => libro,
      openById: () => libro,
      getUi: () => { throw new Error('UI no disponible en pruebas'); }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() { bloqueos.activos++; if (bloqueos.activos > 1) throw new Error('bloqueo anidado'); },
        releaseLock() { bloqueos.activos--; }
      })
    }
  };
  return { sandbox, libro, props, bloqueos };
}

module.exports = { crearEntorno };
