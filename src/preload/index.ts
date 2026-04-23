import { contextBridge, ipcRenderer } from 'electron';
import { IPC, CDN_BASE } from '../shared/constants';

/** Metadata about the data files served by `loadData`. */
export interface DataMeta {
  /** ms-since-epoch of the data file's last modification. 0 when stat failed. */
  refreshedAt: number;
  /** 'cdn' = pulled by user via Refresh; 'bundled' = shipped with installer. */
  source: 'cdn' | 'bundled';
}

const api = {
  loadData: () => ipcRenderer.invoke(IPC.loadData) as Promise<{
    equipment: unknown[];
    monsters: unknown[];
    spells: unknown[];
    meta: DataMeta;
  }>,
  refreshData: () => ipcRenderer.invoke(IPC.refreshData) as Promise<{ ok: boolean; files: string[] }>,
  cdnImage: (filename: string) => `${CDN_BASE}${encodeURIComponent(filename)}`,
};

contextBridge.exposeInMainWorld('gearscape', api);

export type GearscapeApi = typeof api;
