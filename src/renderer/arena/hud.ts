/**
 * On-canvas HUD shared by every arena: the tick metronome, a boss health
 * bar, the latency readout, the perf overlay and outcome banners.
 *
 * These live on the canvas rather than in DOM for two reasons: they update
 * at frame rate (a DOM node changing text 60×/s is far more expensive than
 * a fillText), and they must stay pinned to the arena when it scales. The
 * DOM chrome around the canvas stays static.
 *
 * Every interpolated label is memoised on the values it contains —
 * rebuilding them per frame would allocate a string per frame, which is
 * exactly what the render loop is not allowed to do.
 */
import { outlinedText, roundRectPath } from './shapes';

export const HUD = {
  back: 'rgba(16, 13, 9, 0.78)',
  edge: 'rgba(212, 175, 55, 0.45)',
  text: '#f4ead1',
  dim: '#ab9e7a',
  accent: '#f2c94c',
  bar: '#d4af37',
  barBack: 'rgba(0, 0, 0, 0.5)',
} as const;

export const FONT_HUD = '600 12px "Trebuchet MS", system-ui, sans-serif';
export const FONT_HUD_SM = '600 10px "Trebuchet MS", system-ui, sans-serif';
export const FONT_SPLAT = 'bold 12px "Trebuchet MS", system-ui, sans-serif';
export const FONT_LABEL = 'bold 13px "Trebuchet MS", system-ui, sans-serif';
export const FONT_TITLE = 'bold 22px "Cinzel", "Trebuchet MS", Georgia, serif';
export const FONT_COORD = '9px "Trebuchet MS", system-ui, sans-serif';

/**
 * The tick metronome. A rhythm-based fight is unlearnable without one, so
 * it is prominent by default: a sweeping bar, a pip that flashes on the
 * tick boundary, and the tick count.
 */
export function drawTickBar(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  tick: number, alpha: number, running: boolean,
): void {
  const barH = 8;
  const y = h - barH - 20;
  const pad = 16;
  const bw = w - pad * 2;

  ctx.fillStyle = HUD.barBack;
  ctx.beginPath();
  roundRectPath(ctx, pad, y, bw, barH, 4);
  ctx.fill();

  // Paused: a dim full bar rather than an empty one — a bar sitting at
  // zero next to a lone flash pip just looks broken.
  ctx.fillStyle = HUD.bar;
  ctx.globalAlpha = running ? 1 : 0.25;
  ctx.beginPath();
  roundRectPath(ctx, pad, y, running ? Math.max(2, bw * alpha) : bw, barH, 4);
  ctx.fill();
  ctx.globalAlpha = 1;

  const flash = running && alpha < 0.2 ? 1 - alpha / 0.2 : 0;
  if (flash > 0) {
    ctx.globalAlpha = flash;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(pad + 4, y + barH / 2, barH * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Beat marks every 5 ticks — the cadence most rotations are counted in.
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 5; i++) {
    const x = pad + (bw * i) / 5;
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + barH);
  }
  ctx.stroke();

  outlinedText(ctx, tickLabel(tick, running), pad + 2, y - 5, HUD.dim, FONT_HUD_SM, 'left');
}

let tickLabelCache = '';
let tickLabelTick = -1;
let tickLabelRunning = true;
function tickLabel(tick: number, running: boolean): string {
  if (tick !== tickLabelTick || running !== tickLabelRunning) {
    tickLabelTick = tick;
    tickLabelRunning = running;
    tickLabelCache = running ? `TICK ${tick}` : `TICK ${tick} · paused`;
  }
  return tickLabelCache;
}

export interface BossBarSpec {
  name: string;
  hp: number;
  maxHp: number;
  /** Fractions of max HP to mark — phase thresholds, spawn gates. */
  thresholds: readonly number[];
  /** Overrides the default red when the boss is in a special state. */
  tint?: string;
  /** Small line under the bar (e.g. "ENRAGED"). */
  subtitle?: string;
  subtitleTint?: string;
}

/** Boss health bar with mechanic thresholds marked on it. */
export function drawBossBar(ctx: CanvasRenderingContext2D, w: number, spec: BossBarSpec): void {
  const bw = Math.min(360, w - 40);
  const x = (w - bw) / 2;
  const y = 12;
  const h = 14;
  const frac = spec.maxHp > 0 ? Math.max(0, spec.hp / spec.maxHp) : 0;

  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x - 2, y - 2, bw + 4, h + 4, 4);
  ctx.fill();
  ctx.strokeStyle = spec.tint ?? HUD.edge;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = spec.tint ?? '#a02c1c';
  ctx.beginPath();
  roundRectPath(ctx, x, y, Math.max(1, bw * frac), h, 3);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of spec.thresholds) {
    const tx = x + bw * t;
    ctx.moveTo(tx, y);
    ctx.lineTo(tx, y + h);
  }
  ctx.stroke();

  outlinedText(ctx, bossLabel(spec.name, spec.hp, spec.maxHp), w / 2, y + h - 2, HUD.text, FONT_HUD);
  if (spec.subtitle) {
    outlinedText(ctx, spec.subtitle, w / 2, y + h + 14, spec.subtitleTint ?? HUD.accent, FONT_HUD_SM);
  }
}

let bossLabelCache = '';
let bossLabelHp = -1;
let bossLabelName = '';
function bossLabel(name: string, hp: number, maxHp: number): string {
  if (hp !== bossLabelHp || name !== bossLabelName) {
    bossLabelHp = hp;
    bossLabelName = name;
    bossLabelCache = `${name}  ${hp} / ${maxHp}`;
  }
  return bossLabelCache;
}

export interface PerfStats {
  fps: number;
  frameMs: number;
  worstMs: number;
  dropped: number;
  quality: string;
  effects: number;
  particles: number;
  autoDowngraded: boolean;
}

/**
 * Frame-cost readout. Toggleable; off by default. The strings are rebuilt
 * at 4 Hz, not per frame — both to keep the numbers readable and so the
 * diagnostic overlay does not itself allocate 60 times a second.
 */
export function drawPerfHud(ctx: CanvasRenderingContext2D, w: number, p: PerfStats, now: number): void {
  const lines = PERF_LINES;
  if (now - perfBuiltAt > 250) {
    perfBuiltAt = now;
    lines[0] = `${p.fps.toFixed(0)} fps · ${p.frameMs.toFixed(1)} ms`;
    lines[1] = `worst ${p.worstMs.toFixed(1)} ms · dropped ${p.dropped}`;
    lines[2] = `quality ${p.quality}${p.autoDowngraded ? ' (auto)' : ''}`;
    lines[3] = `fx ${p.effects} · particles ${p.particles}`;
  }

  const bw = 156;
  const bh = 14 * lines.length + 10;
  const x = w - bw - 10;
  const y = 34;
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x, y, bw, bh, 4);
  ctx.fill();
  ctx.strokeStyle = HUD.edge;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = FONT_HUD_SM;
  ctx.textAlign = 'left';
  ctx.fillStyle = p.frameMs > 20 ? '#ff7a66' : HUD.dim;
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + 8, y + 16 + i * 14);
}

const PERF_LINES = ['', '', '', ''];
let perfBuiltAt = -1e9;

/**
 * Latency badge: ping and how many inputs are in flight. When ping pushes
 * an input past a tick boundary this is *why* the prayer switch failed, so
 * it stays visible rather than hiding in a config panel.
 */
export function drawLatencyBadge(
  ctx: CanvasRenderingContext2D, h: number, pingMs: number, pendingCount: number,
): void {
  const x = 12;
  const y = h - 52;
  if (pingMs !== pingLabelMs) {
    pingLabelMs = pingMs;
    pingLabelCache = pingMs === 0 ? 'ping 0 ms · tick-perfect' : `ping ${pingMs} ms`;
  }
  ctx.font = FONT_HUD_SM;
  const w = Math.max(120, ctx.measureText(pingLabelCache).width + 20);

  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, 20, 4);
  ctx.fill();
  ctx.strokeStyle = pendingCount > 0 ? HUD.accent : HUD.edge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD.dim;
  ctx.fillText(pingLabelCache, x + 8, y + 14);

  for (let i = 0; i < Math.min(6, pendingCount); i++) {
    ctx.beginPath();
    ctx.arc(x + w + 8 + i * 8, y + 10, 3, 0, Math.PI * 2);
    ctx.fillStyle = HUD.accent;
    ctx.fill();
  }
}

let pingLabelCache = '';
let pingLabelMs = -1;

/** Big centred message: outcome, transition, or a paused notice. */
export function drawBanner(
  ctx: CanvasRenderingContext2D, w: number, h: number, text: string, tint: string,
): void {
  ctx.font = FONT_TITLE;
  const bw = ctx.measureText(text).width + 48;
  const x = (w - bw) / 2;
  const y = h / 2 - 34;
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, x, y, bw, 52, 6);
  ctx.fill();
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2;
  ctx.stroke();
  outlinedText(ctx, text, w / 2, y + 34, tint, FONT_TITLE);
}

/** Corner chip listing how many assists are on, so a run is never silently
 *  assisted. Mirrors the flag the results panel shows afterwards. */
export function drawAssistChip(ctx: CanvasRenderingContext2D, count: number): void {
  if (count <= 0) return;
  if (count !== assistChipCount) {
    assistChipCount = count;
    assistChipLabel = count === 1 ? '1 assist on' : `${count} assists on`;
  }
  ctx.font = FONT_HUD_SM;
  const w = ctx.measureText(assistChipLabel).width + 16;
  ctx.fillStyle = HUD.back;
  ctx.beginPath();
  roundRectPath(ctx, 10, 10, w, 18, 4);
  ctx.fill();
  ctx.strokeStyle = HUD.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = HUD.accent;
  ctx.fillText(assistChipLabel, 18, 23);
}

let assistChipLabel = '';
let assistChipCount = -1;

/** Small bar drawn over an entity — HP, shield integrity, charge. */
export function drawMiniBar(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  frac: number, fill: string,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
}
