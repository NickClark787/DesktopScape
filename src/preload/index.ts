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
  /** Live GE prices (latest high/low per item id) from the OSRS Wiki API. */
  fetchPrices: () => ipcRenderer.invoke(IPC.fetchPrices) as Promise<{
    ok: boolean;
    prices: Record<string, { high: number | null; low: number | null }>;
  }>,
  /**
   * Resolve an OSRS Wiki CDN URL for a sprite. The CDN segregates assets by
   * kind — equipment sprites live under `/equipment/`, monster sprites under
   * `/monsters/` — so the caller must say which it wants. Filenames already
   * include the `.png` extension.
   */
  cdnImage: (filename: string, kind: 'equipment' | 'monsters') =>
    `${CDN_BASE}${kind}/${encodeURIComponent(filename)}`,
};

contextBridge.exposeInMainWorld('gearscape', api);

export type GearscapeApi = typeof api;
