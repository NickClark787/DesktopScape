/**
 * Graphics and camera settings, shared by every arena tab.
 *
 * Quality is the machine-friendliness dial; the toggles below it are
 * readability aids. Anything that would make the fight easier to *play*
 * lives in that tab's Assists panel instead — with the exception of the
 * tile grid reference and the tactical view, which are reported alongside
 * the results.
 */
import {
  FPS_CAPS, QUALITY_ORDER, ZOOM_MAX, ZOOM_MIN,
  type GraphicsOptions, type QualityTier, type ViewMode,
} from '../../arena/options';

const QUALITY_LABEL: Record<QualityTier, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const QUALITY_HINT: Record<QualityTier, string> = {
  low: 'Flat fills, no particles, glows or shadows, no tweening, 1× pixel ratio. The cheap path.',
  medium: 'Interpolated motion, textured arena and shadows; no glows, reduced particles.',
  high: 'Everything on: glows, full particle budget, 1.5× pixel ratio.',
};
const VIEW_LABEL: Record<ViewMode, string> = { iso: 'Isometric', tactical: 'Tactical' };

export function GraphicsPanel({ graphics, onChange, autoNotice, followLabel }: {
  graphics: GraphicsOptions;
  onChange: (g: GraphicsOptions) => void;
  autoNotice: string | null;
  /** Tab-specific wording for the follow toggle's tooltip. */
  followLabel?: string;
}) {
  const toggles: Array<[keyof GraphicsOptions, string, string]> = [
    ['showTickBar', 'Tick metronome', 'A 0.6s pulse bar — the rhythm the whole fight runs on.'],
    ['showAttackLabel', 'Name the wind-up', 'Labels the attack the boss is already animating.'],
    ['showTileCoords', 'Tile coordinates', 'Grid reference for learning exact positions. Reported in results.'],
    ['showLatencyIndicator', 'Latency indicator', 'Ghost click marker + in-flight input dots.'],
    ['showPerfHud', 'Performance HUD', 'fps, frame time, dropped frames, live effect counts.'],
  ];
  return (
    <div className="panel">
      <div className="panel-heading flex items-center justify-between">
        <span>Graphics</span>
        <span className="panel-heading-meta">{QUALITY_LABEL[graphics.quality]}</span>
      </div>
      <div className="p-3 flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <span className="text-text-dim text-xs">Quality</span>
          <div className="inline-flex rounded border border-border bg-bg-soft p-0.5">
            {QUALITY_ORDER.map((q) => (
              <button
                key={q}
                className="pill-tab !px-2 !py-0.5 text-xs flex-1"
                data-active={graphics.quality === q}
                title={QUALITY_HINT[q]}
                onClick={() => onChange({ ...graphics, quality: q })}
              >
                {QUALITY_LABEL[q]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer text-xs mt-1">
            <input
              type="checkbox" className="accent-accent" checked={graphics.autoQuality}
              onChange={(e) => onChange({ ...graphics, autoQuality: e.target.checked })}
            />
            <span>Drop a tier automatically if frames run long</span>
          </label>
          {autoNotice && <span className="text-[11px] text-accent">{autoNotice}</span>}
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-text-dim text-xs">View</span>
          <div className="inline-flex rounded border border-border bg-bg-soft p-0.5">
            {(['iso', 'tactical'] as ViewMode[]).map((v) => (
              <button
                key={v}
                className="pill-tab !px-2 !py-0.5 text-xs flex-1"
                data-active={graphics.view === v}
                title={v === 'tactical'
                  ? 'Flat top-down grid: cheapest to render and the clearest for footwork drills. Reported in results.'
                  : 'Isometric arena view.'}
                onClick={() => onChange({ ...graphics, view: v })}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-text-dim text-xs">Camera</span>
          <p className="text-[11px] text-text-faint leading-snug">
            Arrow keys rotate, middle-mouse drag free-looks, the wheel zooms,
            <span className="text-text-dim"> Home</span> re-centres. Purely visual — the camera
            never touches the fight. Fixed in the tactical view.
          </p>
        </div>

        <label className="flex items-center justify-between gap-2">
          <span className="text-text-dim" title="Base framing. The wheel dollies in from here.">
            Zoom
          </span>
          <span className="flex items-center gap-2">
            <input
              type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={graphics.zoom}
              onChange={(e) => onChange({ ...graphics, zoom: Number(e.target.value) })}
              className="accent-accent w-28"
            />
            <span className="tabular-nums w-10 text-right">{graphics.zoom.toFixed(2)}×</span>
          </span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-xs"
          title={followLabel ?? 'Pans toward you when zoomed in — never far enough to push a safe tile off screen.'}>
          <input
            type="checkbox" className="accent-accent" checked={graphics.followPlayer}
            onChange={(e) => onChange({ ...graphics, followPlayer: e.target.checked })}
          />
          <span>Camera follows the player</span>
        </label>

        <div className="flex flex-col gap-1">
          {toggles.map(([key, label, hint]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer text-xs" title={hint}>
              <input
                type="checkbox" className="accent-accent" checked={Boolean(graphics[key])}
                onChange={(e) => onChange({ ...graphics, [key]: e.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="text-text-dim">Frame cap</span>
          <select
            className="bg-bg-raised border border-border rounded px-2 py-1 text-xs outline-none focus:border-accent"
            value={graphics.fpsCap}
            onChange={(e) => onChange({ ...graphics, fpsCap: Number(e.target.value) })}
          >
            {FPS_CAPS.map((f) => <option key={f} value={f}>{f} fps</option>)}
          </select>
        </label>
        <p className="text-[11px] text-text-faint leading-snug">
          The renderer stops entirely when paused, when the window is hidden, or when the arena
          scrolls out of view — it never repaints an idle frame.
        </p>
      </div>
    </div>
  );
}
