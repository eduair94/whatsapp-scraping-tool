import { contextBridge, ipcRenderer } from 'electron';
import {
  AppSettings,
  BulkCheckProgress,
  CheckSession,
  ExportOptions,
  FileParseResult,
  PhoneNumberData,
  RateLimitInfo,
} from './types';

// Channels the renderer is allowed to subscribe to / clear.
const ALLOWED_EVENT_CHANNELS = [
  'file-uploaded',
  'check-progress',
  'check-completed',
  'rate-limit-update',
  'settings-updated',
  'export-completed',
  'show-export-dialog',
];

// Registers a listener and returns an unsubscribe function that removes only
// that specific listener.
function subscribe<T>(
  channel: string,
  callback: (payload: T) => void
): () => void {
  const handler = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler as never);
  return () => ipcRenderer.removeListener(channel, handler as never);
}

// Define the API that will be exposed to the renderer process
const electronAPI = {
  // File operations
  openFileDialog: (): Promise<{
    error?: string;
    numbers?: PhoneNumberData[];
  }> =>
    ipcRenderer.invoke('upload-file').then((result) => {
      if (!result) return { error: 'No file selected' };
      if (result.error) return { error: result.error };
      return { numbers: result.numbers };
    }),

  parseTextInput: (
    textInput: string
  ): Promise<{ error?: string; numbers?: PhoneNumberData[] }> =>
    ipcRenderer.invoke('process-text-input', textInput).then((result) => {
      if (!result) return { error: 'Failed to parse text input' };
      return { numbers: result.numbers, error: result.error };
    }),

  parseDroppedFile: (
    filePath: string
  ): Promise<{ error?: string; numbers?: PhoneNumberData[] }> =>
    ipcRenderer.invoke('parse-file-path', filePath),

  // Generate random phone numbers
  generateRandomNumbers: (
    country: string,
    quantity: number
  ): Promise<{ error?: string; numbers?: PhoneNumberData[] }> =>
    ipcRenderer.invoke('generate-random-numbers', country, quantity),

  // WhatsApp checking operations
  startBulkCheck: (
    phoneNumbers: PhoneNumberData[],
    settings: AppSettings,
    sessionId?: string
  ): Promise<void> =>
    ipcRenderer
      .invoke('start-bulk-check', phoneNumbers, settings, sessionId)
      .then(() => {}),

  cancelCheck: (): Promise<void> => ipcRenderer.invoke('cancel-check'),

  // Settings operations
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),

  updateSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('update-settings', settings),

  // Session operations
  getSessions: (): Promise<CheckSession[]> =>
    ipcRenderer.invoke('get-sessions'),

  getSession: (sessionId: string): Promise<CheckSession | null> =>
    ipcRenderer.invoke('get-session', sessionId),

  saveSession: (session: CheckSession): Promise<void> =>
    ipcRenderer.invoke('save-session', session),

  deleteSession: (sessionId: string): Promise<boolean> =>
    ipcRenderer.invoke('delete-session', sessionId),

  // Export operations
  exportResults: (
    sessionId: string,
    options: ExportOptions
  ): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('export-results', sessionId, options),

  // Event listeners. Each returns an unsubscribe function that removes ONLY
  // the listener it registered (not every listener on the channel), so
  // components can clean up independently without clobbering each other.
  onFileUploaded: (callback: (result: FileParseResult) => void) =>
    subscribe('file-uploaded', callback),

  onCheckProgress: (callback: (progress: BulkCheckProgress) => void) =>
    subscribe('check-progress', callback),

  onCheckCompleted: (callback: (session: CheckSession) => void) =>
    subscribe('check-completed', callback),

  onRateLimitUpdate: (callback: (rateLimitInfo: RateLimitInfo) => void) =>
    subscribe('rate-limit-update', callback),

  onSettingsUpdated: (callback: (settings: AppSettings) => void) =>
    subscribe('settings-updated', callback),

  onExportCompleted: (
    callback: (result: {
      success: boolean;
      filePath?: string;
      error?: string;
    }) => void
  ) => subscribe('export-completed', callback),

  onShowExportDialog: (callback: () => void) =>
    subscribe('show-export-dialog', () => callback()),

  // Remove every listener on a known channel (whitelisted to our own channels).
  removeAllListeners: (channel: string) => {
    if (ALLOWED_EVENT_CHANNELS.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },

  // Utility functions
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  showMessageBox: (
    options: Electron.MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> =>
    ipcRenderer.invoke('show-message-box', options),
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Also expose types for TypeScript support in renderer
export type ElectronAPI = typeof electronAPI;
