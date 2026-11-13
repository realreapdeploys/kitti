import { describe, expect, it } from 'vitest'
import { buildDeck } from '../src/engine/deck'
import { evaluateHand, compareHands, compareEvaluations } from '../src/engine/evaluate'
import { CATEGORY, CATEGORY_NAME, Hand, Card } from '../src/engine/types'
import { mulberry32 } from '../src/engine/rng'

const ev = (cards: Hand, cfg = { aceTwoThreeRank: 'second_highest' as const, allowTwoThreeFive: false }) => evaluateHand(cards, cfg)
const H = (a: [number, number], b: [number, number], c: [number, number]): Hand =>
  [{ rank: a[0] as Hand[0]['rank'], suit: SUITS[a[1]]! },
   { rank: b[0] as Hand[0]['rank'], suit: SUITS[b[1]]! },
   { rank: c[0] as Hand[0]['rank'], suit: SUITS[c[1]]! }]
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const

describe('evaluateHand — categories', () => {
  it('detects trail and orders trails by rank', () => {
    const aaa = ev(H([14, 0], [14, 1], [14, 2]))
    const twos = ev(H([2, 0], [2, 1], [2, 2]))
    expect(aaa.category).toBe(CATEGORY.TRAIL)
    expect(compareEvaluations(aaa, twos)).toBe(1)
  })
  it('A-K-Q is the highest run and equals Q-K-A regardless of order', () => {
    const akq = ev(H([14, 0], [13, 1], [12, 2]))
    const qka = ev(H([12, 3], [14, 0], [13, 1]))
    expect(akq.category).toBe(CATEGORY.RUN)
    expect(qka.tiebreakers).toEqual(akq.tiebreakers)
    const kqj = ev(H([13, 0], [12, 1], [11, 2]))
    expect(compareEvaluations(akq, kqj)).toBe(1)
  })
  it('A-2-3 is second highest by default and lowest when configured', () => {
    const a23 = ev(H([14, 0], [2, 1], [3, 2]))
    const kqj = ev(H([13, 0], [12, 1], [11, 2]))
    const akq = ev(H([14, 0], [13, 1], [12, 2]))
    const t234 = ev(H([2, 0], [3, 1], [4, 2]))
    expect(a23.category).toBe(CATEGORY.RUN)
    expect(compareEvaluations(akq, a23)).toBe(1)
    expect(compareEvaluations(a23, kqj)).toBe(1) // second highest: above K-Q-J
    const a23low = evaluateHand(H([14, 0], [2, 1], [3, 2]), { aceTwoThreeRank: 'lowest', allowTwoThreeFive: false })
    expect(compareEvaluations(t234, a23low)).toBe(1) // lowest: below 2-3-4
  })
  it('K-A-2 is NOT a run', () => {
    const ka2 = ev(H([13, 0], [14, 1], [2, 2]))
    expect(ka2.category).not.toBe(CATEGORY.RUN)
    expect(ka2.category).not.toBe(CATEGORY.PURE_RUN)
  })
  it('2-3-4 is the lowest ordinary run (beaten by K-Q-J, beats nothing below it)', () => {
    const t234 = ev(H([2, 0], [3, 1], [4, 2]))
    const t345 = ev(H([3, 0], [4, 1], [5, 2]))
    expect(t234.category).toBe(CATEGORY.RUN)
    expect(compareEvaluations(t345, t234)).toBe(1)
  })
  it('pure run detected and ordered; trail beats pure run', () => {
    const pure = ev(H([9, 1], [8, 1], [7, 1]))
    const mixed = ev(H([9, 1], [8, 0], [7, 1]))
    expect(pure.category).toBe(CATEGORY.PURE_RUN)
    expect(mixed.category).toBe(CATEGORY.RUN)
    const trail = ev(H([2, 0], [2, 1], [2, 2]))
    expect(compareEvaluations(trail, pure)).toBe(1)
  })
  it('color comparisons use high cards; color beats pair, loses to run', () => {
    const c1 = ev(H([13, 1], [9, 1], [4, 1]))
    const c2 = ev(H([12, 1], [11, 1], [10, 1])) // note: Q-J-10 hearts is a PURE RUN
    expect(c2.category).toBe(CATEGORY.PURE_RUN)
    const c3 = ev(H([12, 1], [9, 1], [4, 1]))
    expect(c1.category).toBe(CATEGORY.COLOR)
    expect(c3.category).toBe(CATEGORY.COLOR)
    expect(compareEvaluations(c1, c3)).toBe(1)
    const pair = ev(H([7, 0], [7, 1], [14, 2]))
    expect(compareEvaluations(c1, pair)).toBe(1)
  })
  it('pair compares pair rank then kicker', () => {
    const p1 = ev(H([9, 0], [9, 1], [5, 2]))
    const p2 = ev(H([9, 2], [9, 3], [14, 0]))
    const p3 = ev(H([10, 0], [10, 1], [2, 2]))
    expect(compareEvaluations(p2, p1)).toBe(1) // same pair, aces kicker
    expect(compareEvaluations(p3, p2)).toBe(1) // higher pair wins
  })
  it('high card compares highest, second, third', () => {
    const h1 = ev(H([14, 0], [10, 1], [5, 2]))
    const h2 = ev(H([14, 3], [9, 2], [8, 1]))
    const h3 = ev(H([14, 2], [10, 3], [4, 1]))
    expect(compareEvaluations(h1, h2)).toBe(1)
    expect(compareEvaluations(h1, h3)).toBe(1)
  })
  it('identical rank patterns are a true tie', () => {
    expect(compareHands(H([9, 0], [5, 1], [2, 2]) as unknown as Card[], H([9, 3], [5, 2], [2, 3]) as unknown as Card[], { aceTwoThreeRank: 'second_highest', allowTwoThreeFive: false })).toBe(0)
  })
  it('2-3-5 house rule beats a trail only when enabled', () => {
    const t235 = H([2, 0], [3, 1], [5, 2])
    const trail = H([14, 0], [14, 1], [14, 2])
    const off = evaluateHand(t235, { aceTwoThreeRank: 'second_highest', allowTwoThreeFive: false })
    expect(compareEvaluations(evaluateHand(trail, { aceTwoThreeRank: 'second_highest', allowTwoThreeFive: false }), off)).toBe(1)
    const on = evaluateHand(t235, { aceTwoThreeRank: 'second_highest', allowTwoThreeFive: true })
    expect(on.category).toBe(CATEGORY.TWO_THREE_FIVE)
    expect(compareEvaluations(on, evaluateHand(trail, { aceTwoThreeRank: 'second_highest', allowTwoThreeFive: true }))).toBe(1)
  })
})

describe('exhaustive 22,100 three-card hands', () => {
  const deck = buildDeck()
  for (const a23 of ['second_highest', 'lowest'] as const) {
    it(`distribution matches spec (aceTwoThreeRank=${a23})`, () => {
      const counts = new Map<number, number>()
      for (let i = 0; i < 50; i++) {
        for (let j = i + 1; j < 51; j++) {
          for (let k = j + 1; k < 52; k++) {
            const e = evaluateHand([deck[i]!, deck[j]!, deck[k]!] as Hand, { aceTwoThreeRank: a23, allowTwoThreeFive: false })
            counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
          }
        }
      }
      expect(counts.get(CATEGORY.TRAIL)).toBe(52)
      expect(counts.get(CATEGORY.PURE_RUN)).toBe(48)
      expect(counts.get(CATEGORY.RUN)).toBe(720)
      expect(counts.get(CATEGORY.COLOR)).toBe(1096)
      expect(counts.get(CATEGORY.PAIR)).toBe(3744)
      expect(counts.get(CATEGORY.HIGH_CARD)).toBe(16440)
      const sum = [...counts.values()].reduce((a, b) => a + b, 0)
      expect(sum).toBe(22100)
    })
  }
})

describe('compareHands — antisymmetry and transitivity', () => {
  it('holds on a large deterministic sample', () => {
    const deck = buildDeck()
    const rng = mulberry32(987654321)
    const hand = (): Hand => {
      const idxs = new Set<number>()
      while (idxs.size < 3) idxs.add(Math.floor(rng() * 52))
      return [...idxs].map(i => deck[i]!) as Hand
    }
    const cfg = { aceTwoThreeRank: 'second_highest' as const, allowTwoThreeFive: false }
    for (let t = 0; t < 4000; t++) {
      const a = hand(), b = hand(), c = hand()
      const ab = compareHands(a as unknown as Card[], b as unknown as Card[], cfg)
      const ba = compareHands(b as unknown as Card[], a as unknown as Card[], cfg)
      expect(Math.sign(ab) + Math.sign(ba)).toBe(0)
      const bc = compareHands(b as unknown as Card[], c as unknown as Card[], cfg)
      const ac = compareHands(a as unknown as Card[], c as unknown as Card[], cfg)
      // transitivity: if a>=b and b>=c then a>=c
      if (ab >= 0 && bc >= 0) expect(ac).toBeGreaterThanOrEqual(0)
      if (ab <= 0 && bc <= 0) expect(ac).toBeLessThanOrEqual(0)
    }
  })
})

describe('describeHand / labels', () => {
  it('names hands readably', () => {
    expect(CATEGORY_NAME[CATEGORY.TRAIL]).toBe('Trail')
  })
})
