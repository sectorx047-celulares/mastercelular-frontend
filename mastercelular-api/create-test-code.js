import crypto from 'crypto';

// This needs to match the AUTH_SECRET in Cloudflare
// For testing, we'll use a known value
const AUTH_SECRET = 'test-secret-change-in-production';
const code = 'CEL-TEST-1234';
const normalizedCode = code.toUpperCase().replace(/\s+/g, '');

const hash = crypto.createHmac('sha256', AUTH_SECRET)
  .update(normalizedCode)
  .digest('hex');

console.log('Code:', code);
console.log('Normalized:', normalizedCode);
console.log('Hash:', hash);

// SQL to insert
console.log(`\nINSERT INTO activation_codes (code_hash, course_id, status, batch_id, created_at) VALUES ('${hash}', 'celulares', 'AVAILABLE', 'test-batch', datetime('now'));`);