-- Recreate users table with whatsapp nullable and email as primary identifier
-- Drop dependent views first
DROP VIEW IF EXISTS v_user_courses;
DROP VIEW IF EXISTS v_user_progress;
DROP VIEW IF EXISTS v_code_stats;
DROP VIEW IF EXISTS v_pending_emails;

CREATE TABLE users_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    whatsapp TEXT UNIQUE,
    name TEXT NOT NULL,
    country_code TEXT NOT NULL DEFAULT 'PE',
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT,
    CONSTRAINT chk_country CHECK (country_code IN ('PE', 'VE')),
    CONSTRAINT chk_status CHECK (status IN ('active', 'blocked', 'deleted'))
);

-- Copy data from old table
INSERT INTO users_new (id, email, whatsapp, name, country_code, password_hash, salt, must_change_password, status, created_at, last_login_at)
SELECT id, email, whatsapp, name, country_code, password_hash, salt, must_change_password, status, created_at, last_login_at
FROM users;

-- Drop old table
DROP TABLE users;

-- Rename new table
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users(whatsapp);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_code);

-- Recreate views
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

CREATE VIEW IF NOT EXISTS v_user_progress AS
SELECT
    p.user_id,
    p.course_id,
    COUNT(p.lesson_id) AS lessons_watched,
    COALESCE(SUM(p.watch_duration_seconds), 0) AS total_watch_seconds,
    MAX(p.watched_at) AS last_activity
FROM progress p
GROUP BY p.user_id, p.course_id;

CREATE VIEW IF NOT EXISTS v_code_stats AS
SELECT
    course_id,
    status,
    COUNT(*) AS count
FROM activation_codes
GROUP BY course_id, status;

CREATE VIEW IF NOT EXISTS v_pending_emails AS
SELECT *
FROM email_queue
WHERE status IN ('pending', 'retrying')
  AND scheduled_at <= datetime('now')
  AND attempts < max_attempts
ORDER BY scheduled_at ASC;