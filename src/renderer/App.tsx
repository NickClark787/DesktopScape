import { useEffect, useMemo, useState } from 'react';
import { useApp } from './state/store';
import { MonsterPicker } from './components/MonsterPicker';
import { StyleTabs } from './components/StyleTabs';
import { StatsPanel } from './components/StatsPanel';
import { PrayerPanel } from './components/PrayerPanel';
import { PotionPanel } from './components/PotionPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { findBestSetup, findBestMeleeSetup } from '../engine/bestSetup';
import type { BestSetupCandidate } from '@shared/types';

export default function App() {
  const state = useApp();
  const [candidate, setCandidate] = useState<BestSetupCandidate | null>(null);
  const [computing, setComputing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string>('');

  // Load data on mount
  useEffect(() => {
    (async () => {
      const data = await window.gearscape.loadData();
      state.hydrate({ equipment: data.equipment as never, monsters: data.monsters as never });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedMonster = useMemo(
    () => state.monsters.find((m) => m.id === state.selectedMonsterId) ?? null,
    [state.monsters, state.selectedMonsterId],
  );

  async function runOptimizer() {
    if (!selectedMonster) return;
    setComputing(true);
    setCandidate(null);
    // Yield to the paint before running the sync search.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const result = state.style === 'melee'
      ? findBestMeleeSetup(state.loadout, selectedMonster, state.equipment, { shortlistPerSlot: 5 })
      : findBestSetup(
          { ...state.loadout, style: state.style, attackStyle: state.style },
          selectedMonster,
          state.equipment,
          { style: state.style, attackStyle: state.style, shortlistPerSlot: 5 },
        );
    if (result) state.setEquipment(result.equipment);
    setCandidate(result);
    setComputing(false);
  }

  async function refreshData() {
    setRefreshing(true);
    setNotice('');
    try {
      await window.gearscape.refreshData();
      const data = await window.gearscape.loadData();
      state.hydrate({ equipment: data.equipment as never, monsters: data.monsters as never });
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
      />
      <div className="flex-1 overflow-auto">
        <div className="p-5 grid gap-5 grid-cols-[340px_1fr]">
          <aside className="flex flex-col gap-4">
            <MonsterPicker
              monsters={state.monsters}
              selectedId={state.selectedMonsterId}
              onSelect={state.setMonster}
            />
            <StatsPanel
              skills={state.loadout.skills}
              onChange={state.setSkill}
              onSlayerTask={state.loadout.onSlayerTask}
              inWilderness={state.loadout.inWilderness}
              onSlayerChange={state.setOnSlayerTask}
              onWildernessChange={state.setInWilderness}
            />
          </aside>
          <main className="flex flex-col gap-4 min-w-0">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <StyleTabs value={state.style} onChange={state.setStyle} />
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
            <ResultsPanel candidate={candidate} computing={computing} />
          </main>
        </div>
      </div>
    </div>
  );
}

function Header({ refreshing, onRefresh, notice }: { refreshing: boolean; onRefresh: () => void; notice: string }) {
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-soft">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-accent">Gear</span>Scape
        </h1>
        <span className="text-xs text-text-faint uppercase tracking-widest">Best Setup</span>
      </div>
      <div className="flex items-center gap-3">
        {notice && <span className="text-xs text-text-dim">{notice}</span>}
        <button className="btn" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
      </div>
    </header>
  );
}
