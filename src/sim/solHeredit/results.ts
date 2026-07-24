/**
 * Post-run aggregation: everything the results panel shows is derived
 * from the engine's event log — the engine itself keeps no UI-facing
 * statistics.
 */
import { TICK_MS } from './constants';
import type { SolHereditSim } from './engine';
import type { AoeAttack, MistakeEntry, ResultsSummary } from './types';

const AOE_ATTACKS: AoeAttack[] = ['spear1', 'spear2', 'shield1', 'shield2'];

export function summarize(sim: SolHereditSim): ResultsSummary {
  const dodges: ResultsSummary['dodges'] = {
    spear1: { dodged: 0, total: 0 },
    spear2: { dodged: 0, total: 0 },
    shield1: { dodged: 0, total: 0 },
    shield2: { dodged: 0, total: 0 },
  };
  const damageBySource: Record<string, number> = {};
  const suppliesUsed: Record<string, number> = {};
  const mistakes: MistakeEntry[] = [];
  let tripleTotal = 0;
  let tripleBlocked = 0;
  let grappleTotal = 0;
  let grappleParried = 0;
  let grapplePerfect = 0;
  let damageDealt = 0;

  for (const e of sim.events) {
    switch (e.type) {
      case 'playerDodged':
        dodges[e.attack].dodged++;
        dodges[e.attack].total++;
        break;
      case 'playerDamaged': {
        damageBySource[e.source] = (damageBySource[e.source] ?? 0) + e.amount;
        if (AOE_ATTACKS.includes(e.source as AoeAttack)) {
          dodges[e.source as AoeAttack].total++;
        }
        if (e.avoidable && e.correctAction) {
          mistakes.push({ tick: e.tick, what: `Hit by ${e.source} for ${e.amount}`, correctAction: e.correctAction, damage: e.amount });
        }
        break;
      }
      case 'parryBlocked':
        tripleTotal++;
        tripleBlocked++;
        break;
      case 'parryFailed':
        tripleTotal++;
        break;
      case 'grappleParried':
        grappleTotal++;
        grappleParried++;
        if (e.perfect) grapplePerfect++;
        break;
      case 'grappleFailed':
        grappleTotal++;
        break;
      case 'playerHitBoss':
        damageDealt += e.damage;
        break;
      case 'consumed':
        suppliesUsed[e.itemId] = (suppliesUsed[e.itemId] ?? 0) + 1;
        break;
      case 'inputDropped':
        mistakes.push({ tick: e.tick, what: `Input lost to packet loss (${e.cmd.kind})`, correctAction: 'n/a — network', damage: 0 });
        break;
      default:
        break;
    }
  }

  const ticks = sim.tick;
  const seconds = (ticks * TICK_MS) / 1000;
  const assists = sim.config.assists;
  return {
    outcome: sim.outcome ?? 'aborted',
    ticks,
    seconds,
    bossHpLeft: sim.bossHp,
    playerDps: seconds > 0 ? damageDealt / seconds : 0,
    theoreticalDps: sim.theoreticalDps(),
    damageBySource,
    dodges,
    tripleParry: { blocked: tripleBlocked, total: tripleTotal },
    grapple: { parried: grappleParried, perfect: grapplePerfect, total: grappleTotal },
    suppliesUsed,
    mistakes,
    assistsUsed: assists.hazardOverlay || assists.nextAttackPrediction
      || assists.prayerTimingIndicator || assists.safeTileHighlight,
  };
}
