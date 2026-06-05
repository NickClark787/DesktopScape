import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDefenceReduction, applyDefenceReductionDescribed } from '@engine/defenceReduction';
import type { DefenceReduction, Monster } from '@shared/types';

const DATA = resolve(process.cwd(), 'resources/data');
const monsters: Monster[] = JSON.parse(readFileSync(resolve(DATA, 'monsters.json'), 'utf8'));
const abyssal = monsters.find((m) => m.id === 415)!; // def 135, magic 1, demon
const vorkath = monsters.find((m) => m.id === 8059)!; // def 214, dragon (not demon)

const base: DefenceReduction = {
  dwh: 0, elderMaul: 0, arclight: 0, emberlight: 0, bgs: 0, accursed: false, vulnerability: false,
};
const def = (m: Monster, r: Partial<DefenceReduction>) => applyDefenceReduction(m, { ...base, ...r }).skills.def;

describe('applyDefenceReduction', () => {
  it('Dragon warhammer removes 30% of current defence per hit (iterative)', () => {
    // 135 → 135-40=95 → 95-28=67
    expect(def(abyssal, { dwh: 1 })).toBe(95);
    expect(def(abyssal, { dwh: 2 })).toBe(67);
  });

  it('Elder maul removes 35% of current defence per hit', () => {
    // 135 - trunc(135*0.35)=135-47=88
    expect(def(abyssal, { elderMaul: 1 })).toBe(88);
  });

  it('Accursed sceptre scales defence and magic by 17/20', () => {
    const m = applyDefenceReduction(abyssal, { ...base, accursed: true });
    expect(m.skills.def).toBe(Math.trunc((135 * 17) / 20)); // 114
    expect(m.skills.magic).toBe(Math.trunc((abyssal.skills.magic * 17) / 20));
  });

  it('Vulnerability scales defence by 9/10', () => {
    expect(def(abyssal, { vulnerability: true })).toBe(Math.trunc((135 * 9) / 10)); // 121
  });

  it('Arclight drains more off base defence vs demons', () => {
    // demon: per hit trunc(2*135/20)+1 = 14 → 2 hits = 28 → 135-28=107
    expect(def(abyssal, { arclight: 2 })).toBe(107);
    // non-demon (Vorkath 214): per hit trunc(1*214/20)+1 = 11 → 214-11=203
    expect(def(vorkath, { arclight: 1 })).toBe(203);
  });

  it('Bandos godsword drains a flat number of levels, clamped at 0', () => {
    expect(def(abyssal, { bgs: 50 })).toBe(85);
    expect(def(abyssal, { bgs: 999 })).toBe(0);
  });

  it('never drives defence below 0 no matter how many hits', () => {
    expect(def(abyssal, { dwh: 20 })).toBeGreaterThanOrEqual(0);
    expect(def(abyssal, { elderMaul: 20 })).toBeGreaterThanOrEqual(0);
  });

  it('is a no-op (and reports no effect) when nothing is configured', () => {
    const r = applyDefenceReductionDescribed(abyssal, undefined);
    expect(r.monster).toBe(abyssal);
    expect(r.effect).toBeNull();
    const z = applyDefenceReductionDescribed(abyssal, base);
    expect(z.effect).toBeNull();
  });

  it('reports a describing effect when active', () => {
    const r = applyDefenceReductionDescribed(abyssal, { ...base, dwh: 1 });
    expect(r.effect).not.toBeNull();
    expect(r.effect!.name).toBe('Defence reduction');
  });
});
