# Guía de Despliegue - MasterCelulares API

> **Objetivo:** Desplegar el backend (Cloudflare Worker) y conectar el frontend (Cloudflare Pages) desde cero con CI/CD completo, tests, linting y seguridad.
> **Nivel:** Principiante — cada paso incluye comandos exactos y capturas de qué esperar.

---

## 📋 Requisitos Previos

### 1. Instalar Node.js (versión LTS)
```bash
# Windows (PowerShell como Administrador)
winget install OpenJS.NodeJS.LTS

# O descarga el instalador desde: https://nodejs.org/
# Verifica:
node --version    # Debe mostrar v20.x.x o superior
npm --version     # Debe mostrar 10.x.x o superior
```

### 2. Instalar Wrangler CLI (herramienta oficial de Cloudflare)
```bash
npm install -g wrangler@latest

# Verifica:
wrangler --version   # Debe mostrar 4.x.x (v4+)
```

### 3. Cuenta Cloudflare
- Crea cuenta en: https://dash.cloudflare.com/sign-up
- Ten a mano tu **Account ID** (en la barra lateral derecha del dashboard)

### 4. Repositorio GitHub
- Repo: `sectorx047-celulares/mastercelular` (o tu fork)
- Rama principal: `main`

---

## 🔐 Paso 1: Autenticación en Cloudflare

```bash
# En la carpeta del proyecto (mastercelular-api)
cd mastercelular-api

# Inicia sesión - abrirá el navegador para autorizar
npx wrangler login
```

**Qué verás:**
```
💁  Allow Wrangler to open a page in your browser? [y/n] 
```
→ Presiona **`y`** + **Enter**

Se abrirá el navegador → Inicia sesión en Cloudflare → Autoriza la aplicación → Vuelve a la terminal.

**Confirmación exitosa:**
```
✅  Successfully logged in!
You can now use wrangler to deploy to Cloudflare.
```

---

## ⚙️ Paso 2: Configurar `wrangler.toml` con tus IDs reales

### Obtener los IDs de tu infraestructura

```bash
# 1. Listar bases de datos D1
npx wrangler d1 list

# Busca "mastercelular-db" y copia el `database_id` (ej: abc123-def456-...)
```

```bash
# 2. Listar KV Namespaces
npx wrangler kv namespace list

# Busca "CACHE_MASTER" y copia el `id` (ej: xyz789-...)
# Si hay preview_id, cópialo también
```

### Editar `wrangler.toml`

Abre `wrangler.toml` y reemplaza los placeholders:

```toml
# ANTES (placeholders):
database_id = "TU_D1_DATABASE_ID_AQUI"
id = "TU_KV_NAMESPACE_ID_AQUI"
preview_id = "TU_KV_PREVIEW_ID_AQUI"

# DESPUÉS (tus valores reales):
database_id = "abc123-def456-ghi789-jkl012"
id = "xyz789-uvw456-rst123"
preview_id = "preview-xyz789-..."   # Opcional
```

> ⚠️ **NO pongas secrets (API keys, JWT_SECRET) en este archivo.** Esos van en el siguiente paso.

---

## 🔑 Paso 3: Subir Secrets (Variables Sensibles) a Cloudflare

Los secrets se almacenan **encriptados** en Cloudflare y **nunca** se ven en el código ni en `wrangler.toml`.

```bash
# 1. Brevo API Key (primario para emails)
npx wrangler secret put BREVO_API_KEY
# Te pedirá el valor: pega tu Brevo API Key (empieza con xkeysib-...)

# 2. Resend API Key (fallback para emails)
npx wrangler secret put RESEND_API_KEY
# Pega tu Resend API Key (empieza con re_...)

# 3. JWT Secret (para firmar tokens de sesión - genera uno seguro)
npx wrangler secret put JWT_SECRET
# Genera uno: openssl rand -base64 32  (o usa https://generate-secret.vercel.app/32)

# 4. Auth Secret (para firmas HMAC internas)
npx wrangler secret put AUTH_SECRET
# Genera otro diferente: openssl rand -base64 32
```

**Verificar que se subieron:**
```bash
npx wrangler secret list
```
Deberías ver:
```
BREVO_API_KEY
RESEND_API_KEY
JWT_SECRET
AUTH_SECRET
```

> 💡 **Tip PowerShell:** `openssl` no viene por defecto. Usa: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))` o genera en https://generate-secret.vercel.app/32

---

## 🔐 Paso 3.5: Configurar GitHub Secrets (Para CI/CD)

> **CRÍTICO:** Sin estos secrets, **los workflows de GitHub Actions fallarán**.

En GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Secret | Valor | Dónde obtenerlo |
|--------|-------|-----------------|
| `CLOUDFLARE_ACCOUNT_ID` | Tu Account ID de Cloudflare | Dashboard Cloudflare (barra lateral derecha) |
| `CLOUDFLARE_API_TOKEN` | API Token con permisos: Workers, D1, KV, Pages | Dashboard → My Profile → API Tokens → Create Token |

**Permisos mínimos para el API Token:**
- Account: Workers Scripts (Edit), Workers KV Storage (Edit), D1 (Edit), Pages (Edit)
- Zone: DNS (Read) - si usas dominios personalizados

---

## 📁 Paso 4: Configurar Carpeta de Google Drive del Curso (IMPORTANTE)

**La tabla `courses` tiene una columna `drive_folder_url` que debe contener el enlace a la carpeta de Google Drive con todos los materiales del curso.**

### Verificar/Actualizar la URL de Drive

La migración inicial (`schema.sql`) ya incluye la URL para el curso de celulares:
```
https://drive.google.com/drive/folders/1Anh-5NARPPzEtpKU72TBGa00Ri12rzhd
```

### Si necesitas cambiarla o agregar otro curso:

```bash
# 1. Verificar URLs actuales
npx wrangler d1 execute mastercelular-db --remote --command "SELECT id, name, drive_folder_url FROM courses;"

# 2. Actualizar URL de un curso específico
npx wrangler d1 execute mastercelular-db --remote --command "
  UPDATE courses 
  SET drive_folder_url = 'https://drive.google.com/drive/folders/TU_NUEVA_CARPETA_ID' 
  WHERE id = 'celulares';
"
```

> ⚠️ **Importante:** La carpeta de Drive debe ser **accesible para cualquiera con el enlace** (Configuración de Drive → Compartir → "Cualquiera con el enlace" → "Visualizador"). Los alumnos podrán copiarla a su Drive o descargarla completa.

---

## 🗄️ Paso 5: Ejecutar Migraciones D1 (Crear Tablas)

### Opción A: Desarrollo local (usa base de datos local `.wrangler/state/d1/...`)
```bash
npx wrangler d1 execute mastercelular-db --local --file=./schema.sql
```

### Opción B: **Producción** (usa la base de datos real en Cloudflare) ⭐ **USA ESTA**
```bash
npx wrangler d1 execute mastercelular-db --remote --file=./schema.sql
```

**Qué verás (éxito):**
```
🚀  Executing on mastercelular-db (remote)...
✅  Success! 47 statements executed.
```

### Verificar tablas creadas
```bash
npx wrangler d1 execute mastercelular-db --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Deberías ver: `activation_codes`, `app_config`, `audit_logs`, `badges`, `code_delivery`, `courses`, `downloads`, `email_queue`, `enrollments`, `failed_attempts`, `lessons`, `materials`, `notes`, `progress`, `sessions`, `users` (+ vistas e índices).

---

## ✅ Paso 5.5: Verificar Calidad Local (Antes de Deploy)

Ejecuta estos comandos **localmente** para asegurar que todo pasa antes de hacer push:

```bash
cd mastercelular-api

# 1. Instalar dependencias
npm ci

# 2. TypeScript type check
npx tsc --noEmit

# 3. Linting (ESLint)
npm run lint

# 4. Tests unitarios con cobertura
npm test

# 5. Security audit (solo high/critical)
npm audit --audit-level=high

# 6. Build TypeScript
npm run build
```

**Todos deben pasar en verde ✅** antes de hacer commit/push.

---

## 🚀 Paso 6: Desplegar el Worker (Backend)

### Opción A: Deploy Manual (para probar rápido)
```bash
# Despliega a producción
npx wrangler deploy
```

**Qué verás (éxito):**
```
✨  Built successfully!
📦  Uploading...
🌍  Deployed to https://mastercelular-api.<tu-subdominio>.workers.dev
🎉  Deployment complete!
```

### Opción B: Deploy Automático via GitHub Actions (Recomendado)

1. Haz commit y push a `main`:
```bash
git add .
git commit -m "feat: ready for production"
git push origin main
```

2. GitHub Actions ejecutará automáticamente:
   - **Quality Gate**: Lint + TypeCheck + Tests + Security Audit
   - **Deploy**: Si todo pasa, despliega a Cloudflare Workers
   - **Version Bump**: Incrementa versión patch + actualiza CHANGELOG.md + crea git tag

**Verifica en:** GitHub → Actions → "Deploy Backend to Cloudflare Workers"

---

## 🧪 Paso 7: Probar Endpoints Básicos (Post-Deploy)

```bash
# Reemplaza <tu-subdominio> por el real de tu cuenta
API_BASE="https://mastercelular-api.<tu-subdominio>.workers.dev"

# Health check
curl $API_BASE/health

# Test DB
curl $API_BASE/api/test-db

# Test KV
curl $API_BASE/api/test-kv
```

### **Probar acceso a carpeta Drive** ⭐
```bash
# 1. Login y obtén el JWT token
TOKEN=$(curl -s -X POST $API_BASE/api/login \
  -H "Content-Type: application/json" \
  -d '{"whatsapp": "51916381231", "password": "tupassword"}' | jq -r '.data.token')

echo "Token: $TOKEN"

# 2. Usa el token para acceder a la carpeta Drive
curl $API_BASE/api/courses/celulares/drive-folder \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "data": {
    "course_name": "Curso de Reparación de Celulares desde Cero",
    "drive_folder_url": "https://drive.google.com/drive/folders/1Anh-5NARPPzEtpKU72TBGa00Ri12rzhd",
    "message": "Acceso concedido. Puedes copiar el enlace o descargar la carpeta completa a tu Drive."
  }
}
```

### **Probar envío de email real** ⭐
```bash
curl -X POST $API_BASE/api/test-email \
  -H "Content-Type: application/json" \
  -d '{"to_email": "tu@email.com", "to_name": "Tu Nombre", "provider": "brevo"}'
```
Deberías recibir el correo de prueba en tu bandeja de entrada (y spam).

---

## 🌐 Paso 8: Desplegar Frontend en Cloudflare Pages

### Opción A: Via Dashboard (Más fácil para principiantes)

1. Ve a: https://dash.cloudflare.com → **Workers & Pages** → **Pages**
2. Click **Create application** → **Connect to Git**
3. Selecciona tu repo GitHub: `sectorx047-celulares/mastercelular`
4. Configuración de build:
   ```
   Build command: node build.js
   Build output directory: dist
   Root directory: /cliente
   ```
5. Variables de entorno (en Pages → Settings → Environment variables):
   ```
   API_URL = https://mastercelular-api.<tu-subdominio>.workers.dev
   FRONTEND_URL = https://mastercelular.online
   ```
6. Click **Save and Deploy**

### Opción B: Via CLI (si ya tienes build local)

```bash
# Desde la carpeta del frontend (cliente/)
cd ../cliente

# Build local
node build.js

# Deploy a Pages (requiere proyecto Pages ya creado en dashboard)
npx wrangler pages deploy dist --project-name=mastercelular-frontend
```

### Opción C: Deploy Automático via GitHub Actions (Recomendado)

El workflow `.github/workflows/deploy-frontend.yml` se ejecuta automáticamente en push a `main`:
- **Quality Gate**: Build verification + HTML validation
- **Deploy**: Despliega a Cloudflare Pages

### Conectar dominio personalizado
1. En Pages → **Custom domains** → **Add custom domain**
2. Escribe: `mastercelular.online`
3. Cloudflare detecta que el DNS está en Cloudflare → **Activate**
4. ¡Listo! Tu frontend está en `https://mastercelular.online`

---

## 🔗 Paso 9: Conectar Frontend ↔ Backend

### Configurar CORS en el Worker (ya está en `index.ts`)
El `wrangler.toml` tiene `FRONTEND_URL = "https://mastercelular.online"` y el código CORS permite ese origen.

### Variables de entorno en Frontend (Cloudflare Pages)
En Pages → Settings → Environment variables:
```
API_URL = https://mastercelular-api.<tu-subdominio>.workers.dev
```

> **Nota:** El `build.js` ya inyecta `apiBase` en `window.CONFIG` automáticamente.

### Probar integración completa
1. Entra a `https://mastercelular.online`
2. Intenta registrarte con un WhatsApp de prueba
3. Revisa logs en: `npx wrangler tail` (verás requests en tiempo real)
4. Verifica panel "Acceso a Carpeta Drive" en área de alumno (tras activar código)

---

## 📦 Resumen de Archivos del Proyecto

```
mastercelular/
├── .github/workflows/
│   ├── deploy-backend.yml      # CI/CD Backend (prod)
│   ├── deploy-frontend.yml     # CI/CD Frontend (prod)
│   ├── preview-backend.yml     # Preview Backend (PRs)
│   └── preview-frontend.yml    # Preview Frontend (PRs)
├── cliente/                    # Frontend (Netlify/Cloudflare Pages)
│   ├── build.js               # Generador estático multi-país
│   ├── src/
│   │   ├── plantilla.html     # Template HTML compartido
│   │   └── assets/
│   │       ├── js/app.js      # Lógica frontend (incluye Drive access)
│   │       └── css/estilos.css
│   ├── paises/                # Config PE/VE (precio, moneda, WhatsApp)
│   ├── cursos/                # Contenido cursos (copy, FAQ, beneficios)
│   └── dist/                  # Output build (generado por build.js)
└── mastercelular-api/         # Backend (Cloudflare Workers)
    ├── wrangler.toml          # Config Worker (editar IDs D1/KV)
    ├── schema.sql             # Esquema D1 completo (47 statements)
    ├── seed.sql               # Datos de prueba (opcional)
    ├── package.json           # Dependencias y scripts
    ├── tsconfig.json          # Config TypeScript
    ├── vitest.config.ts       # Config tests
    ├── eslint.config.js       # Config ESLint
    ├── DEPLOYMENT.md          # ESTA GUÍA
    ├── CHANGELOG.md           # Historial de versiones
    ├── CONTRIBUTING.md        # Guía para contribuidores
    ├── INCIDENT_RESPONSE.md   # Plan de respuesta a incidentes
    ├── GO_NOGO_CHECKLIST.md   # Checklist lanzamiento (51 ítems)
    └── src/
        ├── index.ts           # Código principal (Hono + Email + Auth + Rate Limit)
        └── __tests__/         # Tests unitarios (41 tests)
            ├── setup.ts
            ├── auth.test.ts
            ├── rate-limit.test.ts
            ├── drive-folder.test.ts
            ├── email.test.ts
            └── jwt.test.ts
```

---

## 🛠️ Comandos Útiles Diarios

```bash
# Ver logs en tiempo real
npx wrangler tail

# Ver logs filtrados (solo errores)
npx wrangler tail --format=pretty --status=error

# Redesplegar tras cambios locales
npx wrangler deploy

# Ejecutar migración nueva (cuando agregues tablas)
npx wrangler d1 execute mastercelular-db --remote --file=./nueva_migracion.sql

# Consola SQL interactiva remota
npx wrangler d1 execute mastercelular-db --remote --command "SELECT * FROM users LIMIT 5;"

# Ver/Actualizar URL de Drive del curso
npx wrangler d1 execute mastercelular-db --remote --command "SELECT id, name, drive_folder_url FROM courses;"
npx wrangler d1 execute mastercelular-db --remote --command "UPDATE courses SET drive_folder_url = 'https://drive.google.com/drive/folders/NUEVA_ID' WHERE id = 'celulares';"

# Ver secrets configurados
npx wrangler secret list

# Borrar secret (si te equivocaste)
npx wrangler secret delete NOMBRE_SECRET

# Backup D1 (exportar)
npx wrangler d1 export mastercelular-db --output=backup-$(date +%s).sql

# Rollback D1 (cuidado: reemplaza BD actual)
npx wrangler d1 backup restore mastercelular-db <backup-id>
```

---

## 🔒 Checklist de Seguridad Post-Despliegue

- [ ] `JWT_SECRET` y `AUTH_SECRET` son únicos, aleatorios, 32+ bytes
- [ ] `BREVO_API_KEY` y `RESEND_API_KEY` tienen permisos mínimos necesarios
- [ ] CORS en `index.ts` solo permite `FRONTEND_URL` (no `*`)
- [ ] Rate limiting activo en endpoints sensibles (login, activar, reset password)
- [ ] `audit_logs` registrando acciones importantes
- [ ] HTTPS forzado (Cloudflare lo hace automático)
- [ ] Headers de seguridad (`secureHeaders()` middleware activo)
- [ ] GitHub Secrets configurados (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`)
- [ ] `npm audit --audit-level=high` pasa sin errores
- [ ] Tests pasan (`npm test` - 41 tests)

---

## 📋 Checklist Go/No-Go Pre-Lanzamiento

Ver archivo: `mastercelular-api/GO_NOGO_CHECKLIST.md`

**51 ítems verificables** divididos en:
- **30 Críticos** (bloquean lanzamiento si ❌)
- **21 No-críticos** (recomendados)

Debe firmar: **Tech Lead + Product Owner + Security Reviewer**

---

## 🆘 Troubleshooting Común

| Error | Solución |
|-------|----------|
| `D1_DATABASE_NOT_FOUND` | Verifica `database_id` en `wrangler.toml` coincide con `wrangler d1 list` |
| `KV_NAMESPACE_NOT_FOUND` | Verifica `id` en `wrangler.toml` coincide con `wrangler kv namespace list` |
| `Secret not found: BREVO_API_KEY` | Ejecuta `npx wrangler secret put BREVO_API_KEY` |
| `CORS error` en frontend | Verifica `FRONTEND_URL` en `wrangler.toml` y que coincida exactamente (incluye `https://`) |
| Email no llega | Revisa `npx wrangler tail` → filtra por `test_email` → mira `detail` en audit_logs |
| `wrangler: command not found` | `npm install -g wrangler@latest` o usa `npx wrangler ...` |
| GitHub Actions falla en Quality Gate | Revisa logs: Lint, TypeCheck, Tests, o Security Audit |
| Preview deployment no comenta en PR | Verifica permissions: `pull-requests: write` en workflow |

---

## 📊 Paso 10: Configurar GA4 + GTM para Métricas Detalladas

### IDs Configurados (ya inyectados por `build.js`)

| ID | Variable en `cursos/*.json` | Descripción |
|----|----------------------------|-------------|
| `G-HQ5NCVGVDJ` | `analitica` | GA4 Measurement ID |
| `GTM-KF8W5Z9V` | `analitica_gtm` | GTM Container ID |

### Eventos GA4 Implementados (ver `cliente/src/assets/js/app.js`)

#### **Funnel Principal (Conversión)**
| Evento | Cuándo se dispara | Parámetros clave |
|--------|-------------------|------------------|
| `session_start` | Carga inicial de la página | `session_id`, `referrer`, `landing_page` |
| `session_end` | Cierre/refresh de pestaña | `session_duration_seconds` |
| `register_start` | Click en "Crear mi cuenta gratis" | `method: "email_password"` |
| `register_complete` | Cuenta creada exitosamente | `user_id`, `method` |
| `login_start` | Submit formulario login | `method: "email_password"` |
| `login_complete` | Login exitoso | `user_id`, `method` |
| `activation_start` | Submit código de activación | `code_prefix`, `user_id` |
| `activation_success` | Código válido, acceso FULL | `code_type: "paid"`, `user_id` |
| `purchase_intent` | Click WhatsApp tipo "pagar"/"inscribir" | `tipo`, `precio`, `currency`, `course_id` |

#### **Engagement del Curso (Alumnos)**
| Evento | Cuándo se dispara | Parámetros clave |
|--------|-------------------|------------------|
| `lesson_start` | Reproduce una clase disponible | `lesson_name`, `lesson_module`, `access_type: "free"/"full"` |
| `lesson_complete` | Marca clase como vista | `progress_percent`, `user_id` |
| `lesson_unmark` | Desmarca clase vista | `lesson_name` |
| `video_play` | Video empieza (YouTube iframe) | `lesson_name` |
| `video_pause` | Video pausado | `lesson_name` |
| `video_complete` | Video terminado | `lesson_name` |
| `video_progress` | Progreso 25/50/75/100% (postMessage) | `progress_percent`, `video_duration` |
| `scroll_depth` | Scroll 25/50/75/100% de la página | `depth`, `max_scroll` |
| `search` | Búsqueda en temario (debounce 300ms) | `search_term`, `results_count` |

#### **Materiales y Drive (Valor de Compra)**
| Evento | Cuándo se dispara | Parámetros clave |
|--------|-------------------|------------------|
| `material_download` | Descarga PDF/material | `material_name`, `user_id` |
| `view_item` (Enhanced Ecommerce) | Click en material o carpeta Drive | `item_id`, `item_name`, `item_category` |
| `drive_folder_access_click` | Click "Obtener mi carpeta Drive" | `course_id`, `user_id` |
| `drive_folder_access_success` | Enlace Drive entregado | `course_name`, `user_id` |
| `drive_folder_access_error` | Error al obtener carpeta | `error_code`, `error_message` |
| `badge_earned` | Desbloquea medalla 25/50/75/100% | `badge_level`, `completed_lessons` |

#### **Apuntes y Formularios**
| Evento | Cuándo se dispara | Parámetros clave |
|--------|-------------------|------------------|
| `note_created` | Guarda apunte en clase | `lesson_name`, `has_timestamp`, `user_id` |
| `note_deleted` | Elimina apunte | `note_id`, `user_id` |
| `form_error` | Validación fallida en forms | `form_name`, `field_name`, `error_type` |
| `click_whatsapp` | Cualquier click a WhatsApp | `tipo`, `ref`, `pais` |

### Configurar Tags en GTM (GTM-KF8W5Z9V)

En **Google Tag Manager → Tags → New**, crear **GA4 Event** tags para cada evento custom:

| Tag Name | Event Name | Trigger Type | Trigger Condition |
|----------|------------|--------------|-------------------|
| GA4 - Register Complete | `register_complete` | Custom Event | Event name = `register_complete` |
| GA4 - Activation Success | `activation_success` | Custom Event | Event name = `activation_success` |
| GA4 - Lesson Complete | `lesson_complete` | Custom Event | Event name = `lesson_complete` |
| GA4 - Drive Folder Success | `drive_folder_access_success` | Custom Event | Event name = `drive_folder_access_success` |
| GA4 - Purchase Intent | `purchase_intent` | Custom Event | Event name = `purchase_intent` |
| GA4 - Badge Earned | `badge_earned` | Custom Event | Event name = `badge_earned` |
| GA4 - Material Download | `material_download` | Custom Event | Event name = `material_download` |
| GA4 - Search | `search` | Custom Event | Event name = `search` |
| GA4 - Scroll Depth | `scroll_depth` | Custom Event | Event name = `scroll_depth` |
| GA4 - Video Progress | `video_progress` | Custom Event | Event name = `video_progress` |
| GA4 - Form Error | `form_error` | Custom Event | Event name = `form_error` |
| GA4 - Note Created | `note_created` | Custom Event | Event name = `note_created` |

**En cada tag GA4 Event:**
- Measurement ID: `G-HQ5NCVGVDJ` (o usa variable `{{GA4 Measurement ID}}`)
- Event Parameters: **Enviar todos los parámetros del dataLayer** (checkbox)
- User Properties: `user_id` = `{{user_id}}` (opcional, para User-ID tracking)

### Enhanced Ecommerce en GA4

Los eventos `view_item`, `begin_checkout`, `purchase`, `milestone_reached` usan estructura **Enhanced Ecommerce** compatible con reportes de Monetización de GA4.

Para ver en GA4: **Informes → Monetización → Compras** / **Elementos vistos**

### Verificar que funciona

1. Abre `https://mastercelular.online` (o preview)
2. Abre DevTools → Console → Network → filtra `collect`
3. Busca requests a `google-analytics.com/g/collect` o `gtm.js`
4. En GA4: **Admin → Data Streams → tu stream → Enhanced measurement** (activado)
5. En GA4: **Informes → Tiempo real** → verifica eventos en vivo

### Debug GTM

```bash
# En consola del navegador:
dataLayer  # Ver todos los eventos empujados
gtag('event', 'test_event', { test: 'value' })  # Test manual
```

---

## 📞 Soporte y Recursos

- **Docs oficiales:** https://developers.cloudflare.com/workers/
- **Discord Cloudflare:** https://discord.gg/cloudflaredev
- **Issues del repo:** https://github.com/sectorx047-celulares/mastercelular/issues
- **Guía contribución:** `mastercelular-api/CONTRIBUTING.md`
- **Plan incidentes:** `mastercelular-api/INCIDENT_RESPONSE.md`
- **Changelog:** `mastercelular-api/CHANGELOG.md`

---

## 🎉 ¡Listo!

Tu stack completo está configurado:

| Componente | Tecnología | Deploy |
|------------|------------|--------|
| **Backend API** | Cloudflare Workers + Hono + D1 + KV | GitHub Actions → `wrangler deploy` |
| **Frontend** | HTML estático + JS vanilla | GitHub Actions → Cloudflare Pages |
| **Base de Datos** | Cloudflare D1 (SQLite) | Migraciones via `schema.sql` |
| **Cache** | Cloudflare KV | Automático |
| **Emails** | Brevo (primario) + Resend (fallback) | Queue + Cron cada 5 min |
| **CI/CD** | GitHub Actions (4 workflows) | Push a `main` + PRs |
| **Tests** | Vitest (41 tests unitarios) | En CI + local |
| **Lint/TypeCheck** | ESLint + TypeScript strict | En CI + local |
| **Seguridad** | JWT HS256 + PBKDF2 + Rate Limit + Audit Logs | Nativo |

**Próximo paso:** Configura los **GitHub Secrets** y haz `git push origin main` 🚀