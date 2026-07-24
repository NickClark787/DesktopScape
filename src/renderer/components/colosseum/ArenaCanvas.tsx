/**
 * Arena renderer: ONE 2D canvas, redrawn only when the sim state version
 * changes (the parent advances ticks and bumps `version`). No DOM nodes
 * animate, nothing runs while the tab is hidden (the parent halts the tick
 * loop), and the draw pass reuses module-level buffers — no allocations
 * beyond canvas API internals. Positions snap to tiles (tick-accurate), so
 * prefers-reduced-motion needs no special casing — nothing tweens.
 */
import { useEffect, useRef } from 'react';
import { ARENA_H, ARENA_W } from '@sim/solHeredit/constants';
import { tileKey } from '@sim/solHeredit/hazards';
import type { AssistOptions, SimSnapshot } from '@sim/solHeredit/types';

const TILE = 30;
const PAD = 10;
export const CANVAS_W = ARENA_W * TILE + PAD * 2;
export const CANVAS_H = ARENA_H * TILE + PAD * 2;

// Theme-aligned palette (matches the app's OSRS tokens).
const C = {
  floor: '#241b12',
  grid: 'rgba(212, 175, 55, 0.10)',
  sand: '#b3611f',
  hazard: 'rgba(226, 64, 42, 0.42)',
  safe: 'rgba(63, 191, 95, 0.35)',
  beam: 'rgba(255, 214, 80, 0.85)',
  boss: '#4e4437',
  bossEdge: '#d4af37',
  player: '#ffd76e',
  target: 'rgba(255, 215, 110, 0.5)',
  text: '#e8dcc3',
};

interface Props {
  /** Bumped by the parent whenever the sim state changed. */
  version: number;
  getSnapshot: () => SimSnapshot;
  assists: AssistOptions;
  onTileClick: (x: number, y: number) => void;
}

function px(x: number): number { return PAD + x * TILE; }
/** y axis: tile y grows north, canvas y grows down. */
function py(y: number): number { return PAD + (ARENA_H - 1 - y) * TILE; }

function drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(px(x), py(y), TILE, TILE);
}

function draw(ctx: CanvasRenderingContext2D, s: SimSnapshot, assists: AssistOptions): void {
  ctx.fillStyle = C.floor;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Grid.
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= ARENA_W; x++) {
    ctx.moveTo(PAD + x * TILE + 0.5, PAD);
    ctx.lineTo(PAD + x * TILE + 0.5, PAD + ARENA_H * TILE);
  }
  for (let y = 0; y <= ARENA_H; y++) {
    ctx.moveTo(PAD, PAD + y * TILE + 0.5);
    ctx.lineTo(PAD + ARENA_W * TILE, PAD + y * TILE + 0.5);
  }
  ctx.stroke();

  // Molten sand (persistent terrain).
  for (const k of s.sandTiles) {
    const c = k.indexOf(',');
    drawTile(ctx, +k.slice(0, c), +k.slice(c + 1), C.sand);
  }

  // Declared hazard dust (visible in-game — not an assist).
  for (const k of s.hazardTiles) {
    const c = k.indexOf(',');
    drawTile(ctx, +k.slice(0, c), +k.slice(c + 1), C.hazard);
  }

  // Safe-tile assist: green wash on every non-hazard tile while an AoE is up.
  if (assists.safeTileHighlight && s.hazardTiles.size > 0) {
    for (let x = 0; x < ARENA_W; x++) {
      for (let y = 0; y < ARENA_H; y++) {
        if (!s.hazardTiles.has(tileKey(x, y)) && !s.sandTiles.has(tileKey(x, y))) {
          drawTile(ctx, x, y, C.safe);
        }
      }
    }
  }

  // Beams (about to smite).
  for (const b of s.beams) {
    drawTile(ctx, b.pos.x, b.pos.y, C.beam);
    ctx.fillStyle = '#1a130d';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.max(0, b.fireTick - s.tick)), px(b.pos.x) + TILE / 2, py(b.pos.y) + TILE / 2 + 4);
  }

  // Boss (5x5).
  ctx.fillStyle = C.boss;
  ctx.fillRect(px(s.bossAnchor.x), py(s.bossAnchor.y + 4), TILE * 5, TILE * 5);
  ctx.strokeStyle = C.bossEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(px(s.bossAnchor.x) + 1, py(s.bossAnchor.y + 4) + 1, TILE * 5 - 2, TILE * 5 - 2);
  ctx.fillStyle = C.text;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('SOL', px(s.bossAnchor.x) + TILE * 2.5, py(s.bossAnchor.y + 4) + TILE * 2.5);
  if (s.grappleSlot) {
    ctx.fillStyle = C.beam;
    ctx.fillText(`GRAPPLE: ${s.grappleSlot.toUpperCase()}!`, px(s.bossAnchor.x) + TILE * 2.5, py(s.bossAnchor.y + 4) - 6);
  }

  // Player.
  ctx.fillStyle = C.player;
  ctx.beginPath();
  ctx.arc(px(s.playerPos.x) + TILE / 2, py(s.playerPos.y) + TILE / 2, TILE * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a130d';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function ArenaCanvas({ version, getSnapshot, assists, onTileClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    draw(ctx, getSnapshot(), assists);
  }, [version, getSnapshot, assists]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      className="rounded border border-border-strong max-w-full"
      style={{ imageRendering: 'auto' }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const scaleX = CANVAS_W / rect.width;
        const scaleY = CANVAS_H / rect.height;
        const cx = (e.clientX - rect.left) * scaleX - PAD;
        const cy = (e.clientY - rect.top) * scaleY - PAD;
        const x = Math.floor(cx / TILE);
        const y = ARENA_H - 1 - Math.floor(cy / TILE);
        if (x >= 0 && x < ARENA_W && y >= 0 && y < ARENA_H) onTileClick(x, y);
      }}
    />
  );
}
