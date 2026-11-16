/**
 * Settings on disk. The API key is the only secret: it is stored encrypted by
 * the operating system when that is possible, kept in memory only when it is
 * not, and never handed to the window (the window learns that a key exists and
 * its last four characters).
 */
import * as fs from 'fs';
import { resolveChannel } from '../shared/channels';
import {
  Channel,
  ChannelSetting,
  PublicSettings,
  SettingsPatch,
  ThemeSetting,
} from '../shared/types';
import { DEFAULT_GAP_MS, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from './apiClient';
import { isSupportedCountry } from './phone';
import { writeFileAtomic } from './sessionStore';

/** OS-level encryption (Electron's safeStorage), injected so this file stays testable. */
export interface KeyCodec {
  /** Settled once at start-up: whether the system can protect a stored key. */
  available(): boolean;
  /** Returns base64. */
  encrypt(plain: string): string | Promise<string>;
  decrypt(stored: string): string | Promise<string>;
}

interface StoredSettings {
  channel: ChannelSetting;
  defaultCountry: string;
  gapMs: number;
  timeoutMs: number;
  maxRetries: number;
  theme: ThemeSetting;
  showPictures: boolean;
  apiKeyEnc?: string;
}

const CHANNEL_SETTINGS: ChannelSetting[] = ['auto', 'direct', 'validator', 'dbonly'];
const THEMES: ThemeSetting[] = ['system', 'light', 'dark'];

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export class SettingsStore {
  private settings: StoredSettings;
  private apiKey = '';
  private loaded = false;

  constructor(
    private readonly file: string,
    private readonly codec: KeyCodec,
    /** Region guessed from the system, used until the person picks one. */
    private readonly fallbackCountry = 'US'
  ) {
    this.settings = this.defaults();
  }

  private defaults(): StoredSettings {
    return {
      channel: 'auto',
      defaultCountry: isSupportedCountry(this.fallbackCountry) ? this.fallbackCountry : 'US',
      gapMs: DEFAULT_GAP_MS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
      theme: 'system',
      showPictures: true,
    };
  }

  /** Reads stored or patched settings. A value that does not fit keeps the one in `d`: the defaults, or the current settings. */
  private normalise(raw: Record<string, unknown>, d: StoredSettings = this.defaults()): StoredSettings {
    return {
      channel: CHANNEL_SETTINGS.includes(raw.channel as ChannelSetting) ? (raw.channel as ChannelSetting) : d.channel,
      defaultCountry:
        typeof raw.defaultCountry === 'string' && isSupportedCountry(raw.defaultCountry)
          ? raw.defaultCountry
          : d.defaultCountry,
      gapMs: clamp(raw.gapMs, 0, 10_000, d.gapMs),
      // Versions before 2.0 called this `timeout`.
      timeoutMs: clamp(raw.timeoutMs ?? raw.timeout, 5_000, 120_000, d.timeoutMs),
      maxRetries: clamp(raw.maxRetries, 0, 6, d.maxRetries),
      theme: THEMES.includes(raw.theme as ThemeSetting) ? (raw.theme as ThemeSetting) : d.theme,
      showPictures: typeof raw.showPictures === 'boolean' ? raw.showPictures : d.showPictures,
      apiKeyEnc: typeof raw.apiKeyEnc === 'string' && raw.apiKeyEnc ? raw.apiKeyEnc : undefined,
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(await fs.promises.readFile(this.file, 'utf8')) as Record<string, unknown>;
    } catch {
      return; // First run, or an unreadable file: start from the defaults.
    }
    this.settings = this.normalise(raw);

    if (this.settings.apiKeyEnc && this.codec.available()) {
      try {
        this.apiKey = await this.codec.decrypt(this.settings.apiKeyEnc);
      } catch {
        // Encrypted on another machine or account: the stored key is unusable.
        this.settings.apiKeyEnc = undefined;
      }
    }

    // Versions before 2.0 wrote the key in plain text when encryption was not
    // available. Take it, then make sure it does not stay on disk like that.
    const plain = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    if (plain) {
      if (!this.apiKey) this.apiKey = plain;
      await this.persistKey();
    }
  }

  private async persistKey(): Promise<void> {
    this.settings.apiKeyEnc =
      this.apiKey && this.codec.available() ? await this.codec.encrypt(this.apiKey) : undefined;
    await this.save();
  }

  private async save(): Promise<void> {
    const out: StoredSettings = { ...this.settings };
    if (!out.apiKeyEnc) delete out.apiKeyEnc;
    await writeFileAtomic(this.file, JSON.stringify(out, null, 2));
  }

  /** The key, for the main process only. */
  getKey(): string {
    return this.apiKey;
  }

  /** The channel requests go to with the current key and setting. */
  channel(): Channel {
    return resolveChannel(this.settings.channel, this.apiKey);
  }

  getPublic(): PublicSettings {
    return {
      hasKey: Boolean(this.apiKey),
      keyEnding: this.apiKey ? this.apiKey.slice(-4) : '',
      canStoreKey: this.codec.available(),
      channel: this.settings.channel,
      resolvedChannel: this.apiKey ? this.channel() : null,
      defaultCountry: this.settings.defaultCountry,
      gapMs: this.settings.gapMs,
      timeoutMs: this.settings.timeoutMs,
      maxRetries: this.settings.maxRetries,
      theme: this.settings.theme,
      showPictures: this.settings.showPictures,
    };
  }

  async patch(patch: SettingsPatch): Promise<PublicSettings> {
    const merged = this.normalise({ ...this.settings, ...patch } as unknown as Record<string, unknown>, this.settings);
    merged.apiKeyEnc = this.settings.apiKeyEnc;
    this.settings = merged;
    if (typeof patch.apiKey === 'string') {
      this.apiKey = patch.apiKey.trim();
      await this.persistKey();
    } else {
      await this.save();
    }
    return this.getPublic();
  }
}
