// mastercelular-api/src/routes/progress.ts
// POST /api/progress — Marcar/desmarcar clase como vista
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

const progressSchema = z.object({
  course_id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  lesson_id: z.number().int().positive(),
  watched: z.boolean(),
});

app.post('/progress', requireAuth(), zValidator('json', progressSchema), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { course_id, lesson_id, watched } = c.req.valid('json');
  const user = c.get('user');

  try {
    // Verificar inscripción
    const enrollment = await c.env.DB.prepare(
      `SELECT access_type FROM enrollments WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, course_id).first<{ access_type: string }>();

    if (!enrollment) {
      return c.json({ ok: false, codigo: 'NO_INSCRITO', mensaje: 'Aún no estás inscrito en este curso.', request_id: requestId }, 403);
    }

    // Verificar que la lección existe y está disponible
    const lesson = await c.env.DB.prepare(
      `SELECT id, is_free FROM lessons WHERE id = ? AND course_id = ?`
    ).bind(lesson_id, course_id).first<{ id: number; is_free: number }>();

    if (!lesson) {
      return c.json({ ok: false, codigo: 'CLASE_NO_EXISTE', mensaje: 'La clase no existe en este curso.', request_id: requestId }, 404);
    }

    const isFull = enrollment.access_type === 'FULL';
    if (lesson.is_free === 0 && !isFull) {
      return c.json({ ok: false, codigo: 'REQUIERE_ACTIVACION', mensaje: 'Esta clase es parte del curso completo.', request_id: requestId }, 403);
    }

    // Upsert progreso
    if (watched) {
      await c.env.DB.prepare(
        `INSERT INTO progress (user_id, course_id, lesson_id, watched_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, lesson_id) DO UPDATE SET watched_at = datetime('now')`
      ).bind(user.user_id, course_id, lesson_id).run();
    } else {
      await c.env.DB.prepare(
        `DELETE FROM progress WHERE user_id = ? AND lesson_id = ?`
      ).bind(user.user_id, lesson_id).run();
    }

    // Devolver lista actualizada de lecciones vistas
    const watchedLessons = await c.env.DB.prepare(
      `SELECT lesson_id FROM progress WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, course_id).all<{ lesson_id: number }>();

    return c.json({
      ok: true,
      watched_lesson_ids: watchedLessons.results.map((w: { lesson_id: number }) => w.lesson_id).sort((a, b) => a - b),
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /progress:`, e);
    return c.json({ ok: false, codigo: 'ERROR_SERVIDOR', mensaje: 'No se pudo actualizar el progreso.', request_id: requestId }, 500);
  }
});

export default app;