/**
 * Rebindable keyboard controls for the Colosseum tab. Persisted to a
 * versioned localStorage key; unknown/missing entries fall back to
 * defaults so new actions can ship without wiping user bindings.
 */

export type KeyAction =
  | 'moveN' | 'moveS' | 'moveE' | 'moveW'
  | 'protectMelee' | 'offensivePrayer'
  | 'eatFood' | 'eatKarambwan' | 'sipRestore' | 'sipBrew'
  | 'parryHead' | 'parryBody' | 'parryLegs' | 'parryWeapon' | 'parryShield'
  | 'spec'
  | 'pauseResume' | 'tickStep' | 'speedUp' | 'speedDown';

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  moveN: 'Step north', moveS: 'Step south', moveE: 'Step east', moveW: 'Step west',
  protectMelee: 'Toggle Protect from Melee', offensivePrayer: 'Toggle offensive prayer',
  eatFood: 'Eat food', eatKarambwan: 'Eat karambwan', sipRestore: 'Sip restore', sipBrew: 'Sip brew',
  parryHead: 'Grapple parry: head', parryBody: 'Grapple parry: body', parryLegs: 'Grapple parry: legs',
  parryWeapon: 'Grapple parry: weapon', parryShield: 'Grapple parry: shield',
  spec: 'Special attack',
  pauseResume: 'Pause / resume', tickStep: 'Advance one tick', speedUp: 'Speed up', speedDown: 'Slow down',
};

export const DEFAULT_KEYMAP: Record<KeyAction, string> = {
  moveN: 'w', moveS: 's', moveE: 'd', moveW: 'a',
  protectMelee: 'f', offensivePrayer: 'g',
  eatFood: 'e', eatKarambwan: 'q', sipRestore: 'r', sipBrew: 'b',
  parryHead: '1', parryBody: '2', parryLegs: '3', parryWeapon: '4', parryShield: '5',
  spec: 'x',
  pauseResume: ' ', tickStep: '.', speedUp: '=', speedDown: '-',
};

const KEY_STORE = 'gearscape:colosseum:keys';
const KEY_VERSION = 1;

export function loadKeymap(): Record<KeyAction, string> {
  if (typeof window === 'undefined') return { ...DEFAULT_KEYMAP };
  try {
    const raw = window.localStorage.getItem(KEY_STORE);
    if (!raw) return { ...DEFAULT_KEYMAP };
    const parsed = JSON.parse(raw) as { version?: number; keys?: Partial<Record<KeyAction, string>> };
    if (parsed.version !== KEY_VERSION || !parsed.keys) return { ...DEFAULT_KEYMAP };
    return { ...DEFAULT_KEYMAP, ...parsed.keys };
  } catch {
    return { ...DEFAULT_KEYMAP };
  }
}

export function saveKeymap(keys: Record<KeyAction, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY_STORE, JSON.stringify({ version: KEY_VERSION, keys }));
  } catch { /* quota */ }
}

/** Reverse lookup: key → action (first match wins). */
export function actionForKey(keys: Record<KeyAction, string>, key: string): KeyAction | null {
  const lower = key.toLowerCase();
  for (const [action, bound] of Object.entries(keys) as [KeyAction, string][]) {
    if (bound === lower) return action;
  }
  return null;
}
