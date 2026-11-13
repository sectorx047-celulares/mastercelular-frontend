-- ============================================================================
-- SEED DATA - Datos iniciales para desarrollo/producción
-- ============================================================================
-- Ejecutar DESPUÉS de schema.sql:
-- npx wrangler d1 execute mastercelular-db --remote --file=./seed.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USUARIO ADMIN (hasheado con PBKDF2 - password temporal: "Admin123!")
-- Cambiar contraseña en primer login
-- ---------------------------------------------------------------------------
-- Hash generado con: PBKDF2-SHA256, 100000 iteraciones, salt aleatorio
-- Para generar uno nuevo, usa el script de registro del backend

-- ---------------------------------------------------------------------------
-- CÓDIGOS DE ACTIVACIÓN DE PRUEBA (para testing)
-- Formato: CEL-XXXX-XXXX-XXXX
-- Estos son ejemplos - en producción usa generarCodigos_() del backend
-- ---------------------------------------------------------------------------

-- Ejemplo de lote de códigos para testing (hashes calculados offline)
-- En producción real, usa el endpoint /api/admin/generate-codes

-- ---------------------------------------------------------------------------
-- CONFIGURACIÓN ADICIONAL DE APP_CONFIG
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO app_config (key, value, description) VALUES
('admin_email', 'sectorx047@gmail.com', 'Email del administrador'),
('default_country', 'pe', 'País por defecto (pe/ve)'),
('maintenance_mode', 'false', 'Modo mantenimiento'),
('max_free_lessons_per_course', '2', 'Clases gratis por curso'),
('code_expiry_days', '365', 'Días antes de expirar códigos no usados');

-- ---------------------------------------------------------------------------
-- VERIFICACIÓN POST-SEED
-- ---------------------------------------------------------------------------
-- SELECT * FROM courses WHERE is_active = 1;
-- SELECT * FROM app_config;
-- SELECT course_id, status, COUNT(*) FROM activation_codes GROUP BY course_id, status;