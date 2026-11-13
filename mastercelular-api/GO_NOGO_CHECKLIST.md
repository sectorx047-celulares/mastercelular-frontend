# Go/No-Go Checklist - MasterCelulares Launch

> **Objetivo:** Verificación final antes de lanzamiento a producción. **Todos los ítems deben estar ✅ para hacer GO.**

---

## 📋 Instrucciones

- Cada ítem se verifica y marca ✅ (cumple), ❌ (no cumple), ⚠️ (parcial/con riesgo)
- **GO** = Todos los ítems críticos ✅ + Mayoría de no-críticos ✅
- **NO-GO** = Cualquier ítem crítico ❌ o ≥3 no-críticos ❌
- **CONDITIONAL GO** = Ítems críticos ✅ pero algunos no-críticos ⚠️ con plan de mitigación documentado

---

## ✅ CRÍTICOS (Bloquean lanzamiento si ❌)

### Infraestructura & Deploy
| # | Ítem | Verificación | Estado | Evidencia/Notas |
|---|------|--------------|--------|-----------------|
| C1 | **GitHub Secrets configurados** | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` en repo settings | ⬜ | Settings → Secrets → Actions |
| C2 | **Workflows CI/CD pasan en main** | Último run verde en deploy-backend.yml y deploy-frontend.yml | ⬜ | GitHub Actions history |
| C3 | **Preview deployments funcionan** | PR de prueba genera preview URLs accesibles | ⬜ | Comentar en PR de prueba |
| C4 | **Wrangler.toml IDs correctos** | `database_id`, `id` (KV) coinciden con `wrangler d1 list` / `kv namespace list` | ⬜ | Verificar en terminal |
| C5 | **Secrets de producción subidos** | `JWT_SECRET`, `AUTH_SECRET`, `BREVO_API_KEY`, `RESEND_API_KEY` via `wrangler secret list` | ⬜ | 4 secrets listados |
| C6 | **D1 migraciones ejecutadas en remote** | `wrangler d1 execute mastercelular-db --remote --file=./schema.sql` exitoso | ⬜ | 47 statements executed |
| C7 | **Seed data cargado (si aplica)** | Usuarios de prueba, cursos activos en D1 remote | ⬜ | `SELECT * FROM courses WHERE is_active=1;` |

### Seguridad
| # | Ítem | Verificación | Estado | Evidencia/Notas |
|---|------|--------------|--------|-----------------|
| C8 | **JWT_SECRET único y fuerte** | 32+ bytes aleatorios, no reutilizado, rotado si expuesto | ⬜ | `openssl rand -base64 32` |
| C9 | **CORS restrictivo** | Solo `FRONTEND_URL` permitida (no `*`) en `index.ts` | ⬜ | Revisar código línea 36-49 |
| C10 | **Rate limiting activo** | `failed_attempts` table + middleware en login/activate/reset | ⬜ | Verificar endpoints protegidos |
| C11 | **Headers de seguridad** | `secureHeaders()` middleware activo (CSP, HSTS, X-Frame, etc.) | ⬜ | Verificar `app.use('*', secureHeaders())` |
| C12 | **Audit logging funcionando** | `audit_logs` registra login, activate, drive_access, test_email | ⬜ | Probar y verificar en DB |
| C13 | **Contraseñas hasheadas PBKDF2** | 100,000 iteraciones, salt único por usuario | ⬜ | Revisar código de register/login |
| C14 | **Tokens JWT hasheados en BD** | SHA-256 en tabla `sessions`, nunca token plano | ⬜ | Verificar `hashToken()` function |
| C15 | **Códigos activación HMAC** | Nunca guardados en plano, solo `code_hash` HMAC-SHA256 | ⬜ | Verificar `activation_codes` table |
| C16 | **HTTPS forzado** | Cloudflare automático, verificar en browser | ⬜ | 🔒 en barra de direcciones |

### Funcionalidad Core
| # | Ítem | Verificación | Estado | Evidencia/Notas |
|---|------|--------------|--------|-----------------|
| C17 | **Registro + Login funciona** | Flujo completo: register → email → login → JWT → acceso | ⬜ | Probar en staging |
| C18 | **Activación de códigos** | Código válido → acceso FULL → drive folder accesible | ⬜ | Probar código de prueba |
| C19 | **Acceso Drive folder (paid users)** | `/api/courses/celulares/drive-folder` retorna URL con JWT válido + FULL | ⬜ | Verificar respuesta JSON |
| C20 | **Progreso de lecciones** | Marcar vista → persiste → badge al 25/50/75/100% | ⬜ | Probar flujo alumno |
| C21 | **Notas de alumno** | Crear/editar/borrar notas por lección | ⬜ | Probar en panel alumno |
| C22 | **Descarga materiales** | Tracking en tabla `downloads` | ⬜ | Verificar registro en DB |
| C23 | **Email queue + fallback** | Brevo → fallback Resend → reintentos exponenciales | ⬜ | Probar `/api/test-email` ambos |
| C24 | **Cron job emails** | `*/5 * * * *` en wrangler.toml → procesa cola cada 5 min | ⬜ | Verificar logs / dashboard |

### Frontend
| # | Ítem | Verificación | Estado | Evidencia/Notas |
|---|------|--------------|--------|-----------------|
| C25 | **Build genera dist/** | `node build.js` → `dist/` con index.html + assets | ⬜ | `ls -la dist/` |
| C26 | **Páginas PE y VE generadas** | 2 países × 1 curso = 2 páginas en dist/ | ⬜ | Verificar `dist/pe/`, `dist/ve/` |
| C27 | **Drive access panel visible** | Panel "Acceso a Carpeta Drive" en #panel-alumno para usuarios FULL | ⬜ | Verificar en browser |
| C28 | **Config API_URL correcta** | `window.CONFIG.apiBase` apunta a worker de producción | ⬜ | Verificar `build.js` línea 136 |
| C29 | **hreflang + SEO** | `<link rel="alternate" hreflang="es-PE" ...>` + `x-default` | ⬜ | Ver HTML generado |
| C30 | **JSON-LD Course schema** | `<script type="application/ld+json">` con Course markup | ⬜ | Ver HTML generado |

---

## ⚠️ NO-CRÍTICOS (Recomendados, no bloquean)

### Observabilidad & Operaciones
| # | Ítem | Verificación | Estado | Notas |
|---|------|--------------|--------|-------|
| N1 | **Alertas configuradas** | Cloudflare Workers alerts (error rate, latency) | ⬜ | Dashboard → Workers → Alerts |
| N2 | **Logs estructurados** | `logger()` middleware + request IDs en todas las respuestas | ⬜ | `X-Request-Id` header |
| N3 | **Health checks completos** | `/health`, `/api/test-db`, `/api/test-kv` responden < 500ms | ⬜ | `curl` cada uno |
| N4 | **Backup D1 probado** | Restore testado en staging (no en prod) | ⬜ | Documentar procedimiento |
| N5 | **Runbooks accesibles** | `INCIDENT_RESPONSE.md` en repo, equipo conoce ubicación | ⬜ | Compartir con equipo |

### Tests & Calidad
| # | Ítem | Verificación | Estado | Notas |
|---|------|--------------|--------|-------|
| N6 | **Tests unitarios > 50% coverage** | `npm test` pasa con coverage thresholds | ⬜ | Ver reporte `coverage/` |
| N7 | **Lint sin warnings** | `npm run lint` → 0 warnings, 0 errors | ⬜ | ESLint + TypeScript |
| N8 | **Security audit limpio** | `npm audit --audit-level=high` → 0 vulnerabilidades | ⬜ | Solo low/moderate permitidos |
| N9 | **TypeScript strict** | `npx tsc --noEmit` → 0 errores | ⬜ | `strict: true` en tsconfig |

### Documentación & Proceso
| # | Ítem | Verificación | Estado | Notas |
|---|------|--------------|--------|-------|
| N10 | **CHANGELOG.md actualizado** | Entrada para versión actual con Fixed/Added/Changed | ⬜ | Formato Keep a Changelog |
| N11 | **CONTRIBUTING.md existe** | Guía para contribuidores con workflow | ⬜ | En mastercelular-api/ |
| N12 | **DEPLOYMENT.md completo** | Pasos 1-7 verificables, troubleshooting | ⬜ | Incluye Drive folder config |
| N13 | **API Contract documentado** | `CONTRATO-API.md` o equivalente actualizado | ⬜ | Endpoints, schemas, códigos error |
| N14 | **Versionado semántico** | `package.json` version + git tags `v1.0.0` | ⬜ | Automático en CI |

### UX & Accesibilidad
| # | Ítem | Verificación | Estado | Notas |
|---|------|--------------|--------|-------|
| N15 | **WCAG 2.1 AA básico** | Contraste, labels, focus visible, semántica HTML | ⬜ | Auditoría rápida |
| N16 | **i18n completo** | Textos PE/VE, monedas, WhatsApp, vendedores correctos | ⬜ | Verificar `paises/*.json` |
| N17 | **Mobile responsive** | Funciona en 375px, 768px, 1440px sin scroll horizontal | ⬜ | Chrome DevTools device toolbar |
| N18 | **Performance básica** | LCP < 2.5s, CLS < 0.1, TBT < 200ms (PageSpeed) | ⬜ | pagespeed.web.dev |

### Analytics & Tracking (GA4/GTM)
| # | Ítem | Verificación | Estado | Notas |
|---|------|--------------|--------|-------|
| N19 | **GA4 Measurement ID correcto** | `G-HQ5NCVGVDJ` inyectado en HTML via `curso.analitica` | ⬜ | Ver en `dist/*.html` |
| N20 | **GTM Container ID correcto** | `GTM-KF8W5Z9V` inyectado en `<head>` + noscript en `<body>` | ⬜ | Ver en `dist/*.html` |
| N21 | **GTM Tags configurados** | 12+ GA4 Event tags creados en GTM con triggers Custom Event | ⬜ | Ver GTM Workspace |
| N22 | **Enhanced Ecommerce activo** | Eventos `view_item`, `purchase`, `milestone_reached` con items[] | ⬜ | Ver GA4 Monetización |
| N23 | **DataLayer eventos fluyen** | `dataLayer` recibe eventos: session_start, register_complete, lesson_complete, drive_folder_access_success, purchase_intent, etc. | ⬜ | DevTools Console → `dataLayer` |
| N24 | **User-ID tracking (opcional)** | `user_id` enviado en eventos para cross-device | ⬜ | Ver parámetros GA4 |

### Seguridad Adicional
| # | Ítem | Verificación | Estado | Notas |
|---|------|--------------|--------|-------|
| N25 | **Dependencias actualizadas** | `npm outdated` → 0 critical/high, minor ok | ⬜ | `npm audit fix` aplicado |
| N26 | **CSP configurado** | `Content-Security-Policy` header sin `unsafe-inline` excesivo | ⬜ | Ver en DevTools Network |
| N27 | **Secrets rotados recientemente** | JWT_SECRET, AUTH_SECRET < 90 días | ⬜ | Política de rotación |

---

## 📊 Resumen de Decisión

| Categoría | Total | ✅ | ❌ | ⚠️ | % Completado |
|-----------|-------|-----|-----|-----|--------------|
| **Críticos** | 30 |  |  |  |  |
| **No-críticos** | 27 |  |  |  |  |
| **TOTAL** | 57 |  |  |  |  |

### Decisión Final

- [ ] **GO** - Lanzar a producción
- [ ] **CONDITIONAL GO** - Lanzar con plan de mitigación para ítems ⚠️ (documentar abajo)
- [ ] **NO-GO** - No lanzar, resolver ítems ❌ primero

---

## 📝 Plan de Mitigación (si CONDITIONAL GO)

| Ítem ⚠️ | Riesgo | Mitigación | Responsable | Fecha Límite |
|---------|--------|------------|-------------|--------------|
|  |  |  |  |  |
|  |  |  |  |  |

---

## ✍️ Firmas de Aprobación

| Rol | Nombre | Firma | Fecha | Decisión |
|-----|--------|-------|-------|----------|
| **Tech Lead** | Miguel Acevedo |  |  | ☐ GO / ☐ NO-GO |
| **Product Owner** |  |  |  | ☐ GO / ☐ NO-GO |
| **Security Reviewer** |  |  |  | ☐ GO / ☐ NO-GO |

---

## 📅 Historial

| Versión | Fecha | Decisión | Notas |
|---------|-------|----------|-------|
| 1.1 | 2026-11-12 | Pendiente | Agregados 6 ítems Analytics/GA4/GTM + actualización tracking completo |
| 1.0 | 2026-11-12 | Pendiente | Checklist inicial creado |

---

**Próxima revisión:** Post-lanzamiento (72h) + Mensual