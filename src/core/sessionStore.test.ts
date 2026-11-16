import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckResult, ListNumber } from '../shared/types';
import { assertSessionId, newSessionId, SessionStore, writeFileAtomic } from './sessionStore';

let root: string;
let store: SessionStore;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-store-'));
  store = new SessionStore(root);
});
afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

const numbers: ListNumber[] = [
  { e164: '+12125550101', input: '(212) 555-0101', country: 'US' },
  { e164: '+12125550102', input: '212 555 0102', country: 'US' },
  { e164: '+12125550103', input: '2125550103', country: 'US' },
];
const result = (i: number, outcome: CheckResult['outcome'], extra: Partial<CheckResult> = {}): CheckResult => ({
  number: numbers[i].e164,
  outcome,
  checkedAt: `2026-11-15T12:00:0${i}.000Z`,
  ...extra,
});

describe('SessionStore', () => {
  it('creates a session and loads it back in list order', async () => {
    const meta = await store.create({ name: '  Spring list.xlsx  ', source: 'file', numbers });
    expect(meta.name).toBe('Spring list.xlsx');
    expect(meta.status).toBe('ready');
    expect(meta.counts).toMatchObject({ total: 3, pending: 3, checked: 0 });

    await store.appendResult(meta.id, result(2, 'not_on_whatsapp'));
    await store.appendResult(meta.id, result(0, 'on_whatsapp', { name: 'Maya', business: true }));
    const loaded = await store.load(meta.id);
    expect(loaded!.numbers).toEqual(numbers);
    expect(loaded!.results.map((r) => r.number)).toEqual([numbers[0].e164, numbers[2].e164]);
    expect(loaded!.meta.counts).toMatchObject({ on_whatsapp: 1, business: 1, not_on_whatsapp: 1, checked: 2, pending: 1 });
  });

  it('keeps the latest answer per number and counts a failed one as pending', async () => {
    const meta = await store.create({ name: 'x', source: 'paste', numbers });
    await store.appendResult(meta.id, result(0, 'failed', { note: 'timeout' }));
    await store.appendResult(meta.id, result(1, 'on_whatsapp'));
    expect((await store.pending(meta.id)).map((n) => n.e164)).toEqual([numbers[0].e164, numbers[2].e164]);
    await store.appendResult(meta.id, result(0, 'on_whatsapp'));
    const loaded = await store.load(meta.id);
    expect(loaded!.results[0].outcome).toBe('on_whatsapp');
    expect(loaded!.meta.counts).toMatchObject({ failed: 0, on_whatsapp: 2, pending: 1 });
  });

  it('starring or renaming a session never touches its answers', async () => {
    // Version 1 saved a list summary over the full session here and wiped the results.
    const meta = await store.create({ name: 'x', source: 'paste', numbers });
    await store.appendResult(meta.id, result(0, 'on_whatsapp', { name: 'Maya' }));
    await store.appendResult(meta.id, result(1, 'not_on_whatsapp'));
    const before = await fs.promises.readFile(path.join(root, meta.id, 'results.jsonl'), 'utf8');

    const starred = await store.updateMeta(meta.id, { starred: true, name: 'Renamed' });
    expect(starred.starred).toBe(true);
    expect(starred.id).toBe(meta.id);
    expect(starred.createdAt).toBe(meta.createdAt);

    expect(await fs.promises.readFile(path.join(root, meta.id, 'results.jsonl'), 'utf8')).toBe(before);
    const loaded = await store.load(meta.id);
    expect(loaded!.results).toHaveLength(2);
    expect(loaded!.meta).toMatchObject({ starred: true, name: 'Renamed' });
  });

  it('skips a line torn by a crash and asks that number again', async () => {
    const meta = await store.create({ name: 'x', source: 'paste', numbers });
    await store.appendResult(meta.id, result(0, 'on_whatsapp'));
    await fs.promises.appendFile(path.join(root, meta.id, 'results.jsonl'), '{"number":"+12125550102","outc');
    const loaded = await store.load(meta.id);
    expect(loaded!.results).toHaveLength(1);
    expect((await store.pending(meta.id)).map((n) => n.e164)).toEqual([numbers[1].e164, numbers[2].e164]);
  });

  it('refuses ids that are not plain names (they become folder names)', async () => {
    for (const bad of ['../settings', '..', 'a/b', 'a\\b', '', 'x'.repeat(81), 'a b', null, 42]) {
      expect(() => assertSessionId(bad)).toThrow('Invalid session id');
    }
    await expect(store.load('../../etc')).rejects.toThrow('Invalid session id');
    await expect(store.remove('..')).rejects.toThrow('Invalid session id');
    expect(assertSessionId(newSessionId())).toMatch(/^s_[a-z0-9]+_[a-z0-9]{6}$/);
  });

  it('lists newest activity first, removes one and clears all', async () => {
    const a = await store.create({ name: 'a', source: 'paste', numbers }, new Date('2026-01-01T00:00:00Z'));
    const b = await store.create({ name: 'b', source: 'paste', numbers }, new Date('2026-02-01T00:00:00Z'));
    await fs.promises.mkdir(path.join(root, 'not a session'));
    await fs.promises.writeFile(path.join(root, 'stray.json'), '{}');
    expect((await store.list()).map((m) => m.name)).toEqual(['b', 'a']);

    expect(await store.remove(a.id)).toBe(true);
    expect(await store.remove(a.id)).toBe(false);
    expect(await store.load(a.id)).toBeNull();
    expect(await store.clear()).toBe(1);
    expect(await store.list()).toEqual([]);
    expect(await store.readMeta(b.id)).toBeNull();
    expect(fs.existsSync(path.join(root, 'stray.json'))).toBe(true); // only sessions are removed
  });

  it('relabels a session a crash left as running, with its answers intact', async () => {
    const meta = await store.create({ name: 'x', source: 'paste', numbers });
    await store.appendResult(meta.id, result(0, 'on_whatsapp'));
    await store.updateMeta(meta.id, { status: 'running' });
    expect(await store.recoverInterrupted()).toBe(1);
    const loaded = await store.load(meta.id);
    expect(loaded!.meta.status).toBe('stopped');
    expect(loaded!.meta.stopReason).toMatch(/Nothing was lost/);
    expect(loaded!.meta.counts.checked).toBe(1);
    expect(await store.recoverInterrupted()).toBe(0);
  });

  it('writes nothing but the list, the answers and the meta', async () => {
    const meta = await store.create({ name: 'x', source: 'paste', numbers });
    await store.appendResult(meta.id, result(0, 'on_whatsapp'));
    expect((await fs.promises.readdir(path.join(root, meta.id))).sort()).toEqual(['meta.json', 'numbers.json', 'results.jsonl']);
    const stored = JSON.parse(await fs.promises.readFile(path.join(root, meta.id, 'meta.json'), 'utf8'));
    expect(Object.keys(stored)).not.toContain('settings');
    expect(JSON.stringify(stored)).not.toMatch(/apiKey/i);
  });

  it('writeFileAtomic replaces a file and leaves no temp file behind', async () => {
    const file = path.join(root, 'a.json');
    await writeFileAtomic(file, 'one');
    await writeFileAtomic(file, 'two');
    expect(await fs.promises.readFile(file, 'utf8')).toBe('two');
    expect(await fs.promises.readdir(root)).toEqual(['a.json']);
  });

  it('an empty store lists nothing', async () => {
    expect(await new SessionStore(path.join(root, 'nowhere')).list()).toEqual([]);
  });
});
