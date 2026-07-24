/**
 * Sol Heredit's attack-selection state machine.
 *
 * Rules (wiki `Sol_Heredit` § Attack pattern, spec §3):
 *  - His opening attack is always Spear 1.
 *  - Two attacks of the same class in a row → the second uses the OTHER
 *    pattern (Spear 1 → Spear 2, Shield 1 → Shield 2).
 *  - Alternating class resets that class to its first variant.
 *  - After a phase transition he always opens with a spear; if his
 *    previous attack was Spear 1 the next is always Spear 2.
 *  - Special attacks (Triple Parry <90% HP, Grapple <75% HP) reset the
 *    pattern memory entirely.
 */
import {
  GRAPPLE_CHANCE,
  GRAPPLE_HP_GATE,
  SPECIAL_COOLDOWN_ATTACKS,
  TRIPLE_HP_GATE,
  TRIPLE_PARRY_CHANCE,
} from './constants';
import type { Rng } from './rng';
import type { AttackClass, BossAttack, BossOptions } from './types';

const CLASS_OF: Record<BossAttack, AttackClass | 'special'> = {
  spear1: 'spear', spear2: 'spear', shield1: 'shield', shield2: 'shield',
  tripleParry: 'special', grapple: 'special',
};

export class AttackScript {
  private lastClass: AttackClass | null = null;
  private lastVariant: 1 | 2 | null = null;
  /** The literal previous attack (incl. specials) — drives the
   *  post-transition Spear1→Spear2 rule. */
  private prevAttack: BossAttack | null = null;
  private attacksSinceSpecial = Infinity;
  private opened = false;
  private forcedIdx = 0;

  constructor(private readonly opts: BossOptions) {}

  /** Pick the next attack. `afterTransition` is true for the first attack
   *  following a phase transition. */
  next(rng: Rng, hpFrac: number, afterTransition: boolean): BossAttack {
    const forced = this.opts.forcedRotation;
    if (forced.length > 0) {
      const pick = forced[this.forcedIdx % forced.length];
      this.forcedIdx++;
      return this.commit(pick);
    }
    if (this.opts.practiceMode === 'tripleParry') return this.commit('tripleParry');
    if (this.opts.practiceMode === 'grapple') return this.commit('grapple');

    if (!this.opened) {
      this.opened = true;
      return this.commit('spear1');
    }

    if (afterTransition) {
      // Always a spear; Spear 1 twice around a transition is impossible.
      const pick: BossAttack = this.prevAttack === 'spear1' ? 'spear2' : 'spear1';
      return this.commit(pick);
    }

    // Specials — gated by HP, an attack cooldown, and practice mode.
    const specialsAllowed = this.opts.practiceMode !== 'dodgeOnly'
      && this.attacksSinceSpecial >= SPECIAL_COOLDOWN_ATTACKS;
    if (specialsAllowed && hpFrac < TRIPLE_HP_GATE && rng.chance(TRIPLE_PARRY_CHANCE)) {
      return this.commit('tripleParry');
    }
    if (specialsAllowed && hpFrac < GRAPPLE_HP_GATE && rng.chance(GRAPPLE_CHANCE)) {
      return this.commit('grapple');
    }

    // Normal AoE: pick a class, then the variant the pattern rules demand.
    const cls: AttackClass = rng.chance(0.5) ? 'spear' : 'shield';
    const variant: 1 | 2 = cls === this.lastClass ? (this.lastVariant === 1 ? 2 : 1) : 1;
    const pick: BossAttack = cls === 'spear'
      ? (variant === 1 ? 'spear1' : 'spear2')
      : (variant === 1 ? 'shield1' : 'shield2');
    return this.commit(pick);
  }

  private commit(pick: BossAttack): BossAttack {
    const cls = CLASS_OF[pick];
    if (cls === 'special') {
      // Specials reset the rotation memory.
      this.lastClass = null;
      this.lastVariant = null;
      this.attacksSinceSpecial = 0;
    } else {
      this.lastClass = cls;
      this.lastVariant = pick === 'spear1' || pick === 'shield1' ? 1 : 2;
      this.attacksSinceSpecial++;
    }
    this.prevAttack = pick;
    this.opened = true;
    return pick;
  }

  /** What would follow if the current state repeated the given class —
   *  used by the (assist-only) next-attack prediction. */
  predictVariant(cls: AttackClass): 1 | 2 {
    return cls === this.lastClass ? (this.lastVariant === 1 ? 2 : 1) : 1;
  }
}
