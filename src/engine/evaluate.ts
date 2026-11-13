import { CATEGORY, Card, EvaluatedHand, Hand } from './types'
import { AceTwoThreeRank } from './config'

export interface EvalConfig {
  aceTwoThreeRank: AceTwoThreeRank
  allowTwoThreeFive: boolean
}

/**
 * Run order values. Ace-high run (A-K-Q) = 100, A-2-3 = 99 under 'second_highest'
 * (directly below A-K-Q, per spec) or 0 under 'lowest' (below 2-3-4).
 * Ordinary runs use their highest rank: K-Q-J = 13 ... 4-3-2 = 4. Runs never wrap.
 */
export function runValue(ranks: [number, number, number], cfg: EvalConfig): number | null {
  const [a, b, c] = [...ranks].sort((x, y) => x - y) as [number, number, number]
  if (a === 12 && b === 13 && c === 14) return 100 // A-K-Q
  if (a === 2 && b === 3 && c === 14) return cfg.aceTwoThreeRank === 'second_highest' ? 99 : 0 // A-2-3
  if (b - a === 1 && c - b === 1) return c
  return null
}

export function evaluateHand(cards: Hand, cfg: EvalConfig): EvaluatedHand {
  const ranks = cards.map(c => c.rank).sort((x, y) => y - x) as [number, number, number]
  const suited = cards.every(c => c.suit === cards[0]!.suit)
  const rankCounts = new Map<number, number>()
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1)

  // House rule 2-3-5: beats everything (including trails). Not a pure run; a suited 2-3-5 stays a color.
  if (cfg.allowTwoThreeFive) {
    const set = new Set(ranks)
    if (set.size === 3 && set.has(2) && set.has(3) && set.has(5) && !suited) {
      return { cards, category: CATEGORY.TWO_THREE_FIVE, tiebreakers: [5, 3, 2] }
    }
  }

  const rv = runValue([ranks[0], ranks[1], ranks[2]], cfg)

  if (rankCounts.size === 1) {
    return { cards, category: CATEGORY.TRAIL, tiebreakers: [ranks[0]] }
  }
  if (rv !== null && suited) {
    return { cards, category: CATEGORY.PURE_RUN, tiebreakers: [rv] }
  }
  if (rv !== null) {
    return { cards, category: CATEGORY.RUN, tiebreakers: [rv] }
  }
  if (suited) {
    return { cards, category: CATEGORY.COLOR, tiebreakers: [...ranks] }
  }
  if (rankCounts.size === 2) {
    // exactly one pair among 3 cards
    let pairRank = 0
    let kicker = 0
    for (const [r, n] of rankCounts) {
      if (n === 2) pairRank = r
      else kicker = r
    }
    return { cards, category: CATEGORY.PAIR, tiebreakers: [pairRank, kicker] }
  }
  return { cards, category: CATEGORY.HIGH_CARD, tiebreakers: [...ranks] }
}

export function compareEvaluations(a: EvaluatedHand, b: EvaluatedHand): -1 | 0 | 1 {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length)
  for (let i = 0; i < len; i++) {
    const av = a.tiebreakers[i] ?? 0
    const bv = b.tiebreakers[i] ?? 0
    if (av !== bv) return av > bv ? 1 : -1
  }
  return 0
}

export function compareHands(a: Card[], b: Card[], cfg: EvalConfig): -1 | 0 | 1 {
  return compareEvaluations(
    evaluateHand(a as Hand, cfg),
    evaluateHand(b as Hand, cfg)
  )
}

/** Human-friendly name, e.g. "Pair of 7s", "Pure Run, 9-8-7 of hearts". */
export function describeHand(cards: Hand, cfg: EvalConfig): string {
  const ev = evaluateHand(cards, cfg)
  const rankName = (r: number): string =>
    r === 14 ? 'Ace' : r === 13 ? 'King' : r === 12 ? 'Queen' : r === 11 ? 'Jack' : String(r)
  const plural = (r: number): string =>
    r === 14 ? 'Aces' : r === 13 ? 'Kings' : r === 12 ? 'Queens' : r === 11 ? 'Jacks' : `${r}s`
  switch (ev.category) {
    case CATEGORY.TRAIL:
      return `Trail of ${plural(ev.tiebreakers[0]!)}`
    case CATEGORY.PURE_RUN:
    case CATEGORY.RUN: {
      const sorted = [...cards].sort((x, y) => y.rank - x.rank)
      const isWheel = new Set(cards.map(c => c.rank)).has(14) && new Set(cards.map(c => c.rank)).has(2)
      const hi = isWheel ? [3, 2, 14] : sorted.map(c => c.rank)
      const label = hi.map(rankName).join('-')
      const prefix = ev.category === CATEGORY.PURE_RUN ? 'Pure Run' : 'Run'
      const suitSuffix = ev.category === CATEGORY.PURE_RUN ? ` of ${cards[0]!.suit}` : ''
      return `${prefix}, ${label}${suitSuffix}`
    }
    case CATEGORY.COLOR:
      return `Color, ${rankName(ev.tiebreakers[0]!)} high`
    case CATEGORY.PAIR:
      return `Pair of ${plural(ev.tiebreakers[0]!)}`
    case CATEGORY.TWO_THREE_FIVE:
      return '2-3-5 (special)'
    default:
      return `High Card, ${rankName(ev.tiebreakers[0]!)} high`
  }
}
