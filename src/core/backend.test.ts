import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Progress, RunEnd } from '../shared/types';
import { Backend, BackendOptions } from './backend';
import { createDemoFetch } from './demo';
import { KeyCodec } from './settingsStore';

const KEY = `wapi_${'cd'.repeat(32)}`;
const RAPID = '0123456789abcdefmsh0123456789abcdefp1abcdejsn0123456789ab';
const plainCodec: KeyCodec = {
  available: () => true,
  encrypt: (s) => Buffer.from(`enc:${s}`).toString('base64'),
  decrypt: (s) => Buffer.from(s, 'base64').toString().slice(4),
};

let dir: string;
let ends: RunEnd[];
let updates: Progress[];

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-backend-'));
  ends = [];
  updates = [];
});
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

async function backend(extra: Partial<BackendOptions> = {}): Promise<Backend> {
  const b = new Backend({
    dataDir: dir,
    codec: plainCodec,
    systemCountry: 'US',
    fetch: createDemoFetch({ latency: false, minGapMs: 0 }),
    gapMs: 0,
    onProgress: (p) => updates.push(p),
    onEnd: (e) => ends.push(e),
    ...extra,
  });
  await b.init();
  return b;
}

const finished = async () => {
  for (let i = 0; i < 400 && ends.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  if (!ends.length) throw new Error('the run never ended');
  return ends[0];
};

const TEN = Array.from({ length: 10 }, (_, i) => `(212) 555-01${String(10 + i)}`).join('\n');

describe('Backend', () => {
  it('loads a list, checks it, and exports it', async () => {
    const b = await backend();
    await b.updateSettings({ apiKey: KEY });
    const parsed = b.listFromText(`${TEN}\n(212) 555-0110\nnot a number 12`);
    expect(parsed).toMatchObject({ label: 'Pasted numbers', source: 'paste', found: 12, duplicates: 1 });
    expect(parsed.entries.filter((e) => e.valid)).toHaveLength(10);

    const meta = await b.createSession();
    expect(meta.counts.total).toBe(10); // the invalid line is left out
    expect(b.currentList()).toBeNull(); // the draft became the session

    expect(await b.startRun(meta.id)).toEqual({ ok: true });
    expect(b.runningSessionId).toBe(meta.id);
    const end = await finished();
    expect(end).toMatchObject({ sessionId: meta.id, status: 'completed' });
    expect(end.counts.checked).toBe(10);
    expect(b.runningSessionId).toBeNull();
    expect(updates.filter((u) => u.result)).toHaveLength(10);

    const file = path.join(dir, await b.suggestedExportName(meta.id, 'csv'));
    expect(await b.exportSession(meta.id, 'csv', 'all', file)).toEqual({ rows: 10 });
    expect((await fs.promises.readFile(file, 'utf8')).split('\r\n').filter(Boolean)).toHaveLength(11);
    await expect(b.exportSession(meta.id, 'pdf' as never, 'all', file)).rejects.toThrow(/Unknown export format/);
    expect(await b.startRun(meta.id)).toEqual({ ok: false, error: 'Every number in this list already has an answer.' });
  });

  it('re-reads the same list when the default country changes', async () => {
    const b = await backend();
    const us = b.listFromText('098 297 150\n099 123 456');
    expect(us.entries.every((e) => !e.valid)).toBe(true);
    await b.updateSettings({ defaultCountry: 'UY' });
    const uy = b.currentList()!;
    expect(uy.entries.map((e) => e.e164)).toEqual(['+59898297150', '+59899123456']);
  });

  it('adds more numbers to the list being prepared', async () => {
    const b = await backend();
    b.listFromText('(212) 555-0101');
    const more = b.listFromText('(212) 555-0102\n(212) 555-0101', true);
    expect(more.entries.map((e) => e.e164)).toEqual(['+12125550101', '+12125550102']);
    expect(more.duplicates).toBe(1);
    b.clearList();
    expect(b.currentList()).toBeNull();
    await expect(b.createSession()).rejects.toThrow(/Add some numbers first/);
  });

  it('reads a file and reports one with no numbers', async () => {
    const b = await backend();
    const file = path.join(dir, 'contacts.csv');
    await fs.promises.writeFile(file, 'name,phone\nMaya,+1 212 555 0147\nTom,(212) 555-0148\n');
    expect((await b.listFromFile(file)).entries.map((e) => e.e164)).toEqual(['+12125550147', '+12125550148']);
    const empty = path.join(dir, 'empty.csv');
    await fs.promises.writeFile(empty, 'name\nMaya\n');
    await expect(b.listFromFile(empty)).rejects.toThrow(/No phone numbers were found/);
    expect(() => b.listFromText('hello')).toThrow(/No phone numbers were found/);
  });

  it('refuses to start without a key, with the wrong channel, or twice', async () => {
    const b = await backend();
    b.listFromText(TEN);
    const meta = await b.createSession();
    expect(await b.startRun(meta.id)).toEqual({ ok: false, error: 'Add your API key in Settings first.' });
    await b.updateSettings({ apiKey: RAPID, channel: 'direct' });
    expect((await b.startRun(meta.id)) as { error: string }).toMatchObject({ ok: false, error: expect.stringMatching(/RapidAPI key/) });
    expect(await b.startRun('s_missing')).toEqual({ ok: false, error: 'This list no longer exists.' });

    await b.updateSettings({ channel: 'auto' });
    const slow = await backend({ fetch: createDemoFetch({ latency: true, minGapMs: 0 }) });
    slow.listFromText(TEN);
    const other = await slow.createSession();
    expect(await slow.startRun(other.id)).toEqual({ ok: true });
    expect(await slow.startRun(meta.id)).toEqual({ ok: false, error: 'Another check is running. Stop it first.' });
    await slow.stopRun();
    expect(slow.runningSessionId).toBeNull();
    const stopped = await slow.getSession(other.id);
    expect(stopped!.meta.status).toBe('stopped');
  });

  it('describes the key: free for a direct key, one request on RapidAPI', async () => {
    const b = await backend();
    expect(await b.checkKey()).toMatchObject({ ok: false, message: 'Paste a key first.' });
    await b.updateSettings({ apiKey: KEY });
    const direct = await b.checkKey();
    expect(direct).toMatchObject({ ok: true, channel: 'direct' });
    expect(direct.message).toMatch(/^Demo key accepted: 5,000 requests left, valid until \d{4}-\d{2}-\d{2}\.$/);

    await b.updateSettings({ apiKey: RAPID });
    const rapid = await b.checkKey();
    expect(rapid).toMatchObject({ ok: true, channel: 'validator' });
    expect(rapid.message).toBe('Key accepted on RapidAPI: Number Validator. 4,999 requests left.');

    await b.updateSettings({ channel: 'direct' });
    expect(await b.checkKey()).toMatchObject({ ok: false, message: expect.stringMatching(/RapidAPI key/) });
  });

  it('never calls a key the API does not know "accepted" (the key endpoint answers 404 for it)', async () => {
    const asked: string[] = [];
    const unknown = await backend({
      fetch: async (url) => {
        asked.push(new URL(url).pathname);
        return { status: url.includes('/api-key-stats') ? 404 : 401, headers: { get: () => null }, text: async () => '' };
      },
    });
    await unknown.updateSettings({ apiKey: KEY });
    const check = await unknown.checkKey();
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/rejected this key/);
    // One number was asked to find out.
    expect(asked).toEqual(['/api-key-stats', '/number/12025550100']);

    const odd = await backend({
      fetch: async (url) => ({
        status: url.includes('/api-key-stats') ? 404 : 418,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: 'I am a teapot' }),
      }),
    });
    await odd.updateSettings({ apiKey: KEY });
    expect((await odd.checkKey()).ok).toBe(false);
  });

  it('reports a rejected key in plain words', async () => {
    const rejecting = await backend({
      fetch: async () => ({ status: 401, headers: { get: () => null }, text: async () => JSON.stringify({ code: 'KEY_INVALID' }) }),
    });
    await rejecting.updateSettings({ apiKey: KEY });
    const check = await rejecting.checkKey();
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/rejected this key/);
  });

  it('starring keeps the answers and the place in the list; removing a running session stops it', async () => {
    const b = await backend();
    await b.updateSettings({ apiKey: KEY });
    b.listFromText(TEN);
    const meta = await b.createSession('  My list  ');
    expect(meta.name).toBe('My list');
    await b.startRun(meta.id);
    await finished();
    const before = await b.getSession(meta.id);
    const starred = await b.updateSession(meta.id, { starred: true, name: '   ' });
    expect(starred).toMatchObject({ starred: true, name: 'My list', updatedAt: before!.meta.updatedAt });
    expect((await b.getSession(meta.id))!.results).toHaveLength(10);

    const slow = await backend({ fetch: createDemoFetch({ latency: true, minGapMs: 0 }) });
    slow.listFromText(TEN);
    const running = await slow.createSession();
    await slow.startRun(running.id);
    expect(await slow.removeSession(running.id)).toBe(true);
    expect(slow.runningSessionId).toBeNull();
    expect(await slow.getSession(running.id)).toBeNull();
    expect(await slow.clearSessions()).toBeGreaterThanOrEqual(1);
    expect(await slow.listSessions()).toEqual([]);
  });

  it('offers sample numbers in demo mode only, and the demo never stores a key', async () => {
    const real = await backend();
    expect(() => real.listFromSample(10)).toThrow(/only available in demo mode/);

    const demoDir = path.join(dir, 'demo');
    const demo = await backend({ dataDir: demoDir, demo: true });
    expect(demo.getSettings()).toMatchObject({ hasKey: true, canStoreKey: false });
    const sample = demo.listFromSample(25);
    expect(sample).toMatchObject({ source: 'sample', label: '25 sample numbers', found: 25 });
    await demo.updateSettings({ defaultCountry: 'UY' });
    expect(demo.currentList()!.entries.every((e) => e.valid)).toBe(true); // samples are never re-read
    const meta = await demo.createSession();
    await demo.startRun(meta.id);
    expect((await finished()).counts.checked).toBe(25);
    expect(await fs.promises.readFile(path.join(demoDir, 'settings.json'), 'utf8')).not.toMatch(/demo-key|apiKey/);
  });

  it('converts version 1 sessions on first start and marks interrupted ones', async () => {
    const legacy = path.join(dir, 'old-sessions');
    await fs.promises.mkdir(legacy, { recursive: true });
    await fs.promises.writeFile(
      path.join(legacy, 'session_9.json'),
      JSON.stringify({ fileName: 'Dealers.csv', startTime: '2026-05-01T00:00:00Z', settings: { apiKey: KEY }, results: [{ number: '12125550101', data: { isWAContact: true } }] })
    );
    const b = new Backend({ dataDir: dir, codec: plainCodec, legacySessionDirs: [legacy, path.join(dir, 'nowhere')] });
    expect(await b.init()).toEqual({ migrated: 1, dropped: 0, failed: 0 });
    const [meta] = await b.listSessions();
    expect(meta).toMatchObject({ name: 'Dealers.csv', status: 'completed' });
    await b.shutdown();
  });
});
