// mastercelular-api/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';

// Rutas modulares
import publicRoutes from './routes/public';
import authRoutes from './routes/auth';
import meRoutes from './routes/me';
import progressRoutes from './routes/progress';
import lessonsRoutes from './routes/lessons';
import materialsRoutes from './routes/materials';
import notesRoutes from './routes/notes';
import badgesRoutes from './routes/badges';

// Types para Cloudflare Workers
import type { Env, AppEnv, JWTPayload } from './types';

// Extender contexto de Hono para incluir usuario autenticado
declare module 'hono' {
  interface ContextVariableMap {
    user: JWTPayload;
    tokenHash: string;
  }
}

// Re-export for external consumers
export type { Env, AppEnv, JWTPayload } from './types';

const app = new Hono<AppEnv>();

// Middlewares globales
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin, c) => {
    const frontendUrl = c.env.FRONTEND_URL;
    if (!origin || origin === frontendUrl || origin.startsWith('http://localhost')) {
      return origin;
    }
    return frontendUrl;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['X-Request-Id'],
  maxAge: 86400,
}));

// Montar rutas modulares
app.route('/api', publicRoutes);
app.route('/api', authRoutes);
app.route('/api', meRoutes);
app.route('/api', progressRoutes);
app.route('/api', lessonsRoutes);
app.route('/api', materialsRoutes);
app.route('/api', notesRoutes);
app.route('/api', badgesRoutes);

// ============================================================================
// RUTAS DE SALUD Y PRUEBA
// ============================================================================

app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'mastercelular-api',
    version: '1.0.0',
  });
});

app.get('/api/test-db', async (c) => {
  try {
    const result = await c.env.DB.prepare('SELECT 1 as test').first();
    return c.json({ success: true, db: 'connected', result });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.get('/api/test-kv', async (c) => {
  try {
    const testKey = `health-check-${Date.now()}`;
    await c.env.CACHE.put(testKey, 'ok', { expirationTtl: 60 });
    const value = await c.env.CACHE.get(testKey);
    await c.env.CACHE.delete(testKey);
    return c.json({ success: true, kv: 'working', value });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ============================================================================
// TEMPORARY DEBUG ENDPOINT: Test code hash
// ============================================================================

app.get('/api/test-code-hash/:code', async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const code = c.req.param('code').toUpperCase().replace(/\s+/g, '');
  const pepper = c.env.AUTH_SECRET;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(code));
  const codeHash = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');

  return c.json({
    success: true,
    code,
    code_hash: codeHash,
    pepper_preview: pepper.slice(0, 4) + '...' + pepper.slice(-4),
    request_id: requestId,
  });
});

// ============================================================================
// ENDPOINT PRINCIPAL: TEST EMAIL (/api/test-email)
// ============================================================================

import { sendEmail } from './utils/email';

app.post('/api/test-email', async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ip = (c.req.raw as any).cf?.connecting_ip || 'unknown';

  try {
    const body = await c.req.json<{
      to_email: string;
      to_name?: string;
      provider?: 'brevo' | 'resend';
    }>();

    // Validación básica
    if (!body.to_email || !body.to_email.includes('@')) {
      return c.json({
        success: false,
        error: 'Email inválido. Proporciona to_email válido.',
        request_id: requestId
      }, 400);
    }

    const provider = body.provider || 'brevo';
    const testSubject = `🧪 MasterCelulares - Test de correo (${provider.toUpperCase()})`;
    const testHtml = `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #0b0f19; color: #fff; padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🧪 Test de Configuración</h1>
        </div>
        <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #dee2e6;">
          <p><strong>Proveedor:</strong> ${provider.toUpperCase()}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p><strong>Request ID:</strong> ${requestId}</p>
          <hr style="border-color: #dee2e6;">
          <p style="color: #6c757d; font-size: 14px;">
            Si recibes este correo, la configuración de <strong>${provider === 'brevo' ? 'Brevo' : 'Resend'}</strong> funciona correctamente.
            El sistema de fallback (${provider === 'brevo' ? 'Resend' : 'Brevo'}) también está configurado.
          </p>
        </div>
        <p style="text-align: center; color: #adb5bd; font-size: 12px; margin-top: 20px;">
          MasterCelulares · Plataforma de cursos de reparación de celulares
        </p>
      </body>
      </html>
    `;

    const result = await sendEmail(c.env, {
      to_email: body.to_email,
      to_name: body.to_name || 'Usuario de prueba',
      subject: testSubject,
      html_body: testHtml,
      provider,
    });

    // Log de auditoría
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (whatsapp, action, result, detail, ip_hash, user_agent)
       VALUES (?, 'test_email', ?, ?, ?, ?)`
    ).bind(
      body.to_email,
      result.success ? 'success' : 'failed',
      JSON.stringify({ provider: result.provider, request_id: requestId }),
      ip,
      c.req.header('user-agent') || 'unknown'
    ).run();

    if (result.success) {
      return c.json({
        success: true,
        message: `Correo de prueba enviado vía ${result.provider.toUpperCase()}`,
        provider: result.provider,
        request_id: requestId,
      });
    } else {
      return c.json({
        success: false,
        error: `Fallaron ambos proveedores: ${result.error}`,
        request_id: requestId,
      }, 500);
    }

  } catch (e) {
    console.error(`[${requestId}] Error en /api/test-email:`, e);
    return c.json({
      success: false,
      error: 'Error interno del servidor',
      request_id: requestId,
    }, 500);
  }
});

// ============================================================================
// ENDPOINT: ENVIAR EMAIL A COLA (PARA USO INTERNO)
// ============================================================================

import { queueEmail } from './utils/email';

app.post('/api/queue-email', async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await c.req.json<{
      to_email: string;
      to_name?: string;
      subject: string;
      html_body: string;
      text_body?: string;
      provider?: 'brevo' | 'resend';
    }>();

    if (!body.to_email || !body.subject || !body.html_body) {
      return c.json({
        success: false,
        error: 'Faltan campos requeridos: to_email, subject, html_body',
        request_id: requestId
      }, 400);
    }

    const id = await queueEmail(c.env, body);

    return c.json({
      success: true,
      message: 'Email encolado para envío asíncrono',
      email_id: id,
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en /api/queue-email:`, e);
    return c.json({
      success: false,
      error: 'Error interno del servidor',
      request_id: requestId,
    }, 500);
  }
});

// ============================================================================
// ENDPOINT: OBTENER CARPETA DRIVE DEL CURSO (SOLO ACCESO FULL)
// ============================================================================

import { verifyJWT } from './utils/jwt';

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function getClientIp(request: Request): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cf = request.cf as any;
  return cf?.connecting_ip || 'unknown';
}

function hashIp(ip: string): string {
  // Hash simple para privacidad (no reversible)
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

app.get('/api/courses/:courseId/drive-folder', async (c) => {
  const requestId = generateRequestId();

  try {
    const courseId = c.req.param('courseId');

    // Verificar autenticación (JWT en header Authorization: Bearer <token>)
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({
        success: false,
        error: 'No autorizado. Inicia sesión para acceder.',
        code: 'UNAUTHORIZED',
        request_id: requestId,
      }, 401);
    }

    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) {
      return c.json({
        success: false,
        error: 'Sesión inválida o expirada. Vuelve a iniciar sesión.',
        code: 'INVALID_TOKEN',
        request_id: requestId,
      }, 401);
    }

    const userId = payload.user_id;

    // Verificar inscripción con acceso FULL
    const enrollment = await c.env.DB.prepare(
      `SELECT e.access_type, c.drive_folder_url, c.name AS course_name
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND e.course_id = ? AND c.is_active = 1`
    ).bind(userId, courseId).first<{
      access_type: string;
      drive_folder_url: string | null;
      course_name: string;
    }>();

    if (!enrollment) {
      return c.json({
        success: false,
        error: 'No estás inscrito en este curso.',
        code: 'NOT_ENROLLED',
        request_id: requestId,
      }, 403);
    }

    if (enrollment.access_type !== 'FULL') {
      return c.json({
        success: false,
        error: 'Este contenido requiere acceso completo. Activa tu código para desbloquearlo.',
        code: 'ACCESS_DENIED',
        request_id: requestId,
      }, 403);
    }

    if (!enrollment.drive_folder_url || enrollment.drive_folder_url.trim() === '') {
      return c.json({
        success: false,
        error: 'La carpeta de materiales aún no está configurada para este curso.',
        code: 'NOT_CONFIGURED',
        request_id: requestId,
      }, 404);
    }

    // Log de auditoría
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (user_id, whatsapp, action, course_id, result, detail, ip_hash, user_agent)
       VALUES (?, ?, 'drive_folder_access', ?, 'success', ?, ?, ?)`
    ).bind(
      userId,
      payload.whatsapp,
      courseId,
      JSON.stringify({ request_id: requestId }),
      hashIp(getClientIp(c.req.raw)),
      c.req.header('user-agent') || 'unknown'
    ).run();

    return c.json({
      success: true,
      data: {
        course_name: enrollment.course_name,
        drive_folder_url: enrollment.drive_folder_url,
        message: 'Acceso concedido. Puedes copiar el enlace o descargar la carpeta completa a tu Drive.',
      },
      request_id: requestId,
    });

  } catch (e) {
    console.error(`[${requestId}] Error en /api/courses/:courseId/drive-folder:`, e);
    return c.json({
      success: false,
      error: 'Error interno del servidor',
      request_id: requestId,
    }, 500);
  }
});

// ============================================================================
// WORKER PARA PROCESAR COLA DE EMAILS (se ejecuta via Cron Trigger)
// ============================================================================

import { sendEmail as sendEmailUtil } from './utils/email';

export async function processEmailQueue(env: Env): Promise<{ processed: number; sent: number; failed: number }> {
  let processed = 0, sent = 0, failed = 0;

  // Obtener emails pendientes (máx 50 por ejecución)
  const pending = await env.DB.prepare(
    `SELECT * FROM v_pending_emails LIMIT 50`
  ).all<{
    id: number;
    to_email: string;
    to_name: string | null;
    subject: string;
    html_body: string;
    text_body: string | null;
    provider: string;
    attempts: number;
    max_attempts: number;
  }>();

  for (const email of pending.results) {
    processed++;

    // Marcar como reintentando
    await env.DB.prepare(
      `UPDATE email_queue SET status = 'retrying', attempts = attempts + 1 WHERE id = ?`
    ).bind(email.id).run();

    const result = await sendEmailUtil(env, {
      to_email: email.to_email,
      to_name: email.to_name || undefined,
      subject: email.subject,
      html_body: email.html_body,
      text_body: email.text_body || undefined,
      provider: email.provider as 'brevo' | 'resend',
    });

    if (result.success) {
      sent++;
      await env.DB.prepare(
        `UPDATE email_queue SET status = 'sent', sent_at = datetime('now') WHERE id = ?`
      ).bind(email.id).run();
    } else {
      failed++;
      if (email.attempts + 1 >= email.max_attempts) {
        await env.DB.prepare(
          `UPDATE email_queue SET status = 'failed', last_error = ? WHERE id = ?`
        ).bind(result.error || 'Unknown error', email.id).run();
      } else {
        // Reprogramar con backoff exponencial (5min, 15min, 45min...)
        const delayMinutes = Math.pow(3, email.attempts) * 5;
        const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
        await env.DB.prepare(
          `UPDATE email_queue SET status = 'pending', scheduled_at = ?, last_error = ? WHERE id = ?`
        ).bind(scheduledAt, result.error || 'Unknown error', email.id).run();
      }
    }
  }

  return { processed, sent, failed };
}

// Handler para Cron Trigger (se ejecuta cada 5 minutos via wrangler.toml)
export default {
  fetch: app.fetch,

  // Cloudflare Workers Cron Trigger
  // eslint-disable-next-line @typescript-eslint/require-await
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '*/5 * * * *') { // Cada 5 minutos
      ctx.waitUntil(processEmailQueue(env));
    }
  },
};