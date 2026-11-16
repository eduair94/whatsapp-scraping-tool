import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS, channelMismatch, isDirectKey, isRapidApiKey, resolveChannel } from '../shared/channels';
import { applyResult, countResults, emptyCounts, isFinal, percent } from '../shared/outcomes';
import { Channel, CheckResult } from '../shared/types';
import { createApiClient } from './apiClient';
import { CheckRun } from './checker';
import { createDemoFetch, demoRecord, drawPicture, MAX_SAMPLE_NUMBERS, sampleNumbers } from './demo';
import { parseNumber } from './phone';
import { SessionStore } from './sessionStore';

let root: string;
let realFetch: typeof globalThis.fetch;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-demo-'));
  // Demo mode must never go online: any real request fails the test.
  realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('demo mode went online');
  }) as typeof globalThis.fetch;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  await fs.promises.rm(root, { recursive: true, force: true });
});

describe('sample numbers', () => {
  it('come only from the range reserved for film and television, and are valid to the parser', () => {
    const sample = sampleNumbers(500);
    expect(sample).toHaveLength(500);
    expect(new Set(sample.map((n) => n.e164)).size).toBe(500);
    for (const n of sample) {
      expect(n.e164).toMatch(/^\+1[2-9]\d{2}55501\d{2}$/);
      expect(parseNumber(n.e164!, 'US')).toMatchObject({ valid: true, country: 'US', e164: n.e164 });
      expect(parseNumber(n.input, 'US').e164).toBe(n.e164);
    }
    expect(sampleNumbers(MAX_SAMPLE_NUMBERS + 50)).toHaveLength(MAX_SAMPLE_NUMBERS);
    expect(sampleNumbers(0)).toEqual([]);
  });
});

describe('demo records', () => {
  it('are stable per number, invented, and never look like an empty avatar', () => {
    expect(demoRecord('12125550147')).toEqual(demoRecord('12125550147'));
    const seen = new Set<string>();
    for (const n of sampleNumbers(400)) {
      const { status, body } = demoRecord(n.e164!.slice(1));
      seen.add(`${status}:${body.exists}:${body.isBusiness}`);
      const text = JSON.stringify(body);
      for (const match of text.matchAll(/https?:\/\/[^"\\]+|[\w.]+@[\w.-]+/g)) expect(match[0]).toMatch(/\.example\b/);
    }
    expect(seen).toEqual(new Set(['200:true:true', '200:true:false', '200:false:undefined', '400:undefined:undefined']));
    const picture = decodeURIComponent(drawPicture('x', false));
    expect(picture.startsWith('data:image/svg+xml;utf8,<svg')).toBe(true);
    expect(drawPicture('x', true)).not.toBe(drawPicture('x', false));
  });
});

describe('demo API', () => {
  const key = { headers: { 'x-rapidapi-key': 'anything' } };
  const url = (channel: Channel, digits: string) => CHANNELS[channel].baseUrl + CHANNELS[channel].lookupPath(digits);

  it('refuses every host that is not one of the three API hosts', async () => {
    const f = createDemoFetch({ latency: false });
    expect((await f('https://example.com/number/12125550147', key)).status).toBe(502);
  });

  it('needs a key, counts the quota after the call and enforces its minimum gap', async () => {
    let clock = 0;
    const f = createDemoFetch({ latency: false, quota: 10, minGapMs: 100, now: () => clock });
    expect((await f(url('direct', '12125550147'), {})).status).toBe(401);

    clock = 1000;
    const first = await f(url('direct', '12125550147'), key);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-ratelimit-requests-remaining')).toBe('9');
    expect(first.headers.get('x-ratelimit-requests-limit')).toBe('10');

    const tooSoon = await f(url('direct', '12125550148'), key);
    expect(tooSoon.status).toBe(429);
    expect(JSON.parse(await tooSoon.text()).error).toMatch(/at least 0\.1 seconds apart/);

    const stats = await f(`${CHANNELS.direct.baseUrl}/api-key-stats`, key);
    expect(JSON.parse(await stats.text())).toMatchObject({ role: 'demo', requestRemaining: 9, requestLimit: 10 });
  });

  it('answers each channel the way the real one does', async () => {
    let clock = 0;
    const f = createDemoFetch({ latency: false, now: () => (clock += 1000) });
    const onWhatsApp = sampleNumbers(300, () => 0.5).map((n) => n.e164!.slice(1)).find((d) => demoRecord(d).body.exists === true && Number(d) % 5 !== 0)!;

    const direct = JSON.parse(await (await f(url('direct', onWhatsApp), key)).text());
    expect(direct.exists).toBe(true);
    expect(direct.urlImage).toMatch(/^data:image\/svg\+xml/);

    const validator = JSON.parse(await (await f(url('validator', onWhatsApp), key)).text());
    expect(validator.exists).toBe(true);
    expect(validator.number).toMatch(/\*{4}/);
    for (const field of ['pushname', 'about', 'urlImage', 'businessProfile', 'isBusiness']) expect(field in validator).toBe(false);
  });

  it('runs a whole list on every channel without touching the network', async () => {
    for (const channel of ['direct', 'validator', 'dbonly'] as Channel[]) {
      const store = new SessionStore(path.join(root, channel));
      const numbers = sampleNumbers(120, () => 0.42).map((n) => ({ e164: n.e164!, input: n.input, country: n.country }));
      const meta = await store.create({ name: `demo ${channel}`, source: 'sample', numbers });
      let clock = 0;
      const now = () => clock;
      const client = createApiClient({
        apiKey: 'demo',
        channel,
        fetch: createDemoFetch({ latency: false, now, minGapMs: 100 }),
        gapMs: 120,
        now,
        sleep: async (ms) => {
          clock += ms;
        },
      });
      const end = await new CheckRun({ store, client, sessionId: meta.id, now }).run();
      expect(end.status).toBe('completed');
      expect(end.counts.checked).toBe(120);
      expect(end.counts.failed).toBe(0); // the occasional 503 succeeds on the retry
      expect(end.counts.on_whatsapp).toBeGreaterThan(20);
      expect(end.counts.not_on_whatsapp).toBeGreaterThan(10);

      const session = await store.load(meta.id);
      const profiled = session!.results.filter((r) => r.outcome === 'on_whatsapp' && r.name);
      if (channel === 'validator') {
        expect(profiled).toHaveLength(0); // registered or not, nothing more
        expect(end.counts.not_in_database).toBe(0);
      } else {
        expect(profiled.length).toBeGreaterThan(10);
        expect(end.counts.business).toBeGreaterThan(0);
      }
      if (channel === 'dbonly') expect(end.counts.not_in_database).toBeGreaterThan(5);
      else expect(end.counts.not_in_database).toBe(0);
    }
  });
});

describe('channels', () => {
  const direct = `wapi_${'0f'.repeat(32)}`;
  const legacyDirect = `wa_${'0f'.repeat(32)}`;
  const rapid = '0123456789abcdefmsh0123456789abcdefp1abcdejsn0123456789ab';

  it('recognises the two kinds of key by shape', () => {
    expect(isDirectKey(direct)).toBe(true);
    expect(isDirectKey(` ${legacyDirect} `)).toBe(true);
    expect(isDirectKey(rapid)).toBe(false);
    expect(isRapidApiKey(rapid)).toBe(true);
    expect(isRapidApiKey(direct)).toBe(false);
    expect(isRapidApiKey('hello')).toBe(false);
  });

  it('resolves auto from the key and respects an explicit choice', () => {
    expect(resolveChannel('auto', direct)).toBe('direct');
    expect(resolveChannel('auto', rapid)).toBe('validator');
    expect(resolveChannel('auto', 'unknown-shape')).toBe('direct');
    expect(resolveChannel('dbonly', rapid)).toBe('dbonly');
    expect(resolveChannel('direct', rapid)).toBe('direct');
  });

  it('warns when the channel cannot work with the key', () => {
    expect(channelMismatch('direct', rapid)).toMatch(/RapidAPI key/);
    expect(channelMismatch('validator', direct)).toMatch(/direct key/);
    expect(channelMismatch('dbonly', rapid)).toBeNull();
    expect(channelMismatch('direct', '')).toBeNull();
  });

  it('sends each channel to its own host only', () => {
    expect(Object.values(CHANNELS).map((c) => new URL(c.baseUrl).host)).toEqual([
      'whatsapp-proxy.checkleaked.cc',
      'whatsapp-number-validator18.p.rapidapi.com',
      'wp-data-db-only.p.rapidapi.com',
    ]);
    expect(CHANNELS.direct.rapidApiHost).toBeNull();
    expect(CHANNELS.dbonly.live).toBe(false);
    expect(CHANNELS.validator.profile).toBe(false);
  });
});

describe('counts', () => {
  const r = (number: string, outcome: CheckResult['outcome'], business = false): CheckResult => ({ number, outcome, checkedAt: '', business });

  it('counts a failed number as still pending and business as part of On WhatsApp', () => {
    const counts = countResults([r('1', 'on_whatsapp', true), r('2', 'on_whatsapp'), r('3', 'failed'), r('4', 'invalid')], 10);
    expect(counts).toEqual({ on_whatsapp: 2, not_on_whatsapp: 0, not_in_database: 0, invalid: 1, failed: 1, business: 1, checked: 4, pending: 7, total: 10 });
    expect(isFinal('failed')).toBe(false);
    expect(isFinal('invalid')).toBe(true);
  });

  it('applies one answer at a time to the same totals a recount gives', () => {
    let counts = emptyCounts(3);
    const first = r('1', 'failed');
    counts = applyResult(counts, first);
    expect(counts).toMatchObject({ failed: 1, checked: 1, pending: 3 });
    const second = r('1', 'on_whatsapp', true);
    counts = applyResult(counts, second, first);
    counts = applyResult(counts, r('2', 'not_on_whatsapp'));
    expect(counts).toEqual(countResults([second, r('2', 'not_on_whatsapp')], 3));
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBe(0);
  });
});
