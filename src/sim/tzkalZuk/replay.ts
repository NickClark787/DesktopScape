/**
 * Replay = (seed, config, ordered client inputs). The engine is
 * deterministic and both RNG streams derive from the seed, so re-feeding
 * the inputs reproduces the run; scrubbing to tick N is a fresh
 * re-simulation stopped at N.
 */
import { TzKalZukSim } from './engine';
import type { Monster } from '@shared/types';
import type { ReplayFile, SimConfig, TimedInput } from './types';

export function exportReplay(sim: TzKalZukSim): ReplayFile {
  const { seed, monster, addMonsters, ...rest } = sim.config;
  void addMonsters;
  return {
    version: 1,
    seed,
    monsterId: monster.id,
    config: rest,
    inputs: [...sim.inputLog],
  };
}

export function serializeReplay(sim: TzKalZukSim): string {
  return JSON.stringify(exportReplay(sim));
}

export function parseReplay(json: string): ReplayFile {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') throw new Error('not a replay file');
  const r = parsed as Partial<ReplayFile>;
  if (r.version !== 1 || typeof r.seed !== 'number' || !Array.isArray(r.inputs) || !r.config) {
    throw new Error('unrecognized replay format');
  }
  return r as ReplayFile;
}

/**
 * Rebuild a sim from a replay and run it to `targetTick` (or completion).
 * `monster` is Zuk; `addMonsters` are re-resolved by the caller from the
 * live data (they aren't serialized — the ids are stable).
 */
export function rehydrate(
  replay: ReplayFile,
  monster: Monster,
  addMonsters: SimConfig['addMonsters'],
  targetTick = Infinity,
): TzKalZukSim {
  const config: SimConfig = { seed: replay.seed, monster, addMonsters, ...replay.config };
  const sim = new TzKalZukSim(config);
  for (const input of replay.inputs as TimedInput[]) sim.queueInput(input);
  while (!sim.finished && sim.tick < targetTick) sim.advance();
  return sim;
}
