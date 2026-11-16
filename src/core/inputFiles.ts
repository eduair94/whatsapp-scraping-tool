/**
 * Turns a CSV, text or Excel file (or pasted text) into phone-number
 * candidates. Files usually hold more than numbers: order ids, dates, amounts.
 * When one column is clearly the phone column, only that column is read, so
 * the rest never shows up as a wall of "invalid numbers".
 */
import * as fs from 'fs';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { extractCandidates, parseNumber } from './phone';

export const SUPPORTED_EXTENSIONS = ['.csv', '.txt', '.tsv', '.xlsx', '.xls'];
/** Rows inspected to find the phone column. */
const SAMPLE_ROWS = 2000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type Rows = string[][];

const DELIMITERS = [',', ';', '\t', '|'];

/** The delimiter that splits the first lines most consistently, outside quotes. */
export function detectDelimiter(lines: string[]): string {
  let best = ',';
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    let score = 0;
    for (const line of lines.slice(0, 50)) {
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === delimiter && !inQuotes) score++;
      }
    }
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** One delimited line into cells, honouring double quotes and "" escapes. */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

export function rowsFromText(text: string): Rows {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== '');
  const delimiter = detectDelimiter(lines);
  return lines.map((line) => splitLine(line, delimiter));
}

function rowsFromWorkbook(buffer: Buffer): Rows {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const rows: Rows = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const data = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    for (const row of data) {
      // Excel stores a number typed without "+" as a float; print it without exponent.
      rows.push(
        (row as unknown[]).map((cell) =>
          typeof cell === 'number' && Number.isFinite(cell)
            ? Number.isInteger(cell)
              ? cell.toFixed(0)
              : String(cell)
            : String(cell ?? '')
        )
      );
    }
  }
  return rows;
}

/**
 * Column indexes worth reading. A column qualifies when at least half of its
 * filled cells are valid phone numbers; if no column does, every cell is read.
 */
export function phoneColumns(rows: Rows, defaultCountry: string): number[] | null {
  const filled: number[] = [];
  const valid: number[] = [];
  for (const row of rows.slice(0, SAMPLE_ROWS)) {
    row.forEach((cell, index) => {
      if (!cell || !cell.trim()) return;
      filled[index] = (filled[index] ?? 0) + 1;
      const first = extractCandidates(cell)[0];
      if (first && parseNumber(first, defaultCountry).valid) valid[index] = (valid[index] ?? 0) + 1;
    });
  }
  const columns: number[] = [];
  filled.forEach((count, index) => {
    const good = valid[index] ?? 0;
    if (count > 0 && good >= 2 && good / count >= 0.5) columns.push(index);
  });
  return columns.length ? columns : null;
}

export function candidatesFromRows(rows: Rows, defaultCountry: string): string[] {
  const columns = phoneColumns(rows, defaultCountry);
  const out: string[] = [];
  for (const row of rows) {
    const cells = columns ? columns.map((index) => row[index] ?? '') : row;
    for (const cell of cells) if (cell) out.push(...extractCandidates(cell));
  }
  return out;
}

/** Pasted text: every line (or comma-separated piece) is meant to be a number. */
export function candidatesFromText(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\n|\r|[,;\t]/)) {
    const piece = line.trim();
    if (!piece) continue;
    const found = extractCandidates(piece);
    // Keep an unreadable line too, so the person sees it flagged instead of dropped.
    if (found.length) out.push(...found);
    else if (/\d/.test(piece)) out.push(piece.slice(0, 40));
  }
  return out;
}

export interface FileRows {
  label: string;
  rows: Rows;
}

export async function readListFile(filePath: string): Promise<FileRows> {
  const extension = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new Error(`This kind of file is not supported (${extension || 'no extension'}). Use CSV, Excel or text.`);
  }
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error('This file is larger than 100 MB. Split it into smaller files.');
  }
  const buffer = await fs.promises.readFile(filePath);
  const rows =
    extension === '.xlsx' || extension === '.xls'
      ? rowsFromWorkbook(buffer)
      : rowsFromText(buffer.toString('utf8'));
  return { label: path.basename(filePath), rows };
}
