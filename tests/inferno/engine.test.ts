/**
 * TzKal-Zuk engine: glyph protection + shield HP, add-set spawn timing with
 * the 600→480 HP pause, Jad prayer-switch windows, enrage + healers,
 * target switching, ping-offset input handling, and replay determinism.
 */
import { describe, expect, it } from 'vitest';
import { TzKalZukSim } from '@sim/tzkalZuk/engine';
import { exportReplay, rehydrate } from '@sim/tzkalZuk/replay';
import { summarize } from '@sim/tzkalZuk/results';
import {
  ENRAGE_HP, JAD_HEALER_COUNT, JAD_SPAWN_HP, SET_INTERVAL_TICKS,
  SET_PAUSE_BONUS_TICKS, ZUK_MAX_HIT, ZUK_SPEED_ENRAGED,
} from '@sim/tzkalZuk/constants';
import type { SimEvent, TimedInput } from '@sim/tzkalZuk/types';
import { baseConfig, addMonsters, zukMonster } from './fixtures';

function input(cmd: TimedInput['cmd'], clientTick: number, msIntoTick = 0): TimedInput {
  return { cmd, clientTick, msIntoTick };
}
function runTicks(sim: TzKalZukSim, n: number): void {
  for (let i = 0; i < n && !sim.finished; i++) sim.advance();
}
function advanceUntil(sim: TzKalZukSim, pred: () => boolean, cap = 2000): void {
  let g = 0;
  while (!pred() && !sim.finished && g++ < cap) sim.advance();
}
/** Remove the weapon so the player deals 0 dps — isolates timing from Zuk HP. */
function noWeapon(config: ReturnType<typeof baseConfig>) {
  config.player.loadout = { ...config.player.loadout, equipment: {} };
  return config;
}
/**
 * Pull Jad's aggression onto the player. Every spawn opens on the shield
 * (wiki `TzKal-Zuk`), so a prayer-switch drill has to tag it first.
 */
function tagJad(sim: TzKalZukSim): void {
  sim.advance();
  const jad = sim.entities.find((e) => e.kind === 'jad');
  if (jad) { jad.tagged = true; jad.aggro = 'player'; }
}

// ---------------------------------------------------------------- glyph + Zuk

describe('Zuk shot vs the glyph', () => {
  it('an unprotected player is hit for typeless damage (prayer does not help)', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'zukOnly' } })));
    sim.player.pos = { x: 24, y: 2 }; // far from the glyph's start columns
    sim.player.overhead = 'ranged'; // does NOT block Zuk
    // Zuk rolls accuracy (Mod Ash: averaged ranged/magic roll vs the
    // player's averaged ranged/magic defence) and is near-certain to hit an
    // unarmoured player, so look across a handful of shots.
    advanceUntil(sim, () => sim.events.filter((e) => e.type === 'zukAttack').length >= 3, 200);
    const shots = sim.events.filter((e): e is Extract<SimEvent, { type: 'zukAttack' }> => e.type === 'zukAttack');
    expect(shots.every((s) => !s.blocked)).toBe(true);
    expect(shots.some((s) => s.hit)).toBe(true);
    expect(shots.every((s) => s.damage <= ZUK_MAX_HIT)).toBe(true);
    expect(sim.events.some((e) => e.type === 'playerDamaged' && e.source === 'TzKal-Zuk')).toBe(true);
  });

  it('the shield sustains Zuk’s attacks indefinitely — his shots never chip it', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'zukOnly', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 }; // glyph starts covering x0..4 at the glyph row
    const startGlyph = sim.glyphHp;
    advanceUntil(sim, () => sim.events.filter((e) => e.type === 'zukAttack').length >= 5, 300);
    const shots = sim.events.filter((e): e is Extract<SimEvent, { type: 'zukAttack' }> => e.type === 'zukAttack');
    expect(shots.length).toBeGreaterThanOrEqual(5);
    expect(shots.every((s) => s.blocked)).toBe(true);
    expect(sim.glyphHp).toBe(startGlyph);
    expect(sim.glyphDamageTaken).toBe(0);
  });

  it('the spawns are what destroy the shield, exposing the player', () => {
    // 'sets' spawns rangers/magers; with no weapon the player never tags
    // them, so they stay on the shield until it collapses.
    const sim = new TzKalZukSim(noWeapon(baseConfig({
      boss: { practiceMode: 'sets', freezeGlyph: true, modifierIds: ['fragile_glyph'] },
    })));
    sim.player.pos = { x: 2, y: 4 };
    advanceUntil(sim, () => sim.glyphDestroyed, 5000);
    expect(sim.glyphDestroyed).toBe(true);
    expect(sim.events.some((e) => e.type === 'glyphDestroyed')).toBe(true);
    const chips = sim.events.filter((e): e is Extract<SimEvent, { type: 'glyphDamaged' }> => e.type === 'glyphDamaged');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((c) => c.kind === 'ranger' || c.kind === 'mager')).toBe(true);
    expect(sim.glyphDamageTaken).toBeGreaterThanOrEqual(sim.glyphMaxHp);
    // After destruction the same position no longer protects.
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'zukAttack' && !e.blocked), 5000);
    expect(sim.events.some((e) => e.type === 'zukAttack' && !e.blocked)).toBe(true);
  });
});

// ---------------------------------------------------------------- aggro

describe('spawn aggression', () => {
  it('a set attacks the shield until the player tags it, then switches to the player', () => {
    const sim = new TzKalZukSim(baseConfig({ boss: { practiceMode: 'sets', freezeGlyph: true } }));
    sim.player.pos = { x: 2, y: 4 };
    runTicks(sim, 2);
    const ranger = sim.entities.find((e) => e.kind === 'ranger')!;
    expect(ranger.aggro).toBe('shield');

    // Untouched, its attacks land on the shield, not on the player.
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'glyphDamaged' && e.entityId === ranger.id), 60);
    expect(sim.events.some((e) => e.type === 'glyphDamaged' && e.entityId === ranger.id)).toBe(true);
    expect(sim.events.some((e) => e.type === 'addAttack' && e.entityId === ranger.id)).toBe(false);

    // Tag it: aggression moves to the player.
    sim.queueInput(input({ kind: 'target', entityId: ranger.id }, sim.tick));
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'aggroTaken' && e.entityId === ranger.id), 60);
    expect(sim.entities.find((e) => e.id === ranger.id)!.aggro).toBe('player');
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'addAttack' && e.entityId === ranger.id), 60);
    expect(sim.events.some((e) => e.type === 'addAttack' && e.entityId === ranger.id)).toBe(true);
  });
});

// ---------------------------------------------------------------- add sets

describe('add-set spawns', () => {
  it('the first set spawns a ranger and a mager', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'sets', freezeGlyph: true } })));
    runTicks(sim, 2);
    const spawns = sim.events.filter((e): e is Extract<SimEvent, { type: 'addSpawned' }> => e.type === 'addSpawned');
    expect(spawns.map((s) => s.kind).sort()).toEqual(['mager', 'ranger']);
  });

  it('the set countdown pauses across the 600→480 HP band and gains a one-time 1:45', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'sets', freezeGlyph: true } })));
    runTicks(sim, 2); // first set → firstSetDone, countdown armed and ticking
    // At full HP the countdown runs down toward the next set.
    const running = sim.getSnapshot().setCountdown;
    expect(running).toBeLessThanOrEqual(SET_INTERVAL_TICKS);
    expect(running).toBeGreaterThan(SET_INTERVAL_TICKS - 5);

    sim.setZukHp(550); // inside the pause band (480..600]
    runTicks(sim, 1); // the tick that applies the +1:45 and then pauses
    const paused = sim.getSnapshot().setCountdown;
    expect(paused).toBe(running + SET_PAUSE_BONUS_TICKS);

    runTicks(sim, 5);
    expect(sim.getSnapshot().setCountdown).toBe(paused); // frozen

    sim.setZukHp(470); // below resume threshold
    runTicks(sim, 4);
    expect(sim.getSnapshot().setCountdown).toBeLessThan(paused); // ticking again
    expect(sim.getSnapshot().setCountdown).toBe(paused - 4);
  });

  it('zukOnly practice never spawns adds', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'zukOnly', freezeGlyph: true } })));
    runTicks(sim, 60);
    expect(sim.events.some((e) => e.type === 'addSpawned')).toBe(false);
  });
});

// ---------------------------------------------------------------- Jad

describe('JalTok-Jad', () => {
  it('spawns when Zuk reaches 480 HP', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'full', freezeGlyph: true } })));
    runTicks(sim, 2);
    expect(sim.events.some((e) => e.type === 'addSpawned' && e.kind === 'jad')).toBe(false);
    sim.setZukHp(JAD_SPAWN_HP);
    runTicks(sim, 1);
    expect(sim.events.some((e) => e.type === 'addSpawned' && e.kind === 'jad')).toBe(true);
  });

  it('the matching overhead blocks Jad; the wrong one takes the hit', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'jad', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 }; // safe from Zuk so only Jad matters
    tagJad(sim); // otherwise it would be chewing on the shield, not on us
    // Correct-pray attempt: read the declared style, match it before it lands.
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'addAttackDeclared' && e.kind === 'jad'));
    const decl = sim.events.find((e): e is Extract<SimEvent, { type: 'addAttackDeclared' }> =>
      e.type === 'addAttackDeclared' && e.kind === 'jad')!;
    sim.player.overhead = decl.style; // 'magic' or 'ranged'
    advanceUntil(sim, () => sim.tick >= decl.landTick);
    const resolved = sim.events.find((e): e is Extract<SimEvent, { type: 'addAttack' }> =>
      e.type === 'addAttack' && e.kind === 'jad');
    expect(resolved?.blocked).toBe(true);
  });

  it('wrong overhead on Jad deals damage with a corrective hint', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'jad', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 };
    tagJad(sim);
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'addAttackDeclared' && e.kind === 'jad'));
    const decl = sim.events.find((e): e is Extract<SimEvent, { type: 'addAttackDeclared' }> =>
      e.type === 'addAttackDeclared' && e.kind === 'jad')!;
    sim.player.overhead = decl.style === 'magic' ? 'ranged' : 'magic'; // wrong
    advanceUntil(sim, () => sim.tick >= decl.landTick);
    const hit = sim.events.find((e): e is Extract<SimEvent, { type: 'addAttack' }> =>
      e.type === 'addAttack' && e.kind === 'jad');
    expect(hit?.blocked).toBe(false);
    const dmg = sim.events.find((e) => e.type === 'playerDamaged' && e.source === 'JalTok-Jad');
    expect(dmg && dmg.type === 'playerDamaged' && dmg.correctAction).toContain('Protect from');
  });

  it('spawns three Yt-HurKot healers at half health, which heal Jad until tagged', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'jad', freezeGlyph: true } })));
    runTicks(sim, 1);
    const jad = sim.entities.find((e) => e.kind === 'jad')!;
    expect(sim.entities.filter((e) => e.kind === 'jadHealer')).toHaveLength(0);

    jad.hp = Math.floor(jad.maxHp / 2) - 20; // drop it below half
    runTicks(sim, 1);
    expect(sim.entities.filter((e) => e.kind === 'jadHealer')).toHaveLength(JAD_HEALER_COUNT);
    expect(sim.events.filter((e) => e.type === 'addSpawned' && e.kind === 'jadHealer')).toHaveLength(JAD_HEALER_COUNT);

    const before = jad.hp;
    runTicks(sim, 10);
    expect(sim.events.some((e) => e.type === 'jadHealed')).toBe(true);
    expect(jad.hp).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------- Jal-Zek

describe('Jal-Zek resurrection', () => {
  it('revives a fallen monster (not itself) at half health, once each', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ seed: 17, boss: { practiceMode: 'sets', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 };
    runTicks(sim, 2);
    const ranger = sim.entities.find((e) => e.kind === 'ranger')!;
    const mager = sim.entities.find((e) => e.kind === 'mager')!;

    // Down the ranger, leave the Jal-Zek up so it can bring it back. The
    // Jal-Zek has a 1/10 chance per attack to revive instead of attacking.
    ranger.alive = false;
    ranger.hp = 0;
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'monsterRevived'), 1500);
    const rev = sim.events.find((e): e is Extract<SimEvent, { type: 'monsterRevived' }> => e.type === 'monsterRevived');
    expect(rev).toBeDefined();
    expect(rev!.entityId).toBe(ranger.id);
    expect(rev!.byId).toBe(mager.id);
    expect(ranger.alive).toBe(true);
    expect(ranger.hp).toBe(Math.ceil(ranger.maxHp / 2));
    expect(ranger.revived).toBe(true);
    // Each monster may only be revived once.
    expect(sim.events.filter((e) => e.type === 'monsterRevived' && e.entityId === ranger.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- enrage + healers

describe('enrage and healers', () => {
  it('at 240 HP Zuk enrages and four healers spawn', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'full', freezeGlyph: true } })));
    runTicks(sim, 2);
    sim.setZukHp(ENRAGE_HP);
    runTicks(sim, 1);
    expect(sim.enraged).toBe(true);
    expect(sim.events.some((e) => e.type === 'enrage')).toBe(true);
    expect(sim.events.filter((e) => e.type === 'addSpawned' && e.kind === 'healer')).toHaveLength(4);
  });

  it('enraged Zuk attacks every 7 ticks', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'healers', freezeGlyph: true } })));
    runTicks(sim, 40);
    const declares = sim.events
      .filter((e): e is Extract<SimEvent, { type: 'zukAttackDeclared' }> => e.type === 'zukAttackDeclared')
      .map((e) => e.tick);
    expect(declares.length).toBeGreaterThanOrEqual(3);
    for (let i = 2; i < declares.length; i++) {
      expect(declares[i] - declares[i - 1]).toBe(ZUK_SPEED_ENRAGED);
    }
  });

  it('healers heal Zuk while untagged, and do not splash the player yet', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'healers', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 }; // behind the glyph, so only healers can hurt us
    const before = sim.getSnapshot().zukHp;
    runTicks(sim, 12);
    expect(sim.events.some((e) => e.type === 'zukHealed')).toBe(true);
    expect(sim.getSnapshot().zukHp).toBeGreaterThan(before); // no weapon → only healing moves HP
    expect(sim.events.some((e) => e.type === 'playerDamaged' && e.source === 'Jal-MejJak')).toBe(false);
  });

  it('a tagged healer stops healing and rains lava balls instead', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'healers', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 };
    runTicks(sim, 1);
    const healers = sim.entities.filter((e) => e.kind === 'healer');
    expect(healers).toHaveLength(4);
    for (const h of healers) h.tagged = true;

    const zukBefore = sim.getSnapshot().zukHp;
    const healEvents = sim.events.filter((e) => e.type === 'zukHealed').length;
    runTicks(sim, 12);
    expect(sim.getSnapshot().zukHp).toBe(zukBefore); // healing has stopped
    expect(sim.events.filter((e) => e.type === 'zukHealed')).toHaveLength(healEvents);
    const chip = sim.events.find((e) => e.type === 'playerDamaged' && e.source === 'Jal-MejJak');
    expect(chip).toBeDefined();
    expect(chip && chip.type === 'playerDamaged' && chip.amount).toBeLessThanOrEqual(10);
  });

  it('each heal tick is 15-24, matching the wiki', () => {
    const sim = new TzKalZukSim(noWeapon(baseConfig({ boss: { practiceMode: 'healers', freezeGlyph: true } })));
    sim.player.pos = { x: 2, y: 4 };
    // One healer only, so each `zukHealed` amount is a single roll.
    runTicks(sim, 1);
    const healers = sim.entities.filter((e) => e.kind === 'healer');
    for (const h of healers.slice(1)) h.alive = false;
    runTicks(sim, 60);
    const amounts = sim.events
      .filter((e): e is Extract<SimEvent, { type: 'zukHealed' }> => e.type === 'zukHealed')
      .map((e) => e.amount);
    expect(amounts.length).toBeGreaterThan(3);
    for (const a of amounts) {
      expect(a).toBeGreaterThanOrEqual(15);
      expect(a).toBeLessThanOrEqual(24);
    }
  });
});

// ---------------------------------------------------------------- targeting

describe('target switching', () => {
  it('the player attacks the entity it targets, then falls back to Zuk on kill', () => {
    const sim = new TzKalZukSim(baseConfig({ boss: { practiceMode: 'sets', freezeGlyph: true } }));
    sim.player.pos = { x: 2, y: 4 }; // safe from Zuk
    runTicks(sim, 2); // spawn the set (ids 1 = ranger, 2 = mager)
    const ranger = sim.entities.find((e) => e.kind === 'ranger')!;
    sim.queueInput(input({ kind: 'target', entityId: ranger.id }, sim.tick));
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'playerHit' && e.targetId === ranger.id), 200);
    expect(sim.events.some((e) => e.type === 'playerHit' && e.kind === 'ranger')).toBe(true);
    // Kill it and confirm the target reverts to Zuk (id 0).
    advanceUntil(sim, () => sim.events.some((e) => e.type === 'addKilled' && e.kind === 'ranger'), 500);
    expect(sim.player.targetId).toBe(0);
  });
});

// ---------------------------------------------------------------- latency

describe('ping-offset input handling', () => {
  it('0 ms: a pray during tick T takes effect at T+1', () => {
    const sim = new TzKalZukSim(baseConfig({ boss: { practiceMode: 'zukOnly' } }));
    sim.queueInput(input({ kind: 'pray', overhead: 'magic' }, 5));
    runTicks(sim, 10);
    const pray = sim.events.find((e): e is Extract<SimEvent, { type: 'prayer' }> => e.type === 'prayer');
    expect(pray?.tick).toBe(6);
  });

  it('a full tick of ping shifts the effect one tick later', () => {
    const sim = new TzKalZukSim(baseConfig({ boss: { practiceMode: 'zukOnly' }, latency: { pingMs: 600 } }));
    sim.queueInput(input({ kind: 'pray', overhead: 'magic' }, 5));
    runTicks(sim, 10);
    const pray = sim.events.find((e): e is Extract<SimEvent, { type: 'prayer' }> => e.type === 'prayer');
    expect(pray?.tick).toBe(7);
  });

  it('packet loss drops the input and logs it', () => {
    const sim = new TzKalZukSim(baseConfig({ boss: { practiceMode: 'zukOnly' }, latency: { packetLossPct: 100 } }));
    sim.queueInput(input({ kind: 'pray', overhead: 'magic' }, 5));
    runTicks(sim, 10);
    expect(sim.events.some((e) => e.type === 'prayer')).toBe(false);
    expect(sim.events.some((e) => e.type === 'inputDropped')).toBe(true);
  });
});

// ---------------------------------------------------------------- replay

describe('replay & determinism', () => {
  function scriptedRun(): TzKalZukSim {
    const sim = new TzKalZukSim(baseConfig({
      seed: 909,
      latency: { pingMs: 60, jitterMs: 30, packetLossPct: 8 },
      boss: { practiceMode: 'full' },
    }));
    const inputs: TimedInput[] = [
      input({ kind: 'prayOffensive', on: true }, 1),
      input({ kind: 'pray', overhead: 'magic' }, 3),
      input({ kind: 'move', to: { x: 6, y: 5 }, run: true }, 4, 250),
      input({ kind: 'target', entityId: 1 }, 20),
      input({ kind: 'pray', overhead: 'ranged' }, 24, 500),
      input({ kind: 'eat', invIndex: 0 }, 40),
    ];
    for (const i of inputs) sim.queueInput(i);
    runTicks(sim, 120);
    return sim;
  }

  it('reproduces the run event-for-event', () => {
    const live = scriptedRun();
    const replayed = rehydrate(exportReplay(live), zukMonster(), addMonsters(), 120);
    expect(JSON.stringify(replayed.events)).toBe(JSON.stringify(live.events));
    expect(replayed.getSnapshot().zukHp).toBe(live.getSnapshot().zukHp);
    expect(replayed.player.hp).toBe(live.player.hp);
  });

  it('scrubbing to tick N yields the same event prefix', () => {
    const live = scriptedRun();
    const scrubbed = rehydrate(exportReplay(live), zukMonster(), addMonsters(), 60);
    expect(scrubbed.tick).toBe(60);
    expect(JSON.stringify(scrubbed.events)).toBe(JSON.stringify(live.events.filter((e) => e.tick <= 60)));
  });

  it('results summarize with assists flagged off', () => {
    const r = summarize(scriptedRun());
    expect(r.assistsUsed).toBe(false);
    expect(r.theoreticalDps).toBeGreaterThan(0);
    expect(r.ticks).toBeGreaterThan(0);
  });
});
