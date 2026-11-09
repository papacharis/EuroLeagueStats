/** Small deterministic PRNG (mulberry32). The state is a uint32 stored in the game state
 * so that fluctuations survive save/restore and undo, and tests are reproducible. */
export function nextRandom(state: number): [value: number, nextState: number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

/** Uniform integer in [min, max]. */
export function nextInt(state: number, min: number, max: number): [value: number, nextState: number] {
  const [v, s] = nextRandom(state);
  return [min + Math.floor(v * (max - min + 1)), s];
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
