import { describe, it, expect, vi } from 'vitest';

vi.mock('react-hot-toast', () => ({ default: { success: () => {} } }));

import { NumberProcessingUtils } from './NumberProcessingUtils';
import { PhoneNumberData } from '../types';

const num = (cleaned: string): PhoneNumberData => ({
  original: cleaned,
  cleaned,
  isValid: true,
});

describe('filterDuplicates', () => {
  it('removes numbers already present in existing', () => {
    const existing = [num('+1'), num('+2')];
    const incoming = [num('+2'), num('+3')];
    const { uniqueNumbers, duplicateCount } =
      NumberProcessingUtils.filterDuplicates(existing, incoming);
    expect(uniqueNumbers.map((n) => n.cleaned)).toEqual(['+3']);
    expect(duplicateCount).toBe(1);
  });

  it('removes duplicates within the incoming batch itself', () => {
    const { uniqueNumbers, duplicateCount } =
      NumberProcessingUtils.filterDuplicates(
        [],
        [num('+5'), num('+5'), num('+6')]
      );
    expect(uniqueNumbers.map((n) => n.cleaned)).toEqual(['+5', '+6']);
    expect(duplicateCount).toBe(1);
  });
});

describe('generateNumbersKey', () => {
  it('returns the same key for identical content', () => {
    const a = [num('+1'), num('+2'), num('+3')];
    const b = [num('+1'), num('+2'), num('+3')];
    expect(NumberProcessingUtils.generateNumbersKey(a)).toBe(
      NumberProcessingUtils.generateNumbersKey(b)
    );
  });

  it('returns different keys when content differs past the first element', () => {
    const a = [num('+1'), num('+2'), num('+3')];
    const b = [num('+1'), num('+9'), num('+3')];
    expect(NumberProcessingUtils.generateNumbersKey(a)).not.toBe(
      NumberProcessingUtils.generateNumbersKey(b)
    );
  });

  it('returns different keys for same length and same first number but different rest', () => {
    const a = [num('+1'), num('+2')];
    const b = [num('+1'), num('+3')];
    expect(NumberProcessingUtils.generateNumbersKey(a)).not.toBe(
      NumberProcessingUtils.generateNumbersKey(b)
    );
  });
});
