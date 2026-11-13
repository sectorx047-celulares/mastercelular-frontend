/**
 * MasterCelulares · Plataforma de cursos · Servidor v3 (Google Apps Script, desde cero)
 *
 * Despliegue: Implementar > Aplicación web > Ejecutar como: Yo > Acceso: Cualquier persona.
 * Contrato de la API y hojas: CONTRATO-API.md
 *
 * Modelo:
 *  - Usuarios: una cuenta por WhatsApp (nombre + contraseña). Sirve para todos los cursos.
 *  - Accesos: por curso, GRATIS (al registrarse) o COMPLETO (al activar un código).
 *  - Codigos: solo guarda el HMAC del código, nunca el código.
 *  - Entrega: códigos recién generados para entregarlos; se vacía después de la entrega.
 */

var CFG = {
  DIAS_SESION: 30,
  ITERACIONES: 5000,
  MAX_INTENTOS: 5,            // por WhatsApp
  MAX_INTENTOS_GLOBAL: 100,   // activaciones fallidas en toda la plataforma
  BLOQUEO_MIN: 15,
  PASS_MIN: 6,
  PASS_MAX: 72,
  NOMBRE_MAX: 60,
  NOTA_MAX: 1000,
  MINUTO_MAX: 10,
  ZONA: 'America/Lima'
};

// Esquema de todas las hojas. prepararHojas() las crea o completa sin borrar datos.
var ESQUEMA = {
  Cursos:     ['curso_id', 'nombre', 'activo', 'prefijo_codigo', 'carpeta_drive'],
  Usuarios:   ['whatsapp', 'nombre', 'pais', 'password_hash', 'salt', 'debe_cambiar', 'estado', 'creado', 'ultimo_acceso'],
  Accesos:    ['whatsapp', 'curso_id', 'acceso', 'origen', 'fecha'],
  Codigos:    ['codigo_hash', 'curso_id', 'estado', 'whatsapp', 'lote', 'creado', 'fecha_uso'],
  Entrega:    ['codigo', 'curso_id', 'lote', 'creado'],
  Clases:     ['curso_id', 'modulo', 'titulo', 'orden', 'url', 'gratis'],
  Materiales: ['curso_id', 'titulo', 'orden', 'url'],
  Progreso:   ['whatsapp', 'curso_id', 'clase', 'vista', 'fecha'],
  Notas:      ['id', 'whatsapp', 'curso_id', 'clase', 'minuto', 'texto', 'fecha'],
  Descargas:  ['whatsapp', 'curso_id', 'material', 'fecha'],
  Sesiones:   ['token_hash', 'whatsapp', 'expira', 'creado'],
  Intentos:   ['clave', 'fallos', 'inicio'],
  Medallas:   ['whatsapp', 'curso_id', 'hito', 'fecha'],
  Auditoria:  ['fecha', 'whatsapp', 'accion', 'curso_id', 'resultado', 'detalle']
};

var ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 32 símbolos, sin 0/O/1/I/L

/* =====================================================================
   PUNTOS DE ENTRADA
   ===================================================================== */

function doGet() {
  return ContentService.createTextOutput('MasterCelulares · plataforma v3 · OK');
}

function doPost(e) {
  var salida;
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}') || {};
    salida = despachar_(p);
  } catch (err) {
    console.error('doPost: ' + (err && err.stack ? err.stack : err));
    salida = error_('ERROR_SERVIDOR', 'No se pudo procesar la solicitud. Intenta de nuevo.');
  }
  return ContentService.createTextOutput(JSON.stringify(salida))
    .setMimeType(ContentService.MimeType.JSON);
}

function despachar_(p) {
  switch (norm_(p.accion)) {
    case 'publico':          return publico_(p);
    case 'registrar':        return registrar_(p);
    case 'login':            return login_(p);
    case 'logout':           return logout_(p);
    case 'estado':           return estado_(p);
    case 'activar':          return activar_(p);
    case 'cambiar_password': return cambiarPassword_(p);
    case 'progreso':         return progreso_(p);
    case 'obtener_clase':    return obtenerClase_(p);
    case 'obtener_material': return obtenerMaterial_(p);
    case 'nota_guardar':     return notaGuardar_(p);
    case 'nota_eliminar':    return notaEliminar_(p);
    case 'medalla':          return medalla_(p);
    default: return error_('ACCION_INVALIDA', 'Acción no válida.');
  }
}

/* =====================================================================
   ACCIONES PÚBLICAS: registro, acceso y sesión
   ===================================================================== */

// Sin sesión: temario completo (sin enlaces de pago) y enlaces solo de las clases gratis.
function publico_(p) {
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  var clases = clasesDe_(cur.cid).map(function (f) {
    var gratis = siNo_(f.gratis);
    return {
      orden: Number(f.orden) || 0, modulo: norm_(f.modulo), titulo: norm_(f.titulo), gratis: gratis,
      url: gratis ? norm_(f.url) : null
    };
  });
  var materiales = tabla_('Materiales').filas
    .filter(function (f) { return normCurso_(f.curso_id) === cur.cid && norm_(f.url); })
    .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
    .map(function (f) { return { titulo: norm_(f.titulo) }; });
  return { ok: true, curso: { curso_id: cur.cid, nombre: norm_(cur.curso.nombre) }, clases: clases, materiales: materiales };
}

// Crea la cuenta (si no existe) e inscribe al alumno en el curso con acceso GRATIS.
function registrar_(p) {
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  var nombre = validarNombre_(p.nombre);
  if (!nombre) return error_('DATOS_INVALIDOS', 'Escribe un nombre válido (solo letras, de 2 a ' + CFG.NOMBRE_MAX + ' caracteres).');
  var w = validarWhatsapp_(p.whatsapp);
  if (!w) return error_('DATOS_INVALIDOS', 'Escribe un número de WhatsApp válido.');
  var pass = validarPassword_(p.password);
  if (!pass) return error_('DATOS_INVALIDOS', 'La contraseña debe tener entre ' + CFG.PASS_MIN + ' y ' + CFG.PASS_MAX + ' caracteres.');
  var origen = sanitizar_(norm_(p.origen).slice(0, 40)) || 'directo';
  var pais = norm_(p.pais).toUpperCase().slice(0, 2) || 'PE';

  return conBloqueo_(function () {
    var u = usuarioPorWhatsapp_(w);

    // Cuenta existente: solo se vincula al curso si demuestra la contraseña
    if (u) {
      var clave = 'login:' + w;
      var mins = bloqueadoMin_(clave, CFG.MAX_INTENTOS);
      if (mins > 0) return error_('BLOQUEADO', 'Demasiados intentos. Espera ' + mins + ' minutos.', { minutos_espera: mins });
      if (!passwordCorrecta_(u, pass)) {
        registrarFallo_(clave);
        auditar_(w, 'registrar', cur.cid, 'FALLO', 'cuenta existente, contraseña incorrecta');
        return error_('CUENTA_EXISTENTE', 'Este WhatsApp ya tiene cuenta. Entra con tu contraseña para inscribirte en este curso.');
      }
      if (!estaActivo_(u)) return error_('CUENTA_BLOQUEADA', 'Esta cuenta está bloqueada. Escríbenos por WhatsApp.');
      limpiarIntentos_(clave);
      if (acceso_(w, cur.cid)) return error_('YA_INSCRITO', 'Ya estás inscrito en este curso. Entra con tu WhatsApp y contraseña.');
      agregar_('Accesos', { whatsapp: w, curso_id: cur.cid, acceso: 'GRATIS', origen: origen, fecha: new Date() });
      auditar_(w, 'registrar', cur.cid, 'OK', 'vinculado a curso');
      return sesionNueva_(w, u, cur.cid);
    }

    // Cuenta nueva
    var g = guardarPassword_(pass);
    agregar_('Usuarios', {
      whatsapp: w, nombre: nombre, pais: pais, password_hash: g.hash, salt: g.salt,
      debe_cambiar: 'NO', estado: 'ACTIVO', creado: new Date(), ultimo_acceso: new Date()
    });
    agregar_('Accesos', { whatsapp: w, curso_id: cur.cid, acceso: 'GRATIS', origen: origen, fecha: new Date() });
    auditar_(w, 'registrar', cur.cid, 'OK', 'cuenta nueva');
    return sesionNueva_(w, usuarioPorWhatsapp_(w), cur.cid);
  });
}

// Inicia sesión con WhatsApp y contraseña. Devuelve el token y los cursos del alumno.
function login_(p) {
  var w = validarWhatsapp_(p.whatsapp);
  var pass = p.password == null ? '' : String(p.password);
  if (!w || !pass) return error_('DATOS_INVALIDOS', 'Escribe tu WhatsApp y tu contraseña.');
  var clave = 'login:' + w;

  return conBloqueo_(function () {
    var mins = bloqueadoMin_(clave, CFG.MAX_INTENTOS);
    if (mins > 0) {
      auditar_(w, 'login', '', 'BLOQUEADO', '');
      return error_('BLOQUEADO', 'Demasiados intentos. Espera ' + mins + ' minutos.', { minutos_espera: mins });
    }
    var u = usuarioPorWhatsapp_(w);
    if (!u || !estaActivo_(u) || !passwordCorrecta_(u, pass)) {
      registrarFallo_(clave);
      auditar_(w, 'login', '', 'FALLO', '');
      return error_('CREDENCIALES', 'WhatsApp o contraseña incorrectos.');
    }
    limpiarIntentos_(clave);
    actualizar_('Usuarios', u._fila, { ultimo_acceso: new Date() });
    auditar_(w, 'login', '', 'OK', '');
    var s = crearSesion_(w);
    return {
      ok: true, token: s.token, expira: s.expira.toISOString(),
      nombre: norm_(u.nombre), whatsapp: w, debe_cambiar: siNo_(u.debe_cambiar),
      cursos: cursosDe_(w)
    };
  });
}

// Revoca la sesión actual.
function logout_(p) {
  var t = norm_(p.token);
  if (t) {
    var th = sha256Hex_(t);
    var s = tabla_('Sesiones').filas.filter(function (f) { return norm_(f.token_hash) === th; })[0];
    if (s) actualizar_('Sesiones', s._fila, { expira: new Date(0) });
  }
  return { ok: true };
}

// Cambia la contraseña y cierra las demás sesiones del alumno.
function cambiarPassword_(p) {
  var c = ctx_(p, 'cambiar_password');
  if (c.error) return c.error;
  var actual = p.actual == null ? '' : String(p.actual);
  var nueva = validarPassword_(p.nueva);
  if (!nueva) return error_('DATOS_INVALIDOS', 'La nueva contraseña debe tener entre ' + CFG.PASS_MIN + ' y ' + CFG.PASS_MAX + ' caracteres.');
  if (actual === nueva) return error_('DATOS_INVALIDOS', 'La nueva contraseña debe ser distinta a la actual.');

  return conBloqueo_(function () {
    var clave = 'login:' + c.w;
    var mins = bloqueadoMin_(clave, CFG.MAX_INTENTOS);
    if (mins > 0) return error_('BLOQUEADO', 'Demasiados intentos. Espera ' + mins + ' minutos.', { minutos_espera: mins });
    if (!passwordCorrecta_(c.usuario, actual)) {
      registrarFallo_(clave);
      auditar_(c.w, 'cambiar_password', '', 'FALLO', '');
      return error_('CREDENCIALES', 'La contraseña actual no es correcta.');
    }
    var g = guardarPassword_(nueva);
    actualizar_('Usuarios', c.usuario._fila, { password_hash: g.hash, salt: g.salt, debe_cambiar: 'NO' });
    revocarSesiones_(c.w, norm_(c.sesion.token_hash));
    limpiarIntentos_(clave);
    auditar_(c.w, 'cambiar_password', '', 'OK', '');
    return { ok: true };
  });
}

/* =====================================================================
   ACCIONES PROTEGIDAS (requieren sesión válida)
   ===================================================================== */

// Estado completo del alumno en un curso: clases, vistas, notas y materiales.
// Nunca devuelve enlaces de clases de pago ni de materiales.
function estado_(p) {
  var c = ctx_(p, 'estado');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  var ac = acceso_(c.w, cur.cid);
  if (!ac) return error_('NO_INSCRITO', 'Aún no estás inscrito en este curso.');
  var completo = esCompleto_(ac);

  var clases = clasesDe_(cur.cid).map(function (f) {
    var gratis = siNo_(f.gratis);
    return {
      orden: Number(f.orden) || 0,
      modulo: norm_(f.modulo),
      titulo: norm_(f.titulo),
      gratis: gratis,
      disponible: gratis || completo,
      url: gratis ? norm_(f.url) : null
    };
  });

  return {
    ok: true,
    usuario: { nombre: norm_(c.usuario.nombre), whatsapp: c.w },
    curso: { curso_id: cur.cid, nombre: norm_(cur.curso.nombre) },
    acceso: completo ? 'COMPLETO' : 'GRATIS',
    clases: clases,
    vistas: vistasDe_(c.w, cur.cid),
    notas: notasDe_(c.w, cur.cid),
    materiales: completo ? materialesDe_(c.w, cur.cid) : [],
    medallas: tabla_('Medallas').filas
      .filter(function (f) { return digitos_(f.whatsapp) === c.w && normCurso_(f.curso_id) === cur.cid; })
      .map(function (f) { return Number(f.hito); }),
    carpeta: completo ? norm_(cur.curso.carpeta_drive) : ''
  };
}

// Canjea un código de activación para el curso indicado.
function activar_(p) {
  var c = ctx_(p, 'activar');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  var codigo = norm_(p.codigo).toUpperCase().replace(/\s+/g, '');
  if (!codigo || codigo.length > 40) return error_('DATOS_INVALIDOS', 'Escribe tu código de activación.');
  var clave = 'activar:' + c.w;

  return conBloqueo_(function () {
    var mins = bloqueadoMin_(clave, CFG.MAX_INTENTOS);
    if (mins > 0) return error_('BLOQUEADO', 'Demasiados intentos. Espera ' + mins + ' minutos.', { minutos_espera: mins });
    if (bloqueadoMin_('activar:global', CFG.MAX_INTENTOS_GLOBAL) > 0) {
      return error_('BLOQUEADO', 'Hay demasiados intentos de activación. Intenta en unos minutos.');
    }

    var h = hmacHex_(codigo, pepper_());
    var cod = tabla_('Codigos').filas.filter(function (f) { return norm_(f.codigo_hash) === h; })[0];
    if (!cod || normCurso_(cod.curso_id) !== cur.cid || norm_(cod.estado).toUpperCase() !== 'DISPONIBLE') {
      registrarFallo_(clave);
      registrarFallo_('activar:global');
      auditar_(c.w, 'activar', cur.cid, 'FALLO', '');
      return error_('CODIGO_INVALIDO', 'El código no es válido, ya fue usado o no corresponde a este curso.');
    }
    var ac = acceso_(c.w, cur.cid);
    if (ac && esCompleto_(ac)) return error_('YA_ACTIVO', 'Este curso ya está activo en tu cuenta.');

    actualizar_('Codigos', cod._fila, { estado: 'USADO', whatsapp: c.w, fecha_uso: new Date() });
    if (ac) actualizar_('Accesos', ac._fila, { acceso: 'COMPLETO', origen: 'codigo', fecha: new Date() });
    else agregar_('Accesos', { whatsapp: c.w, curso_id: cur.cid, acceso: 'COMPLETO', origen: 'codigo', fecha: new Date() });
    limpiarIntentos_(clave);
    auditar_(c.w, 'activar', cur.cid, 'OK', '');
    return { ok: true, curso_id: cur.cid, acceso: 'COMPLETO' };
  });
}

// Marca una clase como vista (o la desmarca).
function progreso_(p) {
  var c = ctx_(p, 'progreso');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  if (!acceso_(c.w, cur.cid)) return error_('NO_INSCRITO', 'Aún no estás inscrito en este curso.');
  var titulo = norm_(p.clase);
  if (!claseRaw_(cur.cid, titulo)) return error_('CLASE_NO_EXISTE', 'La clase no existe en este curso.');
  var visto = p.visto === true || String(p.visto).toLowerCase() === 'true';

  return conBloqueo_(function () {
    var r = tabla_('Progreso').filas.filter(function (f) {
      return digitos_(f.whatsapp) === c.w && normCurso_(f.curso_id) === cur.cid && norm_(f.clase) === titulo;
    })[0];
    if (r) actualizar_('Progreso', r._fila, { vista: visto ? 'SI' : 'NO', fecha: new Date() });
    else agregar_('Progreso', { whatsapp: c.w, curso_id: cur.cid, clase: titulo, vista: visto ? 'SI' : 'NO', fecha: new Date() });
    return { ok: true, vistas: vistasDe_(c.w, cur.cid) };
  });
}

// Enlace de una clase: gratis siempre; de pago solo con acceso COMPLETO.
function obtenerClase_(p) {
  var c = ctx_(p, 'obtener_clase');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  var ac = acceso_(c.w, cur.cid);
  if (!ac) return error_('NO_INSCRITO', 'Aún no estás inscrito en este curso.');
  var clase = claseRaw_(cur.cid, norm_(p.clase));
  if (!clase) return error_('CLASE_NO_EXISTE', 'La clase no existe en este curso.');
  if (!siNo_(clase.gratis) && !esCompleto_(ac)) {
    return error_('REQUIERE_ACTIVACION', 'Esta clase es parte del curso completo.');
  }
  var url = norm_(clase.url);
  if (!url) return error_('SIN_ENLACE', 'Esta clase aún no tiene enlace disponible.');
  return { ok: true, titulo: norm_(clase.titulo), url: url };
}

// Enlace de un material. Solo con acceso COMPLETO. Registra la primera descarga.
function obtenerMaterial_(p) {
  var c = ctx_(p, 'obtener_material');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  var ac = acceso_(c.w, cur.cid);
  if (!ac) return error_('NO_INSCRITO', 'Aún no estás inscrito en este curso.');
  if (!esCompleto_(ac)) return error_('REQUIERE_ACTIVACION', 'Los materiales son parte del curso completo.');
  var titulo = norm_(p.material);
  var mat = tabla_('Materiales').filas.filter(function (f) {
    return normCurso_(f.curso_id) === cur.cid && norm_(f.titulo) === titulo;
  })[0];
  if (!mat || !norm_(mat.url)) return error_('NO_ENCONTRADO', 'Material no encontrado.');

  conBloqueo_(function () {
    var ya = tabla_('Descargas').filas.some(function (f) {
      return digitos_(f.whatsapp) === c.w && normCurso_(f.curso_id) === cur.cid && norm_(f.material) === titulo;
    });
    if (!ya) agregar_('Descargas', { whatsapp: c.w, curso_id: cur.cid, material: titulo, fecha: new Date() });
  });
  return { ok: true, titulo: titulo, url: norm_(mat.url) };
}

function notaGuardar_(p) {
  var c = ctx_(p, 'nota_guardar');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  if (!acceso_(c.w, cur.cid)) return error_('NO_INSCRITO', 'Aún no estás inscrito en este curso.');
  var titulo = norm_(p.clase);
  if (!claseRaw_(cur.cid, titulo)) return error_('CLASE_NO_EXISTE', 'La clase no existe en este curso.');
  var texto = p.texto == null ? '' : String(p.texto).trim();
  if (!texto || texto.length > CFG.NOTA_MAX) return error_('DATOS_INVALIDOS', 'El apunte debe tener entre 1 y ' + CFG.NOTA_MAX + ' caracteres.');
  var minuto = norm_(p.minuto).slice(0, CFG.MINUTO_MAX);
  var id = Utilities.getUuid();
  agregar_('Notas', {
    id: id, whatsapp: c.w, curso_id: cur.cid, clase: titulo,
    minuto: sanitizar_(minuto), texto: sanitizar_(texto), fecha: new Date()
  });
  return { ok: true, nota: { id: id, clase: titulo, minuto: minuto, texto: texto, fecha: new Date().toISOString() } };
}

// Solo elimina apuntes propios.
function notaEliminar_(p) {
  var c = ctx_(p, 'nota_eliminar');
  if (c.error) return c.error;
  var id = norm_(p.id);
  if (!id) return error_('DATOS_INVALIDOS', 'Falta el identificador del apunte.');
  return conBloqueo_(function () {
    var n = tabla_('Notas').filas.filter(function (f) {
      return norm_(f.id) === id && digitos_(f.whatsapp) === c.w;
    })[0];
    if (!n) return error_('NO_ENCONTRADO', 'El apunte no existe.');
    eliminarFila_('Notas', n._fila);
    return { ok: true };
  });
}

// Registra una medalla (25, 50, 75 o 100 %) solo si el progreso real la justifica. Es idempotente.
function medalla_(p) {
  var c = ctx_(p, 'medalla');
  if (c.error) return c.error;
  var cur = cursoDeRequest_(p);
  if (!cur) return error_('CURSO_NO_DISPONIBLE', 'Este curso no está disponible.');
  if (!acceso_(c.w, cur.cid)) return error_('NO_INSCRITO', 'Aún no estás inscrito en este curso.');
  var hito = Number(p.hito);
  if ([25, 50, 75, 100].indexOf(hito) === -1) return error_('DATOS_INVALIDOS', 'Hito no válido.');

  return conBloqueo_(function () {
    var total = clasesDe_(cur.cid).length;
    var vistas = vistasDe_(c.w, cur.cid).length;
    var porcentaje = total ? Math.floor((vistas / total) * 100) : 0;
    if (porcentaje < hito) return error_('NO_ALCANZADO', 'Aún no alcanzas esta medalla.');
    var ya = tabla_('Medallas').filas.some(function (f) {
      return digitos_(f.whatsapp) === c.w && normCurso_(f.curso_id) === cur.cid && Number(f.hito) === hito;
    });
    if (!ya) agregar_('Medallas', { whatsapp: c.w, curso_id: cur.cid, hito: hito, fecha: new Date() });
    return { ok: true, hito: hito, nueva: !ya };
  });
}

/* =====================================================================
   ADMINISTRACIÓN (solo desde el menú de la hoja de cálculo)
   ===================================================================== */

// Crea códigos: guarda HMAC en Codigos y el texto en Entrega (para entregarlos).
function generarCodigos_(cursoIdRaw, cantidadRaw) {
  var cid = normCurso_(cursoIdRaw);
  var curso = curso_(cid);
  if (!curso) throw new Error('El curso "' + cid + '" no existe o está inactivo.');
  var n = Math.floor(Number(cantidadRaw));
  if (!(n >= 1 && n <= 500)) throw new Error('La cantidad debe estar entre 1 y 500.');
  var pref = norm_(curso.prefijo_codigo).toUpperCase() || 'CUR';

  return conBloqueo_(function () {
    var pep = pepper_();
    var usados = {};
    tabla_('Codigos').filas.forEach(function (f) { usados[norm_(f.codigo_hash)] = true; });
    var lote = 'L' + Utilities.formatDate(new Date(), CFG.ZONA, 'yyyyMMdd-HHmmss');
    var ahora = new Date();
    var filasCodigos = [], filasEntrega = [];
    while (filasCodigos.length < n) {
      var code = pref + '-' + bloque_(4) + '-' + bloque_(4) + '-' + bloque_(4);
      var h = hmacHex_(code, pep);
      if (usados[h]) continue;
      usados[h] = true;
      filasCodigos.push({ codigo_hash: h, curso_id: cid, estado: 'DISPONIBLE', whatsapp: '', lote: lote, creado: ahora, fecha_uso: '' });
      filasEntrega.push({ codigo: code, curso_id: cid, lote: lote, creado: ahora });
    }
    agregarLote_('Codigos', filasCodigos);
    agregarLote_('Entrega', filasEntrega);
    auditar_('', 'generar_codigos', cid, 'OK', lote + ' x' + n);
    return { lote: lote, cantidad: n, prefijo: pref };
  });
}

// Anula un código que todavía no se usó.
function anularCodigo_(codigoRaw) {
  var codigo = norm_(codigoRaw).toUpperCase().replace(/\s+/g, '');
  if (!codigo) throw new Error('Escribe el código.');
  return conBloqueo_(function () {
    var cod = tabla_('Codigos').filas.filter(function (f) {
      return norm_(f.codigo_hash) === hmacHex_(codigo, pepper_());
    })[0];
    if (!cod) throw new Error('El código no existe.');
    if (norm_(cod.estado).toUpperCase() !== 'DISPONIBLE') throw new Error('Solo se pueden anular códigos disponibles (estado actual: ' + cod.estado + ').');
    actualizar_('Codigos', cod._fila, { estado: 'ANULADO' });
    auditar_('', 'anular_codigo', normCurso_(cod.curso_id), 'OK', '');
    return { ok: true };
  });
}

// Genera una contraseña temporal. El alumno debe cambiarla al entrar.
function restablecerPassword_(whatsappRaw) {
  var w = validarWhatsapp_(whatsappRaw);
  if (!w) throw new Error('WhatsApp no válido.');
  return conBloqueo_(function () {
    var u = usuarioPorWhatsapp_(w);
    if (!u) throw new Error('No hay ninguna cuenta con ese WhatsApp.');
    var temporal = bloque_(10);
    var g = guardarPassword_(temporal);
    actualizar_('Usuarios', u._fila, { password_hash: g.hash, salt: g.salt, debe_cambiar: 'SI' });
    revocarSesiones_(w, '');
    auditar_(w, 'restablecer_password', '', 'OK', '');
    return { whatsapp: w, temporal: temporal };
  });
}

// Crea las hojas que falten y añade columnas nuevas sin borrar datos.
function prepararHojas_() {
  var libroObj = libro_();
  var creadas = [];
  Object.keys(ESQUEMA).forEach(function (nombre) {
    var sh = libroObj.getSheetByName(nombre);
    if (!sh) { sh = libroObj.insertSheet(nombre); creadas.push(nombre); }
    var ultima = sh.getLastColumn();
    var cab = ultima ? sh.getRange(1, 1, 1, ultima).getValues()[0].map(function (x) { return norm_(x); }) : [];
    ESQUEMA[nombre].forEach(function (col) {
      if (cab.indexOf(col) === -1) {
        sh.getRange(1, cab.length + 1).setValue(col);
        cab.push(col);
      }
    });
  });
  pepper_();
  return { creadas: creadas };
}

/* ---------- Menú de la hoja (solo para el dueño y los editores) ---------- */

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('MasterCelulares')
      .addItem('Preparar hojas', 'menuPrepararHojas')
      .addSeparator()
      .addItem('Generar códigos', 'menuGenerarCodigos')
      .addItem('Anular código', 'menuAnularCodigo')
      .addItem('Restablecer contraseña', 'menuRestablecerPassword')
      .addItem('Vaciar hoja Entrega', 'menuVaciarEntrega')
      .addToUi();
  } catch (e) { /* sin interfaz (ejecución desde el editor) */ }
}

function menuPrepararHojas() {
  var ui = SpreadsheetApp.getUi();
  var r = prepararHojas_();
  ui.alert('Hojas preparadas. Nuevas: ' + (r.creadas.length ? r.creadas.join(', ') : 'ninguna') + '.');
}

function menuGenerarCodigos() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Generar códigos', 'curso_id (por ejemplo: celulares)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var b = ui.prompt('Generar códigos', 'Cantidad (1 a 500)', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  try {
    var r = generarCodigos_(a.getResponseText(), b.getResponseText());
    ui.alert(r.cantidad + ' códigos creados (lote ' + r.lote + '). Están en la hoja Entrega. Entrégalos y luego vacía esa hoja.');
  } catch (e) {
    ui.alert('No se generaron códigos: ' + e.message);
  }
}

function menuAnularCodigo() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Anular código', 'Escribe el código a anular', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  try {
    anularCodigo_(a.getResponseText());
    ui.alert('Código anulado.');
  } catch (e) {
    ui.alert('No se anuló: ' + e.message);
  }
}

function menuRestablecerPassword() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Restablecer contraseña', 'WhatsApp del alumno (con código de país)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  try {
    var r = restablecerPassword_(a.getResponseText());
    ui.alert('Contraseña temporal para ' + r.whatsapp + ': ' + r.temporal + '\n\nCompártela una sola vez. El alumno deberá cambiarla al entrar.');
  } catch (e) {
    ui.alert('No se restableció: ' + e.message);
  }
}

function menuVaciarEntrega() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('¿Vaciar la hoja Entrega? Los códigos quedan guardados de forma segura; solo se borra el texto visible.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var sh = libro_().getSheetByName('Entrega');
  var ultima = sh.getLastRow();
  if (ultima > 1) sh.getRange(2, 1, ultima - 1, sh.getLastColumn()).clearContent();
  ui.alert('Hoja Entrega vaciada.');
}

/* =====================================================================
   ACCESO A DATOS
   ===================================================================== */

function libro_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

// Lee una hoja como objetos. _fila es el número real de fila (para actualizar o borrar).
function tabla_(nombre) {
  var sh = libro_().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja ' + nombre + '. Ejecuta "Preparar hojas".');
  var datos = sh.getDataRange().getValues();
  if (!datos.length) datos = [[]];
  var cab = datos[0].map(function (h) { return norm_(h); });
  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var o = { _fila: i + 1 };
    var vacia = true;
    cab.forEach(function (c, j) {
      if (!c) return;
      o[c] = datos[i][j];
      if (datos[i][j] !== '' && datos[i][j] != null) vacia = false;
    });
    if (!vacia) filas.push(o);
  }
  return { sh: sh, cab: cab, filas: filas };
}

function agregar_(nombre, obj) {
  var t = tabla_(nombre);
  t.sh.appendRow(t.cab.map(function (c) { return obj[c] !== undefined ? obj[c] : ''; }));
}

function agregarLote_(nombre, objs) {
  if (!objs.length) return;
  var t = tabla_(nombre);
  var filas = objs.map(function (o) {
    return t.cab.map(function (c) { return o[c] !== undefined ? o[c] : ''; });
  });
  t.sh.getRange(t.sh.getLastRow() + 1, 1, filas.length, t.cab.length).setValues(filas);
}

function actualizar_(nombre, fila, cambios) {
  var t = tabla_(nombre);
  Object.keys(cambios).forEach(function (k) {
    var c = t.cab.indexOf(k);
    if (c === -1) throw new Error('Columna inexistente: ' + nombre + '.' + k);
    t.sh.getRange(fila, c + 1).setValue(cambios[k]);
  });
}

function eliminarFila_(nombre, fila) {
  tabla_(nombre).sh.deleteRow(fila);
}

function usuarioPorWhatsapp_(w) {
  if (!w) return null;
  return tabla_('Usuarios').filas.filter(function (f) { return digitos_(f.whatsapp) === w; })[0] || null;
}

function acceso_(w, cid) {
  return tabla_('Accesos').filas.filter(function (f) {
    return digitos_(f.whatsapp) === w && normCurso_(f.curso_id) === cid;
  })[0] || null;
}

function cursosDe_(w) {
  return tabla_('Accesos').filas
    .filter(function (f) { return digitos_(f.whatsapp) === w; })
    .map(function (f) { return { curso_id: normCurso_(f.curso_id), acceso: norm_(f.acceso).toUpperCase() }; });
}

function curso_(cid) {
  var c = tabla_('Cursos').filas.filter(function (f) { return normCurso_(f.curso_id) === cid; })[0];
  return c && siNo_(c.activo) ? c : null;
}

function cursoDeRequest_(p) {
  var cid = normCurso_(p.curso_id);
  if (!cid) return null;
  var c = curso_(cid);
  return c ? { cid: cid, curso: c } : null;
}

function clasesDe_(cid) {
  return tabla_('Clases').filas
    .filter(function (f) { return normCurso_(f.curso_id) === cid; })
    .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); });
}

function claseRaw_(cid, titulo) {
  return clasesDe_(cid).filter(function (f) { return norm_(f.titulo) === titulo; })[0] || null;
}

function materialesDe_(w, cid) {
  var descargados = tabla_('Descargas').filas
    .filter(function (f) { return digitos_(f.whatsapp) === w && normCurso_(f.curso_id) === cid; })
    .map(function (f) { return norm_(f.material); });
  return tabla_('Materiales').filas
    .filter(function (f) { return normCurso_(f.curso_id) === cid && norm_(f.url); })
    .sort(function (a, b) { return (Number(a.orden) || 0) - (Number(b.orden) || 0); })
    .map(function (f) { return { titulo: norm_(f.titulo), descargado: descargados.indexOf(norm_(f.titulo)) !== -1 }; });
}

function vistasDe_(w, cid) {
  return tabla_('Progreso').filas
    .filter(function (f) { return digitos_(f.whatsapp) === w && normCurso_(f.curso_id) === cid && siNo_(f.vista); })
    .map(function (f) { return norm_(f.clase); });
}

function notasDe_(w, cid) {
  return tabla_('Notas').filas
    .filter(function (f) { return digitos_(f.whatsapp) === w && normCurso_(f.curso_id) === cid; })
    .map(function (f) {
      return { id: norm_(f.id), clase: norm_(f.clase), minuto: norm_(f.minuto), texto: String(f.texto == null ? '' : f.texto), fecha: fechaIso_(f.fecha) };
    });
}

/* =====================================================================
   SESIONES Y CONTEXTO
   ===================================================================== */

function crearSesion_(w) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var expira = new Date(Date.now() + CFG.DIAS_SESION * 86400000);
  agregar_('Sesiones', { token_hash: sha256Hex_(token), whatsapp: w, expira: expira, creado: new Date() });
  return { token: token, expira: expira };
}

function sesionNueva_(w, u, cid) {
  var s = crearSesion_(w);
  return {
    ok: true, token: s.token, expira: s.expira.toISOString(),
    nombre: norm_(u.nombre), whatsapp: w, curso_id: cid, debe_cambiar: siNo_(u.debe_cambiar)
  };
}

// Devuelve la sesión si el token existe, no caducó y la cuenta está activa.
function sesionValida_(token) {
  var t = norm_(token);
  if (!t) return null;
  var th = sha256Hex_(t);
  var s = tabla_('Sesiones').filas.filter(function (f) { return norm_(f.token_hash) === th; })[0];
  if (!s || vencida_(s.expira)) return null;
  var u = usuarioPorWhatsapp_(digitos_(s.whatsapp));
  if (!u || !estaActivo_(u)) return null;
  return { sesion: s, usuario: u };
}

// Contexto para acciones protegidas. Si la contraseña es temporal, solo permite cambiarla.
function ctx_(p, accion) {
  var s = sesionValida_(p.token);
  if (!s) return { error: error_('SESION_INVALIDA', 'Tu sesión venció. Entra de nuevo.') };
  if (siNo_(s.usuario.debe_cambiar) && accion !== 'cambiar_password') {
    return { error: error_('CAMBIO_REQUERIDO', 'Debes cambiar tu contraseña temporal para continuar.') };
  }
  return { w: digitos_(s.usuario.whatsapp), usuario: s.usuario, sesion: s.sesion };
}

// Revoca todas las sesiones del alumno, salvo la indicada.
function revocarSesiones_(w, conservarHash) {
  var ids = tabla_('Sesiones').filas
    .filter(function (f) { return digitos_(f.whatsapp) === w && norm_(f.token_hash) !== conservarHash; })
    .map(function (f) { return f._fila; });
  ids.forEach(function (fila) { actualizar_('Sesiones', fila, { expira: new Date(0) }); });
}

/* =====================================================================
   CONTRASEÑAS Y CÓDIGOS
   ===================================================================== */

function pepper_() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('PEPPER');
  if (!k) {
    k = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('PEPPER', k);
  }
  return k;
}

function hashPassword_(pass, salt, iter) {
  var h = hmacHex_(salt + ':' + pass, pepper_());
  for (var i = 0; i < iter; i++) h = sha256Hex_(h + salt);
  return h;
}

// Guarda "iteraciones$hash", así se puede subir el número de iteraciones sin romper cuentas.
function guardarPassword_(pass) {
  var salt = Utilities.getUuid().replace(/-/g, '');
  return { salt: salt, hash: CFG.ITERACIONES + '$' + hashPassword_(pass, salt, CFG.ITERACIONES) };
}

function passwordCorrecta_(u, pass) {
  var partes = String(u.password_hash == null ? '' : u.password_hash).split('$');
  if (partes.length !== 2) return false;
  var iter = Number(partes[0]);
  if (!iter || !u.salt) return false;
  return igualesSeguro_(hashPassword_(String(pass), String(u.salt), iter), partes[1]);
}

// Genera "XXXX" con el alfabeto sin ambigüedades, a partir de bytes aleatorios de UUID.
function bloque_(n) {
  var out = '';
  while (out.length < n) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < hex.length / 2 && out.length < n; i++) {
      var b = parseInt(hex.substr(i * 2, 2), 16);
      out += ALFABETO_CODIGO.charAt(b % ALFABETO_CODIGO.length);
    }
  }
  return out;
}

/* =====================================================================
   LÍMITE DE INTENTOS
   ===================================================================== */

function bloqueadoMin_(clave, max) {
  var r = tabla_('Intentos').filas.filter(function (f) { return norm_(f.clave) === clave; })[0];
  if (!r || Number(r.fallos) < max) return 0;
  var fin = aFecha_(r.inicio).getTime() + CFG.BLOQUEO_MIN * 60000;
  var resta = fin - Date.now();
  return resta > 0 ? Math.ceil(resta / 60000) : 0;
}

// Ventana fija de BLOQUEO_MIN minutos desde el primer fallo.
function registrarFallo_(clave) {
  var r = tabla_('Intentos').filas.filter(function (f) { return norm_(f.clave) === clave; })[0];
  if (!r) {
    agregar_('Intentos', { clave: clave, fallos: 1, inicio: new Date() });
    return;
  }
  var fin = aFecha_(r.inicio).getTime() + CFG.BLOQUEO_MIN * 60000;
  if (isNaN(fin) || fin <= Date.now()) {
    actualizar_('Intentos', r._fila, { fallos: 1, inicio: new Date() });
  } else {
    actualizar_('Intentos', r._fila, { fallos: Number(r.fallos) + 1 });
  }
}

function limpiarIntentos_(clave) {
  var r = tabla_('Intentos').filas.filter(function (f) { return norm_(f.clave) === clave; })[0];
  if (r) actualizar_('Intentos', r._fila, { fallos: 0 });
}

/* =====================================================================
   UTILIDADES
   ===================================================================== */

function error_(codigo, mensaje, extra) {
  return Object.assign({ ok: false, codigo: codigo, mensaje: mensaje }, extra || {});
}

function conBloqueo_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); }
  catch (e) { return error_('OCUPADO', 'El servidor está ocupado. Intenta de nuevo en unos segundos.'); }
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function auditar_(w, accion, cid, resultado, detalle) {
  try {
    agregar_('Auditoria', {
      fecha: new Date(), whatsapp: digitos_(w), accion: accion, curso_id: cid || '',
      resultado: resultado, detalle: sanitizar_(detalle || '')
    });
  } catch (e) { /* la auditoría nunca debe romper una operación */ }
}

function validarWhatsapp_(raw) {
  var w = digitos_(raw);
  return (w.length >= 10 && w.length <= 15) ? w : null;
}

function validarNombre_(raw) {
  var n = norm_(raw).replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > CFG.NOMBRE_MAX) return null;
  return /^[\p{L}\p{M} .'\-]+$/u.test(n) ? n : null;
}

function validarPassword_(raw) {
  var p = raw == null ? '' : String(raw);
  return (p.length >= CFG.PASS_MIN && p.length <= CFG.PASS_MAX) ? p : null;
}

// Evita que un texto del alumno se interprete como fórmula en la hoja.
function sanitizar_(s) {
  var t = String(s == null ? '' : s);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

function norm_(x) { return String(x == null ? '' : x).trim(); }
function normCurso_(x) { return norm_(x).toLowerCase(); }
function digitos_(x) { return String(x == null ? '' : x).replace(/\D/g, ''); }
function siNo_(v) { return norm_(v).toUpperCase() === 'SI'; }
function esCompleto_(ac) { return norm_(ac.acceso).toUpperCase() === 'COMPLETO'; }
function estaActivo_(u) { return norm_(u.estado).toUpperCase() === 'ACTIVO'; }

function aFecha_(v) { return v instanceof Date ? v : new Date(v); }
function vencida_(v) {
  var f = aFecha_(v).getTime();
  return isNaN(f) || f <= Date.now();
}
function fechaIso_(v) {
  var d = aFecha_(v);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function igualesSeguro_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function hex_(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function sha256Hex_(texto) {
  return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
}

function hmacHex_(texto, clave) {
  return hex_(Utilities.computeHmacSha256Signature(String(texto), String(clave)));
}
