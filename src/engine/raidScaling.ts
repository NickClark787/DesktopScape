/**
 * Raid target scaling. Most raid bosses' HP (and, for ToA, defence/atk levels)
 * scale with party size, raid level, and path level. The wiki-doc formulas
 * here match the OSRS Wiki's "Tombs of Amascut", "Chambers of Xeric", and
 * "Theatre of Blood" pages closely enough to give realistic TTKs; they're
 * known approximations where the true formula depends on player combat level
 * (CoX) or per-room team scaling (ToB phases).
 *
 * Applied as a pre-pass: `calcDps` calls `applyRaidScaling(monster, scaling)`
 * and then computes everything against the scaled monster, so accuracy rolls
 * see the raid-inflated defence (ToA) and TTK reflects the raid-inflated HP.
 */

import type { FiredEffect, Monster, RaidScaling } from '@shared/types';

export interface RaidScalingResult {
  monster: Monster;
  effect: FiredEffect | null;
}

// ToA path bosses (path level adds a per-tier HP bump on top of raid level).
const TOA_PATH_BOSSES = [
  'Akkha', 'Ba-Ba', 'Kephri', 'Zebak',
];

function isToaPathBoss(monster: Monster): boolean {
  return TOA_PATH_BOSSES.some((n) => monster.name === n || monster.name.startsWith(n));
}

/**
 * ToA scaling. Per the OSRS Wiki: HP/atk/def scale by raid level, HP scales
 * additionally by team size, and path bosses get a path-level HP bump.
 *
 * Approximations:
 *   - HP raid-level mult: 1 + raidLevel * 0.004 (~+0.4%/RL — matches wiki tables).
 *   - HP team mult:       1 + 0.9 * (partySize - 1).
 *   - HP path mult:       1 + 0.05 * pathLevel (path bosses only).
 *   - Def/atk raid mult:  same RL formula. Team size doesn't affect def/atk.
 */
function applyToaScaling(monster: Monster, s: RaidScaling): Monster {
  const partySize = Math.max(1, s.partySize);
  const raidLevel = Math.max(0, s.raidLevel ?? 0);
  const pathLevel = Math.max(0, s.pathLevel ?? 0);

  const rlMult = 1 + raidLevel * 0.004;
  const teamMult = 1 + 0.9 * (partySize - 1);
  const pathMult = isToaPathBoss(monster) ? 1 + 0.05 * pathLevel : 1;

  const hp = Math.floor(monster.skills.hp * rlMult * teamMult * pathMult);
  const def = Math.floor(monster.skills.def * rlMult);
  const atk = Math.floor(monster.skills.atk * rlMult);
  const str = Math.floor(monster.skills.str * rlMult);
  const magic = Math.floor(monster.skills.magic * rlMult);
  const ranged = Math.floor(monster.skills.ranged * rlMult);

  return {
    ...monster,
    skills: { ...monster.skills, hp, def, atk, str, magic, ranged },
  };
}

/**
 * CoX scaling. The wiki formula uses the highest combat level in the party,
 * which we don't track. We approximate at level-126 leader (the standard
 * assumption for max-account DPS calcs):
 *
 *   - HP team mult: 1 + 0.5 * (n - 1)   [solo 1×, duo 1.5×, trio 2×, 5-man 3×]
 *   - Challenge mode: ×1.5 on HP.
 *
 * Defence/atk levels in CoX scale per the same combat-level formula but the
 * effect on accuracy is small for capped accounts; we leave them unchanged
 * here. Olm's per-claw scaling is a known gap.
 */
function applyCoxScaling(monster: Monster, s: RaidScaling): Monster {
  const partySize = Math.max(1, s.partySize);
  const teamMult = 1 + 0.5 * (partySize - 1);
  const cmMult = s.challengeMode ? 1.5 : 1;
  const hp = Math.floor(monster.skills.hp * teamMult * cmMult);
  return { ...monster, skills: { ...monster.skills, hp } };
}

/**
 * ToB scaling. Mode (Entry / Normal / Hard) is already encoded as a separate
 * monster variant in the data — pick the right one and the HP we receive is
 * the 5-man baseline. Smaller teams reduce HP linearly:
 *
 *   teamMult = 1.0 - 0.025 * (5 - n)
 *   1p: 90% | 2p: 92.5% | 3p: 95% | 4p: 97.5% | 5p: 100%
 */
function applyTobScaling(monster: Monster, s: RaidScaling): Monster {
  const partySize = Math.max(1, Math.min(5, s.partySize));
  const teamMult = 1.0 - (5 - partySize) * 0.025;
  const hp = Math.floor(monster.skills.hp * teamMult);
  return { ...monster, skills: { ...monster.skills, hp } };
}

export function applyRaidScaling(monster: Monster, scaling: RaidScaling | undefined): Monster {
  if (!scaling) return monster;
  switch (scaling.kind) {
    case 'toa': return applyToaScaling(monster, scaling);
    case 'cox': return applyCoxScaling(monster, scaling);
    case 'tob': return applyTobScaling(monster, scaling);
    default:    return monster;
  }
}

/**
 * Same as `applyRaidScaling` but also reports a human-readable description of
 * the scaling for the effects-fired UI panel.
 */
export function applyRaidScalingDescribed(
  monsterIn: Monster,
  scaling: RaidScaling | undefined,
): RaidScalingResult {
  if (!scaling) return { monster: monsterIn, effect: null };
  const monster = applyRaidScaling(monsterIn, scaling);
  if (monster === monsterIn) return { monster, effect: null };

  const hpRatio = monster.skills.hp / Math.max(1, monsterIn.skills.hp);
  const fmt = (x: number) => x.toFixed(2);
  let name: string;
  let detail: string;
  if (scaling.kind === 'toa') {
    const rl = scaling.raidLevel ?? 0;
    const path = scaling.pathLevel ?? 0;
    name = 'ToA scaling';
    detail = `RL${rl}, ${scaling.partySize}p${path > 0 ? `, path ${path}` : ''}: HP ×${fmt(hpRatio)}`;
  } else if (scaling.kind === 'cox') {
    name = 'CoX scaling';
    detail = `${scaling.partySize}p${scaling.challengeMode ? ' CM' : ''}: HP ×${fmt(hpRatio)}`;
  } else {
    name = 'ToB scaling';
    detail = `${scaling.partySize}p: HP ×${fmt(hpRatio)} of 5-man baseline`;
  }
  return { monster, effect: { name, detail } };
}
