# Contrato de la API · Servidor v3

Un solo Web App sirve a todos los cursos y países. Todas las llamadas son `POST` con un cuerpo JSON
enviado como `Content-Type: text/plain;charset=utf-8` (así evitas el preflight de CORS con Apps Script).

## Respuesta general

Éxito: `{ "ok": true, ... }`
Error: `{ "ok": false, "codigo": "CODIGO", "mensaje": "Texto para el alumno" }`

| codigo | Significado |
|---|---|
| `ACCION_INVALIDA` | La acción no existe. |
| `ERROR_SERVIDOR` | Error interno (el detalle se registra en el servidor, no se muestra). |
| `OCUPADO` | Demasiadas operaciones simultáneas. Reintentar. |
| `DATOS_INVALIDOS` | Falta un dato o no cumple el formato. |
| `CURSO_NO_DISPONIBLE` | El `curso_id` no existe o está inactivo. |
| `CUENTA_EXISTENTE` | Al registrarse, el WhatsApp ya tiene cuenta y la contraseña no coincide. |
| `YA_INSCRITO` | El alumno ya está inscrito en ese curso. |
| `CUENTA_BLOQUEADA` | La cuenta está desactivada. |
| `CREDENCIALES` | WhatsApp o contraseña incorrectos (mismo mensaje si la cuenta no existe). |
| `BLOQUEADO` | Demasiados intentos. Incluye `minutos_espera`. |
| `SESION_INVALIDA` | Token inexistente, caducado o revocado. Volver a entrar. |
| `CAMBIO_REQUERIDO` | Contraseña temporal: solo se permite `cambiar_password`. |
| `NO_INSCRITO` | El alumno no tiene acceso (ni gratis) a ese curso. |
| `REQUIERE_ACTIVACION` | Contenido de pago sin acceso COMPLETO. |
| `CLASE_NO_EXISTE` / `NO_ENCONTRADO` | El título o el id no existe. |
| `CODIGO_INVALIDO` | Código inexistente, usado, anulado o de otro curso. |
| `YA_ACTIVO` | El curso ya está activo en la cuenta. |
| `SIN_ENLACE` | La clase existe pero aún no tiene enlace cargado. |

## Acciones

### `registrar` (público)
Entrada: `{ accion, curso_id, nombre, whatsapp, password, pais, origen }`
- `nombre`: 2 a 60 caracteres, solo letras, espacios, punto, apóstrofe o guion.
- `whatsapp`: 10 a 15 dígitos, con código de país (se normaliza solo a dígitos).
- `password`: 6 a 72 caracteres.
- Si el WhatsApp no existe, crea la cuenta y la inscribe con acceso `GRATIS`.
- Si ya existe, solo se vincula al curso con la contraseña correcta.

Salida: `{ ok, token, expira, nombre, whatsapp, curso_id, debe_cambiar }`

### `login` (público)
Entrada: `{ accion, whatsapp, password }`
Salida: `{ ok, token, expira, nombre, whatsapp, debe_cambiar, cursos: [{ curso_id, acceso }] }`

### `logout`
Entrada: `{ accion, token }`. Revoca la sesión. Salida: `{ ok: true }`.

### `estado` (sesión + curso)
Entrada: `{ accion, token, curso_id }`
Salida:
```
{
  ok, acceso: "GRATIS" | "COMPLETO",
  usuario: { nombre, whatsapp },
  curso: { curso_id, nombre },
  clases: [{ orden, modulo, titulo, gratis, disponible, url }],   // url solo si gratis
  vistas: ["titulo de clase", ...],
  notas: [{ id, clase, minuto, texto, fecha }],
  materiales: [{ titulo, descargado }],                          // vacío si GRATIS, sin URLs
  carpeta: "enlace de Drive" | ""                                // solo si COMPLETO
}
```
Nunca incluye enlaces de clases de pago.

### `activar` (sesión + curso)
Entrada: `{ accion, token, curso_id, codigo }`. Canjea un código y pasa el curso a `COMPLETO`.
Salida: `{ ok, curso_id, acceso: "COMPLETO" }`.

### `cambiar_password` (sesión)
Entrada: `{ accion, token, actual, nueva }`. Cierra las demás sesiones del alumno.
Salida: `{ ok: true }`.

### `progreso` (sesión + curso)
Entrada: `{ accion, token, curso_id, clase, visto: true|false }`. Salida: `{ ok, vistas }`.

### `obtener_clase` (sesión + curso)
Entrada: `{ accion, token, curso_id, clase }`. Clase gratis: siempre. De pago: solo `COMPLETO`.
Salida: `{ ok, titulo, url }`.

### `obtener_material` (sesión + curso, solo `COMPLETO`)
Entrada: `{ accion, token, curso_id, material }`. Registra la primera descarga.
Salida: `{ ok, titulo, url }`.

### `nota_guardar` (sesión + curso)
Entrada: `{ accion, token, curso_id, clase, minuto, texto }`. `texto`: 1 a 1000 caracteres.
Salida: `{ ok, nota: { id, clase, minuto, texto, fecha } }`.

### `nota_eliminar` (sesión)
Entrada: `{ accion, token, id }`. Solo elimina apuntes propios. Salida: `{ ok: true }`.

## Modelo de acceso

- **Cuenta:** una por WhatsApp (`Usuarios`). Sirve para todos los cursos.
- **Acceso:** una fila por alumno y curso (`Accesos`): `GRATIS` o `COMPLETO`.
- **Sesión:** token aleatorio de 64 caracteres; el servidor guarda solo su SHA-256 y caduca a los 30 días.
- **Contraseñas:** HMAC con una clave secreta del script (`PEPPER`) y 5000 iteraciones de SHA-256 con sal propia.
- **Códigos:** el servidor guarda solo el HMAC del código. El texto se escribe en `Entrega` para entregarlo y luego
  se vacía.
- **Límites:** 5 intentos fallidos por WhatsApp cada 15 minutos; 100 activaciones fallidas en toda la plataforma
  cada 15 minutos.

## Hojas (se crean con "Preparar hojas")

| Hoja | Columnas |
|---|---|
| Cursos | curso_id, nombre, activo (SI/NO), prefijo_codigo, carpeta_drive |
| Usuarios | whatsapp, nombre, pais, password_hash, salt, debe_cambiar, estado, creado, ultimo_acceso |
| Accesos | whatsapp, curso_id, acceso, origen, fecha |
| Codigos | codigo_hash, curso_id, estado, whatsapp, lote, creado, fecha_uso |
| Entrega | codigo, curso_id, lote, creado (temporal: vaciar tras entregar) |
| Clases | curso_id, modulo, titulo, orden, url, gratis (SI/NO) |
| Materiales | curso_id, titulo, orden, url |
| Progreso | whatsapp, curso_id, clase, vista, fecha |
| Notas | id, whatsapp, curso_id, clase, minuto, texto, fecha |
| Descargas | whatsapp, curso_id, material, fecha |
| Sesiones | token_hash, whatsapp, expira, creado |
| Intentos | clave, fallos, inicio |
| Auditoria | fecha, whatsapp, accion, curso_id, resultado, detalle |

**Regla:** el título de cada clase debe ser único dentro de su curso, porque el progreso usa el título.

## Puesta en marcha

1. Crea una hoja de cálculo nueva. (No reutilices la hoja anterior: esta versión empieza desde cero.)
2. Extensiones > Apps Script. Pega `Code.gs` y guarda.
3. Ejecuta `prepararHojas_` una vez desde el editor y acepta los permisos. Recarga la hoja: aparece el menú **MasterCelulares**.
4. Desde el menú, ejecuta **Preparar hojas** (equivalente, por si prefieres no usar el editor).
5. Rellena **Cursos**, **Clases** y **Materiales**.
6. Implementar > Nueva implementación > Aplicación web > Ejecutar como: **Yo** > Acceso: **Cualquier persona**.
7. Abre la URL `/exec` en el navegador: debe decir `MasterCelulares · plataforma v3 · OK`.
8. Genera códigos desde el menú, entrégalos y vacía la hoja Entrega.

## Pruebas

`node servidor/pruebas/prueba.js` ejecuta 41 pruebas sobre `Code.gs` en un entorno simulado
(`pruebas/entorno.js`). Cubren registro, login, bloqueos, sesiones, acceso por curso, progreso, notas,
códigos, cambio y restablecimiento de contraseña, y robustez.

**Límite de estas pruebas:** simulan Apps Script; no reemplazan una prueba real en tu cuenta de Google.
Antes de vender, repite el paso 7 y un registro, login y activación completos desde la página.

## Pendiente (siguiente etapa)

- **Cliente:** la página y `app.js` todavía usan las acciones antiguas (`login` con usuario, `registro`
  con código, `guardar_progreso`, etc.). Hay que reescribirlos contra este contrato.
- **Migración:** los alumnos de la versión anterior deben recrearse o importarse. Hoy no hay script de migración.
- **Rendimiento:** cada acción lee las hojas completas. Con miles de alumnos conviene pasar a una base de datos.
