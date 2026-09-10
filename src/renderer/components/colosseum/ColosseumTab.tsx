/**
 * Colosseum tab: Sol Heredit simulator. Owns all configuration state and
 * the sim lifecycle; the engine itself is headless (sim/solHeredit) and
 * this layer only feeds it inputs and reads snapshots.
 *
 * Tick/frame split: this component owns the fixed-timestep accumulator
 * (`host.step`) and the renderer owns the frame loop. The engine is never
 * advanced once per frame — `step` converts wall time into whole 0.6 s
 * ticks, and the renderer interpolates between the last two states. When
 * the run is paused, finished, hidden or scrolled away, the loop is
 * cancelled outright; a single still frame is drawn on demand instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EquipmentPiece, EquipmentSlot, Monster, PlayerLoadout, PlayerSkills } from '@shared/types';
import { SolHereditSim } from '@sim/solHeredit/engine';
import { exportReplay, parseReplay, rehydrate, serializeReplay } from '@sim/solHeredit/replay';
import { summarize } from '@sim/solHeredit/results';
import { CONSUMABLE_INDEX, TICK_MS } from '@sim/solHeredit/constants';
import type {
  AssistOptions, BossOptions, GrappleSlot, InputCommand, InventorySlot, LatencyConfig,
  ReplayFile, ResultsSummary, SimConfig, SimEvent, SimSnapshot, SpecDef,
} from '@sim/solHeredit/types';
import { applySlotChange } from '../../utils/equipment';
import { actionForKey, loadKeymap, type KeyAction } from '../../colosseum/keymap';
import { PRESET_FILES, resolvePreset, type PresetFile } from '../../colosseum/presets';
import {
  deleteProfile, duplicateProfile, exportProfile, importProfile, loadProfiles,
  renameProfile, resolveProfileGear, saveProfile, type ColosseumProfile,
} from '../../colosseum/profiles';
import {
  graphicsKey, loadGraphics, saveGraphics, visualAidsInUse, type QualityTier,
} from '../../arena/options';
import type { SimHost } from '../../arena/renderer';
import { ColosseumRenderer } from '../../colosseum/render/renderer';
import { ArenaStage } from '../arena/ArenaStage';
import { GraphicsPanel } from '../arena/GraphicsPanel';
import {
  AssistsPanel, BossOptionsPanel, KeybindPanel, LatencyPanel, StatsEditor,
} from './ColosseumConfig';
import { GearPanel, InventoryPanel, PresetProfilePanel } from './ColosseumLoadout';
import { ColosseumResults } from './ColosseumResults';
import { GearPickerModal } from '../GearPickerModal';

type Slot = Exclude<EquipmentSlot, '2h'>;
type Equipment = Partial<Record<Slot, EquipmentPiece | null>>;

/** First-order special-attack approximations (single-roll model). */
const SPEC_TABLE: SpecDef[] = [
  { weaponName: 'Voidwaker', energyCost: 50, damageMult: 1.0, accuracyMult: 99 }, // never misses
  { weaponName: 'Dragon claws', energyCost: 50, damageMult: 1.1, accuracyMult: 1.0 },
  { weaponName: 'Burning claws', energyCost: 30, damageMult: 1.0, accuracyMult: 1.05 },
  { weaponName: 'Abyssal dagger', energyCost: 50, damageMult: 0.85, accuracyMult: 1.25 },
];

const DEFAULT_BOSS: BossOptions = {
  startHpPct: 100,
  enabledTransitions: [0.9, 0.75, 0.5, 0.25, 0.1],
  modifierIds: [],
  forcedRotation: [],
  infiniteHp: false,
  practiceMode: 'full',
  practicePhase: 0,
};
const DEFAULT_ASSISTS: AssistOptions = {
  hazardOverlay: false, nextAttackPrediction: false, prayerTimingIndicator: false, safeTileHighlight: false,
};

const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** Ticks the accumulator may catch up in a single frame after a stall. */
const MAX_CATCHUP_TICKS = 4;
const EMPTY_EVENTS: SimEvent[] = [];
const GRAPHICS_KEY = graphicsKey('colosseum');

function download(filename: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ColosseumTab({ equipment, monsters }: {
  equipment: EquipmentPiece[];
  monsters: Monster[];
}) {
  const sol = useMemo(
    () => monsters.find((m) => m.name === 'Sol Heredit' && !m.version.includes('Deadman')) ?? null,
    [monsters],
  );

  // ---------------- configuration state ----------------
  const [gear, setGear] = useState<Equipment>({});
  const [specWeapon, setSpecWeapon] = useState<EquipmentPiece | null>(null);
  const [attackStyle, setAttackStyle] = useState<'stab' | 'slash' | 'crush'>('slash');
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
  const simRef = useRef<SolHereditSim | null>(null);
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
  const [pickingSpec, setPickingSpec] = useState(false);

  speedRef.current = speed;

  // Default to the BiS preset once equipment data is available.
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
    setAttackStyle(p.attackStyle);
    setSkills(p.skills);
    setInventory(p.inventory);
    setLatency(p.latency);
    setActiveProfile(null);
    setNotice(`Loaded preset: ${p.name}`);
  }

  // ---------------- config assembly ----------------
  const buildLoadout = useCallback((): PlayerLoadout => ({
    style: 'melee',
    attackStyle,
    stance: 'aggressive',
    skills,
    prayers: {
      piety: false, chivalry: false, ultimateStrength: false, superhumanStrength: false,
      burstOfStrength: false, incredibleReflexes: false, improvedReflexes: false, clarityOfThought: false,
      rigour: false, eagleEye: false, hawkEye: false, sharpEye: false,
      augury: false, mysticMight: false, mysticLore: false, mysticWill: false,
    },
    potions: { melee: 'none', ranged: 'none', magic: 'none' },
    onSlayerTask: false,
    inWilderness: false,
    equipment: gear,
    spell: null,
  }), [attackStyle, skills, gear]);

  function buildConfig(): SimConfig | null {
    if (!sol) return null;
    const loadout = buildLoadout();
    const gearSets = specWeapon
      ? [{ name: 'Spec', equipment: applySlotChange(gear, 'weapon', specWeapon) }]
      : [];
    return {
      seed: Number(seedText) || 1,
      monster: sol,
      latency,
      boss,
      assists,
      player: { skills, loadout, gearSets, inventory, specs: SPEC_TABLE },
    };
  }

  // ---------------- run lifecycle ----------------
  function startRun(): void {
    const cfg = buildConfig();
    if (!cfg) return;
    simRef.current = new SolHereditSim(cfg);
    accRef.current = 0;
    runIdRef.current++;
    setResults(null);
    setReplayFile(null);
    setVersion((v) => v + 1);
    setRunning(true);
  }

  const finishRun = useCallback((sim: SolHereditSim) => {
    setRunning(false);
    setResults(summarize(sim));
    const file = exportReplay(sim);
    setReplayFile(file);
    setScrubTick(sim.tick);
  }, []);

  /**
   * The simulation half of the render contract. `step` is the fixed-
   * timestep accumulator: it converts scaled wall time into whole engine
   * ticks, so frame rate and speed multiplier can never change what the
   * engine computes. `alpha` is how far into the current tick we are,
   * which is all the renderer needs to interpolate.
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

  // Built once by the stage; assists/weapon are pushed in below.
  const rendererRef = useRef<ColosseumRenderer | null>(null);
  const createRenderer = useCallback((
    canvas: HTMLCanvasElement, h: SimHost<SimSnapshot>, onAuto: (q: QualityTier) => void,
  ) => {
    const r = new ColosseumRenderer(canvas, h, graphicsRef.current, assistsRef.current, {
      onQualityChange: (q, automatic) => { if (automatic) onAuto(q); },
    });
    rendererRef.current = r;
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const graphicsRef = useRef(graphics);
  graphicsRef.current = graphics;
  const assistsRef = useRef(assists);
  assistsRef.current = assists;
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
      case 'pauseResume':
        if (sim && !sim.finished) setRunning((r) => !r);
        return;
      case 'tickStep': tickStep(); return;
      case 'speedUp': setSpeed((s) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(s) + 1)] ?? s); return;
      case 'speedDown': setSpeed((s) => SPEEDS[Math.max(0, SPEEDS.indexOf(s) - 1)] ?? s); return;
      default: break;
    }
    if (!sim || sim.finished) return;
    const pos = sim.getSnapshot().playerPos;
    const dirs: Partial<Record<KeyAction, [number, number]>> = {
      moveN: [0, 1], moveS: [0, -1], moveE: [1, 0], moveW: [-1, 0],
    };
    if (dirs[action]) {
      const [dx, dy] = dirs[action]!;
      queue({ kind: 'move', to: { x: pos.x + dx, y: pos.y + dy }, run: true });
      return;
    }
    const parrySlots: Partial<Record<KeyAction, GrappleSlot>> = {
      parryHead: 'head', parryBody: 'body', parryLegs: 'legs', parryWeapon: 'weapon', parryShield: 'shield',
    };
    if (parrySlots[action]) { queue({ kind: 'parry', slot: parrySlots[action]! }); return; }
    switch (action) {
      case 'protectMelee': queue({ kind: 'pray', prayer: 'protectMelee', on: !sim.player.protectMelee }); break;
      case 'offensivePrayer': queue({ kind: 'pray', prayer: 'offensive', on: !sim.player.offensiveOn }); break;
      case 'eatFood': case 'eatKarambwan': case 'sipRestore': case 'sipBrew': {
        const wantKind = action === 'eatFood' ? 'food' : action === 'eatKarambwan' ? 'karambwan' : 'potion';
        const wantId = action === 'sipRestore' ? 'super_restore' : action === 'sipBrew' ? 'sara_brew' : null;
        const idx = sim.player.inventory.findIndex((s) => {
          if (!s.itemId || s.qty <= 0) return false;
          const def = CONSUMABLE_INDEX.get(s.itemId);
          if (!def) return false;
          return wantId ? s.itemId === wantId : def.kind === wantKind;
        });
        if (idx >= 0) queue({ kind: 'eat', invIndex: idx });
        break;
      }
      case 'spec':
        if (specWeapon) queue({ kind: 'switchGear', setIndex: 1 });
        queue({ kind: 'spec' });
        break;
      default: break;
    }
  }, [queue, specWeapon, running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const action = actionForKey(keys, e.key);
      if (!action) return;
      e.preventDefault();
      handleAction(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, handleAction]);

  // ---------------- replay ----------------
  /** Re-simulate to tick `t` and draw exactly that state. The renderer
   *  snaps rather than tweens across the cut (the run id changed), so a
   *  scrubbed frame shows the engine's real position at that tick. */
  function scrubTo(t: number): void {
    if (!replayFile || !sol) return;
    setScrubTick(t);
    simRef.current = rehydrate(replayFile, sol, t);
    accRef.current = 0;
    runIdRef.current++;
    setVersion((v) => v + 1);
  }

  function importReplayJson(json: string): void {
    if (!sol) return;
    try {
      const file = parseReplay(json);
      const sim = rehydrate(file, sol);
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
  function currentProfile(): ColosseumProfile {
    const gearIds: ColosseumProfile['gear'] = {};
    for (const [slot, piece] of Object.entries(gear) as [Slot, EquipmentPiece | null][]) {
      if (piece) gearIds[slot] = { id: piece.id, version: piece.version };
    }
    return {
      savedAt: Date.now(), gear: gearIds, inventory, skills, latency, boss, assists,
      attackStyle, stance: 'aggressive',
    };
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
    setAttackStyle((['stab', 'slash', 'crush'].includes(p.attackStyle) ? p.attackStyle : 'slash') as 'stab' | 'slash' | 'crush');
    setActiveProfile(name);
    setNotice(`Loaded profile: ${name}`);
  }

  // ---------------- render ----------------
  const sim = simRef.current;
  const snapshot = sim?.getSnapshot() ?? null;
  const visualAids = visualAidsInUse(graphics);

  if (!sol) {
    return (
      <div className="p-8 text-sm text-text-dim">
        Sol Heredit isn't present in the loaded monster data — refresh the OSRS data from
        the header and reopen this tab.
      </div>
    );
  }

  const flickHint = assists.prayerTimingIndicator && snapshot?.bossAttack === 'tripleParry' && snapshot.bossAttackResolveTick > 0
    ? `Flick Protect from Melee ON at tick ${snapshot.bossAttackResolveTick - 1} (now: ${snapshot.tick})`
    : null;

  return (
    <div className="p-5 grid gap-5 grid-cols-[300px_minmax(0,1fr)_320px]">
      {/* Left: setup */}
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
          onExportProfile={(name) => {
            const json = exportProfile(name);
            if (json) download(`colosseum-profile-${name}.json`, json);
          }}
          onImportProfile={(json) => {
            try {
              const { name, profiles: next } = importProfile(json);
              setProfiles(next);
              setNotice(`Imported profile: ${name}`);
            } catch (e) {
              setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          }}
        />
        <GearPanel
          equipment={gear}
          specWeapon={specWeapon}
          onSlotClick={(slot) => { setPickingSpec(false); setPickerSlot(slot); }}
          onSpecClick={() => { setPickingSpec(true); setPickerSlot('weapon'); }}
        />
        <InventoryPanel inventory={inventory} onChange={setInventory} />
        <StatsEditor skills={skills} onChange={setSkills} />
      </aside>

      {/* Middle: arena + controls */}
      <main className="flex flex-col gap-3 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary" onClick={startRun}>
            {sim && !sim.finished ? 'Restart' : 'Start fight'}
          </button>
          <button className="btn" disabled={!sim || sim.finished} onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Resume'}
          </button>
          <button className="btn" disabled={!sim || sim.finished || running} onClick={tickStep} title="Advance one tick (learning mode)">
            Tick +1
          </button>
          <div className="inline-flex rounded border border-border bg-bg-soft p-0.5">
            {SPEEDS.map((s) => (
              <button key={s} className="pill-tab !px-2 !py-0.5 text-xs" data-active={speed === s} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs text-text-dim ml-auto">
            Seed
            <input
              type="text" value={seedText} onChange={(e) => setSeedText(e.target.value)}
              className="num-input w-24"
            />
            <button className="btn text-xs" onClick={() => setSeedText(String(Math.floor(Math.random() * 1e9)))}>🎲</button>
          </label>
        </div>

        {/* HUD */}
        {snapshot && (
          <div className="panel p-3 grid grid-cols-4 gap-3 text-xs tabular-nums">
            <HudBar label="HP" value={snapshot.playerHp} max={snapshot.playerMaxHp} color="var(--c-xp-green, #3fbf5f)" />
            <HudBar label="Prayer" value={snapshot.playerPrayer} max={snapshot.playerMaxPrayer} color="var(--c-cyan, #4ac1c1)" />
            <HudBar label="Run" value={Math.round(snapshot.runEnergy)} max={100} color="#d4af37" />
            <HudBar label="Spec" value={snapshot.specEnergy} max={100} color="#b46ee2" />
            <div className="col-span-4 flex items-center justify-between gap-3 flex-wrap">
              <span>Tick <span className="text-accent">{snapshot.tick}</span></span>
              <span>Sol: <span className="text-osrs-red">{snapshot.bossHp}</span>/{snapshot.bossMaxHp}</span>
              <span>Prayers: {snapshot.activePrayers.join(', ') || 'none'}</span>
              {snapshot.bossAttack && (
                <span className="text-accent">
                  {snapshot.bossAttack}
                  {assists.nextAttackPrediction && snapshot.bossAttackResolveTick > 0
                    && ` (resolves t${snapshot.bossAttackResolveTick})`}
                </span>
              )}
            </div>
            {flickHint && <div className="col-span-4 text-accent font-semibold">{flickHint}</div>}
          </div>
        )}

        <ArenaStage
          host={host}
          graphics={graphics}
          pingMs={latency.pingMs}
          running={running}
          version={version}
          create={createRenderer}
          onTileClick={(x, y) => queue({ kind: 'move', to: { x, y }, run: true })}
          onAutoQuality={onAutoQuality}
        />
        {!sim && (
          <div className="panel w-full p-4 text-center text-sm text-text-dim">
            Configure your loadout and press <span className="text-accent font-semibold">Start fight</span>.
            Move with {keys.moveN.toUpperCase()}/{keys.moveW.toUpperCase()}/{keys.moveS.toUpperCase()}/{keys.moveE.toUpperCase()} or
            click a tile; flick Protect from Melee with {keys.protectMelee.toUpperCase()}.
          </div>
        )}

        {/* Replay controls */}
        {replayFile && (
          <div className="panel p-3 flex items-center gap-3 text-xs flex-wrap">
            <span className="text-text-dim">Replay</span>
            <input
              type="range" min={0} max={replayFile ? (results?.ticks ?? scrubTick) : 0} value={scrubTick}
              onChange={(e) => scrubTo(Number(e.target.value))}
              className="accent-accent flex-1 min-w-[160px]"
            />
            <span className="tabular-nums w-16">t{scrubTick}</span>
            <button className="btn text-xs" onClick={() => sim && download(`sol-heredit-run-${Date.now()}.json`, serializeReplay(sim))}>
              Export
            </button>
            <ReplayImportButton onImport={importReplayJson} />
          </div>
        )}
        {!replayFile && sim === null && <ReplayImportBar onImport={importReplayJson} />}

        {notice && <div className="text-xs text-text-dim">{notice}</div>}
        {results && <ColosseumResults results={results} visualAids={visualAids} />}
      </main>

      {/* Right: fight configuration */}
      <aside className="flex flex-col gap-4 min-w-0">
        <LatencyPanel latency={latency} onChange={setLatency} />
        <BossOptionsPanel boss={boss} onChange={setBoss} />
        <AssistsPanel assists={assists} onChange={setAssists} />
        <GraphicsPanel graphics={graphics} onChange={updateGraphics} autoNotice={autoQualityNotice} />
        <KeybindPanel keys={keys} onChange={setKeys} />
      </aside>

      {pickerSlot && (
        <GearPickerModal
          slot={pickerSlot}
          equipment={equipment}
          current={pickingSpec ? specWeapon : gear[pickerSlot] ?? null}
          ownedOnly={null}
          excludedIds={null}
          loadout={buildLoadout()}
          target={sol}
          onPick={(piece) => {
            if (pickingSpec) setSpecWeapon(piece);
            else setGear((g) => applySlotChange(g, pickerSlot, piece));
            setActiveProfile(null);
          }}
          onClose={() => { setPickerSlot(null); setPickingSpec(false); }}
        />
      )}
    </div>
  );
}

/** Fill is a transform, not a width: scaling composites, width reflows. */
function HudBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-text-faint">{label} {value}/{max}</span>
      <div className="h-2 rounded bg-bg-raised border border-border overflow-hidden">
        <div
          className="h-full w-full origin-left"
          style={{ transform: `scaleX(${frac})`, background: color }}
        />
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
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void f.text().then(onImport);
          e.target.value = '';
        }} />
    </>
  );
}

function ReplayImportBar({ onImport }: { onImport: (json: string) => void }) {
  return (
    <div className="flex justify-center">
      <div className="text-xs text-text-faint flex items-center gap-2">
        Have a saved run? <ReplayImportButton onImport={onImport} />
      </div>
    </div>
  );
}
