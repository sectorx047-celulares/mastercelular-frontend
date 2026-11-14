// mastercelular-api/src/routes/materials.ts
// GET /api/materials/:materialId — Obtener enlace de un material (solo FULL)
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';

const app = new Hono<{ Bindings: Env; Variables: { user: { user_id: number; whatsapp: string; course_id?: string; must_change_password?: number; exp: number; iat: number }; tokenHash: string } }>();

app.get('/materials/:materialId', requireAuth(), zValidator('param', z.object({ materialId: z.string().regex(/^\d+$/) }), (result, c) => {
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
  const materialId = parseInt(c.req.param('materialId'), 10);
  const user = c.get('user');

  try {
    const material = await c.env.DB.prepare(
      `SELECT m.id, m.course_id, m.title, m.drive_url,
              e.access_type
       FROM materials m
       JOIN enrollments e ON e.course_id = m.course_id AND e.user_id = ?
       WHERE m.id = ?`
    ).bind(user.user_id, materialId).first<{
      id: number;
      course_id: string;
      title: string;
      drive_url: string;
      access_type: string;
    }>();

    if (!material) {
      return c.json({ ok: false, codigo: 'NO_INSCRITO', mensaje: 'Aún no estás inscrito en este curso.', request_id: requestId }, 403);
    }

    if (material.access_type !== 'FULL') {
      return c.json({ ok: false, codigo: 'REQUIERE_ACTIVACION', mensaje: 'Los materiales son parte del curso completo.', request_id: requestId }, 403);
    }

    const url = material.drive_url?.trim();
    if (!url) {
      return c.json({ ok: false, codigo: 'NO_ENCONTRADO', mensaje: 'Material no encontrado.', request_id: requestId }, 404);
    }

    // Registrar primera descarga
    await c.env.DB.prepare(
      `INSERT INTO downloads (user_id, course_id, material_id, downloaded_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, material_id) DO NOTHING`
    ).bind(user.user_id, material.course_id, materialId).run();

    return c.json({ ok: true, title: material.title, url, request_id: requestId });

  } catch (e) {
    console.error(`[${requestId}] Error en GET /materials/:materialId:`, e);
    return c.json({ ok: false, codigo: 'ERROR_SERVIDOR', mensaje: 'No se pudo obtener el material.', request_id: requestId }, 500);
  }
});

export default app;