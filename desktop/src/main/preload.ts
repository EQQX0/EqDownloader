import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadItem, Preset, Site } from '@eq/ui/engine';
import type { EqBridge } from '../preload/eq';
import { unwrapEnvelope, type Envelope } from './ipc';

const call = async <T>(channel: string, ...args: unknown[]): Promise<T> =>
  unwrapEnvelope((await ipcRenderer.invoke(channel, ...args)) as Envelope<T>);

const bridge: EqBridge = {
  probe: (url: string) => call('eq:probe', url),
  start: (url: string, preset: Preset, destination: string) => call('eq:start', url, preset, destination),
  cancel: (id: string) => call('eq:cancel', id),
  list: () => call('eq:list'),
  updateEngine: () => call('eq:updateEngine'),
  appVersion: () => call('eq:appVersion'),
  checkAppUpdate: () => call('eq:checkAppUpdate'),
  installAppUpdate: () => call('eq:installAppUpdate'),
  getDefaultFolder: () => call('eq:getDefaultFolder'),
  chooseFolder: () => call('eq:chooseFolder'),
  revealFile: (p: string) => call('eq:revealFile', p),
  openSupport: () => call('eq:openSupport'),
  accountStatus: () => call('eq:accountStatus'),
  signIn: (site: Site) => call('eq:signIn', site),
  signOut: (site: Site) => call('eq:signOut', site),
  onProgress(handler: (item: DownloadItem) => void): () => void {
    const listener = (_e: unknown, item: DownloadItem) => handler(item);
    ipcRenderer.on('eq:progress', listener);
    return () => {
      ipcRenderer.removeListener('eq:progress', listener);
    };
  },
};

contextBridge.exposeInMainWorld('eq', bridge);
