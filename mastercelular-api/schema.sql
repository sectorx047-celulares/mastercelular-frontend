-- ============================================================================
-- MasterCelulares · Esquema D1 (SQLite)
-- ============================================================================
-- Ejecutar con: npx wrangler d1 execute mastercelular-db --file=./schema.sql --remote
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. USUARIOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,               -- Email como identificador principal
    whatsapp TEXT UNIQUE,                     -- WhatsApp opcional (solo dígitos, ej. 51916381231)
    name TEXT NOT NULL,                       -- Nombre del alumno (2-60 chars)
    country_code TEXT NOT NULL DEFAULT 'PE',  -- ISO 3166-1 alpha-2: PE, VE
    password_hash TEXT NOT NULL,              -- PBKDF2-SHA256 (iteraciones: 100000)
    salt TEXT NOT NULL,                       -- Salt único por usuario (base64)
    must_change_password INTEGER NOT NULL DEFAULT 0,  -- 0=no, 1=sí (tras reset)
    status TEXT NOT NULL DEFAULT 'active',    -- active, blocked, deleted
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT,
    CONSTRAINT chk_country CHECK (country_code IN ('PE', 'VE')),
    CONSTRAINT chk_status CHECK (status IN ('active', 'blocked', 'deleted'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users(whatsapp);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_code);

-- ---------------------------------------------------------------------------
-- 2. CURSOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,                      -- slug: 'celulares', 'galinas', 'holistica'
    name TEXT NOT NULL,                       -- Nombre visible
    is_active INTEGER NOT NULL DEFAULT 1,     -- 1=activo, 0=inactivo
    code_prefix TEXT NOT NULL,                -- Prefijo códigos: 'CEL', 'GAL', 'HOL'
    drive_folder_url TEXT,                    -- Carpeta Drive del curso completo
    price_cents INTEGER NOT NULL DEFAULT 0,   -- Precio en centavos (ej. 300 = $3.00, 1000 = S/ 10.00)
    currency TEXT NOT NULL DEFAULT 'USD',     -- USD, PEN, VES
    seller_name TEXT NOT NULL,                -- Nombre del vendedor (Miguel, Fanny)
    seller_whatsapp TEXT NOT NULL,            -- WhatsApp del vendedor (normalizado)
    ga_measurement_id TEXT,                   -- GA4 ID (ej. G-VRRMCMTHJY)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT chk_course_active CHECK (is_active IN (0, 1))
);

-- Datos iniciales de cursos
INSERT OR IGNORE INTO courses (id, name, is_active, code_prefix, drive_folder_url, price_cents, currency, seller_name, seller_whatsapp, ga_measurement_id) VALUES
('celulares', 'Curso de Reparación de Celulares desde Cero', 1, 'CEL', 'https://drive.google.com/drive/folders/1Anh-5NARPPzEtpKU72TBGa00Ri12rzhd', 1000, 'PEN', 'Miguel Acevedo', '51916381231', 'G-VRRMCMTHJY'),
('celulares-ve', 'Curso de Reparación de Celulares desde Cero (Venezuela)', 1, 'CEL', 'https://drive.google.com/drive/folders/1Anh-5NARPPzEtpKU72TBGa00Ri12rzhd', 300, 'USD', 'Fanny Ramirez', '584227777688', 'G-VRRMCMTHJY'),
('galinas', 'Gallinas Ponedoras', 1, 'GAL', '', 0, 'USD', 'Fanny Ramirez', '584227777688', ''),
('holistica', 'Holística', 0, 'HOL', '', 0, 'USD', 'Fanny Ramirez', '584227777688', '');

-- ---------------------------------------------------------------------------
-- 3. INSCRIPCIONES (ACCESOS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    access_type TEXT NOT NULL DEFAULT 'FREE',   -- FREE, FULL
    origin TEXT NOT NULL DEFAULT 'direct',      -- direct, code, admin, referral
    activated_at TEXT,                          -- Cuándo pasó a FULL (NULL si FREE)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id),
    CONSTRAINT chk_access_type CHECK (access_type IN ('FREE', 'FULL'))
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_access ON enrollments(access_type);

-- ---------------------------------------------------------------------------
-- 4. CÓDIGOS DE ACTIVACIÓN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activation_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_hash TEXT NOT NULL UNIQUE,             -- HMAC-SHA256 del código (nunca guardar el código plano)
    course_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'AVAILABLE',   -- AVAILABLE, USED, REVOKED
    batch_id TEXT,                              -- Identificador de lote (ej. 'batch-2024-001')
    assigned_to_user_id INTEGER,                -- NULL hasta que se use
    used_at TEXT,                               -- Cuándo se canjeó
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_code_status CHECK (status IN ('AVAILABLE', 'USED', 'REVOKED'))
);

CREATE INDEX IF NOT EXISTS idx_codes_course ON activation_codes(course_id);
CREATE INDEX IF NOT EXISTS idx_codes_status ON activation_codes(status);
CREATE INDEX IF NOT EXISTS idx_codes_batch ON activation_codes(batch_id);

-- Tabla auxiliar para entrega de códigos (se vacía tras entregar)
CREATE TABLE IF NOT EXISTS code_delivery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,                         -- Código EN CLARO solo aquí (para entregar)
    code_hash TEXT NOT NULL,                    -- Referencia al hash en activation_codes
    course_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    delivered_at TEXT,                          -- NULL = pendiente, timestamp = entregado
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (code_hash) REFERENCES activation_codes(code_hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_delivery_pending ON code_delivery(delivered_at) WHERE delivered_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. CLASES (CONTENIDO DEL CURSO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    module TEXT NOT NULL,                       -- Ej. 'Módulo 1', 'Módulo 2'
    title TEXT NOT NULL,                        -- Ej. '1 - Introducción', '2 - Herramientas'
    sort_order INTEGER NOT NULL DEFAULT 0,      -- Orden dentro del módulo
    drive_url TEXT NOT NULL,                    -- URL de Google Drive del video
    is_free INTEGER NOT NULL DEFAULT 0,         -- 1=gratis, 0=de pago
    duration_seconds INTEGER,                   -- Duración opcional en segundos
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    CONSTRAINT chk_lesson_free CHECK (is_free IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons(course_id, module, sort_order);
CREATE INDEX IF NOT EXISTS idx_lessons_free ON lessons(course_id, is_free);

-- ---------------------------------------------------------------------------
-- 6. MATERIALES (PDFs, DIAGRAMAS, RECURSOS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL,
    title TEXT NOT NULL,                        -- Ej. 'Diagramas A10', 'Catálogo Samsung'
    sort_order INTEGER NOT NULL DEFAULT 0,
    drive_url TEXT NOT NULL,                    -- URL de Google Drive
    file_type TEXT DEFAULT 'PDF',               -- PDF, ZIP, etc.
    file_size_bytes INTEGER,                    -- Tamaño opcional
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);

-- ---------------------------------------------------------------------------
-- 7. PROGRESO DEL ALUMNO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    lesson_id INTEGER NOT NULL,
    watched_at TEXT NOT NULL DEFAULT (datetime('now')),
    watch_duration_seconds INTEGER DEFAULT 0,   -- Cuánto vio (para analytics)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE,
    UNIQUE(user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user_course ON progress(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_progress_lesson ON progress(lesson_id);

-- ---------------------------------------------------------------------------
-- 8. NOTAS / APUNTES DEL ALUMNO
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    lesson_id INTEGER NOT NULL,
    timestamp_text TEXT,                        -- Ej. '04:15' (minuto del video)
    content TEXT NOT NULL,                      -- Texto saneado (prefijo ' si empieza con =)
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notes_user_lesson ON notes(user_id, lesson_id);
CREATE INDEX IF NOT EXISTS idx_notes_course ON notes(course_id);

-- ---------------------------------------------------------------------------
-- 9. DESCARGAS DE MATERIALES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    material_id INTEGER NOT NULL,
    downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE,
    UNIQUE(user_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_downloads_user ON downloads(user_id);

-- ---------------------------------------------------------------------------
-- 10. SESIONES (JWT tokens hasheados)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,            -- SHA256(token)
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,                   -- ISO 8601
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    user_agent TEXT,                            -- Para debugging/seguridad
    ip_hash TEXT,                               -- Hash de IP (privacidad)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- 11. INTENTOS FALLIDOS (RATE LIMITING)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS failed_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,                   -- Ej. 'login:51916381231', 'activate:global'
    attempts INTEGER NOT NULL DEFAULT 1,
    window_start TEXT NOT NULL DEFAULT (datetime('now')),
    blocked_until TEXT,                         -- NULL = no bloqueado, timestamp = bloqueado hasta
    CONSTRAINT chk_attempts_positive CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_attempts_key ON failed_attempts(key);
CREATE INDEX IF NOT EXISTS idx_attempts_blocked ON failed_attempts(blocked_until) WHERE blocked_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 12. MEDALLAS / LOGROS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    course_id TEXT NOT NULL,
    milestone INTEGER NOT NULL,                 -- 25, 50, 75, 100 (porcentaje)
    earned_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    UNIQUE(user_id, course_id, milestone),
    CONSTRAINT chk_milestone CHECK (milestone IN (25, 50, 75, 100))
);

CREATE INDEX IF NOT EXISTS idx_badges_user_course ON badges(user_id, course_id);

-- ---------------------------------------------------------------------------
-- 13. COLA DE EMAILS (PARA ENVÍO ASÍNCRONO)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_email TEXT NOT NULL,
    to_name TEXT,
    subject TEXT NOT NULL,
    html_body TEXT NOT NULL,
    text_body TEXT,                             -- Opcional: versión plain text
    provider TEXT NOT NULL DEFAULT 'brevo',     -- 'brevo' o 'resend'
    status TEXT NOT NULL DEFAULT 'pending',     -- pending, sent, failed, retrying
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    scheduled_at TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT chk_email_status CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
    CONSTRAINT chk_provider CHECK (provider IN ('brevo', 'resend'))
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_email_queue_provider ON email_queue(provider);

-- ---------------------------------------------------------------------------
-- 14. AUDITORÍA / LOGS DE SEGURIDAD
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,                            -- NULL si acción anónima
    email TEXT,                                 -- Email relacionado
    whatsapp TEXT,                              -- WhatsApp relacionado (normalizado, opcional)
    action TEXT NOT NULL,                       -- register, login, activate, password_reset, etc.
    course_id TEXT,
    result TEXT NOT NULL,                       -- success, failed, blocked, error
    detail TEXT,                                -- JSON con detalles adicionales
    ip_hash TEXT,                               -- Hash de IP
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_email ON audit_logs(email);
CREATE INDEX IF NOT EXISTS idx_audit_whatsapp ON audit_logs(whatsapp);

-- ---------------------------------------------------------------------------
-- 15. CONFIGURACIÓN DINÁMICA (KEY-VALUE EN BD)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,                        -- JSON string
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Configuraciones por defecto
INSERT OR IGNORE INTO app_config (key, value, description) VALUES
('session_days', '30', 'Días de expiración de sesión'),
('pbkdf2_iterations', '100000', 'Iteraciones PBKDF2 para hash de contraseña'),
('max_login_attempts', '5', 'Máx intentos login antes de bloqueo'),
('max_activation_attempts_global', '100', 'Máx intentos activación global'),
('lockout_minutes', '15', 'Minutos de bloqueo por exceso intentos'),
('min_password_length', '6', 'Longitud mínima contraseña'),
('max_password_length', '72', 'Longitud máxima contraseña'),
('max_name_length', '60', 'Longitud máxima nombre'),
('max_note_length', '1000', 'Longitud máxima nota'),
('code_alphabet', 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', 'Alfabeto para códigos (sin 0,O,1,I,L)'),
('code_segments', '3', 'Número de segmentos en código (ej. CEL-XXXX-XXXX-XXXX)'),
('code_segment_length', '4', 'Longitud de cada segmento'),
-- Configuración por países
('country_pe', '{"name":"Perú","currency":"PEN","price_cents":1000,"payment_method":"Yape/Plin","seller_name":"Miguel Acevedo","seller_whatsapp":"51916381231"}', 'Configuración Perú'),
('country_ve', '{"name":"Venezuela","currency":"USD","price_cents":300,"payment_method":"Pago Móvil","seller_name":"Fanny Ramirez","seller_whatsapp":"584227777688","bank":"Banco de Venezuela","cedula":"20361351"}', 'Configuración Venezuela');

-- ---------------------------------------------------------------------------
-- TRIGGERS PARA ACTUALIZAR TIMESTAMPS
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_users_updated
AFTER UPDATE ON users
BEGIN
    UPDATE users SET last_login_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_courses_updated
AFTER UPDATE ON courses
BEGIN
    UPDATE courses SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_updated
AFTER UPDATE ON notes
BEGIN
    UPDATE notes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- VISTAS ÚTILES
-- ---------------------------------------------------------------------------

-- Vista: Usuario con sus inscripciones y accesos
CREATE VIEW IF NOT EXISTS v_user_courses AS
SELECT
    u.id AS user_id,
    u.email,
    u.whatsapp,
    u.name,
    u.country_code,
    c.id AS course_id,
    c.name AS course_name,
    c.code_prefix,
    c.price_cents,
    c.currency,
    c.seller_name,
    c.seller_whatsapp,
    e.access_type,
    e.activated_at,
    e.created_at AS enrolled_at
FROM users u
JOIN enrollments e ON u.id = e.user_id
JOIN courses c ON e.course_id = c.id
WHERE u.status = 'active' AND c.is_active = 1;

-- Vista: Progreso agregado por usuario/curso
CREATE VIEW IF NOT EXISTS v_user_progress AS
SELECT
    p.user_id,
    p.course_id,
    COUNT(p.lesson_id) AS lessons_watched,
    COALESCE(SUM(p.watch_duration_seconds), 0) AS total_watch_seconds,
    MAX(p.watched_at) AS last_activity
FROM progress p
GROUP BY p.user_id, p.course_id;

-- Vista: Estadísticas de códigos por curso
CREATE VIEW IF NOT EXISTS v_code_stats AS
SELECT
    course_id,
    status,
    COUNT(*) AS count
FROM activation_codes
GROUP BY course_id, status;

-- Vista: Emails pendientes de envío
CREATE VIEW IF NOT EXISTS v_pending_emails AS
SELECT *
FROM email_queue
WHERE status IN ('pending', 'retrying')
  AND scheduled_at <= datetime('now')
  AND attempts < max_attempts
ORDER BY scheduled_at ASC;