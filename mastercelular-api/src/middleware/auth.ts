// mastercelular-api/src/middleware/auth.ts
// Middleware compartido de autenticación JWT
import type { Env, JWTPayload } from '../types';

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signature = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(data));

    if (!isValid) return null;

    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp * 1000 < Date.now()) return null;

    return payload as JWTPayload;
  } catch {
    return null;
  }
}

export async function getTokenHash(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function requireAuth() {
  return async function authMiddleware(c: any, next: any) {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({
        ok: false,
        codigo: 'SESION_INVALIDA',
        mensaje: 'No autorizado. Inicia sesión para acceder.',
      }, 401);
    }

    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) {
      return c.json({
        ok: false,
        codigo: 'SESION_INVALIDA',
        mensaje: 'Tu sesión venció. Entra de nuevo.',
      }, 401);
    }

    // Verificar si debe cambiar contraseña
    if (payload.must_change_password === 1) {
      const path = c.req.path;
      if (!path.includes('/password/change')) {
        return c.json({
          ok: false,
          codigo: 'CAMBIO_REQUERIDO',
          mensaje: 'Debes cambiar tu contraseña temporal para continuar.',
        }, 403);
      }
    }

    c.set('user', payload);
    c.set('tokenHash', await getTokenHash(token));
    await next();
  };
}