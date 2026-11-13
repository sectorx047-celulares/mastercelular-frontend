# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Drive folder access endpoint for paid users (`/api/courses/:courseId/drive-folder`)
- Security messaging in frontend for Drive folder access
- Google Drive folder URL configuration for courses (celulares, celulares-ve)

### Changed
- Updated CI/CD workflows with quality gates (lint, typecheck, tests, security audit)
- Added automated version bumping and changelog generation on deploy

### Security
- Rate limiting on authentication endpoints
- JWT token validation with HS256
- Audit logging for all sensitive operations

## [1.0.0] - 2026-11-12

### Added
- Initial release of MasterCelulares API
- Cloudflare Workers + D1 + KV architecture
- User authentication (register, login, JWT sessions)
- Course enrollment system (FREE/FULL access)
- Activation codes with HMAC verification
- Progress tracking (lessons watched, duration)
- Student notes system
- Materials download tracking
- Badges/achievements (25%, 50%, 75%, 100%)
- Email queue with Brevo + Resend fallback
- Cron job for email processing (every 5 min)
- Google Drive folder access for paid users
- Multi-country support (Perú/VE) with localized pricing
- Audit logging for security events
- Health check endpoints (/health, /api/test-db, /api/test-kv)
- Rate limiting on sensitive endpoints
- Secure headers (CSP, HSTS, etc.)
- CORS restricted to frontend domain
- Internationalization (ES-PE, ES-VE)

### Security
- PBKDF2-SHA256 password hashing (100,000 iterations)
- JWT tokens with 30-day expiry
- Session tokens hashed with SHA-256 in database
- IP hashing for privacy in logs
- Activation codes never stored in plain text (HMAC-SHA256)
- Failed attempts tracking with automatic lockout

### Infrastructure
- GitHub Actions CI/CD for Cloudflare Workers + Pages
- Preview deployments on Pull Requests
- D1 database with 15 tables + views + triggers
- KV namespace for caching
- Wrangler configuration for local and remote development