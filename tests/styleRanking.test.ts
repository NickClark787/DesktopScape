import { describe, expect, it } from 'vitest';
import type { Monster } from '@shared/types';
import { rankStyles, styleScores } from '../src/renderer/utils/styleRanking';

/**
 * Build a synthetic monster with the defence values we want to test against.
 * Only fields the ranker reads need to be realistic — everything else is
 * filler the type system requires.
 */
function makeMonster(overrides: {
  name?: string;
  defensive?: Partial<Monster['defensive']>;
  weakness?: Monster['weakness'];
}): Monster {
  return {
    id: 1,
    name: overrides.name ?? 'Test',
    version: '',
    image: '',
    level: 1,
    speed: 4,
    style: [],
    size: 1,
    max_hit: '',
    skills: { atk: 1, def: 1, hp: 1, magic: 1, ranged: 1, str: 1 },
    offensive: { atk: 0, str: 0, magic: 0, magic_str: 0, ranged: 0, ranged_str: 0 },
    defensive: {
      flat_armour: 0,
      stab: 0, slash: 0, crush: 0,
      magic: 0, heavy: 0, standard: 0, light: 0,
      ...overrides.defensive,
    },
    attributes: [],
    immunities: null,
    is_slayer_monster: false,
    weakness: overrides.weakness ?? null,
  };
}

describe('rankStyles', () => {
  it('returns the canonical order when no monster is selected', () => {
    expect(rankStyles(null)).toEqual(['melee', 'ranged', 'magic']);
  });

  it('puts magic first when magic defence is lowest', () => {
    const m = makeMonster({ defensive: { stab: 100, slash: 100, crush: 100, standard: 80, magic: 20 } });
    expect(rankStyles(m)[0]).toBe('magic');
  });

  it('puts ranged first when standard ranged defence is lowest', () => {
    const m = makeMonster({ defensive: { stab: 100, slash: 100, crush: 100, standard: 10, magic: 80 } });
    expect(rankStyles(m)[0]).toBe('ranged');
  });

  it('uses the lowest of stab/slash/crush for melee — mirrors engine behavior', () => {
    // High stab, low crush → melee should rank by 10, not by 100
    const m = makeMonster({ defensive: { stab: 100, slash: 100, crush: 10, standard: 50, magic: 50 } });
    expect(rankStyles(m)[0]).toBe('melee');
    expect(styleScores(m).melee).toBe(10);
  });

  it('boosts magic when monster has an elemental weakness', () => {
    // Magic def 60, weakness fire @50% → effective 60-50=10, beats melee 30
    const m = makeMonster({
      defensive: { stab: 30, slash: 30, crush: 30, standard: 30, magic: 60 },
      weakness: { element: 'fire', severity: 50 },
    });
    expect(rankStyles(m)[0]).toBe('magic');
    expect(styleScores(m).magic).toBe(10);
  });

  it('ignores non-elemental weakness strings', () => {
    // "none" appears in the data; should not boost magic
    const m = makeMonster({
      defensive: { stab: 30, slash: 30, crush: 30, standard: 30, magic: 100 },
      weakness: { element: 'none', severity: 50 },
    });
    expect(rankStyles(m)[0]).not.toBe('magic');
    expect(styleScores(m).magic).toBe(100);
  });

  it('returns all three styles, no duplicates, regardless of inputs', () => {
    const m = makeMonster({ defensive: { stab: 50, slash: 50, crush: 50, standard: 50, magic: 50 } });
    const order = rankStyles(m);
    expect(order).toHaveLength(3);
    expect(new Set(order).size).toBe(3);
  });

  it('keeps default order on ties (stable sort)', () => {
    const m = makeMonster({ defensive: { stab: 50, slash: 50, crush: 50, standard: 50, magic: 50 } });
    expect(rankStyles(m)).toEqual(['melee', 'ranged', 'magic']);
  });
});
