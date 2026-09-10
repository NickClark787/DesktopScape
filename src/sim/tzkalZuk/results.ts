/**
 * Post-run aggregation. Everything the results panel shows is derived from
 * the engine's event log — the engine keeps no UI-facing statistics.
 */
import { TICK_MS } from './constants';
import type { TzKalZukSim } from './engine';
import type { EntityKind, MistakeEntry, ResultsSummary } from './types';

export function summarize(sim: TzKalZukSim): ResultsSummary {
  const damageBySource: Record<string, number> = {};
  const suppliesUsed: Record<string, number> = {};
  const addsKilled: Record<EntityKind, number> = { zuk: 0, ranger: 0, mager: 0, jad: 0, healer: 0, jadHealer: 0 };
  const mistakes: MistakeEntry[] = [];
  let damageDealt = 0;
  let zukHealed = 0;
  let switchCorrect = 0;
  let switchTotal = 0;

  for (const e of sim.events) {
    switch (e.type) {
      case 'playerDamaged':
        damageBySource[e.source] = (damageBySource[e.source] ?? 0) + e.amount;
        if (e.correctAction) {
          mistakes.push({ tick: e.tick, what: `Took ${e.amount} from ${e.source}`, correctAction: e.correctAction, damage: e.amount });
        }
        break;
      case 'playerHit':
        if (e.kind === 'zuk') damageDealt += e.damage;
        break;
      case 'addKilled':
        addsKilled[e.kind]++;
        break;
      case 'zukHealed':
        zukHealed += e.amount;
        break;
      case 'addAttack':
        // Only attacks aimed at the player are prayer-switch opportunities;
        // shield attacks arrive as `glyphDamaged` and cannot be prayed off.
        if (e.kind === 'jad' || e.kind === 'mager' || e.kind === 'ranger') {
          switchTotal++;
          if (e.blocked) switchCorrect++;
        }
        break;
      case 'glyphDestroyed':
        mistakes.push({
          tick: e.tick,
          what: 'The Ancestral Glyph collapsed',
          correctAction: 'tag every spawn as it appears — they chew through the shield’s 600 HP',
          damage: 0,
        });
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
  const a = sim.config.assists;
  return {
    outcome: sim.outcome ?? 'aborted',
    ticks,
    seconds,
    zukHpLeft: sim.getSnapshot().zukHp,
    glyphHpLeft: sim.getSnapshot().glyphHp,
    glyphDestroyed: sim.glyphDestroyed,
    glyphDamageTaken: sim.glyphDamageTaken,
    playerDps: seconds > 0 ? damageDealt / seconds : 0,
    theoreticalDps: sim.theoreticalDps(),
    damageBySource,
    addsKilled,
    prayerSwitches: { correct: switchCorrect, total: switchTotal },
    zukHealed,
    suppliesUsed,
    mistakes,
    assistsUsed: a.glyphSafeHighlight || a.addTimers || a.jadPrayerIndicator || a.setCountdown,
  };
}
