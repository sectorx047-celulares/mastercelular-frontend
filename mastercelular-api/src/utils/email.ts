// mastercelular-api/src/utils/email.ts
// Utilidades de email - separadas para evitar dependencias circulares
import type { Env } from '../types';

interface EmailPayload {
  to_email: string;
  to_name?: string;
  subject: string;
  html_body: string;
  text_body?: string;
  provider?: 'brevo' | 'resend';
}

/**
 * Envía email usando Brevo o Resend (con fallback)
 */
export async function sendEmail(env: Env, payload: EmailPayload): Promise<{ success: boolean; provider: string; error?: string }> {
  const provider = payload.provider || 'brevo';

  const tryProvider = async (p: 'brevo' | 'resend'): Promise<{ success: boolean; error?: string }> => {
    try {
      if (p === 'brevo') {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'api-key': env.BREVO_API_KEY,
          },
          body: JSON.stringify({
            sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME },
            to: [{ email: payload.to_email, name: payload.to_name || '' }],
            subject: payload.subject,
            htmlContent: payload.html_body,
            textContent: payload.text_body || payload.html_body.replace(/<[^>]*>/g, ''),
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Brevo API error: ${response.status} - ${err}`);
        }
        return { success: true };
      } else {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${env.RESEND_SENDER_NAME} <${env.RESEND_SENDER_EMAIL}>`,
            to: [payload.to_email],
            subject: payload.subject,
            html: payload.html_body,
            text: payload.text_body || payload.html_body.replace(/<[^>]*>/g, ''),
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`Resend API error: ${response.status} - ${err}`);
        }
        return { success: true };
      }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // Intentar proveedor principal
  const result = await tryProvider(provider);
  if (result.success) return { success: true, provider };

  // Fallback al otro proveedor
  const fallbackProvider = provider === 'brevo' ? 'resend' : 'brevo';
  const fallbackResult = await tryProvider(fallbackProvider);
  if (fallbackResult.success) return { success: true, provider: fallbackProvider };

  // Ambos fallaron
  return { success: false, provider, error: `${provider} failed, ${fallbackProvider} failed: ${fallbackResult.error}` };
}

/**
 * Encola email para envío asíncrono (procesado por Cron Trigger)
 */
export async function queueEmail(env: Env, payload: EmailPayload): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO email_queue (to_email, to_name, subject, html_body, text_body, provider, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
     RETURNING id`
  ).bind(
    payload.to_email,
    payload.to_name || null,
    payload.subject,
    payload.html_body,
    payload.text_body || null,
    payload.provider || 'brevo'
  ).first<{ id: number }>();

  return result?.id || 0;
}

/**
 * Envía email de bienvenida al registrar
 */
export async function sendWelcomeEmail(
  env: Env,
  toEmail: string,
  toName: string,
  courseName: string,
  sellerName: string
): Promise<{ success: boolean; provider: string; error?: string }> {
  const subject = `🎉 Bienvenido a ${courseName} - Tu cuenta está lista`;
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0b0f19; color: #fff; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">¡Bienvenido a ${courseName}! 🎉</h1>
      </div>
      <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e9ecef;">
        <p>Hola <strong>${toName}</strong>,</p>
        <p>Tu cuenta ha sido creada exitosamente. Ya puedes acceder a las <strong>2 primeras clases completamente gratis</strong> para probar el curso.</p>
        <p>Para entrar a tu aula virtual:</p>
        <ol>
          <li>Ve a la plataforma</li>
          <li>Haz clic en "Iniciar sesión"</li>
          <li>Usa tu email y la contraseña que creaste</li>
        </ol>
        <p>Si te gusta cómo se explica y quieres desbloquear el curso completo (${courseName} con acceso de por vida, PDFs, carpeta en Drive y soporte), escríbele a <strong>${sellerName}</strong> por WhatsApp y te guiará en el proceso.</p>
        <hr style="border-color: #dee2e6;">
        <p style="color: #6c757d; font-size: 14px;">
          Este correo fue enviado automáticamente. Si no creaste esta cuenta, puedes ignorarlo.
        </p>
      </div>
      <p style="text-align: center; color: #adb5bd; font-size: 12px; margin-top: 20px;">
        MasterCelulares · Plataforma de cursos de reparación de celulares
      </p>
    </body>
    </html>
  `;

  return sendEmail(env, {
    to_email: toEmail,
    to_name: toName,
    subject,
    html_body: htmlBody,
    provider: 'brevo',
  });
}

/**
 * Envía email con contraseña temporal
 */
export async function sendPasswordResetEmail(
  env: Env,
  toEmail: string,
  toName: string,
  temporaryPassword: string,
  sellerName: string,
  sellerWhatsApp: string
): Promise<{ success: boolean; provider: string; error?: string }> {
  const subject = `🔐 Tu contraseña temporal - MasterCelulares`;
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0b0f19; color: #fff; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">Contraseña temporal 🔐</h1>
      </div>
      <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e9ecef;">
        <p>Hola <strong>${toName}</strong>,</p>
        <p>Se ha generado una contraseña temporal para tu cuenta:</p>
        <div style="background: #fff; border: 2px solid #0b0f19; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
          <code style="font-size: 18px; font-weight: bold; letter-spacing: 2px; color: #0b0f19;">${temporaryPassword}</code>
        </div>
        <p><strong>Importante:</strong> Esta contraseña es temporal. Al iniciar sesión, el sistema te pedirá que la cambies inmediatamente por una nueva de tu elección.</p>
        <p>Si no solicitaste este cambio, por favor contacta a <strong>${sellerName}</strong> por WhatsApp al <a href="https://wa.me/${sellerWhatsApp}">${sellerWhatsApp}</a>.</p>
        <hr style="border-color: #dee2e6;">
        <p style="color: #6c757d; font-size: 14px;">
          Por seguridad, esta contraseña temporal expira en 24 horas.
        </p>
      </div>
      <p style="text-align: center; color: #adb5bd; font-size: 12px; margin-top: 20px;">
        MasterCelulares · Plataforma de cursos de reparación de celulares
      </p>
    </body>
    </html>
  `;

  return sendEmail(env, {
    to_email: toEmail,
    to_name: toName,
    subject,
    html_body: htmlBody,
    provider: 'brevo',
  });
}

/**
 * Envía email de confirmación de activación (acceso completo)
 */
export async function sendActivationSuccessEmail(
  env: Env,
  toEmail: string,
  toName: string,
  courseName: string,
  driveFolderUrl: string
): Promise<{ success: boolean; provider: string; error?: string }> {
  const subject = `✅ ¡Tu curso ${courseName} ya está activado!`;
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #0b0f19; color: #fff; padding: 20px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">¡Acceso completo activado! ✅</h1>
      </div>
      <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #e9ecef;">
        <p>Hola <strong>${toName}</strong>,</p>
        <p>Tu código ha sido verificado correctamente. Ahora tienes acceso <strong>COMPLETO</strong> a <strong>${courseName}</strong>:</p>
        <ul>
          <li>✅ Todas las clases del curso</li>
          <li>✅ Todos los PDFs y materiales</li>
          <li>✅ Tu carpeta personal en Google Drive</li>
          <li>✅ Acceso de por vida sin mensualidades</li>
        </ul>
        <p>Tu carpeta en Google Drive está lista aquí: <a href="${driveFolderUrl}" style="color: #0b0f19;">${driveFolderUrl}</a></p>
        <p><strong>Tip:</strong> Una vez en Drive, haz clic derecho → "Descargar" para bajar toda la carpeta a tu PC, o "Añadir a Mi unidad" para guardarla en tu cuenta de Google.</p>
        <hr style="border-color: #dee2e6;">
        <p style="color: #6c757d; font-size: 14px;">
          ¡Disfruta aprendiendo! Si tienes dudas, escríbenos por WhatsApp.
        </p>
      </div>
      <p style="text-align: center; color: #adb5bd; font-size: 12px; margin-top: 20px;">
        MasterCelulares · Plataforma de cursos de reparación de celulares
      </p>
    </body>
    </html>
  `;

  return sendEmail(env, {
    to_email: toEmail,
    to_name: toName,
    subject,
    html_body: htmlBody,
    provider: 'brevo',
  });
}