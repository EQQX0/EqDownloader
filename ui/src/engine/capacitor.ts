import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { DownloadItem, Engine, EngineError, EngineErrorCode, Preset, ProbeResult } from './types';

/** Wire shape of the Kotlin `EqEngine` plugin (app.eqdownload.EqEnginePlugin). */
export interface EqEnginePlugin {
  probe(opts: { url: string }): Promise<ProbeResult>;
  start(opts: { url: string; preset: Preset; destination: string }): Promise<{ id: string }>;
  cancel(opts: { id: string }): Promise<void>;
  list(): Promise<{ items: DownloadItem[] }>;
  updateEngine(): Promise<{ version: string }>;
  appVersion(): Promise<{ version: string }>;
  checkAppUpdate(): Promise<{ version: string | null }>;
  installAppUpdate(): Promise<{ version: string }>;
  readClipboard(): Promise<{ text: string }>;
  openSupport(): Promise<void>;
  addListener(event: 'progress', cb: (item: DownloadItem) => void): Promise<PluginListenerHandle>;
  addListener(event: 'share', cb: (data: { text: string }) => void): Promise<PluginListenerHandle>;
}

/** Files on Android always end up here (MediaStore, Download/EqDownload); the destination argument is ignored. */
export const ANDROID_DESTINATION = 'Downloads/EqDownload';

const CODES: readonly EngineErrorCode[] = ['unsupported', 'blocked', 'network', 'outdated', 'disk', 'unknown'];

/** Maps whatever a Capacitor call rejected with to an EngineError; unknown codes become `unknown`. */
export function toEngineError(e: unknown): EngineError {
  const o = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; message?: unknown };
  const code = CODES.find((c) => c === o.code) ?? 'unknown';
  const message =
    typeof o.message === 'string' && o.message ? o.message : typeof e === 'string' && e ? e : 'Something went wrong.';
  return { code, message };
}

async function call<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    throw toEngineError(e);
  }
}

/** Subscribes to a plugin event with a synchronous unsubscribe (the plugin hands back the handle asynchronously). */
function listen<T>(register: (cb: (v: T) => void) => Promise<PluginListenerHandle>, handler: (v: T) => void): () => void {
  let live = true;
  const handle = register((v) => {
    if (live) handler(v);
  });
  return () => {
    live = false;
    void handle.then((h) => h.remove()).catch(() => {});
  };
}

let registered: EqEnginePlugin | undefined;
/** registerPlugin may run only once per name, so the native proxy is created lazily and shared. */
function nativePlugin(): EqEnginePlugin {
  return (registered ??= registerPlugin<EqEnginePlugin>('EqEngine'));
}

export class CapacitorEngine implements Engine {
  private readonly plugin: EqEnginePlugin;

  constructor(plugin?: EqEnginePlugin) {
    this.plugin = plugin ?? nativePlugin();
  }

  probe(url: string): Promise<ProbeResult> {
    return call(this.plugin.probe({ url }));
  }

  async start(url: string, preset: Preset, destination: string): Promise<string> {
    return (await call(this.plugin.start({ url, preset, destination }))).id;
  }

  cancel(id: string): Promise<void> {
    return call(this.plugin.cancel({ id }));
  }

  async list(): Promise<DownloadItem[]> {
    return (await call(this.plugin.list())).items;
  }

  async updateEngine(): Promise<string> {
    return (await call(this.plugin.updateEngine())).version;
  }

  async appVersion(): Promise<string> {
    return (await call(this.plugin.appVersion())).version;
  }

  async checkAppUpdate(): Promise<{ version: string } | null> {
    const v = (await call(this.plugin.checkAppUpdate())).version;
    return v ? { version: v } : null;
  }

  async installAppUpdate(): Promise<string> {
    return (await call(this.plugin.installAppUpdate())).version;
  }

  onProgress(handler: (item: DownloadItem) => void): () => void {
    return listen((cb) => this.plugin.addListener('progress', cb), handler);
  }

  openSupport(): Promise<void> {
    return call(this.plugin.openSupport());
  }

  /** The clipboard text, read natively because a web view is not allowed to read it without a prompt. */
  async readClipboard(): Promise<string> {
    try {
      return (await this.plugin.readClipboard()).text;
    } catch {
      return '';
    }
  }

  /** Text shared to the app from another app's Share sheet. */
  onShare(handler: (text: string) => void): () => void {
    return listen<{ text: string }>((cb) => this.plugin.addListener('share', cb), (d) => handler(d.text));
  }

  async getDefaultFolder(): Promise<string> {
    return ANDROID_DESTINATION;
  }
}
