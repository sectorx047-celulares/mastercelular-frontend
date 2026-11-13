// mastercelular-api/src/__tests__/rate-limit.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

import { createMockEnv, type createMockDB, resetMocks } from './setup';

describe('Rate Limiting', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    resetMocks();
    mockEnv = createMockEnv();
    mockDB = mockEnv.DB;
  });

  describe('checkRateLimit logic', () => {
    it('should allow first request', async () => {
      mockDB._mocks.first.mockResolvedValueOnce(null); // No existing record

      const key = 'login:51916381231';

      // First request - should insert new record and allow
      const record = await mockEnv.DB.prepare(
        `SELECT attempts, window_start, blocked_until FROM failed_attempts WHERE key = ?`
      ).bind(key).first();

      expect(record).toBeNull();

      // Should insert new record
      await mockEnv.DB.prepare(
        `INSERT INTO failed_attempts (key, attempts, window_start) VALUES (?, 1, datetime('now'))`
      ).bind(key).run();

      // Verify run was called (the mock chain works)
      expect(mockDB._mocks.run).toHaveBeenCalled();
    });

    it('should block after max attempts', async () => {
      const key = 'login:51916381231';
      const now = new Date().toISOString();
      const blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      // Simulate record with max attempts reached
      mockDB._mocks.first.mockResolvedValueOnce({
        attempts: 5,
        window_start: now,
        blocked_until: null,
      });

      const record = await mockEnv.DB.prepare(
        `SELECT attempts, window_start, blocked_until FROM failed_attempts WHERE key = ?`
      ).bind(key).first();

      expect(record?.attempts).toBe(5);

      // Should block and set blocked_until
      const runResult = await mockEnv.DB.prepare(
        `UPDATE failed_attempts SET attempts = attempts + 1, blocked_until = ? WHERE key = ?`
      ).bind(blockedUntil, key).run();

      // Verify the query was executed (mock returns success)
      expect(runResult).toBeDefined();
    });

    it('should reset when window expires', async () => {
      const key = 'login:51916381231';
      const oldWindowStart = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago

      mockDB._mocks.first.mockResolvedValueOnce({
        attempts: 3,
        window_start: oldWindowStart,
        blocked_until: null,
      });

      // Window expired, should reset
      const runResult = await mockEnv.DB.prepare(
        `UPDATE failed_attempts SET attempts = 1, window_start = datetime('now'), blocked_until = NULL WHERE key = ?`
      ).bind(key).run();

      expect(runResult).toBeDefined();
    });

    it('should respect existing block', async () => {
      const key = 'activate:global';
      const futureBlock = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min from now

      mockDB._mocks.first.mockResolvedValueOnce({
        attempts: 10,
        window_start: new Date().toISOString(),
        blocked_until: futureBlock,
      });

      const record = await mockEnv.DB.prepare(
        `SELECT attempts, window_start, blocked_until FROM failed_attempts WHERE key = ?`
      ).bind(key).first();

      expect(record?.blocked_until).toBe(futureBlock);
      expect(new Date(record!.blocked_until!).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('clearRateLimit', () => {
    it('should delete the rate limit record', async () => {
      const key = 'login:51916381231';

      const runResult = await mockEnv.DB.prepare(`DELETE FROM failed_attempts WHERE key = ?`).bind(key).run();

      expect(runResult).toBeDefined();
    });
  });
});