// mastercelular-api/src/types.ts
// Tipos compartidos para evitar dependencias circulares

// Tipos para Cloudflare Workers
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  // Secrets (configurados via `wrangler secret put`)
  BREVO_API_KEY: string;
  RESEND_API_KEY: string;
  JWT_SECRET: string;
  AUTH_SECRET: string;
  // Vars (en wrangler.toml [vars])
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  BREVO_SENDER_EMAIL: string;
  BREVO_SENDER_NAME: string;
  RESEND_SENDER_EMAIL: string;
  RESEND_SENDER_NAME: string;
  JWT_EXPIRY_HOURS: string;
  RATE_LIMIT_MAX_REQUESTS: string;
  RATE_LIMIT_WINDOW_MS: string;
}

// Extender Hono con nuestro Env
export type AppEnv = { Bindings: Env };

// Payload JWT verificado
export interface JWTPayload {
  user_id: number;
  whatsapp: string;
  course_id?: string;
  must_change_password?: number;
  exp: number;
  iat: number;
}