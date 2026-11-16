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

export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.promises.writeFile(tmp, data, 'utf8');
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true });
    throw err;
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export interface NewSession {
  name: string;
  source: SessionSource;
  numbers: ListNumber[];
}

export class SessionStore {
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

  /** Merges `patch` into the stored meta. Answers are never touched by this. */
  async updateMeta(id: string, patch: Partial<SessionMeta>): Promise<SessionMeta> {
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
    await fs.promises.appendFile(this.resultsFile(id), `${JSON.stringify(result)}\n`, 'utf8');
  }

  async readNumbers(id: string): Promise<ListNumber[]> {
    return (await readJson<ListNumber[]>(this.numbersFile(id))) ?? [];
  }

  /** The latest answer per number. A torn last line (crash mid-write) is skipped. */
  async readResults(id: string): Promise<Map<string, CheckResult>> {
    const latest = new Map<string, CheckResult>();
    let raw: string;
    try {
      raw = await fs.promises.readFile(this.resultsFile(id), 'utf8');
    } catch {
      return latest;
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
      const meta = await this.readMeta(name);
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
    await fs.promises.rm(dir, { recursive: true, force: true });
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
   */
  async recoverInterrupted(): Promise<number> {
    let recovered = 0;
    for (const meta of await this.list()) {
      if (meta.status !== 'running') continue;
      const session = await this.load(meta.id);
      await this.updateMeta(meta.id, {
        status: 'stopped',
        stopReason: 'The app closed while this check was running. Nothing was lost.',
        counts: session?.meta.counts ?? meta.counts,
      });
      recovered++;
    }
    return recovered;
  }
}
