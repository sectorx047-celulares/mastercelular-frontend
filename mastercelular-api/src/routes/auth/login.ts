// mastercelular-api/src/routes/auth/login.ts
// POST /api/auth/login — Login con email + contraseña
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../../types';
import { createJWT } from '../../utils/jwt';

const app = new Hono<{ Bindings: Env }>();

const loginSchema = z.object({
  email: z.string().email().max(100),
  password: z.string().min(1).max(72),
});

app.post('/login', zValidator('json', loginSchema), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { email, password } = c.req.valid('json');

  try {
    // Rate limiting por email
    const rateLimitKey = `login:${email}`;
    const rateLimit = await checkRateLimit(c.env, rateLimitKey, 5, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      await auditLog(c.env, email, 'login', '', 'BLOQUEADO', `Rate limit excedido`, c.req.raw);
      return c.json({
        ok: false,
        codigo: 'BLOQUEADO',
        mensaje: `Demasiados intentos. Espera ${rateLimit.retryAfter} minutos.`,
        minutos_espera: rateLimit.retryAfter,
        request_id: requestId,
      }, 429);
    }

    // Buscar usuario por email
    const user = await c.env.DB.prepare(
      `SELECT id, email, whatsapp, name, password_hash, salt, must_change_password, status
       FROM users WHERE email = ?`
    ).bind(email).first<{
      id: number;
      email: string;
      whatsapp: string | null;
      name: string;
      password_hash: string;
      salt: string;
      must_change_password: number;
      status: string;
    }>();

    if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash, user.salt))) {
      await recordFailedAttempt(c.env, rateLimitKey);
      await auditLog(c.env, email, 'login', '', 'FALLO', '', c.req.raw);
      return c.json({
        ok: false,
        codigo: 'CREDENCIALES',
        mensaje: 'Email o contraseña incorrectos.',
        request_id: requestId,
      }, 401);
    }

    // Limpiar rate limit y actualizar último acceso
    await clearRateLimit(c.env, rateLimitKey);
    await c.env.DB.prepare(
      `UPDATE users SET last_login_at = datetime('now') WHERE id = ?`
    ).bind(user.id).run();

    await auditLog(c.env, email, 'login', '', 'OK', '', c.req.raw);

    // Obtener cursos del usuario
    const courses = await c.env.DB.prepare(
      `SELECT e.course_id, e.access_type
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND c.is_active = 1`
    ).bind(user.id).all<{ course_id: string; access_type: string }>();

    const token = await createJWT(
      { user_id: user.id, email: user.email, name: user.name, whatsapp: user.whatsapp },
      c.env.JWT_SECRET,
      parseInt(c.env.JWT_EXPIRY_HOURS || '720', 10)
    );

    return c.json({
      ok: true,
      token,
      expira: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      name: user.name,
      email: user.email,
      whatsapp: user.whatsapp,
      must_change: user.must_change_password === 1,
      courses: courses.results.map(c => ({ curso_id: c.course_id, acceso: c.access_type })),
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /auth/login:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo procesar el login. Intenta de nuevo.',
      request_id: requestId,
    }, 500);
  }
});

// Helpers (duplicados de register.ts - mover a services/ en Fase 1 completa)
async function checkRateLimit(env: Env, key: string, maxAttempts: number, windowMs: number): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  const record = await env.DB.prepare(
    `SELECT attempts, window_start, blocked_until FROM failed_attempts WHERE key = ?`
  ).bind(key).first<{ attempts: number; window_start: string; blocked_until: string | null }>();

  if (record) {
    const blockedUntil = record.blocked_until ? new Date(record.blocked_until).getTime() : 0;
    if (blockedUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((blockedUntil - now) / 1000 / 60) };
    }

    if (new Date(record.window_start).getTime() < windowStart) {
      await env.DB.prepare(
        `UPDATE failed_attempts SET attempts = 1, window_start = datetime('now'), blocked_until = NULL WHERE key = ?`
      ).bind(key).run();
      return { allowed: true };
    }

    if (record.attempts >= maxAttempts) {
      const blockedUntil = new Date(now + 15 * 60 * 1000).toISOString();
      await env.DB.prepare(
        `UPDATE failed_attempts SET attempts = attempts + 1, blocked_until = ? WHERE key = ?`
      ).bind(blockedUntil, key).run();
      return { allowed: false, retryAfter: 15 };
    }

    await env.DB.prepare(
      `UPDATE failed_attempts SET attempts = attempts + 1 WHERE key = ?`
    ).bind(key).run();
    return { allowed: true };
  }

  await env.DB.prepare(
    `INSERT INTO failed_attempts (key, attempts, window_start) VALUES (?, 1, datetime('now'))`
  ).bind(key).run();
  return { allowed: true };
}

async function recordFailedAttempt(env: Env, key: string) {
  const record = await env.DB.prepare(
    `SELECT attempts, window_start, blocked_until FROM failed_attempts WHERE key = ?`
  ).bind(key).first<{ attempts: number; window_start: string; blocked_until: string | null }>();

  if (record) {
    const now = Date.now();
    const windowStart = new Date(record.window_start).getTime();
    if (now - windowStart > 15 * 60 * 1000) {
      await env.DB.prepare(
        `UPDATE failed_attempts SET attempts = 1, window_start = datetime('now') WHERE key = ?`
      ).bind(key).run();
    } else {
      await env.DB.prepare(
        `UPDATE failed_attempts SET attempts = attempts + 1 WHERE key = ?`
      ).bind(key).run();
    }
  } else {
    await env.DB.prepare(
      `INSERT INTO failed_attempts (key, attempts, window_start) VALUES (?, 1, datetime('now'))`
    ).bind(key).run();
  }
}

async function clearRateLimit(env: Env, key: string) {
  await env.DB.prepare(`UPDATE failed_attempts SET attempts = 0 WHERE key = ?`).bind(key).run();
}

async function verifyPassword(password: string, storedHash: string, salt: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 2) return false;
  const iterations = parseInt(parts[0], 10);
  if (!iterations) return false;
  const hash = await pbkdf2Hash(password, salt, iterations);
  return hash === parts[1];
}

async function pbkdf2Hash(password: string, salt: string, iterations: number): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function auditLog(env: Env, email: string, action: string, courseId: string, result: string, detail: string, request: Request) {
  try {
    const cf = request.cf as any;
    const ip = cf?.connecting_ip || 'unknown';
    let hash = 0;
    for (let i = 0; i < ip.length; i++) {
      hash = ((hash << 5) - hash) + ip.charCodeAt(i);
      hash |= 0;
    }
    const ipHash = Math.abs(hash).toString(16);

    await env.DB.prepare(
      `INSERT INTO audit_logs (email, action, course_id, result, detail, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(email, action, courseId, result, detail, ipHash, request.headers.get('user-agent') || 'unknown').run();
  } catch {
    // Auditoría nunca debe romper la operación
  }
}

export default app;