/**
 * Sol Heredit attack-pattern state machine — the rotation rules the whole
 * fight readability depends on (wiki `Sol_Heredit` § Attack pattern).
 */
import { describe, expect, it } from 'vitest';
import { AttackScript } from '@sim/solHeredit/attackPattern';
import type { Rng } from '@sim/solHeredit/rng';
import type { BossOptions } from '@sim/solHeredit/types';

/** Deterministic rng: `next()` pops from a queue (default 0.99 = "no"). */
function fakeRng(values: number[] = []): Rng {
  const q = [...values];
  const next = () => (q.length ? q.shift()! : 0.99);
  return {
    next,
    int: (max: number) => Math.min(max, Math.floor(next() * (max + 1))),
    chance: (p: number) => next() < p,
  };
}

function opts(overrides: Partial<BossOptions> = {}): BossOptions {
  return {
    startHpPct: 100, enabledTransitions: [], modifierIds: [], forcedRotation: [],
    infiniteHp: false, practiceMode: 'full', practicePhase: 0, ...overrides,
  };
}

// rng notes: at full HP no special rolls happen, so each pick consumes ONE
// value (the class roll): <0.5 → spear, ≥0.5 → shield.
const SPEAR = 0.4;
const SHIELD = 0.6;

describe('AttackScript', () => {
  it('always opens with Spear 1, consuming no rng', () => {
    const s = new AttackScript(opts());
    expect(s.next(fakeRng([0.0]), 1, false)).toBe('spear1');
  });

  it('same class twice in a row switches to the other pattern', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false); // spear1 opener
    expect(s.next(fakeRng([SPEAR]), 1, false)).toBe('spear2');
    expect(s.next(fakeRng([SPEAR]), 1, false)).toBe('spear1'); // toggles back
    expect(s.next(fakeRng([SHIELD]), 1, false)).toBe('shield1');
    expect(s.next(fakeRng([SHIELD]), 1, false)).toBe('shield2');
  });

  it('alternating class resets that class to its first variant', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false); // spear1
    expect(s.next(fakeRng([SPEAR]), 1, false)).toBe('spear2');
    expect(s.next(fakeRng([SHIELD]), 1, false)).toBe('shield1'); // reset
    expect(s.next(fakeRng([SPEAR]), 1, false)).toBe('spear1'); // reset
  });

  it('after a transition: always a spear; Spear 1 previous forces Spear 2', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false); // spear1
    expect(s.next(fakeRng(), 0.89, true)).toBe('spear2');
    // Previous now spear2 → post-transition gives spear1.
    expect(s.next(fakeRng(), 0.74, true)).toBe('spear1');
  });

  it('post-transition after a shield attack is a spear (variant 1)', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false); // spear1
    s.next(fakeRng([SHIELD]), 1, false); // shield1
    expect(s.next(fakeRng(), 0.89, true)).toBe('spear1');
  });

  it('triple parry only below 90% HP; grapple only below 75%', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false); // opener
    // At full HP a 0.0 roll can't produce a special (gates skip the rolls).
    expect(['spear1', 'spear2', 'shield1', 'shield2']).toContain(s.next(fakeRng([0.0]), 1, false));
    // Below 90%: 0.0 < TRIPLE_PARRY_CHANCE → triple parry.
    expect(s.next(fakeRng([0.0]), 0.85, false)).toBe('tripleParry');
    // Specials are cooldown-gated for the next few attacks.
    expect(s.next(fakeRng([0.0, 0.0, SPEAR]), 0.85, false)).not.toBe('tripleParry');
  });

  it('grapple fires below 75% when the triple roll misses', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false);
    for (let i = 0; i < 4; i++) s.next(fakeRng([SPEAR]), 1, false); // build cooldown
    // [triple roll 0.5 → miss, grapple roll 0.0 → hit]
    expect(s.next(fakeRng([0.5, 0.0]), 0.7, false)).toBe('grapple');
  });

  it('specials reset the pattern memory', () => {
    const s = new AttackScript(opts());
    s.next(fakeRng(), 1, false); // spear1
    s.next(fakeRng([SPEAR]), 1, false); // spear2 (lastVariant 2)
    expect(s.next(fakeRng([0.0]), 0.85, false)).toBe('tripleParry');
    // After the reset a spear pick is variant 1 again, not a toggle to 2.
    expect(s.next(fakeRng([SPEAR]), 0.85, false)).toBe('spear1');
  });

  it('forced rotations loop verbatim', () => {
    const s = new AttackScript(opts({ forcedRotation: ['shield2', 'grapple'] }));
    expect(s.next(fakeRng(), 1, false)).toBe('shield2');
    expect(s.next(fakeRng(), 1, false)).toBe('grapple');
    expect(s.next(fakeRng(), 1, false)).toBe('shield2');
  });

  it('practice modes pin the attack', () => {
    const tp = new AttackScript(opts({ practiceMode: 'tripleParry' }));
    expect(tp.next(fakeRng(), 1, false)).toBe('tripleParry');
    const gr = new AttackScript(opts({ practiceMode: 'grapple' }));
    expect(gr.next(fakeRng(), 1, false)).toBe('grapple');
  });

  it('dodgeOnly never rolls specials', () => {
    const s = new AttackScript(opts({ practiceMode: 'dodgeOnly' }));
    s.next(fakeRng(), 1, false);
    for (let i = 0; i < 20; i++) {
      const pick = s.next(fakeRng([0.0, 0.0, SPEAR]), 0.3, false);
      expect(pick).not.toBe('tripleParry');
      expect(pick).not.toBe('grapple');
    }
  });
});
