import { describe, it, expect } from 'vitest';
import { sanitizeSessionId, toSessionSummary } from './storageUtils';
import { CheckSession } from '../types';

describe('sanitizeSessionId', () => {
  it('accepts normal generated ids', () => {
    expect(sanitizeSessionId('1718900000000-abc123')).toBe(
      '1718900000000-abc123'
    );
  });

  it('rejects path traversal with ../', () => {
    expect(() => sanitizeSessionId('../../settings')).toThrow();
  });

  it('rejects path traversal with backslashes', () => {
    expect(() => sanitizeSessionId('..\\..\\AppData\\evil')).toThrow();
  });

  it('rejects path separators', () => {
    expect(() => sanitizeSessionId('a/b')).toThrow();
    expect(() => sanitizeSessionId('a.b')).toThrow();
  });

  it('rejects empty id', () => {
    expect(() => sanitizeSessionId('')).toThrow();
  });
});

describe('toSessionSummary', () => {
  const session = {
    id: 's1',
    fileName: 'f.csv',
    startTime: new Date('2024-01-01T00:00:00Z'),
    endTime: new Date('2024-01-01T01:00:00Z'),
    totalNumbers: 10,
    completedNumbers: 8,
    successfulChecks: 5,
    failedChecks: 3,
    notOnWhatsAppChecks: 2,
    apiErrorChecks: 1,
    rateLimitedChecks: 0,
    results: [{ number: '+1', data: null }],
    settings: { apiKey: 'SECRET' },
    status: 'completed',
    isStarred: true,
  } as unknown as CheckSession;

  const summary = toSessionSummary(session);

  it('keeps lightweight metadata', () => {
    expect(summary.id).toBe('s1');
    expect(summary.totalNumbers).toBe(10);
    expect(summary.successfulChecks).toBe(5);
    expect(summary.status).toBe('completed');
    expect(summary.isStarred).toBe(true);
  });

  it('does not carry the heavy results array', () => {
    expect(
      (summary as unknown as { results?: unknown }).results
    ).toBeUndefined();
  });

  it('does not leak settings / apiKey', () => {
    expect(
      (summary as unknown as { settings?: unknown }).settings
    ).toBeUndefined();
  });
});
