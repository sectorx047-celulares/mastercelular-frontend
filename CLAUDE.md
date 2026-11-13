# MasterCelulares — Guía del Proyecto

Plataforma de cursos de reparación de celulares. Arquitectura cliente-servidor:
- **Cliente**: Netlify (JS vanilla, build con esbuild)
- **Servidor v3 (producción)**: Google Apps Script + Google Sheets
- **Servidor v4 (migración)**: Cloudflare Workers + Hono + D1 (SQLite) + KV

---

## Estructura del Repositorio

```
mastercelular/
├── cliente/                    # Frontend Netlify
│   ├── src/
│   │   ├── index.html
│   │   ├── assets/js/app.js   # Lógica principal (migración v3→v4 pendiente)
│   │   ├── assets/css/style.css
│   │   └── assets/vlz/        # VSL / Landing
│   ├── dist/                   # Build de producción
│   ├── build.js                # Inyecta window.CONFIG (endpoint, course_id, etc.)
│   ├── package.json
│   └── netlify.toml
├── servidor/                   # Backend v3 (Apps Script) — PRODUCCIÓN ACTUAL
│   ├── Code.gs                 # Punto de entrada único (13 acciones)
│   ├── CONTRATO-API.md         # Contrato completo v3
│   └── pruebas/                # Tests unitarios (Node + entorno simulado)
├── mastercelular-api/          # Backend v4 (Cloudflare Workers) — EN DESARROLLO
│   ├── src/index.ts            # Router principal (solo health/test endpoints)
│   ├── schema.sql              # Esquema D1 (15 tablas + vistas)
│   ├── wrangler.toml           # Config Worker (D1, KV, secrets, cron)
│   ├── package.json
│   ├── DEPLOYMENT.md           # Guía paso a paso deploy
│   └── config-proyecto.txt     # Plantilla credenciales (NO SUBIR A GIT)
└── MIGRATION-PLAN-v3-to-v4.md  # Plan detallado de migración (ver abajo)
```

---

## Estado Actual

| Componente | Versión | Estado |
|------------|---------|--------|
| Frontend (Netlify) | v3 | ✅ Producción — usa `CFG.endpoint` → Apps Script |
| Backend Apps Script | v3 | ✅ Producción — 13 acciones documentadas en `servidor/CONTRATO-API.md` |
| Backend Cloudflare Workers | v4 | 🚧 Parcial — solo endpoints de salud (`health`, `test-db`, `test-kv`, `test-email`, `queue-email`, `drive-folder`) |
| Migración v3→v4 | Plan | 📋 Documentado en `MIGRATION-PLAN-v3-to-v4.md` — **NO implementar aún** |

---

## Documentación Clave

### 1. Contrato API v3 (Producción Actual)
**Archivo**: `servidor/CONTRATO-API.md`
- 13 acciones: `registrar`, `login`, `logout`, `estado`, `activar`, `cambiar_password`, `progreso`, `obtener_clase`, `obtener_material`, `nota_guardar`, `nota_eliminar`, `medalla`
- Autenticación: token en body JSON (SHA-256 en servidor)
- Respuestas: `{ ok: true, ... }` / `{ ok: false, codigo, mensaje }`
- Modelo: Usuarios (por WhatsApp), Accesos (por curso: GRATIS/COMPLETO), Sesiones (30 días)

### 2. Backend v4 (Cloudflare Workers)
**Archivo**: `mastercelular-api/README.md`
- Stack: Hono + D1 + KV + TypeScript
- Auth: JWT HS256 (header `Authorization: Bearer`)
- Email: Brevo (primario) + Resend (fallback) + cola async con Cron `*/5 * * * *`
- Rate limiting: Login 5/15min, Activación 100 global/15min
- Esquema D1: 15 tablas (`users`, `courses`, `enrollments`, `activation_codes`, `lessons`, `materials`, `progress`, `notes`, `downloads`, `sessions`, `failed_attempts`, `badges`, `email_queue`, `audit_logs`, `app_config`)

### 3. Plan de Migración v3→v4
**Archivo**: `MIGRATION-PLAN-v3-to-v4.md` (1000+ líneas)
- **13 endpoints faltantes** mapeados 1:1 con cambios de auth, IDs, contraseñas
- **Fases de implementación**: 1-Fundación (4 endpoints públicos), 2-Estado/Acceso (3 protegidos), 3-Contenido/Progreso (6), 4-Frontend, 5-Admin
- **Frontend changes**: `build.js` inyecta `apiBase`/`course_id`/`country`; `app.js` reescribe `llamar()`→`apiCall()`, `pedir()`, `items()`/`itemDe()`/`vista()` usan `lesson_id` numérico
- **Rollout**: Local → Staging → Canary 10% → 50% → 100% → Deprecación v3
- **Migración datos**: Sheets→CSV→D1 con re-hash de passwords (legacy v3→PBKDF2 v4 en primer login)
- **Riesgos**: Hash incompatible (mitigación: `must_change_password=1`), IDs título vs numérico, rate limiting D1, CDN cache, pepper HMAC códigos

---

## Comandos Útiles

### Frontend (cliente/)
```bash
cd cliente
npm install           # Instalar deps
npm run dev           # Netlify dev local
npm run build         # Build producción (esbuild + inyecta CONFIG)
```

### Backend v3 (servidor/) — Apps Script
```bash
cd servidor
node pruebas/prueba.js   # 41 tests unitarios (entorno simulado)
```
> Despliegue: Extensiones > Apps Script > Pegar `Code.gs` > Ejecutar `prepararHojas_` > Implementar como Web App

### Backend v4 (mastercelular-api/) — Cloudflare Workers
```bash
cd mastercelular-api
npm install                    # Instalar deps
npm run dev                    # wrangler dev (localhost:8787)
npm run deploy                 # Deploy producción
npm run d1:remote              # Ejecutar schema.sql en D1 remoto
npx wrangler secret put JWT_SECRET    # Configurar secrets
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put AUTH_SECRET
npm run tail                   # Logs tiempo real
npm run test                   # Tests (vitest)
```

---

## URLs de Referencia

| Entorno | Worker API | Frontend |
|---------|------------|----------|
| Local | `http://localhost:8787` | `netlify dev` |
| Staging | `mastercelular-api-staging.sectorx047.workers.dev` | `staging.mastercelular.online` |
| Producción | `mastercelular-api.sectorx047.workers.dev` | `mastercelular.online` |
| Apps Script v3 | `https://script.google.com/macros/s/AKfycb.../exec` | `mastercelular.online` |

---

## Próximos Pasos (cuando se inicie migración)

1. **Fase 1**: Implementar 4 endpoints públicos en `mastercelular-api/src/routes/`
2. **Fase 2**: Auth middleware + 3 endpoints protegidos (`/me`, `/activate`, `/password/change`)
3. **Fase 3**: 6 endpoints de contenido/progreso
4. **Fase 4**: Migrar `cliente/build.js` + `cliente/src/assets/js/app.js` completo
5. **Testing**: `/qa` en Staging con matriz de 13 endpoints + 5 flujos E2E
6. **Rollout**: Canary con feature flag `useV4` en frontend

---

## Notas Importantes

- **NO implementar migración aún** — el plan está en revisión (`MIGRATION-PLAN-v3-to-v4.md` línea 5: "Estado: Plan — NO implementar aún")
- **config-proyecto.txt** contiene plantilla de credenciales — **nunca commitear**
- **Contraseñas v3 vs v4**: algoritmos incompatibles (HMAC-SHA256 5k vs PBKDF2 100k) — requiere re-hash en primer login v4
- **Códigos HMAC**: mismo pepper debe migrarse de Script Properties a Worker Secret
- **localStorage key**: cambiar a `mc_sesion_v4` para evitar conflictos v3/v4