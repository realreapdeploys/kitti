/** mulberry32: tiny deterministic PRNG. */
export type Rng = () => number

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Derive an independent stream seed from a base seed and a stream tag. */
export function streamSeed(base: number, tag: number): number {
  let h = (base >>> 0) ^ Math.imul(tag >>> 0, 2654435761)
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

export const randomInt = (rng: Rng, n: number): number => Math.floor(rng() * n)
