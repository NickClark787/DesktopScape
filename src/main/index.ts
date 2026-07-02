import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { IPC, CDN_JSON, PRICES_API, WIKI_API_USER_AGENT } from '../shared/constants';
import { patchEquipmentData } from '../shared/dataPatches';
import type { EquipmentPiece } from '../shared/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL;

function dataDir() {
  // Prefer userData for refreshed data; fall back to bundled.
  return app.getPath('userData');
}

function bundledDataPath(file: string): string {
  // electron-builder extraResources puts data/ into resources/.
  const packaged = join(process.resourcesPath, 'data', file);
  if (existsSync(packaged)) return packaged;
  // Dev: resources/data relative to repo root.
  return join(__dirname, '..', '..', 'resources', 'data', file);
}

async function readDataFile(file: string): Promise<string> {
  const cached = join(dataDir(), 'osrs-data', file);
  if (existsSync(cached)) {
    try { return await readFile(cached, 'utf8'); } catch { /* fallthrough */ }
  }
  return await readFile(bundledDataPath(file), 'utf8');
}

/**
 * Stat the data file actually being served (cached CDN copy preferred,
 * bundled fallback). Returns the file's last-modified time and which
 * source it came from. Used by the renderer to surface a staleness chip
 * next to the refresh button. Returns 0/'bundled' on stat failure rather
 * than throwing — staleness display is purely cosmetic.
 */
async function dataFileMeta(file: string): Promise<{ refreshedAt: number; source: 'cdn' | 'bundled' }> {
  const cached = join(dataDir(), 'osrs-data', file);
  try {
    if (existsSync(cached)) {
      const s = await stat(cached);
      return { refreshedAt: s.mtimeMs, source: 'cdn' };
    }
    const s = await stat(bundledDataPath(file));
    return { refreshedAt: s.mtimeMs, source: 'bundled' };
  } catch {
    return { refreshedAt: 0, source: 'bundled' };
  }
}

async function cacheDataFile(file: string, contents: string): Promise<void> {
  const dir = join(dataDir(), 'osrs-data');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), contents, 'utf8');
}

async function fetchCdn(file: string): Promise<string> {
  const url = `${CDN_JSON}${file}`;
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(`CDN fetch failed for ${file}: ${res.status}`);
  return await res.text();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    // Matches the renderer theme's bg (tailwind `bg` / body background) so
    // the pre-paint window doesn't flash the old blue-gray before React loads.
    backgroundColor: '#1a130d',
    title: 'GearScape Desktop',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle(IPC.loadData, async () => {
    const [equipment, monsters, spells, meta] = await Promise.all([
      readDataFile('equipment.json'),
      readDataFile('monsters.json'),
      readDataFile('spells.json'),
      // Equipment is the most actively-updated file; use its mtime as the
      // canonical "data refreshed" timestamp.
      dataFileMeta('equipment.json'),
    ]);
    // Patch known-bad upstream entries (see shared/dataPatches.ts) before
    // returning to the renderer. Done here rather than in the renderer so
    // every consumer (calcDps, optimizer, picker UI, validator) sees the
    // corrected values.
    const equipmentData: EquipmentPiece[] = JSON.parse(equipment);
    patchEquipmentData(equipmentData);
    return {
      equipment: equipmentData,
      monsters: JSON.parse(monsters),
      spells: JSON.parse(spells),
      meta,
    };
  });

  ipcMain.handle(IPC.refreshData, async () => {
    const files = ['equipment.json', 'monsters.json', 'spells.json', 'equipment_aliases.json'];
    for (const f of files) {
      const body = await fetchCdn(f);
      JSON.parse(body); // validate
      await cacheDataFile(f, body);
    }
    return { ok: true, files };
  });

  // Live Grand Exchange prices from the OSRS Wiki real-time API. Fetched in
  // the main process (no renderer CSP) with the policy-required descriptive
  // User-Agent. Returns the raw id -> {high,low} map; the renderer derives a
  // single estimated price per item.
  ipcMain.handle(IPC.fetchPrices, async () => {
    const res = await net.fetch(PRICES_API, { headers: { 'User-Agent': WIKI_API_USER_AGENT } });
    if (!res.ok) throw new Error(`Prices fetch failed: ${res.status}`);
    const json = (await res.json()) as { data?: Record<string, { high: number | null; low: number | null }> };
    return { ok: true, prices: json.data ?? {} };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
