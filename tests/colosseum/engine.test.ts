/**
 * Engine-level tests: ping-offset input handling, triple-parry timing
 * windows, grapple parry windows, phase transitions, replay determinism,
 * and the shared prayer-drain math.
 */
import { describe, expect, it } from 'vitest';
import { SolHereditSim } from '@sim/solHeredit/engine';
import { exportReplay, rehydrate } from '@sim/solHeredit/replay';
import { summarize } from '@sim/solHeredit/results';
import type { SimEvent, TimedInput } from '@sim/solHeredit/types';
import { tickPrayerDrain } from '@engine/prayerDrain';
import { baseConfig, solMonster } from './fixtures';

function input(cmd: TimedInput['cmd'], clientTick: number, msIntoTick = 0): TimedInput {
  return { cmd, clientTick, msIntoTick };
}

function runTicks(sim: SolHereditSim, n: number): void {
  for (let i = 0; i < n && !sim.finished; i++) sim.advance();
}

function prayerEvents(sim: SolHereditSim): Array<{ tick: number; on: boolean }> {
  return sim.events
    .filter((e): e is Extract<SimEvent, { type: 'prayer' }> => e.type === 'prayer' && e.prayer === 'protectMelee')
    .map((e) => ({ tick: e.tick, on: e.on }));
}

// ---------------------------------------------------------------- latency

describe('ping-offset input handling', () => {
  it('0 ms reference mode: an input during tick T takes effect at T+1', () => {
    const sim = new SolHereditSim(baseConfig());
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5));
    runTicks(sim, 10);
    expect(prayerEvents(sim)).toEqual([{ tick: 6, on: true }]);
  });

  it('a full tick of ping shifts the effect one tick later', () => {
    const sim = new SolHereditSim(baseConfig({ latency: { pingMs: 600 } }));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5));
    runTicks(sim, 10);
    expect(prayerEvents(sim)).toEqual([{ tick: 7, on: true }]);
  });

  it('ping interacts with where in the tick the key was pressed', () => {
    // 550ms into tick 5 + 100ms ping crosses the next boundary: 3650ms →
    // arrives during tick 6 → effect at tick 7.
    const sim = new SolHereditSim(baseConfig({ latency: { pingMs: 100 } }));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5, 550));
    runTicks(sim, 10);
    expect(prayerEvents(sim)).toEqual([{ tick: 7, on: true }]);
    // The same press at the start of the tick would have made tick 6.
    const sim2 = new SolHereditSim(baseConfig({ latency: { pingMs: 100 } }));
    sim2.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5, 0));
    runTicks(sim2, 10);
    expect(prayerEvents(sim2)).toEqual([{ tick: 6, on: true }]);
  });

  it('packet loss drops the input entirely and logs it', () => {
    const sim = new SolHereditSim(baseConfig({ latency: { packetLossPct: 100 } }));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5));
    runTicks(sim, 10);
    expect(prayerEvents(sim)).toEqual([]);
    expect(sim.events.some((e) => e.type === 'inputDropped')).toBe(true);
  });
});

// ---------------------------------------------------------------- triple parry

describe('triple parry timing', () => {
  const tpConfig = (startHpPct = 100) => baseConfig({
    boss: { forcedRotation: ['tripleParry'], startHpPct },
  });
  // Forced rotation declares at tick 1 → hits land at ticks 4, 7, 10
  // (above 50% HP; below 50% the third lands at 11).

  it('no prayer → all three hits land', () => {
    const sim = new SolHereditSim(tpConfig());
    runTicks(sim, 12);
    const fails = sim.events.filter((e) => e.type === 'parryFailed');
    expect(fails).toHaveLength(3);
    expect(fails.every((f) => f.type === 'parryFailed' && f.reason.includes('not active'))).toBe(true);
  });

  it('flicking ON exactly the tick before each hit blocks all three', () => {
    const sim = new SolHereditSim(tpConfig());
    // effect ticks (ping 0): on@3, off@5, on@6, off@8, on@9 → hits 4/7/10.
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 2));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: false }, 4));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: false }, 7));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 8));
    runTicks(sim, 12);
    expect(sim.events.filter((e) => e.type === 'parryBlocked')).toHaveLength(3);
    expect(sim.events.filter((e) => e.type === 'parryFailed')).toHaveLength(0);
  });

  it('praying too early fails the block — including already-on at start', () => {
    const sim = new SolHereditSim(tpConfig());
    // On at effect tick 1 (before the sequence even declares) and left on.
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 0));
    runTicks(sim, 12);
    const fails = sim.events.filter((e) => e.type === 'parryFailed');
    expect(fails).toHaveLength(3);
    expect(fails[0].type === 'parryFailed' && fails[0].reason.includes('too early')).toBe(true);
  });

  it('below 50% HP the third hit lands one tick later', () => {
    const sim = new SolHereditSim(tpConfig(40));
    // Hits at 4, 7, 11 → flick on@3, on@6, on@10.
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 2));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: false }, 4));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: false }, 7));
    // The above-50% timing (on@9) would FAIL here; on@10 blocks.
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 9));
    runTicks(sim, 13);
    expect(sim.events.filter((e) => e.type === 'parryBlocked')).toHaveLength(3);
  });

  it('the above-50% flick pattern drops the slow third hit', () => {
    const sim = new SolHereditSim(tpConfig(40));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 2));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: false }, 4));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 5));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: false }, 7));
    sim.queueInput(input({ kind: 'pray', prayer: 'protectMelee', on: true }, 8)); // on@9 — a tick early for hit@11
    runTicks(sim, 13);
    expect(sim.events.filter((e) => e.type === 'parryBlocked')).toHaveLength(2);
    const fails = sim.events.filter((e) => e.type === 'parryFailed');
    expect(fails).toHaveLength(1);
    expect(fails[0].type === 'parryFailed' && fails[0].reason.includes('too early')).toBe(true);
  });
});

// ---------------------------------------------------------------- grapple

describe('grapple parry', () => {
  const grConfig = () => baseConfig({ boss: { forcedRotation: ['grapple', 'shield1'] } });
  // Declared at tick 1 → parry window is ticks 2..5 (4 ticks).

  function declaredSlot(sim: SolHereditSim) {
    const e = sim.events.find((x) => x.type === 'bossAttackDeclared' && x.attack === 'grapple');
    if (!e || e.type !== 'bossAttackDeclared' || !e.grappleSlot) throw new Error('no grapple declared');
    return e.grappleSlot;
  }

  it('no parry → grapple hits', () => {
    const sim = new SolHereditSim(grConfig());
    runTicks(sim, 8);
    expect(sim.events.some((e) => e.type === 'grappleFailed')).toBe(true);
    expect(sim.events.some((e) => e.type === 'playerDamaged' && e.source === 'Grapple')).toBe(true);
  });

  it('clicking the called slot inside the window parries', () => {
    const sim = new SolHereditSim(grConfig());
    sim.advance(); // declare
    sim.queueInput(input({ kind: 'parry', slot: declaredSlot(sim) }, 2)); // effect 3
    runTicks(sim, 7);
    const e = sim.events.find((x) => x.type === 'grappleParried');
    expect(e && e.type === 'grappleParried' && e.perfect).toBe(false);
  });

  it('parrying on the LAST tick is perfect and buffs his next attack to a guaranteed max', () => {
    const sim = new SolHereditSim(grConfig());
    sim.advance();
    sim.queueInput(input({ kind: 'parry', slot: declaredSlot(sim) }, 4)); // effect 5 = window end
    runTicks(sim, 12);
    const parried = sim.events.find((x) => x.type === 'grappleParried');
    expect(parried && parried.type === 'grappleParried' && parried.perfect).toBe(true);
    // Next attack (shield1, resolves tick 9 ≤ buff end 10) hits the player
    // standing at spawn for exactly the max (44).
    const hit = sim.events.find((x) => x.type === 'playerDamaged' && x.source === 'shield1');
    expect(hit && hit.type === 'playerDamaged' && hit.amount).toBe(44);
  });

  it('a click after the window does nothing', () => {
    const sim = new SolHereditSim(grConfig());
    sim.advance();
    sim.queueInput(input({ kind: 'parry', slot: declaredSlot(sim) }, 5)); // effect 6 — late
    runTicks(sim, 8);
    expect(sim.events.some((e) => e.type === 'grappleFailed')).toBe(true);
  });
});

// ---------------------------------------------------------------- transitions

describe('phase transitions', () => {
  it('crossing a threshold pauses the boss, spawns 6 beams, then sand 2 ticks later', () => {
    const sim = new SolHereditSim(baseConfig({ boss: { enabledTransitions: [0.9] } }));
    sim.advance(); // tick 1 — opening spear1 declared
    sim.setBossHp(1349); // 89.9% → transition fires at tick 1
    expect(sim.events.some((e) => e.type === 'phaseTransition')).toBe(true);

    runTicks(sim, 2); // ticks 2-3 — sand appears at tick 3
    expect(sim.getSnapshot().sandTiles.size).toBe(6);

    runTicks(sim, 4); // through tick 7
    const declares = sim.events.filter((e) => e.type === 'bossAttackDeclared');
    // Only the opener (tick 1) and the post-transition attack (tick 7).
    expect(declares).toHaveLength(2);
    expect(declares[1].tick).toBe(7);
  });

  it('the attack after a transition is a spear; Spear 1 previous forces Spear 2', () => {
    const sim = new SolHereditSim(baseConfig({ boss: { enabledTransitions: [0.9] } }));
    sim.advance(); // opening spear1
    sim.setBossHp(1349);
    runTicks(sim, 6); // to tick 7
    const declares = sim.events.filter((e) => e.type === 'bossAttackDeclared');
    expect(declares[0].type === 'bossAttackDeclared' && declares[0].attack).toBe('spear1');
    expect(declares[1].type === 'bossAttackDeclared' && declares[1].attack).toBe('spear2');
  });

  it('completing the 75% transition speeds his attacks up by 1 tick', () => {
    const sim = new SolHereditSim(baseConfig({ boss: { enabledTransitions: [0.75] } }));
    sim.advance(); // spear1 @ 1
    sim.setBossHp(1124); // 74.9%
    runTicks(sim, 12); // through tick 13
    const declares = sim.events.filter((e) => e.type === 'bossAttackDeclared');
    // Post-transition spear2 @ 7, then next spear at 7 + 6 (7-1 speedup) = 13.
    expect(declares[1].tick).toBe(7);
    expect(declares[2].tick).toBe(13);
  });
});

// ---------------------------------------------------------------- combat loop

describe('player combat loop', () => {
  it('walks into melee range and attacks with the shared-calc offense', () => {
    const sim = new SolHereditSim(baseConfig());
    sim.queueInput(input({ kind: 'move', to: { x: 8, y: 8 }, run: true }, 0));
    sim.queueInput(input({ kind: 'pray', prayer: 'offensive', on: true }, 0));
    runTicks(sim, 15);
    const hits = sim.events.filter((e) => e.type === 'playerHitBoss');
    expect(hits.length).toBeGreaterThan(0);
    expect(sim.bossHp).toBeLessThanOrEqual(1500);
    expect(sim.theoreticalDps()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- replay

describe('replay & determinism', () => {
  function scriptedRun(): SolHereditSim {
    const sim = new SolHereditSim(baseConfig({
      seed: 777,
      latency: { pingMs: 80, jitterMs: 40, packetLossPct: 10 },
      boss: { forcedRotation: ['tripleParry', 'shield1', 'grapple', 'spear1'] },
    }));
    const inputs: TimedInput[] = [
      input({ kind: 'pray', prayer: 'protectMelee', on: true }, 2),
      input({ kind: 'move', to: { x: 7, y: 7 }, run: true }, 5, 300),
      input({ kind: 'pray', prayer: 'protectMelee', on: false }, 6),
      input({ kind: 'parry', slot: 'weapon' }, 14),
      input({ kind: 'pray', prayer: 'protectMelee', on: true }, 20, 599),
    ];
    for (const i of inputs) sim.queueInput(i);
    runTicks(sim, 60);
    return sim;
  }

  it('a replay reproduces the run event-for-event', () => {
    const live = scriptedRun();
    const replayed = rehydrate(exportReplay(live), solMonster(), 60);
    expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(live.events));
    expect(replayed.bossHp).toBe(live.bossHp);
    expect(replayed.player.hp).toBe(live.player.hp);
  });

  it('scrubbing to tick N yields the same event prefix', () => {
    const live = scriptedRun();
    const scrubbed = rehydrate(exportReplay(live), solMonster(), 30);
    expect(scrubbed.tick).toBe(30);
    const prefix = live.events.filter((e) => e.tick <= 30);
    expect(JSON.stringify(scrubbed.events)).toBe(JSON.stringify(prefix));
  });

  it('results summarize without assists flagged when none are on', () => {
    const live = scriptedRun();
    const r = summarize(live);
    expect(r.assistsUsed).toBe(false);
    expect(r.ticks).toBeGreaterThan(0);
    expect(r.theoreticalDps).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- prayer drain

describe('shared prayer drain (engine/prayerDrain)', () => {
  it('piety at +0 bonus drains 1 point per 2 ticks', () => {
    const st = { accumulator: 0 };
    let lost = 0;
    for (let i = 0; i < 4; i++) lost += tickPrayerDrain(st, ['piety'], 0);
    expect(lost).toBe(2);
  });

  it('protect from melee at +0 bonus drains 1 point per 3 ticks', () => {
    const st = { accumulator: 0 };
    let lost = 0;
    for (let i = 0; i < 6; i++) lost += tickPrayerDrain(st, ['protectMelee'], 0);
    expect(lost).toBe(2);
  });

  it('prayer bonus slows the drain (resistance 2B+60)', () => {
    const st = { accumulator: 0 };
    let lost = 0;
    for (let i = 0; i < 8; i++) lost += tickPrayerDrain(st, ['piety'], 30); // resistance 120
    expect(lost).toBe(2); // 1 per 4 ticks
  });
});
