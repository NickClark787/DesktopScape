/**
 * Colour vocabulary for the Inferno's Zuk platform. All original.
 *
 * Where the Colosseum is weathered sandstone and bronze, the Inferno is
 * cooled basalt over molten rock: near-black tiles, ember cracks, a lava
 * moat, and the cold blue of the Ancestral Glyph as the one thing in the
 * arena that is not on fire — which is exactly the read the fight wants.
 */
import { GradientCache } from '../../arena/frame';

export const C = {
  // Backdrop beyond the platform.
  void: '#0a0603',

  // Basalt floor over magma.
  rockA: '#2a1a10',
  rockB: '#32200f',
  rockCrack: '#8c3a10',
  rockGrain: '#5a3a22',
  grid: 'rgba(255, 140, 40, 0.10)',
  gridStrong: 'rgba(255, 140, 40, 0.22)',

  // Platform rim and the lava beyond it.
  rimTop: '#4a3520',
  rimFace: '#241408',
  rimFaceDark: '#170c04',
  rimGlow: 'rgba(255, 120, 30, 0.45)',
  lavaDeep: '#5a1502',
  lavaMid: '#c23b06',
  lavaHot: '#ff8c1a',

  // Crowd of TzHaar spectators beyond the moat — abstract silhouettes.
  crowdFar: '#170d05',
  crowdNear: '#241408',
  crowdGlint: 'rgba(255, 140, 40, 0.25)',

  // TzKal-Zuk: cooled crust over an exposed core.
  zukCrust: '#3a1d0d',
  zukCrustLit: '#5c2f14',
  zukSeam: '#c23b06',
  zukCore: '#ff9c2a',
  zukCoreHot: '#ffe07a',
  zukShadow: 'rgba(0, 0, 0, 0.5)',
  zukEnrage: '#ff5a1a',

  // The Ancestral Glyph — the one cold thing here.
  glyph: '#78c8ff',
  glyphDeep: '#2a6ea8',
  glyphCore: '#dff2ff',
  glyphBand: 'rgba(120, 200, 255, 0.16)',
  glyphBandEdge: 'rgba(120, 200, 255, 0.55)',
  glyphBroken: '#6b5a4a',

  // Adds. Each kind gets its own hue so a glance reads the set.
  ranger: '#3fbf5f',
  rangerDark: '#1c5b2c',
  mager: '#4a90e2',
  magerDark: '#224a78',
  jad: '#e08b2e',
  jadDark: '#7a4510',
  healer: '#c264d6',
  healerDark: '#5f2a6b',

  // Player.
  player: '#e8dcc3',
  playerCloak: '#2f5f8a',
  playerTrim: '#d4af37',
  playerDead: '#6b6255',
  exposed: '#ff5a3a',

  // Overlays.
  safe: 'rgba(63, 191, 95, 0.22)',
  safeEdge: 'rgba(63, 191, 95, 0.7)',
  danger: 'rgba(255, 90, 26, 0.30)',
  dangerEdge: 'rgba(255, 140, 60, 0.85)',

  clickMarker: '#ff7a66',
  ghostMarker: 'rgba(244, 234, 209, 0.45)',
} as const;

/** Inferno gradients, on top of the shared ambient/vignette. */
export class InfernoGradients extends GradientCache {
  /** Zuk's charging maw. */
  charge: CanvasGradient | null = null;
  /** The glyph's protective column. */
  glyphBand: CanvasGradient | null = null;
  /** Heat haze pooling under Zuk. */
  heat: CanvasGradient | null = null;

  protected override rebuild(ctx: CanvasRenderingContext2D, scale: number, w: number, h: number): void {
    super.rebuild(ctx, scale, w, h);

    const ch = ctx.createRadialGradient(0, 0, 0, 0, 0, 70 * scale);
    ch.addColorStop(0, 'rgba(255, 224, 122, 0.85)');
    ch.addColorStop(0.45, 'rgba(255, 140, 26, 0.45)');
    ch.addColorStop(1, 'rgba(255, 90, 26, 0)');
    this.charge = ch;

    const band = ctx.createLinearGradient(0, 0, 0, 240 * scale);
    band.addColorStop(0, 'rgba(120, 200, 255, 0.30)');
    band.addColorStop(1, 'rgba(120, 200, 255, 0.03)');
    this.glyphBand = band;

    const heat = ctx.createRadialGradient(0, 0, 0, 0, 0, 120 * scale);
    heat.addColorStop(0, 'rgba(255, 120, 30, 0.32)');
    heat.addColorStop(1, 'rgba(255, 90, 26, 0)');
    this.heat = heat;
  }
}
