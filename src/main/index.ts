import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { IPC, CDN_JSON, PRICES_API, WIKI_API_USER_AGENT } from '../shared/constants';
import { patchEquipmentData } from '../shared/dataPatches';
import type { EquipmentPiece, Monster } from '../shared/types';

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

/**
 * Read + parse a data file, preferring the refreshed CDN cache. A cached file
 * that can't be read OR parsed falls back to the bundled copy, so a corrupted
 * cache (truncated download, disk issue) self-heals instead of wedging the
 * app on every launch. The array check catches a CDN error page that slipped
 * through as valid JSON.
 */
async function readJsonArrayFile<T>(file: string): Promise<T[]> {
  const cached = join(dataDir(), 'osrs-data', file);
  if (existsSync(cached)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(cached, 'utf8'));
      if (Array.isArray(parsed)) return parsed as T[];
    } catch { /* corrupted cache — fall back to bundled */ }
  }
  const parsed: unknown = JSON.parse(await readFile(bundledDataPath(file), 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array`);
  return parsed as T[];
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
    title: 'DesktopScape',
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
    // NOTE: spells.json is NOT shipped over IPC — the renderer engine bundles
    // it statically (spells.ts imports @data/spells.json), so sending a copy
    // here was dead weight that could silently disagree with the bundle.
    const [equipment, monsters, meta] = await Promise.all([
      readJsonArrayFile<EquipmentPiece>('equipment.json'),
      readJsonArrayFile<Monster>('monsters.json'),
      // Equipment is the most actively-updated file; use its mtime as the
      // canonical "data refreshed" timestamp.
      dataFileMeta('equipment.json'),
    ]);
    // Patch known-bad upstream entries (see shared/dataPatches.ts) before
    // returning to the renderer. Done here rather than in the renderer so
    // every consumer (calcDps, optimizer, picker UI, validator) sees the
    // corrected values.
    patchEquipmentData(equipment);
    return { equipment, monsters, meta };
  });

  ipcMain.handle(IPC.refreshData, async () => {
    const files = ['equipment.json', 'monsters.json', 'spells.json', 'equipment_aliases.json'];
    // Fetch + validate EVERY file before caching ANY of them, so a network
    // failure or bad payload mid-refresh can't leave a mixed-version cache
    // (equipment from today next to monsters from last month).
    const bodies = await Promise.all(files.map(async (f) => {
      const body = await fetchCdn(f);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`CDN returned invalid JSON for ${f}`);
      }
      // Data files are arrays; equipment_aliases is an id→ids record.
      const shapeOk = f === 'equipment_aliases.json'
        ? parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        : Array.isArray(parsed);
      if (!shapeOk) throw new Error(`CDN returned an unexpected shape for ${f}`);
      return [f, body] as const;
    }));
    for (const [f, body] of bodies) await cacheDataFile(f, body);
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
}).catch((err: unknown) => {
  // whenReady only rejects if Electron fails to initialize — nothing to
  // recover; log so packaged-app failures aren't silent.
  console.error('[desktopscape] app failed to start:', err);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
