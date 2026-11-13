// Prueba del aviso de país (geo-aviso.js) con la configuración real de la página generada.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
const GEO = fs.readFileSync(path.join(__dirname, '..', 'src', 'assets', 'js', 'geo-aviso.js'), 'utf8');
const GEO_CFG = JSON.parse(HTML.match(/window\.GEO_AVISO = (.*?);<\/script>/)[1]);

function correr({ zona, idioma, silencio = false }) {
  const body = { children: [], className: '', textContent: '', href: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    classList: { add() {}, remove() {}, contains() { return false; } }, remove() { this.removed = true; } };
  const store = new Map(silencio ? [['mc_aviso_pais', String(Date.now())]] : []);
  const ctx = {
    window: {}, GEO_AVISO: GEO_CFG,
    document: { body: { children: [], insertBefore(el) { this.children.unshift(el); } },
      createElement: () => Object.assign({}, body, { children: [], attrs: {} }), addEventListener() {} },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    navigator: { language: idioma }, location: { search: '' },
    Intl: { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: zona }) }) },
    Date, console
  };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(GEO, ctx);
  return ctx.document.body.children.length;
}
let pasan = 0, fallan = 0;
function prueba(n, c) { if (c) { pasan++; console.log('  ✓ ' + n); } else { fallan++; console.log('  ✗ ' + n); } }
prueba('la versión de Perú ofrece Venezuela a un visitante de Caracas', correr({ zona: 'America/Caracas', idioma: 'es-VE' }) === 1);
prueba('la versión de Perú no muestra aviso a un visitante de Lima', correr({ zona: 'America/Lima', idioma: 'es-PE' }) === 0);
prueba('una persona que ya cerró el aviso no lo ve de nuevo', correr({ zona: 'America/Caracas', idioma: 'es-VE', silencio: true }) === 0);
prueba('la configuración del aviso incluye ambos países con su precio y vendedor',
  GEO_CFG.mensajes.VE.texto.includes('$3') && GEO_CFG.mensajes.VE.texto.includes('Fanny') && GEO_CFG.mensajes.PE.texto.includes('S/ 10'));
console.log(`\nResultado: ${pasan} pasan, ${fallan} fallan.`);
process.exit(fallan ? 1 : 0);
