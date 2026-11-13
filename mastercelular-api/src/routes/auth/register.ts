// mastercelular-api/src/routes/auth/register.ts
// POST /api/auth/register — Registro de usuario + inscripción GRATIS
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../../types';
import { sendWelcomeEmail, createJWT } from '../../index';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; email: string; whatsapp: string | null; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

const registerSchema = z.object({
  course_id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(60).regex(/^[\p{L}\p{M} .'\-]+$/u),
  email: z.string().email().max(100),
  password: z.string().min(6).max(72),
  country: z.enum(['PE', 'VE']).default('PE'),
  whatsapp: z.string().min(10).max(15).regex(/^\d+$/).optional(),
  origin: z.string().max(40).optional().default('directo'),
});

app.post('/register', zValidator('json', registerSchema), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { course_id, name, email, password, country, whatsapp, origin } = c.req.valid('json');

  try {
    // Verificar curso activo
    const course = await c.env.DB.prepare(
      `SELECT id, name, seller_name FROM courses WHERE id = ? AND is_active = 1`
    ).bind(course_id).first<{ id: string; name: string; seller_name: string }>();

    if (!course) {
      return c.json({
        ok: false,
        codigo: 'CURSO_NO_DISPONIBLE',
        mensaje: 'Este curso no está disponible.',
        request_id: requestId,
      }, 404);
    }

    // Rate limiting por email
    const rateLimitKey = `login:${email}`;
    const rateLimit = await checkRateLimit(c.env, rateLimitKey, 5, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      await auditLog(c.env, email, 'registrar', course_id, 'BLOQUEADO', `Rate limit excedido`, c.req.raw);
      return c.json({
        ok: false,
        codigo: 'BLOQUEADO',
        mensaje: `Demasiados intentos. Espera ${rateLimit.retryAfter} minutos.`,
        minutos_espera: rateLimit.retryAfter,
        request_id: requestId,
      }, 429);
    }

    // Buscar usuario existente por email
    const existingUser = await c.env.DB.prepare(
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

    if (existingUser) {
      // Usuario existe: verificar contraseña
      const passwordOk = await verifyPassword(password, existingUser.password_hash, existingUser.salt);
      if (!passwordOk) {
        await recordFailedAttempt(c.env, rateLimitKey);
        await auditLog(c.env, email, 'registrar', course_id, 'FALLO', 'cuenta existente, contraseña incorrecta', c.req.raw);
        return c.json({
          ok: false,
          codigo: 'CUENTA_EXISTENTE',
          mensaje: 'Este email ya tiene cuenta. Entra con tu contraseña para inscribirte en este curso.',
          request_id: requestId,
        }, 400);
      }

      if (existingUser.status !== 'active') {
        await auditLog(c.env, email, 'registrar', course_id, 'FALLO', 'cuenta bloqueada', c.req.raw);
        return c.json({
          ok: false,
          codigo: 'CUENTA_BLOQUEADA',
          mensaje: 'Esta cuenta está bloqueada. Escríbenos por WhatsApp.',
          request_id: requestId,
        }, 403);
      }

      // Verificar si ya está inscrito
      const existingEnrollment = await c.env.DB.prepare(
        `SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?`
      ).bind(existingUser.id, course_id).first();

      if (existingEnrollment) {
        await auditLog(c.env, email, 'registrar', course_id, 'FALLO', 'ya inscrito', c.req.raw);
        return c.json({
          ok: false,
          codigo: 'YA_INSCRITO',
          mensaje: 'Ya estás inscrito en este curso. Entra con tu email y contraseña.',
          request_id: requestId,
        }, 400);
      }

      // Actualizar whatsapp si se proporciona y no tiene
      if (whatsapp && !existingUser.whatsapp) {
        await c.env.DB.prepare(
          `UPDATE users SET whatsapp = ? WHERE id = ?`
        ).bind(whatsapp, existingUser.id).run();
      }

      // Inscribir usuario existente al curso (GRATIS)
      await c.env.DB.prepare(
        `INSERT INTO enrollments (user_id, course_id, access_type, origin, created_at)
         VALUES (?, ?, 'FREE', ?, datetime('now'))`
      ).bind(existingUser.id, course_id, origin).run();

      await clearRateLimit(c.env, rateLimitKey);
      await auditLog(c.env, email, 'registrar', course_id, 'OK', 'vinculado a curso', c.req.raw);

      const token = await createJWT(
        { user_id: existingUser.id, email: existingUser.email, name: existingUser.name, whatsapp: existingUser.whatsapp },
        c.env.JWT_SECRET,
        parseInt(c.env.JWT_EXPIRY_HOURS || '720', 10)
      );
      return c.json({
        ok: true,
        token,
        expira: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        name: existingUser.name,
        email: existingUser.email,
        whatsapp: existingUser.whatsapp,
        course_id,
        must_change: existingUser.must_change_password === 1,
        request_id: requestId,
      });
    }

    // Usuario nuevo: crear cuenta + inscripción GRATIS
    const { hash, salt } = await hashPassword(password);

    const userResult = await c.env.DB.prepare(
      `INSERT INTO users (email, whatsapp, name, country_code, password_hash, salt, must_change_password, status, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'active', datetime('now'), datetime('now'))
       RETURNING id`
    ).bind(email, whatsapp || null, name, country, hash, salt).first<{ id: number }>();

    if (!userResult) {
      throw new Error('Error creando usuario');
    }

    const userId = userResult.id;

    await c.env.DB.prepare(
      `INSERT INTO enrollments (user_id, course_id, access_type, origin, created_at)
       VALUES (?, ?, 'FREE', ?, datetime('now'))`
    ).bind(userId, course_id, origin).run();

    await auditLog(c.env, email, 'registrar', course_id, 'OK', 'cuenta nueva', c.req.raw);

    // Enviar email de bienvenida (async, no bloquear respuesta)
    c.executionCtx.waitUntil(
      sendWelcomeEmail(c.env, email, name, course.name, course.seller_name)
        .then(r => console.log(`[${requestId}] Welcome email: ${r.success ? 'sent via ' + r.provider : 'failed: ' + r.error}`))
        .catch(e => console.error(`[${requestId}] Welcome email error:`, e))
    );

    const token = await createJWT(
      { user_id: userId, email, name, whatsapp: whatsapp || null },
      c.env.JWT_SECRET,
      parseInt(c.env.JWT_EXPIRY_HOURS || '720', 10)
    );
    return c.json({
      ok: true,
      token,
      expira: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      name,
      email,
      whatsapp: whatsapp || null,
      course_id,
      must_change: false,
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /auth/register:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo procesar el registro. Intenta de nuevo.',
      request_id: requestId,
    }, 500);
  }
});

// Helpers locales (mover a services/ en Fase 1 completa)
async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomUUID().replace(/-/g, '');
  const iterations = 100000;
  const hash = await pbkdf2Hash(password, salt, iterations);
  return { hash: `${iterations}$${hash}`, salt };
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