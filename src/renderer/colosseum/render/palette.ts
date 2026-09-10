/**
 * Colour vocabulary for the Fortis Colosseum arena. All original: derived
 * from the app's own OSRS-adjacent tokens (tailwind.config.js) —
 * weathered stone, bronze, carved gold, fire-red — so the canvas sits in
 * the same world as the surrounding parchment/stone chrome.
 *
 * Strings are module constants so draw routines never build colours per
 * frame. Shared HUD colours and effect palettes live in `renderer/arena`.
 */
import { GradientCache } from '../../arena/frame';

export const C = {
  // Backdrop behind the arena floor.
  void: '#100d09',

  // Arena floor: packed, blood-darkened sand over stone.
  sandA: '#3a2c1c',
  sandB: '#43331f',
  sandGrain: '#6b563a',
  grid: 'rgba(212, 175, 55, 0.10)',
  gridStrong: 'rgba(212, 175, 55, 0.20)',

  // The wall lip around the playable box.
  wallTop: '#5a4a33',
  wallFace: '#2b2118',
  wallFaceDark: '#1d160f',
  wallGilt: 'rgba(212, 175, 55, 0.35)',

  // Pillars.
  pillarLit: '#6d5b41',
  pillarShade: '#3d3223',
  pillarDark: '#291f16',
  pillarBand: '#a9873c',

  // Crowd barricade silhouettes.
  crowdFar: '#181209',
  crowdNear: '#221a10',
  crowdGlint: 'rgba(212, 175, 55, 0.22)',

  // Sol — bronze plate, gold sun motif, blood-red crest.
  bossPlate: '#8a6a3c',
  bossPlateDark: '#5c4526',
  bossPlateLit: '#b18d51',
  bossTrim: '#d4af37',
  bossCrest: '#a02c1c',
  bossCrestLit: '#d8452c',
  bossShadow: 'rgba(0, 0, 0, 0.45)',
  bossEnrage: '#e2571f',
  bossEnrageDeep: '#7a1f08',

  // Player.
  player: '#e8dcc3',
  playerCloak: '#2f5f8a',
  playerCloakLit: '#4a90e2',
  playerTrim: '#d4af37',
  playerDead: '#6b6255',

  // Hazards and terrain.
  hazard: 'rgba(226, 64, 42, 0.30)',
  hazardStrong: 'rgba(226, 64, 42, 0.50)',
  hazardEdge: 'rgba(255, 122, 102, 0.85)',
  hazardDust: 'rgba(180, 96, 40, 0.35)',
  safe: 'rgba(63, 191, 95, 0.26)',
  safeEdge: 'rgba(63, 191, 95, 0.75)',
  sand: '#8c3f12',
  sandHot: '#e2571f',
  sandCrust: '#5a2408',
  beam: 'rgba(255, 226, 140, 0.9)',
  beamCore: '#fff6d8',
  beamGround: 'rgba(255, 214, 80, 0.35)',

  // Click / latency markers.
  clickMarker: '#ff7a66',
  ghostMarker: 'rgba(244, 234, 209, 0.45)',
} as const;

/** The Colosseum's own gradients, on top of the shared ambient/vignette. */
export class ColosseumGradients extends GradientCache {
  telegraph: CanvasGradient | null = null;
  beamShaft: CanvasGradient | null = null;
  enrage: CanvasGradient | null = null;

  protected override rebuild(ctx: CanvasRenderingContext2D, scale: number, w: number, h: number): void {
    super.rebuild(ctx, scale, w, h);

    const tel = ctx.createRadialGradient(0, 0, 0, 0, 0, 60 * scale);
    tel.addColorStop(0, 'rgba(255, 140, 60, 0.55)');
    tel.addColorStop(1, 'rgba(255, 100, 40, 0)');
    this.telegraph = tel;

    const beam = ctx.createLinearGradient(0, -140 * scale, 0, 0);
    beam.addColorStop(0, 'rgba(255, 246, 216, 0)');
    beam.addColorStop(0.45, 'rgba(255, 226, 140, 0.55)');
    beam.addColorStop(1, 'rgba(255, 246, 216, 0.95)');
    this.beamShaft = beam;

    const enr = ctx.createRadialGradient(0, 0, 0, 0, 0, 90 * scale);
    enr.addColorStop(0, 'rgba(226, 87, 31, 0.42)');
    enr.addColorStop(1, 'rgba(226, 87, 31, 0)');
    this.enrage = enr;
  }
}
