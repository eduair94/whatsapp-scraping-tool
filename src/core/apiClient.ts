/**
 * The one place that talks to the API. It replaces the `whatsapp-number-checker`
 * dependency, which pointed at a RapidAPI listing removed on 2026-11-04, kept
 * checking after Cancel, and waited by spinning the CPU.
 *
 * What it guarantees:
 *   - requests never start closer together than `gapMs` (the API refuses calls
 *     less than 0.5 s apart), using real timers;
 *   - a lookup can be cancelled at any moment through an AbortSignal, also
 *     while it waits or backs off;
 *   - only transient failures are retried (timeouts, network errors, 5xx and
 *     "slow down"), at most `maxRetries` times, honouring Retry-After;
 *   - the key is sent to exactly one host, the one its channel names.
 */
import { CHANNELS, ChannelSpec } from '../shared/channels';
import { Channel, CheckResult, Quota } from '../shared/types';
import { ApiError, classify } from './classify';

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ApiClientOptions {
  apiKey: string;
  channel: Channel;
  /** Override the channel's base URL (tests, self-hosted proxies). */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Minimum time between the start of two requests. */
  gapMs?: number;
  timeoutMs?: number;
  /** Extra attempts after the first, for transient failures only. */
  maxRetries?: number;
  userAgent?: string;
  /** Injectable for tests. Must reject with the signal's reason when aborted. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Told about every wait longer than the normal gap, so the UI can say why nothing moves. */
  onWait?: (reason: string, ms: number) => void;
}

export interface LookupAnswer {
  result: CheckResult;
  quota: Quota;
  /** Attempts it took, 1 when the first one answered. */
  attempts: number;
}

export interface KeyInfo {
  /** Plan or role name when the API tells it. */
  plan: string | null;
  quota: Quota;
  expiresAt: string | null;
}

export const DEFAULT_GAP_MS = 550;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 30_000;

export function abortError(): Error {
  const err = new Error('Cancelled');
  err.name = 'AbortError';
  return err;
}

export const isAbort = (err: unknown): boolean =>
  err instanceof Error && err.name === 'AbortError';

/** Resolves after `ms`, or rejects at once when the signal aborts. Never spins. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 1 s, 2 s, 4 s … capped, with a little jitter so retries do not march in step. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
  return Math.round(base * (0.85 + random() * 0.3));
}

/** `Retry-After` as seconds or as an HTTP date. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10 * 60_000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - now, 10 * 60_000));
  return undefined;
}

/** Both the direct proxy and RapidAPI report the quota left after the call. */
export function parseQuota(headers: { get(name: string): string | null }): Quota {
  const read = (name: string): number | null => {
    const raw = headers.get(name);
    if (raw === null || raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    remaining: read('x-ratelimit-requests-remaining'),
    limit: read('x-ratelimit-requests-limit'),
  };
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Removes anything shaped like the key from a message before it is shown or stored. */
export function redact(message: string, apiKey: string): string {
  let out = message;
  if (apiKey && apiKey.length >= 6) out = out.split(apiKey).join('[key]');
  return out.replace(/\b(wapi|wa)_[0-9a-f]{8,}\b/gi, '[key]');
}

export function createApiClient(options: ApiClientOptions) {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new ApiError('UNAUTHORIZED', 'Add your API key in Settings first.');

  const spec: ChannelSpec = CHANNELS[options.channel];
  const baseUrl = (options.baseUrl ?? spec.baseUrl).replace(/\/+$/, '');
  const fetchImpl: FetchLike =
    options.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
  const gapMs = Math.max(0, options.gapMs ?? DEFAULT_GAP_MS);
  const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  const sleepFn = options.sleep ?? sleep;
  const now = options.now ?? Date.now;

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': options.userAgent ?? 'whatsapp-number-checker-desktop',
    'x-rapidapi-key': apiKey,
  };
  if (spec.rapidApiHost) headers['x-rapidapi-host'] = spec.rapidApiHost;

  // The moment the next request may start. Requests are sequential, so one
  // number is enough to keep them `gapMs` apart.
  let nextStart = 0;

  async function request(
    path: string,
    signal?: AbortSignal
  ): Promise<{ status: number; body: Record<string, unknown> | null; quota: Quota; retryAfterMs?: number }> {
    const wait = nextStart - now();
    if (wait > 0) await sleepFn(wait, signal);
    if (signal?.aborted) throw abortError();
    nextStart = now() + gapMs;

    // One controller per attempt: aborted by the caller's signal or by the timeout.
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await fetchImpl(baseUrl + path, { method: 'GET', headers, signal: controller.signal });
      const raw = await res.text();
      return {
        status: res.status,
        body: parseJson(raw),
        quota: parseQuota(res.headers),
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after'), now()),
      };
    } catch (cause) {
      if (signal?.aborted) throw abortError();
      if (timedOut) {
        throw new ApiError('TIMEOUT', `No answer within ${Math.round(timeoutMs / 1000)} seconds.`);
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ApiError('NETWORK', `Could not reach the API (${redact(detail, apiKey)}).`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    channel: options.channel,
    baseUrl,

    /**
     * Asks about one number. Resolves with the answer, or rejects with an
     * ApiError (fatal ones end the run; the rest mean "this number failed") or
     * an AbortError when cancelled.
     */
    async lookup(number: string, signal?: AbortSignal): Promise<LookupAnswer> {
      const digits = number.replace(/\D/g, '');
      const path = spec.lookupPath(digits);
      let lastError: ApiError | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await request(path, signal);
          const result = classify(
            options.channel,
            number,
            res.status,
            res.body,
            new Date(now()).toISOString(),
            res.retryAfterMs
          );
          return { result, quota: res.quota, attempts: attempt + 1 };
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          lastError = err;
          if (!err.retryable || attempt >= maxRetries) break;
          const delay = err.retryAfterMs ?? backoffMs(attempt);
          options.onWait?.(
            err.code === 'RATE_LIMITED' ? 'The API asked to slow down' : 'Retrying after an error',
            delay
          );
          await sleepFn(delay, signal);
          // A long pause already satisfies the gap; never stack both.
          nextStart = Math.max(nextStart, now());
        }
      }
      throw lastError ?? new ApiError('BAD_RESPONSE', 'The lookup did not complete.');
    },

    /**
     * What the key is and what it has left. Free on the direct channel
     * (`/api-key-stats` is not counted). RapidAPI has no such call, so this
     * returns null there and the first lookup reports the quota instead.
     */
    async keyInfo(signal?: AbortSignal): Promise<KeyInfo | null> {
      if (options.channel !== 'direct') return null;
      const res = await request('/api-key-stats', signal);
      // The proxy answers 404 here for a key it does not know (measured 2026-11-16).
      // That says nothing for sure, so the caller asks one number instead.
      if (res.status === 404) return null;
      if (res.status !== 200 || !res.body) {
        // Reuse the lookup classifier for the error wording (401, 403, 5xx …).
        classify('direct', '', res.status === 200 ? 502 : res.status, res.body, '');
        throw new ApiError('BAD_RESPONSE', 'The API did not describe this key.', { status: res.status });
      }
      const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return {
        plan: typeof res.body.role === 'string' ? res.body.role : null,
        quota: { remaining: num(res.body.requestRemaining), limit: num(res.body.requestLimit) },
        expiresAt: typeof res.body.expiresAt === 'string' ? res.body.expiresAt : null,
      };
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
