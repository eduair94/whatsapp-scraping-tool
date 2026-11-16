/**
 * The only door between the window and the rest of the app. It runs in a
 * sandbox, so it may import nothing but Electron; every type below is erased
 * at build time.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppInfo,
  ExportFormat,
  ExportScope,
  KeyCheck,
  ParsedList,
  Progress,
  PublicSettings,
  RunEnd,
  Session,
  SessionMeta,
  SettingsPatch,
} from './shared/types';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  info: (): Promise<AppInfo> => ipcRenderer.invoke('app:info'),
  setDemo: (on: boolean): Promise<AppInfo> => ipcRenderer.invoke('app:setDemo', on),
  /** Opens one of the app's own links (the site, the repository, RapidAPI) in the browser. */
  open: (url: string): Promise<void> => ipcRenderer.invoke('app:open', url),
  countries: (): Promise<string[]> => ipcRenderer.invoke('app:countries'),
  /** Opens a website, email address or map location from a business profile. Unsafe addresses are refused. */
  openProfileLink: (kind: 'website' | 'email' | 'map', value: string): Promise<{ opened: boolean; reason?: string }> =>
    ipcRenderer.invoke('app:openProfileLink', kind, value),
  /** Asks where to save a profile picture, then saves it. `name` suggests the file name. */
  savePicture: (url: string, name: string): Promise<{ saved: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('picture:save', url, name),

  settings: {
    get: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: SettingsPatch): Promise<PublicSettings> => ipcRenderer.invoke('settings:update', patch),
    checkKey: (): Promise<KeyCheck> => ipcRenderer.invoke('settings:checkKey'),
  },

  list: {
    openFile: (append = false): Promise<ParsedList | null> => ipcRenderer.invoke('list:openFile', append),
    /** A file dropped on the window. The real path is resolved here, where the File object lives. */
    fromDrop: (file: File, append = false): Promise<ParsedList> =>
      ipcRenderer.invoke('list:fromPath', webUtils.getPathForFile(file), append),
    fromText: (text: string, append = false): Promise<ParsedList> => ipcRenderer.invoke('list:fromText', text, append),
    sample: (count: number): Promise<ParsedList> => ipcRenderer.invoke('list:sample', count),
    current: (): Promise<ParsedList | null> => ipcRenderer.invoke('list:current'),
    clear: (): Promise<void> => ipcRenderer.invoke('list:clear'),
  },

  sessions: {
    all: (): Promise<SessionMeta[]> => ipcRenderer.invoke('sessions:all'),
    get: (id: string): Promise<Session | null> => ipcRenderer.invoke('sessions:get', id),
    create: (name?: string): Promise<SessionMeta> => ipcRenderer.invoke('sessions:create', name),
    update: (id: string, patch: { starred?: boolean; name?: string }): Promise<SessionMeta> =>
      ipcRenderer.invoke('sessions:update', id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('sessions:remove', id),
    /** Asks for confirmation first. Resolves with how many were deleted, or -1 when cancelled. */
    clear: (): Promise<number> => ipcRenderer.invoke('sessions:clear'),
  },

  run: {
    start: (id: string): Promise<{ ok: true } | { ok: false; error: string }> => ipcRenderer.invoke('run:start', id),
    stop: (): Promise<void> => ipcRenderer.invoke('run:stop'),
    current: (): Promise<string | null> => ipcRenderer.invoke('run:current'),
  },

  exportSession: (
    id: string,
    format: ExportFormat,
    scope: ExportScope
  ): Promise<{ saved: boolean; path?: string; rows?: number; error?: string }> =>
    ipcRenderer.invoke('export:session', id, format, scope),
  reveal: (filePath: string): Promise<void> => ipcRenderer.invoke('export:reveal', filePath),

  onProgress: (callback: (progress: Progress) => void) => subscribe('run:progress', callback),
  onEnd: (callback: (end: RunEnd) => void) => subscribe('run:end', callback),
  onMenu: (callback: (command: 'new' | 'open' | 'export' | 'settings') => void) => subscribe('menu', callback),
  onMode: (callback: (info: AppInfo) => void) => subscribe('app:mode', callback),
};

contextBridge.exposeInMainWorld('checker', api);

export type CheckerApi = typeof api;
