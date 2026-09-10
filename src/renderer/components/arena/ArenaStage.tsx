/**
 * The arena stage: one <canvas> owned by React, every pixel inside it
 * owned by an `ArenaRenderer`.
 *
 * React never re-renders per frame — a state change here at most calls
 * `requestStill()` for a single redraw. The renderer is constructed once
 * for the life of the tab; settings flow in through effects.
 */
import { useEffect, useRef } from 'react';
import type { ArenaRenderer, SimHost } from '../../arena/renderer';
import type { GraphicsOptions, QualityTier } from '../../arena/options';

interface Props<S> {
  host: SimHost<S>;
  graphics: GraphicsOptions;
  pingMs: number;
  running: boolean;
  /** Bumped whenever sim state changed outside the loop (scrub, step). */
  version: number;
  /** Built once. Must not close over changing props — use refs instead. */
  create: (canvas: HTMLCanvasElement, host: SimHost<S>, onAutoQuality: (q: QualityTier) => void)
  => ArenaRenderer<S>;
  /** Applied whenever the renderer exists and the value changes. */
  apply?: (renderer: ArenaRenderer<S>) => void;
  onTileClick: (x: number, y: number) => void;
  onAutoQuality: (q: QualityTier) => void;
  /** CSS height of the canvas box. */
  height?: string;
}

export function ArenaStage<S>({
  host, graphics, pingMs, running, version, create, apply, onTileClick, onAutoQuality, height,
}: Props<S>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArenaRenderer<S> | null>(null);

  // Latest callbacks and host, read through refs so the renderer is built
  // once and never torn down because a handler identity changed.
  const clickRef = useRef(onTileClick);
  clickRef.current = onTileClick;
  const qualityRef = useRef(onAutoQuality);
  qualityRef.current = onAutoQuality;
  const hostRef = useRef(host);
  hostRef.current = host;
  const createRef = useRef(create);
  createRef.current = create;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stableHost: SimHost<S> = {
      getSnapshot: () => hostRef.current.getSnapshot(),
      getEvents: () => hostRef.current.getEvents(),
      step: (dt) => hostRef.current.step(dt),
      alpha: () => hostRef.current.alpha(),
      runId: () => hostRef.current.runId(),
    };
    let renderer: ArenaRenderer<S>;
    try {
      renderer = createRef.current(canvas, stableHost, (q) => qualityRef.current(q));
    } catch {
      return; // no 2D context — nothing to draw into
    }
    rendererRef.current = renderer;
    renderer.requestStill();
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { rendererRef.current?.setOptions(graphics); }, [graphics]);
  useEffect(() => { rendererRef.current?.setPing(pingMs); }, [pingMs]);
  useEffect(() => { rendererRef.current?.setRunning(running); }, [running]);
  useEffect(() => {
    const r = rendererRef.current;
    if (r && apply) apply(r);
    r?.requestStill();
  }, [apply]);
  // Scrubbing, tick-step and restarts land here: one frame, no loop.
  useEffect(() => { rendererRef.current?.requestStill(); }, [version]);

  // `touchAction: none` and `userSelect: none` keep a middle-drag from
  // turning into a page gesture or a text selection halfway through a
  // free-look. The camera's own listeners are attached by the renderer
  // (see `arena/cameraInput.ts`) rather than by React, because they need
  // `{ passive: false }` on wheel, which JSX props cannot express.
  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded border border-border-strong bg-bg-slot outline-none"
      tabIndex={0}
      style={{
        height: height ?? 'clamp(320px, 52vh, 620px)',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onClick={(e) => {
        const tile = rendererRef.current?.hitTest(e.clientX, e.clientY);
        if (tile) clickRef.current(tile.x, tile.y);
      }}
    />
  );
}
