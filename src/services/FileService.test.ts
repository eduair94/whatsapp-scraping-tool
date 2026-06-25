import { describe, it, expect } from 'vitest';
import { FileService } from './FileService';

const svc = new FileService();

async function parseOne(input: string) {
  const res = await svc.parseTextInput(input);
  return res.numbers[0];
}

describe('FileService phone parsing', () => {
  it('parses an international number with +', async () => {
    const n = await parseOne('+16502530000');
    expect(n.isValid).toBe(true);
    expect(n.country).toBe('US');
    expect(n.cleaned).toBe('+16502530000');
  });

  it('parses a national US number (no +) to the US, not a foreign country', async () => {
    const n = await parseOne('6502530000');
    expect(n.isValid).toBe(true);
    expect(n.country).toBe('US');
    expect(n.cleaned).toBe('+16502530000');
  });

  it('parses a formatted national US number', async () => {
    const n = await parseOne('(650) 253-0000');
    expect(n.isValid).toBe(true);
    expect(n.cleaned).toBe('+16502530000');
  });

  it('preserves the user-entered original instead of mutating it to +digits', async () => {
    const n = await parseOne('(650) 253-0000');
    expect(n.original).toBe('(650) 253-0000');
  });

  it('parses an international UK number to GB', async () => {
    const n = await parseOne('+442079460958');
    expect(n.isValid).toBe(true);
    expect(n.country).toBe('GB');
  });

  it('marks an unparseable string as invalid', async () => {
    const n = await parseOne('1234567');
    expect(n.isValid).toBe(false);
  });
});
