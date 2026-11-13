// mastercelular-api/src/routes/me.ts
// GET /api/me?course_id= — Estado completo del alumno en un curso
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env, JWTPayload } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: JWTPayload } }>();

const querySchema = z.object({
  course_id: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

app.get('/me', requireAuth, zValidator('query', querySchema), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const courseId = c.req.valid('query').course_id;
  const user = c.get('user');

  try {
    // Verificar curso activo
    const course = await c.env.DB.prepare(
      `SELECT id, name FROM courses WHERE id = ? AND is_active = 1`
    ).bind(courseId).first<{ id: string; name: string }>();

    if (!course) {
      return c.json({
        ok: false,
        codigo: 'CURSO_NO_DISPONIBLE',
        mensaje: 'Este curso no está disponible.',
        request_id: requestId,
      }, 404);
    }

    // Verificar inscripción
    const enrollment = await c.env.DB.prepare(
      `SELECT access_type FROM enrollments WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, courseId).first<{ access_type: string }>();

    if (!enrollment) {
      return c.json({
        ok: false,
        codigo: 'NO_INSCRITO',
        mensaje: 'Aún no estás inscrito en este curso.',
        request_id: requestId,
      }, 403);
    }

    const isFull = enrollment.access_type === 'FULL';

    // Obtener lecciones con disponibilidad
    const lessons = await c.env.DB.prepare(
      `SELECT id, module, title, sort_order, drive_url, is_free
       FROM lessons WHERE course_id = ? ORDER BY module, sort_order`
    ).bind(courseId).all<{
      id: number;
      module: string;
      title: string;
      sort_order: number;
      drive_url: string;
      is_free: number;
    }>();

    // Obtener lecciones vistas
    const watched = await c.env.DB.prepare(
      `SELECT lesson_id FROM progress WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, courseId).all<{ lesson_id: number }>();

    const watchedLessonIds = new Set(watched.results.map(w => w.lesson_id));

    // Obtener notas
    const notes = await c.env.DB.prepare(
      `SELECT id, lesson_id, timestamp_text, content, created_at
       FROM notes WHERE user_id = ? AND course_id = ? ORDER BY created_at DESC`
    ).bind(user.user_id, courseId).all<{
      id: number;
      lesson_id: number;
      timestamp_text: string | null;
      content: string;
      created_at: string;
    }>();

    // Obtener materiales
    const materials = await c.env.DB.prepare(
      `SELECT m.id, m.title, m.sort_order, m.drive_url,
              CASE WHEN d.id IS NOT NULL THEN 1 ELSE 0 END as downloaded
       FROM materials m
       LEFT JOIN downloads d ON d.material_id = m.id AND d.user_id = ?
       WHERE m.course_id = ? ORDER BY m.sort_order`
    ).bind(user.user_id, courseId).all<{
      id: number;
      title: string;
      sort_order: number;
      drive_url: string;
      downloaded: number;
    }>();

    // Obtener medallas
    const badges = await c.env.DB.prepare(
      `SELECT milestone FROM badges WHERE user_id = ? AND course_id = ?`
    ).bind(user.user_id, courseId).all<{ milestone: number }>();

    // Obtener carpeta Drive si FULL
    let driveFolderUrl = '';
    if (isFull) {
      const courseDrive = await c.env.DB.prepare(
        `SELECT drive_folder_url FROM courses WHERE id = ?`
      ).bind(courseId).first<{ drive_folder_url: string | null }>();
      driveFolderUrl = courseDrive?.drive_folder_url || '';
    }

    // Obtener nombre del usuario (el JWT solo tiene whatsapp y user_id)
    const userInfo = await c.env.DB.prepare(
      `SELECT name FROM users WHERE id = ?`
    ).bind(user.user_id).first<{ name: string }>();

    return c.json({
      ok: true,
      user: { name: userInfo?.name || '', whatsapp: user.whatsapp },
      course: { course_id: course.id, name: course.name },
      access: isFull ? 'FULL' : 'FREE',
      lessons: lessons.results.map(l => ({
        lesson_id: l.id,
        module: l.module,
        title: l.title,
        sort_order: l.sort_order,
        is_free: l.is_free === 1,
        available: l.is_free === 1 || isFull,
        url: (l.is_free === 1 || isFull) ? l.drive_url : null,
      })),
      watched_lesson_ids: Array.from(watchedLessonIds).sort((a, b) => a - b),
      notes: notes.results.map(n => ({
        id: n.id,
        lesson_id: n.lesson_id,
        timestamp: n.timestamp_text,
        content: n.content,
        created_at: n.created_at,
      })),
      materials: isFull ? materials.results.map(m => ({
        material_id: m.id,
        title: m.title,
        sort_order: m.sort_order,
        downloaded: m.downloaded === 1,
      })) : [],
      badges: badges.results.map(b => b.milestone).sort((a, b) => a - b),
      drive_folder_url: driveFolderUrl,
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en GET /me:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo obtener el estado. Intenta de nuevo.',
      request_id: requestId,
    }, 500);
  }
});

export default app;