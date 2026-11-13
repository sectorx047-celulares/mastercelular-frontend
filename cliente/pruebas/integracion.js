// Integración: la página generada (dist/) + app.js + geo-aviso.js contra el servidor real (Code.gs).
// Ejecutar desde plataforma-v3/:  node cliente/pruebas/integracion.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { crearEntorno } = require('../../servidor/pruebas/entorno');

const RAIZ = path.join(__dirname, '..', '..');
const CODE = fs.readFileSync(path.join(RAIZ, 'servidor', 'Code.gs'), 'utf8');
const APP = fs.readFileSync(path.join(RAIZ, 'cliente', 'src', 'assets', 'js', 'app.js'), 'utf8');
const GEO = fs.readFileSync(path.join(RAIZ, 'cliente', 'src', 'assets', 'js', 'geo-aviso.js'), 'utf8');
const HTML = fs.readFileSync(path.join(RAIZ, 'cliente', 'dist', 'index.html'), 'utf8');

// ---------- Servidor ----------
const srv = crearEntorno();
vm.createContext(srv.sandbox);
vm.runInContext(CODE, srv.sandbox);
const runSrv = (e) => vm.runInContext(e, srv.sandbox);
function servidor(body) {
  srv.sandbox.__e = { postData: { contents: body } };
  return runSrv('doPost(__e).getContent()');
}
const hoja = (n) => srv.libro.getSheetByName(n);
function fila(nombre, obj) {
  const h = hoja(nombre);
  h.appendRow(h.valores[0].map(c => (obj[c] !== undefined ? obj[c] : '')));
}
function filas(nombre) {
  const h = hoja(nombre); const cab = h.valores[0];
  return h.valores.slice(1).map(r => Object.fromEntries(cab.map((c, i) => [c, r[i]])));
}
runSrv('prepararHojas_()');
fila('Cursos', { curso_id: 'celulares', nombre: 'Reparación de celulares', activo: 'SI', prefijo_codigo: 'CEL', carpeta_drive: 'https://drive.google.com/drive/folders/CARPETA' });
fila('Cursos', { curso_id: 'galinas', nombre: 'Gallinas', activo: 'SI', prefijo_codigo: 'GAL' });
fila('Clases', { curso_id: 'celulares', modulo: 'Módulo 1', titulo: '1 - Introducción', orden: 1, url: 'https://www.youtube.com/embed/GRATIS1', gratis: 'SI' });
fila('Clases', { curso_id: 'celulares', modulo: 'Módulo 1', titulo: '2 - En vivo', orden: 2, url: 'https://www.youtube.com/embed/GRATIS2', gratis: 'SI' });
fila('Clases', { curso_id: 'celulares', modulo: 'Módulo 2', titulo: '3 - Herramientas', orden: 3, url: 'https://www.youtube.com/embed/PAGO3', gratis: 'NO' });
fila('Clases', { curso_id: 'galinas', modulo: 'Módulo 1', titulo: '1 - Gallinas', orden: 1, url: 'https://www.youtube.com/embed/GAL1', gratis: 'SI' });
fila('Materiales', { curso_id: 'celulares', titulo: 'Diagramas A10', orden: 1, url: 'https://drive.example/MAT-A10' });

// ---------- Navegador simulado con la página generada ----------
const registro = new Map();        // id -> elemento
const todos = [];                  // todos los elementos (para selectores por atributo)
const ventanasAbiertas = [];
const storage = new Map();
const alertas = [];

class Clases {
  constructor(inicial) { this.set = new Set(inicial || []); }
  add(...c) { c.forEach(x => this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : force; on ? this.set.add(c) : this.set.delete(c); return on; }
}
function elemento(tag, attrs) {
  const el = {
    tag, id: attrs && attrs.id || null, attrs: Object.assign({}, attrs || {}),
    value: '', textContent: '', className: '', src: '', href: '', target: '', rel: '',
    open: false, disabled: false, dataset: {}, children: [], handlers: {},
    style: {}, _timer: null,
    classList: new Clases((attrs && attrs.class || '').split(/\s+/).filter(Boolean)),
    get innerHTML() { return ''; },
    set innerHTML(v) { this.children.length = 0; },
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = String(v); },
    addEventListener(tipo, fn) { (this.handlers[tipo] = this.handlers[tipo] || []).push(fn); },
    appendChild(c) { this.children.push(c); return c; },
    scrollIntoView() {}, focus() {}, closest() { return null; }, remove() {}, insertBefore() {},
    click() { (this.handlers.click || []).forEach(f => f({ preventDefault() {} })); },
    dispatch(tipo) { (this.handlers[tipo] || []).forEach(f => f({ preventDefault() {} })); }
  };
  if (el.id) registro.set(el.id, el);
  todos.push(el);
  return el;
}
// Carga los elementos de la página generada con sus clases y atributos iniciales
(function cargarPagina() {
  const reTag = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:="[^"]*")?)*)\s*\/?>/g;
  let m;
  while ((m = reTag.exec(HTML))) {
    const attrs = {};
    const reA = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g;
    let a;
    while ((a = reA.exec(m[2]))) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    if (attrs.id || 'data-solo' in attrs || 'data-wa' in attrs) elemento(m[1], attrs);
  }
})();
function elementoPorId(id) {
  if (!registro.has(id)) elemento('div', { id });
  return registro.get(id);
}
function seleccionar(selector) {
  // Soporta: [data-solo], [data-wa], a[data-wa], [data-solo="alumno"]
  const m = selector.match(/^(?:[a-z]+)?\[([a-z-]+)(?:="([^"]*)")?\]$/);
  if (!m) return [];
  return todos.filter(el => el.attrs[m[1]] !== undefined && (m[2] === undefined || el.attrs[m[1]] === m[2]));
}
const document = {
  getElementById: elementoPorId,
  createElement: (tag) => elemento(tag, {}),
  querySelectorAll: seleccionar
};
const location = { search: '', hash: '', reload() { ventanasAbiertas.push('reload'); } };
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};
// Configuración real de la página generada, con el endpoint de la simulación
const CONFIG = JSON.parse(HTML.match(/window\.CONFIG = (.*?);<\/script>/)[1]);
CONFIG.endpoint = 'https://fake.example/exec';
const navegador = {
  CONFIG, document, localStorage, location, sessionStorage: new Map(),
  URLSearchParams, console, setTimeout, clearTimeout, setImmediate, encodeURIComponent,
  alert: (m) => alertas.push(m),
  open: (url) => ventanasAbiertas.push(url),
  navigator: { language: 'es-PE' },
  fetch: async (url, opts) => ({ json: async () => JSON.parse(servidor(opts.body)) })
};
navegador.window = navegador;
vm.createContext(navegador);
vm.runInContext(APP, navegador);

// ---------- Utilidades de prueba ----------
const tick = () => new Promise(r => setImmediate(r));
async function esperar(cond, max = 300) {
  for (let i = 0; i < max; i++) { if (cond()) return; await tick(); }
}
const visible = (id) => !elementoPorId(id).classList.contains('oculto');
async function enviar(formId, valores) {
  Object.keys(valores || {}).forEach(k => { elementoPorId(k).value = valores[k]; });
  elementoPorId(formId).dispatch('submit');
  await esperar(() => false, 40);
}
function botonDeClase(titulo) {
  return elementoPorId('lista-temario').children.reduce((a, c) => a.concat(c.children), [])
    .find(b => b.children[1] && b.children[1].textContent === titulo);
}
const claseMostrada = () => elementoPorId('titulo-clase-actual').textContent;
const iframe = () => elementoPorId('iframe-reproductor').src;

let pasan = 0, fallan = 0;
async function prueba(nombre, fn) {
  try { await fn(); pasan++; console.log('  ✓ ' + nombre); }
  catch (e) { fallan++; console.log('  ✗ ' + nombre + '\n      ' + e.message); }
}
function ok(c, msg) { if (!c) throw new Error(msg); }
function igual(a, b, msg) { if (a !== b) throw new Error((msg || 'valor') + ': esperado ' + JSON.stringify(b) + ', obtenido ' + JSON.stringify(a)); }

(async () => {
  // Arranque: visitante
  console.log('\nVisitante');
  await esperar(() => iframe().indexOf('GRATIS1') !== -1);

  await prueba('sin sesión la primera clase gratis se reproduce sola, silenciada', async () => {
    igual(iframe(), 'https://www.youtube.com/embed/GRATIS1?autoplay=1&mute=1');
    igual(claseMostrada(), '1 - Introducción');
  });

  await prueba('el temario es visible para visitantes y muestra el 0% de avance', async () => {
    ok(botonDeClase('2 - En vivo'), 'temario sin la clase 2');
    igual(elementoPorId('texto-porcentaje').textContent, '0% (0/3)');
  });

  await prueba('los paneles de alumno están ocultos y los de visitante visibles', async () => {
    ok(!visible('panel-alumno'), 'el panel del alumno no debe verse');
    ok(visible('bloque-registro'), 'el registro debe verse');
  });

  await prueba('la clase de pago muestra el aviso de bloqueo sin cargar su enlace', async () => {
    botonDeClase('3 - Herramientas').click();
    await esperar(() => visible('capa-bloqueo'));
    ok(visible('capa-bloqueo'), 'debe verse el aviso');
    ok(iframe().indexOf('PAGO3') === -1, 'no debe cargar el enlace de pago');
  });

  await prueba('el material se lista por nombre, sin enlace, con candado', async () => {
    const fila = elementoPorId('contenedor-pdfs').children.find(c => c.className === 'material');
    ok(fila, 'falta la lista de materiales');
    igual(fila.children[0].textContent, 'Diagramas A10');
    igual(fila.children[1].textContent, '🔒 Incluido en el curso completo');
  });

  await prueba('el enlace de WhatsApp de la página lleva el vendedor y el seguimiento', async () => {
    const wa = seleccionar('[data-wa="inscribir"]')[0];
    ok(wa.href.indexOf('https://wa.me/' + CONFIG.whatsapp + '?text=') === 0, 'href: ' + wa.href);
    ok(decodeURIComponent(wa.href).indexOf('Hola ' + CONFIG.vendedor) !== -1, 'mensaje sin vendedor');
    ok(decodeURIComponent(wa.href).indexOf('ref: directo') !== -1, 'sin referencia de origen');
  });

  await prueba('el buscador filtra el temario', async () => {
    elementoPorId('input-buscar-clase').value = 'Herr';
    elementoPorId('input-buscar-clase').dispatch('input');
    await esperar(() => !botonDeClase('2 - En vivo'));
    ok(botonDeClase('3 - Herramientas'), 'debe quedar la coincidencia');
    ok(!botonDeClase('2 - En vivo'), 'no debe quedar lo que no coincide');
    elementoPorId('input-buscar-clase').value = '';
    elementoPorId('input-buscar-clase').dispatch('input');
  });

  console.log('\nRegistro y cuenta');

  await prueba('registro con datos inválidos no crea cuenta', async () => {
    await enviar('form-registro', { 'reg-nombre': 'A', 'reg-whatsapp': '999111222', 'reg-password': 'clave123' });
    igual(elementoPorId('estado-registro').textContent, 'Escribe tu nombre.');
    igual(filas('Usuarios').length, 0, 'no debe crear cuenta');
  });

  await prueba('el registro crea la cuenta, abre el panel del alumno y reproduce la primera clase', async () => {
    await enviar('form-registro', { 'reg-nombre': 'Ana Pérez', 'reg-whatsapp': '999 111 222', 'reg-password': 'clave123' });
    await esperar(() => visible('panel-alumno'));
    ok(visible('panel-alumno'), 'debe verse el panel del alumno');
    ok(!visible('bloque-registro'), 'el registro debe ocultarse');
    ok(storage.has('mc_sesion_v3'), 'sesión sin guardar');
    igual(filas('Usuarios')[0].whatsapp, '51999111222', 'whatsapp normalizado');
    ok(!String(filas('Usuarios')[0].password_hash).includes('clave123'), 'contraseña en claro');
    igual(elementoPorId('saludo').textContent, 'Hola, Ana Pérez');
  });

  console.log('\nProgreso, medallas y apuntes');

  await prueba('marcar una clase como vista la registra, muestra la frase motivadora y cambia el avance', async () => {
    botonDeClase('2 - En vivo').click();
    await esperar(() => claseMostrada() === '2 - En vivo');
    elementoPorId('btn-marcar-vista').click();
    await esperar(() => filas('Progreso').length === 1);
    igual(filas('Progreso')[0].clase, '2 - En vivo');
    ok(elementoPorId('toast-motivacion').textContent.length > 0, 'falta la frase motivadora');
    igual(elementoPorId('texto-porcentaje').textContent, '33% (1/3)');
  });

  await prueba('el 25 % desbloquea la medalla en pantalla y en el servidor', async () => {
    await esperar(() => elementoPorId('medalla-25').classList.contains('medalla--activa'));
    ok(elementoPorId('medalla-25').classList.contains('medalla--activa'), 'medalla 25 sin activar');
    ok(filas('Medallas').some(m => Number(m.hito) === 25), 'medalla no registrada en el servidor');
  });

  await prueba('siguiente y anterior recorren el temario en orden', async () => {
    elementoPorId('btn-siguiente').click();
    await esperar(() => claseMostrada() === '3 - Herramientas');
    igual(claseMostrada(), '3 - Herramientas');
    elementoPorId('btn-anterior').click();
    await esperar(() => claseMostrada() === '2 - En vivo');
    igual(claseMostrada(), '2 - En vivo');
  });

  await prueba('un apunte con minuto se guarda y aparece en la clase', async () => {
    await enviar('form-nota-no-existe', {});
    elementoPorId('input-nota-tiempo').value = '04:15';
    elementoPorId('input-nueva-nota').value = 'Medida del conector: 1.8 mm';
    elementoPorId('btn-guardar-nota').click();
    await esperar(() => filas('Notas').length === 1);
    igual(filas('Notas')[0].texto, 'Medida del conector: 1.8 mm');
    igual(elementoPorId('lista-notas-clase').children.length, 1, 'apuntes en pantalla');
  });

  await prueba('el botón "Mi siguiente clase" lleva a la primera clase sin marcar', async () => {
    elementoPorId('btn-continuar').click();
    await esperar(() => claseMostrada() === '1 - Introducción');
    igual(claseMostrada(), '1 - Introducción');
  });

  console.log('\nActivación');

  await prueba('cerrar sesión devuelve a visitante', async () => {
    elementoPorId('boton-salir').click();
    await esperar(() => !storage.has('mc_sesion_v3'));
    ok(!storage.has('mc_sesion_v3'), 'la sesión debía borrarse');
  });

  await prueba('activar sin sesión pide primero entrar', async () => {
    await enviar('form-activar', { 'act-codigo': 'CEL-XXXX-XXXX-XXXX' });
    igual(elementoPorId('estado-activar').textContent, 'Primero entra o crea tu cuenta.');
  });

  await prueba('entrar de nuevo recupera el progreso, las medallas y los apuntes', async () => {
    await enviar('form-entrar', { 'ent-whatsapp': '999111222', 'ent-password': 'clave123' });
    await esperar(() => visible('panel-alumno'));
    ok(visible('panel-alumno'), 'panel del alumno');
    await esperar(() => elementoPorId('texto-porcentaje').textContent.indexOf('33%') !== -1);
    igual(elementoPorId('texto-porcentaje').textContent, '33% (1/3)');
    ok(elementoPorId('medalla-25').classList.contains('medalla--activa'), 'medalla 25 al volver');
  });

  await prueba('una contraseña incorrecta no entra y lo dice', async () => {
    elementoPorId('boton-salir').click();
    await esperar(() => !storage.has('mc_sesion_v3'));
    await enviar('form-entrar', { 'ent-whatsapp': '999111222', 'ent-password': 'mala-clave' });
    igual(elementoPorId('estado-entrar').textContent, 'WhatsApp o contraseña incorrectos.');
    ok(!storage.has('mc_sesion_v3'), 'no debía guardar sesión');
  });

  await prueba('un código inválido muestra el error del servidor', async () => {
    await enviar('form-entrar', { 'ent-whatsapp': '999111222', 'ent-password': 'clave123' });
    await esperar(() => visible('panel-alumno'));
    await enviar('form-activar', { 'act-codigo': 'CEL-AAAA-BBBB-CCCC' });
    igual(elementoPorId('estado-activar').textContent, 'El código no es válido, ya fue usado o no corresponde a este curso.');
  });

  await prueba('un código válido activa el curso y desbloquea materiales y la clase de pago', async () => {
    runSrv('generarCodigos_("celulares", 1)');
    const codigo = filas('Entrega')[0].codigo;
    await enviar('form-activar', { 'act-codigo': codigo.toLowerCase() });
    await esperar(() => elementoPorId('contenedor-pdfs').children.some(c => c.className === 'carpeta-box'));
    igual(filas('Accesos').find(a => a.curso_id === 'celulares').acceso, 'COMPLETO');
    ok(elementoPorId('contenedor-pdfs').children.some(c => c.className === 'carpeta-box'), 'falta la carpeta de Drive');
    botonDeClase('3 - Herramientas').click();
    await esperar(() => iframe().indexOf('PAGO3') !== -1);
    ok(iframe().indexOf('PAGO3') !== -1, 'la clase de pago no se reprodujo');
  });

  await prueba('descargar un material abre el enlace y queda marcado', async () => {
    const fila = elementoPorId('contenedor-pdfs').children.find(c => c.className === 'material');
    ok(fila, 'fila de material');
    fila.children[1].click();
    await esperar(() => ventanasAbiertas.indexOf('https://drive.example/MAT-A10') !== -1);
    ok(ventanasAbiertas.indexOf('https://drive.example/MAT-A10') !== -1, 'no abrió el enlace');
    igual(filas('Descargas').length, 1, 'descarga registrada');
  });

  console.log('\nCasos de cuenta');

  await prueba('una contraseña temporal obliga a crear una nueva', async () => {
    elementoPorId('boton-salir').click();
    await esperar(() => !storage.has('mc_sesion_v3'));
    const temporal = runSrv("restablecerPassword_('51999111222').temporal");
    await enviar('form-entrar', { 'ent-whatsapp': '999111222', 'ent-password': temporal });
    await esperar(() => visible('bloque-cambiar'));
    ok(visible('bloque-cambiar'), 'debe pedir cambio de contraseña');
    await enviar('form-cambiar', { 'cam-actual': temporal, 'cam-nueva': 'clave-nueva-9' });
    await esperar(() => visible('panel-alumno'));
    ok(visible('panel-alumno'), 'tras cambiarla debe abrirse la plataforma');
  });

  await prueba('una sesión caducada devuelve al acceso', async () => {
    const token = JSON.parse(storage.get('mc_sesion_v3')).token;
    const th = crypto.createHash('sha256').update(token).digest('hex');
    const h = hoja('Sesiones'); const j = h.valores[0].indexOf('expira');
    const r = h.valores.findIndex((row, i) => i > 0 && row[0] === th);
    h.valores[r][j] = new Date(Date.now() - 1000);
    await enviar('form-activar', { 'act-codigo': 'CEL-ZZZZ-ZZZZ-ZZZZ' });
    await esperar(() => !storage.has('mc_sesion_v3'));
    ok(!storage.has('mc_sesion_v3'), 'debía borrar la sesión');
  });

  await prueba('un alumno de otro curso se inscribe aquí con su contraseña', async () => {
    runSrv("registrar_({curso_id:'galinas', nombre:'Luis Ruiz', whatsapp:'51988777666', password:'clave-luis', pais:'PE'})");
    await enviar('form-entrar', { 'ent-whatsapp': '988777666', 'ent-password': 'clave-luis' });
    await esperar(() => filas('Accesos').some(a => a.whatsapp === '51988777666' && a.curso_id === 'celulares'));
    ok(filas('Accesos').some(a => a.whatsapp === '51988777666' && a.curso_id === 'celulares'), 'no se inscribió');
  });

  console.log(`\nResultado: ${pasan} pasan, ${fallan} fallan.`);
  process.exit(fallan ? 1 : 0);
})();
