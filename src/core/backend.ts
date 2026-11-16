/**
 * Everything the window can ask for, in one object with no Electron in it, so
 * the whole behaviour of the app (load a list, check it, stop, continue,
 * export) is tested without opening a window. `main.ts` only adds the native
 * parts: dialogs, the menu, the window itself.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CHANNELS, channelMismatch } from '../shared/channels';
import {
  ExportFormat,
  ExportScope,
  KeyCheck,
  ListNumber,
  ParsedList,
  Progress,
  PublicSettings,
  RunEnd,
  Session,
  SessionMeta,
  SessionSource,
  SettingsPatch,
} from '../shared/types';
import { createApiClient, FetchLike, isAbort } from './apiClient';
import { CheckRun } from './checker';
import { ApiError } from './classify';
import { MAX_SAMPLE_NUMBERS, sampleNumbers } from './demo';
import { exportFileName, writeExport } from './exporter';
import { candidatesFromRows, candidatesFromText, readListFile, Rows } from './inputFiles';
import { migrateLegacySessions, MigrationReport } from './legacy';
import { parseNumbers } from './phone';
import { SessionStore } from './sessionStore';
import { KeyCodec, SettingsStore } from './settingsStore';

/** A number nobody owns (reserved for fiction), used to verify a RapidAPI key. */
const PROBE_NUMBER = '+12025550100';

export interface BackendOptions {
  /** Folder for settings and sessions. */
  dataDir: string;
  codec: KeyCodec;
  /** Region guessed from the system for numbers without a country code. */
  systemCountry?: string;
  /** Replaces the network. Demo mode passes its simulated API here. */
  fetch?: FetchLike;
  /** Demo mode: sample numbers are allowed and a key is already in place. */
  demo?: boolean;
  /** Overrides the pause between requests (demo mode runs faster than the real API allows). */
  gapMs?: number;
  /** Old session folders to convert on first start. */
  legacySessionDirs?: string[];
  onProgress?: (progress: Progress) => void;
  onEnd?: (end: RunEnd) => void;
}

/** Cells kept per file so its phone columns can be found again under another country. */
const MAX_KEPT_CELLS = 2_000_000;

/** One file or one paste of the list being prepared. */
interface DraftPart {
  /** Raw phone-like strings, kept so the list can be re-read against another country. */
  candidates: string[];
  /**
   * A file's rows. Which columns hold phone numbers depends on the default
   * country, so they are looked for again when it changes. Very large files
   * keep only the candidates found when they were opened.
   */
  rows?: Rows;
  /** The country `candidates` were read with, when `rows` is kept. */
  country?: string;
}

interface Draft {
  label: string;
  source: SessionSource;
  parts: DraftPart[];
  /** Sample numbers are already final and are never re-read. */
  fixed?: ParsedList;
}

export class Backend {
  readonly settings: SettingsStore;
  readonly store: SessionStore;
  readonly demo: boolean;
  private run: CheckRun | null = null;
  /** True from the first line of `startRun` until its run exists, so two clicks start one run. */
  private starting = false;
  private runDone: Promise<RunEnd> | null = null;
  private draft: Draft | null = null;

  constructor(private readonly options: BackendOptions) {
    this.demo = options.demo === true;
    this.settings = new SettingsStore(
      path.join(options.dataDir, 'settings.json'),
      // The demo never writes a key anywhere.
      this.demo ? { available: () => false, encrypt: (s) => s, decrypt: (s) => s } : options.codec,
      options.systemCountry
    );
    this.store = new SessionStore(path.join(options.dataDir, 'lists'));
  }

  async init(): Promise<MigrationReport> {
    await fs.promises.mkdir(this.store.root, { recursive: true });
    await this.settings.load();
    if (this.demo && !this.settings.getKey()) await this.settings.patch({ apiKey: 'demo-key' });
    const report: MigrationReport = { migrated: 0, dropped: 0, failed: 0 };
    for (const dir of this.options.legacySessionDirs ?? []) {
      const r = await migrateLegacySessions(dir, this.store);
      report.migrated += r.migrated;
      report.dropped += r.dropped;
      report.failed += r.failed;
    }
    await this.store.recoverInterrupted();
    return report;
  }

  // ── Settings and key ────────────────────────────────────────────────────

  getSettings(): PublicSettings {
    return this.settings.getPublic();
  }

  async updateSettings(patch: SettingsPatch): Promise<PublicSettings> {
    return this.settings.patch(patch);
  }

  private client(onWait?: (reason: string) => void) {
    const s = this.settings.getPublic();
    return createApiClient({
      apiKey: this.settings.getKey(),
      channel: this.settings.channel(),
      fetch: this.options.fetch,
      gapMs: this.options.gapMs ?? s.gapMs,
      timeoutMs: s.timeoutMs,
      maxRetries: s.maxRetries,
      onWait: onWait ? (reason) => onWait(reason) : undefined,
    });
  }

  /**
   * Says whether the stored key works. Free for a direct key. RapidAPI has no
   * free call, so there it spends one request on a number that belongs to no one.
   */
  async checkKey(): Promise<KeyCheck> {
    const channel = this.settings.channel();
    const label = CHANNELS[channel].label;
    const none = { remaining: null, limit: null };
    const key = this.settings.getKey();
    if (!key) return { ok: false, channel, message: 'Paste a key first.', quota: none };
    const mismatch = channelMismatch(channel, key);
    if (mismatch) return { ok: false, channel, message: mismatch, quota: none };

    try {
      const client = this.client();
      const info = await client.keyInfo();
      if (info) {
        const plan = info.plan ? `${info.plan[0].toUpperCase()}${info.plan.slice(1)} key` : 'Key';
        const left =
          info.quota.remaining !== null
            ? `${info.quota.remaining.toLocaleString('en-US')} requests left`
            : 'quota not reported';
        const until = info.expiresAt ? `, valid until ${info.expiresAt.slice(0, 10)}` : '';
        return { ok: true, channel, message: `${plan} accepted: ${left}${until}.`, quota: info.quota };
      }
      const answer = await client.lookup(PROBE_NUMBER);
      const left =
        answer.quota.remaining !== null
          ? ` ${answer.quota.remaining.toLocaleString('en-US')} requests left.`
          : '';
      return { ok: true, channel, message: `Key accepted on ${label}.${left}`, quota: answer.quota };
    } catch (err) {
      if (err instanceof ApiError) {
        // "Slow down" and "not this range" are answers the API only gives a key it accepted.
        if (err.code === 'RATE_LIMITED' || err.code === 'RANGE_REFUSED') {
          return { ok: true, channel, message: `Key accepted on ${label}.`, quota: none };
        }
        return { ok: false, channel, message: err.message, quota: none };
      }
      return { ok: false, channel, message: err instanceof Error ? err.message : String(err), quota: none };
    }
  }

  // ── The list being prepared ─────────────────────────────────────────────

  private parseDraft(): ParsedList | null {
    if (!this.draft) return null;
    if (this.draft.fixed) return this.draft.fixed;
    const country = this.settings.getPublic().defaultCountry;
    const candidates: string[] = [];
    for (const part of this.draft.parts) {
      if (part.rows && part.country !== country) {
        part.candidates = candidatesFromRows(part.rows, country);
        part.country = country;
      }
      for (const candidate of part.candidates) candidates.push(candidate);
    }
    const { entries, duplicates } = parseNumbers(candidates, country);
    return {
      entries,
      label: this.draft.label,
      source: this.draft.source,
      found: candidates.length,
      duplicates,
    };
  }

  private setDraft(label: string, source: SessionSource, part: DraftPart, append: boolean): ParsedList {
    if (append && this.draft && !this.draft.fixed) {
      this.draft = { ...this.draft, parts: [...this.draft.parts, part] };
    } else {
      this.draft = { label, source, parts: [part] };
    }
    return this.parseDraft()!;
  }

  async listFromFile(filePath: string, append = false): Promise<ParsedList> {
    const { label, rows } = await readListFile(filePath);
    const country = this.settings.getPublic().defaultCountry;
    const candidates = candidatesFromRows(rows, country);
    if (candidates.length === 0) throw new Error('No phone numbers were found in this file.');
    const cells = rows.reduce((sum, row) => sum + row.length, 0);
    const part: DraftPart = cells <= MAX_KEPT_CELLS ? { candidates, rows, country } : { candidates };
    return this.setDraft(label, 'file', part, append);
  }

  listFromText(text: string, append = false): ParsedList {
    const candidates = candidatesFromText(String(text ?? '').slice(0, 5_000_000));
    if (candidates.length === 0) throw new Error('No phone numbers were found in what you pasted.');
    return this.setDraft('Pasted numbers', 'paste', { candidates }, append);
  }

  /** Sample numbers exist only in demo mode: real checks need the person's own list. */
  listFromSample(count: number): ParsedList {
    if (!this.demo) throw new Error('Sample numbers are only available in demo mode.');
    const n = Math.max(1, Math.min(MAX_SAMPLE_NUMBERS, Math.floor(Number(count) || 0)));
    const entries = sampleNumbers(n);
    this.draft = {
      label: `${n.toLocaleString('en-US')} sample numbers`,
      source: 'sample',
      parts: [],
      fixed: { entries, label: `${n.toLocaleString('en-US')} sample numbers`, source: 'sample', found: n, duplicates: 0 },
    };
    return this.draft.fixed!;
  }

  /** The current list read again, after the default country changed. */
  currentList(): ParsedList | null {
    return this.parseDraft();
  }

  clearList(): void {
    this.draft = null;
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  /** Turns the prepared list into a session. Invalid entries are left out. */
  async createSession(name?: string): Promise<SessionMeta> {
    const parsed = this.parseDraft();
    if (!parsed) throw new Error('Add some numbers first.');
    const numbers: ListNumber[] = parsed.entries
      .filter((e) => e.valid && e.e164)
      .map((e) => ({
        e164: e.e164!,
        input: e.input,
        ...(e.country ? { country: e.country } : {}),
        ...(e.formatted ? { formatted: e.formatted } : {}),
        ...(e.lineType ? { lineType: e.lineType } : {}),
      }));
    if (numbers.length === 0) throw new Error('None of these numbers is valid, so there is nothing to check.');
    const meta = await this.store.create({ name: (name ?? parsed.label).trim() || parsed.label, source: parsed.source, numbers });
    this.draft = null;
    return meta;
  }

  listSessions(): Promise<SessionMeta[]> {
    return this.store.list();
  }

  getSession(id: string): Promise<Session | null> {
    return this.store.load(id);
  }

  async updateSession(id: string, patch: { starred?: boolean; name?: string }): Promise<SessionMeta> {
    const clean: Partial<SessionMeta> = {};
    if (typeof patch.starred === 'boolean') clean.starred = patch.starred;
    if (typeof patch.name === 'string' && patch.name.trim()) clean.name = patch.name.trim().slice(0, 120);
    // A star is not activity: keep the session where it is in the list.
    const current = await this.store.readMeta(id);
    return this.store.updateMeta(id, { ...clean, updatedAt: current?.updatedAt });
  }

  async removeSession(id: string): Promise<boolean> {
    if (this.run?.sessionId === id) await this.stopRun();
    return this.store.remove(id);
  }

  async clearSessions(): Promise<number> {
    await this.stopRun();
    return this.store.clear();
  }

  // ── Running a check ─────────────────────────────────────────────────────

  get runningSessionId(): string | null {
    return this.run?.running ? this.run.sessionId : null;
  }

  /** Starts or continues a session. Only one check runs at a time. */
  async startRun(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    // Reading the list takes a moment; a second click in that moment must not start a second run.
    if (this.run?.running || this.starting) {
      return { ok: false, error: 'Another check is running. Stop it first.' };
    }
    this.starting = true;
    try {
      return await this.begin(sessionId);
    } finally {
      this.starting = false;
    }
  }

  private async begin(sessionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const meta = await this.store.readMeta(sessionId);
    if (!meta) return { ok: false, error: 'This list no longer exists.' };
    const key = this.settings.getKey();
    if (!key) return { ok: false, error: 'Add your API key in Settings first.' };
    const mismatch = channelMismatch(this.settings.channel(), key);
    if (mismatch) return { ok: false, error: mismatch };
    if ((await this.store.pending(sessionId)).length === 0) {
      return { ok: false, error: 'Every number in this list already has an answer.' };
    }

    let run: CheckRun | null = null;
    const client = this.client((reason) => run?.noteWaiting(reason));
    run = new CheckRun({ store: this.store, client, sessionId });
    run.on('progress', (p) => this.options.onProgress?.(p));
    run.on('end', (e) => this.options.onEnd?.(e));
    this.run = run;
    this.runDone = run.run().catch((err) => {
      // run() reports its own failures; this is the last line of defence.
      const end: RunEnd = {
        sessionId,
        status: 'stopped',
        stopReason: isAbort(err) ? undefined : `The check stopped: ${err instanceof Error ? err.message : String(err)}`,
        counts: meta.counts,
      };
      this.options.onEnd?.(end);
      return end;
    });
    return { ok: true };
  }

  /** Stops the running check and resolves once its progress is saved. */
  async stopRun(): Promise<void> {
    if (!this.run || !this.runDone) return;
    this.run.stop();
    await this.runDone;
  }

  // ── Export ──────────────────────────────────────────────────────────────

  async suggestedExportName(id: string, format: ExportFormat): Promise<string> {
    const session = await this.store.load(id);
    if (!session) throw new Error('This list no longer exists.');
    return exportFileName(session, format);
  }

  async exportSession(id: string, format: ExportFormat, scope: ExportScope, filePath: string): Promise<{ rows: number }> {
    if (!['csv', 'xlsx', 'json'].includes(format)) throw new Error('Unknown export format.');
    const session = await this.store.load(id);
    if (!session) throw new Error('This list no longer exists.');
    return writeExport(session, format, scope, filePath);
  }

  /** Called before the app quits or switches mode: nothing may be left half-written. */
  async shutdown(): Promise<void> {
    await this.stopRun();
  }
}
