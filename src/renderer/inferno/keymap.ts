/**
 * Rebindable keyboard controls for the Inferno (Zuk) tab. Persisted to a
 * versioned localStorage key; unknown/missing entries fall back to defaults.
 */
export type KeyAction =
  | 'moveN' | 'moveS' | 'moveE' | 'moveW'
  | 'prayMagic' | 'prayRanged' | 'prayMelee' | 'prayOff' | 'offensivePrayer'
  | 'targetNext' | 'targetZuk'
  | 'eatFood' | 'eatKarambwan' | 'sipRestore' | 'sipBrew'
  | 'pauseResume' | 'tickStep' | 'speedUp' | 'speedDown';

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  moveN: 'Step north', moveS: 'Step south', moveE: 'Step east', moveW: 'Step west',
  prayMagic: 'Protect from Magic', prayRanged: 'Protect from Missiles', prayMelee: 'Protect from Melee',
  prayOff: 'Overhead off', offensivePrayer: 'Toggle Rigour',
  targetNext: 'Target next add', targetZuk: 'Target Zuk',
  eatFood: 'Eat food', eatKarambwan: 'Eat karambwan', sipRestore: 'Sip restore', sipBrew: 'Sip brew',
  pauseResume: 'Pause / resume', tickStep: 'Advance one tick', speedUp: 'Speed up', speedDown: 'Slow down',
};

export const DEFAULT_KEYMAP: Record<KeyAction, string> = {
  moveN: 'w', moveS: 's', moveE: 'd', moveW: 'a',
  prayMagic: '1', prayRanged: '2', prayMelee: '3', prayOff: '4', offensivePrayer: 'g',
  targetNext: 'tab', targetZuk: 'z',
  eatFood: 'e', eatKarambwan: 'q', sipRestore: 'r', sipBrew: 'b',
  pauseResume: ' ', tickStep: '.', speedUp: '=', speedDown: '-',
};

const KEY_STORE = 'gearscape:inferno:keys';
const KEY_VERSION = 1;

export function loadKeymap(): Record<KeyAction, string> {
  if (typeof window === 'undefined') return { ...DEFAULT_KEYMAP };
  try {
    const raw = window.localStorage.getItem(KEY_STORE);
    if (!raw) return { ...DEFAULT_KEYMAP };
    const parsed = JSON.parse(raw) as { version?: number; keys?: Partial<Record<KeyAction, string>> };
    if (parsed.version !== KEY_VERSION || !parsed.keys) return { ...DEFAULT_KEYMAP };
    return { ...DEFAULT_KEYMAP, ...parsed.keys };
  } catch { return { ...DEFAULT_KEYMAP }; }
}

export function saveKeymap(keys: Record<KeyAction, string>): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY_STORE, JSON.stringify({ version: KEY_VERSION, keys })); } catch { /* quota */ }
}

export function actionForKey(keys: Record<KeyAction, string>, key: string): KeyAction | null {
  const lower = key.toLowerCase();
  for (const [action, bound] of Object.entries(keys) as [KeyAction, string][]) {
    if (bound === lower) return action;
  }
  return null;
}
