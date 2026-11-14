// mastercelular-api/src/middleware/auth.ts
// Middleware compartido de autenticación JWT
import type { Env, JWTPayload } from '../types';
import { verifyJWT } from '../utils/jwt';

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