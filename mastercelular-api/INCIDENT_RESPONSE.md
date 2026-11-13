# Plan de Respuesta a Incidentes - MasterCelulares

> **Objetivo:** Detectar, contener y resolver incidentes de seguridad y operativos en < 30 min (críticos) / < 4 horas (mayores) / < 24 horas (menores).

---

## 📞 Contactos de Escalación

| Rol | Nombre | Contacto | Disponibilidad |
|-----|--------|----------|----------------|
| **Tech Lead** | Miguel Acevedo | WhatsApp: +51 916 381 231 | 24/7 |
| **Backend Owner** | Miguel Acevedo | WhatsApp: +51 916 381 231 | 24/7 |
| **Frontend Owner** | Miguel Acevedo | WhatsApp: +51 916 381 231 | 24/7 |
| **Cloudflare Admin** | Miguel Acevedo | Cloudflare Dashboard | 24/7 |
| **Email Provider (Brevo)** | Soporte Brevo | https://help.brevo.com | Horario comercial |
| **Email Provider (Resend)** | Soporte Resend | https://resend.com/support | 24/7 |

---

## 🚨 Clasificación de Severidad

| Nivel | Definición | Ejemplos | SLA Respuesta | SLA Resolución |
|-------|------------|----------|---------------|----------------|
| **SEV-1 (Crítico)** | Servicio caído, pérdida de datos, brecha de seguridad | API 5xx > 5%, D1 inaccesible, leak de secrets, acceso no autorizado a Drive | **15 min** | **1 hora** |
| **SEV-2 (Mayor)** | Funcionalidad principal degradada | Email no envía, login falla intermitente, preview deployments rotos | **30 min** | **4 horas** |
| **SEV-3 (Menor)** | Funcionalidad secundaria afectada | Métricas incorrectas, UI bug no bloqueante, logs ruidosos | **2 horas** | **24 horas** |
| **SEV-4 (Info)** | Mejora, observación, tech debt | Warning en logs, dependencia desactualizada, doc desactualizada | **1 día** | **1 semana** |

---

## 🔄 Flujo de Respuesta

```
DETECCIÓN → TRIAGE → CONTENCIÓN → RESOLUCIÓN → POST-MORTEM
    │          │           │            │            │
    ▼          ▼           ▼            ▼            ▼
Monitoring  Severity   Mitigación   Fix + Deploy  Documentar
  Alert     Assignment  Temporal     + Verificar   Lecciones
```

---

## 🛠️ Runbooks por Tipo de Incidente

### RUNBOOK-01: API Caída (5xx / Timeout)
**Severidad:** SEV-1

**Síntomas:**
- `/health` retorna 5xx o timeout
- `npx wrangler tail` muestra errors masivos
- Cloudflare Dashboard muestra "Unhealthy"

**Pasos:**
1. **Verificar** en Cloudflare Dashboard → Workers → mastercelular-api → Logs
2. **Revisar** último deploy: `git log --oneline -5` + GitHub Actions run
3. **Rollback inmediato** si deploy reciente:
   ```bash
   # Opción A: Via wrangler (rápido)
   npx wrangler rollback mastercelular-api
   
   # Opción B: Via GitHub Actions (re-deploy commit anterior)
   gh workflow run deploy-backend.yml -f sha=<commit-anterior>
   ```
4. **Verificar** D1 y KV accesibles:
   ```bash
   curl https://mastercelular-api.xxx.workers.dev/api/test-db
   curl https://mastercelular-api.xxx.workers.dev/api/test-kv
   ```
5. **Si D1 caído**: Verificar cuota en Cloudflare Dashboard → D1 → mastercelular-db
6. **Escalar** a Cloudflare Support si infraestructura caída

**Comando de diagnóstico rápido:**
```bash
npx wrangler tail --format=pretty --status=error | head -50
```

---

### RUNBOOK-02: Emails No Se Envían
**Severidad:** SEV-2 (afecta registro, activación, recuperación password)

**Síntomas:**
- Usuarios reportan no recibir códigos
- `email_queue` crece en status `pending`/`retrying`
- Logs muestran errores Brevo/Resend

**Pasos:**
1. **Verificar** estado de colas:
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     SELECT status, COUNT(*) as count FROM email_queue GROUP BY status;
   "
   ```
2. **Probar** envío manual:
   ```bash
   curl -X POST https://mastercelular-api.xxx.workers.dev/api/test-email \
     -H "Content-Type: application/json" \
     -d '{"to_email":"test@tudominio.com","provider":"brevo"}'
   ```
3. **Si Brevo falla**: Verificar API Key, cuota, IP reputation en Brevo Dashboard
4. **Forzar procesamiento** de cola:
   ```bash
   # Via cron trigger manual
   npx wrangler d1 execute mastercelular-db --remote --command "
     UPDATE email_queue SET status='pending', scheduled_at=datetime('now') 
     WHERE status IN ('pending','retrying') AND attempts < max_attempts;
   "
   ```
5. **Cambiar proveedor por defecto** en `app_config` si uno caído:
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     UPDATE app_config SET value='resend' WHERE key='default_email_provider';
   "
   ```

---

### RUNBOOK-03: Base de Datos D1 Inaccesible / Corrupta
**Severidad:** SEV-1

**Síntomas:**
- Error `D1_DATABASE_NOT_FOUND` o `D1_ERROR`
- Queries timeout
- Datos inconsistentes

**Pasos:**
1. **Verificar** estado en Cloudflare Dashboard → D1 → mastercelular-db
2. **Revisar** cuota de storage/reads/writes
3. **Si corrupción**: Restaurar desde backup
   ```bash
   # 1. Listar backups disponibles
   npx wrangler d1 backup list mastercelular-db
   
   # 2. Restaurar (REEMPLAZA BASE DE DATOS ACTUAL - CUIDADO)
   npx wrangler d1 backup restore mastercelular-db <backup-id>
   ```
4. **Si solo tabla corrupta**: Re-ejecutar migración específica
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --file=./schema.sql
   ```
5. **Verificar** integridad post-restore:
   ```bash
   curl https://mastercelular-api.xxx.workers.dev/api/test-db
   ```

---

### RUNBOOK-04: Fuga de Secrets / Acceso No Autorizado
**Severidad:** SEV-1

**Síntomas:**
- Secrets visibles en logs/commits
- Actividad extraña en audit_logs
- Accesos desde IPs desconocidas

**Pasos:**
1. **Rotar TODOS los secrets inmediatamente**:
   ```bash
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put AUTH_SECRET
   npx wrangler secret put BREVO_API_KEY
   npx wrangler secret put RESEND_API_KEY
   ```
2. **Revocar tokens JWT activos** (forzar re-login):
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     DELETE FROM sessions;
   "
   ```
3. **Revisar audit_logs** últimos 24h:
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     SELECT * FROM audit_logs 
     WHERE timestamp > datetime('now', '-24 hours') 
     ORDER BY timestamp DESC LIMIT 100;
   "
   ```
4. **Revisar GitHub** por commits con secrets (git-secrets, truffleHog)
5. **Notificar** a usuarios afectados si hay exposición de datos personales
6. **Reportar** a autoridades si corresponde (Ley de Protección de Datos)

---

### RUNBOOK-05: Rate Limiting / Ataque de Fuerza Bruta
**Severidad:** SEV-2

**Síntomas:**
- `failed_attempts` crece rápido
- Múltiples IPs bloqueadas
- Usuarios legítimos bloqueados

**Pasos:**
1. **Identificar** patrón de ataque:
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     SELECT key, attempts, blocked_until FROM failed_attempts 
     WHERE blocked_until IS NOT NULL ORDER BY attempts DESC LIMIT 20;
   "
   ```
2. **Limpiar** bloqueos falsos positivos:
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     DELETE FROM failed_attempts WHERE key LIKE 'login:%' AND blocked_until < datetime('now');
   "
   ```
3. **Ajustar** límites en `app_config` si necesario:
   ```bash
   npx wrangler d1 execute mastercelular-db --remote --command "
     UPDATE app_config SET value='10' WHERE key='max_login_attempts';
     UPDATE app_config SET value='30' WHERE key='lockout_minutes';
   "
   ```
4. **Considerar** WAF rule en Cloudflare para IPs maliciosas

---

### RUNBOOK-06: Frontend No Carga / Cloudflare Pages Error
**Severidad:** SEV-2

**Síntomas:**
- Página blanca / 404 / 522
- Build falla en GitHub Actions
- Custom domain no resuelve

**Pasos:**
1. **Verificar** último build en GitHub Actions → Deploy Frontend
2. **Revisar** Cloudflare Pages → Deployments → Logs
3. **Verificar** DNS en Cloudflare Dashboard → DNS
4. **Rollback** a deployment anterior en Pages Dashboard
5. **Verificar** variables de entorno en Pages Settings:
   - `API_URL` apunta a worker correcto
   - `FRONTEND_URL` coincide con CORS en worker

---

## 📋 Checklist Post-Incidente

Después de resolver CUALQUIER incidente SEV-1/SEV-2:

- [ ] **Root Cause Analysis** documentado en GitHub Issue
- [ ] **Timeline** reconstruido (detección → resolución)
- [ ] **Impacto** cuantificado (usuarios afectados, revenue, datos)
- [ ] **Acciones correctivas** asignadas con dueño y fecha
- [ ] **Monitoreo mejorado** para detectar antes
- [ ] **Runbook actualizado** si hubo gaps
- [ ] **Comunicación a stakeholders** (interno + usuarios si público)

---

## 📊 Métricas de Salud (Monitoreo Continuo)

| Métrica | Umbral Alerta | Herramienta |
|---------|---------------|-------------|
| API Error Rate (5xx) | > 1% / 5 min | Cloudflare Workers Metrics |
| API Latency (p95) | > 2000 ms | Cloudflare Workers Metrics |
| D1 CPU/Storage | > 80% cuota | Cloudflare D1 Dashboard |
| KV Operations | > 80% cuota | Cloudflare KV Dashboard |
| Email Queue Backlog | > 100 pending | `npx wrangler d1 execute...` |
| Failed Login Rate | > 50/min | `failed_attempts` table |
| Active Sessions | < esperado | `sessions` table |

---

## 🔗 Enlaces Rápidos

- **Cloudflare Dashboard:** https://dash.cloudflare.com
- **Workers Logs:** `npx wrangler tail`
- **D1 Console:** `npx wrangler d1 execute mastercelular-db --remote --command "..."`
- **GitHub Actions:** https://github.com/sectorx047-celulares/mastercelular/actions
- **Brevo Dashboard:** https://app.brevo.com
- **Resend Dashboard:** https://resend.com/dashboard

---

## 📝 Historial de Incidentes Mayores

| Fecha | Severidad | Tipo | Resumen | RCA Link |
|-------|-----------|------|---------|----------|
| 2026-11-12 | - | - | Plantilla creada | - |

---

**Última actualización:** 2026-11-12  
**Próxima revisión:** 2027-02-12 (trimestral)  
**Responsable:** Tech Lead