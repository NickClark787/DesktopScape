import { useEffect, useMemo, useRef, useState } from 'react';
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
import { ConstraintsPanel } from './components/ConstraintsPanel';
import { DpsGraphPanel } from './components/DpsGraphPanel';
import { findBestSetup, findBestMeleeSetup, findBestMagicSetup } from '../engine/bestSetup';
import type { UpgradeSuggestion } from '../engine/upgradeAdvisor';
import { calcDps } from '../engine/formulas';
import { rankStyles, styleScores } from './utils/styleRanking';
import { applySlotChange } from './utils/equipment';
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
  /** Non-empty when the initial data load failed — drives the retry screen. */
  const [loadError, setLoadError] = useState('');
  // One live notice-clearing timer at a time; cleared on unmount and on every
  // new notice so an old timer can't wipe a fresh message early.
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
  }, []);

  // The candidate displayed in the metrics block — whatever's cached for
  // the currently-selected style. Switching tabs flips this without any
  // recompute; running Find best setup repopulates all three at once.
  const candidate = candidates[state.style] ?? null;

  /** Initial data load — also the retry path when the first attempt failed. */
  async function loadData() {
    setLoadError('');
    try {
      const data = await window.gearscape.loadData();
      state.hydrate(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  // Load data on mount
  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMonster = useMemo(
    () => {
      if (state.selectedMonsterId === null) return null;
      // 54 game ids are shared by multiple monster variants, so resolution
      // needs the version too. Legacy selections (version null) and stale
      // versions fall back to the first id match, as before.
      const byBoth = state.selectedMonsterVersion !== null
        ? state.monsters.find((m) => m.id === state.selectedMonsterId && m.version === state.selectedMonsterVersion)
        : undefined;
      return byBoth ?? state.monsters.find((m) => m.id === state.selectedMonsterId) ?? null;
    },
    [state.monsters, state.selectedMonsterId, state.selectedMonsterVersion],
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
  function handleMonsterSelect(id: number, version: string | null) {
    setCandidates({});
    state.setMonster(id, version);
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
    // Shared search constraints: the avoid-list always applies; budget mode
    // kicks in only when a budget is set AND prices are loaded (owned items
    // are free, unpriced+unowned items unbuyable).
    const constraints = {
      excludeIds: state.excludedIds.size ? state.excludedIds : null,
      budget: state.budget,
      prices: state.budget != null ? state.prices : null,
      ownedFree: state.ownedIds,
    };
    if (style === 'melee') {
      return findBestMeleeSetup(styled, monster, state.equipment, {
        shortlistPerSlot: 5,
        forceStance,
        ownedOnly,
        forceAttackStyle: (forceAttackStyle as 'stab' | 'slash' | 'crush') ?? undefined,
        ...constraints,
      });
    }
    if (style === 'magic') {
      return findBestMagicSetup(styled, monster, state.equipment, {
        shortlistPerSlot: 5,
        forceStance,
        ownedOnly,
        ...constraints,
      });
    }
    return findBestSetup(styled, monster, state.equipment, {
      style, attackStyle: style, shortlistPerSlot: 5, forceStance, ownedOnly, ...constraints,
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
    // Land on the winning style: "Find best setup" answers "what should I
    // bring", so the style tabs auto-select the highest-DPS candidate
    // instead of leaving the user parked on whatever tab was open. Seeding
    // with the current style's DPS keeps the tab put on exact ties.
    let bestStyle: CombatStyle = state.style;
    let bestDps = next[state.style]?.result.dps ?? -Infinity;
    for (const s of ['melee', 'ranged', 'magic'] as const) {
      const dps = next[s]?.result.dps;
      if (dps !== undefined && dps > bestDps) {
        bestDps = dps;
        bestStyle = s;
      }
    }
    // keepOverrides: pinned stance/attack-style were inputs to this run —
    // an automatic switch must not silently drop them (a manual tab click
    // still clears them, as before).
    if (bestStyle !== state.style) state.setStyle(bestStyle, { keepOverrides: true });
    // Push the winner's pick into the store so the gear grid populates
    // immediately. Other styles stay cached for tab flips.
    const cur = next[bestStyle];
    if (cur) {
      state.setEquipment(cur.equipment);
      if (cur.style === 'magic' && cur.spell !== undefined) state.setSpell(cur.spell);
      if (cur.stance !== undefined) state.setStance(cur.stance);
      // Keep the loadout's attack style in step with the recommendation
      // (setStyle resets melee to 'slash'; the winner may be stab/crush).
      state.setAttackStyle(cur.attackStyle);
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
    // Build the next equipment locally — store updates haven't flushed yet.
    // Same applySlotChange the store's setSlot uses, so the two stay in sync.
    const nextEquipment = applySlotChange(state.loadout.equipment, slot, piece);
    refreshCandidate(nextEquipment, effectiveStance, effectiveAttack, state.loadout.spell);
  }

  /**
   * Shared tail of every manual gear edit (slot pick, advisor upgrade):
   * recompute the current style's metrics for the new equipment under the
   * given stance/attack/spell and refresh only that style's candidate cache —
   * the other styles' cached candidates are unaffected by this edit.
   */
  function refreshCandidate(
    nextEquipment: PlayerLoadout['equipment'],
    stance: WeaponStance | undefined,
    attackStyle: AttackType,
    spell: string | null,
  ) {
    if (!selectedMonster) return;
    const nextLoadout: PlayerLoadout = {
      ...state.loadout, style: state.style, equipment: nextEquipment, stance, attackStyle, spell,
    };
    const result = calcDps(nextLoadout, selectedMonster);
    setCandidates((c) => ({
      ...c,
      [state.style]: {
        equipment: nextEquipment,
        result,
        style: state.style,
        attackStyle,
        spell: state.style === 'magic' ? spell : undefined,
        stance,
      },
    }));
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
    refreshCandidate(
      nextEquipment,
      sug.stance ?? state.loadout.stance,
      sug.attackStyle ?? state.loadout.attackStyle,
      state.style === 'magic' && sug.spell !== undefined ? sug.spell : state.loadout.spell,
    );
  }

  async function refreshData() {
    setRefreshing(true);
    setNotice('');
    try {
      await window.gearscape.refreshData();
      const data = await window.gearscape.loadData();
      state.hydrate(data);
      setNotice('Data refreshed from OSRS Wiki CDN.');
    } catch (e) {
      setNotice(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
      if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(''), 4000);
    }
  }

  if (state.loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 animate-fade-rise">
          <h1
            className="text-4xl font-bold font-display tracking-wide animate-glow-pulse"
            style={{ textShadow: '0 0 26px rgba(255, 215, 0, 0.35)' }}
          >
            <span className="text-accent">Gear</span>Scape
          </h1>
          {loadError ? (
            <div className="flex flex-col items-center gap-3 max-w-md text-center">
              <span className="text-sm text-osrs-red">Couldn't load OSRS data: {loadError}</span>
              <button className="btn btn-primary" onClick={() => void loadData()}>Retry</button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-text-dim text-sm">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              Loading OSRS data…
            </div>
          )}
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
              selected={selectedMonster}
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
            <ConstraintsPanel
              equipment={state.equipment}
              excludedIds={state.excludedIds}
              onAddExcluded={state.addExcluded}
              onRemoveExcluded={state.removeExcluded}
              onClearExcluded={state.clearExcluded}
              budget={state.budget}
              onBudgetChange={state.setBudget}
              pricesLoaded={!!state.prices}
              loadingPrices={state.loadingPrices}
              onFetchPrices={state.fetchPrices}
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
            <DpsGraphPanel loadout={state.loadout} target={selectedMonster} />
          </main>
        </div>
      </div>
      {pickerSlot && (
        <GearPickerModal
          slot={pickerSlot}
          equipment={state.equipment}
          current={state.loadout.equipment[pickerSlot] ?? null}
          ownedOnly={state.ownedFilterEnabled ? state.ownedIds : null}
          excludedIds={state.excludedIds}
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
        {/* Wordmark carved in Cinzel with a gold underglow; the subtitle is
            pixel chrome — the two theme faces introduced together. */}
        <h1
          className="text-2xl font-bold font-display tracking-wide"
          style={{ textShadow: '0 0 18px rgba(255, 215, 0, 0.28)' }}
        >
          <span className="text-accent">Gear</span>Scape
        </h1>
        <span className="text-[11px] text-accent/80 uppercase tracking-[0.24em] font-pixel">
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
