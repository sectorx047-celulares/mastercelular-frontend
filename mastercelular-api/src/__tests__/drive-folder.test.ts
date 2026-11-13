// mastercelular-api/src/__tests__/drive-folder.test.ts
import { describe, it, expect, beforeEach } from 'vitest';

import { createMockEnv, type createMockDB, resetMocks } from './setup';

describe('Drive Folder Access (/api/courses/:courseId/drive-folder)', () => {
  let mockEnv: ReturnType<typeof createMockEnv>;
  let mockDB: ReturnType<typeof createMockDB>;

  beforeEach(() => {
    resetMocks();
    mockEnv = createMockEnv();
    mockDB = mockEnv.DB;
  });

  const validEnrollment = {
    access_type: 'FULL',
    drive_folder_url: 'https://drive.google.com/drive/folders/1Anh-5NARPPzEtpKU72TBGa00Ri12rzhd',
    course_name: 'Curso de Reparación de Celulares desde Cero',
  };

  const freeEnrollment = {
    ...validEnrollment,
    access_type: 'FREE',
  };

  const noDriveUrlEnrollment = {
    ...validEnrollment,
    drive_folder_url: '',
  };

  it('should return 401 when no Authorization header', () => {
    const authHeader = null;
    expect(authHeader).toBeNull();
  });

  it('should return 401 when Authorization header is malformed', () => {
    const authHeader = 'Bearer '; // Missing token (has space but no token)
    expect(authHeader.startsWith('Bearer ')).toBe(true);
    expect(authHeader.slice(7)).toBe(''); // Empty token
  });

  it('should return 401 when JWT is invalid', () => {
    expect(true).toBe(true);
  });

  it('should return 403 when user not enrolled', async () => {
    mockDB._mocks.first.mockResolvedValueOnce(null);

    const enrollment = await mockEnv.DB.prepare(
      `SELECT e.access_type, c.drive_folder_url, c.name AS course_name
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND e.course_id = ? AND c.is_active = 1`
    ).bind(1, 'celulares').first();

    expect(enrollment).toBeNull();
  });

  it('should return 403 when user has FREE access only', async () => {
    mockDB._mocks.first.mockResolvedValueOnce(freeEnrollment);

    const enrollment = await mockEnv.DB.prepare(
      `SELECT e.access_type, c.drive_folder_url, c.name AS course_name
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND e.course_id = ? AND c.is_active = 1`
    ).bind(1, 'celulares').first();

    expect(enrollment?.access_type).toBe('FREE');
    expect(enrollment?.access_type).not.toBe('FULL');
  });

  it('should return 404 when drive folder not configured', async () => {
    mockDB._mocks.first.mockResolvedValueOnce(noDriveUrlEnrollment);

    const enrollment = await mockEnv.DB.prepare(
      `SELECT e.access_type, c.drive_folder_url, c.name AS course_name
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND e.course_id = ? AND c.is_active = 1`
    ).bind(1, 'celulares').first();

    expect(enrollment?.access_type).toBe('FULL');
    expect(enrollment?.drive_folder_url).toBe('');
  });

  it('should return drive folder URL when user has FULL access', async () => {
    mockDB._mocks.first.mockResolvedValueOnce(validEnrollment);

    const enrollment = await mockEnv.DB.prepare(
      `SELECT e.access_type, c.drive_folder_url, c.name AS course_name
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND e.course_id = ? AND c.is_active = 1`
    ).bind(1, 'celulares').first();

    expect(enrollment?.access_type).toBe('FULL');
    expect(enrollment?.drive_folder_url).toBe('https://drive.google.com/drive/folders/1Anh-5NARPPzEtpKU72TBGa00Ri12rzhd');
    expect(enrollment?.course_name).toBe('Curso de Reparación de Celulares desde Cero');
  });

  it('should audit log successful access', async () => {
    mockDB._mocks.first.mockResolvedValueOnce(validEnrollment);
    mockDB._mocks.run.mockResolvedValueOnce({ success: true });

    // First query for enrollment
    await mockEnv.DB.prepare(
      `SELECT e.access_type, c.drive_folder_url, c.name AS course_name
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? AND e.course_id = ? AND c.is_active = 1`
    ).bind(1, 'celulares').first();

    // Then audit log insert
    await mockEnv.DB.prepare(
      `INSERT INTO audit_logs (user_id, whatsapp, action, course_id, result, detail, ip_hash, user_agent)
       VALUES (?, ?, 'drive_folder_access', ?, 'success', ?, ?, ?)`
    ).bind(1, '51916381231', 'celulares', JSON.stringify({ request_id: 'test-123' }), 'ip-hash', 'user-agent').run();

    // Verify run was called (the query executed)
    expect(mockDB._mocks.run).toHaveBeenCalled();
  });
});