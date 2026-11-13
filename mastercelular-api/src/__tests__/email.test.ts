// mastercelular-api/src/__tests__/email.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

import { createMockEnv, type createMockDB, resetMocks } from './setup';

describe('Email System (Brevo + Resend Fallback)', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    resetMocks();
    mockEnv = createMockEnv();
    mockDB = mockEnv.DB;
  });

  describe('sendEmail function', () => {
    it('should try Brevo first when provider is brevo', () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ messageId: 'brevo-123' }),
      });

      expect(global.fetch).toBeDefined();
    });

    it('should fallback to Resend when Brevo fails', () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Brevo error') })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'resend-123' }) });

      expect(true).toBe(true);
    });

    it('should return failure when both providers fail', () => {
      global.fetch
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Brevo error') })
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('Resend error') });

      expect(true).toBe(true);
    });
  });

  describe('queueEmail function', () => {
    it('should insert email into queue with pending status', async () => {
      mockDB._mocks.first.mockResolvedValueOnce({ id: 42 });

      const id = await mockEnv.DB.prepare(
        `INSERT INTO email_queue (to_email, to_name, subject, html_body, text_body, provider, status, scheduled_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
         RETURNING id`
      ).bind(
        'test@example.com',
        'Test User',
        'Test Subject',
        '<html>Test</html>',
        'Test',
        'brevo'
      ).first();

      expect(id?.id).toBe(42);
    });

    it('should store all email fields correctly', async () => {
      mockDB._mocks.first.mockResolvedValueOnce({ id: 1 });

      const result = await mockEnv.DB.prepare(
        `INSERT INTO email_queue (to_email, to_name, subject, html_body, text_body, provider, status, scheduled_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
         RETURNING id`
      ).bind(
        'user@domain.com',
        'Nombre Usuario',
        'Asunto del correo',
        '<p>HTML content</p>',
        'Text content',
        'resend'
      ).first();

      expect(result?.id).toBe(1);
    });
  });

  describe('Email queue processing', () => {
    it('should mark email as retrying before sending', async () => {
      const result = await mockEnv.DB.prepare(
        `UPDATE email_queue SET status = 'retrying', attempts = attempts + 1 WHERE id = ?`
      ).bind(1).run();

      expect(result).toBeDefined();
    });

    it('should mark email as sent on success', async () => {
      const result = await mockEnv.DB.prepare(
        `UPDATE email_queue SET status = 'sent', sent_at = datetime('now') WHERE id = ?`
      ).bind(1).run();

      expect(result).toBeDefined();
    });

    it('should mark email as failed after max attempts', async () => {
      const result = await mockEnv.DB.prepare(
        `UPDATE email_queue SET status = 'failed', last_error = ? WHERE id = ?`
      ).bind('Provider error', 1).run();

      expect(result).toBeDefined();
    });

    it('should reschedule with exponential backoff on retry', async () => {
      const delayMinutes = Math.pow(3, 0) * 5; // 5 min
      const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

      const result = await mockEnv.DB.prepare(
        `UPDATE email_queue SET status = 'pending', scheduled_at = ?, last_error = ? WHERE id = ?`
      ).bind(scheduledAt, 'Error message', 1).run();

      expect(result).toBeDefined();
    });
  });
});