// mastercelular-api/src/__tests__/setup.ts
import { vi } from 'vitest';

// Mock global fetch
global.fetch = vi.fn();

// Polyfill crypto.getRandomValues for Node.js test environment
const cryptoGetRandomValues = (arr: Uint8Array): Uint8Array => {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
};

if (typeof global.crypto === 'undefined') {
  global.crypto = {};
}
global.crypto.getRandomValues = cryptoGetRandomValues;

// Mock crypto.subtle for JWT operations
const mockCryptoSubtle = {
  importKey: vi.fn(),
  sign: vi.fn(),
  verify: vi.fn(),
  digest: vi.fn(),
  deriveBits: vi.fn(),
};

Object.defineProperty(global, 'crypto', {
  value: {
    subtle: mockCryptoSubtle,
    randomUUID: vi.fn(() => 'test-uuid-1234'),
    getRandomValues: cryptoGetRandomValues,
  },
  writable: true,
});

// Mock TextEncoder/Decoder
global.TextEncoder = class {
  encode(str: string): Uint8Array { return new Uint8Array(Buffer.from(str)); }
};

global.TextDecoder = class {
  decode(uint8: Uint8Array): string { return Buffer.from(uint8).toString(); }
};

// Mock atob/btoa
global.atob = (str: string): string => Buffer.from(str, 'base64').toString('binary');
global.btoa = (str: string): string => Buffer.from(str, 'binary').toString('base64');

// Mock D1Database
export const createMockDB = () => {
  const mockPrepare = vi.fn().mockReturnThis();
  const mockBind = vi.fn().mockReturnThis();
  const mockFirst = vi.fn();
  const mockAll = vi.fn();
  const mockRun = vi.fn().mockResolvedValue({ success: true, changes: 1 });

  return {
    prepare: mockPrepare.mockImplementation(() => ({
      bind: mockBind.mockImplementation(() => ({
        first: mockFirst,
        all: mockAll,
        run: mockRun,
      })),
    })),
    _mocks: { prepare: mockPrepare, bind: mockBind, first: mockFirst, all: mockAll, run: mockRun },
  };
};

// Mock KVNamespace
export const createMockKV = () => ({
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  delete: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue({ keys: [] }),
});

// Mock Env
export const createMockEnv = (overrides: Record<string, unknown> = {}) => ({
  DB: createMockDB(),
  CACHE: createMockKV(),
  BREVO_API_KEY: 'test-brevo-key',
  RESEND_API_KEY: 'test-resend-key',
  JWT_SECRET: 'test-jwt-secret-32-bytes-long!!',
  AUTH_SECRET: 'test-auth-secret-32-bytes-long!!',
  ENVIRONMENT: 'test',
  FRONTEND_URL: 'https://test.example.com',
  BREVO_SENDER_EMAIL: 'test@test.com',
  BREVO_SENDER_NAME: 'Test',
  RESEND_SENDER_EMAIL: 'test@test.com',
  RESEND_SENDER_NAME: 'Test',
  JWT_EXPIRY_HOURS: '24',
  RATE_LIMIT_MAX_REQUESTS: '5',
  RATE_LIMIT_WINDOW_MS: '900000',
  ...overrides,
});

// Reset all mocks
export const resetMocks = () => {
  vi.clearAllMocks();
  global.fetch.mockReset();
  mockCryptoSubtle.importKey.mockReset();
  mockCryptoSubtle.sign.mockReset();
  mockCryptoSubtle.verify.mockReset();
  mockCryptoSubtle.digest.mockReset();
  mockCryptoSubtle.deriveBits.mockReset();
};

export { mockCryptoSubtle };