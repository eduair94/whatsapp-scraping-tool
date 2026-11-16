import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckResult, ListNumber, Progress } from '../shared/types';
import { abortError, ApiClient, LookupAnswer } from './apiClient';
import { ApiError } from './classify';
import { CheckRun, MAX_CONSECUTIVE_FAILURES } from './checker';
import { SessionStore } from './sessionStore';

let root: string;
let store: SessionStore;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-run-'));
  store = new SessionStore(root);
});
afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

const list = (n: number): ListNumber[] =>
  Array.from({ length: n }, (_, i) => ({ e164: `+1212555${String(100 + i).padStart(4, '0')}`, input: `n${i}` }));

type Step = CheckResult['outcome'] | ApiError | 'hang';

/** A client whose answers come from `plan(number, callIndex)`; records every lookup. */
function fakeClient(plan: (number: string, index: number) => Step) {
  const asked: string[] = [];
  const client = {
    channel: 'direct',
    baseUrl: 'test',
    async lookup(number: string, signal?: AbortSignal): Promise<LookupAnswer> {
      if (signal?.aborted) throw abortError();
      const index = asked.push(number) - 1;
      const step = plan(number, index);
      if (step === 'hang') {
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(abortError())));
      }
      if (step instanceof ApiError) throw step;
      return {
        result: { number, outcome: step, checkedAt: new Date(1_700_000_000_000 + index).toISOString(), ...(step === 'on_whatsapp' ? { name: `Name ${index}` } : {}) },
        quota: { remaining: 1000 - index, limit: 1000 },
        attempts: 1,
      };
    },
    async keyInfo() {
      return null;
    },
  } as unknown as ApiClient;
  return { client, asked };
}

async function session(numbers: ListNumber[]) {
  return store.create({ name: 'Test list', source: 'paste', numbers });
}

describe('CheckRun', () => {
  it('asks every number once, in order, and completes', async () => {
    const meta = await session(list(5));
    const { client, asked } = fakeClient((_n, i) => (i % 2 ? 'not_on_whatsapp' : 'on_whatsapp'));
    const run = new CheckRun({ store, client, sessionId: meta.id });
    const updates: Progress[] = [];
    run.on('progress', (p) => updates.push(p));
    const end = await run.run();

    expect(asked).toEqual(list(5).map((n) => n.e164));
    expect(end.status).toBe('completed');
    expect(end.counts).toMatchObject({ on_whatsapp: 3, not_on_whatsapp: 2, checked: 5, pending: 0, total: 5 });
    expect(updates.filter((u) => u.result)).toHaveLength(5);
    expect(updates.at(-1)!.quota).toEqual({ remaining: 996, limit: 1000 });

    const saved = await store.load(meta.id);
    expect(saved!.meta.status).toBe('completed');
    expect(saved!.meta.finishedAt).toBeTruthy();
    expect(saved!.meta.channel).toBe('direct');
    expect(saved!.results.map((r) => r.number)).toEqual(asked);
  });

  it('has each answer on disk before the window is told about it', async () => {
    const meta = await session(list(3));
    const { client } = fakeClient(() => 'on_whatsapp');
    const run = new CheckRun({ store, client, sessionId: meta.id });
    const onDiskWhenTold: number[] = [];
    run.on('progress', (p) => {
      if (!p.result) return;
      const lines = fs.readFileSync(path.join(root, meta.id, 'results.jsonl'), 'utf8').split('\n').filter(Boolean);
      onDiskWhenTold.push(lines.length);
      expect(lines.at(-1)).toContain(p.result.number);
    });
    await run.run();
    expect(onDiskWhenTold).toEqual([1, 2, 3]);
  });

  it('Stop aborts the request in flight and asks nothing after it', async () => {
    const meta = await session(list(50));
    const { client, asked } = fakeClient((_n, i) => (i === 3 ? 'hang' : 'on_whatsapp'));
    const run = new CheckRun({ store, client, sessionId: meta.id });
    run.on('progress', (p) => {
      if (p.counts.checked === 3) setTimeout(() => run.stop(), 5);
    });
    const end = await run.run();

    expect(asked).toHaveLength(4); // three answered, the fourth abandoned, none after
    expect(end.status).toBe('stopped');
    expect(end.stopReason).toBeUndefined();
    expect(end.counts).toMatchObject({ checked: 3, pending: 47 });
    expect((await store.pending(meta.id))).toHaveLength(47);
    expect(run.running).toBe(false);
  });

  it('continuing asks only what has no final answer, and keeps the earlier answers', async () => {
    const meta = await session(list(6));
    const first = fakeClient((_n, i) => (i === 1 ? new ApiError('SERVER', 'The API had a problem (503).') : i >= 4 ? 'hang' : 'on_whatsapp'));
    const run1 = new CheckRun({ store, client: first.client, sessionId: meta.id });
    run1.on('progress', (p) => {
      if (p.counts.checked === 4) setTimeout(() => run1.stop(), 5);
    });
    await run1.run();
    // Answered: 0, 2, 3 (final) and 1 (failed). 4 and 5 never answered.
    expect((await store.load(meta.id))!.meta.counts).toMatchObject({ on_whatsapp: 3, failed: 1, checked: 4, pending: 3 });

    const second = fakeClient(() => 'not_on_whatsapp');
    const end = await new CheckRun({ store, client: second.client, sessionId: meta.id }).run();
    const all = list(6).map((n) => n.e164);
    expect(second.asked).toEqual([all[1], all[4], all[5]]); // the failed one and the two never asked
    expect(end.status).toBe('completed');
    expect(end.counts).toMatchObject({ on_whatsapp: 3, not_on_whatsapp: 3, failed: 0, checked: 6, pending: 0 });

    const saved = await store.load(meta.id);
    expect(saved!.results.map((r) => r.outcome)).toEqual([
      'on_whatsapp', 'not_on_whatsapp', 'on_whatsapp', 'on_whatsapp', 'not_on_whatsapp', 'not_on_whatsapp',
    ]);
    expect(saved!.results[0].name).toBe('Name 0'); // an answer from the first run, untouched
  });

  it('a rejected key ends the run with the reason and leaves the rest pending', async () => {
    const meta = await session(list(10));
    const { client, asked } = fakeClient((_n, i) => (i === 2 ? new ApiError('UNAUTHORIZED', 'The API rejected this key.', { status: 401 }) : 'on_whatsapp'));
    const end = await new CheckRun({ store, client, sessionId: meta.id }).run();
    expect(asked).toHaveLength(3);
    expect(end.status).toBe('stopped');
    expect(end.stopReason).toBe('The API rejected this key.');
    expect(end.counts).toMatchObject({ checked: 2, failed: 0, pending: 8 });
  });

  it('an exhausted quota stops the run instead of marking the rest failed', async () => {
    const meta = await session(list(10));
    const { client, asked } = fakeClient((_n, i) => (i === 5 ? new ApiError('QUOTA_EXCEEDED', 'The key has no requests left.', { status: 429 }) : 'not_on_whatsapp'));
    const end = await new CheckRun({ store, client, sessionId: meta.id }).run();
    expect(asked).toHaveLength(6);
    expect(end.stopReason).toBe('The key has no requests left.');
    expect(end.counts).toMatchObject({ not_on_whatsapp: 5, failed: 0, pending: 5 });
  });

  it('a failed lookup is recorded and the run goes on', async () => {
    const meta = await session(list(4));
    const { client } = fakeClient((_n, i) => (i === 1 ? new ApiError('TIMEOUT', 'No answer within 30 seconds.') : 'on_whatsapp'));
    const end = await new CheckRun({ store, client, sessionId: meta.id }).run();
    expect(end.status).toBe('stopped');
    expect(end.stopReason).toBe('1 number failed. Continue to ask it again.');
    expect(end.counts).toMatchObject({ on_whatsapp: 3, failed: 1, checked: 4, pending: 1 });
    const saved = await store.load(meta.id);
    expect(saved!.results[1]).toMatchObject({ outcome: 'failed', note: 'No answer within 30 seconds.' });
  });

  it(`stops after ${MAX_CONSECUTIVE_FAILURES} failures in a row rather than burning through the list`, async () => {
    const meta = await session(list(100));
    const { client, asked } = fakeClient((_n, i) => (i < 2 ? 'on_whatsapp' : new ApiError('NETWORK', 'Could not reach the API.')));
    const end = await new CheckRun({ store, client, sessionId: meta.id }).run();
    expect(asked).toHaveLength(2 + MAX_CONSECUTIVE_FAILURES);
    expect(end.status).toBe('stopped');
    expect(end.stopReason).toMatch(/stopped answering/);
    expect(end.counts.pending).toBe(98);
  });

  it('a refused range fails that number without counting towards the connection guard', async () => {
    const meta = await session(list(12));
    const { client, asked } = fakeClient((_n, i) => (i < 10 ? new ApiError('RANGE_REFUSED', 'The API refuses more numbers from this range today.', { status: 403 }) : 'on_whatsapp'));
    const end = await new CheckRun({ store, client, sessionId: meta.id }).run();
    expect(asked).toHaveLength(12);
    expect(end.counts).toMatchObject({ failed: 10, on_whatsapp: 2 });
  });

  it('reports speed and time left, and announces a pause', async () => {
    const meta = await session(list(6));
    let clock = 0;
    const { client } = fakeClient(() => 'on_whatsapp');
    const run = new CheckRun({ store, client, sessionId: meta.id, now: () => (clock += 500) });
    const updates: Progress[] = [];
    run.on('progress', (p) => {
      updates.push(p);
      if (p.counts.checked === 3 && p.result) run.noteWaiting('The API asked to slow down');
    });
    await run.run();
    const third = updates.find((u) => u.counts.checked === 3 && u.result)!;
    expect(third.rate).toBeGreaterThan(0);
    expect(third.etaMs).toBeGreaterThan(0);
    expect(updates.some((u) => u.waiting === 'The API asked to slow down')).toBe(true);
    expect(updates.at(-1)!.etaMs).toBe(0);
  });

  it('ends cleanly when the session does not exist or is deleted mid-run', async () => {
    const { client } = fakeClient(() => 'on_whatsapp');
    const missing = await new CheckRun({ store, client, sessionId: 's_missing' }).run();
    expect(missing.status).toBe('stopped');
    expect(missing.stopReason).toMatch(/Session not found/);

    // The folder is deleted after the second answer, and the third lookup waits
    // until it is gone, so the deletion never races the run's own writes.
    const meta = await session(list(5));
    let removed: Promise<boolean> | null = null;
    const { client: gated } = fakeClient(() => 'on_whatsapp');
    const lookup = gated.lookup.bind(gated);
    gated.lookup = async (number, signal) => {
      if (removed) await removed;
      return lookup(number, signal);
    };
    const run = new CheckRun({ store, client: gated, sessionId: meta.id });
    run.on('progress', (p) => {
      if (p.counts.checked === 2 && !removed) removed = store.remove(meta.id);
    });
    const end = await run.run();
    expect(await removed).toBe(true);
    expect(end.status).toBe('stopped');
    expect(end.stopReason).toMatch(/The check stopped/);
  });
});
