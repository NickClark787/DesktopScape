/**
 * Replay = (seed, config, ordered client inputs). Because the engine is
 * deterministic and both RNG streams are derived from the seed, re-feeding
 * the same inputs reproduces the run exactly. Scrubbing to tick N is just
 * a fresh re-simulation stopped at N — cheap at a few thousand ticks and
 * trivially correct.
 */
import { SolHereditSim } from './engine';
import type { Monster } from '@shared/types';
import type { ReplayFile, SimConfig, TimedInput } from './types';

export function exportReplay(sim: SolHereditSim): ReplayFile {
  const { seed, monster, ...rest } = sim.config;
  return {
    version: 1,
    seed,
    monsterId: monster.id,
    config: rest,
    inputs: [...sim.inputLog],
  };
}

export function serializeReplay(sim: SolHereditSim): string {
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
 * All inputs are queued up-front in recorded order, so the network RNG
 * stream is consumed identically to the live run.
 */
export function rehydrate(replay: ReplayFile, monster: Monster, targetTick = Infinity): SolHereditSim {
  const config: SimConfig = { seed: replay.seed, monster, ...replay.config };
  const sim = new SolHereditSim(config);
  for (const input of replay.inputs as TimedInput[]) sim.queueInput(input);
  while (!sim.finished && sim.tick < targetTick) sim.advance();
  return sim;
}
