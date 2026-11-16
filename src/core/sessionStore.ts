/**
 * Sessions on disk. A session is one list plus its answers:
 *
 *   <root>/<id>/meta.json       name, status, totals (small, rewritten atomically)
 *   <root>/<id>/numbers.json    the list, written once
 *   <root>/<id>/results.jsonl   one answer per line, appended as it arrives
 *
 * Appending means an answer is on disk the moment it exists and a crash can
 * lose at most the line being written. Nothing here ever stores the API key or
 * any other setting: the old format copied the key, in plain text, into every
 * session file.
 */
import * as fs from 'fs';
import * as path from 'path';
import { countResults, emptyCounts, isFinal } from '../shared/outcomes';
import {
  CheckResult,
  ListNumber,
  Session,
  SessionMeta,
  SessionSource,
} from '../shared/types';

const VALID_ID = /^[A-Za-z0-9_-]{1,80}$/;
const RENAME_RETRIES = 6;

/** Ids arrive over IPC and become folder names, so anything else is refused. */
export function assertSessionId(id: unknown): string {
  if (typeof id !== 'string' || !VALID_ID.test(id)) throw new Error('Invalid session id');
  return id;
}

export function newSessionId(now = Date.now(), random = Math.random): string {
  return `s_${now.toString(36)}_${Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0')}`;
}

/** Windows refuses a rename while antivirus or a spreadsheet holds the target. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.promises.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_RETRIES || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
}

/** Two writes in the same millisecond must not share a temporary file. */
let tempFiles = 0;

export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}${(tempFiles++).toString(36)}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data);
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException)?.code === 'ENOENT';

/** A read failure in words a person can act on, with the system's code for a bug report. */
function unreadable(what: string, err: unknown): Error {
  const code = (err as NodeJS.ErrnoException)?.code;
  return new Error(
    `The ${what} of this list could not be read${code ? ` (${code})` : ''}. Close any program that has the file open, then try again.`
  );
}

/**
 * A file that is not there, or does not hold JSON, reads as `null`. A file
 * that is there but could not be read (locked, too many open files) is an
 * error: treating it as empty would ask a whole list again.
 */
async function readJson<T>(file: string): Promise<T | null> {
  let raw: string;
  try {
    raw = await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Whether a file ends in the middle of a line, as a crash during a write leaves it. */
async function endsMidLine(file: string): Promise<boolean> {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(file, 'r');
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    await handle.read(last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    await handle.close();
  }
}

export interface NewSession {
  name: string;
  source: SessionSource;
  numbers: ListNumber[];
}

export class SessionStore {
  /** Meta updates wait for the one before them: each reads the file, changes it and writes it back. */
  private readonly metaWrites = new Map<string, Promise<unknown>>();
  /** Sessions whose answers file is known to end on a line break. */
  private readonly cleanTail = new Set<string>();

  constructor(readonly root: string) {}

  private dir(id: string): string {
    return path.join(this.root, assertSessionId(id));
  }

  private metaFile(id: string): string {
    return path.join(this.dir(id), 'meta.json');
  }

  private numbersFile(id: string): string {
    return path.join(this.dir(id), 'numbers.json');
  }

  private resultsFile(id: string): string {
    return path.join(this.dir(id), 'results.jsonl');
  }

  async create(input: NewSession, now = new Date()): Promise<SessionMeta> {
    const id = newSessionId(now.getTime());
    await fs.promises.mkdir(this.dir(id), { recursive: true });
    const stamp = now.toISOString();
    const meta: SessionMeta = {
      id,
      name: input.name.trim().slice(0, 120) || 'Untitled list',
      source: input.source,
      createdAt: stamp,
      updatedAt: stamp,
      status: 'ready',
      counts: emptyCounts(input.numbers.length),
      starred: false,
    };
    await writeFileAtomic(this.numbersFile(id), JSON.stringify(input.numbers));
    await writeFileAtomic(this.metaFile(id), JSON.stringify(meta, null, 2));
    return meta;
  }

  async readMeta(id: string): Promise<SessionMeta | null> {
    const meta = await readJson<SessionMeta>(this.metaFile(id));
    return meta && meta.id === id ? meta : null;
  }

  /**
   * Merges `patch` into the stored meta. Answers are never touched by this.
   * A star clicked while a run saves its totals must not undo either change,
   * so updates of one session run one after the other.
   */
  updateMeta(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta> {
    const before = this.metaWrites.get(id) ?? Promise.resolve();
    const mine = before.catch(() => undefined).then(() => this.mergeMeta(id, patch));
    this.metaWrites.set(id, mine);
    const forget = (): void => {
      if (this.metaWrites.get(id) === mine) this.metaWrites.delete(id);
    };
    mine.then(forget, forget);
    return mine;
  }

  private async mergeMeta(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta> {
    const current = await this.readMeta(id);
    if (!current) throw new Error('Session not found');
    const next: SessionMeta = {
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    };
    await writeFileAtomic(this.metaFile(id), JSON.stringify(next, null, 2));
    return next;
  }

  async appendResult(id: string, result: CheckResult): Promise<void> {
    const file = this.resultsFile(id);
    // After a crash the file can end in half a line. The next answer starts on
    // a line of its own, or it would be glued to that half and lost with it.
    const lead = this.cleanTail.has(id) || !(await endsMidLine(file)) ? '' : '\n';
    this.cleanTail.delete(id);
    await fs.promises.appendFile(file, `${lead}${JSON.stringify(result)}\n`, 'utf8');
    this.cleanTail.add(id);
  }

  async readNumbers(id: string): Promise<ListNumber[]> {
    try {
      return (await readJson<ListNumber[]>(this.numbersFile(id))) ?? [];
    } catch (err) {
      throw unreadable('numbers', err);
    }
  }

  /** The latest answer per number. A torn last line (crash mid-write) is skipped. */
  async readResults(id: string): Promise<Map<string, CheckResult>> {
    const latest = new Map<string, CheckResult>();
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.resultsFile(id), 'utf8');
    } catch (err) {
      // No file yet means no answers yet. Any other failure must not pass for that.
      if (isMissing(err)) return latest;
      throw unreadable('answers', err);
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        const r = JSON.parse(line) as CheckResult;
        if (r && typeof r.number === 'string' && typeof r.outcome === 'string') {
          latest.set(r.number, r);
        }
      } catch {
        // Incomplete line: that answer was never confirmed, so it is asked again.
      }
    }
    return latest;
  }

  /** The whole session, with answers in list order and totals recounted from them. */
  async load(id: string): Promise<Session | null> {
    const meta = await this.readMeta(id);
    if (!meta) return null;
    const numbers = await this.readNumbers(id);
    const latest = await this.readResults(id);
    const results: CheckResult[] = [];
    for (const n of numbers) {
      const r = latest.get(n.e164);
      if (r) results.push(r);
    }
    // The answers are the truth; meta totals are a cache that a crash can leave stale.
    return { meta: { ...meta, counts: countResults(results, numbers.length) }, numbers, results };
  }

  /** Numbers that still need asking: never asked, or failed last time. */
  async pending(id: string): Promise<ListNumber[]> {
    const numbers = await this.readNumbers(id);
    const latest = await this.readResults(id);
    return numbers.filter((n) => {
      const r = latest.get(n.e164);
      return !r || !isFinal(r.outcome);
    });
  }

  /** Every session's meta, newest activity first. Unreadable folders are skipped. */
  async list(): Promise<SessionMeta[]> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.root);
    } catch {
      return [];
    }
    const metas: SessionMeta[] = [];
    for (const name of names) {
      if (!VALID_ID.test(name)) continue;
      const meta = await this.readMeta(name).catch(() => null);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async remove(id: string): Promise<boolean> {
    const dir = this.dir(id);
    try {
      await fs.promises.access(dir);
    } catch {
      return false;
    }
    // A file written or briefly locked (antivirus, an open export) makes a single
    // attempt fail with ENOTEMPTY, EBUSY or EPERM; Node retries those.
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    this.cleanTail.delete(id);
    return true;
  }

  /** Removes every session. Returns how many were removed. */
  async clear(): Promise<number> {
    const metas = await this.list();
    for (const meta of metas) await this.remove(meta.id);
    return metas.length;
  }

  /**
   * A session still marked `running` when the app starts was cut off by a
   * crash or a forced quit. Its answers are intact; only the label is wrong.
   * One that was cut off after its last answer is simply finished.
   */
  async recoverInterrupted(): Promise<number> {
    let recovered = 0;
    for (const meta of await this.list()) {
      if (meta.status !== 'running') continue;
      try {
        const session = await this.load(meta.id);
        const counts = session?.meta.counts ?? meta.counts;
        const done = Boolean(session) && counts.total > 0 && counts.pending === 0;
        await this.updateMeta(
          meta.id,
          done
            ? { status: 'completed', stopReason: undefined, counts, finishedAt: meta.finishedAt ?? meta.updatedAt }
            : { status: 'stopped', stopReason: 'The app closed while this check was running. Nothing was lost.', counts }
        );
        recovered++;
      } catch {
        // Unreadable right now: it keeps its label and is looked at again next start.
      }
    }
    return recovered;
  }
}
