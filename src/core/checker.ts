/**
 * One run over a session's pending numbers. It owns the whole lifecycle, so
 * there is exactly one place that decides what a session's status is:
 *
 *   - numbers are asked one at a time, in list order;
 *   - each answer is appended to disk before the window hears about it;
 *   - Stop aborts the request in flight and nothing is asked after it;
 *   - a key problem, an exhausted quota or an API that stops answering ends the
 *     run with a reason, and everything still unanswered stays pending;
 *   - continuing a session asks only what has no final answer yet.
 */
import { EventEmitter } from 'events';
import { applyResult, countResults } from '../shared/outcomes';
import { CheckResult, Counts, Progress, Quota, RunEnd, SessionStatus } from '../shared/types';
import { ApiClient, isAbort } from './apiClient';
import { ApiError } from './classify';
import { SessionStore } from './sessionStore';

/** This many failures in a row mean the problem is the connection, not the numbers. */
export const MAX_CONSECUTIVE_FAILURES = 8;
const CHECKPOINT_EVERY = 20;
const CHECKPOINT_MS = 3000;
const RATE_WINDOW = 20;

export interface CheckRunOptions {
  store: SessionStore;
  client: ApiClient;
  sessionId: string;
  now?: () => number;
}

interface CheckRunEvents {
  progress: [Progress];
  end: [RunEnd];
}

export class CheckRun extends EventEmitter<CheckRunEvents> {
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private counts: Counts | null = null;
  private quota: Quota = { remaining: null, limit: null };
  private readonly stamps: number[] = [];
  private finished = false;

  constructor(private readonly options: CheckRunOptions) {
    super();
    this.now = options.now ?? Date.now;
  }

  get sessionId(): string {
    return this.options.sessionId;
  }

  get running(): boolean {
    return !this.finished;
  }

  /** Stops after the request in flight is abandoned. Safe to call more than once. */
  stop(): void {
    this.controller.abort();
  }

  /** Announces a pause (rate limit, retry) so the window can say why nothing moves. */
  noteWaiting(reason: string): void {
    if (this.finished || !this.counts) return;
    this.emit('progress', this.snapshot(undefined, reason));
  }

  private rate(): number {
    if (this.stamps.length < 2) return 0;
    const span = this.stamps[this.stamps.length - 1] - this.stamps[0];
    return span > 0 ? ((this.stamps.length - 1) * 1000) / span : 0;
  }

  private snapshot(result?: CheckResult, waiting?: string): Progress {
    const counts = this.counts!;
    const rate = this.rate();
    return {
      sessionId: this.sessionId,
      counts,
      result,
      quota: this.quota,
      rate,
      etaMs: rate > 0 ? Math.round((counts.pending / rate) * 1000) : null,
      waiting,
    };
  }

  async run(): Promise<RunEnd> {
    const { store, client, sessionId } = this.options;
    const signal = this.controller.signal;
    let status: SessionStatus = 'stopped';
    let stopReason: string | undefined;

    try {
      const meta = await store.readMeta(sessionId);
      if (!meta) throw new Error('Session not found');

      const numbers = await store.readNumbers(sessionId);
      const latest = await store.readResults(sessionId);
      this.counts = countResults(
        numbers.map((n) => latest.get(n.e164)).filter((r): r is CheckResult => Boolean(r)),
        numbers.length
      );
      const todo = numbers.filter((n) => {
        const r = latest.get(n.e164);
        return !r || r.outcome === 'failed';
      });

      const startedAt = new Date(this.now()).toISOString();
      await store.updateMeta(sessionId, {
        status: 'running',
        startedAt: meta.startedAt ?? startedAt,
        finishedAt: undefined,
        stopReason: undefined,
        channel: client.channel,
        counts: this.counts,
      });
      this.emit('progress', this.snapshot());

      let consecutiveFailures = 0;
      let sinceCheckpoint = 0;
      let lastCheckpoint = this.now();

      for (const entry of todo) {
        if (signal.aborted) break;

        let result: CheckResult;
        try {
          const answer = await client.lookup(entry.e164, signal);
          result = answer.result;
          if (answer.quota.remaining !== null || answer.quota.limit !== null) this.quota = answer.quota;
          consecutiveFailures = 0;
        } catch (err) {
          if (isAbort(err)) break;
          if (!(err instanceof ApiError)) throw err;
          if (err.fatal) {
            stopReason = err.message;
            break;
          }
          result = {
            number: entry.e164,
            outcome: 'failed',
            checkedAt: new Date(this.now()).toISOString(),
            note: err.message,
          };
          // A refused range says something about the number, not about the connection.
          if (err.code !== 'RANGE_REFUSED') consecutiveFailures++;
        }

        await store.appendResult(sessionId, result);
        this.counts = applyResult(this.counts, result, latest.get(entry.e164));
        latest.set(entry.e164, result);
        this.stamps.push(this.now());
        if (this.stamps.length > RATE_WINDOW) this.stamps.shift();
        this.emit('progress', this.snapshot(result));

        sinceCheckpoint++;
        if (sinceCheckpoint >= CHECKPOINT_EVERY || this.now() - lastCheckpoint >= CHECKPOINT_MS) {
          await store.updateMeta(sessionId, { counts: this.counts });
          sinceCheckpoint = 0;
          lastCheckpoint = this.now();
        }

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopReason = `The API stopped answering (${MAX_CONSECUTIVE_FAILURES} failures in a row). Check your connection and continue; the failed numbers will be asked again.`;
          break;
        }
      }

      if (this.counts.pending === 0) {
        status = 'completed';
        stopReason = undefined;
      } else if (!stopReason) {
        stopReason = signal.aborted
          ? undefined
          : `${this.counts.failed.toLocaleString('en-US')} ${
              this.counts.failed === 1 ? 'number' : 'numbers'
            } failed. Continue to ask ${this.counts.failed === 1 ? 'it' : 'them'} again.`;
      }
    } catch (err) {
      stopReason = `The check stopped: ${err instanceof Error ? err.message : String(err)}`;
    }

    this.finished = true;
    const counts = this.counts ?? countResults([], 0);
    const finishedAt = new Date(this.now()).toISOString();
    try {
      await store.updateMeta(sessionId, {
        status,
        stopReason,
        counts,
        finishedAt: status === 'completed' ? finishedAt : undefined,
      });
    } catch {
      // The session folder vanished (deleted while running): nothing left to record.
    }
    const end: RunEnd = { sessionId, status, stopReason, counts };
    this.emit('end', end);
    return end;
  }
}
