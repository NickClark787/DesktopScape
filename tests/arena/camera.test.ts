/**
 * Tests for the orbit camera and the orbit projection.
 *
 * Two things matter here and they pull in opposite directions:
 *
 *  1. The camera must actually orbit — tiles have to follow it round, the
 *     inverse has to keep working at every angle, and depth order has to
 *     flip when the camera swings behind an actor.
 *  2. The camera must change *nothing* else. At its default pose the
 *     projection has to be bit-for-bit the classic 2:1 isometric view, or
 *     every piece of art in the two fight packages is silently off.
 *
 * The determinism guarantee itself is structural rather than testable
 * here: no module under `src/sim` imports anything from `src/renderer`,
 * so no camera value can reach `advance()` at all. That is asserted in
 * `tests/arena/determinism.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { CAMERA, OrbitCamera } from '@/arena/camera';
import {
  ISO_HH, ISO_HW, ISO_PITCH, ISO_YAW, blitTransform, depthOf, fitCamera, makeCamera, makeMat,
  project, projectTile, screenToTile, syncBasis, unproject, worldBounds, type Point,
} from '@/arena/projection';

const OUT: Point = { x: 0, y: 0 };
const DEG = Math.PI / 180;
const GW = 16;
const GH = 15;

function posed(yaw: number, pitch: number, zoom = 1, w = 900, h = 560) {
  const cam = makeCamera(GW, GH);
  return fitCamera(cam, {
    canvasW: w, canvasH: h, mode: 'iso', zoom, focus: null, required: null, yaw, pitch,
  });
}

describe('orbit projection reduces to the classic isometric view', () => {
  it('uses exactly the 2:1 diamond at the default pose', () => {
    const cam = makeCamera(GW, GH);
    cam.scale = 1.37;
    syncBasis(cam);
    expect(cam.yaw).toBeCloseTo(ISO_YAW, 12);
    expect(cam.pitch).toBeCloseTo(ISO_PITCH, 12);
    for (const [a, b] of [[0, 0], [3.5, 9.25], [16, 15], [7.5, 0.5]]) {
      project(cam, a, b, OUT);
      expect(OUT.x).toBeCloseTo((a - b) * ISO_HW * cam.scale, 9);
      expect(OUT.y).toBeCloseTo((a + b) * ISO_HH * cam.scale, 9);
    }
  });

  it('reports neutral foreshortening at the default pitch', () => {
    const cam = makeCamera(GW, GH);
    expect(cam.up).toBeCloseTo(1, 12);
    expect(cam.flat).toBeCloseTo(1, 12);
  });

  it('shortens upright art and opens up the floor as it pitches over', () => {
    const low = posed(ISO_YAW, CAMERA.PITCH_MIN_DEG * DEG);
    const high = posed(ISO_YAW, CAMERA.PITCH_MAX_DEG * DEG);
    expect(high.up).toBeLessThan(low.up);
    expect(high.flat).toBeGreaterThan(low.flat);
    expect(high.up).toBeGreaterThan(0);
  });
});

describe('orbit projection at arbitrary poses', () => {
  const poses: Array<[number, number]> = [
    [0, 30 * DEG], [45 * DEG, 30 * DEG], [117 * DEG, 22.5 * DEG],
    [200 * DEG, 45 * DEG], [359 * DEG, 67.5 * DEG],
  ];

  it('round-trips every tile back to itself at every pose', () => {
    for (const [yaw, pitch] of poses) {
      const cam = posed(yaw, pitch);
      for (let x = 0; x < GW; x++) {
        for (let y = 0; y < GH; y++) {
          projectTile(cam, x, y, OUT);
          const tile = screenToTile(cam, OUT.x, OUT.y, OUT);
          expect(tile, `pose ${yaw},${pitch} tile ${x},${y}`).not.toBeNull();
          expect([tile!.x, tile!.y]).toEqual([x, y]);
        }
      }
    }
  });

  it('keeps unproject an exact inverse of project at every pose', () => {
    for (const [yaw, pitch] of poses) {
      const cam = posed(yaw, pitch, 1.4);
      for (const [a, b] of [[0, 0], [3.5, 9.25], [GW, GH], [7.5, 0.5]]) {
        project(cam, a, b, OUT);
        unproject(cam, OUT.x, OUT.y, OUT);
        expect(OUT.x).toBeCloseTo(a, 6);
        expect(OUT.y).toBeCloseTo(b, 6);
      }
    }
  });

  it('fits the whole arena on screen at zoom 1, whatever the angle', () => {
    const w = 900;
    const h = 560;
    for (const [yaw, pitch] of poses) {
      const cam = posed(yaw, pitch, 1, w, h);
      for (const [a, b] of [[0, 0], [GW, 0], [GW, GH], [0, GH]]) {
        project(cam, a, b, OUT);
        expect(OUT.x).toBeGreaterThanOrEqual(0);
        expect(OUT.x).toBeLessThanOrEqual(w);
        expect(OUT.y).toBeGreaterThanOrEqual(0);
        expect(OUT.y).toBeLessThanOrEqual(h);
      }
    }
  });

  it('turns the arena: a tile east of another swaps sides at yaw + 180°', () => {
    const front = posed(45 * DEG, 30 * DEG);
    projectTile(front, 2, 7, OUT);
    const westFront = OUT.x;
    projectTile(front, 13, 7, OUT);
    expect(westFront).toBeLessThan(OUT.x);

    const back = posed(225 * DEG, 30 * DEG);
    projectTile(back, 2, 7, OUT);
    const westBack = OUT.x;
    projectTile(back, 13, 7, OUT);
    expect(westBack).toBeGreaterThan(OUT.x);
  });
});

describe('depth ordering follows the camera', () => {
  it('puts the north actor behind the south one at the default yaw', () => {
    const cam = posed(ISO_YAW, ISO_PITCH);
    const north = depthOf(cam, 8, 2);
    const south = depthOf(cam, 8, 12);
    expect(north).toBeLessThan(south);
  });

  it('reverses that order once the camera swings round behind them', () => {
    const cam = posed(ISO_YAW + Math.PI, ISO_PITCH);
    const north = depthOf(cam, 8, 2);
    const south = depthOf(cam, 8, 12);
    expect(north).toBeGreaterThan(south);
  });
});

describe('worldBounds', () => {
  it('matches the hand-derived iso box at the default pose', () => {
    const b = worldBounds('iso', GW, GH, ISO_YAW, ISO_PITCH);
    expect(b.minX).toBeCloseTo(-GH * ISO_HW, 9);
    expect(b.maxX).toBeCloseTo(GW * ISO_HW, 9);
    expect(b.minY).toBeCloseTo(0, 9);
    expect(b.maxY).toBeCloseTo((GW + GH) * ISO_HH, 9);
  });

  it('bounds the projected corners at an arbitrary pose', () => {
    const yaw = 143 * DEG;
    const pitch = 51 * DEG;
    const b = worldBounds('iso', GW, GH, yaw, pitch);
    const cam = makeCamera(GW, GH);
    cam.yaw = yaw; cam.pitch = pitch; cam.scale = 1;
    syncBasis(cam);
    for (const [a, bb] of [[0, 0], [GW, 0], [GW, GH], [0, GH]]) {
      project(cam, a, bb, OUT);
      expect(OUT.x).toBeGreaterThanOrEqual(b.minX - 1e-9);
      expect(OUT.x).toBeLessThanOrEqual(b.maxX + 1e-9);
      expect(OUT.y).toBeGreaterThanOrEqual(b.minY - 1e-9);
      expect(OUT.y).toBeLessThanOrEqual(b.maxY + 1e-9);
    }
  });
});

describe('blitTransform', () => {
  it('is a pure translation when both cameras share a pose', () => {
    const from = posed(ISO_YAW, ISO_PITCH);
    const to = makeCamera(GW, GH);
    to.scale = from.scale;
    syncBasis(to);
    to.ox = from.ox + 40;
    to.oy = from.oy - 12;
    const m = blitTransform(from, to, makeMat());
    expect([m.a, m.b, m.c, m.d]).toEqual([1, 0, 0, 1]);
    expect(m.e).toBeCloseTo(40, 9);
    expect(m.f).toBeCloseTo(-12, 9);
  });

  it('re-projects a layer baked at one pose exactly onto another', () => {
    const from = posed(20 * DEG, 26 * DEG, 1.1);
    const to = posed(64 * DEG, 58 * DEG, 0.9);
    const m = blitTransform(from, to, makeMat());
    // A point baked at `from` pushed through the transform must land
    // where `to` would have drawn it. This is what lets the static arena
    // layer survive an orbit without a re-bake.
    for (const [a, b] of [[0, 0], [4.5, 11.25], [GW, GH]]) {
      project(from, a, b, OUT);
      const bakedX = OUT.x;
      const bakedY = OUT.y;
      const liveX = m.a * bakedX + m.c * bakedY + m.e;
      const liveY = m.b * bakedX + m.d * bakedY + m.f;
      project(to, a, b, OUT);
      expect(liveX).toBeCloseTo(OUT.x, 6);
      expect(liveY).toBeCloseTo(OUT.y, 6);
    }
  });
});

describe('OrbitCamera', () => {
  it('starts at the pose that reproduces the classic view', () => {
    const c = new OrbitCamera();
    expect(c.yaw).toBeCloseTo(ISO_YAW, 12);
    expect(c.pitch).toBeCloseTo(ISO_PITCH, 12);
    expect(c.distance).toBe(CAMERA.DEFAULT_DISTANCE);
    expect(c.manual).toBe(false);
    expect(c.zoomMultiplier).toBeCloseTo(1, 12);
  });

  it('wraps yaw at 360° and takes the short way round', () => {
    const c = new OrbitCamera();
    c.rotateBy(350, 0);
    expect(c.targetYaw).toBeGreaterThanOrEqual(0);
    expect(c.targetYaw).toBeLessThan(Math.PI * 2);
    // Ease from 45° toward 35° (350° on) — the short way is backwards.
    const before = c.yaw;
    c.update(16);
    const stepped = c.yaw;
    expect(Math.abs(stepped - before)).toBeLessThan(Math.PI);
  });

  it('clamps pitch to the OSRS-ish range in both directions', () => {
    const c = new OrbitCamera();
    c.rotateBy(0, -400);
    expect(c.targetPitch).toBeCloseTo(CAMERA.PITCH_MIN_DEG * DEG, 9);
    c.rotateBy(0, 400);
    expect(c.targetPitch).toBeCloseTo(CAMERA.PITCH_MAX_DEG * DEG, 9);
  });

  it('clamps zoom to the full-arena view at one end and DISTANCE_MIN at the other', () => {
    const c = new OrbitCamera();
    c.zoomBy(500);
    expect(c.targetDistance).toBeCloseTo(CAMERA.DISTANCE_MIN, 9);
    c.zoomBy(-500);
    expect(c.targetDistance).toBeCloseTo(CAMERA.DISTANCE_MAX, 9);
  });

  it('eases toward the target and eventually parks exactly on it', () => {
    const c = new OrbitCamera();
    c.rotateBy(60, 0);
    expect(c.moving).toBe(true);
    c.update(16);
    expect(c.yaw).not.toBe(c.targetYaw); // glided, did not snap
    for (let i = 0; i < 200 && c.moving; i++) c.update(16);
    expect(c.moving).toBe(false);
    expect(c.yaw).toBe(c.targetYaw);
  });

  it('is framerate independent: many small steps land where one big one does', () => {
    const many = new OrbitCamera();
    const few = new OrbitCamera();
    many.rotateBy(90, 0);
    few.rotateBy(90, 0);
    for (let i = 0; i < 60; i++) many.update(1);
    few.update(60);
    expect(many.yaw).toBeCloseTo(few.yaw, 6);
  });

  it('keeps mouse drag 1:1 with no glide', () => {
    const c = new OrbitCamera();
    c.dragBy(100, 0);
    expect(c.yaw).toBe(c.targetYaw);
    expect(c.yaw).toBeCloseTo(
      ISO_YAW + 100 * CAMERA.DRAG_YAW_DEG_PER_PX * DEG, 9,
    );
  });

  it('flags manual control on any input, and drops it on recentre', () => {
    const c = new OrbitCamera();
    c.zoomBy(1);
    expect(c.manual).toBe(true);
    c.recentre();
    expect(c.manual).toBe(false);
    for (let i = 0; i < 400 && c.moving; i++) c.update(16);
    expect(c.yaw).toBeCloseTo(ISO_YAW, 9);
    expect(c.pitch).toBeCloseTo(ISO_PITCH, 9);
    expect(c.distance).toBeCloseTo(CAMERA.DEFAULT_DISTANCE, 9);
  });

  it('does not fast-forward the view after a long stall', () => {
    const slow = new OrbitCamera();
    const stalled = new OrbitCamera();
    slow.rotateBy(90, 0);
    stalled.rotateBy(90, 0);
    slow.update(250);
    stalled.update(5000);
    expect(stalled.yaw).toBeCloseTo(slow.yaw, 9);
  });

  it('quantises the bake pose so an orbit does not re-bake every frame', () => {
    const c = new OrbitCamera();
    const first = c.bakeYawDeg();
    c.dragBy(1, 0); // well under one bake step
    expect(c.bakeYawDeg()).toBe(first);
    c.dragBy(CAMERA.BAKE_STEP_DEG / CAMERA.DRAG_YAW_DEG_PER_PX, 0);
    expect(c.bakeYawDeg()).not.toBe(first);
  });
});

describe('manual framing', () => {
  it('honours a zoom the must-see clamp would otherwise refuse', () => {
    const w = 640;
    const h = 400;
    const required = { a0: 0, b0: 0, a1: GW, b1: GH };
    const clamped = makeCamera(GW, GH);
    fitCamera(clamped, {
      canvasW: w, canvasH: h, mode: 'iso', zoom: 3, focus: null, required,
    });
    const free = makeCamera(GW, GH);
    fitCamera(free, {
      canvasW: w, canvasH: h, mode: 'iso', zoom: 3, focus: null, required: null,
    });
    expect(free.scale).toBeGreaterThan(clamped.scale);
  });

  it('leaves the tactical view unrotated whatever pose is requested', () => {
    const cam = makeCamera(GW, GH);
    fitCamera(cam, {
      canvasW: 900, canvasH: 560, mode: 'tactical', zoom: 1, focus: null, required: null,
      yaw: 137 * DEG, pitch: 61 * DEG,
    });
    expect(cam.m12).toBe(0);
    expect(cam.m21).toBe(0);
    expect(cam.up).toBe(1);
    expect(cam.flat).toBe(1);
  });
});
