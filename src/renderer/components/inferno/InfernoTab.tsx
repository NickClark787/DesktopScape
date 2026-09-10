/**
 * Inferno tab: TzKal-Zuk (wave 69) simulator. Owns configuration + the sim
 * lifecycle; the engine (sim/tzkalZuk) is headless and this layer only feeds
 * inputs and reads snapshots.
 *
 * Tick/frame split, identical to the Colosseum tab: this component owns
 * the fixed-timestep accumulator (`host.step`) and the renderer owns the
 * frame loop. The engine is never advanced once per frame — `step`
 * converts wall time into whole 0.6 s ticks and the renderer interpolates
 * between the last two states. Paused, finished, hidden or scrolled away,
 * the loop is cancelled outright; a single still frame is drawn on demand.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EquipmentPiece, EquipmentSlot, Monster, PlayerLoadout, PlayerSkills } from '@shared/types';
import { TzKalZukSim } from '@sim/tzkalZuk/engine';
import { exportReplay, parseReplay, rehydrate, serializeReplay } from '@sim/tzkalZuk/replay';
import { summarize } from '@sim/tzkalZuk/results';
import { CONSUMABLE_INDEX, TICK_MS } from '@sim/tzkalZuk/constants';
import type {
  AssistOptions, BossOptions, EntityKind, InputCommand, InventorySlot, LatencyConfig,
  Overhead, ReplayFile, ResultsSummary, SimConfig, SimEvent, SimSnapshot,
} from '@sim/tzkalZuk/types';
import { applySlotChange } from '../../utils/equipment';
import { actionForKey, loadKeymap, type KeyAction } from '../../inferno/keymap';
import { PRESET_FILES, resolvePreset, type PresetFile } from '../../inferno/presets';
import {
  deleteProfile, duplicateProfile, exportProfile, importProfile, loadProfiles,
  renameProfile, resolveProfileGear, saveProfile, type InfernoProfile,
} from '../../inferno/profiles';
import {
  graphicsKey, loadGraphics, saveGraphics, visualAidsInUse, type QualityTier,
} from '../../arena/options';
import type { SimHost } from '../../arena/renderer';
import { InfernoRenderer } from '../../inferno/render/renderer';
import { ArenaStage } from '../arena/ArenaStage';
import { GraphicsPanel } from '../arena/GraphicsPanel';
import { AssistsPanel, BossOptionsPanel, KeybindPanel, LatencyPanel, StatsEditor } from './InfernoConfig';
import { GearPanel, InventoryPanel, PresetProfilePanel } from './InfernoLoadout';
import { InfernoResults } from './InfernoResults';
import { GearPickerModal } from '../GearPickerModal';

type Slot = Exclude<EquipmentSlot, '2h'>;
type Equipment = Partial<Record<Slot, EquipmentPiece | null>>;

const DEFAULT_BOSS: BossOptions = { startHpPct: 100, modifierIds: [], freezeGlyph: false, practiceMode: 'full' };
const DEFAULT_ASSISTS: AssistOptions = { glyphSafeHighlight: false, addTimers: false, jadPrayerIndicator: false, setCountdown: false };
const SPEEDS = [0.25, 0.5, 1, 2, 4];
const ADD_IDS: Record<EntityKind, number> = {
  zuk: 7706, ranger: 7698, mager: 7699, jad: 7700, healer: 7708, jadHealer: 7701,
};

/** Ticks the accumulator may catch up in a single frame after a stall. */
const MAX_CATCHUP_TICKS = 4;
const EMPTY_EVENTS: SimEvent[] = [];
const GRAPHICS_KEY = graphicsKey('inferno');

function download(filename: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function InfernoTab({ equipment, monsters }: { equipment: EquipmentPiece[]; monsters: Monster[] }) {
  const zuk = useMemo(
    () => monsters.find((m) => m.id === 7706 && m.version === 'Normal') ?? monsters.find((m) => m.id === 7706) ?? null,
    [monsters],
  );
  const addMonsters = useMemo(() => {
    const out: Partial<Record<EntityKind, Monster>> = {};
    for (const kind of ['ranger', 'mager', 'jad', 'healer', 'jadHealer'] as const) {
      const m = monsters.find((x) => x.id === ADD_IDS[kind]);
      if (m) out[kind] = m;
    }
    return out;
  }, [monsters]);

  // ---------------- configuration ----------------
  const [gear, setGear] = useState<Equipment>({});
  const [skills, setSkills] = useState<PlayerSkills>({ atk: 99, str: 99, def: 99, hp: 99, magic: 99, ranged: 99, prayer: 99 });
  const [inventory, setInventory] = useState<InventorySlot[]>(() => Array.from({ length: 28 }, () => ({ itemId: null, qty: 0 })));
  const [latency, setLatency] = useState<LatencyConfig>({ pingMs: 0, jitterMs: 0, packetLossPct: 0 });
  const [boss, setBoss] = useState<BossOptions>(DEFAULT_BOSS);
  const [assists, setAssists] = useState<AssistOptions>(DEFAULT_ASSISTS);
  const [keys, setKeys] = useState(loadKeymap);
  const [seedText, setSeedText] = useState(() => String(Math.floor(Math.random() * 1e9)));
  const [profiles, setProfiles] = useState(loadProfiles);
  const [activeProfile, setActiveProfile] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [graphics, setGraphics] = useState(() => loadGraphics(GRAPHICS_KEY));
  const [autoQualityNotice, setAutoQualityNotice] = useState<string | null>(null);

  // ---------------- sim state ----------------
  const simRef = useRef<TzKalZukSim | null>(null);
  const accRef = useRef(0);
  /** Bumped whenever the sim instance is replaced, so the renderer knows
   *  to drop its interpolation history instead of tweening across a cut. */
  const runIdRef = useRef(0);
  const speedRef = useRef(1);
  const [speed, setSpeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [version, setVersion] = useState(0);
  const [results, setResults] = useState<ResultsSummary | null>(null);
  const [replayFile, setReplayFile] = useState<ReplayFile | null>(null);
  const [scrubTick, setScrubTick] = useState(0);
  const [pickerSlot, setPickerSlot] = useState<Slot | null>(null);
  speedRef.current = speed;

  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || equipment.length === 0) return;
    initialized.current = true;
    applyPreset(PRESET_FILES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment]);

  function applyPreset(file: PresetFile): void {
    const p = resolvePreset(file, equipment);
    setGear(p.equipment);
    setSkills(p.skills);
    setInventory(p.inventory);
    setLatency(p.latency);
    setActiveProfile(null);
    setNotice(`Loaded preset: ${p.name}`);
  }

  const buildLoadout = useCallback((): PlayerLoadout => ({
    style: 'ranged',
    attackStyle: 'ranged',
    stance: 'rapid',
    skills,
    prayers: {
      piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
      burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
      rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
      augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
    },
    potions: { melee: 'none', ranged: 'none', magic: 'none' },
    onSlayerTask: false, inWilderness: false,
    equipment: gear,
    spell: null,
  }), [skills, gear]);

  function buildConfig(): SimConfig | null {
    if (!zuk) return null;
    return {
      seed: Number(seedText) || 1,
      monster: zuk,
      addMonsters,
      latency, boss, assists,
      player: { skills, loadout: buildLoadout(), gearSets: [], inventory },
    };
  }

  // ---------------- lifecycle ----------------
  function startRun(): void {
    const cfg = buildConfig();
    if (!cfg) return;
    simRef.current = new TzKalZukSim(cfg);
    accRef.current = 0;
    runIdRef.current++;
    setResults(null);
    setReplayFile(null);
    setVersion((v) => v + 1);
    setRunning(true);
  }

  const finishRun = useCallback((sim: TzKalZukSim) => {
    setRunning(false);
    setResults(summarize(sim));
    setReplayFile(exportReplay(sim));
    setScrubTick(sim.tick);
  }, []);

  /**
   * The simulation half of the render contract. `step` is the fixed-
   * timestep accumulator: it converts scaled wall time into whole engine
   * ticks, so frame rate and speed multiplier can never change what the
   * engine computes. `alpha` is how far into the current tick we are —
   * all the renderer needs to interpolate.
   */
  const host = useMemo<SimHost<SimSnapshot>>(() => ({
    getSnapshot: () => simRef.current?.getSnapshot() ?? null,
    getEvents: () => (simRef.current?.events ?? EMPTY_EVENTS) as readonly SimEvent[],
    alpha: () => Math.min(1, accRef.current / TICK_MS),
    runId: () => runIdRef.current,
    step: (dtMs: number) => {
      const sim = simRef.current;
      if (!sim || sim.finished) return;
      accRef.current += dtMs * speedRef.current;
      // Guard a long stall (alt-tab, GC pause) from fast-forwarding the
      // fight: catch up at most a handful of ticks per frame.
      if (accRef.current > TICK_MS * MAX_CATCHUP_TICKS) {
        accRef.current = TICK_MS * MAX_CATCHUP_TICKS;
      }
      let advanced = false;
      while (accRef.current >= TICK_MS && !sim.finished) {
        accRef.current -= TICK_MS;
        sim.advance();
        advanced = true;
      }
      if (advanced) setVersion((v) => v + 1);
      if (sim.finished) finishRun(sim);
    },
  }), [finishRun]);

  function tickStep(): void {
    const sim = simRef.current;
    if (!sim || sim.finished || running) return;
    accRef.current = 0;
    sim.advance();
    setVersion((v) => v + 1);
    if (sim.finished) finishRun(sim);
  }

  const onAutoQuality = useCallback((q: QualityTier) => {
    setGraphics((g) => {
      const next = { ...g, quality: q };
      saveGraphics(GRAPHICS_KEY, next);
      return next;
    });
    setAutoQualityNotice(`Frames were running long — quality dropped to ${q}.`);
  }, []);

  const updateGraphics = useCallback((g: typeof graphics) => {
    setGraphics(g);
    saveGraphics(GRAPHICS_KEY, g);
    setAutoQualityNotice(null);
  }, []);

  // Built once by the stage; assists are pushed in below.
  const rendererRef = useRef<InfernoRenderer | null>(null);
  const graphicsRef = useRef(graphics);
  graphicsRef.current = graphics;
  const assistsRef = useRef(assists);
  assistsRef.current = assists;
  const createRenderer = useCallback((
    canvas: HTMLCanvasElement, h: SimHost<SimSnapshot>, onAuto: (q: QualityTier) => void,
  ) => {
    const r = new InfernoRenderer(canvas, h, graphicsRef.current, assistsRef.current, {
      onQualityChange: (q, automatic) => { if (automatic) onAuto(q); },
    });
    rendererRef.current = r;
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { rendererRef.current?.setAssists(assists); }, [assists]);

  // ---------------- inputs ----------------
  const queue = useCallback((cmd: InputCommand) => {
    const sim = simRef.current;
    if (!sim || sim.finished) return;
    const msIntoTick = running ? Math.min(599, Math.max(0, Math.floor(accRef.current))) : 0;
    sim.queueInput({ cmd, clientTick: sim.tick, msIntoTick });
  }, [running]);

  const handleAction = useCallback((action: KeyAction) => {
    const sim = simRef.current;
    switch (action) {
      case 'pauseResume': if (sim && !sim.finished) setRunning((r) => !r); return;
      case 'tickStep': tickStep(); return;
      case 'speedUp': setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)] ?? s); return;
      case 'speedDown': setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)] ?? s); return;
      default: break;
    }
    if (!sim || sim.finished) return;
    const snap = sim.getSnapshot();
    const dirs: Partial<Record<KeyAction, [number, number]>> = { moveN: [0, 1], moveS: [0, -1], moveE: [1, 0], moveW: [-1, 0] };
    if (dirs[action]) {
      const [dx, dy] = dirs[action]!;
      queue({ kind: 'move', to: { x: snap.playerPos.x + dx, y: snap.playerPos.y + dy }, run: true });
      return;
    }
    const overheads: Partial<Record<KeyAction, Overhead | null>> = {
      prayMagic: 'magic', prayRanged: 'ranged', prayMelee: 'melee', prayOff: null,
    };
    if (action in overheads) { queue({ kind: 'pray', overhead: overheads[action] ?? null }); return; }
    switch (action) {
      case 'offensivePrayer': queue({ kind: 'prayOffensive', on: !sim.player.offensiveOn }); break;
      case 'targetZuk': queue({ kind: 'target', entityId: 0 }); break;
      case 'targetNext': {
        const adds = snap.entities.filter((e) => e.kind !== 'zuk' && e.hp > 0);
        if (adds.length) {
          const cur = adds.findIndex((e) => e.id === snap.targetId);
          const next = adds[(cur + 1) % adds.length];
          queue({ kind: 'target', entityId: next.id });
        }
        break;
      }
      case 'eatFood': case 'eatKarambwan': case 'sipRestore': case 'sipBrew': {
        const wantKind = action === 'eatFood' ? 'food' : action === 'eatKarambwan' ? 'karambwan' : 'potion';
        const wantId = action === 'sipRestore' ? 'super_restore' : action === 'sipBrew' ? 'saradomin_brew' : null;
        const idx = sim.player.inventory.findIndex((s) => {
          if (!s.itemId || s.qty <= 0) return false;
          const def = CONSUMABLE_INDEX.get(s.itemId);
          if (!def) return false;
          return wantId ? s.itemId === wantId : def.kind === wantKind;
        });
        if (idx >= 0) queue({ kind: 'eat', invIndex: idx });
        break;
      }
      default: break;
    }
  }, [queue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const action = actionForKey(keys, e.key === 'Tab' ? 'tab' : e.key);
      if (!action) return;
      e.preventDefault();
      handleAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, handleAction]);

  // ---------------- replay ----------------
  /** Re-simulate to tick `t` and draw exactly that state. The renderer
   *  snaps rather than tweens across the cut (the run id changed). */
  function scrubTo(t: number): void {
    if (!replayFile || !zuk) return;
    setScrubTick(t);
    simRef.current = rehydrate(replayFile, zuk, addMonsters, t);
    accRef.current = 0;
    runIdRef.current++;
    setVersion((v) => v + 1);
  }
  function importReplayJson(json: string): void {
    if (!zuk) return;
    try {
      const file = parseReplay(json);
      const sim = rehydrate(file, zuk, addMonsters);
      simRef.current = sim;
      accRef.current = 0;
      runIdRef.current++;
      setReplayFile(file);
      setResults(summarize(sim));
      setScrubTick(sim.tick);
      setRunning(false);
      setVersion((v) => v + 1);
      setNotice('Replay imported.');
    } catch (e) {
      setNotice(`Replay import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------- profiles ----------------
  function currentProfile(): InfernoProfile {
    const gearIds: InfernoProfile['gear'] = {};
    for (const [slot, piece] of Object.entries(gear) as [Slot, EquipmentPiece | null][]) {
      if (piece) gearIds[slot] = { id: piece.id, version: piece.version };
    }
    return { savedAt: Date.now(), gear: gearIds, inventory, skills, latency, boss, assists };
  }
  function loadProfileByName(name: string): void {
    const p = profiles[name];
    if (!p) return;
    setGear(resolveProfileGear(p.gear, equipment));
    setInventory(p.inventory.map((s) => ({ ...s })));
    setSkills({ ...p.skills });
    setLatency({ ...p.latency });
    setBoss({ ...p.boss });
    setAssists({ ...p.assists });
    setActiveProfile(name);
    setNotice(`Loaded profile: ${name}`);
  }

  /**
   * A click on the arena targets whichever add covers that tile, and
   * otherwise walks there — the same "click the monster or click the
   * ground" resolution the real client does. It lives here rather than in
   * the renderer because it is a game decision, not a drawing one.
   */
  const handleArenaClick = useCallback((x: number, y: number) => {
    const snap = simRef.current?.getSnapshot();
    if (snap) {
      for (const e of snap.entities) {
        if (!e.alive || e.hp <= 0) continue;
        if (x >= e.pos.x && x < e.pos.x + e.size && y >= e.pos.y && y < e.pos.y + e.size) {
          queue({ kind: 'target', entityId: e.id });
          return;
        }
      }
    }
    queue({ kind: 'move', to: { x, y }, run: true });
  }, [queue]);

  // ---------------- render ----------------
  const sim = simRef.current;
  const snapshot = sim?.getSnapshot() ?? null;
  const visualAids = visualAidsInUse(graphics);

  if (!zuk) {
    return (
      <div className="p-8 text-sm text-text-dim">
        TzKal-Zuk isn't present in the loaded monster data — refresh the OSRS data from the
        header and reopen this tab.
      </div>
    );
  }

  const overheadLabel = snapshot?.overhead ? `Protect ${snapshot.overhead}` : 'none';

  return (
    <div className="p-5 grid gap-5 grid-cols-[300px_minmax(0,1fr)_320px]">
      <aside className="flex flex-col gap-4 min-w-0">
        <PresetProfilePanel
          presets={PRESET_FILES}
          onLoadPreset={applyPreset}
          profiles={profiles}
          activeName={activeProfile}
          onSaveProfile={(name) => { setProfiles(saveProfile(name, currentProfile())); setActiveProfile(name); }}
          onLoadProfile={loadProfileByName}
          onDeleteProfile={(name) => { setProfiles(deleteProfile(name)); if (activeProfile === name) setActiveProfile(null); }}
          onRenameProfile={(from, to) => { setProfiles(renameProfile(from, to)); if (activeProfile === from) setActiveProfile(to); }}
          onDuplicateProfile={(name) => setProfiles(duplicateProfile(name))}
          onExportProfile={(name) => { const json = exportProfile(name); if (json) download(`inferno-profile-${name}.json`, json); }}
          onImportProfile={(json) => {
            try { const { name, profiles: next } = importProfile(json); setProfiles(next); setNotice(`Imported profile: ${name}`); }
            catch (e) { setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
          }}
        />
        <GearPanel equipment={gear} onSlotClick={(slot) => setPickerSlot(slot)} />
        <InventoryPanel inventory={inventory} onChange={setInventory} />
        <StatsEditor skills={skills} onChange={setSkills} />
      </aside>

      <main className="flex flex-col gap-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={startRun}>{sim && !sim.finished ? 'Restart' : 'Start fight'}</button>
          <button className="btn" disabled={!sim || sim.finished} onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Resume'}</button>
          <button className="btn" disabled={!sim || sim.finished || running} onClick={tickStep} title="Advance one tick">Tick +1</button>
          <div className="inline-flex rounded border border-border bg-bg-soft p-0.5">
            {SPEEDS.map((s) => (
              <button key={s} className="pill-tab !px-2 !py-0.5 text-xs" data-active={speed === s} onClick={() => setSpeed(s)}>{s}x</button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs text-text-dim ml-auto">
            Seed
            <input type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)} className="num-input w-24" />
            <button className="btn text-xs" onClick={() => setSeedText(String(Math.floor(Math.random() * 1e9)))}>🎲</button>
          </label>
        </div>

        {snapshot && (
          <div className="panel p-3 grid grid-cols-4 gap-3 text-xs tabular-nums">
            <HudBar label="HP" value={snapshot.playerHp} max={snapshot.playerMaxHp} color="#3fbf5f" />
            <HudBar label="Prayer" value={snapshot.playerPrayer} max={snapshot.playerMaxPrayer} color="#4ac1c1" />
            <HudBar label="Run" value={Math.round(snapshot.runEnergy)} max={100} color="#d4af37" />
            <HudBar label="Glyph" value={snapshot.glyphHp} max={snapshot.glyphMaxHp} color="#78c8ff" />
            <div className="col-span-4 flex items-center justify-between gap-3 flex-wrap">
              <span>Tick <span className="text-accent">{snapshot.tick}</span></span>
              <span>Zuk <span className="text-osrs-red">{snapshot.zukHp}</span>/{snapshot.zukMaxHp}{snapshot.enraged && <span className="text-osrs-red"> (enraged)</span>}</span>
              <span className={snapshot.playerBehindGlyph ? 'text-osrs-green' : snapshot.glyphDestroyed ? 'text-osrs-red' : 'text-accent'}>
                {snapshot.glyphDestroyed ? 'shield down!' : snapshot.playerBehindGlyph ? 'protected' : 'EXPOSED — move behind glyph'}
              </span>
              <span>Overhead: {overheadLabel}</span>
              {assists.setCountdown && snapshot.setCountdown >= 0 && <span className="text-accent">next set: {snapshot.setCountdown}t</span>}
            </div>
          </div>
        )}

        <ArenaStage
          host={host}
          graphics={graphics}
          pingMs={latency.pingMs}
          running={running}
          version={version}
          create={createRenderer}
          onTileClick={handleArenaClick}
          onAutoQuality={onAutoQuality}
        />
        {!sim && (
          <div className="panel w-full p-4 text-center text-sm text-text-dim">
            Configure your loadout and press <span className="text-accent font-semibold">Start fight</span>.
            Shuffle with {keys.moveW.toUpperCase()}/{keys.moveE.toUpperCase()} to stay behind the glyph; switch overheads with
            {' '}{keys.prayMagic}/{keys.prayRanged} for the magers and Jad; click an add to target it.
          </div>
        )}

        {replayFile && (
          <div className="panel p-3 flex items-center gap-3 text-xs flex-wrap">
            <span className="text-text-dim">Replay</span>
            <input type="range" min={0} max={results?.ticks ?? scrubTick} value={scrubTick}
              onChange={(e) => scrubTo(Number(e.target.value))} className="accent-accent flex-1 min-w-[160px]" />
            <span className="tabular-nums w-16">t{scrubTick}</span>
            <button className="btn text-xs" onClick={() => sim && download(`zuk-run-${Date.now()}.json`, serializeReplay(sim))}>Export</button>
            <ReplayImportButton onImport={importReplayJson} />
          </div>
        )}
        {!replayFile && sim === null && (
          <div className="flex justify-center">
            <div className="text-xs text-text-faint flex items-center gap-2">Have a saved run? <ReplayImportButton onImport={importReplayJson} /></div>
          </div>
        )}

        {notice && <div className="text-xs text-text-dim">{notice}</div>}
        {results && <InfernoResults results={results} visualAids={visualAids} />}
      </main>

      <aside className="flex flex-col gap-4 min-w-0">
        <LatencyPanel latency={latency} onChange={setLatency} />
        <BossOptionsPanel boss={boss} onChange={setBoss} />
        <AssistsPanel assists={assists} onChange={setAssists} />
        <GraphicsPanel
          graphics={graphics}
          onChange={updateGraphics}
          autoNotice={autoQualityNotice}
          followLabel="Pans toward you when zoomed in — never far enough to push the glyph or Zuk off screen."
        />
        <KeybindPanel keys={keys} onChange={setKeys} />
      </aside>

      {pickerSlot && (
        <GearPickerModal
          slot={pickerSlot}
          equipment={equipment}
          current={gear[pickerSlot] ?? null}
          ownedOnly={null}
          excludedIds={null}
          loadout={buildLoadout()}
          target={zuk}
          onPick={(piece) => { setGear((g) => applySlotChange(g, pickerSlot, piece)); setActiveProfile(null); }}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}

function HudBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-text-faint">{label} {value}/{max}</span>
      <div className="h-2 rounded bg-bg-raised border border-border overflow-hidden">
        <div className="h-full" style={{ width: `${frac * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function ReplayImportButton({ onImport }: { onImport: (json: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn text-xs" onClick={() => ref.current?.click()}>Import</button>
      <input ref={ref} type="file" accept="application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(onImport); e.target.value = ''; }} />
    </>
  );
}
