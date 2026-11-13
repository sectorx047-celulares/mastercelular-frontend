// Pruebas del servidor (Code.gs) en un entorno simulado. Ejecutar: node pruebas/prueba.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { crearEntorno } = require('./entorno');

const codigoFuente = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const env = crearEntorno();
vm.createContext(env.sandbox);
vm.runInContext(codigoFuente, env.sandbox);
const run = (expr) => vm.runInContext(expr, env.sandbox);
const clon = (x) => JSON.parse(JSON.stringify(x));

// Llamada a la API como la haría la página
function api(p) {
  env.sandbox.__e = { postData: { contents: typeof p === 'string' ? p : JSON.stringify(p) } };
  return JSON.parse(run('doPost(__e).getContent()'));
}
const hoja = (n) => env.libro.getSheetByName(n);
function filasDe(nombre) {
  const h = hoja(nombre).valores;
  const cab = h[0];
  return h.slice(1).map(r => Object.fromEntries(cab.map((c, i) => [c, r[i]])));
}
function agregarFila(nombre, obj) {
  const h = hoja(nombre);
  const cab = h.valores[0];
  h.appendRow(cab.map(c => (obj[c] !== undefined ? obj[c] : '')));
}
function celdaFila(nombre, pred) {
  const h = hoja(nombre);
  const cab = h.valores[0];
  for (let i = 1; i < h.valores.length; i++) {
    const o = Object.fromEntries(cab.map((c, j) => [c, h.valores[i][j]]));
    if (pred(o)) return { fila: i + 1, o };
  }
  return null;
}
function fijarCelda(nombre, pred, col, valor) {
  const r = celdaFila(nombre, pred);
  const j = hoja(nombre).valores[0].indexOf(col);
  hoja(nombre).valores[r.fila - 1][j] = valor;
}

// ---------- Mini marco de pruebas ----------
let pasan = 0, fallan = 0;
function prueba(nombre, fn) {
  try { fn(); pasan++; console.log('  ✓ ' + nombre); }
  catch (e) { fallan++; console.log('  ✗ ' + nombre + '\n      ' + e.message); }
}
function esperar(cond, msg) { if (!cond) throw new Error(msg); }
function igual(a, b, msg) { if (a !== b) throw new Error((msg || 'valor') + ': esperado ' + JSON.stringify(b) + ', obtenido ' + JSON.stringify(a)); }

// ---------- Datos de prueba ----------
run('prepararHojas_()');
agregarFila('Cursos', { curso_id: 'celulares', nombre: 'Reparación de celulares', activo: 'SI', prefijo_codigo: 'CEL', carpeta_drive: 'https://drive.google.com/drive/folders/CARPETA-CEL' });
agregarFila('Cursos', { curso_id: 'galinas', nombre: 'Gallinas ponedoras', activo: 'SI', prefijo_codigo: 'GAL', carpeta_drive: '' });
agregarFila('Cursos', { curso_id: 'holistica', nombre: 'Holística', activo: 'NO', prefijo_codigo: 'HOL', carpeta_drive: '' });
agregarFila('Clases', { curso_id: 'celulares', modulo: 'Módulo 1', titulo: '1 - Introducción', orden: 1, url: 'https://drive.example/GRATIS-1', gratis: 'SI' });
agregarFila('Clases', { curso_id: 'celulares', modulo: 'Módulo 1', titulo: '2 - En vivo', orden: 2, url: 'https://drive.example/GRATIS-2', gratis: 'SI' });
agregarFila('Clases', { curso_id: 'celulares', modulo: 'Módulo 2', titulo: '3 - Herramientas', orden: 3, url: 'https://drive.example/PAGO-3', gratis: 'NO' });
agregarFila('Clases', { curso_id: 'galinas', modulo: 'Módulo 1', titulo: '1 - Galinas', orden: 1, url: 'https://drive.example/GAL-1', gratis: 'SI' });
agregarFila('Materiales', { curso_id: 'celulares', titulo: 'Diagramas A10', orden: 1, url: 'https://drive.example/MAT-A10' });

const PASS = 'clave123';
const W1 = '51916381231', W2 = '51999111222', W3 = '584227777688';
let tok1, tok2;

console.log('\nRegistro y acceso');

prueba('preparar hojas crea todas las pestañas del esquema', () => {
  igual(Object.keys(env.libro.hojas).length, Object.keys(run('ESQUEMA')).length, 'número de hojas');
});

prueba('registrar crea cuenta, inscribe en el curso y devuelve sesión', () => {
  const r = api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Miguel Ángel', whatsapp: '+51 916 381 231', password: PASS, pais: 'PE' });
  esperar(r.ok && r.token, 'sin token: ' + JSON.stringify(r));
  igual(r.curso_id, 'celulares');
  igual(filasDe('Usuarios')[0].whatsapp, '51916381231', 'whatsapp normalizado');
  igual(filasDe('Accesos')[0].acceso, 'GRATIS');
  tok1 = r.token;
});

prueba('la contraseña nunca se guarda en texto plano', () => {
  const u = filasDe('Usuarios')[0];
  esperar(!String(u.password_hash).includes(PASS), 'la contraseña aparece en la hoja');
  esperar(String(u.password_hash).startsWith('5000$'), 'formato de hash inesperado');
});

prueba('registrar con datos inválidos devuelve DATOS_INVALIDOS', () => {
  igual(api({ accion: 'registrar', curso_id: 'celulares', nombre: '1', whatsapp: W2, password: PASS }).codigo, 'DATOS_INVALIDOS', 'nombre corto');
  igual(api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Ana', whatsapp: '12', password: PASS }).codigo, 'DATOS_INVALIDOS', 'whatsapp corto');
  igual(api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Ana', whatsapp: W2, password: '123' }).codigo, 'DATOS_INVALIDOS', 'contraseña corta');
  igual(api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Ana=HYPERLINK', whatsapp: W2, password: PASS }).codigo, 'DATOS_INVALIDOS', 'nombre con símbolos');
});

prueba('registrar en un curso inactivo o inexistente se rechaza', () => {
  igual(api({ accion: 'registrar', curso_id: 'holistica', nombre: 'Ana', whatsapp: W2, password: PASS }).codigo, 'CURSO_NO_DISPONIBLE', 'inactivo');
  igual(api({ accion: 'registrar', curso_id: 'no-existe', nombre: 'Ana', whatsapp: W2, password: PASS }).codigo, 'CURSO_NO_DISPONIBLE', 'inexistente');
});

prueba('registrar el mismo WhatsApp con otra contraseña no crea duplicados', () => {
  const r = api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Otro', whatsapp: W1, password: 'otra-clave' });
  igual(r.codigo, 'CUENTA_EXISTENTE');
  igual(filasDe('Usuarios').length, 1, 'usuarios');
});

prueba('registrar otra vez en el mismo curso con la contraseña correcta dice YA_INSCRITO', () => {
  igual(api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Miguel', whatsapp: W1, password: PASS }).codigo, 'YA_INSCRITO');
});

prueba('un alumno existente puede vincularse a otro curso con su contraseña', () => {
  const r = api({ accion: 'registrar', curso_id: 'galinas', nombre: 'Miguel', whatsapp: W1, password: PASS });
  esperar(r.ok, JSON.stringify(r));
  igual(filasDe('Usuarios').length, 1, 'no debe duplicar la cuenta');
  igual(filasDe('Accesos').filter(a => a.whatsapp === '51916381231').length, 2, 'accesos del alumno');
});

console.log('\nLogin y sesión');

prueba('login con contraseña incorrecta falla sin revelar si la cuenta existe', () => {
  igual(api({ accion: 'login', whatsapp: W1, password: 'mal-clave' }).codigo, 'CREDENCIALES');
  igual(api({ accion: 'login', whatsapp: W2, password: PASS }).codigo, 'CREDENCIALES', 'cuenta inexistente');
});

prueba('login correcto devuelve token y lista de cursos', () => {
  const r = api({ accion: 'login', whatsapp: W1, password: PASS });
  esperar(r.ok && r.token, JSON.stringify(r));
  igual(r.cursos.length, 2, 'cursos');
  tok2 = r.token;
});

prueba('la sesión caduca en el servidor, no solo en el navegador', () => {
  // Usa una sesión propia para no invalidar las sesiones que usan las pruebas siguientes
  const tokCaduca = api({ accion: 'login', whatsapp: W1, password: PASS }).token;
  const h = hoja('Sesiones');
  const j = h.valores[0].indexOf('expira');
  const th = require('crypto').createHash('sha256').update(tokCaduca).digest('hex');
  const r = celdaFila('Sesiones', o => o.token_hash === th);
  h.valores[r.fila - 1][j] = new Date(Date.now() - 1000);
  igual(api({ accion: 'estado', curso_id: 'celulares', token: tokCaduca }).codigo, 'SESION_INVALIDA');
});

prueba('logout revoca la sesión', () => {
  const r = api({ accion: 'login', whatsapp: W1, password: PASS });
  igual(api({ accion: 'logout', token: r.token }).ok, true);
  igual(api({ accion: 'estado', curso_id: 'celulares', token: r.token }).codigo, 'SESION_INVALIDA');
});

prueba('tras 5 intentos fallidos el WhatsApp queda bloqueado 15 minutos', () => {
  const w = W3;
  api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Fanny', whatsapp: w, password: PASS });
  for (let i = 0; i < 5; i++) api({ accion: 'login', whatsapp: w, password: 'x' + i });
  igual(api({ accion: 'login', whatsapp: w, password: PASS }).codigo, 'BLOQUEADO', 'incluso con la clave correcta');
});

prueba('el bloqueo expira después de 15 minutos', () => {
  fijarCelda('Intentos', o => o.clave === 'login:' + W3, 'inicio', new Date(Date.now() - 16 * 60000));
  esperar(api({ accion: 'login', whatsapp: W3, password: PASS }).ok, 'debía entrar tras el bloqueo');
});

console.log('\nAcceso a contenido');

prueba('estado GRATIS: solo enlaces de clases gratis y sin materiales', () => {
  const r = api({ accion: 'estado', curso_id: 'celulares', token: tok1 });
  esperar(r.ok, JSON.stringify(r));
  igual(r.acceso, 'GRATIS');
  const txt = JSON.stringify(r);
  esperar(!txt.includes('PAGO-3'), 'filtró el enlace de pago');
  esperar(!txt.includes('MAT-A10'), 'filtró el material');
  igual(r.materiales.length, 0, 'materiales');
  igual(r.carpeta, '', 'carpeta');
  igual(r.clases.find(c => c.titulo === '1 - Introducción').url, 'https://drive.example/GRATIS-1');
});

prueba('obtener_clase: gratis sí, de pago no', () => {
  igual(api({ accion: 'obtener_clase', curso_id: 'celulares', token: tok1, clase: '2 - En vivo' }).ok, true);
  igual(api({ accion: 'obtener_clase', curso_id: 'celulares', token: tok1, clase: '3 - Herramientas' }).codigo, 'REQUIERE_ACTIVACION');
});

prueba('obtener_material se rechaza sin acceso completo', () => {
  igual(api({ accion: 'obtener_material', curso_id: 'celulares', token: tok1, material: 'Diagramas A10' }).codigo, 'REQUIERE_ACTIVACION');
});

prueba('un alumno sin inscripción no puede leer el curso', () => {
  // W2 solo está inscrito en celulares; galinas debe rechazarlo
  const t = api({ accion: 'registrar', curso_id: 'celulares', nombre: 'Lucía', whatsapp: W2, password: PASS }).token;
  igual(api({ accion: 'estado', curso_id: 'galinas', token: t }).codigo, 'NO_INSCRITO');
});

prueba('progreso marca y desmarca clases, y valida que existan', () => {
  let r = api({ accion: 'progreso', curso_id: 'celulares', token: tok1, clase: '1 - Introducción', visto: true });
  esperar(r.vistas.includes('1 - Introducción'), 'no quedó marcada');
  r = api({ accion: 'progreso', curso_id: 'celulares', token: tok1, clase: '1 - Introducción', visto: false });
  esperar(!r.vistas.includes('1 - Introducción'), 'no se desmarcó');
  igual(api({ accion: 'progreso', curso_id: 'celulares', token: tok1, clase: 'No existe', visto: true }).codigo, 'CLASE_NO_EXISTE');
});

prueba('progreso no se duplica al marcar dos veces', () => {
  api({ accion: 'progreso', curso_id: 'celulares', token: tok1, clase: '2 - En vivo', visto: true });
  api({ accion: 'progreso', curso_id: 'celulares', token: tok1, clase: '2 - En vivo', visto: true });
  igual(filasDe('Progreso').filter(p => p.clase === '2 - En vivo').length, 1, 'filas');
});

console.log('\nNotas');

let idNota;
prueba('nota guardada se devuelve en el estado y el texto se sanea', () => {
  const r = api({ accion: 'nota_guardar', curso_id: 'celulares', token: tok1, clase: '1 - Introducción', minuto: '04:15', texto: '=HYPERLINK("http://x")' });
  esperar(r.ok, JSON.stringify(r));
  idNota = r.nota.id;
  const guardada = filasDe('Notas').find(n => n.id === idNota);
  esperar(String(guardada.texto).startsWith("'="), 'no se saneó: ' + guardada.texto);
  const est = api({ accion: 'estado', curso_id: 'celulares', token: tok1 });
  igual(est.notas.length, 1, 'notas en estado');
});

prueba('nota vacía o demasiado larga se rechaza', () => {
  igual(api({ accion: 'nota_guardar', curso_id: 'celulares', token: tok1, clase: '1 - Introducción', texto: '   ' }).codigo, 'DATOS_INVALIDOS');
  igual(api({ accion: 'nota_guardar', curso_id: 'celulares', token: tok1, clase: '1 - Introducción', texto: 'x'.repeat(1001) }).codigo, 'DATOS_INVALIDOS');
});

prueba('no se puede borrar la nota de otro alumno', () => {
  // W2 es otro alumno distinto del dueño de la nota (W1)
  const otra = api({ accion: 'login', whatsapp: W2, password: PASS }).token;
  igual(api({ accion: 'nota_eliminar', curso_id: 'celulares', token: otra, id: idNota }).codigo, 'NO_ENCONTRADO');
});

prueba('el dueño sí puede borrar su nota', () => {
  igual(api({ accion: 'nota_eliminar', curso_id: 'celulares', token: tok1, id: idNota }).ok, true);
});

console.log('\nCódigos de activación');

let codigos;
prueba('generar códigos guarda solo el HMAC y deja el texto en Entrega', () => {
  const r = run("generarCodigos_('celulares', 3)");
  igual(r.cantidad, 3);
  const entrega = filasDe('Entrega');
  igual(entrega.length, 3, 'filas en Entrega');
  codigos = entrega.map(e => e.codigo);
  esperar(codigos.every(c => /^CEL-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), 'formato: ' + codigos[0]);
  const hashes = filasDe('Codigos').map(c => c.codigo_hash).join(' ');
  esperar(!codigos.some(c => hashes.includes(c)), 'el código aparece en claro en Codigos');
});

prueba('generar códigos para un curso inexistente falla', () => {
  let falló = false;
  try { run("generarCodigos_('no-existe', 2)"); } catch (e) { falló = true; }
  esperar(falló, 'debía fallar');
});

prueba('activar con código válido concede acceso COMPLETO', () => {
  const r = api({ accion: 'activar', curso_id: 'celulares', token: tok1, codigo: codigos[0].toLowerCase() });
  esperar(r.ok && r.acceso === 'COMPLETO', JSON.stringify(r));
  igual(api({ accion: 'estado', curso_id: 'celulares', token: tok1 }).acceso, 'COMPLETO');
});

prueba('un código no se puede reutilizar', () => {
  igual(api({ accion: 'activar', curso_id: 'celulares', token: tok2, codigo: codigos[0] }).codigo, 'CODIGO_INVALIDO');
});

prueba('un código de un curso no sirve en otro', () => {
  igual(api({ accion: 'activar', curso_id: 'galinas', token: tok2, codigo: codigos[1] }).codigo, 'CODIGO_INVALIDO');
});

prueba('un código inventado se rechaza y cuenta como intento', () => {
  igual(api({ accion: 'activar', curso_id: 'celulares', token: tok2, codigo: 'CEL-AAAA-BBBB-CCCC' }).codigo, 'CODIGO_INVALIDO');
});

prueba('activar un curso ya activo no consume otro código', () => {
  igual(api({ accion: 'activar', curso_id: 'celulares', token: tok1, codigo: codigos[1] }).codigo, 'YA_ACTIVO');
  igual(filasDe('Codigos').filter(c => c.estado === 'DISPONIBLE').length, 2, 'disponibles');
});

prueba('anular un código disponible impide usarlo', () => {
  run('anularCodigo_("' + codigos[2] + '")');
  igual(api({ accion: 'activar', curso_id: 'celulares', token: tok2, codigo: codigos[2] }).codigo, 'CODIGO_INVALIDO');
});

prueba('anular un código ya usado falla', () => {
  let falló = false;
  try { run('anularCodigo_("' + codigos[0] + '")'); } catch (e) { falló = true; }
  esperar(falló, 'debía fallar');
});

console.log('\nContenido completo');

prueba('con acceso COMPLETO: clase de pago, materiales y carpeta', () => {
  const clase = api({ accion: 'obtener_clase', curso_id: 'celulares', token: tok1, clase: '3 - Herramientas' });
  igual(clase.url, 'https://drive.example/PAGO-3');
  const est = api({ accion: 'estado', curso_id: 'celulares', token: tok1 });
  igual(est.materiales[0].titulo, 'Diagramas A10');
  esperar(!JSON.stringify(est.materiales).includes('MAT-A10'), 'el estado no debe traer URLs de materiales');
  igual(est.carpeta, 'https://drive.google.com/drive/folders/CARPETA-CEL');
});

prueba('obtener_material devuelve el enlace y registra la descarga una sola vez', () => {
  igual(api({ accion: 'obtener_material', curso_id: 'celulares', token: tok1, material: 'Diagramas A10' }).url, 'https://drive.example/MAT-A10');
  api({ accion: 'obtener_material', curso_id: 'celulares', token: tok1, material: 'Diagramas A10' });
  igual(filasDe('Descargas').length, 1, 'descargas');
  const est = api({ accion: 'estado', curso_id: 'celulares', token: tok1 });
  igual(est.materiales[0].descargado, true, 'marca de descargado');
});

prueba('activar sin sesión o con sesión caducada falla', () => {
  igual(api({ accion: 'activar', curso_id: 'celulares', token: 'falso', codigo: codigos[1] }).codigo, 'SESION_INVALIDA');
});

console.log('\nContraseñas y restablecimiento');

prueba('cambiar contraseña exige la actual y cierra las otras sesiones', () => {
  const otra = api({ accion: 'login', whatsapp: W1, password: PASS }).token;
  igual(api({ accion: 'cambiar_password', token: tok1, actual: 'mal', nueva: 'nueva-clave' }).codigo, 'CREDENCIALES');
  esperar(api({ accion: 'cambiar_password', token: tok1, actual: PASS, nueva: 'nueva-clave' }).ok, 'no cambió');
  igual(api({ accion: 'estado', curso_id: 'celulares', token: otra }).codigo, 'SESION_INVALIDA', 'otra sesión sigue viva');
  esperar(api({ accion: 'estado', curso_id: 'celulares', token: tok1 }).ok, 'la sesión actual se cerró');
  igual(api({ accion: 'login', whatsapp: W1, password: PASS }).codigo, 'CREDENCIALES', 'clave antigua aún funciona');
  esperar(api({ accion: 'login', whatsapp: W1, password: 'nueva-clave' }).ok, 'clave nueva no funciona');
});

prueba('restablecer contraseña obliga a cambiarla antes de seguir', () => {
  const r = run("restablecerPassword_('" + W1 + "')");
  esperar(r.temporal && r.temporal.length === 10, 'temporal');
  const t = api({ accion: 'login', whatsapp: W1, password: r.temporal });
  esperar(t.ok && t.debe_cambiar === true, 'debe_cambiar');
  igual(api({ accion: 'estado', curso_id: 'celulares', token: t.token }).codigo, 'CAMBIO_REQUERIDO');
  esperar(api({ accion: 'cambiar_password', token: t.token, actual: r.temporal, nueva: 'otra-clave-2' }).ok, 'no permitió cambiar');
  esperar(api({ accion: 'estado', curso_id: 'celulares', token: t.token }).ok, 'tras cambiar debía funcionar');
});

console.log('\nMedallas');
// La contraseña de W1 cambió en la sección anterior; sesión nueva para esta sección
const tokM = api({ accion: 'login', whatsapp: W1, password: 'otra-clave-2' }).token;

prueba('una medalla solo se concede si el progreso real la justifica', () => {
  // tok1 tiene el curso completo; 6 clases vistas no bastan para el 100 %
  igual(api({ accion: 'medalla', curso_id: 'celulares', token: tokM, hito: 100 }).codigo, 'NO_ALCANZADO');
});

prueba('la medalla del 25 % se concede una sola vez', () => {
  const primera = api({ accion: 'medalla', curso_id: 'celulares', token: tokM, hito: 25 });
  esperar(primera.ok && primera.nueva === true, JSON.stringify(primera));
  const segunda = api({ accion: 'medalla', curso_id: 'celulares', token: tokM, hito: 25 });
  esperar(segunda.ok && segunda.nueva === false, 'no debía duplicarse');
  igual(filasDe('Medallas').filter(m => Number(m.hito) === 25).length, 1, 'filas de medalla');
});

prueba('un hito inventado se rechaza', () => {
  igual(api({ accion: 'medalla', curso_id: 'celulares', token: tokM, hito: 30 }).codigo, 'DATOS_INVALIDOS');
});

prueba('el estado incluye las medallas ganadas', () => {
  const est = api({ accion: 'estado', curso_id: 'celulares', token: tokM });
  esperar(est.medallas.indexOf(25) !== -1, 'falta la medalla 25: ' + JSON.stringify(est.medallas));
});

console.log('\nAcceso público');

prueba('sin sesión se ve el temario y solo las clases gratis con enlace', () => {
  const r = api({ accion: 'publico', curso_id: 'celulares' });
  esperar(r.ok && r.clases.length === 3, JSON.stringify(r).slice(0, 200));
  const txt = JSON.stringify(r);
  esperar(!txt.includes('PAGO-3'), 'filtró enlace de pago');
  esperar(r.clases.find(c => c.titulo === '1 - Introducción').url.includes('GRATIS-1'), 'falta enlace gratis');
  igual(r.clases.find(c => c.titulo === '3 - Herramientas').url, null, 'clase de pago sin enlace');
});

prueba('el acceso público lista los nombres de los materiales, sin enlaces', () => {
  const r = api({ accion: 'publico', curso_id: 'celulares' });
  igual(r.materiales[0].titulo, 'Diagramas A10');
  esperar(!JSON.stringify(r.materiales).includes('MAT-A10'), 'filtró el enlace del material');
});

prueba('la acción pública no acepta cursos inactivos', () => {
  igual(api({ accion: 'publico', curso_id: 'holistica' }).codigo, 'CURSO_NO_DISPONIBLE');
});

console.log('\nRobustez');

prueba('acción desconocida y JSON inválido no filtran detalles internos', () => {
  igual(api({ accion: 'hack' }).codigo, 'ACCION_INVALIDA');
  const r = api('{ esto no es json');
  igual(r.codigo, 'ERROR_SERVIDOR');
  esperar(!JSON.stringify(r).includes('Unexpected'), 'filtró el detalle del error');
});

prueba('doGet responde OK', () => {
  esperar(run('doGet().getContent()').includes('OK'), 'doGet');
});

prueba('ninguna operación deja un bloqueo anidado', () => {
  igual(env.bloqueos.activos, 0, 'bloqueos abiertos');
});

console.log(`\nResultado: ${pasan} pasan, ${fallan} fallan.`);
process.exit(fallan ? 1 : 0);
