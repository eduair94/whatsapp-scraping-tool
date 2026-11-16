import { describe, expect, it } from 'vitest';
import { abortError, backoffMs, createApiClient, FetchLike, isAbort, parseQuota, parseRetryAfter, redact, sleep } from './apiClient';
import { ApiError } from './classify';

const KEY = `wapi_${'ab'.repeat(32)}`;
const RAPID = '0123456789abcdefmsh0123456789abcdefp1abcdejsn0123456789ab';

interface Call {
  url: string;
  headers: Record<string, string>;
  at: number;
}

/** A fetch that answers from a script, on a clock the test controls. */
function harness(script: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error | 'hang'>) {
  let time = 1_000_000;
  const calls: Call[] = [];
  const waits: number[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {}, at: time });
    const step = script[Math.min(calls.length - 1, script.length - 1)];
    if (step instanceof Error) throw step;
    if (step === 'hang') {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(abortError()));
      });
    }
    const headers: Record<string, string> = { 'x-ratelimit-requests-remaining': '99', 'x-ratelimit-requests-limit': '100', ...step.headers };
    return {
      status: step.status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => (step.body === undefined ? '' : JSON.stringify(step.body)),
    };
  };
  const fakeSleep = async (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) throw abortError();
    waits.push(ms);
    time += ms;
  };
  return { fetch, calls, waits, now: () => time, sleep: fakeSleep, advance: (ms: number) => (time += ms) };
}

const ok = { status: 200, body: { exists: true, isWAContact: true, pushname: 'Maya' } };

describe('createApiClient', () => {
  it('sends a direct key to the proxy only, without a RapidAPI host header', async () => {
    const h = harness([ok]);
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now });
    const answer = await client.lookup('+598 99 123 456');
    expect(h.calls[0].url).toBe('https://whatsapp-proxy.checkleaked.cc/number/59899123456');
    expect(h.calls[0].headers['x-rapidapi-key']).toBe(KEY);
    expect(h.calls[0].headers['x-rapidapi-host']).toBeUndefined();
    expect(answer.result.outcome).toBe('on_whatsapp');
    expect(answer.quota).toEqual({ remaining: 99, limit: 100 });
    expect(answer.attempts).toBe(1);
  });

  it('routes the two RapidAPI channels to their own hosts and paths', async () => {
    const v = harness([ok]);
    await createApiClient({ apiKey: RAPID, channel: 'validator', fetch: v.fetch, sleep: v.sleep, now: v.now }).lookup('+12125550147');
    expect(v.calls[0].url).toBe('https://whatsapp-number-validator18.p.rapidapi.com/number/12125550147');
    expect(v.calls[0].headers['x-rapidapi-host']).toBe('whatsapp-number-validator18.p.rapidapi.com');

    const d = harness([ok]);
    await createApiClient({ apiKey: RAPID, channel: 'dbonly', fetch: d.fetch, sleep: d.sleep, now: d.now }).lookup('+12125550147');
    expect(d.calls[0].url).toBe('https://wp-data-db-only.p.rapidapi.com/number_cache/12125550147');
    expect(d.calls[0].headers['x-rapidapi-host']).toBe('wp-data-db-only.p.rapidapi.com');
  });

  it('never starts two requests closer together than the gap', async () => {
    const h = harness([ok]);
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now, gapMs: 550 });
    await client.lookup('+12125550101');
    h.advance(100); // the answer took 100 ms
    await client.lookup('+12125550102');
    await client.lookup('+12125550103');
    expect(h.calls[1].at - h.calls[0].at).toBeGreaterThanOrEqual(550);
    expect(h.calls[2].at - h.calls[1].at).toBeGreaterThanOrEqual(550);
    expect(h.waits).toEqual([450, 550]);
  });

  it('retries a transient failure and reports how many attempts it took', async () => {
    const h = harness([{ status: 503, body: { error: 'down' } }, new Error('socket hang up'), ok]);
    const waited: string[] = [];
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now, onWait: (reason) => waited.push(reason) });
    const answer = await client.lookup('+12125550101');
    expect(answer.attempts).toBe(3);
    expect(h.calls).toHaveLength(3);
    expect(waited).toEqual(['Retrying after an error', 'Retrying after an error']);
  });

  it('honours Retry-After and the "seconds apart" message on 429', async () => {
    const h = harness([
      { status: 429, body: { error: 'slow' }, headers: { 'retry-after': '7' } },
      { status: 429, body: { error: 'Requests must be at least 0.5 seconds apart' } },
      ok,
    ]);
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now, gapMs: 0 });
    await client.lookup('+12125550101');
    expect(h.waits).toEqual([7000, 550]);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const h = harness([{ status: 500, body: {} }]);
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now, maxRetries: 2 });
    await expect(client.lookup('+12125550101')).rejects.toMatchObject({ code: 'SERVER' });
    expect(h.calls).toHaveLength(3);
  });

  it('does not retry a rejected key, an exhausted quota or a definite answer', async () => {
    for (const step of [
      { status: 401, body: { code: 'KEY_INVALID' } },
      { status: 429, body: { error: 'Monthly quota exceeded' } },
      { status: 403, body: { message: 'You are not subscribed to this API.' } },
    ]) {
      const h = harness([step]);
      const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now });
      await expect(client.lookup('+12125550101')).rejects.toBeInstanceOf(ApiError);
      expect(h.calls).toHaveLength(1);
    }
  });

  it('turns a request that outlives the timeout into TIMEOUT', async () => {
    const h = harness(['hang']);
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now, timeoutMs: 1000, maxRetries: 0 });
    await expect(client.lookup('+12125550101')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('stops at once when cancelled during a request, and asks nothing after', async () => {
    const h = harness(['hang']);
    const controller = new AbortController();
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now });
    const pending = client.lookup('+12125550101', controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbort);
    await expect(client.lookup('+12125550102', controller.signal)).rejects.toSatisfy(isAbort);
    expect(h.calls).toHaveLength(1);
  });

  it('stops while waiting out a backoff', async () => {
    const h = harness([{ status: 503, body: {} }]);
    const controller = new AbortController();
    const client = createApiClient({
      apiKey: KEY,
      channel: 'direct',
      fetch: h.fetch,
      now: h.now,
      sleep: async (_ms, signal) => {
        controller.abort();
        if (signal?.aborted) throw abortError();
      },
    });
    await expect(client.lookup('+12125550101', controller.signal)).rejects.toSatisfy(isAbort);
    expect(h.calls).toHaveLength(1);
  });

  it('never lets the key leak through a network error message', async () => {
    const h = harness([new Error(`connect failed for ${KEY}`)]);
    const client = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now, maxRetries: 0 });
    const err = await client.lookup('+12125550101').catch((e: Error) => e);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain('[key]');
  });

  it('describes a direct key for free and says nothing for RapidAPI', async () => {
    const h = harness([{ status: 200, body: { role: 'mega', requestRemaining: 4200, requestLimit: 5000, expiresAt: '2027-01-01T00:00:00Z' } }]);
    const direct = createApiClient({ apiKey: KEY, channel: 'direct', fetch: h.fetch, sleep: h.sleep, now: h.now });
    expect(await direct.keyInfo()).toEqual({ plan: 'mega', quota: { remaining: 4200, limit: 5000 }, expiresAt: '2027-01-01T00:00:00Z' });
    expect(h.calls[0].url).toBe('https://whatsapp-proxy.checkleaked.cc/api-key-stats');

    const rapid = createApiClient({ apiKey: RAPID, channel: 'validator', fetch: h.fetch, sleep: h.sleep, now: h.now });
    expect(await rapid.keyInfo()).toBeNull();

    const bad = harness([{ status: 401, body: { code: 'KEY_INVALID' } }]);
    const rejected = createApiClient({ apiKey: KEY, channel: 'direct', fetch: bad.fetch, sleep: bad.sleep, now: bad.now });
    await expect(rejected.keyInfo()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses to run without a key', () => {
    expect(() => createApiClient({ apiKey: '  ', channel: 'direct' })).toThrow(/API key/);
  });
});

describe('helpers', () => {
  it('sleep resolves on a real timer and rejects when aborted (no busy wait)', async () => {
    const started = Date.now();
    await sleep(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    const controller = new AbortController();
    const waiting = sleep(10_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toSatisfy(isAbort);
    await expect(sleep(5, controller.signal)).rejects.toSatisfy(isAbort);
  });

  it('backs off 1 s, 2 s, 4 s … capped at 30 s', () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3].map((a) => backoffMs(a, mid))).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffMs(12, mid)).toBe(30_000);
  });

  it('reads Retry-After as seconds or a date, and caps it', () => {
    expect(parseRetryAfter('3', 0)).toBe(3000);
    expect(parseRetryAfter(new Date(5000).toUTCString(), 1000)).toBe(4000);
    expect(parseRetryAfter('99999', 0)).toBe(600_000);
    expect(parseRetryAfter(null, 0)).toBeUndefined();
    expect(parseRetryAfter('soon', 0)).toBeUndefined();
  });

  it('reads the quota headers, and null when they are absent', () => {
    const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n] ?? null });
    expect(parseQuota(headers({ 'x-ratelimit-requests-remaining': '12', 'x-ratelimit-requests-limit': '50' }))).toEqual({ remaining: 12, limit: 50 });
    expect(parseQuota(headers({}))).toEqual({ remaining: null, limit: null });
  });

  it('redacts the key and anything shaped like one', () => {
    expect(redact(`bad ${KEY} here`, KEY)).toBe('bad [key] here');
    expect(redact('other wa_0123456789abcdef0123 key', '')).toBe('other [key] key');
  });
});
