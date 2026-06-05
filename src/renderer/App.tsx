import { useEffect, useMemo, useState } from 'react';
import { useApp } from './state/store';
import { MonsterPicker } from './components/MonsterPicker';
import { StyleTabs } from './components/StyleTabs';
import { StatsPanel } from './components/StatsPanel';
import { PrayerPanel } from './components/PrayerPanel';
import { PotionPanel } from './components/PotionPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { SpellPicker } from './components/SpellPicker';
import { RaidPanel } from './components/RaidPanel';
import { DefenceReductionPanel } from './components/DefenceReductionPanel';
import { OverridesPanel } from './components/OverridesPanel';
import { OwnedFilterPanel } from './components/OwnedFilterPanel';
import { LoadoutManagerPanel } from './components/LoadoutManagerPanel';
import { DataStalenessBadge } from './components/DataStalenessBadge';
import { GearPickerModal } from './components/GearPickerModal';
import { UpgradeAdvisorPanel } from './components/UpgradeAdvisorPanel';
import { findBestSetup, findBestMeleeSetup, findBestMagicSetup } from '../engine/bestSetup';
import type { UpgradeSuggestion } from '../engine/upgradeAdvisor';
import { calcDps } from '../engine/formulas';
import { rankStyles, styleScores } from './utils/styleRanking';
import type { AttackType, BestSetupCandidate, CombatStyle, EquipmentPiece, EquipmentSlot, Monster, PlayerLoadout, WeaponStance } from '@shared/types';
import type { DataMeta } from '../preload';

/** Per-style cache of optimizer results. One Find-best-setup click fills
 *  all three slots so the user can flip through tabs without recomputing. */
type CandidateCache = Partial<Record<CombatStyle, BestSetupCandidate>>;

export default function App() {
  const state = useApp();
  const [candidates, setCandidates] = useState<CandidateCache>({});
  const [computing, setComputing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [pickerSlot, setPickerSlot] = useState<Exclude<EquipmentSlot, '2h'> | null>(null);

  // The candidate displayed in the metrics block — whatever's cached for
  // the currently-selected style. Switching tabs flips this without any
  // recompute; running Find best setup repopulates all three at once.
  const candidate = candidates[state.style] ?? null;

  // Load data on mount
  useEffect(() => {
    (async () => {
      const data = await window.gearscape.loadData();
      state.hydrate({ equipment: data.equipment as never, monsters: data.monsters as never, meta: data.meta });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMonster = useMemo(
    () => state.monsters.find((m) => m.id === state.selectedMonsterId) ?? null,
    [state.monsters, state.selectedMonsterId],
  );

  // Per-style DPS for the tabs — fed by the candidate cache. Empty when
  // the user hasn't run the optimizer yet for the current monster.
  const dpsByStyle = useMemo<Partial<Record<CombatStyle, number>>>(() => ({
    melee: candidates.melee?.result.dps,
    ranged: candidates.ranged?.result.dps,
    magic: candidates.magic?.result.dps,
  }), [candidates]);

  // Style-tab order, best-to-worst against the selected monster.
  // Pre-run: defence heuristic. Post-run: actual DPS from the cache.
  // When no monster is selected the canonical order is returned, so the
  // tab strip doesn't shuffle on first load.
  const styleOrder = useMemo(() => rankStyles(selectedMonster, dpsByStyle), [selectedMonster, dpsByStyle]);
  const styleLeaderHint = useMemo(() => {
    if (!selectedMonster) return undefined;
    const leader = styleOrder[0];
    const dps = dpsByStyle[leader];
    if (dps !== undefined) {
      // Post-run: name the actual winner with its DPS number.
      return `Best vs ${selectedMonster.name} — ${leader} computed at ${dps.toFixed(2)} DPS`;
    }
    // Pre-run: fall back to the defence-heuristic explanation.
    const scores = styleScores(selectedMonster);
    return `Best vs ${selectedMonster.name} — ${leader} faces lowest defence (${scores[leader]})`;
  }, [selectedMonster, styleOrder, dpsByStyle]);

  /**
   * Style-tab click handler. With per-style caching, switching tabs is
   * cheap: we look up the cached candidate for the new style and push its
   * equipment (and spell, for magic) to the store so the gear grid + DPS
   * metrics update instantly. No optimizer re-run needed — Find best setup
   * already populated all three styles in one pass.
   *
   * If the user hasn't run the optimizer yet (or ran it for a different
   * monster), the cache is empty for that style — push an empty equipment
   * map so the grid resets to "click any slot" mode.
   */
  function handleStyleChange(s: CombatStyle) {
    state.setStyle(s);
    const cached = candidates[s];
    if (cached) {
      state.setEquipment(cached.equipment);
      if (s === 'magic' && cached.spell !== undefined) state.setSpell(cached.spell);
      if (cached.stance !== undefined) state.setStance(cached.stance);
    } else {
      state.setEquipment({});
    }
  }

  /**
   * Monster-pick handler. Every cached candidate's DPS / accuracy / effects
   * are monster-specific (TBow scales off magic level, Salve fires on
   * undead, raid scaling differs per fight), so swapping the target
   * invalidates all three style caches. The user re-runs Find best setup
   * to repopulate.
   *
   * Equipment is *not* cleared — gear that worked on Vorkath might still
   * be the user's intent for Zulrah, and the picker's per-row DPS column
   * will recompute against the new target on its own.
   */
  function handleMonsterSelect(id: number) {
    setCandidates({});
    state.setMonster(id);
  }

  /**
   * Run the optimizer for one style against the selected monster. Factored
   * out so runOptimizer can iterate cleanly across all three styles, and
   * so each call site uses the same option-flow (overrides, owned filter,
   * style-coupled attackStyle defaults).
   *
   * Force-overrides:
   * - forceStance flows to all three style runs; engines that don't use
   *   the user's pinned stance (e.g. melee aggressive on a ranged run)
   *   silently fall back to defaults.
   * - forceAttackStyle is melee-only — only the melee path consumes it.
   */
  function runOptimizerForStyle(
    style: CombatStyle,
    base: PlayerLoadout,
    monster: Monster,
    forceStance: WeaponStance | undefined,
    forceAttackStyle: AttackType | undefined,
    ownedOnly: Set<number> | null,
  ): BestSetupCandidate | null {
    const styled: PlayerLoadout = { ...base, style, attackStyle: style === 'melee' ? 'slash' : style };
    if (style === 'melee') {
      return findBestMeleeSetup(styled, monster, state.equipment, {
        shortlistPerSlot: 5,
        forceStance,
        ownedOnly,
        forceAttackStyle: (forceAttackStyle as 'stab' | 'slash' | 'crush') ?? undefined,
      });
    }
    if (style === 'magic') {
      return findBestMagicSetup(styled, monster, state.equipment, {
        shortlistPerSlot: 5,
        forceStance,
        ownedOnly,
      });
    }
    return findBestSetup(styled, monster, state.equipment, {
      style, attackStyle: style, shortlistPerSlot: 5, forceStance, ownedOnly,
    });
  }

  /**
   * Compute the best setup for ALL three styles in one pass. The user
   * pays a one-time ~1-1.5s wait, then can flip between the Melee /
   * Ranged / Magic tabs instantly — each tab serves a cached candidate
   * computed against the same monster + skills + prayers + potions.
   *
   * Sequential rather than parallel because each call is sync straight-
   * line work (no I/O); a Promise.all wouldn't actually overlap. We yield
   * to a frame between runs so the "Calculating…" spinner repaints.
   */
  async function runOptimizer() {
    if (!selectedMonster) return;
    setComputing(true);
    setCandidates({});
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const forceStance = state.stanceOverride ?? undefined;
    const ownedOnly = state.ownedFilterEnabled ? state.ownedIds : null;
    const forceAttackStyle = state.attackStyleOverride ?? undefined;

    const next: CandidateCache = {};
    for (const s of ['melee', 'ranged', 'magic'] as const) {
      const r = runOptimizerForStyle(s, state.loadout, selectedMonster, forceStance, forceAttackStyle, ownedOnly);
      if (r) next[s] = r;
      // Yield between runs so the spinner gets a chance to repaint and
      // a long melee run doesn't make the app feel frozen.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    setCandidates(next);
    // Push the currently-selected style's pick into the store so the gear
    // grid populates immediately. Other styles are cached for tab flips.
    const cur = next[state.style];
    if (cur) {
      state.setEquipment(cur.equipment);
      if (cur.style === 'magic' && cur.spell !== undefined) state.setSpell(cur.spell);
      if (cur.stance !== undefined) state.setStance(cur.stance);
    }
    setComputing(false);
  }

  /**
   * Apply a manual slot swap and re-derive the displayed candidate so DPS,
   * accuracy, and the effects list stay in sync with what's actually equipped.
   *
   * `hint` carries the picker's optimal stance + attack style for the new
   * piece (only set for weapon swaps — non-weapon swaps inherit the current
   * stance/attackStyle). When provided we apply it to the loadout so the
   * engine evaluates the swap under the same combination the picker did.
   *
   * Falls back to clearing the candidate when no monster is picked — the
   * gear edit still goes through; the user just won't see updated metrics
   * until they pick a target.
   */
  function pickSlot(
    slot: Exclude<EquipmentSlot, '2h'>,
    piece: EquipmentPiece | null,
    hint?: { stance?: WeaponStance; attackStyle?: AttackType },
  ) {
    state.setSlot(slot, piece);
    // Persist the auto-picked stance/attack-style to the loadout so future
    // edits (and a re-run of "Find best setup" if the user pins anything)
    // see the right baseline.
    const effectiveStance = hint?.stance ?? candidate?.stance ?? state.loadout.stance;
    const effectiveAttack = hint?.attackStyle ?? candidate?.attackStyle ?? state.loadout.attackStyle;
    if (hint?.stance !== undefined) state.setStance(hint.stance);
    if (hint?.attackStyle !== undefined) state.setAttackStyle(hint.attackStyle);
    if (!selectedMonster) return;
    // Build the next equipment locally — store updates haven't flushed yet.
    const nextEquipment = { ...state.loadout.equipment };
    if (piece === null) {
      nextEquipment[slot] = null;
    } else {
      nextEquipment[slot] = piece;
      if (slot === 'weapon' && piece.isTwoHanded) nextEquipment.shield = null;
      else if (slot === 'shield' && nextEquipment.weapon?.isTwoHanded) nextEquipment.weapon = null;
    }
    const nextLoadout = {
      ...state.loadout,
      style: state.style,
      attackStyle: effectiveAttack,
      stance: effectiveStance,
      equipment: nextEquipment,
    };
    const result = calcDps(nextLoadout, selectedMonster);
    // Update only the current style's cache — the other styles' cached
    // candidates are still valid (this swap doesn't affect them).
    const newCandidate: BestSetupCandidate = {
      equipment: nextEquipment,
      result,
      style: state.style,
      attackStyle: nextLoadout.attackStyle,
      spell: state.style === 'magic' ? state.loadout.spell : undefined,
      stance: nextLoadout.stance,
    };
    setCandidates((c) => ({ ...c, [state.style]: newCandidate }));
  }

  /**
   * Optimizer run for the Upgrade Advisor: the best setup for the current
   * style against the selected monster, at the requested scope ('owned'
   * restricts to the player's bank; 'all' considers every item). The advisor
   * diffs this optimum against the live loadout to surface single-slot
   * upgrades. Honours the same stance/attack-style overrides as Find best setup.
   */
  function findUpgradeOptimum(scope: 'owned' | 'all'): BestSetupCandidate | null {
    if (!selectedMonster) return null;
    const ownedOnly = scope === 'owned' ? state.ownedIds : null;
    const forceStance = state.stanceOverride ?? undefined;
    const forceAttackStyle = state.attackStyleOverride ?? undefined;
    return runOptimizerForStyle(state.style, state.loadout, selectedMonster, forceStance, forceAttackStyle, ownedOnly);
  }

  /**
   * Apply an upgrade suggestion from the advisor: merge its gear changes
   * (weapon swaps bundle ammo + shield-clear) and any stance/attack/spell hint
   * into the live loadout, then refresh the displayed metrics — mirroring the
   * recompute that `pickSlot` does for a manual swap.
   */
  function applyUpgrade(sug: UpgradeSuggestion) {
    const nextEquipment = { ...state.loadout.equipment };
    for (const [slot, piece] of Object.entries(sug.changes)) {
      nextEquipment[slot as Exclude<EquipmentSlot, '2h'>] = piece ?? null;
    }
    state.setEquipment(nextEquipment);
    if (sug.stance) state.setStance(sug.stance);
    if (sug.attackStyle) state.setAttackStyle(sug.attackStyle);
    if (state.style === 'magic' && sug.spell !== undefined) state.setSpell(sug.spell);
    if (!selectedMonster) return;
    const nextLoadout: PlayerLoadout = {
      ...state.loadout,
      style: state.style,
      equipment: nextEquipment,
      stance: sug.stance ?? state.loadout.stance,
      attackStyle: sug.attackStyle ?? state.loadout.attackStyle,
      spell: state.style === 'magic' && sug.spell !== undefined ? sug.spell : state.loadout.spell,
    };
    const result = calcDps(nextLoadout, selectedMonster);
    setCandidates((c) => ({
      ...c,
      [state.style]: {
        equipment: nextEquipment,
        result,
        style: state.style,
        attackStyle: nextLoadout.attackStyle,
        spell: state.style === 'magic' ? nextLoadout.spell : undefined,
        stance: nextLoadout.stance,
      },
    }));
  }

  async function refreshData() {
    setRefreshing(true);
    setNotice('');
    try {
      await window.gearscape.refreshData();
      const data = await window.gearscape.loadData();
      state.hydrate({ equipment: data.equipment as never, monsters: data.monsters as never, meta: data.meta });
      setNotice('Data refreshed from OSRS Wiki CDN.');
    } catch (e) {
      setNotice(`Refresh failed: ${(e as Error).message}`);
    } finally {
      setRefreshing(false);
      setTimeout(() => setNotice(''), 4000);
    }
  }

  if (state.loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 animate-fade-rise">
          <h1
            className="text-4xl font-bold font-rs tracking-tight animate-glow-pulse"
            style={{ textShadow: '0 0 26px rgba(255, 203, 71, 0.35)' }}
          >
            <span className="text-accent">Gear</span>Scape
          </h1>
          <div className="flex items-center gap-3 text-text-dim text-sm">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Loading OSRS data…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Header
        refreshing={refreshing}
        onRefresh={refreshData}
        notice={notice}
        dataMeta={state.dataMeta}
      />
      <div className="flex-1 overflow-auto">
        <div className="p-5 grid gap-5 grid-cols-[340px_1fr]">
          <aside className="reveal-stagger flex flex-col gap-4">
            <MonsterPicker
              monsters={state.monsters}
              selectedId={state.selectedMonsterId}
              onSelect={handleMonsterSelect}
            />
            <RaidPanel
              value={state.loadout.raidScaling}
              onChange={state.setRaidScaling}
            />
            <DefenceReductionPanel
              value={state.loadout.defenceReduction}
              monster={selectedMonster}
              onChange={state.setDefenceReduction}
            />
            <StatsPanel
              skills={state.loadout.skills}
              onChange={state.setSkill}
              onSlayerTask={state.loadout.onSlayerTask}
              inWilderness={state.loadout.inWilderness}
              onSlayerChange={state.setOnSlayerTask}
              onWildernessChange={state.setInWilderness}
            />
            <OwnedFilterPanel
              equipment={state.equipment}
              ownedIds={state.ownedIds}
              enabled={state.ownedFilterEnabled}
              onAdd={state.addOwned}
              onImport={state.importOwned}
              onRemove={state.removeOwned}
              onClear={state.clearOwned}
              onToggleEnabled={state.setOwnedFilterEnabled}
            />
            <LoadoutManagerPanel
              equipment={state.equipment}
              saved={state.savedLoadouts}
              activeName={state.loadedLoadoutName}
              onSave={state.saveLoadout}
              onLoad={state.loadLoadout}
              onDelete={state.deleteLoadout}
            />
          </aside>
          <main className="reveal-stagger flex flex-col gap-4 min-w-0">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <StyleTabs
                value={state.style}
                onChange={handleStyleChange}
                order={styleOrder}
                leaderHint={styleLeaderHint}
                dpsByStyle={dpsByStyle}
              />
              <button
                className="btn btn-primary"
                disabled={!selectedMonster || computing}
                onClick={runOptimizer}
              >
                {computing ? 'Calculating…' : 'Find best setup'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <PrayerPanel style={state.style} prayers={state.loadout.prayers} onToggle={state.togglePrayer} />
              <PotionPanel style={state.style} potions={state.loadout.potions} onChange={state.setPotion} />
            </div>
            {state.style === 'magic' && (
              <SpellPicker value={state.loadout.spell} onChange={state.setSpell} />
            )}
            <OverridesPanel
              style={state.style}
              stance={state.stanceOverride}
              attackStyle={state.attackStyleOverride}
              onStanceChange={state.setStanceOverride}
              onAttackStyleChange={state.setAttackStyleOverride}
            />
            <ResultsPanel
              candidate={candidate}
              loadout={state.loadout}
              target={selectedMonster}
              computing={computing}
              onSlotClick={(slot) => setPickerSlot(slot)}
            />
            <UpgradeAdvisorPanel
              loadout={state.loadout}
              target={selectedMonster}
              style={state.style}
              ownedIds={state.ownedIds}
              prices={state.prices}
              pricesUpdatedAt={state.pricesUpdatedAt}
              loadingPrices={state.loadingPrices}
              onFetchPrices={state.fetchPrices}
              onOptimize={findUpgradeOptimum}
              onApply={applyUpgrade}
            />
          </main>
        </div>
      </div>
      {pickerSlot && (
        <GearPickerModal
          slot={pickerSlot}
          equipment={state.equipment}
          current={state.loadout.equipment[pickerSlot] ?? null}
          ownedOnly={state.ownedFilterEnabled ? state.ownedIds : null}
          // The picker uses this loadout as the substitution base for delta
          // calc. Fold in the displayed candidate's stance/attackStyle so the
          // baseline matches what the user is actually looking at.
          loadout={{
            ...state.loadout,
            style: state.style,
            attackStyle: candidate?.attackStyle ?? state.loadout.attackStyle,
            stance: candidate?.stance ?? state.loadout.stance,
          }}
          target={selectedMonster}
          onPick={(piece, hint) => pickSlot(pickerSlot, piece, hint)}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}

function Header({
  refreshing,
  onRefresh,
  notice,
  dataMeta,
}: {
  refreshing: boolean;
  onRefresh: () => void;
  notice: string;
  dataMeta: DataMeta | null;
}) {
  return (
    <header className="relative flex items-center justify-between px-5 py-3 border-b border-border-strong bg-bg-soft shadow-panel">
      {/* Gilt hairline — a thin gold light-rule along the header's lower edge,
          fading out at the corners, like inlaid trim. */}
      <span
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/45 to-transparent"
        aria-hidden
      />
      <div className="flex items-baseline gap-3">
        {/* Wordmark in Trebuchet MS (font-rs) — the actual font the
            RuneScape Java client used. text-shadow gives a subtle gold
            glow underneath the title to feel like illuminated chrome. */}
        <h1
          className="text-2xl font-bold font-rs tracking-tight"
          style={{ textShadow: '0 0 18px rgba(255, 203, 71, 0.25)' }}
        >
          <span className="text-accent">Gear</span>Scape
        </h1>
        <span className="text-[11px] text-accent/70 uppercase tracking-[0.28em] font-rs font-bold">
          Best Setup
        </span>
      </div>
      <div className="flex items-center gap-3">
        {notice && <span className="text-xs text-text-dim">{notice}</span>}
        <DataStalenessBadge meta={dataMeta} />
        <button className="btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
      </div>
    </header>
  );
}
