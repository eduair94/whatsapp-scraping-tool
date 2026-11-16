import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convertLegacyResult, migrateLegacySessions, scrubKey } from './legacy';
import { SessionStore } from './sessionStore';
import { KeyCodec, SettingsStore } from './settingsStore';

const KEY = `wapi_${'ab'.repeat(32)}`;
const RAPID = '0123456789abcdefmsh0123456789abcdefp1abcdejsn0123456789ab';

/** Stands in for the operating system's encryption: reversible, and never the plain text. */
const codec = (available = true): KeyCodec => ({
  available: () => available,
  encrypt: (plain) => Buffer.from(`enc:${plain.split('').reverse().join('')}`).toString('base64'),
  decrypt: (stored) => {
    const raw = Buffer.from(stored, 'base64').toString();
    if (!raw.startsWith('enc:')) throw new Error('not ours');
    return raw.slice(4).split('').reverse().join('');
  },
});

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-settings-'));
  file = path.join(dir, 'settings.json');
});
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true });
});

const onDisk = () => fs.readFileSync(file, 'utf8');

describe('SettingsStore', () => {
  it('keeps the choice to show no profile pictures', async () => {
    const store = new SettingsStore(file, codec(), 'US');
    await store.load();
    expect((await store.patch({ showPictures: false })).showPictures).toBe(false);
    const again = new SettingsStore(file, codec(), 'US');
    await again.load();
    expect(again.getPublic().showPictures).toBe(false);
    // Anything but a boolean leaves it as it was.
    expect((await again.patch({ showPictures: 'yes' as unknown as boolean })).showPictures).toBe(false);
  });

  it('starts from defaults and guesses the country from the system', async () => {
    const store = new SettingsStore(file, codec(), 'UY');
    await store.load();
    expect(store.getPublic()).toEqual({
      hasKey: false,
      keyEnding: '',
      canStoreKey: true,
      channel: 'auto',
      resolvedChannel: null,
      defaultCountry: 'UY',
      gapMs: 550,
      timeoutMs: 30_000,
      maxRetries: 3,
      theme: 'system',
      showPictures: true,
    });
    expect(new SettingsStore(file, codec(), 'not-a-country').getPublic().defaultCountry).toBe('US');
  });

  it('stores the key encrypted and never hands it to the window', async () => {
    const store = new SettingsStore(file, codec());
    await store.load();
    const shown = await store.patch({ apiKey: `  ${KEY}  ` });
    expect(shown).toMatchObject({ hasKey: true, keyEnding: KEY.slice(-4), resolvedChannel: 'direct' });
    expect(JSON.stringify(shown)).not.toContain(KEY);
    expect(onDisk()).not.toContain(KEY);
    expect(JSON.parse(onDisk()).apiKey).toBeUndefined();
    expect(store.getKey()).toBe(KEY);

    const again = new SettingsStore(file, codec());
    await again.load();
    expect(again.getKey()).toBe(KEY);
  });

  it('keeps the key in memory only when the system cannot protect it', async () => {
    const store = new SettingsStore(file, codec(false));
    await store.load();
    const shown = await store.patch({ apiKey: KEY });
    expect(shown).toMatchObject({ hasKey: true, canStoreKey: false });
    expect(onDisk()).not.toContain(KEY);
    expect(onDisk()).not.toContain('apiKeyEnc');
    const again = new SettingsStore(file, codec(false));
    await again.load();
    expect(again.getKey()).toBe('');
  });

  it('forgets the key when asked', async () => {
    const store = new SettingsStore(file, codec());
    await store.load();
    await store.patch({ apiKey: KEY });
    const shown = await store.patch({ apiKey: '' });
    expect(shown).toMatchObject({ hasKey: false, keyEnding: '', resolvedChannel: null });
    expect(onDisk()).not.toContain('apiKeyEnc');
  });

  it('resolves the channel from the key, or from an explicit choice', async () => {
    const store = new SettingsStore(file, codec());
    await store.load();
    expect((await store.patch({ apiKey: RAPID })).resolvedChannel).toBe('validator');
    expect((await store.patch({ channel: 'dbonly' })).resolvedChannel).toBe('dbonly');
    expect(store.channel()).toBe('dbonly');
    expect(store.getKey()).toBe(RAPID); // changing another setting keeps the key
  });

  it('clamps numbers and ignores values it does not know', async () => {
    const store = new SettingsStore(file, codec());
    await store.load();
    const shown = await store.patch({ gapMs: -5, timeoutMs: 1, maxRetries: 99, theme: 'neon' as never, channel: 'bogus' as never, defaultCountry: 'XX' });
    expect(shown).toMatchObject({ gapMs: 0, timeoutMs: 5000, maxRetries: 6, theme: 'system', channel: 'auto', defaultCountry: 'US' });
    expect((await store.patch({ theme: 'dark', defaultCountry: 'ES', gapMs: 800 }))).toMatchObject({ theme: 'dark', defaultCountry: 'ES', gapMs: 800 });
  });

  it('takes a plain-text key written by version 1 and removes it from the file', async () => {
    await fs.promises.writeFile(file, JSON.stringify({ apiKey: KEY, timeout: 20000, maxRetries: 2, theme: 'light', concurrentRequests: 5 }));
    const store = new SettingsStore(file, codec());
    await store.load();
    expect(store.getKey()).toBe(KEY);
    expect(store.getPublic()).toMatchObject({ timeoutMs: 20000, maxRetries: 2, theme: 'light' });
    expect(onDisk()).not.toContain(KEY);
    expect(Object.keys(JSON.parse(onDisk()))).not.toContain('concurrentRequests');
  });

  it('starts without a key when the stored one cannot be decrypted', async () => {
    await fs.promises.writeFile(file, JSON.stringify({ apiKeyEnc: Buffer.from('from another machine').toString('base64') }));
    const store = new SettingsStore(file, codec());
    await store.load();
    expect(store.getPublic().hasKey).toBe(false);
  });

  it('does not erase the stored key because the keychain refused once', async () => {
    const first = new SettingsStore(file, codec());
    await first.load();
    await first.patch({ apiKey: KEY });

    const refusing: KeyCodec = { ...codec(), decrypt: () => { throw new Error('the keychain said no'); } };
    const locked = new SettingsStore(file, refusing);
    await locked.load();
    expect(locked.getPublic().hasKey).toBe(false);
    await locked.patch({ theme: 'dark' });

    const later = new SettingsStore(file, codec());
    await later.load();
    expect(later.getKey()).toBe(KEY);
    expect(later.getPublic().theme).toBe('dark');

    // Forgetting the key while it cannot be read still removes it.
    const forgetting = new SettingsStore(file, refusing);
    await forgetting.load();
    await forgetting.patch({ apiKey: '' });
    expect(onDisk()).not.toMatch(/apiKeyEnc/);
  });

  it('survives an unreadable settings file', async () => {
    await fs.promises.writeFile(file, '{ not json');
    const store = new SettingsStore(file, codec());
    await store.load();
    expect(store.getPublic().channel).toBe('auto');
  });
});

describe('version 1 sessions', () => {
  const legacy = () => path.join(dir, 'sessions');
  const write = (name: string, value: unknown) => fs.promises.writeFile(path.join(legacy(), name), typeof value === 'string' ? value : JSON.stringify(value));

  beforeEach(async () => {
    await fs.promises.mkdir(legacy(), { recursive: true });
  });

  it('converts each kind of old result', () => {
    const at = '2026-01-01T00:00:00.000Z';
    expect(convertLegacyResult({ number: '59899123456', data: { isWAContact: true, pushname: 'Maya', isBusiness: false } }, '', at)).toMatchObject({ number: '+59899123456', outcome: 'on_whatsapp', name: 'Maya', business: false });
    expect(convertLegacyResult({ number: '+59899123456', data: { isWAContact: false } }, '', at)!.outcome).toBe('not_on_whatsapp');
    expect(convertLegacyResult({ number: '+59899123456', data: { exists: false, isWAContact: true } }, '', at)!.outcome).toBe('not_on_whatsapp');
    expect(convertLegacyResult({ number: '+59899123456', data: null, error: 'WhatsApp number not found' }, '', at)!.outcome).toBe('not_on_whatsapp');
    expect(convertLegacyResult({ number: '+59899123456', data: null, error: 'Rate limit exceeded after 3 retries' }, '', at)).toBeNull();
    expect(convertLegacyResult({ number: '+59899123456', data: null }, '', at)).toBeNull();
    expect(convertLegacyResult({ number: 'abc' }, '', at)).toBeNull();
    const failed = convertLegacyResult({ number: '+59899123456', data: null, error: `API request failed for ${KEY}`, checkedAt: '2026-03-03T03:03:03Z' }, KEY, at)!;
    expect(failed).toMatchObject({ outcome: 'failed', checkedAt: '2026-03-03T03:03:03.000Z' });
    expect(failed.note).not.toContain(KEY);
  });

  it('moves old sessions to the new layout and leaves no API key anywhere on disk', async () => {
    await write('session_1.json', {
      id: 'session_1',
      fileName: 'Current Session',
      startTime: '2026-06-01T10:00:00.000Z',
      endTime: '2026-06-01T10:05:00.000Z',
      status: 'completed',
      isStarred: true,
      settings: { apiKey: KEY, maxRetries: 3 },
      originalNumbers: [
        { original: '(212) 555-0101', cleaned: '+12125550101', country: 'US' },
        { original: '212 555 0102', cleaned: '+12125550102', country: 'US' },
        { original: '212 555 0103', cleaned: '+12125550103', country: 'US' },
      ],
      results: [
        { number: '12125550101', data: { isWAContact: true, isBusiness: true, businessProfile: { description: 'Bread', website: [{ url: 'https://bakery.example' }] }, name: 'Harbor Street Bakery' }, checkedAt: '2026-06-01T10:01:00.000Z' },
        { number: '12125550102', data: null, error: "WhatsApp number doesn't exist" },
        { number: '12125550103', data: null, error: 'Rate limit exceeded after 3 retries' },
      ],
    });
    await write('pending_2.json', { id: 'pending_2', fileName: 'Pending Session', settings: { apiKey: KEY }, originalNumbers: [{ original: '1', cleaned: '+12125550109' }], results: [] });
    await write('broken.json', `{"settings":{"apiKey":"${KEY}"},"results":[`);

    const store = new SessionStore(path.join(dir, 'new'));
    expect(await migrateLegacySessions(legacy(), store)).toEqual({ migrated: 1, dropped: 1, failed: 1 });

    const [meta] = await store.list();
    expect(meta).toMatchObject({ name: 'List checked on 2026-06-01', status: 'stopped', starred: true, startedAt: '2026-06-01T10:00:00.000Z' });
    const session = await store.load(meta.id);
    expect(session!.numbers.map((n) => n.e164)).toEqual(['+12125550101', '+12125550102', '+12125550103']);
    expect(session!.numbers[0].input).toBe('(212) 555-0101');
    expect(session!.results).toMatchObject([
      { number: '+12125550101', outcome: 'on_whatsapp', name: 'Harbor Street Bakery', business: true, website: 'https://bakery.example', checkedAt: '2026-06-01T10:01:00.000Z' },
      { number: '+12125550102', outcome: 'not_on_whatsapp' },
    ]);
    expect(session!.meta.counts).toMatchObject({ checked: 2, pending: 1 });

    // The old files are gone (or scrubbed), and the key is nowhere under the folder.
    expect((await fs.promises.readdir(legacy())).sort()).toEqual(['broken.json']);
    const everything: string[] = [];
    const walk = async (d: string) => {
      for (const entry of await fs.promises.readdir(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) await walk(p);
        else everything.push(await fs.promises.readFile(p, 'utf8'));
      }
    };
    await walk(dir);
    expect(everything.length).toBeGreaterThan(3);
    for (const content of everything) expect(content).not.toContain(KEY);
  });

  it('does nothing when there is no old folder, and scrubbing a missing file is harmless', async () => {
    const store = new SessionStore(path.join(dir, 'new'));
    expect(await migrateLegacySessions(path.join(dir, 'nowhere'), store)).toEqual({ migrated: 0, dropped: 0, failed: 0 });
    await expect(scrubKey(path.join(dir, 'nowhere.json'))).resolves.toBeUndefined();
  });
});
