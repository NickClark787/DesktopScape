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
import { OverridesPanel } from './components/OverridesPanel';
import { OwnedFilterPanel } from './components/OwnedFilterPanel';
import { LoadoutManagerPanel } from './components/LoadoutManagerPanel';
import { DataStalenessBadge } from './components/DataStalenessBadge';
import { GearPickerModal } from './components/GearPickerModal';
import { findBestSetup, findBestMeleeSetup, findBestMagicSetup } from '../engine/bestSetup';
import { calcDps } from '../engine/formulas';
import { rankStyles, styleScores } from './utils/styleRanking';
import type { AttackType, BestSetupCandidate, EquipmentPiece, EquipmentSlot, WeaponStance } from '@shared/types';
import type { DataMeta } from '../preload';

export default function App() {
  const state = useApp();
  const [candidate, setCandidate] = useState<BestSetupCandidate | null>(null);
  const [computing, setComputing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string>('');
  const [pickerSlot, setPickerSlot] = useState<Exclude<EquipmentSlot, '2h'> | null>(null);

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

  // Style-tab order, best-to-worst against the selected monster.
  // When no monster is selected the canonical order is returned, so the tab
  // strip doesn't shuffle on first load.
  const styleOrder = useMemo(() => rankStyles(selectedMonster), [selectedMonster]);
  const styleLeaderHint = useMemo(() => {
    if (!selectedMonster) return undefined;
    const scores = styleScores(selectedMonster);
    const leader = styleOrder[0];
    // Surface the actual defence number so the recommendation is auditable —
    // "best because lowest magic def" is more trustworthy than a bare badge.
    return `Best vs ${selectedMonster.name} — ${leader} faces lowest defence (${scores[leader]})`;
  }, [selectedMonster, styleOrder]);

  /**
   * Style-tab click handler. The store's setStyle wipes the loadout's
   * equipment + stance (a melee weapon doesn't carry into Ranged), but the
   * displayed candidate lives in this component's local state and would
   * otherwise persist — leaving stale DPS metrics on screen for the wrong
   * style. Clearing both in the same handler keeps the UI honest after
   * a tab click. React 18 batches these so the re-render is single-frame.
   */
  function handleStyleChange(s: typeof state.style) {
    setCandidate(null);
    state.setStyle(s);
  }

  /**
   * Monster-pick handler. Same staleness risk as handleStyleChange — the
   * candidate's DPS, accuracy, and effects are all monster-specific (TBow
   * scales off magic level, Salve fires on undead, raid scaling math
   * differs per fight), so a stale candidate displayed against a new
   * monster is actively misleading. The optimizer needs to be re-run
   * to refresh; clearing the candidate forces the empty/loadout state
   * until the user does so.
   *
   * Equipment is *not* cleared here — gear that worked on Vorkath might
   * still be the user's intent for Zulrah, and the picker's per-row DPS
   * column will recompute against the new target on its own.
   */
  function handleMonsterSelect(id: number) {
    setCandidate(null);
    state.setMonster(id);
  }

  async function runOptimizer() {
    if (!selectedMonster) return;
    setComputing(true);
    setCandidate(null);
    // Yield to the paint before running the sync search.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const forceStance = state.stanceOverride ?? undefined;
    const ownedOnly = state.ownedFilterEnabled ? state.ownedIds : null;
    const result = state.style === 'melee'
      ? findBestMeleeSetup(state.loadout, selectedMonster, state.equipment, {
          shortlistPerSlot: 5,
          forceStance,
          ownedOnly,
          forceAttackStyle: state.attackStyleOverride ?? undefined,
        })
      : state.style === 'magic'
      ? findBestMagicSetup(state.loadout, selectedMonster, state.equipment, { shortlistPerSlot: 5, forceStance, ownedOnly })
      : findBestSetup(
          { ...state.loadout, style: state.style, attackStyle: state.style },
          selectedMonster,
          state.equipment,
          { style: state.style, attackStyle: state.style, shortlistPerSlot: 5, forceStance, ownedOnly },
        );
    if (result) {
      state.setEquipment(result.equipment);
      if (result.style === 'magic' && result.spell !== undefined) state.setSpell(result.spell);
    }
    setCandidate(result);
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
    setCandidate({
      equipment: nextEquipment,
      result,
      style: state.style,
      attackStyle: nextLoadout.attackStyle,
      spell: state.style === 'magic' ? state.loadout.spell : undefined,
      stance: nextLoadout.stance,
    });
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
        <div className="flex items-center gap-3 text-text-dim text-sm">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          Loading OSRS data…
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
          <aside className="flex flex-col gap-4">
            <MonsterPicker
              monsters={state.monsters}
              selectedId={state.selectedMonsterId}
              onSelect={handleMonsterSelect}
            />
            <RaidPanel
              value={state.loadout.raidScaling}
              onChange={state.setRaidScaling}
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
              onRemove={state.removeOwned}
              onClear={state.clearOwned}
              onToggleEnabled={state.setOwnedFilterEnabled}
            />
            <LoadoutManagerPanel
              equipment={state.equipment}
              saved={state.savedLoadouts}
              onSave={state.saveLoadout}
              onLoad={state.loadLoadout}
              onDelete={state.deleteLoadout}
            />
          </aside>
          <main className="flex flex-col gap-4 min-w-0">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <StyleTabs
                value={state.style}
                onChange={handleStyleChange}
                order={styleOrder}
                leaderHint={styleLeaderHint}
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
    <header className="flex items-center justify-between px-5 py-3 border-b border-border-strong bg-bg-soft shadow-panel">
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
