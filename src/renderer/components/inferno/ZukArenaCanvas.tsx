/**
 * Zuk arena renderer: ONE 2D canvas, redrawn only when the sim state
 * version changes (the parent advances ticks and bumps `version`). No DOM
 * nodes animate, nothing runs while the tab is hidden (the parent halts the
 * tick loop), positions snap to tiles (no tweening → reduced-motion safe),
 * and the draw pass allocates nothing beyond canvas API internals. No WebGL.
 */
import { useEffect, useRef } from 'react';
import { ARENA_H, ARENA_W, GLYPH_ROW } from '@sim/tzkalZuk/constants';
import type { AssistOptions, EntityKind, SimSnapshot } from '@sim/tzkalZuk/types';

const TILE = 22;
const PAD = 8;
export const CANVAS_W = ARENA_W * TILE + PAD * 2;
export const CANVAS_H = ARENA_H * TILE + PAD * 2;

const C = {
  floor: '#2a1206',
  floorAlt: '#331608',
  grid: 'rgba(255, 140, 40, 0.08)',
  zuk: '#5a1d0e',
  zukEdge: '#e2402a',
  glyph: 'rgba(120, 200, 255, 0.85)',
  safe: 'rgba(90, 200, 255, 0.18)',
  player: '#ffd76e',
  playerExposed: '#e2402a',
  target: '#ffd76e',
  text: '#f2e6cf',
};

const ENTITY_COLOR: Record<EntityKind, string> = {
  zuk: '#e2402a', ranger: '#3fbf5f', mager: '#4a90e2', jad: '#e08b2e', healer: '#c264d6',
};
const ENTITY_LABEL: Record<EntityKind, string> = {
  zuk: 'Z', ranger: 'R', mager: 'M', jad: 'JAD', healer: 'H',
};

interface Props {
  version: number;
  getSnapshot: () => SimSnapshot;
  assists: AssistOptions;
  onTileClick: (x: number, y: number) => void;
  onEntityClick: (id: number) => void;
}

function px(x: number): number { return PAD + x * TILE; }
/** y grows north; canvas y grows down. */
function py(y: number): number { return PAD + (ARENA_H - 1 - y) * TILE; }

function draw(ctx: CanvasRenderingContext2D, s: SimSnapshot, assists: AssistOptions): void {
  // Lava floor (checker for depth).
  for (let x = 0; x < ARENA_W; x++) {
    for (let y = 0; y < ARENA_H; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? C.floor : C.floorAlt;
      ctx.fillRect(px(x), py(y), TILE, TILE);
    }
  }
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= ARENA_W; x++) {
    ctx.beginPath(); ctx.moveTo(PAD + x * TILE + 0.5, PAD); ctx.lineTo(PAD + x * TILE + 0.5, PAD + ARENA_H * TILE); ctx.stroke();
  }

  // Glyph safe zone (assist) + the glyph bar itself.
  if (s.glyphSpan) {
    if (assists.glyphSafeHighlight) {
      ctx.fillStyle = C.safe;
      for (let y = 0; y < GLYPH_ROW; y++) {
        ctx.fillRect(px(s.glyphSpan.x0), py(y), (s.glyphSpan.x1 - s.glyphSpan.x0) * TILE, TILE);
      }
    }
    ctx.fillStyle = C.glyph;
    ctx.fillRect(px(s.glyphSpan.x0), py(s.glyphSpan.row) + TILE * 0.3, (s.glyphSpan.x1 - s.glyphSpan.x0) * TILE, TILE * 0.4);
  }

  // Zuk (7x7 at the north wall).
  const zuk = s.entities.find((e) => e.kind === 'zuk');
  const zx0 = Math.floor((ARENA_W - 7) / 2);
  ctx.fillStyle = C.zuk;
  ctx.fillRect(px(zx0), py(ARENA_H - 1), TILE * 7, TILE * 7);
  ctx.strokeStyle = C.zukEdge;
  ctx.lineWidth = 2;
  ctx.strokeRect(px(zx0) + 1, py(ARENA_H - 1) + 1, TILE * 7 - 2, TILE * 7 - 2);
  ctx.fillStyle = C.text;
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(s.enraged ? 'ZUK (enraged)' : 'ZUK', px(zx0) + TILE * 3.5, py(ARENA_H - 1) + TILE * 3.5);
  void zuk;

  // Adds.
  for (const e of s.entities) {
    if (e.kind === 'zuk') continue;
    const cx = px(e.pos.x) + (e.size * TILE) / 2;
    const cy = py(e.pos.y) - (e.size - 1) * TILE / 2 + TILE / 2;
    ctx.fillStyle = ENTITY_COLOR[e.kind];
    ctx.globalAlpha = e.hp > 0 ? 0.85 : 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(8, (e.size * TILE) / 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0d0603';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(ENTITY_LABEL[e.kind], cx, cy + 3);
    // Windup marker (about to attack + style).
    if (e.windup) {
      ctx.strokeStyle = e.windup.style === 'magic' ? '#4a90e2' : '#3fbf5f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(11, (e.size * TILE) / 3 + 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    // Target ring.
    if (e.id === s.targetId) {
      ctx.strokeStyle = C.target;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(13, (e.size * TILE) / 3 + 5), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Player — gold when protected, red when exposed to Zuk.
  ctx.fillStyle = s.playerBehindGlyph || s.glyphDestroyed ? (s.glyphDestroyed ? C.playerExposed : C.player)
    : (s.zukWindupLandTick > 0 ? C.playerExposed : C.player);
  ctx.beginPath();
  ctx.arc(px(s.playerPos.x) + TILE / 2, py(s.playerPos.y) + TILE / 2, TILE * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0d0603';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function ZukArenaCanvas({ version, getSnapshot, assists, onTileClick, onEntityClick }: Props) {
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
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const scaleX = CANVAS_W / rect.width;
        const scaleY = CANVAS_H / rect.height;
        const cx = (e.clientX - rect.left) * scaleX - PAD;
        const cy = (e.clientY - rect.top) * scaleY - PAD;
        const x = Math.floor(cx / TILE);
        const y = ARENA_H - 1 - Math.floor(cy / TILE);
        if (x < 0 || x >= ARENA_W || y < 0 || y >= ARENA_H) return;
        // Prefer clicking an add near the tile; else move.
        const snap = getSnapshot();
        const hit = snap.entities.find((ent) =>
          ent.kind !== 'zuk' && ent.hp > 0 && Math.abs(ent.pos.x - x) <= ent.size && Math.abs(ent.pos.y - y) <= ent.size);
        if (hit) onEntityClick(hit.id);
        else onTileClick(x, y);
      }}
    />
  );
}
