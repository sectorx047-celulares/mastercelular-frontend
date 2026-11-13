// mastercelular-api/src/routes/public.ts
// GET /api/courses/:courseId/public — Temario público (sin auth)
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

// Schema de validación para courseId (slug)
const courseIdSchema = z.string().min(1).max(50).regex(/^[a-z0-9-]+$/);

// GET /api/courses/:courseId/public
app.get('/courses/:courseId/public', zValidator('param', z.object({ courseId: courseIdSchema })), async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const courseId = c.req.param('courseId');

  try {
    // Obtener curso activo
    const course = await c.env.DB.prepare(
      `SELECT id, name, code_prefix, price_cents, currency, seller_name, seller_whatsapp, ga_measurement_id
       FROM courses WHERE id = ? AND is_active = 1`
    ).bind(courseId).first<{
      id: string;
      name: string;
      code_prefix: string;
      price_cents: number;
      currency: string;
      seller_name: string;
      seller_whatsapp: string;
      ga_measurement_id: string | null;
    }>();

    if (!course) {
      return c.json({
        ok: false,
        codigo: 'CURSO_NO_DISPONIBLE',
        mensaje: 'Este curso no está disponible.',
        request_id: requestId,
      }, 404);
    }

    // Obtener lecciones del curso (ordenadas por módulo y sort_order)
    const lessons = await c.env.DB.prepare(
      `SELECT id, module, title, sort_order, drive_url, is_free, duration_seconds
       FROM lessons WHERE course_id = ? ORDER BY module, sort_order`
    ).bind(courseId).all<{
      id: number;
      module: string;
      title: string;
      sort_order: number;
      drive_url: string;
      is_free: number;
      duration_seconds: number | null;
    }>();

    // Obtener materiales del curso (ordenados por sort_order)
    const materials = await c.env.DB.prepare(
      `SELECT id, title, sort_order, drive_url, file_type, file_size_bytes
       FROM materials WHERE course_id = ? ORDER BY sort_order`
    ).bind(courseId).all<{
      id: number;
      title: string;
      sort_order: number;
      drive_url: string;
      file_type: string;
      file_size_bytes: number | null;
    }>();

    // Formatear respuesta según CONTRATO-API.md (acción publico)
    const formattedLessons = lessons.results.map((lesson: {
      id: number;
      module: string;
      title: string;
      sort_order: number;
      drive_url: string;
      is_free: number;
      duration_seconds: number | null;
    }) => ({
      lesson_id: lesson.id,
      module: lesson.module,
      title: lesson.title,
      sort_order: lesson.sort_order,
      is_free: lesson.is_free === 1,
      available: lesson.is_free === 1, // Público solo ve gratis como disponibles
      url: lesson.is_free === 1 ? lesson.drive_url : null,
      duration_seconds: lesson.duration_seconds,
    }));

    const formattedMaterials = materials.results.map((material: {
      id: number;
      title: string;
      sort_order: number;
      drive_url: string;
      file_type: string;
      file_size_bytes: number | null;
    }) => ({
      material_id: material.id,
      title: material.title,
      sort_order: material.sort_order,
      // Público no ve URLs de materiales (solo títulos)
    }));

    return c.json({
      ok: true,
      course: {
        course_id: course.id,
        name: course.name,
        code_prefix: course.code_prefix,
        price_cents: course.price_cents,
        currency: course.currency,
        seller_name: course.seller_name,
        seller_whatsapp: course.seller_whatsapp,
        ga_measurement_id: course.ga_measurement_id,
      },
      lessons: formattedLessons,
      materials: formattedMaterials,
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en GET /courses/:courseId/public:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo obtener el temario. Intenta de nuevo.',
      request_id: requestId,
    }, 500);
  }
});

export default app;