import { buildDeck } from '../engine/deck'
import { evaluateHand, EvalConfig } from '../engine/evaluate'
import { Card, Hand } from '../engine/types'

/**
 * Precomputes the strength percentile (0..100) of every 3-card combination
 * (C(52,3) = 22,100). Dense Float64Array indexed by comboKey = (i*52 + j)*52 + k.
 * Built once per EvalConfig; ~140k slots.
 */
const cache = new Map<string, Float64Array>()
const SIZE = 52 * 52 * 52

/** Stable index of a card within the canonical deck (suits x ranks order). 0..51 */
const CARD_INDEX = (() => {
  const deck = buildDeck()
  const map = new Map<string, number>()
  deck.forEach((c, i) => map.set(`${c.rank}:${c.suit}`, i))
  return map
})()

export const cardDeckIndex = (c: Card): number => CARD_INDEX.get(`${c.rank}:${c.suit}`)!

const configKey = (cfg: EvalConfig): string => `${cfg.aceTwoThreeRank}|${cfg.allowTwoThreeFive}`

export function percentileTable(cfg: EvalConfig): Float64Array {
  const key = configKey(cfg)
  const hit = cache.get(key)
  if (hit) return hit

  const deck = buildDeck()
  const combos: { i: number; j: number; k: number; ev: ReturnType<typeof evaluateHand> }[] = []
  for (let i = 0; i < 50; i++) {
    for (let j = i + 1; j < 51; j++) {
      for (let k = j + 1; k < 52; k++) {
        combos.push({ i, j, k, ev: evaluateHand([deck[i]!, deck[j]!, deck[k]!] as Hand, cfg) })
      }
    }
  }
  combos.sort((x, y) => {
    if (x.ev.category !== y.ev.category) return x.ev.category - y.ev.category
    const len = Math.max(x.ev.tiebreakers.length, y.ev.tiebreakers.length)
    for (let t = 0; t < len; t++) {
      const a = x.ev.tiebreakers[t] ?? 0, b = y.ev.tiebreakers[t] ?? 0
      if (a !== b) return a - b
    }
    return 0
  })
  const n = combos.length
  const table = new Float64Array(SIZE)
  for (let pos = 0; pos < n; pos++) {
    const c = combos[pos]!
    table[(c.i * 52 + c.j) * 52 + c.k] = (pos / (n - 1)) * 100
  }
  cache.set(key, table)
  return table
}

/** Percentile 0..100 for the 3 cards. Higher = stronger. Allocation-free. */
export function handPercentile(table: Float64Array, cards: Hand): number {
  const a = cardDeckIndex(cards[0]), b = cardDeckIndex(cards[1]), c = cardDeckIndex(cards[2])
  let i = a, j = b, k = c
  if (i > j) { const t = i; i = j; j = t }
  if (j > k) { const t = j; j = k; k = t }
  if (i > j) { const t = i; i = j; j = t }
  return table[(i * 52 + j) * 52 + k]!
}
