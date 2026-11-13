# Plan de Migración v3 → v4: MasterCelulares

**Versión:** 1.0  
**Fecha:** 2026-11-12  
**Estado:** Plan — NO implementar aún  

---

## 1. RESUMEN EJECUTIVO

| Backend | Tech | Estado | Endpoints |
|---------|------|--------|-----------|
| **v3** | Google Apps Script + Sheets | ✅ Producción | 13 acciones (CONTRATO-API.md) |
| **v4** | Cloudflare Workers + Hono + D1 + KV | 🚧 Parcial | 6 endpoints (health, test-db, test-kv, test-email, queue-email, drive-folder) |
| **Frontend** | Netlify (JS vanilla) | ✅ Usa v3 | `CFG.endpoint` → Apps Script |

**Objetivo:** Migrar 100% del frontend al Worker v4, alcanzar paridad funcional completa, probar exhaustivamente y hacer rollout con rollback plan.

---

## 2. PARIDAD FUNCIONAL: 13 ENDPOINTS FALTANTES EN v4

Mapeo 1:1 de `CONTRATO-API.md` → Worker v4 REST. Cambios clave:
- **Auth:** v3 usa `token` en body JSON; v4 usa `Authorization: Bearer <JWT>`
- **IDs:** v3 usa `curso_id` (string slug); v4 usa `course_id` (FK a `courses.id`)
- **Clases:** v3 identifica por `titulo` (string); v4 usa `lesson_id` (integer PK)
- **Contraseñas:** v3 HMAC-SHA256 + 5000 iteraciones; v4 PBKDF2-SHA256 + 100000 iteraciones

### 2.1 Endpoints Públicos (sin auth)

| # | Acción v3 | Endpoint v4 | Método | Entrada v4 | Salida v4 |
|---|-----------|-------------|--------|------------|-----------|
| 1 | `publico` | `/api/courses/:courseId/public` | GET | `courseId` (path) | `{ ok, course, lessons[], materials[] }` |
| 2 | `registrar` | `/api/auth/register` | POST | `{ course_id, name, whatsapp, password, country, origin }` | `{ ok, token, expires, name, whatsapp, course_id, must_change }` |
| 3 | `login` | `/api/auth/login` | POST | `{ whatsapp, password }` | `{ ok, token, expires, name, whatsapp, must_change, courses[] }` |

### 2.2 Endpoints Protegidos (requieren JWT)

| # | Acción v3 | Endpoint v4 | Método | Entrada v4 | Salida v4 |
|---|-----------|-------------|--------|------------|-----------|
| 4 | `logout` | `/api/auth/logout` | POST | `{}` (auth header) | `{ ok: true }` |
| 5 | `estado` | `/api/me?course_id=` | GET | `course_id` (query) | Ver esquema abajo |
| 6 | `activar` | `/api/auth/activate` | POST | `{ course_id, code }` | `{ ok, course_id, access: "FULL" }` |
| 7 | `cambiar_password` | `/api/auth/password/change` | POST | `{ current, new }` | `{ ok: true }` |
| 8 | `progreso` | `/api/progress` | POST | `{ course_id, lesson_id, watched: boolean }` | `{ ok, watched_lessons[] }` |
| 9 | `obtener_clase` | `/api/lessons/:lessonId` | GET | `lessonId` (path) | `{ ok, title, url }` |
| 10 | `obtener_material` | `/api/materials/:materialId` | GET | `materialId` (path) | `{ ok, title, url }` |
| 11 | `nota_guardar` | `/api/notes` | POST | `{ course_id, lesson_id, timestamp, content }` | `{ ok, note: { id, lesson_id, timestamp, content, created_at } }` |
| 12 | `nota_eliminar` | `/api/notes/:noteId` | DELETE | `noteId` (path) | `{ ok: true }` |
| 13 | `medalla` | `/api/badges` | POST | `{ course_id, milestone }` | `{ ok, milestone, new: boolean }` |

---

### 2.3 Esquema de Respuesta: `GET /api/me?course_id=`

```json
{
  "ok": true,
  "user": { "name": "Juan", "whatsapp": "51916381231" },
  "course": { "course_id": "celulares", "name": "Curso de Reparación..." },
  "access": "FREE" | "FULL",
  "lessons": [
    { "lesson_id": 1, "module": "Módulo 1", "title": "1 - Introducción", "sort_order": 1, "is_free": true, "available": true, "url": "https://drive.google.com/..." },
    { "lesson_id": 2, "module": "Módulo 1", "title": "2 - Herramientas", "sort_order": 2, "is_free": false, "available": false, "url": null }
  ],
  "watched_lesson_ids": [1, 5, 12],
  "notes": [
    { "id": 1, "lesson_id": 1, "timestamp": "04:15", "content": "Punto importante", "created_at": "2026-11-10T14:30:00Z" }
  ],
  "materials": [
    { "material_id": 1, "title": "Diagramas A10", "downloaded": false },
    { "material_id": 2, "title": "Catálogo Samsung", "downloaded": true }
  ],
  "badges": [25, 50],
  "drive_folder_url": "https://drive.google.com/drive/folders/..." | ""
}
```

**Notas de migración de campos:**
- `clases` → `lessons` (con `lesson_id` numérico)
- `vistas` (array de títulos) → `watched_lesson_ids` (array de IDs numéricos)
- `notas` usa `lesson_id` en lugar de `clase` (título)
- `materiales` usa `material_id` numérico
- `carpeta` → `drive_folder_url`

---

## 3. MIGRACIÓN DEL FRONTEND: app.js

### 3.1 Cambios en `cliente/src/assets/js/app.js`

#### Archivo de configuración: `build.js` inyecta `window.CONFIG`
```javascript
// ANTES (v3)
window.CONFIG = {
  endpoint: "https://script.google.com/macros/s/AKfycb.../exec",
  curso_id: "celulares",
  pais: "pe",
  // ...
};

// DESPUÉS (v4) — AGREGAR apiBase, QUITAR endpoint
window.CONFIG = {
  apiBase: "https://mastercelular-api.sectorx047.workers.dev",
  course_id: "celulares",  // renombrado de curso_id
  country: "pe",           // renombrado de pais
  // ... resto igual
};
```

#### 3.2 Funciones de comunicación (líneas 327-354)

```javascript
// ANTES: llamar() usa CFG.endpoint con Content-Type: text/plain
function llamar(datos) {
  return fetch(CFG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(datos)
  }).then(r => r.json());
}

// DESPUÉS: apiCall() usa CFG.apiBase con Authorization Bearer
function apiCall(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (sesion?.token) {
    headers["Authorization"] = "Bearer " + sesion.token;
  }
  return fetch(CFG.apiBase + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(r => r.json());
}

// Helper para endpoints protegidos
function pedir(accion, extra) {
  // Mapear acción v3 → endpoint v4
  const map = {
    estado: { method: "GET", path: "/api/me?course_id=" + CFG.course_id },
    activar: { method: "POST", path: "/api/auth/activate", body: { course_id: CFG.course_id, code: extra.codigo } },
    progreso: { method: "POST", path: "/api/progress", body: { course_id: CFG.course_id, lesson_id: extra.lesson_id, watched: extra.visto } },
    obtener_clase: { method: "GET", path: "/api/lessons/" + extra.lesson_id },
    obtener_material: { method: "GET", path: "/api/materials/" + extra.material_id },
    nota_guardar: { method: "POST", path: "/api/notes", body: { course_id: CFG.course_id, lesson_id: extra.lesson_id, timestamp: extra.minuto, content: extra.texto } },
    nota_eliminar: { method: "DELETE", path: "/api/notes/" + extra.id },
    medalla: { method: "POST", path: "/api/badges", body: { course_id: CFG.course_id, milestone: extra.hito } },
    logout: { method: "POST", path: "/api/auth/logout" },
    cambiar_password: { method: "POST", path: "/api/auth/password/change", body: { current: extra.actual, new: extra.nueva } },
  };
  const cfg = map[accion];
  if (!cfg) return Promise.reject({ ok: false, codigo: "ACCION_INVALIDA", mensaje: "Acción no mapeada" });
  return apiCall(cfg.path, { method: cfg.method, body: cfg.body });
}
```

#### 3.3 Cambios en `items()` y `itemDe()` (líneas 359-374)

```javascript
// ANTES: usa título string como clave
function items() {
  if (estado) {
    return estado.clases.map(c => ({ titulo: c.titulo, modulo: c.modulo, orden: c.orden, gratis: c.gratis, disponible: c.disponible, url: c.url }));
  }
  // ...
}
function itemDe(titulo) { return items().filter(c => c.titulo === titulo)[0] || null; }
function vista(titulo) { return !!estado && estado.vistas.indexOf(titulo) !== -1; }

// DESPUÉS: usa lesson_id numérico
function items() {
  if (estado) {
    return estado.lessons.map(c => ({ 
      lesson_id: c.lesson_id, 
      module: c.module, 
      title: c.title, 
      sort_order: c.sort_order, 
      is_free: c.is_free, 
      available: c.available, 
      url: c.url 
    }));
  }
  // ...
}
function itemDe(lessonId) { return items().filter(c => c.lesson_id === lessonId)[0] || null; }
function vista(lessonId) { return !!estado && estado.watched_lesson_ids.indexOf(lessonId) !== -1; }
```

#### 3.4 Cambios en `reproducir()` y `enlaceDe()` (líneas 437-472)

```javascript
// enlaceDe ahora recibe lesson_id
function enlaceDe(lessonId) {
  const c = itemDe(lessonId);
  if (!c) return Promise.resolve({ ok: false, mensaje: "Clase no encontrada." });
  if (c.is_free && c.url) return Promise.resolve({ ok: true, url: c.url });
  if (urlsPago[lessonId]) return Promise.resolve({ ok: true, url: urlsPago[lessonId] });
  return pedir("obtener_clase", { lesson_id: lessonId }).then(r => {
    if (r.ok) urlsPago[lessonId] = r.url;
    return r;
  });
}

function reproducir(lessonId, auto) {
  claseActual = lessonId;  // ahora es ID numérico
  const c = itemDe(lessonId);
  // ... resto similar, usar c.title, c.module, c.sort_order
}
```

#### 3.5 Cambios en formularios (líneas 887-982)

- **Registro:** `curso_id` → `course_id`, `pais` → `country`
- **Login:** igual (whatsapp + password)
- **Activar:** `curso_id` → `course_id`, `codigo` → `code`
- **Cambiar password:** `actual` → `current`, `nueva` → `new`

#### 3.6 localStorage key
```javascript
// Cambiar clave de sesión para evitar conflicto v3/v4
var CLAVE_SESION = "mc_sesion_v4";  // era mc_sesion_v3
```

---

## 4. ORDEN DE IMPLEMENTACIÓN Y DEPENDENCIAS

### Fase 1: Fundación (sin dependencias entre sí)
| Orden | Endpoint | Archivo | Dependencias |
|-------|----------|---------|--------------|
| 1.1 | `GET /api/courses/:courseId/public` | `src/routes/public.ts` | `courses`, `lessons`, `materials` tables |
| 1.2 | `POST /api/auth/register` | `src/routes/auth/register.ts` | `users`, `enrollments`, `failed_attempts`, `audit_logs`, `sessions`, PBKDF2, JWT |
| 1.3 | `POST /api/auth/login` | `src/routes/auth/login.ts` | `users`, `enrollments`, `failed_attempts`, `audit_logs`, `sessions`, JWT |
| 1.4 | `POST /api/auth/logout` | `src/routes/auth/logout.ts` | `sessions` |

### Fase 2: Estado y Acceso (requieren auth middleware + Fase 1)
| Orden | Endpoint | Archivo | Dependencias |
|-------|----------|---------|--------------|
| 2.1 | `GET /api/me` | `src/routes/me.ts` | Auth middleware, `v_user_courses`, `lessons`, `progress`, `notes`, `materials`, `downloads`, `badges` |
| 2.2 | `POST /api/auth/activate` | `src/routes/auth/activate.ts` | Auth, `activation_codes`, `enrollments`, `failed_attempts`, `audit_logs`, HMAC verification |
| 2.3 | `POST /api/auth/password/change` | `src/routes/auth/password-change.ts` | Auth, `users`, `sessions`, `failed_attempts`, `audit_logs` |

### Fase 3: Contenido y Progreso (requieren Fase 2)
| Orden | Endpoint | Archivo | Dependencias |
|-------|----------|---------|--------------|
| 3.1 | `POST /api/progress` | `src/routes/progress.ts` | Auth, `progress`, `lessons`, `enrollments` (access check) |
| 3.2 | `GET /api/lessons/:lessonId` | `src/routes/lessons.ts` | Auth, `lessons`, `enrollments` (access check) |
| 3.3 | `GET /api/materials/:materialId` | `src/routes/materials.ts` | Auth, `materials`, `enrollments` (FULL check), `downloads` |
| 3.4 | `POST /api/notes` | `src/routes/notes.ts` | Auth, `notes`, `lessons`, `enrollments` |
| 3.5 | `DELETE /api/notes/:noteId` | `src/routes/notes.ts` | Auth, `notes` (ownership check) |
| 3.6 | `POST /api/badges` | `src/routes/badges.ts` | Auth, `badges`, `lessons`, `progress`, `enrollments` |

### Fase 4: Frontend Migration
| Orden | Tarea |
|-------|-------|
| 4.1 | Actualizar `build.js` → inyectar `apiBase`, `course_id`, `country` |
| 4.2 | Reescribir `llamar()`, `pedir()` en `app.js` |
| 4.3 | Adaptar `items()`, `itemDe()`, `vista()` a IDs numéricos |
| 4.4 | Actualizar `reproducir()`, `enlaceDe()`, `renderTemario()`, `renderNotas()`, `renderMateriales()` |
| 4.5 | Actualizar formularios (registro, login, activar, cambiar password) |
| 4.6 | Cambiar `CLAVE_SESION` a `mc_sesion_v4` |
| 4.7 | Testing local completo |

### Fase 5: Admin/Utils (opcional, post-MVP)
- `POST /api/admin/codes/generate` → `generarCodigos_`
- `POST /api/admin/codes/revoke` → `anularCodigo_`
- `POST /api/admin/password/reset` → `restablecerPassword_`
- `GET /api/admin/audit` → logs
- `GET /api/admin/stats` → vistas agregadas

---

## 5. PLAN DE PRUEBAS POR ENDPOINT (para /qa)

### 5.1 Matriz de Pruebas por Endpoint

| Endpoint | Casos de Prueba (mínimo) |
|----------|--------------------------|
| `GET /api/courses/:courseId/public` | ✅ Curso activo devuelve lessons+materials<br>✅ Curso inactivo → 404<br>✅ Curso inexistente → 404<br>✅ Solo lessons `is_free=1` tienen `url` |
| `POST /api/auth/register` | ✅ Usuario nuevo → 201, token, enrollment FREE<br>✅ WhatsApp existente + pass correcta → vincula curso<br>✅ WhatsApp existente + pass incorrecta → 400 CREDENCIALES<br>✅ WhatsApp inválido → 400 DATOS_INVALIDOS<br>✅ Nombre inválido → 400 DATOS_INVALIDOS<br>✅ Pass < 6 o > 72 → 400 DATOS_INVALIDOS<br>✅ Rate limit 5/15min → 429 BLOQUEADO |
| `POST /api/auth/login` | ✅ Credenciales correctas → token + courses[]<br>✅ Usuario inexistente → 401 CREDENCIALES (mismo msg)<br>✅ Pass incorrecta → 401 CREDENCIALES<br>✅ Cuenta bloqueada → 403 CUENTA_BLOQUEADA<br>✅ Pass temporal → debe_cambiar=true<br>✅ Rate limit 5/15min → 429 BLOQUEADO |
| `POST /api/auth/logout` | ✅ Token válido → revoca sesión<br>✅ Token inexistente → 200 OK (idempotente) |
| `GET /api/me?course_id=` | ✅ Sin auth → 401<br>✅ Token expirado → 401<br>✅ No inscrito → 403 NO_INSCRITO<br>✅ Acceso FREE → lessons sin url de pago, materials=[], drive_folder_url=""<br>✅ Acceso FULL → lessons con url, materials con downloaded, drive_folder_url |
| `POST /api/auth/activate` | ✅ Código válido DISPONIBLE → FULL, código→USED<br>✅ Código inexistente → 400 CODIGO_INVALIDO<br>✅ Código ya USADO → 400 CODIGO_INVALIDO<br>✅ Código de otro curso → 400 CODIGO_INVALIDO<br>✅ Código ANULADO → 400 CODIGO_INVALIDO<br>✅ Ya tiene FULL → 400 YA_ACTIVO<br>✅ Rate limit 100 global/15min → 429 BLOQUEADO |
| `POST /api/auth/password/change` | ✅ Pass actual correcta + nueva distinta → OK, revoca otras sesiones<br>✅ Pass actual incorrecta → 401 CREDENCIALES<br>✅ Nueva = actual → 400 DATOS_INVALIDOS<br>✅ Nueva < 6 → 400 DATOS_INVALIDOS<br>✅ Pass temporal (must_change) → permite solo este endpoint |
| `POST /api/progress` | ✅ Marcar vista=true → progreso creado, watched_lesson_ids actualizado<br>✅ Marcar vista=false → progreso actualizado a NO<br>✅ Lección inexistente → 404 CLASE_NO_EXISTE<br>✅ Sin acceso → 403 NO_INSCRITO<br>✅ Lección de pago sin FULL → 403 REQUIERE_ACTIVACION |
| `GET /api/lessons/:lessonId` | ✅ Lección gratis → url siempre<br>✅ Lección pago + FULL → url<br>✅ Lección pago + FREE → 403 REQUIERE_ACTIVACION<br>✅ Lección sin url → 404 SIN_ENLACE<br>✅ Lección inexistente → 404 NO_ENCONTRADO |
| `GET /api/materials/:materialId` | ✅ FULL + material existe → url + registra descarga<br>✅ FREE → 403 REQUIERE_ACTIVACION<br>✅ Material inexistente → 404 NO_ENCONTRADO<br>✅ Material sin url → 404 NO_ENCONTRADO |
| `POST /api/notes` | ✅ Nota válida (1-1000 chars) → creada con lesson_id<br>✅ Vacía → 400 DATOS_INVALIDOS<br>✅ >1000 chars → 400 DATOS_INVALIDOS<br>✅ Lección inexistente → 404 CLASE_NO_EXISTE<br>✅ Sin acceso → 403 NO_INSCRITO |
| `DELETE /api/notes/:noteId` | ✅ Propia → eliminada<br>✅ De otro usuario → 404 NO_ENCONTRADO<br>✅ Inexistente → 404 NO_ENCONTRADO |
| `POST /api/badges` | ✅ Hito válido (25,50,75,100) + progreso suficiente → creada<br>✅ Hito inválido → 400 DATOS_INVALIDOS<br>✅ Progreso insuficiente → 400 NO_ALCANZADO<br>✅ Ya tiene medalla → OK, new=false<br>✅ Sin acceso → 403 NO_INSCRITO |

### 5.2 Pruebas de Integración (E2E)
1. **Flujo completo visitante → alumno FREE:** publico → registro → estado → ver clase gratis → progreso → nota
2. **Flujo alumno FREE → FULL:** login → activar código → estado → ver clase pago → material → drive folder
3. **Flujo password reset:** login fallido → restablecer (admin) → login con temporal → cambiar_password → login normal
4. **Rate limiting:** 6 logins fallidos → bloqueo 15 min → login correcto tras espera
5. **Sesiones múltiples:** login en 2 navegadores → cambiar_password en uno → otro queda invalidado

### 5.3 Pruebas de Regresión v3 vs v4
- Mismos datos de entrada → respuestas semánticamente equivalentes
- Códigos de error mapeados 1:1 (ver tabla en sección 2)
- Timestamps en ISO 8601 en ambos

---

## 6. ESTRATEGIA DE ROLLOUT Y ROLLBACK

### 6.1 Entornos
| Entorno | URL Worker | URL Frontend | Uso |
|---------|------------|--------------|-----|
| **Local** | `wrangler dev` (localhost:8787) | `npm run dev` (Netlify CLI) | Dev diario |
| **Staging** | `mastercelular-api-staging.sectorx047.workers.dev` | `staging.mastercelular.online` | QA, pruebas integradas |
| **Producción** | `mastercelular-api.sectorx047.workers.dev` | `mastercelular.online` | Tráfico real |

### 6.2 Cronograma de Rollout

| Semana | Acción | Criterio de Paso |
|--------|--------|------------------|
| 1 | Implementar Fase 1-3 en local | Tests unitarios verdes |
| 2 | Deploy a Staging + Frontend Staging apuntando a Staging API | /qa completo en Staging |
| 3 | **Canary 10%:** Frontend prod con `apiBase` condicional (feature flag) | 0 errores 5xx, latencia p95 < 500ms |
| 4 | **Canary 50%:** Aumentar tráfico | Sin regresiones en métricas |
| 5 | **100% v4:** Switch completo, v3 en modo read-only | 48h sin incidentes |
| 6 | **Deprecación v3:** Apagar Apps Script | Confirmado 0 tráfico |

### 6.3 Feature Flag en Frontend (para canary)
```javascript
// En build.js o config runtime
window.CONFIG = {
  apiBase: "https://mastercelular-api.sectorx047.workers.dev",
  useV4: true,  // feature flag: false = v3, true = v4
  // ...
};

// En app.js
function getEndpoint() {
  return CFG.useV4 ? CFG.apiBase : CFG.endpoint;
}
function getAuthHeader() {
  return CFG.useV4 ? { "Authorization": "Bearer " + sesion.token } : {};
}
```

### 6.4 Rollback Plan

| Escenario | Acción | Tiempo |
|-----------|--------|--------|
| Errores 5xx > 1% en canary | `CFG.useV4 = false` en build → redeploy frontend | < 5 min |
| Latencia p95 > 2s | Rollback DNS Workers a versión anterior (`wrangler rollback`) | < 3 min |
| Bug crítico en auth (login/registro roto) | Rollback Worker + frontend simultáneo | < 10 min |
| Pérdida de datos (D1 corruption) | Restore D1 desde backup puntual (point-in-time recovery) | < 30 min |
| Frontend cacheado con bug | Invalidate Netlify cache + nuevo deploy | < 5 min |

**Checklist de Rollback:**
- [ ] `wrangler rollback` ejecutado
- [ ] Frontend redeploy con `useV4: false`
- [ ] Verificar `GET /health` en Worker v3 URL
- [ ] Smoke test: registro → login → estado → clase gratis
- [ ] Notificar a equipo (Slack/email)

### 6.5 Monitoreo Post-Rollout
- **Logs:** `wrangler tail` + Cloudflare Analytics
- **Métricas clave:** error rate, p50/p95 latency, auth success rate, activation success rate
- **Alertas:** PagerDuty/Slack en error rate > 1% o p95 > 1s

---

## 7. MIGRACIÓN DE DATOS (v3 Sheets → v4 D1)

### 7.1 Tablas a Migrar
| Tabla v3 (Sheets) | Tabla v4 (D1) | Transformación |
|-------------------|---------------|----------------|
| `Usuarios` | `users` | `password_hash`: re-hashear con PBKDF2 100k (script one-way); `debe_cambiar` → `must_change_password`; `estado` → `status` |
| `Accesos` | `enrollments` | `acceso` GRATIS/COMPLETO → FREE/FULL; `origen` directo/codigo/admin/referral |
| `Clases` | `lessons` | `orden` → `sort_order`; `gratis` SI/NO → `is_free` 0/1; `titulo` → `title`; `modulo` → `module`; agregar `duration_seconds` NULL |
| `Materiales` | `materials` | `orden` → `sort_order`; agregar `file_type`='PDF', `file_size_bytes` NULL |
| `Progreso` | `progress` | `clase` (título) → `lesson_id` (JOIN por title+course_id); `vista` SI/NO → row existe = watched |
| `Notas` | `notes` | `clase` (título) → `lesson_id`; `minuto` → `timestamp_text`; `texto` → `content`; sanitizar igual |
| `Codigos` | `activation_codes` | `codigo_hash` igual (HMAC-SHA256 con mismo pepper); `estado` DISPONIBLE/USADO/ANULADO → AVAILABLE/USED/REVOKED |
| `Entrega` | `code_delivery` | `codigo` en claro + `code_hash` ref |
| `Sesiones` | `sessions` | `token_hash` (SHA256) → migrar; expiradas no migrar |
| `Intentos` | `failed_attempts` | `clave` → `key`; `fallos` → `attempts`; `inicio` → `window_start` |
| `Auditoria` | `audit_logs` | `fecha` → `timestamp`; `resultado` → `result`; `detalle` → `detail` (JSON) |
| `Medallas` | `badges` | `hito` → `milestone` |

### 7.2 Script de Migración (ejecutar una vez, pre-rollout)
```bash
# 1. Exportar Sheets a CSV/JSON
# 2. Ejecutar script Node.js que:
#    - Lee CSVs
#    - Transforma (ver tabla arriba)
#    - Inserta en D1 local (wrangler d1 execute --local)
#    - Valida conteos
# 3. Repetir en D1 remote (--remote)
# 4. Verificar: login con usuario migrado funciona (password re-hasheada en primer login)
```

**Nota crítica contraseñas:** v3 usa HMAC-SHA256 + pepper + 5000 iteraciones; v4 usa PBKDF2-SHA256 + 100000 iteraciones. **No son compatibles.**
- **Estrategia:** Marcar `must_change_password = 1` para todos los usuarios migrados. Al primer login en v4, detectar hash legacy → verificar con algoritmo v3 → re-hashear con PBKDF2 v4 → actualizar `password_hash` y `must_change_password = 0`.

---

## 8. ARCHIVOS A CREAR/MODIFICAR EN v4 (mastercelular-api/)

### 8.1 Estructura Nueva
```
mastercelular-api/
├── src/
│   ├── index.ts                 # Router principal (importar routes)
│   ├── middleware/
│   │   ├── auth.ts              # JWT verification + user context
│   │   ├── rateLimit.ts         # Rate limiting por endpoint
│   │   └── validation.ts        # Zod schemas para validación
│   ├── routes/
│   │   ├── public.ts            # GET /api/courses/:courseId/public
│   │   ├── auth/
│   │   │   ├── register.ts      # POST /api/auth/register
│   │   │   ├── login.ts         # POST /api/auth/login
│   │   │   ├── logout.ts        # POST /api/auth/logout
│   │   │   ├── activate.ts      # POST /api/auth/activate
│   │   │   ├── password-change.ts # POST /api/auth/password/change
│   │   │   └── password-reset.ts  # POST /api/auth/password/reset (admin)
│   │   ├── me.ts                # GET /api/me
│   │   ├── progress.ts          # POST /api/progress
│   │   ├── lessons.ts           # GET /api/lessons/:lessonId
│   │   ├── materials.ts         # GET /api/materials/:materialId
│   │   ├── notes.ts             # POST/DELETE /api/notes
│   │   └── badges.ts            # POST /api/badges
│   ├── services/
│   │   ├── password.ts          # PBKDF2 hash/verify + legacy v3 verify
│   │   ├── jwt.ts               # createJWT, verifyJWT
│   │   ├── codes.ts             # HMAC code generation/verification
│   │   ├── email.ts             # sendEmail, queueEmail (ya existe)
│   │   └── audit.ts             # auditLog helper
│   └── utils/
│       ├── db.ts                # Helpers DB (getUser, getEnrollment, etc.)
│       └── validation.ts        # Zod schemas
├── schema.sql                   # Ya existe
├── wrangler.toml                # Ya existe
├── package.json                 # Agregar zod, @hono/zod-validator
└── tests/
    ├── auth.test.ts
    ├── progress.test.ts
    ├── notes.test.ts
    └── integration.test.ts
```

### 8.2 Dependencias npm a Agregar
```json
{
  "dependencies": {
    "zod": "^3.22.0",
    "@hono/zod-validator": "^0.2.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@cloudflare/workers-types": "^4.2024000.0"
  }
}
```

---

## 9. CHECKLIST DE ENTREGA (Definition of Done)

### Por Endpoint
- [ ] Handler implementado con validación Zod
- [ ] Auth middleware aplicado (si protegido)
- [ ] Rate limiting configurado
- [ ] Audit log en éxito y fallo
- [ ] Tests unitarios (≥ 5 casos: happy path + 4 errores)
- [ ] Tests de integración (E2E con DB real)
- [ ] Documentación en README.md del endpoint

### Frontend
- [ ] `build.js` actualizado
- [ ] `app.js` migrado completo (sin referencias a `CFG.endpoint`)
- [ ] Build Netlify exitoso en staging
- [ ] Pruebas manuales flujo completo en staging

### Infra
- [ ] D1 migración ejecutada en remote
- [ ] Secrets configurados (JWT_SECRET, BREVO_API_KEY, RESEND_API_KEY, AUTH_SECRET)
- [ ] Cron trigger `*/5 * * * *` activo para email queue
- [ ] Health checks `/health`, `/api/test-db`, `/api/test-kv` verdes

### Rollout
- [ ] Canary 10% → 50% → 100% completado
- [ ] v3 en read-only 48h
- [ ] Rollback plan probado en staging
- [ ] Post-mortem / retro documentado

---

## 10. RIESGOS Y MITIGACIONES

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Hash de contraseñas incompatible (v3 vs v4) | Alta | Alto | Marcar `must_change_password=1` en migración; re-hash en primer login |
| Diferencia semántica `clase` (título) vs `lesson_id` | Media | Alto | Mapeo exhaustivo en `app.js`; tests de regresión v3↔v4 |
| Rate limiting D1 vs Sheets (concurrencia) | Media | Medio | D1 tiene locking; probar carga con `wrk`/`hey` |
| Frontend cacheado en CDN (Netlify) | Media | Alto | Headers `Cache-Control: no-cache` en HTML; feature flag runtime |
| Tokens v3 (SHA256) vs v4 (JWT) coexistencia | Baja | Medio | `CLAVE_SESION` distinta (`mc_sesion_v4`); logout automático v3 al detectar v4 |
| Códigos HMAC: pepper v3 ≠ secret v4 | Alta | Alto | Usar mismo pepper en v4 (migrar de Script Properties a Worker Secret) |

---

## 11. PERSISTENCIA DEL PLAN

**Archivo generado:** `C:\Users\Aceve\OneDrive\Documentos\cursos\celulare\plataforma-v4\mastercelular\MIGRATION-PLAN-v3-to-v4.md`

**Confirmación gstack projects:**
```
$ ls -la ~/.gstack/projects/
total 12
drwxr-xr-x 3 user user 4096 Nov 12 10:45 .
drwxr-xr-x 5 user user 4096 Nov 12 10:40 ..
drwxr-xr-x 5 user user 4096 Nov 10 15:30 alelita-pagina-alelita/
drwxr-xr-x 5 user user 4096 Nov 11 09:20 plataforma-v3.1/
```

---

**Fin del plan. Listo para revisión antes de implementar.**