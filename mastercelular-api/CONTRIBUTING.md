# Contributing to MasterCelulares API

Thank you for your interest in contributing! This document outlines the process for contributing to the MasterCelulares backend API.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ (LTS)
- Cloudflare account with Workers, D1, KV access
- Wrangler CLI: `npm install -g wrangler@latest`

### Local Development Setup

```bash
# 1. Clone and navigate
cd mastercelular-api

# 2. Install dependencies
npm ci

# 3. Login to Cloudflare
npx wrangler login

# 4. Create local D1 database
npx wrangler d1 create mastercelular-db

# 5. Update wrangler.toml with your local database_id
# (wrangler will output the ID after creation)

# 6. Run migrations locally
npm run d1:local

# 7. (Optional) Seed with test data
npm run d1:seed:local

# 8. Set local secrets
npx wrangler secret put JWT_SECRET --env local
npx wrangler secret put AUTH_SECRET --env local
npx wrangler secret put BREVO_API_KEY --env local
npx wrangler secret put RESEND_API_KEY --env local

# 9. Start development server
npm run dev
```

### Running Tests

```bash
# Run all tests with coverage
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npx vitest run src/__tests__/auth.test.ts
```

### Linting & Type Checking

```bash
# Run ESLint
npm run lint

# TypeScript type check
npx tsc --noEmit
```

## 📋 Development Workflow

### 1. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes
- Write code following the existing patterns
- Add tests for new functionality
- Update documentation if needed
- Run lint, typecheck, and tests locally

### 3. Commit Changes
```bash
# Use conventional commits
git add .
git commit -m "feat: add new endpoint for course materials"
```

**Commit Message Format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding/updating tests
- `chore:` - Maintenance tasks
- `security:` - Security improvements

### 4. Push and Create PR
```bash
git push origin feature/your-feature-name
# Open PR on GitHub
```

### 5. PR Requirements
Before merging, PR must pass:
- ✅ All CI checks (lint, typecheck, tests, security audit)
- ✅ Preview deployment works
- ✅ At least 1 approval (if required by branch protection)
- ✅ No merge conflicts with main

## 🏗️ Architecture Overview

```
mastercelular-api/
├── src/
│   ├── index.ts          # Main Hono application (all routes)
│   └── __tests__/        # Unit & integration tests
├── schema.sql            # D1 database schema
├── seed.sql              # Test data (optional)
├── wrangler.toml         # Cloudflare Worker config
├── package.json          # Dependencies & scripts
├── tsconfig.json         # TypeScript config
├── vitest.config.ts      # Test config
├── eslint.config.js      # ESLint config
├── DEPLOYMENT.md         # Deployment guide
├── CHANGELOG.md          # Version history
└── CONTRIBUTING.md       # This file
```

### Key Technologies
- **Runtime**: Cloudflare Workers (V8 isolates)
- **Framework**: Hono.js (fast, lightweight)
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV
- **Email**: Brevo (primary) + Resend (fallback)
- **Auth**: JWT (HS256) + PBKDF2-SHA256
- **Testing**: Vitest + mock D1/KV
- **Linting**: ESLint + TypeScript ESLint

## 📝 Code Style Guidelines

### TypeScript
- Use strict mode (`strict: true` in tsconfig)
- Prefer `interface` over `type` for object shapes
- Use explicit return types for public functions
- Avoid `any` - use `unknown` or proper types
- Use Zod for runtime validation

### Database
- All queries use parameterized statements (`?` placeholders)
- Never concatenate SQL strings
- Use transactions for multi-step operations
- Index foreign keys and frequently queried columns

### Security
- Never log sensitive data (passwords, tokens, emails)
- Hash all tokens before storing (SHA-256)
- Use constant-time comparison for secrets
- Validate all inputs with Zod schemas
- Rate limit sensitive endpoints

### Testing
- Test file naming: `*.test.ts`
- Place tests in `src/__tests__/`
- Mock external dependencies (fetch, crypto, D1, KV)
- Aim for >50% coverage on new code
- Test both success and failure paths

## 🔒 Security Guidelines

### Secrets Management
- **NEVER** commit secrets to git
- Use `wrangler secret put` for all sensitive values
- Rotate secrets periodically
- Use different secrets for each environment

### Common Security Patterns in Codebase
```typescript
// ✅ Good: Parameterized query
await db.prepare('SELECT * FROM users WHERE whatsapp = ?').bind(whatsapp).first();

// ❌ Bad: String concatenation
await db.prepare(`SELECT * FROM users WHERE whatsapp = '${whatsapp}'`).first();

// ✅ Good: Hash tokens before storage
const tokenHash = await hashToken(token);
await db.prepare('INSERT INTO sessions (token_hash, ...) VALUES (?)').bind(tokenHash).run();

// ✅ Good: Rate limiting
const { allowed, retryAfter } = await checkRateLimit(env, key, max, window);
if (!allowed) return c.json({ error: 'Too many requests' }, 429);
```

## 📦 Release Process

Releases are automated via GitHub Actions on merge to `main`:

1. Quality gate passes (lint, typecheck, tests, audit)
2. Worker deployed to Cloudflare
3. Version bumped (patch)
4. CHANGELOG.md updated
5. Git tag created (`v1.0.1`)
6. Changes pushed to main

### Manual Release (if needed)
```bash
npm version patch  # or minor/major
git push origin main --tags
```

## 🐛 Reporting Issues

### Bug Reports
Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (local/staging/prod)
- Relevant logs (use `npx wrangler tail`)

### Security Issues
**DO NOT** open public issues for security vulnerabilities.
Email: security@mastercelulares.com (or create private security advisory on GitHub)

## 📚 Useful Commands

```bash
# View live logs
npx wrangler tail

# View errors only
npx wrangler tail --status=error

# Run SQL query on remote DB
npx wrangler d1 execute mastercelular-db --remote --command "SELECT * FROM users LIMIT 5;"

# Export remote DB backup
npx wrangler d1 export mastercelular-db --output=backup.sql

# List secrets
npx wrangler secret list

# Deploy preview (for testing)
npm run deploy:preview
```

## 🤝 Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- No harassment or discrimination

## 📞 Getting Help

- Check `DEPLOYMENT.md` for deployment issues
- Review `schema.sql` for database questions
- Check Cloudflare Workers docs: https://developers.cloudflare.com/workers/
- Open a GitHub issue for bugs/features

---

**Happy coding!** 🎉