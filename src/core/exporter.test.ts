import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countResults } from '../shared/outcomes';
import { CheckResult, ListNumber, Session } from '../shared/types';
import { asWritten, csvCell, EXPORT_COLUMNS, exportFileName, exportRows, rowValues, safeText, toCsv, toJson, writeExport } from './exporter';

const numbers: ListNumber[] = [
  { e164: '+12125550101', input: '(212) 555-0101' },
  { e164: '+12125550102', input: '212 555 0102' },
  { e164: '+12125550103', input: '=2125550103' },
  { e164: '+12125550104', input: '2125550104' },
];
const results: CheckResult[] = [
  {
    number: '+12125550101',
    outcome: 'on_whatsapp',
    checkedAt: '2026-11-15T12:00:00.000Z',
    name: '=HYPERLINK("http://evil.example","click")',
    about: 'Café "Señor" 🍞\nopen daily',
    business: true,
    verified: true,
    verifiedLevel: 'high',
    category: 'Bakery',
    email: '@evil',
    website: 'https://bakery.example',
    country: 'US',
  },
  { number: '+12125550102', outcome: 'not_on_whatsapp', checkedAt: '2026-11-15T12:00:01.000Z' },
  { number: '+12125550103', outcome: 'failed', checkedAt: '2026-11-15T12:00:02.000Z', note: '-timeout' },
];

const session = (): Session => ({
  meta: {
    id: 's_test',
    name: 'Spring: campaign/list.xlsx',
    source: 'file',
    createdAt: '2026-11-15T11:00:00.000Z',
    updatedAt: '2026-11-15T12:00:02.000Z',
    startedAt: '2026-11-15T11:59:00.000Z',
    status: 'stopped',
    channel: 'direct',
    counts: countResults(results, numbers.length),
    starred: false,
  },
  numbers,
  results,
});

describe('safeText', () => {
  it('neutralises anything a spreadsheet would run as a formula', () => {
    expect(safeText('=1+1')).toBe("'=1+1");
    expect(safeText('+cmd|calc')).toBe("'+cmd|calc");
    expect(safeText('-2+3')).toBe("'-2+3");
    expect(safeText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeText('\t=1')).toBe("'\t=1");
    expect(safeText('Maya')).toBe('Maya');
    expect(safeText('a = b')).toBe('a = b');
    expect(safeText(undefined)).toBe('');
    expect(safeText('bell\u0007')).toBe('bell');
  });
});

/** The value of one named column of a row. */
const column = (values: string[], name: (typeof EXPORT_COLUMNS)[number]): string => values[EXPORT_COLUMNS.indexOf(name)];

describe('rows', () => {
  it('has one row per number of the list, pending ones included, in list order', () => {
    const rows = exportRows(session());
    expect(rows.map((r) => r.entry.e164)).toEqual(numbers.map((n) => n.e164));
    const pending = rowValues(rows[3]);
    expect(pending).toHaveLength(EXPORT_COLUMNS.length);
    expect(pending[0]).toBe('+12125550104');
    expect(pending[1]).toBe('Pending');
    expect(pending.at(-1)).toBe('2125550104');
    expect(pending.slice(2, -1).every((value) => value === '')).toBe(true);
    expect(rowValues(rows[0])).toHaveLength(EXPORT_COLUMNS.length);
  });

  it('filters by outcome', () => {
    expect(exportRows(session(), 'on_whatsapp').map((r) => r.entry.e164)).toEqual(['+12125550101']);
    expect(exportRows(session(), 'failed').map((r) => r.entry.e164)).toEqual(['+12125550103']);
    expect(exportRows(session(), 'invalid')).toEqual([]);
  });

  it('keeps the number itself as digits and neutralises every text field', () => {
    const [row] = exportRows(session());
    const values = rowValues(row);
    expect(column(values, 'Number')).toBe('+12125550101');
    expect(column(values, 'Outcome')).toBe('On WhatsApp');
    expect(column(values, 'Name')).toBe(`'=HYPERLINK("http://evil.example","click")`);
    expect(column(values, 'Account type')).toBe('Business');
    expect(column(values, 'Verification')).toBe('Official business account');
    expect(column(values, 'Email')).toBe("'@evil");
    const failed = rowValues(exportRows(session())[2]);
    expect(column(failed, 'Note')).toBe("'-timeout");
    expect(column(failed, 'As written in your list')).toBe("'=2125550103");
  });

  it('keeps a number written with its + exactly as the list has it', () => {
    expect(asWritten('+1 212 555 0101')).toBe('+1 212 555 0101');
    expect(asWritten('+1 (212) 555-0101')).toBe('+1 (212) 555-0101');
    expect(asWritten('(212) 555-0101')).toBe('(212) 555-0101');
    // Anything that is more than digits and punctuation is still neutralised.
    expect(asWritten('+1+cmd|calc')).toBe("'+1+cmd|calc");
    expect(asWritten('=2125550103')).toBe("'=2125550103");
    expect(asWritten('-SUM(A1)')).toBe("'-SUM(A1)");
    expect(asWritten(undefined)).toBe('');
  });

  it('writes every field of a full profile', () => {
    const full: Session = {
      ...session(),
      numbers: [{ e164: '+59899123456', input: '099 123 456', country: 'UY', formatted: '+598 99 123 456', lineType: 'Mobile' }],
      results: [
        {
          number: '+59899123456',
          outcome: 'on_whatsapp',
          checkedAt: '2026-11-15T12:00:00.000Z',
          name: 'Harbor Street Bakery',
          about: 'Fresh every day',
          aboutSetAt: '2025-04-02T08:00:00.000Z',
          picture: 'shown',
          pictureUrl: 'https://whatsapp-db.checkleaked.com/59899123456.jpg',
          business: true,
          businessKind: 'app',
          verifiedLevel: 'low',
          category: 'Bakery',
          websites: ['https://bakery.example', 'https://shop.bakery.example'],
          website: 'https://bakery.example',
          location: { lat: -34.9011, lng: -56.1645 },
          hours: 'Every day, open 24 hours',
          memberSince: '2024-01-25T20:48:19.000Z',
          links: ['Instagram: @harborbakery', 'Facebook page: Harbor'],
          catalog: true,
          aboutHistory: [{ about: 'Opening soon', seenAt: '2024-02-01T00:00:00.000Z' }, { about: 'Closed today' }],
          pictureHistory: [
            { url: 'https://whatsapp-db.checkleaked.com/59899123456_1.jpg', seenAt: '2024-03-01T00:00:00.000Z' },
            { url: 'data:image/svg+xml;utf8,demo' },
          ],
          recordedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    };
    const values = rowValues(exportRows(full)[0]);
    expect(column(values, 'Business account')).toBe('WhatsApp Business app');
    expect(column(values, 'Verification')).toBe('Verified name');
    expect(column(values, 'About set on')).toBe('2025-04-02');
    expect(column(values, 'Profile picture')).toBe('https://whatsapp-db.checkleaked.com/59899123456.jpg');
    expect(column(values, 'Picture')).toBe('Shown');
    expect(column(values, 'Website')).toBe('https://bakery.example, https://shop.bakery.example');
    expect(column(values, 'Location')).toBe('-34.90110, -56.16450');
    expect(column(values, 'Opening hours')).toBe('Every day, open 24 hours');
    expect(column(values, 'On WhatsApp Business since')).toBe('January 2024');
    expect(column(values, 'Linked accounts')).toBe('Instagram: @harborbakery; Facebook page: Harbor');
    expect(column(values, 'Product catalog')).toBe('Yes');
    expect(column(values, 'Country')).toBe('UY');
    expect(column(values, 'Line type')).toBe('Mobile');
    expect(column(values, 'Earlier about texts')).toBe('Opening soon (2024-02-01) | Closed today');
    // Demo drawings are not addresses anyone can open.
    expect(column(values, 'Earlier pictures')).toBe('https://whatsapp-db.checkleaked.com/59899123456_1.jpg');
    // Collected six weeks before the check: the database answered.
    expect(column(values, 'Record date')).toBe('2026-10-01T00:00:00.000Z');

    full.results[0].recordedAt = '2026-11-15T11:59:58.000Z';
    expect(column(rowValues(exportRows(full)[0]), 'Record date')).toBe('');

    const json = JSON.parse(toJson(full, exportRows(full)));
    expect(json.results[0]).toMatchObject({
      number: '+59899123456',
      formatted: '+598 99 123 456',
      lineType: 'Mobile',
      country: 'UY',
      outcome: 'on_whatsapp',
      websites: ['https://bakery.example', 'https://shop.bakery.example'],
      location: { lat: -34.9011, lng: -56.1645 },
    });
  });
});

describe('CSV', () => {
  it('starts with a byte-order mark, uses CRLF and quotes what needs quoting', () => {
    const csv = toCsv(exportRows(session()));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(','));
    expect(lines.at(-1)).toBe(''); // ends with a line break
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv).toContain('"Café ""Señor"" 🍞\nopen daily"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});

describe('files', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-export-'));
  });
  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it('writes Excel with every cell as text, so numbers never become 1.2E+10', async () => {
    const file = path.join(dir, 'out.xlsx');
    expect(await writeExport(session(), 'xlsx', 'all', file)).toEqual({ rows: 4 });
    const book = xlsx.read(await fs.promises.readFile(file));
    expect(book.SheetNames).toEqual(['Results', 'Summary']);
    const sheet = book.Sheets.Results;
    expect(sheet.A2).toMatchObject({ t: 's', v: '+12125550101' });
    expect(sheet.C2).toMatchObject({ t: 's', v: `'=HYPERLINK("http://evil.example","click")` });
    expect(sheet.C2.f).toBeUndefined(); // not a formula
    const summary = xlsx.utils.sheet_to_json<string[]>(book.Sheets.Summary, { header: 1 });
    expect(summary).toContainEqual(['On WhatsApp', '1']);
    expect(summary).toContainEqual(['Pending', '1']);
  });

  it('leaves no temporary file beside a workbook it could not replace', async () => {
    const target = path.join(dir, 'open-in-excel.xlsx');
    await fs.promises.mkdir(target); // stands in for a file another program holds
    await expect(writeExport(session(), 'xlsx', 'all', target)).rejects.toThrow();
    expect(await fs.promises.readdir(dir)).toEqual(['open-in-excel.xlsx']);
  }, 15_000);

  it('writes CSV and JSON, and JSON never carries a key or settings', async () => {
    const csv = path.join(dir, 'out.csv');
    await writeExport(session(), 'csv', 'on_whatsapp', csv);
    expect((await fs.promises.readFile(csv, 'utf8')).split('\r\n').filter(Boolean)).toHaveLength(2);

    const json = path.join(dir, 'out.json');
    await writeExport(session(), 'json', 'all', json);
    const parsed = JSON.parse(await fs.promises.readFile(json, 'utf8'));
    expect(parsed.session).toMatchObject({ name: 'Spring: campaign/list.xlsx', channel: 'Direct key', status: 'stopped' });
    expect(parsed.results).toHaveLength(4);
    expect(parsed.results[3]).toEqual({ number: '+12125550104', input: '2125550104', outcome: 'pending' });
    expect(JSON.stringify(parsed)).not.toMatch(/apiKey|settings/i);
    expect(toJson(session(), [])).toContain('"results": []');
    expect(await fs.promises.readdir(dir)).toEqual(['out.csv', 'out.json']); // no temp files left
  });

  it('builds a file name a person can recognise', () => {
    expect(exportFileName(session(), 'csv', new Date('2026-11-15T10:00:00Z'))).toBe('Spring-campaign-list-checked-2026-11-15.csv');
    const odd = session();
    odd.meta.name = '///';
    expect(exportFileName(odd, 'xlsx', new Date('2026-11-15T10:00:00Z'))).toBe('numbers-checked-2026-11-15.xlsx');
  });
});
