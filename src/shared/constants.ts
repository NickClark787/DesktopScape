export const IPC = {
  loadData: 'data:load',
  refreshData: 'data:refresh',
  getCdnImageUrl: 'data:cdn-image-url',
} as const;

export const CDN_BASE = 'https://tools.runescape.wiki/osrs-dps/cdn/';
export const CDN_JSON = `${CDN_BASE}json/`;

export const DEFAULT_PLAYER_SKILLS = {
  atk: 99,
  str: 99,
  def: 99,
  hp: 99,
  magic: 99,
  ranged: 99,
  prayer: 99,
};
