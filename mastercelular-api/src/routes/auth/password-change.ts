// mastercelular-api/src/routes/auth/password-change.ts
// POST /api/auth/password/change — Cambiar contraseña (requiere sesión válida)
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../../types';
import { requireAuth, getTokenHash } from '../../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; whatsapp: string; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

const passwordChangeSchema = z.object({
  current: z.string().min(1).max(72),
  new: z.string().min(6).max(72),
});

app.post('/password/change', requireAuth(), zValidator('json', passwordChangeSchema), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { current, new: newPassword } = c.req.valid('json');
  const user = c.get('user');
  const tokenHash = c.get('tokenHash');

  try {
    if (current === newPassword) {
      return c.json({
        ok: false,
        codigo: 'DATOS_INVALIDOS',
        mensaje: 'La nueva contraseña debe ser distinta a la actual.',
        request_id: requestId,
      }, 400);
    }

    // Rate limiting
    const rateLimitKey = `login:${user.whatsapp}`;
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

    // Obtener usuario y verificar contraseña actual
    const dbUser = await c.env.DB.prepare(
      `SELECT id, password_hash, salt FROM users WHERE id = ?`
    ).bind(user.user_id).first<{ id: number; password_hash: string; salt: string }>();

    if (!dbUser || !(await verifyPassword(current, dbUser.password_hash, dbUser.salt))) {
      await recordFailedAttempt(c.env, rateLimitKey);
      await auditLog(c.env, user.whatsapp, 'cambiar_password', '', 'FALLO', '', c.req.raw);
      return c.json({
        ok: false,
        codigo: 'CREDENCIALES',
        mensaje: 'La contraseña actual no es correcta.',
        request_id: requestId,
      }, 401);
    }

    // Hashear nueva contraseña
    const { hash, salt } = await hashPassword(newPassword);

    // Actualizar usuario
    await c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?`
    ).bind(hash, salt, user.user_id).run();

    // Revocar otras sesiones (mantener la actual)
    await c.env.DB.prepare(
      `UPDATE sessions SET expires_at = datetime('now') WHERE user_id = ? AND token_hash != ?`
    ).bind(user.user_id, tokenHash).run();

    await clearRateLimit(c.env, rateLimitKey);
    await auditLog(c.env, user.whatsapp, 'cambiar_password', '', 'OK', '', c.req.raw);

    return c.json({ ok: true, request_id: requestId });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /auth/password/change:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo cambiar la contraseña. Intenta de nuevo.',
      request_id: requestId,
    }, 500);
  }
});

// Helpers
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