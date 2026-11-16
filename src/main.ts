/**
 * The Electron side: one window, the menu, native dialogs, and the bridge to
 * `Backend`, which holds all behaviour. Nothing in here decides anything about
 * numbers, sessions or the API.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  MenuItemConstructorOptions,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
} from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { Backend } from './core/backend';
import { createDemoFetch } from './core/demo';
import { SUPPORTED_EXTENSIONS } from './core/inputFiles';
import { scrubKey } from './core/legacy';
import { supportedCountries } from './core/phone';
import { KeyCodec } from './core/settingsStore';
import { GUIDE_URL, KEY_URL, OPT_OUT_URL, REPO_URL } from './shared/links';
import { AppInfo, ExportFormat, ExportScope, Progress, SettingsPatch } from './shared/types';

/** Links the window may open in the browser. Anything else is ignored. */
const ALLOWED_LINK = /^https:\/\/(whatsapp\.checkleaked\.cc|whatsapp-db\.checkleaked\.com|github\.com\/eduair94|rapidapi\.com\/airaudoeduardo)(\/|$)/;

/**
 * The window is served from app://window/, a secure origin of its own. Packaged
 * builds turn off file://'s extra privileges (a security fuse), and a page on
 * plain file:// has no origin its content security policy could call 'self'.
 */
const WINDOW_URL = 'app://window/index.html';
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Answers app://window/<file> from the built window folder, and nothing outside it. */
function serveWindow(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const file = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(url.pathname)));
    if (url.host !== 'window' || !file.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const smokeFile = arg('smoke');
/** Development only: `npm run screenshots` drives the demo and saves the guide's pictures. */
const screenshotsDir = app.isPackaged ? undefined : arg('screenshots');
if (screenshotsDir) {
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  app.commandLine.appendSwitch('lang', 'en-US');
  // Keep painting while other windows cover this one, or captures come back stale.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

let demo = process.argv.includes('--demo') || Boolean(screenshotsDir);
let win: BrowserWindow | null = null;
let backend: Backend | null = null;
let quitting = false;
let switching = false;
/** The latest progress of the running check, for the screenshot run. */
let lastProgress: Progress | null = null;

if (!app.requestSingleInstanceLock()) app.quit();

const windowTitle = (): string => (demo ? 'WhatsApp Number Checker (demo)' : 'WhatsApp Number Checker');

/** The operating system keeps the key: DPAPI on Windows, Keychain on macOS, a keyring on Linux. */
async function keyCodec(): Promise<KeyCodec> {
  let available = false;
  try {
    available = await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    available = false;
  }
  // Without a keyring, Linux falls back to a password built into every copy
  // of Chromium, which protects nothing.
  if (available && process.platform === 'linux') {
    const backendName = safeStorage.getSelectedStorageBackend?.() ?? 'unknown';
    available = !['basic_text', 'unknown'].includes(backendName);
  }
  return {
    available: () => available,
    encrypt: async (plain) => (await safeStorage.encryptStringAsync(plain)).toString('base64'),
    decrypt: async (stored) => (await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'))).result,
  };
}

function systemCountry(): string {
  const code = app.getLocaleCountryCode?.() ?? '';
  return supportedCountries().includes(code) ? code : 'US';
}

const send = (channel: string, payload?: unknown): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/** Builds the backend for the current mode. Demo data lives apart from the real data, in a temp folder. */
async function startBackend(): Promise<void> {
  const userData = app.getPath('userData');
  let dataDir = userData;
  if (demo) {
    dataDir =
      screenshotsDir || smokeFile
        ? await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wnc-check-'))
        : path.join(app.getPath('temp'), 'whatsapp-number-checker-demo');
  }
  await fs.promises.mkdir(dataDir, { recursive: true });

  // People who ran version 1 from source have their data under the old app name.
  const oldHome = path.join(app.getPath('appData'), 'whatsapp-scrapping-tool');
  if (!demo) {
    const settingsFile = path.join(userData, 'settings.json');
    const oldSettings = path.join(oldHome, 'settings.json');
    if (!fs.existsSync(settingsFile) && fs.existsSync(oldSettings)) {
      await fs.promises.copyFile(oldSettings, settingsFile).catch(() => undefined);
    }
  }

  backend = new Backend({
    dataDir,
    codec: await keyCodec(),
    systemCountry: systemCountry(),
    demo,
    // The guide's pictures need lists of thousands in seconds: there the simulated
    // API answers at once and the pace comes from the settings, like a real run.
    fetch: demo ? createDemoFetch(screenshotsDir ? { latency: false, minGapMs: 0 } : {}) : undefined,
    gapMs: demo && !screenshotsDir ? 140 : undefined,
    legacySessionDirs: demo ? [] : [path.join(userData, 'sessions'), path.join(oldHome, 'sessions')],
    onProgress: (progress) => {
      lastProgress = progress;
      send('run:progress', progress);
    },
    onEnd: (end) => send('run:end', end),
  });
  await backend.init();
  // Version 1 kept the key in plain text in its own settings file. It now lives
  // encrypted in the new settings (or in memory only), so it leaves the old file.
  if (!demo) await scrubKey(path.join(oldHome, 'settings.json'));
  nativeTheme.themeSource = backend.getSettings().theme;
}

const info = (): AppInfo => ({ version: app.getVersion(), platform: process.platform, demo });

/** Turns demo mode on or off in place. No restart: a portable build deletes itself when it exits. */
async function setDemo(on: boolean): Promise<AppInfo> {
  if (on === demo || switching || !win) return info();
  if (backend?.runningSessionId && !smokeFile && !screenshotsDir) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: [on ? 'Stop and open the demo' : 'Stop and leave the demo', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'A check is running.',
      detail: 'It stops here with its progress saved. You can continue it later.',
    });
    if (response !== 0) return info();
  }
  switching = true;
  try {
    await backend?.shutdown();
    demo = on;
    await startBackend();
    buildMenu();
    win.setTitle(windowTitle());
    send('app:mode', info());
  } finally {
    switching = false;
  }
  return info();
}

// ── Window ─────────────────────────────────────────────────────────────────

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: windowTitle(),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1826' : '#eef5f1',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: !screenshotsDir,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // The window keeps the app's name (and "(demo)"), not the page's title.
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win?.setTitle(windowTitle());
  });
  win.on('closed', () => {
    win = null;
  });

  // A local single-page app: it never navigates away and never opens windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (ALLOWED_LINK.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (smokeFile) win.webContents.once('did-finish-load', () => void smokeTest());
  if (screenshotsDir) {
    win.webContents.once('did-finish-load', async () => {
      try {
        const script = path.join(__dirname, '..', '..', 'scripts', 'screenshots.mjs');
        // A real dynamic import: TypeScript would otherwise turn it into require().
        const load = new Function('url', 'return import(url)') as (url: string) => Promise<{ capture: (o: unknown) => Promise<void> }>;
        const { capture } = await load(pathToFileURL(script).href);
        await capture({
          win,
          dir: path.resolve(screenshotsDir),
          backend: () => backend,
          progress: () => lastProgress,
          theme: (source: 'system' | 'light' | 'dark') => {
            nativeTheme.themeSource = source;
          },
        });
        app.exit(0);
      } catch (err) {
        console.error(err);
        app.exit(1);
      }
    });
  }

  void win.loadURL(WINDOW_URL);
}

/**
 * `--smoke=<file>`: checks that the window shows the app, switches to demo
 * mode and uses it like a person would (sample numbers, a whole check, the
 * table, an export), writes what it saw to <file> and quits. Release builds
 * run this on every system before they are published.
 */
const SMOKE_PAGE = `(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (test, what) => {
    for (let i = 0; i < 600; i++) {
      const value = test();
      if (value) return value;
      await sleep(100);
    }
    throw new Error('timed out waiting for ' + what);
  };
  const button = (label) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label && !b.disabled);

  await until(() => document.querySelector('[data-demo]'), 'demo mode');
  const count = await until(() => document.getElementById('sample-count'), 'the sample numbers field');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(count, '12');
  count.dispatchEvent(new Event('input', { bubbles: true }));
  (await until(() => button('Use sample numbers'), 'the sample numbers button')).click();
  (await until(() => button('Start check'), 'the start button')).click();
  await until(() => {
    const status = document.querySelector('.status b');
    return status && status.textContent === 'Complete.';
  }, 'the end of the check');
  return {
    rows: document.querySelectorAll('[data-row]').length,
    marked: document.querySelectorAll('[data-row] .mark:not(.mark-pending)').length,
    strip: Boolean(document.querySelector('.strip canvas')),
    font: document.fonts.check('600 14px "Figtree Variable"'),
  };
})()`;

async function smokeTest(): Promise<void> {
  let result: Record<string, unknown> = {};
  try {
    const page = (code: string) => win!.webContents.executeJavaScript(code, true);
    result = await page(`(async () => {
      for (let i = 0; i < 80 && !document.querySelector('[data-ready]'); i++) await new Promise(r => setTimeout(r, 100));
      return { ready: Boolean(document.querySelector('[data-ready]')), bridge: typeof window.checker, title: document.title };
    })()`);
    result.windowTitle = win!.getTitle();
    result.keyStorage = (await keyCodec()).available();
    result.canStoreKey = backend!.getSettings().canStoreKey;
    if (!demo) await setDemo(true);
    result.demoTitle = win!.getTitle();

    const seen = (await page(SMOKE_PAGE)) as Record<string, unknown>;
    const [meta] = await backend!.listSessions();
    const out = path.join(os.tmpdir(), `wnc-smoke-${process.pid}.xlsx`);
    const exported = await backend!.exportSession(meta.id, 'xlsx', 'all', out);
    const size = (await fs.promises.stat(out)).size;
    await fs.promises.rm(out, { force: true });
    result.demo = {
      ...seen,
      status: meta.status,
      checked: meta.counts.checked,
      onWhatsApp: meta.counts.on_whatsapp,
      exportedRows: exported.rows,
      exportBytes: size > 2000,
      key: (await backend!.checkKey()).ok,
    };
  } catch (err) {
    result.error = String(err);
  }
  await fs.promises.writeFile(smokeFile!, JSON.stringify(result));
  app.exit(result.error ? 1 : 0);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Check', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'new') },
        { label: 'Open a List…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open') },
        { type: 'separator' },
        { label: 'Export Results…', accelerator: 'CmdOrCtrl+E', click: () => send('menu', 'export') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('menu', 'settings') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'User Guide', click: () => void shell.openExternal(GUIDE_URL) },
        { label: 'Get an API Key', click: () => void shell.openExternal(KEY_URL) },
        demo
          ? { label: 'Leave Demo Mode', click: () => void setDemo(false) }
          : { label: 'Try the Demo (No Key Needed)', click: () => void setDemo(true) },
        { type: 'separator' },
        { label: 'Source Code', click: () => void shell.openExternal(REPO_URL) },
        { label: 'Privacy Opt-out Page', click: () => void shell.openExternal(OPT_OUT_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── The bridge: only the app's own window may ask ──────────────────────────

type Handler = (...args: never[]) => unknown;

function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!win || event.sender !== win.webContents) throw new Error('Not allowed');
    if (!backend) throw new Error('The app is still starting.');
    return (handler as (...a: unknown[]) => unknown)(...args);
  });
}

const b = (): Backend => backend!;
const str = (value: unknown, max = 5_000_000): string => String(value ?? '').slice(0, max);

handle('app:info', () => info());
handle('app:setDemo', (on: boolean) => setDemo(Boolean(on)));
handle('app:open', (url: string) => {
  if (typeof url === 'string' && ALLOWED_LINK.test(url)) void shell.openExternal(url);
});
handle('app:countries', () => supportedCountries());

handle('settings:get', () => b().getSettings());
handle('settings:update', async (patch: SettingsPatch) => {
  const next = await b().updateSettings(patch ?? {});
  nativeTheme.themeSource = next.theme;
  return next;
});
handle('settings:checkKey', () => b().checkKey());

handle('list:openFile', async (append: boolean) => {
  const result = await dialog.showOpenDialog(win!, {
    title: 'Open a list of numbers',
    properties: ['openFile'],
    filters: [
      { name: 'Lists (CSV, Excel, text)', extensions: SUPPORTED_EXTENSIONS.map((e) => e.slice(1)) },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return b().listFromFile(result.filePaths[0], Boolean(append));
});
handle('list:fromPath', (filePath: string, append: boolean) => b().listFromFile(str(filePath, 4096), Boolean(append)));
handle('list:fromText', (text: string, append: boolean) => b().listFromText(str(text), Boolean(append)));
handle('list:sample', (count: number) => b().listFromSample(Number(count)));
handle('list:current', () => b().currentList());
handle('list:clear', () => b().clearList());

handle('sessions:all', () => b().listSessions());
handle('sessions:get', (id: string) => b().getSession(str(id, 100)));
handle('sessions:create', (name?: string) => b().createSession(typeof name === 'string' ? name : undefined));
handle('sessions:update', (id: string, patch: { starred?: boolean; name?: string }) => b().updateSession(str(id, 100), patch ?? {}));
handle('sessions:remove', (id: string) => b().removeSession(str(id, 100)));
handle('sessions:clear', async () => {
  const { response } = await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: ['Delete every list', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Delete every list and its results?',
    detail: 'This cannot be undone. Files you exported are not touched.',
  });
  return response === 0 ? b().clearSessions() : -1;
});

handle('run:start', (id: string) => b().startRun(str(id, 100)));
handle('run:stop', () => b().stopRun());
handle('run:current', () => b().runningSessionId);

handle('export:session', async (id: string, format: ExportFormat, scope: ExportScope) => {
  const sessionId = str(id, 100);
  const defaultName = await b().suggestedExportName(sessionId, format);
  const names: Record<ExportFormat, string> = { csv: 'CSV', xlsx: 'Excel workbook', json: 'JSON' };
  const result = await dialog.showSaveDialog(win!, {
    title: 'Export results',
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: names[format] ?? 'File', extensions: [format] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  const filePath = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`;
  try {
    const { rows } = await b().exportSession(sessionId, format, scope, filePath);
    return { saved: true, path: filePath, rows };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    const busy = ['EBUSY', 'EPERM', 'EACCES'].includes(code);
    return {
      saved: false,
      error: busy
        ? 'That file is open in another program. Close it, or choose another name.'
        : `Could not save the file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
});
handle('export:reveal', (filePath: string) => shell.showItemInFolder(str(filePath, 4096)));

// ── Pictures and profile links ─────────────────────────────────────────────

/** The API's picture server, and the drawings of demo mode. No other picture is fetched or saved. */
const PICTURE_URL = /^https:\/\/whatsapp-db\.checkleaked\.com\/[\w.-]+\.(jpe?g|png|webp)(\?[\w=&.%-]*)?$/i;
const DEMO_PICTURE = /^data:image\/(svg\+xml|png|jpeg|webp)(;base64)?(;utf8)?,/i;
const PICTURE_EXTENSION: Record<string, string> = { 'svg+xml': 'svg', png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp' };
const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

function picturesFolder(): string {
  try {
    return app.getPath('pictures');
  } catch {
    return app.getPath('documents');
  }
}

/** The file type a picture will be saved as, before anything is downloaded. */
function pictureExtension(url: string): string | null {
  const demoMatch = url.match(DEMO_PICTURE);
  if (demoMatch) return PICTURE_EXTENSION[demoMatch[1].toLowerCase()] ?? null;
  const match = url.match(PICTURE_URL);
  return match ? (PICTURE_EXTENSION[match[1].toLowerCase()] ?? 'jpg') : null;
}

async function pictureBytes(url: string): Promise<Buffer> {
  const demoMatch = url.match(DEMO_PICTURE);
  if (demoMatch) {
    const data = url.slice(url.indexOf(',') + 1);
    return demoMatch[2] ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
  }
  const response = await net.fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`the picture server answered ${response.status}`);
  if (!(response.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('the picture server sent something else');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PICTURE_BYTES) throw new Error('the picture is too large');
  return bytes;
}

/**
 * A website, email address or map location from someone's business profile,
 * as an address the browser or mail app can open. Profiles are written by
 * strangers, so only plain web and mail addresses get through: no other
 * scheme, no embedded credentials, nothing longer than a sane address.
 */
function profileLink(kind: string, raw: string): { url?: string; reason?: string } {
  const value = raw.trim();
  if (!value || value.length > 2000 || /\s/.test(value)) return { reason: 'This is not an address that can be opened.' };
  if (kind === 'website') {
    let url: URL;
    try {
      url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    } catch {
      return { reason: 'This is not a web address that can be opened.' };
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) {
      return { reason: 'Only plain web addresses are opened.' };
    }
    if (url.hostname.endsWith('.example')) return { reason: 'This website belongs to the demo and does not exist.' };
    return { url: url.toString() };
  }
  if (kind === 'email') {
    if (!/^[^@<>()"',;:]+@[^@<>()"',;:]+\.[^@<>()"',;:]+$/.test(value)) return { reason: 'This is not an email address.' };
    if (value.endsWith('.example')) return { reason: 'This email address belongs to the demo and does not exist.' };
    return { url: `mailto:${value}` };
  }
  if (kind === 'map') {
    const [lat, lng] = value.split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return { reason: 'This is not a place on the map.' };
    }
    return { url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` };
  }
  return { reason: 'This kind of link is not opened.' };
}

handle('app:openProfileLink', (kind: string, value: string) => {
  const link = profileLink(str(kind, 20), str(value, 2001));
  if (!link.url) return { opened: false, reason: link.reason };
  void shell.openExternal(link.url);
  return { opened: true };
});

handle('picture:save', async (url: string, name: string) => {
  const source = str(url, 300_000);
  const extension = pictureExtension(source);
  if (!extension) return { saved: false, error: 'This picture is not from the API picture server, so it is not saved.' };
  const base = str(name, 80).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'picture';
  const result = await dialog.showSaveDialog(win!, {
    title: 'Save the profile picture',
    defaultPath: path.join(picturesFolder(), `${base}.${extension}`),
    filters: [{ name: 'Picture', extensions: [extension] }],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  try {
    await fs.promises.writeFile(result.filePath, await pictureBytes(source));
    return { saved: true, path: result.filePath };
  } catch (err) {
    return { saved: false, error: `Could not save the picture: ${err instanceof Error ? err.message : String(err)}.` };
  }
});

// ── Start-up and shut-down ─────────────────────────────────────────────────

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app
  .whenReady()
  .then(async () => {
    serveWindow();
    await startBackend();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err) => {
    dialog.showErrorBox('WhatsApp Number Checker could not start', String(err instanceof Error ? err.message : err));
    app.exit(1);
  });

app.on('before-quit', (event) => {
  if (quitting || !backend?.runningSessionId) return;
  // Stop the check cleanly so its progress is saved, then quit.
  event.preventDefault();
  quitting = true;
  void Promise.race([backend.shutdown(), new Promise((resolve) => setTimeout(resolve, 5000))]).then(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
