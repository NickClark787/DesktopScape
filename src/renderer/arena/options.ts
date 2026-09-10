/**
 * Graphics settings shared by every arena renderer, plus the quality
 * tiers those settings resolve to.
 *
 * Quality is the load-bearing knob on this machine: `low` must be
 * genuinely cheap (flat fills, no particles, no glows, no shadows, DPR 1),
 * not merely "fewer sparkles". Every cost that scales with quality is
 * declared here so no renderer invents its own budget.
 */

export type QualityTier = 'low' | 'medium' | 'high';
export type ViewMode = 'iso' | 'tactical';

export interface GraphicsOptions {
  quality: QualityTier;
  /** Drop a tier automatically when frame time blows the budget. */
  autoQuality: boolean;
  view: ViewMode;
  /** Multiplier on the fit-to-arena scale. 1 = whole arena framed. */
  zoom: number;
  /** Ease the camera toward the player when zoomed past the fit scale. */
  followPlayer: boolean;
  showTileCoords: boolean;
  showTickBar: boolean;
  showPerfHud: boolean;
  /** Name the wind-up ("SPEAR 2") next to the boss. Legibility, not timing. */
  showAttackLabel: boolean;
  /** Ghost click-marker + lag pips for inputs still in flight. */
  showLatencyIndicator: boolean;
  /** Hard cap on rendered frames per second. */
  fpsCap: number;
}

export const DEFAULT_GRAPHICS: GraphicsOptions = {
  quality: 'high',
  autoQuality: true,
  view: 'iso',
  zoom: 1,
  followPlayer: false,
  showTileCoords: false,
  showTickBar: true,
  showPerfHud: false,
  showAttackLabel: true,
  showLatencyIndicator: true,
  fpsCap: 60,
};

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 1.6;
export const FPS_CAPS = [30, 60, 120] as const;

/** Everything a tier changes, resolved once and read by the draw routines. */
export interface QualityProfile {
  /** Backing-store scale cap. Fill rate is the dominant cost here. */
  maxDpr: number;
  /** Tween tile-to-tile motion between ticks (off = snap, cheapest). */
  interpolate: boolean;
  /** Per-tile floor grain, bevels and the baked barricade silhouettes. */
  richArena: boolean;
  /** Soft shadows under actors. */
  shadows: boolean;
  /** Radial glows on telegraphs, beams and the enrage pulse. */
  glows: boolean;
  /** Cap on live particles; 0 disables the particle field entirely. */
  maxParticles: number;
  /** Cap on live effects (hitsplats, rings, bursts, floating text). */
  maxEffects: number;
  /** Emitted per burst; scaled by the pool cap at spawn time. */
  burstParticles: number;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  low: {
    maxDpr: 1,
    interpolate: false,
    richArena: false,
    shadows: false,
    glows: false,
    maxParticles: 0,
    maxEffects: 24,
    burstParticles: 0,
  },
  medium: {
    maxDpr: 1.25,
    interpolate: true,
    richArena: true,
    shadows: true,
    glows: false,
    maxParticles: 60,
    maxEffects: 48,
    burstParticles: 6,
  },
  high: {
    maxDpr: 1.5,
    interpolate: true,
    richArena: true,
    shadows: true,
    glows: true,
    maxParticles: 160,
    maxEffects: 72,
    burstParticles: 14,
  },
};

/** Pools are allocated once, at the largest tier, and simply used less at
 *  lower tiers — dropping quality must never allocate. */
export const POOL_CAP_EFFECTS = QUALITY.high.maxEffects;
export const POOL_CAP_PARTICLES = QUALITY.high.maxParticles;

export const QUALITY_ORDER: QualityTier[] = ['low', 'medium', 'high'];

export function lowerTier(q: QualityTier): QualityTier | null {
  const i = QUALITY_ORDER.indexOf(q);
  return i > 0 ? QUALITY_ORDER[i - 1] : null;
}

// ---------------------------------------------------------------- storage

const VERSION = 1;

/** Each tab keeps its own settings — the Inferno and the Colosseum have
 *  very different scenes, so a tier that suits one need not suit the other. */
export function graphicsKey(tab: string): string {
  return `desktopscape:${tab}:graphics`;
}

export function loadGraphics(key: string): GraphicsOptions {
  if (typeof window === 'undefined') return { ...DEFAULT_GRAPHICS };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_GRAPHICS };
    const parsed = JSON.parse(raw) as { version?: number; options?: Partial<GraphicsOptions> };
    if (parsed.version !== VERSION || !parsed.options) return { ...DEFAULT_GRAPHICS };
    return { ...DEFAULT_GRAPHICS, ...parsed.options };
  } catch {
    return { ...DEFAULT_GRAPHICS };
  }
}

export function saveGraphics(key: string, options: GraphicsOptions): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ version: VERSION, options }));
  } catch { /* quota — settings are a nicety, not worth throwing over */ }
}

/**
 * Visual aids that are NOT engine assists but still make the fight easier
 * to read. Listed in the results panel so a "clean" attempt is honestly
 * clean. The attack label is excluded on purpose: the wind-up animations
 * are already distinct, so naming them conveys nothing extra.
 */
export function visualAidsInUse(g: GraphicsOptions): string[] {
  const out: string[] = [];
  if (g.showTileCoords) out.push('tile coordinates');
  if (g.view === 'tactical') out.push('tactical top-down view');
  return out;
}
