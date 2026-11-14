// mastercelular-api/src/routes/badges.ts
// POST /api/badges — Registrar medalla (25, 50, 75, 100%)
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; whatsapp: string; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

const badgeSchema = z.object({
  course_id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  milestone: z.number().int().refine(v => [25, 50, 75, 100].includes(v), 'Hito no válido'),
});

app.post('/badges', requireAuth(), zValidator('json', badgeSchema, (result, c) => {
  if (!result.success) {
    const requestId = crypto.randomUUID().slice(0, 8);
    const messages = result.error.issues.map((issue) => {
      const path = issue.path?.join('.') || 'campo';
      return `${path}: ${issue.message}`;
    }).join('; ');
    return c.json({
      ok: false,
      codigo: 'VALIDACION',
      mensaje: messages || 'Datos de entrada inválidos.',
      request_id: requestId,
    }, 400);
  }
}), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { course_id, milestone } = c.req.valid('json');
  const user = c.get('user');

  try {
    // Verificar inscripción
    const enrollment = await c.env.DB.prepare(
      `SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, course_id).first();

    if (!enrollment) {
      return c.json({ ok: false, codigo: 'NO_INSCRITO', mensaje: 'Aún no estás inscrito en este curso.', request_id: requestId }, 403);
    }

    // Contar total de lecciones y vistas
    const totalResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM lessons WHERE course_id = ?`
    ).bind(course_id).first<{ total: number }>();

    const watchedResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as watched FROM progress WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, course_id).first<{ watched: number }>();

    const total = totalResult?.total || 0;
    const watched = watchedResult?.watched || 0;
    const percentage = total ? Math.floor((watched / total) * 100) : 0;

    if (percentage < milestone) {
      return c.json({ ok: false, codigo: 'NO_ALCANZADO', mensaje: 'Aún no alcanzas esta medalla.', request_id: requestId }, 400);
    }

    // Verificar si ya tiene la medalla
    const existing = await c.env.DB.prepare(
      `SELECT id FROM badges WHERE user_id = ? AND course_id = ? AND milestone = ?`
    ).bind(user.user_id, course_id, milestone).first();

    let nueva = false;
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO badges (user_id, course_id, milestone, earned_at)
         VALUES (?, ?, ?, datetime('now'))`
      ).bind(user.user_id, course_id, milestone).run();
      nueva = true;
    }

    return c.json({ ok: true, milestone, nueva, request_id: requestId });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /badges:`, e);
    return c.json({ ok: false, codigo: 'ERROR_SERVIDOR', mensaje: 'No se pudo registrar la medalla.', request_id: requestId }, 500);
  }
});

export default app;