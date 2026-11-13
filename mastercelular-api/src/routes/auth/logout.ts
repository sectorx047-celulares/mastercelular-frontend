// mastercelular-api/src/routes/auth/logout.ts
// POST /api/auth/logout — Revoca la sesión actual
import { Hono } from 'hono';

import type { Env } from '../../types';
import { getTokenHash } from '../../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

app.post('/logout', async (c) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const authHeader = c.req.header('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const tokenHash = await getTokenHash(token);

      await c.env.DB.prepare(
        `UPDATE sessions SET expires_at = datetime('now') WHERE token_hash = ?`
      ).bind(tokenHash).run();
    }

    return c.json({ ok: true, request_id: requestId });

  } catch (e) {
    console.error(`[${requestId}] Error en POST /auth/logout:`, e);
    return c.json({
      ok: false,
      codigo: 'ERROR_SERVIDOR',
      mensaje: 'No se pudo cerrar la sesión.',
      request_id: requestId,
    }, 500);
  }
});

export default app;