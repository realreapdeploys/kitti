import { Card, Hand } from './types'
import { EvalConfig, compareEvaluations, evaluateHand, evaluateHand as evalHand } from './evaluate'

export type Split = [Hand, Hand, Hand]

/**
 * Enumerate all 280 ways to split 9 cards into three UNORDERED groups of 3.
 * Indices 0..8 refer to the input array. Groups are canonicalized so each split
 * is generated exactly once (8 10 20 / 6 = 140? no: C(9,3)*C(6,3) = 84*20 = 1680
 * ordered triples; each unordered split appears 3! = 6 times -> 280).
 */
export function enumerateSplits(cards: Card[]): Split[] {
  if (cards.length !== 9) throw new Error('enumerateSplits requires exactly 9 cards')
  const seen = new Set<string>()
  const out: Split[] = []
  const combos = (n: number, k: number): number[][] => {
    const res: number[][] = []
    const rec = (start: number, acc: number[]): void => {
      if (acc.length === k) { res.push(acc.slice()); return }
      for (let i = start; i <= n - (k - acc.length); i++) rec(i + 1, [...acc, i])
    }
    rec(0, [])
    return res
  }
  const triples = combos(9, 3)
  const keyOf = (idxs: number[]): string => idxs.slice().sort((a, b) => a - b).join(',')
  for (const a of triples) {
    const remA = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(i => !a.includes(i))
    const combosB = combos(6, 3)
    for (const bLocal of combosB) {
      const b = bLocal.map(i => remA[i]!)
      const c = remA.filter(i => !b.includes(i))
      // canonical: sort the three group keys, dedupe
      const groups = [keyOf(a), keyOf(b), keyOf(c)].sort()
      const key = groups.join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push([
        a.map(i => cards[i]!) as Hand,
        b.map(i => cards[i]!) as Hand,
        c.map(i => cards[i]!) as Hand
      ])
    }
  }
  return out
}

/** Order a split strongest-first. Returns [Hand1, Hand2, Hand3]. */
export function orderSplit(split: Split, cfg: EvalConfig): Split {
  const hands = split.map(h => ({ h, ev: evaluateHand(h, cfg) }))
  hands.sort((x, y) => compareEvaluations(y.ev, x.ev))
  return [hands[0]!.h, hands[1]!.h, hands[2]!.h]
}

/**
 * All valid ordered arrangements of a 9-card hand: every split, ordered strongest-first,
 * optionally filtered by the order rule (always satisfiable after ordering since h1>=h2>=h3).
 */
export function allOrderedArrangements(cards: Card[], cfg: EvalConfig & { enforceOrder: boolean }): [Hand, Hand, Hand][] {
  const splits = enumerateSplits(cards)
  const out: [Hand, Hand, Hand][] = []
  for (const s of splits) {
    const ordered = orderSplit(s, cfg)
    if (cfg.enforceOrder) {
      const [h1, h2, h3] = ordered
      const e1 = evaluateHand(h1, cfg), e2 = evaluateHand(h2, cfg), e3 = evaluateHand(h3, cfg)
      // ordered splits satisfy h1>=h2>=h3 by construction; check anyway (defensive)
      if (compareEvaluations(e1, e2) < 0 || compareEvaluations(e2, e3) < 0) continue
    }
    out.push(ordered)
  }
  return out
}

export interface ArrangementCheck {
  ok: boolean
  reason?: string
}

export function checkArrangement(
  cards: Card[],
  hands: [Hand, Hand, Hand] | null,
  cfg: EvalConfig & { enforceOrder: boolean }
): ArrangementCheck {
  if (cards.length !== 9) return { ok: false, reason: 'Need exactly 9 cards' }
  if (!hands) return { ok: false, reason: 'All three hands must be filled' }
  const flat = hands.flat()
  if (flat.length !== 9) return { ok: false, reason: 'Hands must hold 3 cards each' }
  const want = new Map<string, number>()
  for (const c of cards) want.set(`${c.rank}:${c.suit}`, (want.get(`${c.rank}:${c.suit}`) ?? 0) + 1)
  const got = new Map<string, number>()
  for (const c of flat) got.set(`${c.rank}:${c.suit}`, (got.get(`${c.rank}:${c.suit}`) ?? 0) + 1)
  if (want.size !== got.size) return { ok: false, reason: 'Arrangement must use each of your 9 cards exactly once' }
  for (const [k, v] of want) {
    if (got.get(k) !== v) return { ok: false, reason: 'Arrangement must use each of your 9 cards exactly once' }
  }
  for (const h of hands) {
    if (h.length !== 3) return { ok: false, reason: 'Each hand must hold exactly 3 cards' }
  }
  if (cfg.enforceOrder) {
    const e1 = evalHand(hands[0], cfg), e2 = evalHand(hands[1], cfg), e3 = evalHand(hands[2], cfg)
    if (compareEvaluations(e1, e2) < 0) return { ok: false, reason: 'Hand 1 must be at least as strong as Hand 2' }
    if (compareEvaluations(e2, e3) < 0) return { ok: false, reason: 'Hand 2 must be at least as strong as Hand 3' }
  }
  return { ok: true }
}
