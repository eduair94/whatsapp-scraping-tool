import { describe, it, expect } from 'vitest';
import {
  getResultCategory,
  categorizeResults,
  updateSessionStatistics,
} from './resultUtils';
import { WhatsAppResult } from '../types';

const personActive = {
  number: '+12025550123',
  data: { isWAContact: true, isUser: true, name: 'Alice' },
} as unknown as WhatsAppResult;

const personNotOnWhatsApp = {
  number: '+12025550124',
  data: { isWAContact: false, isUser: false },
} as unknown as WhatsAppResult;

const pending = {
  number: '+12025550125',
  data: null,
} as unknown as WhatsAppResult;

describe('getResultCategory', () => {
  it('returns active when data has isWAContact true', () => {
    expect(getResultCategory(personActive)).toBe('active');
  });

  it('returns not_on_whatsapp when data present but isWAContact false', () => {
    expect(getResultCategory(personNotOnWhatsApp)).toBe('not_on_whatsapp');
  });

  it('returns pending when data is null and there is no error', () => {
    expect(getResultCategory(pending)).toBe('pending');
  });

  it('returns rate_limited when top-level error is a rate-limit message and data is null', () => {
    const r = {
      number: '+12025550126',
      data: null,
      error: 'Rate limit exceeded, retry later',
    } as unknown as WhatsAppResult;
    expect(getResultCategory(r)).toBe('rate_limited');
  });

  it('treats "Too Many Requests" / 429 as rate_limited', () => {
    const r = {
      number: '+1',
      data: null,
      error: 'Request failed with status 429: Too Many Requests',
    } as unknown as WhatsAppResult;
    expect(getResultCategory(r)).toBe('rate_limited');
  });

  it('returns api_error when top-level error is generic and data is null', () => {
    const r = {
      number: '+12025550127',
      data: null,
      error: 'Network timeout',
    } as unknown as WhatsAppResult;
    expect(getResultCategory(r)).toBe('api_error');
  });

  it('returns not_on_whatsapp when error message says number not found', () => {
    const r = {
      number: '+12025550128',
      data: { error: 'WhatsApp number not found', success: null },
    } as unknown as WhatsAppResult;
    expect(getResultCategory(r)).toBe('not_on_whatsapp');
  });

  it('returns rate_limited when data.error contains rate limit', () => {
    const r = {
      number: '+12025550129',
      data: { error: 'rate limit hit', success: null },
    } as unknown as WhatsAppResult;
    expect(getResultCategory(r)).toBe('rate_limited');
  });
});

describe('updateSessionStatistics', () => {
  const results: WhatsAppResult[] = [
    personActive,
    personActive,
    personNotOnWhatsApp,
    pending,
    {
      number: '+1',
      data: null,
      error: 'Rate limit exceeded',
    } as unknown as WhatsAppResult,
    {
      number: '+2',
      data: null,
      error: 'Internal server error',
    } as unknown as WhatsAppResult,
  ];

  const stats = updateSessionStatistics({}, results);

  it('counts active results as successfulChecks', () => {
    expect(stats.successfulChecks).toBe(2);
  });

  it('writes notOnWhatsAppChecks', () => {
    expect(stats.notOnWhatsAppChecks).toBe(1);
  });

  it('writes rateLimitedChecks', () => {
    expect(stats.rateLimitedChecks).toBe(1);
  });

  it('writes apiErrorChecks', () => {
    expect(stats.apiErrorChecks).toBe(1);
  });

  it('excludes pending and rate_limited from completedNumbers', () => {
    // 6 total - 1 pending - 1 rate_limited = 4
    expect(stats.completedNumbers).toBe(4);
  });

  it('keeps failedChecks as not_on_whatsapp + api_error', () => {
    expect(stats.failedChecks).toBe(2);
  });
});

describe('categorizeResults', () => {
  it('buckets each result into exactly one category', () => {
    const c = categorizeResults([
      personActive,
      personNotOnWhatsApp,
      pending,
      {
        number: '+1',
        data: null,
        error: 'rate limit',
      } as unknown as WhatsAppResult,
      { number: '+2', data: null, error: 'boom' } as unknown as WhatsAppResult,
    ]);
    expect(c.activeResults).toHaveLength(1);
    expect(c.notOnWhatsAppResults).toHaveLength(1);
    expect(c.pendingResults).toHaveLength(1);
    expect(c.rateLimitedResults).toHaveLength(1);
    expect(c.apiErrorResults).toHaveLength(1);
  });
});
