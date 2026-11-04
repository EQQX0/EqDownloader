import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadItem, Preset } from '@eq/ui/engine';
import type { EqBridge } from '../preload/eq';

const bridge: EqBridge = {
  probe: (url: string) => ipcRenderer.invoke('eq:probe', url),
  start: (url: string, preset: Preset, destination: string) => ipcRenderer.invoke('eq:start', url, preset, destination),
  cancel: (id: string) => ipcRenderer.invoke('eq:cancel', id),
  list: () => ipcRenderer.invoke('eq:list'),
  updateEngine: () => ipcRenderer.invoke('eq:updateEngine'),
  chooseFolder: () => ipcRenderer.invoke('eq:chooseFolder'),
  revealFile: (p: string) => ipcRenderer.invoke('eq:revealFile', p),
  onProgress(handler: (item: DownloadItem) => void): () => void {
    const listener = (_e: unknown, item: DownloadItem) => handler(item);
    ipcRenderer.on('eq:progress', listener);
    return () => {
      ipcRenderer.removeListener('eq:progress', listener);
    };
  },
};

contextBridge.exposeInMainWorld('eq', bridge);
