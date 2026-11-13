# MasterCelulares API

Backend API para la plataforma MasterCelulares — Cursos de reparación de celulares.

**Stack:** Cloudflare Workers + Hono + D1 (SQLite) + KV + TypeScript

---

## 🏗️ Arquitectura

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │────▶│   Worker    │────▶│    D1 DB    │
│ (Pages)     │     │  (API)      │     │  (SQLite)   │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    KV       │
                    │  (Cache/    │
                    │   Sessions) │
                    └─────────────┘
                           │
               ┌───────────┴───────────┐
               ▼                       ▼
        ┌───────────┐           ┌───────────┐
        │  Brevo    │           │  Resend   │
        │ (Primary) │           │ (Fallback)│
        └───────────┘           └───────────┘
```

---

## 📁 Estructura

```
mastercelular-api/
├── wrangler.toml          # Config Worker (D1, KV, vars)
├── schema.sql             # Esquema BD completo (15 tablas + vistas)
├── package.json           # Scripts y deps
├── tsconfig.json          # Config TypeScript
├── DEPLOYMENT.md          # Guía paso a paso de despliegue
├── config-proyecto.txt    # Plantilla de credenciales (NO SUBIR A GIT)
├── .gitignore
└── src/
    └── index.ts           # Código principal
```

---

## 🚀 Inicio Rápido

```bash
# 1. Instalar deps
npm install

# 2. Configurar wrangler.toml con tus IDs reales (ver DEPLOYMENT.md)

# 3. Subir secrets
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put JWT_SECRET
npx wrangler secret put AUTH_SECRET

# 4. Crear tablas en D1 (producción)
npx wrangler d1 execute mastercelular-db --remote --file=./schema.sql

# 5. Desarrollo local
npm run dev

# 6. Desplegar
npm run deploy
```

---

## 📡 Endpoints Principales

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| GET | `/health` | Health check | No |
| GET | `/api/test-db` | Test conexión D1 | No |
| GET | `/api/test-kv` | Test conexión KV | No |
| POST | `/api/test-email` | **Enviar email de prueba** | No |
| POST | `/api/queue-email` | Encolar email para envío async | No |

### Próximos endpoints (Fase 2+)
- `POST /api/auth/register` — Registro de usuario
- `POST /api/auth/login` — Login + JWT
- `POST /api/auth/logout` — Revocar sesión
- `POST /api/auth/activate` — Canjear código de activación
- `GET /api/courses/:id/public` — Temario público (sin auth)
- `GET /api/me` — Estado del alumno (con JWT)
- `POST /api/progress` — Marcar clase vista
- `POST /api/notes` — Guardar nota
- `GET /api/materials/:id` — Obtener link de descarga
- `POST /api/password/reset` — Solicitar reset
- `POST /api/password/change` — Cambiar contraseña

---

## 🔐 Autenticación

- **JWT HS256** firmado con `JWT_SECRET`
- Expiración: 30 días (`JWT_EXPIRY_HOURS=720`)
- Token se envía en header: `Authorization: Bearer <token>`
- Sesiones persistidas en D1 (`sessions` table) + cache en KV

---

## 📧 Sistema de Emails

**Proveedor primario:** Brevo (API v3)  
**Fallback automático:** Resend

```typescript
// Uso directo (síncrono)
await sendEmail(env, {
  to_email: 'user@example.com',
  subject: 'Bienvenido',
  html_body: '<h1>Hola</h1>',
  provider: 'brevo' // o 'resend'
});

// Uso encolado (asíncrono, via Cron cada 5 min)
await queueEmail(env, { ... });
```

**Cron Trigger:** Configurado en `wrangler.toml` para `*/5 * * * *` (procesa cola cada 5 min).

---

## 🛡️ Rate Limiting

- **Login:** 5 intentos / 15 min por WhatsApp → bloqueo 15 min
- **Activación:** 100 intentos globales / 15 min → bloqueo 15 min
- Persistido en D1 (`failed_attempts` table)

---

## 🗄️ Esquema BD (Resumen)

| Tabla | Propósito |
|-------|-----------|
| `users` | Cuentas (WhatsApp único, hash PBKDF2) |
| `courses` | Cursos (celulares, galinas, holistica) |
| `enrollments` | Inscripciones (FREE/FULL por curso) |
| `activation_codes` | Códigos (solo HMAC guardado) |
| `code_delivery` | Códigos en claro para entrega (temp) |
| `lessons` | Clases por módulo (gratis/pago) |
| `materials` | PDFs, diagramas |
| `progress` | Progreso alumno (clase vista) |
| `notes` | Apuntes con timestamp |
| `downloads` | Registro de descargas |
| `sessions` | JWT tokens hasheados |
| `failed_attempts` | Rate limiting |
| `badges` | Medallas 25/50/75/100% |
| `email_queue` | Cola emails async |
| `audit_logs` | Auditoría seguridad |
| `app_config` | Config dinámica key-value |

---

## 🧪 Testing

```bash
# Tests unitarios (vitest)
npm test

# Test manual email
curl -X POST https://tu-worker.workers.dev/api/test-email \
  -H "Content-Type: application/json" \
  -d '{"to_email": "tu@email.com", "provider": "brevo"}'
```

---

## 📖 Documentación

- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Guía completa paso a paso
- **[config-proyecto.txt](./config-proyecto.txt)** — Plantilla de credenciales
- **[schema.sql](./schema.sql)** — Esquema SQL comentado

---

## 🔧 Scripts Disponibles

```bash
npm run dev           # Desarrollo local (wrangler dev)
npm run deploy        # Deploy a producción
npm run build         # Compilar TypeScript
npm run test          # Ejecutar tests
npm run d1:remote     # Ejecutar migración en D1 remoto
npm run d1:local      # Ejecutar migración en D1 local
npm run tail          # Ver logs en tiempo real
```

---

## 🔗 Enlaces Útiles

- **Dashboard Cloudflare:** https://dash.cloudflare.com
- **Worker Logs:** `npx wrangler tail`
- **D1 Console:** `npx wrangler d1 execute mastercelular-db --remote --command "..."`
- **Brevo Dashboard:** https://app.brevo.com
- **Resend Dashboard:** https://resend.com

---

## 📝 Licencia

Proyecto privado - MasterCelulares