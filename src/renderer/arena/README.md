# Arena render core (`renderer/arena`)

The engine-agnostic half of every fight renderer: projection, camera,
render loop, tick-to-frame interpolation, effect pools, quality tiers and
the perf budget. The Colosseum and the Inferno both build on it and
supply only their own art and event handling.

| File | Responsibility |
|---|---|
| `projection.ts` | tile ⇄ screen maths, camera framing (pure, tested) |
| `camera.ts` | the OSRS-style orbit camera + **every tunable** (pure, tested) |
| `cameraInput.ts` | arrow keys / middle-drag / wheel bound to a canvas |
| `shapes.ts` | tile paths, tile-set decoding, text helpers (pure, tested) |
| `effects.ts` | effect pool + particle field (pure, tested) |
| `fxDraw.ts` | drawing for those pools — hitsplats, rings, bursts, beams |
| `options.ts` | graphics settings, quality tiers, persistence |
| `frame.ts` | the per-frame context and the gradient cache |
| `hud.ts` | tick metronome, boss bar, latency, perf overlay, banners |
| `renderer.ts` | `ArenaRenderer`: the loop, camera, interpolation, budget |

React wrappers live in `components/arena/`: `ArenaStage` (owns the
`<canvas>`) and `GraphicsPanel` (the settings UI).

## Grid space

Engine tile space has x growing east and y growing **north**; screens grow
down. Both view modes convert once into grid space `(a, b)`, using the
grid size carried on the `Camera` — that is what lets the same maths serve
the Colosseum's 16×15 box and the Inferno's 25×18 platform:

```
a = x + 0.5                    b = (gh - 1 - y) + 0.5
orbit:     sx = a·m11 + b·m21  sy = a·m12 + b·m22   (2×2 basis, below)
tactical:  sx = a·T·s          sy = b·T·s           (square grid)
```

At the default pose the orbit basis *is* the classic 2:1 diamond —
`sx = (a-b)·HW·s`, `sy = (a+b)·HH·s` — so north reads up-screen and a boss
at the north wall sits at the top of the diamond with the player below.

## Camera

An OSRS-style orbit camera: a pivot (the player's interpolated position)
plus `(yaw, pitch, distance)`. It is **presentation only** — see the rule
below — and lives entirely in `camera.ts` / `cameraInput.ts`.

| Input | Action |
|---|---|
| `←` `→` | yaw, delta-time scaled, eased |
| `↑` `↓` | pitch, delta-time scaled, eased |
| middle-drag | free-look, 1:1 with the cursor, no easing |
| wheel | dolly toward / away from the pivot |
| `Home` | ease back to the default framing |

Every speed, limit and smoothing constant is in the `CAMERA` block at the
top of `camera.ts`. Nothing else hard-codes one.

### It cannot touch the fight

The camera never appears in sim state, never feeds the seeded RNG and is
never read by `advance()`. It is updated from the render loop's wall-clock
delta, not from the tick. `tests/arena/determinism.test.ts` enforces the
boundary at the source level: nothing under `src/sim` may import anything
under `src/renderer`, so there is no path for a camera value to reach the
engine at all.

The one place it changes *behaviour* rather than pixels is framing: once
the user moves the camera, `OrbitCamera.manual` goes true and the
must-see clamp (below) is released, because refusing to honour the wheel
would make the control feel broken. Until then, framing is exactly what
it always was.

### The maths

The floor is a plane and the camera projects it affinely, so yaw/pitch
collapse into a 2×2 basis recomputed once per frame by `syncBasis`:

```
R = ISO_HW·√2      c = cos(yaw)   s = sin(yaw)   k = sin(pitch)
m11 =  R·scale·c        m21 = -R·scale·s
m12 =  R·scale·s·k      m22 =  R·scale·c·k
```

`yaw = 45°, pitch = 30°` reproduces `ISO_HW`/`ISO_HH` exactly. Three
consequences the renderer leans on:

- **Depth** is the screen-y component (`depthOf`), so painter's order
  follows the camera round instead of assuming a fixed `a + b`.
- **Ground circles** stay axis-aligned ellipses at any yaw; only their
  height changes. That is `cam.flat`, and it is the entire correction
  needed for shadows, rings and glow pools.
- **Baked layers survive an orbit.** A layer baked at one pose re-projects
  exactly onto another through `blitTransform` — so tiles, grid lines and
  labels are pixel-exact from a stale bake, and the bake pose is quantised
  to `CAMERA.BAKE_STEP_DEG` rather than re-baking ~600 path ops per frame.
  Only extruded scenery is approximated in between, and only while the
  camera is actually moving.

Upright art (actors, pillars, spectators) is foreshortened by `cam.up` via
one context transform anchored at the ground point — `beginUpright` /
`endUpright` — so no art constant had to change.

Tactical mode is deliberately **not** orbitable: it is a fixed top-down
grid for footwork drilling, and camera input is ignored there.

## Tick-to-frame interpolation

The engine steps in whole 0.6 s ticks. The renderer draws at up to
`fpsCap` and interpolates. Each frame:

1. `host.step(dtMs)` — the sim owner (the tab) adds scaled wall time to an
   accumulator and calls `advance()` **zero or more** times. Fixed
   timestep: frame rate and the speed multiplier cannot change what the
   engine computes.
2. `host.alpha()` — progress into the current tick, 0..1.
3. If the tick changed, keep the previous captured state, capture the new
   one, and drain new engine events into effect pools.
4. Draw `prev → cur`, blended by alpha.

Only the player's position is interpolated, because it is the only thing
that moves continuously. It is a **lerp between two committed engine
states**, never an extrapolation — at alpha = 1 the drawn position is
exactly the engine's tile.

A tick delta of anything other than +1 (restart, replay scrub, tick-step
after a pause) **snaps**: `prev` is set to `cur`, pools are cleared and
the event cursor jumps to the end. Tweening across a scrub would animate
motion that never happened.

### Stopping

The loop runs while the sim is running **or** the camera is in motion, and
the canvas is visible. Pausing, finishing, `visibilitychange` and an
`IntersectionObserver` miss all `cancelAnimationFrame`. There is no idle
repaint. State changes while stopped call `requestStill()`, which draws
exactly one frame — that is what scrubbing and `Tick +1` use.

A camera-only frame **never** calls `host.step()`, ages an effect pool or
touches the tick: orbiting a paused fight animates the view and nothing
else. Those frames redraw at the tick alpha the loop stopped on, so the
player does not jump back a tile the moment you grab the camera.

Because the loop is stopped, pooled effects are drawn at a fixed `peak`
pose instead of being aged (`fxProgress(fx, animating)`). A tick-stepped
frame therefore still shows its hitsplat and telegraph rather than a
half-faded one or nothing at all.

`prefers-reduced-motion: reduce` disables interpolation and idle
oscillation; positions snap to tiles and effects hold their static pose.

## Quality tiers

`QUALITY` in `options.ts` is the single source of truth for cost. `low` is
meant to be genuinely cheap, not merely less sparkly:

| | low | medium | high |
|---|---|---|---|
| backing-store DPR cap | 1 | 1.25 | 1.5 |
| interpolation | off (snap) | on | on |
| floor grain, bevels, crowd figures | off | on | on |
| shadows | off | on | on |
| glows / gradients on telegraphs | off | off | on |
| particles | 0 | 60 | 160 |
| live effects | 24 | 48 | 72 |

DPR is the biggest lever: fill rate dominates on a weak GPU, and 1.5× the
backing store is 2.25× the pixels. Pools are always allocated at the
**high** cap and simply used less at lower tiers, so changing tier never
allocates; effects parked beyond the new cap are retired on the next
spawn.

**Auto-downgrade** (on by default): when the smoothed draw cost sits above
80 % of the frame budget for 2 s, the renderer drops one tier and tells
the tab, which persists it and shows a notice. Deliberately one-way —
auto-upgrading oscillates the moment the cheaper tier fits.

Settings are stored per tab (`graphicsKey('colosseum')`,
`graphicsKey('inferno')`): the two scenes have very different costs, so a
tier that suits one need not suit the other.

## 2D canvas only

No WebGL, no Three.js, no shader pipeline — a prior VRAM leak on this
machine came from an OpenGL path. Each arena is one `<canvas>` plus one
offscreen canvas for its baked static layer; nothing in a fight animates
via DOM nodes. Non-canvas UI animates transform/opacity only.

Tile passes are batched: a Colosseum shield slam marks ~230 tiles and
costs **one** path and **one** fill, not 230.

## Writing a fight renderer

Subclass `ArenaRenderer<TSnapshot>` and implement:

| Hook | Purpose |
|---|---|
| `tickOf(s)` | read the engine tick |
| `playerTileOf(s, out)` | the tile to interpolate |
| `isFinished(s)` / `outcomeBanner(s)` | end-of-run banner |
| `assistCount()` | drives the honesty chip |
| `pendingInputCount(s)` | latency badge |
| `requiredRect(s, px, py, out)` | what must stay framed |
| `onTickAdvanced(s)` | drain events → effects |
| `drawScene(ctx, s, w, h, px, py)` | the arena itself |

Optional overrides: `keepVisible` (nudge the camera for art that stands
above its tiles — use `nudgeForHeadroom`), `onReset`, `onDestroy` (release
baked layers), `backgroundColor`, `idleMessage`.

The base class handles the loop, the camera, the pools, the shared HUD and
the perf budget. Both existing renderers are ~400 lines because of it.

## Adding a visual effect without allocating

The draw loop must not allocate. The pattern:

1. **Pick a pooled kind.** Add a member to `FxKind` in `effects.ts` and a
   `case` in `drawEffects` (`fxDraw.ts`). `Fx` is one flat struct with a
   `kind` tag — deliberately not a class hierarchy, so the pool stays
   monomorphic and there is nothing to collect mid-fight.
2. **Spawn on a tick, from an engine event.** All spawning happens in
   `onTickAdvanced`, which runs once per tick. Anything that allocates —
   notably `String(damage)` for a hitsplat label — belongs there, assigned
   to `fx.text`. Never build a string in a draw routine.
3. **Respect the tier.** Call `this.fx.spawn(q.maxEffects)`; for
   particles pass `q.maxParticles` as the limit to `ParticleField.emit`.
   `spawn()` recycles the oldest slot when saturated and never calls
   `new`.
4. **Draw from scratch state.** Project into module-level scratch points;
   do not create `{x, y}` objects. Numbers you print come from `numStr()`
   or a pre-built label table. Colours come from `FX_FILL`; gradients from
   a `GradientCache` subclass, which builds each one once per context and
   scale.
5. **Handle the frozen case.** Derive progress with
   `fxProgress(fx, f.animating)` so the effect has a sensible pose when
   the loop is stopped.

Deterministic scatter uses `jitter(eventIndex)` rather than
`Math.random()`, so scrubbing a replay back and forth reproduces the same
picture.

## Tests

`tests/colosseum/render.test.ts` and `tests/inferno/render.test.ts` cover
the pure parts under vitest's node environment — no DOM: tile round-trips
in both views and both arena sizes, orientation, exact `project` /
`unproject` inversion, the camera's must-see clamp, pool recycling and
tier caps, tile-set decoding checked against each engine's own geometry,
and the monotonicity of the quality tiers.

`tests/arena/camera.test.ts` covers the orbit camera: that the default
pose reproduces the 2:1 isometric projection bit-for-bit, tile round-trips
and exact inversion at five poses, depth order reversing when the camera
swings behind an actor, `worldBounds` against the projected corners,
`blitTransform` re-projecting a bake onto a different pose, and the
camera's own behaviour — yaw wrap taking the short way, pitch and zoom
clamps, framerate-independent easing, 1:1 drag, and bake quantisation.

`tests/arena/determinism.test.ts` enforces the sim/view boundary.
