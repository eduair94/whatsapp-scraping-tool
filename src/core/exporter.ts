/**
 * CSV, Excel and JSON exports of a session.
 *
 * Names, about texts and business descriptions are written by strangers. A
 * profile named `=HYPERLINK(…)` would run as a formula when the file is opened,
 * so every text cell that a spreadsheet could execute is neutralised. The CSV
 * carries a byte-order mark and CRLF line ends so Excel reads accents and
 * emoji correctly.
 */
import * as fs from 'fs';
import * as xlsx from 'xlsx';
import { CHANNELS } from '../shared/channels';
import { OUTCOME_LABEL } from '../shared/outcomes';
import {
  accountType,
  BUSINESS_KIND_LABEL,
  isoDay,
  locationLabel,
  memberSinceLabel,
  PICTURE_LABEL,
  VERIFICATION_LABEL,
} from '../shared/profile';
import { CheckResult, ExportFormat, ExportScope, ListNumber, Session } from '../shared/types';
import { writeFileAtomic } from './sessionStore';

export const EXPORT_COLUMNS = [
  'Number',
  'Outcome',
  'Name',
  'Account type',
  'Business account',
  'Verification',
  'About',
  'About set on',
  'Profile picture',
  'Picture',
  'Business category',
  'Business description',
  'Email',
  'Website',
  'Address',
  'Location',
  'Opening hours',
  'On WhatsApp Business since',
  'Linked accounts',
  'Product catalog',
  'Country',
  'Line type',
  'Earlier about texts',
  'Earlier pictures',
  'Record date',
  'Checked at',
  'Note',
  'As written in your list',
] as const;

/** Columns that hold sentences or lists, given more room in the workbook. */
const WIDE_COLUMNS: readonly string[] = [
  'About',
  'Profile picture',
  'Business description',
  'Website',
  'Address',
  'Opening hours',
  'Linked accounts',
  'Earlier about texts',
  'Earlier pictures',
  'Note',
];

/** One row per number of the list, pending ones included, in list order. */
export interface ExportRow {
  entry: ListNumber;
  result: CheckResult | null;
}

export function exportRows(session: Session, scope: ExportScope = 'all'): ExportRow[] {
  const byNumber = new Map(session.results.map((r) => [r.number, r]));
  const rows: ExportRow[] = [];
  for (const entry of session.numbers) {
    const result = byNumber.get(entry.e164) ?? null;
    if (scope !== 'all' && result?.outcome !== scope) continue;
    rows.push({ entry, result });
  }
  return rows;
}

/**
 * A cell a spreadsheet would treat as a formula gets a leading apostrophe,
 * which Excel, LibreOffice and Google Sheets all read as "this is text".
 * Phone numbers start with `+` and are handled separately: they are known to
 * be digits, so they stay as they are.
 */
export function safeText(value: string | undefined): string {
  if (!value) return '';
  // Control characters are exactly what this removes: they break spreadsheet files.
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** More than an hour between the record and the check: the record came from the database. */
function recordDate(r: CheckResult | null): string {
  if (!r?.recordedAt) return '';
  const gap = Math.abs(new Date(r.checkedAt).getTime() - new Date(r.recordedAt).getTime());
  return gap > 3_600_000 ? r.recordedAt : '';
}

export function rowValues(row: ExportRow): string[] {
  const r = row.result;
  const on = r?.outcome === 'on_whatsapp';
  return [
    row.entry.e164,
    r ? OUTCOME_LABEL[r.outcome] : 'Pending',
    safeText(r?.name),
    accountType(r),
    r?.businessKind ? BUSINESS_KIND_LABEL[r.businessKind] : '',
    r?.verifiedLevel ? VERIFICATION_LABEL[r.verifiedLevel] : '',
    safeText(r?.about),
    isoDay(r?.aboutSetAt),
    r?.pictureUrl && !r.pictureUrl.startsWith('data:') ? r.pictureUrl : '',
    on && r?.picture ? PICTURE_LABEL[r.picture] : '',
    safeText(r?.category),
    safeText(r?.description),
    safeText(r?.email),
    safeText((r?.websites ?? (r?.website ? [r.website] : [])).join(', ')),
    safeText(r?.address),
    locationLabel(r?.location),
    safeText(r?.hours),
    memberSinceLabel(r?.memberSince),
    safeText(r?.links?.join('; ')),
    r?.catalog ? 'Yes' : '',
    r?.country ?? row.entry.country ?? '',
    row.entry.lineType ?? '',
    safeText(r?.aboutHistory?.map((a) => (a.seenAt ? `${a.about} (${isoDay(a.seenAt)})` : a.about)).join(' | ')),
    (r?.pictureHistory ?? [])
      .map((p) => p.url)
      .filter((url) => !url.startsWith('data:'))
      .join(' '),
    recordDate(r),
    r?.checkedAt ?? '',
    safeText(r?.note),
    safeText(row.entry.input),
  ];
}

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.map(csvCell).join(',')];
  for (const row of rows) lines.push(rowValues(row).map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function withoutKeys<T extends object>(value: T, keys: string[]): Partial<T> {
  const out = { ...value } as Record<string, unknown>;
  for (const key of keys) delete out[key];
  return out as Partial<T>;
}

/** Every field as the app holds it: arrays stay arrays, dates stay ISO timestamps. */
export function toJson(session: Session, rows: ExportRow[]): string {
  const { meta } = session;
  return `${JSON.stringify(
    {
      session: {
        name: meta.name,
        status: meta.status,
        channel: meta.channel ? CHANNELS[meta.channel].label : null,
        createdAt: meta.createdAt,
        startedAt: meta.startedAt ?? null,
        finishedAt: meta.finishedAt ?? null,
        counts: meta.counts,
      },
      results: rows.map(({ entry, result }) => ({
        number: entry.e164,
        input: entry.input,
        ...(entry.formatted ? { formatted: entry.formatted } : {}),
        ...(entry.lineType ? { lineType: entry.lineType } : {}),
        ...(entry.country ? { country: entry.country } : {}),
        outcome: result?.outcome ?? 'pending',
        ...(result ? withoutKeys(result, ['number', 'outcome']) : {}),
      })),
    },
    null,
    2
  )}\n`;
}

export function toWorkbook(session: Session, rows: ExportRow[]): xlsx.WorkBook {
  const { meta } = session;
  const c = meta.counts;
  // Every cell is typed as text, so Excel never turns a phone number into 5.98E+10.
  const textSheet = (data: string[][]): xlsx.WorkSheet => {
    const sheet: xlsx.WorkSheet = {};
    data.forEach((line, r) => {
      line.forEach((value, col) => {
        sheet[xlsx.utils.encode_cell({ r, c: col })] = { t: 's', v: value };
      });
    });
    const width = Math.max(1, ...data.map((line) => line.length));
    sheet['!ref'] = xlsx.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, data.length - 1), c: width - 1 } });
    return sheet;
  };

  const results = textSheet([[...EXPORT_COLUMNS], ...rows.map(rowValues)]);
  results['!cols'] = EXPORT_COLUMNS.map((name) => ({ wch: WIDE_COLUMNS.includes(name) ? 40 : 22 }));

  const summary = textSheet([
    ['List', safeText(meta.name)],
    ['Status', meta.status],
    ['Channel', meta.channel ? CHANNELS[meta.channel].label : ''],
    ['Started', meta.startedAt ?? ''],
    ['Finished', meta.finishedAt ?? ''],
    ['Numbers in the list', String(c.total)],
    [OUTCOME_LABEL.on_whatsapp, String(c.on_whatsapp)],
    ['  of which business', String(c.business)],
    [OUTCOME_LABEL.not_on_whatsapp, String(c.not_on_whatsapp)],
    [OUTCOME_LABEL.not_in_database, String(c.not_in_database)],
    [OUTCOME_LABEL.invalid, String(c.invalid)],
    [OUTCOME_LABEL.failed, String(c.failed)],
    ['Pending', String(Math.max(0, c.total - c.checked))],
  ]);
  summary['!cols'] = [{ wch: 26 }, { wch: 40 }];

  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, results, 'Results');
  xlsx.utils.book_append_sheet(workbook, summary, 'Summary');
  return workbook;
}

/** A file name a person can recognise, safe on every system. */
export function exportFileName(session: Session, format: ExportFormat, now = new Date()): string {
  const base =
    session.meta.name
      .replace(/\.[A-Za-z0-9]{1,5}$/, '')
      .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'numbers';
  return `${base}-checked-${now.toISOString().slice(0, 10)}.${format}`;
}

export async function writeExport(
  session: Session,
  format: ExportFormat,
  scope: ExportScope,
  filePath: string
): Promise<{ rows: number }> {
  const rows = exportRows(session, scope);
  if (format === 'csv') await writeFileAtomic(filePath, toCsv(rows));
  else if (format === 'json') await writeFileAtomic(filePath, toJson(session, rows));
  else {
    const buffer = xlsx.write(toWorkbook(session, rows), { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, buffer);
    await fs.promises.rename(tmp, filePath);
  }
  return { rows: rows.length };
}
