/**
 * Version 1 kept each session as one JSON file that also held a copy of the
 * settings, API key included, in plain text. This moves those sessions to the
 * current layout and deletes the old files, so no key is left on disk.
 *
 * Lists that were loaded but never checked are not carried over: they hold
 * nothing the person does not still have in their own file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { countResults } from '../shared/outcomes';
import { CheckResult, ListNumber } from '../shared/types';
import { redact } from './apiClient';
import { profile } from './classify';
import { describeNumber } from './phone';
import { SessionStore } from './sessionStore';

interface LegacyResult {
  number?: unknown;
  data?: Record<string, unknown> | null;
  error?: unknown;
  checkedAt?: unknown;
}

interface LegacySession {
  id?: unknown;
  fileName?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  status?: unknown;
  isStarred?: unknown;
  results?: LegacyResult[];
  originalNumbers?: { original?: unknown; cleaned?: unknown; country?: unknown }[];
  settings?: { apiKey?: unknown };
}

const e164 = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
};

const iso = (value: unknown, fallback: string): string => {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
};

/** The old categoriser, reduced to what it means for the current outcomes. */
export function convertLegacyResult(old: LegacyResult, apiKey: string, fallbackTime: string): CheckResult | null {
  const number = e164(old.number);
  if (!number) return null;
  const checkedAt = iso(old.checkedAt, fallbackTime);
  const data = old.data && typeof old.data === 'object' ? old.data : null;
  const message = String(old.error || (data && data.error) || '').trim();

  if (message) {
    const m = message.toLowerCase();
    // A throttled number never got an answer: it is simply still pending.
    if (/rate limit|too many requests|429|quota/.test(m)) return null;
    if (/not found|not on whatsapp|does(n't| not) exist/.test(m)) {
      return { number, outcome: 'not_on_whatsapp', checkedAt };
    }
    return { number, outcome: 'failed', checkedAt, note: redact(message, apiKey).slice(0, 300) };
  }
  if (!data) return null;
  if (data.exists === false) return { number, outcome: 'not_on_whatsapp', checkedAt };
  if (data.isWAContact === true || data.isUser === true) return profile(number, data, checkedAt);
  return { number, outcome: 'not_on_whatsapp', checkedAt };
}

const GENERIC_NAMES = /^(pending session|current session|text-input|bulk-check-\d{4}-\d{2}-\d{2})$/i;

export interface MigrationReport {
  migrated: number;
  dropped: number;
  failed: number;
}

/**
 * @param legacyDir folder that holds the old `<id>.json` files
 * @param store     where the converted sessions go
 */
export async function migrateLegacySessions(legacyDir: string, store: SessionStore): Promise<MigrationReport> {
  const report: MigrationReport = { migrated: 0, dropped: 0, failed: 0 };
  let names: string[];
  try {
    names = await fs.promises.readdir(legacyDir);
  } catch {
    return report;
  }

  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(legacyDir, name);
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) continue;
      const old = JSON.parse(await fs.promises.readFile(file, 'utf8')) as LegacySession;
      const apiKey = typeof old.settings?.apiKey === 'string' ? old.settings.apiKey : '';
      const started = iso(old.startTime, stat.mtime.toISOString());

      const results: CheckResult[] = [];
      for (const r of Array.isArray(old.results) ? old.results : []) {
        const converted = convertLegacyResult(r, apiKey, started);
        if (converted) results.push(converted);
      }

      if (results.length === 0) {
        await fs.promises.rm(file, { force: true });
        report.dropped++;
        continue;
      }

      // The list: what was loaded, plus any checked number missing from it.
      const numbers: ListNumber[] = [];
      const seen = new Set<string>();
      const add = (value: unknown, input: unknown, country?: unknown) => {
        const n = e164(value);
        if (!n || seen.has(n)) return;
        seen.add(n);
        const described = describeNumber(n);
        numbers.push({
          e164: n,
          input: String(input ?? n),
          ...described,
          ...(typeof country === 'string' && country ? { country } : {}),
        });
      };
      for (const n of Array.isArray(old.originalNumbers) ? old.originalNumbers : []) add(n.cleaned, n.original, n.country);
      for (const r of results) add(r.number, r.number);

      const label = typeof old.fileName === 'string' ? old.fileName.trim() : '';
      const meta = await store.create(
        {
          name: !label || GENERIC_NAMES.test(label) ? `List checked on ${started.slice(0, 10)}` : label,
          source: 'file',
          numbers,
        },
        new Date(started)
      );
      for (const r of results) await store.appendResult(meta.id, r);
      const counts = countResults(results, numbers.length);
      await store.updateMeta(meta.id, {
        status: counts.pending === 0 ? 'completed' : 'stopped',
        stopReason: counts.pending === 0 ? undefined : 'Carried over from an earlier version. Continue to finish it.',
        startedAt: started,
        finishedAt: counts.pending === 0 ? iso(old.endTime, started) : undefined,
        updatedAt: iso(old.endTime, started),
        starred: old.isStarred === true,
        counts,
      });
      await fs.promises.rm(file, { force: true });
      report.migrated++;
    } catch {
      // Unreadable file: keep what may be data, but never leave a key in it.
      await scrubKey(file);
      report.failed++;
    }
  }
  return report;
}

/** Blanks every `"apiKey": "…"` in a file that could not be converted. */
export async function scrubKey(file: string): Promise<void> {
  try {
    const raw = await fs.promises.readFile(file, 'utf8');
    const scrubbed = raw.replace(/("apiKey"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1""');
    if (scrubbed !== raw) await fs.promises.writeFile(file, scrubbed, 'utf8');
  } catch {
    // Nothing readable to scrub.
  }
}
