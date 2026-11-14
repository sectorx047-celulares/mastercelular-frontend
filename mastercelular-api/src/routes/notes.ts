// mastercelular-api/src/routes/notes.ts
// POST /api/notes — Guardar apunte
// DELETE /api/notes/:noteId — Eliminar apunte propio
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; whatsapp: string; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

const noteSchema = z.object({
  course_id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  lesson_id: z.number().int().positive(),
  timestamp: z.string().max(10).optional().default(''),
  content: z.string().min(1).max(1000),
});

function sanitize(text: string): string {
  const t = String(text == null ? '' : text);
  return /^[=+\-@]/.test(t) ? "'" + t : t;
}

app.post('/notes', requireAuth(), zValidator('json', noteSchema, (result, c) => {
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
  const { course_id, lesson_id, timestamp, content } = c.req.valid('json');
  const user = c.get('user');

  try {
    // Verificar inscripción
    const enrollment = await c.env.DB.prepare(
      `SELECT id FROM enrollments WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, course_id).first();

    if (!enrollment) {
      return c.json({ ok: false, codigo: 'NO_INSCRITO', mensaje: 'Aún no estás inscrito en este curso.', request_id: requestId }, 403);
    }

    // Verificar que la lección existe en este curso
    const lesson = await c.env.DB.prepare(
      `SELECT id FROM lessons WHERE id = ? AND course_id = ?`
    ).bind(lesson_id, course_id).first();

    if (!lesson) {
      return c.json({ ok: false, codigo: 'CLASE_NO_EXISTE', mensaje: 'La clase no existe en este curso.', request_id: requestId }, 404);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await c.env.DB.prepare(
      `INSERT INTO notes (id, user_id, course_id, lesson_id, timestamp_text, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.user_id, course_id, lesson_id, sanitize(timestamp.slice(0, 10)), sanitize(content), now, now).run();

    return c.json({
      ok: true,
      note: { id, lesson_id, timestamp: timestamp.slice(0, 10), content, created_at: now },
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /notes:`, e);
    return c.json({ ok: false, codigo: 'ERROR_SERVIDOR', mensaje: 'No se pudo guardar el apunte.', request_id: requestId }, 500);
  }
});

app.delete('/notes/:noteId', requireAuth(), zValidator('param', z.object({ noteId: z.string().min(1) })), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const noteId = c.req.param('noteId');
  const user = c.get('user');

  try {
    const result = await c.env.DB.prepare(
      `DELETE FROM notes WHERE id = ? AND user_id = ?`
    ).bind(noteId, user.user_id).run();

    // D1Result doesn't have changes property directly - check meta
    const meta = result.meta;
    if (meta && meta.changes === 0) {
      return c.json({ ok: false, codigo: 'NO_ENCONTRADO', mensaje: 'El apunte no existe.', request_id: requestId }, 404);
    }

    return c.json({ ok: true, request_id: requestId });

  } catch (e) {
    console.error(`[${requestId}] Error en DELETE /notes/:noteId:`, e);
    return c.json({ ok: false, codigo: 'ERROR_SERVIDOR', mensaje: 'No se pudo eliminar el apunte.', request_id: requestId }, 500);
  }
});

export default app;