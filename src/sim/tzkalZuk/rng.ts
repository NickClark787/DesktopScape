/**
 * Seedable deterministic RNG (mulberry32). Same generic stream the Sol
 * Heredit sim uses — each fight module keeps its own copy so the sims stay
 * fully self-contained. A (seed, input stream) pair reproduces a run
 * bit-for-bit, the foundation of replays and scrubbing.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxInclusive]. */
  int(maxInclusive: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxInclusive: number) => Math.floor(next() * (maxInclusive + 1)),
    chance: (p: number) => next() < p,
  };
}

/** Derive a 32-bit seed from an arbitrary string (fnv1a). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
