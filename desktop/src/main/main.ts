import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DownloadItem, EngineError, Preset } from '@eq/ui/engine';
import { checkDestination, isUnderAny, mergeFolders, parseAllowedFolders, serializeAllowedFolders, toEnvelope } from './ipc';
import { resolveBinaries } from './paths';
import { contentSecurityPolicy, hardenSession, hardenWebContents, windowOptions } from './security';
import { checkAppUpdate, installAppUpdate } from './appupdate';
import { updateYtDlp } from './update';
import { YtDlpEngine } from './ytdlp';

export { contentSecurityPolicy, hardenSession, hardenWebContents, windowOptions };

const PRESETS: readonly Preset[] = ['best', '1080p', '720p', 'mp3', 'm4a'];

function createEngine(): YtDlpEngine {
  const userDataDir = app.getPath('userData');
  const bundled = { packaged: app.isPackaged, userDataDir };
  // Re-resolved on every spawn so a fresh update takes effect without restarting.
  const opts = {
    get ytdlpPath() {
      return resolveBinaries(bundled).ytdlpPath;
    },
    get ffmpegPath() {
      return resolveBinaries(bundled).ffmpegPath;
    },
    updater: () => updateYtDlp({ userDataDir }),
  };
  return new YtDlpEngine(opts);
}

function uiEntry(): string {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'ui', 'index.html'),
    path.join(__dirname, '..', '..', 'ui', 'dist', 'index.html'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return path.join(__dirname, '..', 'src', 'renderer', 'fallback.html');
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw { code: 'unknown', message: `Invalid ${name}` } satisfies EngineError;
  return v;
}

function registerIpc(engine: YtDlpEngine, getWindow: () => BrowserWindow | null): void {
  // Folders the renderer may write to: the default Downloads folder plus whatever the user picked.
  // Picked folders persist across restarts; only the eq:chooseFolder handler (dialog result) ever writes the file.
  const storeFile = path.join(app.getPath('userData'), 'allowed-folders.json');
  const isDir = (p: string): boolean => fs.statSync(p).isDirectory();
  let saved: string | null = null;
  try {
    saved = fs.readFileSync(storeFile, 'utf8');
  } catch {
    // First run or unreadable: start with the default folder only.
  }
  const defaultDir = path.join(app.getPath('downloads'), 'EqDownload');
  let allowed: string[] = mergeFolders([defaultDir, app.getPath('downloads')], parseAllowedFolders(saved, isDir));
  const handle = (channel: string, fn: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (_e, ...args) => toEnvelope(() => fn(...args) as Promise<unknown>));
  };

  handle('eq:probe', (url) => engine.probe(str(url, 'url')));
  handle('eq:start', (url, preset, destination) => {
    if (!PRESETS.includes(preset as Preset)) throw { code: 'unknown', message: 'Invalid preset' } satisfies EngineError;
    const dest = checkDestination(destination, allowed);
    return engine.start(str(url, 'url'), preset as Preset, dest);
  });
  handle('eq:cancel', (id) => engine.cancel(str(id, 'id')));
  handle('eq:list', () => engine.list());
  handle('eq:updateEngine', () => engine.updateEngine());
  handle('eq:appVersion', () => app.getVersion());
  handle('eq:checkAppUpdate', () => checkAppUpdate(app.getVersion()));
  handle('eq:installAppUpdate', async () => {
    const v = await installAppUpdate({ current: app.getVersion(), target: process.env.PORTABLE_EXECUTABLE_FILE, tmpDir: app.getPath('temp') });
    setTimeout(() => app.quit(), 800);
    return v;
  });
  handle('eq:getDefaultFolder', () => {
    fs.mkdirSync(defaultDir, { recursive: true });
    return defaultDir;
  });
  handle('eq:chooseFolder', async () => {
    const win = getWindow();
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const picked = r.canceled ? null : (r.filePaths[0] ?? null);
    if (picked) {
      allowed = mergeFolders(allowed, [picked]);
      try {
        fs.writeFileSync(storeFile, serializeAllowedFolders(allowed.filter((f) => f !== app.getPath('downloads') && f !== defaultDir)));
      } catch {
        // Not persisted; the folder still works until the app closes.
      }
    }
    return picked;
  });
  handle('eq:revealFile', (p) => {
    const file = str(p, 'path');
    if (!isUnderAny(file, allowed)) {
      throw { code: 'disk', message: 'That file is outside the download folders' } satisfies EngineError;
    }
    shell.showItemInFolder(file);
  });
  engine.onProgress((item: DownloadItem) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('eq:progress', item);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow(windowOptions());
  hardenWebContents(win.webContents);
  win.once('ready-to-show', () => win.show());
  void win.loadFile(uiEntry());
  return win;
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  hardenSession(ses);
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy()] } });
  });
}

/** The packaged exe is a GUI-subsystem program, so CI cannot read its pipes; EQ_SMOKE_LOG also gets a copy of every line. */
function smokeOut(line: string): void {
  process.stderr.write(line);
  const log = process.env.EQ_SMOKE_LOG;
  if (log) {
    try {
      fs.appendFileSync(log, line);
    } catch {
      /* the log is a CI convenience only */
    }
  }
}

/** `EqDownload.exe --smoke <url>`: headless download with the packaged engine; exit 0 only if a non-empty file landed. */
async function runSmoke(url: string): Promise<number> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqdownload-smoke-'));
  const engine = createEngine();
  try {
    const done = new Promise<DownloadItem>((resolve) => {
      engine.onProgress((item) => {
        if (item.state === 'done' || item.state === 'failed' || item.state === 'cancelled') resolve(item);
      });
    });
    await engine.start(url, 'best', dir);
    const item = await done;
    if (item.state !== 'done') {
      smokeOut(`smoke failed: ${item.error ? `${item.error.code}: ${item.error.message}` : item.state}\n`);
      return 1;
    }
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
    const sizes = files.map((f) => fs.statSync(path.join(dir, f)).size);
    if (files.length === 0 || !sizes.some((s) => s > 0)) {
      smokeOut('smoke failed: no non-empty file was produced\n');
      return 1;
    }
    smokeOut(`smoke ok: ${files.map((f, i) => `${f} (${sizes[i]} bytes)`).join(', ')}\n`);
    return 0;
  } catch (e) {
    const err = e as Partial<EngineError>;
    smokeOut(`smoke failed: ${err.code ?? 'error'}: ${err.message ?? String(e)}\n`);
    return 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `EqDownload.exe --ui-check`: loads the real UI hidden, exactly as production does, and checks it rendered without console errors or CSP violations. */
async function runUiCheck(): Promise<number> {
  const entry = uiEntry();
  if (path.basename(path.dirname(entry)) === 'renderer') {
    process.stderr.write(`ui-check failed: real UI not found, would load fallback (${entry})
`);
    return 1;
  }
  lockDownSession();
  const win = new BrowserWindow({ ...windowOptions(), show: false });
  hardenWebContents(win.webContents);
  registerIpc(createEngine(), () => win); // same handlers as production, so the UI start-up calls succeed
  const problems: string[] = [];
  win.webContents.on('console-message', (...args: unknown[]) => {
    const first = args[0] as { level?: unknown; message?: unknown } | undefined;
    const isEvent = first && typeof first === 'object' && 'message' in first;
    const level = isEvent ? first.level : args[1];
    const message = String(isEvent ? first.message : args[2]);
    // Chromium ignores frame-ancestors in a <meta> CSP and says so. The same policy also arrives as a header, which honours it.
    if (/'frame-ancestors' is ignored when delivered via a <meta>/.test(message)) return;
    if (level === 'error' || level === 'warning' || level === 2 || level === 3 || /Content Security Policy|Refused to/i.test(message)) {
      problems.push(message);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => problems.push(`load failed ${code} ${desc} ${url}`));
  try {
    await win.loadFile(entry);
    const probe = `({
      link: !!document.querySelector('[data-testid="link-input"]'),
      nav: !!document.querySelector('[data-testid="nav-home"]'),
      bridge: typeof window.eq === 'object',
    })`;
    let seen = { link: false, nav: false, bridge: false };
    for (let i = 0; i < 50 && !(seen.link && seen.nav); i++) {
      seen = await win.webContents.executeJavaScript(probe);
      if (!(seen.link && seen.nav)) await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 300));
    if (!seen.link) problems.push('link-input not found');
    if (!seen.nav) problems.push('nav-home not found');
    if (!seen.bridge) problems.push('window.eq bridge missing');
    if (problems.length) {
      process.stderr.write(`ui-check failed: ${problems.join(' | ')}
`);
      return 1;
    }
    process.stdout.write(`ui-check ok: ${entry}
`);
    return 0;
  } catch (e) {
    process.stderr.write(`ui-check failed: ${e instanceof Error ? e.message : String(e)}
`);
    return 1;
  } finally {
    win.destroy();
  }
}

function boot(): void {
  if (process.argv.includes('--ui-check')) {
    void app.whenReady().then(async () => app.exit(await runUiCheck()));
    return;
  }

  const smokeIdx = process.argv.indexOf('--smoke');
  if (smokeIdx !== -1) {
    const url = process.argv[smokeIdx + 1];
    void app.whenReady().then(async () => {
      if (!url) {
        process.stderr.write('smoke failed: --smoke needs a URL\n');
        app.exit(1);
        return;
      }
      app.exit(await runSmoke(url));
    });
    return;
  }

  // One instance only, so a second copy cannot race the staging-folder sweep.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  let win: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(() => {
    lockDownSession();
    registerIpc(createEngine(), () => win);
    win = createWindow();
    win.on('closed', () => {
      win = null;
    });
  });
  app.on('window-all-closed', () => app.quit());
}

// Under vitest the module is only imported for its pure exports.
if (process.versions.electron) boot();
