export const IPC = {
  loadData: 'data:load',
  refreshData: 'data:refresh',
  getCdnImageUrl: 'data:cdn-image-url',
  fetchPrices: 'prices:fetch',
} as const;

export const CDN_BASE = 'https://tools.runescape.wiki/osrs-dps/cdn/';
export const CDN_JSON = `${CDN_BASE}json/`;

/** OSRS Wiki real-time prices (latest high/low per item id). */
export const PRICES_API = 'https://prices.runescape.wiki/api/v1/osrs/latest';
/** Descriptive User-Agent required by the OSRS Wiki API usage policy. */
export const WIKI_API_USER_AGENT = 'DesktopScape - best-in-slot/DPS calculator';

export const DEFAULT_PLAYER_SKILLS = {
  atk: 99,
  str: 99,
  def: 99,
  hp: 99,
  magic: 99,
  ranged: 99,
  prayer: 99,
};
