import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidatesFromRows, candidatesFromText, detectDelimiter, phoneColumns, readListFile, rowsFromText, splitLine } from './inputFiles';
import { exampleNumber, extractCandidates, formatInternational, parseNumber, parseNumbers, supportedCountries } from './phone';

describe('parseNumber', () => {
  it('trusts the country code of an international number, whatever the default', () => {
    for (const input of ['+598 98 297 150', '+59898297150', '00598 98 297 150', '+598 (98) 297-150']) {
      expect(parseNumber(input, 'US')).toEqual({
        input,
        e164: '+59898297150',
        country: 'UY',
        formatted: '+598 98 297 150',
        lineType: 'Mobile',
        valid: true,
      });
    }
  });

  it('formats every number the way its own country writes it, however it was typed', () => {
    expect(parseNumber('2125550147', 'US').formatted).toBe('+1 212-555-0147');
    expect(parseNumber('0034612345678', 'US').formatted).toBe('+34 612 34 56 78');
    expect(parseNumber('12345', 'US').formatted).toBeUndefined();
  });

  it('says what kind of line a number is, from its numbering plan', () => {
    expect(parseNumber('+598 98 297 150', 'US').lineType).toBe('Mobile');
    expect(parseNumber('+598 2 916 0000', 'US').lineType).toBe('Fixed line');
    // North American numbers do not say which they are.
    expect(parseNumber('(212) 555-0147', 'US').lineType).toBe('Fixed line or mobile');
    expect(parseNumber('+1 800 555 0199', 'US').lineType).toBe('Toll free');
  });

  it('reads a number without a country code against the chosen default country only', () => {
    expect(parseNumber('098 297 150', 'UY')).toMatchObject({ e164: '+59898297150', country: 'UY', valid: true });
    expect(parseNumber('(212) 555-0147', 'US')).toMatchObject({ e164: '+12125550147', country: 'US', valid: true });
    expect(parseNumber('612 34 56 78', 'ES')).toMatchObject({ e164: '+34612345678', country: 'ES', valid: true });
    // The same digits mean nothing in a country they do not fit: no silent guess.
    const wrong = parseNumber('098 297 150', 'US');
    expect(wrong.valid).toBe(false);
    expect(wrong.e164).toBeNull();
    expect(wrong.reason).toMatch(/Not a valid US number/);
  });

  it('accepts bare digits that already carry a country code (spreadsheets drop the +)', () => {
    expect(parseNumber('59898297150', 'US')).toMatchObject({ e164: '+59898297150', country: 'UY', valid: true });
    expect(parseNumber('12125550147', 'UY')).toMatchObject({ e164: '+12125550147', country: 'US', valid: true });
  });

  it('explains why a number is invalid', () => {
    expect(parseNumber('12345', 'US').reason).toBe('Too short to be a phone number.');
    expect(parseNumber('1234567890123456789', 'US').reason).toBe('Too long to be a phone number.');
    expect(parseNumber('+999 123 456 789', 'US').reason).toBe('Not a valid number for its country code.');
  });

  it('keeps what the person typed as the input', () => {
    expect(parseNumber('  +1 (212) 555-0147  ', 'US').input).toBe('+1 (212) 555-0147');
  });
});

describe('parseNumbers', () => {
  it('counts two spellings of one number as a duplicate', () => {
    const { entries, duplicates } = parseNumbers(['+1 212 555 0147', '(212) 555-0147', '12125550147', '2125550148', 'abc 12'], 'US');
    expect(entries.map((e) => e.e164)).toEqual(['+12125550147', '+12125550148', null]);
    expect(duplicates).toBe(2);
  });

  it('ignores empty candidates', () => {
    expect(parseNumbers(['', '   '], 'US')).toEqual({ entries: [], duplicates: 0 });
  });
});

describe('extractCandidates', () => {
  it('finds numbers inside text and leaves dates and short codes alone', () => {
    expect(extractCandidates('Call John on +1 (212) 555-0147 ext 22')).toEqual(['+1 (212) 555-0147']);
    expect(extractCandidates('099 123 456 / 098 765 432')).toEqual(['099 123 456', '098 765 432']);
    expect(extractCandidates('2024/01/15')).toEqual([]);
    expect(extractCandidates('order 4411')).toEqual([]);
    expect(extractCandidates('098\u00a0297\u00a0150')).toEqual(['098\u00a0297\u00a0150']);
  });
});

describe('numbers that spreadsheets and data tools rewrite', () => {
  it('reads a whole number exported as a decimal as the number it is', () => {
    expect(extractCandidates('436641234567.0')).toEqual(['436641234567']);
    expect(extractCandidates('+436641234567.00')).toEqual(['+436641234567']);
    expect(parseNumbers(extractCandidates('436641234567.0'), 'AT').entries.map((e) => e.e164)).toEqual(['+436641234567']);
    expect(parseNumbers(extractCandidates('2125550147.0'), 'US').entries.map((e) => e.e164)).toEqual(['+12125550147']);
    // Dots inside a number are still punctuation.
    expect(extractCandidates('212.555.0100')).toEqual(['212.555.0100']);
  });

  it('refuses scientific notation instead of guessing the lost digits', () => {
    expect(extractCandidates('9.198765432E+11')).toEqual(['9.198765432E+11']);
    const entry = parseNumber('9.198765432E+11', 'IN');
    expect(entry.valid).toBe(false);
    expect(entry.reason).toMatch(/scientific notation/);
    expect(parseNumber('9E+11', 'IN').valid).toBe(false);
  });

  it('leaves dates alone, with hyphens or dots, year first or last', () => {
    for (const date of ['2026-11-15', '2026.11.15', '15-11-2026', '15.11.2026', '11-15-2026', '2026-11-15 10:30:00', '1999-01-02']) {
      expect(extractCandidates(date), date).toEqual([]);
    }
    // A number that only looks a little like a date is kept.
    expect(extractCandidates('2026-11-155')).toEqual(['2026-11-155']);
    expect(extractCandidates('2099 1115')).toEqual(['2099 1115']);
  });

  it('does not take a date column for a phone column', () => {
    const rows = rowsFromText(
      ['name,phone,signup', 'Ana,098 297 150,2026-11-10', 'Luis,099 123 456,2026-11-11', 'Eva,094 111 222,2026-11-12'].join('\n')
    );
    expect(phoneColumns(rows, 'UY')).toEqual([1]);
    expect(candidatesFromRows(rows, 'UY')).toEqual(['098 297 150', '099 123 456', '094 111 222']);
  });

  it('tells two numbers in one cell apart', () => {
    expect(extractCandidates('099 123 451 - 098 297 150')).toEqual(['099 123 451', '098 297 150']);
    expect(extractCandidates('099 123 451   098 297 150')).toEqual(['099 123 451', '098 297 150']);
    expect(extractCandidates('2125550147 2125550148')).toEqual(['2125550147', '2125550148']);
    // One run of digits that is simply too long is not split.
    expect(extractCandidates('1234567890123456789')).toEqual([]);
  });

  it('shows an unreadable cell of the phone column instead of dropping it', () => {
    const rows = rowsFromText(
      ['name,phone', 'Ana,098 297 150', 'Luis,099 123 456', 'Eva,1234567890123456789', 'Leo,ext 12', 'Mia,none', 'Noa,094 111 222', 'Sol,091 222 333'].join('\n')
    );
    expect(candidatesFromRows(rows, 'UY')).toEqual([
      '098 297 150',
      '099 123 456',
      '1234567890123456789',
      'ext 12',
      '094 111 222',
      '091 222 333',
    ]);
  });
});

describe('helpers', () => {
  it('lists every region libphonenumber knows, formats and gives examples', () => {
    expect(supportedCountries().length).toBeGreaterThan(200);
    expect(supportedCountries()).toContain('UY');
    expect(formatInternational('+59898297150')).toBe('+598 98 297 150');
    expect(formatInternational('nonsense')).toBe('nonsense');
    expect(exampleNumber('UY')).toMatch(/\d/);
    expect(exampleNumber('ZZ')).toBe('');
  });
});

describe('reading files', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-files-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('detects the delimiter and honours quoted cells', () => {
    expect(detectDelimiter(['a;b;c', '1;2;3'])).toBe(';');
    expect(detectDelimiter(['a\tb', '1\t2'])).toBe('\t');
    expect(detectDelimiter(['"Doe, John";+1 212 555 0147'])).toBe(';');
    expect(splitLine('"Doe, John",+1 212 555 0147,"say ""hi"""', ',')).toEqual(['Doe, John', '+1 212 555 0147', 'say "hi"']);
  });

  it('reads only the phone column when a file has one', () => {
    const csv = [
      'order,date,phone,amount',
      '100234567,2024-01-15,+1 212 555 0147,1299.50',
      '100234568,2024-01-16,(212) 555-0148,89.00',
      '100234569,2024-01-17,212-555-0149,15000.00',
      '100234570,2024-01-18,,42.00',
    ].join('\r\n');
    const rows = rowsFromText(`\uFEFF${csv}`);
    expect(phoneColumns(rows, 'US')).toEqual([2]);
    expect(candidatesFromRows(rows, 'US')).toEqual(['+1 212 555 0147', '(212) 555-0148', '212-555-0149']);
  });

  it('falls back to every cell when no column stands out', () => {
    const rows = rowsFromText('note\ncall +1 212 555 0147 after six\n');
    expect(phoneColumns(rows, 'US')).toBeNull();
    expect(candidatesFromRows(rows, 'US')).toEqual(['+1 212 555 0147']);
  });

  it('takes pasted text line by line and keeps unreadable lines visible', () => {
    expect(candidatesFromText('+1 212 555 0147\n2125550148, 2125550149\n\n12ab\nhello')).toEqual([
      '+1 212 555 0147',
      '2125550148',
      '2125550149',
      '12ab',
    ]);
  });

  it('reads CSV, text and Excel files, numbers stored as numbers included', async () => {
    const csv = path.join(dir, 'list.csv');
    await fs.promises.writeFile(csv, 'name;phone\nMaya;+1 212 555 0147\nTom;(212) 555-0148\n');
    const fromCsv = await readListFile(csv);
    expect(fromCsv.label).toBe('list.csv');
    expect(candidatesFromRows(fromCsv.rows, 'US')).toEqual(['+1 212 555 0147', '(212) 555-0148']);

    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([['Name', 'Phone'], ['Maya', 59898297150], ['Tom', '+598 98 297 151']]), 'Contacts');
    const file = path.join(dir, 'list.xlsx');
    await fs.promises.writeFile(file, xlsx.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    const fromXlsx = await readListFile(file);
    expect(parseNumbers(candidatesFromRows(fromXlsx.rows, 'US'), 'US').entries.map((e) => e.e164)).toEqual(['+59898297150', '+59898297151']);
  });

  it('reads the UTF-16 text a spreadsheet saves as "Unicode Text"', async () => {
    const text = 'name\tphone\r\nMaya\t+1 212 555 0147\r\nTom\t(212) 555-0148\r\n';
    const little = path.join(dir, 'little.txt');
    await fs.promises.writeFile(little, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
    expect(candidatesFromRows((await readListFile(little)).rows, 'US')).toEqual(['+1 212 555 0147', '(212) 555-0148']);

    const big = path.join(dir, 'big.txt');
    await fs.promises.writeFile(big, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]));
    expect(candidatesFromRows((await readListFile(big)).rows, 'US')).toEqual(['+1 212 555 0147', '(212) 555-0148']);
  });

  it('refuses a file type it cannot read', async () => {
    const file = path.join(dir, 'list.pdf');
    await fs.promises.writeFile(file, 'x');
    await expect(readListFile(file)).rejects.toThrow(/not supported/);
  });
});
