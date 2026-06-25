import { describe, it, expect } from 'vitest';
import { categoryOf, countCategories } from './categorize';

describe('categoryOf', () => {
  it('active for isWAContact', () => {
    expect(categoryOf({ data: { isWAContact: true } })).toBe('active');
  });
  it('not_on_whatsapp for data with isWAContact false', () => {
    expect(categoryOf({ data: { isWAContact: false } })).toBe(
      'not_on_whatsapp'
    );
  });
  it('pending for null data without error', () => {
    expect(categoryOf({ data: null })).toBe('pending');
  });
  it('rate_limited for top-level rate limit error with null data', () => {
    expect(categoryOf({ data: null, error: 'Rate limit exceeded' })).toBe(
      'rate_limited'
    );
  });
  it('api_error for generic top-level error with null data', () => {
    expect(categoryOf({ data: null, error: 'boom' })).toBe('api_error');
  });
  it('not_on_whatsapp for data.error not found', () => {
    expect(
      categoryOf({ data: { error: 'number not found', isWAContact: false } })
    ).toBe('not_on_whatsapp');
  });
});

describe('countCategories', () => {
  it('counts and excludes pending + rate_limited from completed', () => {
    const c = countCategories([
      { data: { isWAContact: true } },
      { data: { isWAContact: false } },
      { data: null },
      { data: null, error: 'rate limit' },
      { data: null, error: 'server error' },
    ]);
    expect(c.active).toBe(1);
    expect(c.notOnWhatsApp).toBe(1);
    expect(c.pending).toBe(1);
    expect(c.rateLimited).toBe(1);
    expect(c.apiError).toBe(1);
    expect(c.completed).toBe(3); // 5 - pending(1) - rateLimited(1)
  });
});
