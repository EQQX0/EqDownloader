import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DownloadItem, EngineError, Preset } from '@eq/ui/engine';
import { resolveBinaries } from './paths';
import { contentSecurityPolicy, hardenWebContents, windowOptions } from './security';
import { updateYtDlp } from './update';
import { YtDlpEngine } from './ytdlp';

export { contentSecurityPolicy, hardenWebContents, windowOptions };

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
  ipcMain.handle('eq:probe', (_e, url) => engine.probe(str(url, 'url')));
  ipcMain.handle('eq:start', (_e, url, preset, destination) => {
    if (!PRESETS.includes(preset as Preset)) throw { code: 'unknown', message: 'Invalid preset' } satisfies EngineError;
    const dest = str(destination, 'destination');
    if (!path.isAbsolute(dest)) throw { code: 'disk', message: 'Destination must be an absolute path' } satisfies EngineError;
    return engine.start(str(url, 'url'), preset as Preset, dest);
  });
  ipcMain.handle('eq:cancel', (_e, id) => engine.cancel(str(id, 'id')));
  ipcMain.handle('eq:list', () => engine.list());
  ipcMain.handle('eq:updateEngine', () => engine.updateEngine());
  ipcMain.handle('eq:chooseFolder', async () => {
    const win = getWindow();
    const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });
  ipcMain.handle('eq:revealFile', (_e, p) => {
    const file = str(p, 'path');
    if (path.isAbsolute(file)) shell.showItemInFolder(file);
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
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy()] } });
  });
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
      process.stderr.write(`smoke failed: ${item.error ? `${item.error.code}: ${item.error.message}` : item.state}\n`);
      return 1;
    }
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
    const sizes = files.map((f) => fs.statSync(path.join(dir, f)).size);
    if (files.length === 0 || !sizes.some((s) => s > 0)) {
      process.stderr.write('smoke failed: no non-empty file was produced\n');
      return 1;
    }
    process.stdout.write(`smoke ok: ${files.map((f, i) => `${f} (${sizes[i]} bytes)`).join(', ')}\n`);
    return 0;
  } catch (e) {
    const err = e as Partial<EngineError>;
    process.stderr.write(`smoke failed: ${err.code ?? 'error'}: ${err.message ?? String(e)}\n`);
    return 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function boot(): void {
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
