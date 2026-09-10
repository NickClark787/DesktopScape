/**
 * The architectural guarantee behind the camera: the deterministic core
 * cannot see it.
 *
 * In the real client the camera is client-side and never touches the
 * game. Here that is enforced structurally rather than by convention —
 * nothing under `src/sim` imports anything from `src/renderer`, so there
 * is no path by which a yaw, a pitch or a zoom could reach `advance()` or
 * the seeded RNG. This test fails the moment someone opens one.
 *
 * It is deliberately a source-level check. A behavioural test ("orbit the
 * camera, assert the fight is unchanged") could only ever sample a few
 * poses; an import boundary covers every possible one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SolHereditSim } from '@sim/solHeredit/engine';
import { baseConfig } from '../colosseum/fixtures';

const ROOT = resolve(__dirname, '..', '..');
const SIM_DIR = join(ROOT, 'src', 'sim');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g;

describe('sim / view boundary', () => {
  const files = walk(SIM_DIR);

  it('finds the engine sources it is meant to be policing', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('never imports the renderer, the camera or anything view-shaped', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      IMPORT_RE.lastIndex = 0;
      let m: RegExpExecArray | null = IMPORT_RE.exec(src);
      while (m) {
        const spec = m[1];
        if (spec.startsWith('@/')
          || spec.includes('renderer')
          || spec.includes('camera')
          || spec.includes('arena/')
          || spec.includes('/render')) {
          offenders.push(`${file.slice(ROOT.length + 1)} → ${spec}`);
        }
        m = IMPORT_RE.exec(src);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('mentions no camera, canvas or DOM state anywhere in the core', () => {
    const banned = /\b(requestAnimationFrame|CanvasRenderingContext2D|devicePixelRatio|cameraYaw|cameraPitch)\b/;
    const offenders = files.filter((f) => banned.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

describe('advance() is unaffected by anything the view does', () => {
  /** Run a fixed number of ticks and fingerprint the result. */
  function fingerprint(seed: number, ticks: number): string {
    const sim = new SolHereditSim(baseConfig({ seed }));
    for (let i = 0; i < ticks && !sim.finished; i++) sim.advance();
    const s = sim.getSnapshot();
    return [
      s.tick, s.bossHp, s.playerHp, s.playerPos.x, s.playerPos.y,
      s.bossAttack ?? '-', s.bossAnchor.x, s.bossAnchor.y, sim.events.length,
    ].join('|');
  }

  it('is byte-for-byte reproducible from the same seed', () => {
    // The camera lives in another module graph entirely, so the strongest
    // statement available here is the one that matters: same seed, same
    // fight, every time — which is what the camera must not disturb.
    expect(fingerprint(1234, 120)).toBe(fingerprint(1234, 120));
    expect(fingerprint(1234, 120)).not.toBe(fingerprint(9876, 120));
  });
});
