import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { AppSettings, CheckSession } from '../types';
import {
  SessionSummary,
  sanitizeSessionId,
  toSessionSummary,
} from './storageUtils';

export class StorageService {
  private userDataPath: string;
  private settingsPath: string;
  private sessionsPath: string;
  private indexPath: string;

  constructor() {
    this.userDataPath = app.getPath('userData');
    this.settingsPath = path.join(this.userDataPath, 'settings.json');
    this.sessionsPath = path.join(this.userDataPath, 'sessions');
    this.indexPath = path.join(this.userDataPath, 'sessions-index.json');

    // Ensure directories exist
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    try {
      if (!fs.existsSync(this.userDataPath)) {
        fs.mkdirSync(this.userDataPath, { recursive: true });
      }
      if (!fs.existsSync(this.sessionsPath)) {
        fs.mkdirSync(this.sessionsPath, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create storage directories:', error);
    }
  }

  /** Write to a temp file then rename, so a crash mid-write can't corrupt the target. */
  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, data, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  }

  public async getSettings(): Promise<AppSettings> {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = await fs.promises.readFile(this.settingsPath, 'utf8');
        const stored = JSON.parse(data);

        // Decrypt the API key if it was stored encrypted.
        if (stored.apiKeyEnc) {
          try {
            if (safeStorage.isEncryptionAvailable()) {
              stored.apiKey = safeStorage.decryptString(
                Buffer.from(stored.apiKeyEnc, 'base64')
              );
            }
          } catch (error) {
            console.error('Failed to decrypt API key:', error);
          }
          delete stored.apiKeyEnc;
        }

        return { ...this.getDefaultSettings(), ...stored };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }

    return this.getDefaultSettings();
  }

  public async saveSettings(settings: AppSettings): Promise<void> {
    try {
      const toStore: Record<string, unknown> = { ...settings };

      // Encrypt the API key at rest via the OS keychain when available.
      if (settings.apiKey && safeStorage.isEncryptionAvailable()) {
        toStore.apiKeyEnc = safeStorage
          .encryptString(settings.apiKey)
          .toString('base64');
        toStore.apiKey = '';
      }

      await this.atomicWrite(
        this.settingsPath,
        JSON.stringify(toStore, null, 2)
      );
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw new Error('Failed to save settings');
    }
  }

  public async saveSession(session: CheckSession): Promise<void> {
    try {
      const id = sanitizeSessionId(session.id);
      const sessionPath = path.join(this.sessionsPath, `${id}.json`);

      const sessionData = {
        ...session,
        startTime: this.toISO(session.startTime),
        endTime: session.endTime ? this.toISO(session.endTime) : undefined,
        results: (session.results || []).map((result) => ({
          ...result,
          // Preserve the original per-check timestamp; only stamp if missing.
          checkedAt: result.checkedAt
            ? new Date(result.checkedAt).toISOString()
            : new Date().toISOString(),
        })),
      };

      // Heavy results payload: skip pretty-printing to save space/time.
      await this.atomicWrite(sessionPath, JSON.stringify(sessionData));
      await this.upsertIndex(toSessionSummary(session));
    } catch (error) {
      console.error('Failed to save session:', error);
      throw new Error('Failed to save session');
    }
  }

  public async getSession(sessionId: string): Promise<CheckSession | null> {
    try {
      const id = sanitizeSessionId(sessionId);
      const sessionPath = path.join(this.sessionsPath, `${id}.json`);

      if (!fs.existsSync(sessionPath)) {
        return null;
      }

      const data = await fs.promises.readFile(sessionPath, 'utf8');
      const sessionData = JSON.parse(data);
      const results = Array.isArray(sessionData.results)
        ? sessionData.results
        : [];

      return {
        ...sessionData,
        startTime: new Date(sessionData.startTime),
        endTime: sessionData.endTime
          ? new Date(sessionData.endTime)
          : undefined,
        results,
      };
    } catch (error) {
      console.error('Failed to load session:', error);
      return null;
    }
  }

  /**
   * Returns lightweight session summaries for the history list WITHOUT
   * deserializing every session's (potentially huge) results array. Falls back
   * to rebuilding the index from the session files if it does not exist yet.
   */
  public async getSessions(): Promise<SessionSummary[]> {
    try {
      const index = await this.readIndex();
      const summaries = index.length > 0 ? index : await this.rebuildIndex();

      return summaries.sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );
    } catch (error) {
      console.error('Failed to load sessions:', error);
      return [];
    }
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const id = sanitizeSessionId(sessionId);
      const sessionPath = path.join(this.sessionsPath, `${id}.json`);

      await this.removeFromIndex(id);

      if (fs.existsSync(sessionPath)) {
        await fs.promises.unlink(sessionPath);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to delete session:', error);
      return false;
    }
  }

  public async clearAllSessions(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.sessionsPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          await fs.promises.unlink(path.join(this.sessionsPath, file));
        }
      }
      await this.atomicWrite(this.indexPath, JSON.stringify([]));
    } catch (error) {
      console.error('Failed to clear sessions:', error);
      throw new Error('Failed to clear sessions');
    }
  }

  public getStoragePaths(): {
    userDataPath: string;
    settingsPath: string;
    sessionsPath: string;
  } {
    return {
      userDataPath: this.userDataPath,
      settingsPath: this.settingsPath,
      sessionsPath: this.sessionsPath,
    };
  }

  private getDefaultSettings(): AppSettings {
    return {
      apiKey: '',
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 15000,
      throwOnLimit: false,
      concurrentRequests: 1,
      saveResults: true,
      autoExport: false,
      defaultExportFormat: 'json' as const,
      theme: 'light' as const,
    };
  }

  public async getSessionStats(): Promise<{
    totalSessions: number;
    totalNumbersChecked: number;
    totalSuccessful: number;
    totalFailed: number;
    lastCheckDate?: Date;
  }> {
    const sessions = await this.getSessions();

    const stats = {
      totalSessions: sessions.length,
      totalNumbersChecked: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      lastCheckDate: undefined as Date | undefined,
    };

    for (const session of sessions) {
      stats.totalNumbersChecked += session.totalNumbers;
      stats.totalSuccessful += session.successfulChecks;
      stats.totalFailed += session.failedChecks;

      const startTime = new Date(session.startTime);
      if (!stats.lastCheckDate || startTime > stats.lastCheckDate) {
        stats.lastCheckDate = startTime;
      }
    }

    return stats;
  }

  // ---- Session index helpers -------------------------------------------------

  private toISO(value: Date | string): string {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }

  private async readIndex(): Promise<SessionSummary[]> {
    try {
      if (!fs.existsSync(this.indexPath)) return [];
      const data = await fs.promises.readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.error('Failed to read sessions index:', error);
      return [];
    }
  }

  private async writeIndex(summaries: SessionSummary[]): Promise<void> {
    await this.atomicWrite(this.indexPath, JSON.stringify(summaries));
  }

  private async upsertIndex(summary: SessionSummary): Promise<void> {
    const index = await this.readIndex();
    const next = index.filter((s) => s.id !== summary.id);
    next.push(summary);
    await this.writeIndex(next);
  }

  private async removeFromIndex(id: string): Promise<void> {
    const index = await this.readIndex();
    await this.writeIndex(index.filter((s) => s.id !== id));
  }

  /** One-time migration: build the index by scanning existing session files. */
  private async rebuildIndex(): Promise<SessionSummary[]> {
    const files = await fs.promises.readdir(this.sessionsPath);
    const summaries: SessionSummary[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const session = await this.getSession(path.basename(file, '.json'));
      if (session) summaries.push(toSessionSummary(session));
    }

    await this.writeIndex(summaries);
    return summaries;
  }
}
