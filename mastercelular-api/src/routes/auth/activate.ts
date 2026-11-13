// mastercelular-api/src/routes/auth/activate.ts
// POST /api/auth/activate — Canjear código de activación (pasa a FULL)
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../../types';
import { requireAuth, getTokenHash } from '../../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; whatsapp: string; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

const activateSchema = z.object({
  course_id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  code: z.string().min(1).max(40).regex(/^[A-Z0-9-]+$/),
});

app.post('/activate', requireAuth(), zValidator('json', activateSchema), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { course_id, code } = c.req.valid('json');
  const user = c.get('user');

  try {
    // Verificar curso activo
    const course = await c.env.DB.prepare(
      `SELECT id, code_prefix FROM courses WHERE id = ? AND is_active = 1`
    ).bind(course_id).first<{ id: string; code_prefix: string }>();

    if (!course) {
      return c.json({
        ok: false,
        codigo: 'CURSO_NO_DISPONIBLE',
        mensaje: 'Este curso no está disponible.',
        request_id: requestId,
      }, 404);
    }

    // Rate limiting por usuario
    const rateLimitKey = `activar:${user.whatsapp}`;
    const rateLimit = await checkRateLimit(c.env, rateLimitKey, 5, 15 * 60 * 1000);
    if (!rateLimit.allowed) {
      return c.json({
        ok: false,
        codigo: 'BLOQUEADO',
        mensaje: `Demasiados intentos. Espera ${rateLimit.retryAfter} minutos.`,
        minutos_espera: rateLimit.retryAfter,
        request_id: requestId,
      }, 429);
    }

    // Rate limiting global
    const globalRateLimit = await checkRateLimit(c.env, 'activar:global', 100, 15 * 60 * 1000);
    if (!globalRateLimit.allowed) {
      return c.json({
        ok: false,
        codigo: 'BLOQUEADO',
        mensaje: 'Hay demasiados intentos de activación. Intenta en unos minutos.',
        request_id: requestId,
      }, 429);
    }

    // Verificar código (HMAC-SHA256 con pepper)
    const pepper = c.env.AUTH_SECRET; // Usar AUTH_SECRET como pepper
    const codeHash = await hmacSha256(code.toUpperCase().replace(/\s+/g, ''), pepper);

    const activationCode = await c.env.DB.prepare(
      `SELECT id, status, course_id FROM activation_codes WHERE code_hash = ?`
    ).bind(codeHash).first<{ id: number; status: string; course_id: string }>();

    if (!activationCode || activationCode.course_id !== course_id || activationCode.status !== 'AVAILABLE') {
      await recordFailedAttempt(c.env, rateLimitKey);
      await recordFailedAttempt(c.env, 'activar:global');
      await auditLog(c.env, user.whatsapp, 'activar', course_id, 'FALLO', '', c.req.raw);
      return c.json({
        ok: false,
        codigo: 'CODIGO_INVALIDO',
        mensaje: 'El código no es válido, ya fue usado o no corresponde a este curso.',
        request_id: requestId,
      }, 400);
    }

    // Verificar si ya tiene acceso FULL
    const enrollment = await c.env.DB.prepare(
      `SELECT id, access_type FROM enrollments WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, course_id).first<{ id: number; access_type: string }>();

    if (enrollment && enrollment.access_type === 'FULL') {
      return c.json({
        ok: false,
        codigo: 'YA_ACTIVO',
        mensaje: 'Este curso ya está activo en tu cuenta.',
        request_id: requestId,
      }, 400);
    }

    // Marcar código como USADO
    await c.env.DB.prepare(
      `UPDATE activation_codes SET status = 'USED', assigned_to_user_id = ?, used_at = datetime('now') WHERE id = ?`
    ).bind(user.user_id, activationCode.id).run();

    // Actualizar o crear inscripción FULL
    if (enrollment) {
      await c.env.DB.prepare(
        `UPDATE enrollments SET access_type = 'FULL', origin = 'code', activated_at = datetime('now') WHERE id = ?`
      ).bind(enrollment.id).run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO enrollments (user_id, course_id, access_type, origin, activated_at, created_at)
         VALUES (?, ?, 'FULL', 'code', datetime('now'), datetime('now'))`
      ).bind(user.user_id, course_id).run();
    }

    await clearRateLimit(c.env, rateLimitKey);
    await auditLog(c.env, user.whatsapp, 'activar', course_id, 'OK', '', c.req.raw);

    return c.json({
      ok: true,
      course_id,
      access: 'FULL',
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /auth/activate:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo activar el código. Intenta de nuevo.',
      request_id: requestId,
    }, 500);
  }
});

// Helpers
async function hmacSha256(text: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
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

async function auditLog(env: Env, whatsapp: string, action: string, courseId: string, result: string, detail: string, request: Request) {
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
      `INSERT INTO audit_logs (whatsapp, action, course_id, result, detail, ip_hash, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(whatsapp, action, courseId, result, detail, ipHash, request.headers.get('user-agent') || 'unknown').run();
  } catch {
    // Auditoría nunca debe romper la operación
  }
}

export default app;