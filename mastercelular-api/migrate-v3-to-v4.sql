-- Migration from v3 (whatsapp-based) to v4 (email-based) schema
-- Run on remote D1 database

-- 1. Add email column
ALTER TABLE users ADD COLUMN email TEXT;

-- 2. Populate email for existing users (using whatsapp as base)
UPDATE users SET email = whatsapp || '@placeholder.com' WHERE email IS NULL;

-- 3. Make email NOT NULL and add UNIQUE constraint
-- SQLite doesn't support ALTER COLUMN, need to recreate table
-- But first, let's add unique index
CREATE UNIQUE INDEX idx_users_email ON users(email);

-- 4. Make whatsapp nullable (remove NOT NULL)
-- SQLite doesn't support ALTER COLUMN NOT NULL, need to recreate
-- We'll handle this by creating new table and copying data

-- 5. Update audit_logs to have email column (should already exist from schema.sql)
-- Check if email column exists in audit_logs
-- If not, add it
-- Note: schema.sql already has email column in audit_logs