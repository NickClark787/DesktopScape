import { contextBridge, ipcRenderer } from 'electron';
import { IPC, CDN_BASE } from '../shared/constants';

const api = {
  loadData: () => ipcRenderer.invoke(IPC.loadData) as Promise<{
    equipment: unknown[];
    monsters: unknown[];
    spells: unknown[];
  }>,
  refreshData: () => ipcRenderer.invoke(IPC.refreshData) as Promise<{ ok: boolean; files: string[] }>,
  cdnImage: (filename: string) => `${CDN_BASE}${encodeURIComponent(filename)}`,
};

contextBridge.exposeInMainWorld('gearscape', api);

export type GearscapeApi = typeof api;
