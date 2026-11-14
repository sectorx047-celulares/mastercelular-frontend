// mastercelular-api/src/routes/lessons.ts
// GET /api/lessons/:lessonId — Obtener enlace de una clase
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; whatsapp: string; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

app.get('/lessons/:lessonId', requireAuth(), zValidator('param', z.object({ lessonId: z.string().regex(/^\d+$/) }), (result, c) => {
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
  const lessonId = parseInt(c.req.param('lessonId'), 10);
  const user = c.get('user');

  try {
    const lesson = await c.env.DB.prepare(
      `SELECT l.id, l.course_id, l.title, l.drive_url, l.is_free,
              e.access_type
       FROM lessons l
       JOIN enrollments e ON e.course_id = l.course_id AND e.user_id = ?
       WHERE l.id = ?`
    ).bind(user.user_id, lessonId).first<{
      id: number;
      course_id: string;
      title: string;
      drive_url: string;
      is_free: number;
      access_type: string;
    }>();

    if (!lesson) {
      return c.json({ ok: false, codigo: 'NO_INSCRITO', mensaje: 'Aún no estás inscrito en este curso.', request_id: requestId }, 403);
    }

    const isFull = lesson.access_type === 'FULL';
    if (lesson.is_free === 0 && !isFull) {
      return c.json({ ok: false, codigo: 'REQUIERE_ACTIVACION', mensaje: 'Esta clase es parte del curso completo.', request_id: requestId }, 403);
    }

    const url = lesson.drive_url?.trim();
    if (!url) {
      return c.json({ ok: false, codigo: 'SIN_ENLACE', mensaje: 'Esta clase aún no tiene enlace disponible.', request_id: requestId }, 404);
    }

    return c.json({ ok: true, title: lesson.title, url, request_id: requestId });

  } catch (e) {
    console.error(`[${requestId}] Error en GET /lessons/:lessonId:`, e);
    return c.json({ ok: false, codigo: 'ERROR_SERVIDOR', mensaje: 'No se pudo obtener la clase.', request_id: requestId }, 500);
  }
});

export default app;