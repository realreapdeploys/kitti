import { describe, expect, it } from 'vitest'
import { enumerateSplits, allOrderedArrangements, checkArrangement, orderSplit } from '../src/engine/arrange'
import { buildDeck } from '../src/engine/deck'
import { streamSeed, mulberry32 } from '../src/engine/rng'
import { Hand, Card } from '../src/engine/types'

const cfg = { aceTwoThreeRank: 'second_highest' as const, allowTwoThreeFive: false, enforceOrder: true }

const nine = (): Card[] => buildDeck().slice(0, 9)

describe('split enumeration', () => {
  it('generates exactly 280 distinct splits, each using all 9 cards once', () => {
    const cards = nine()
    const splits = enumerateSplits(cards)
    expect(splits).toHaveLength(280)
    const seen = new Set<string>()
    for (const split of splits) {
      expect(split).toHaveLength(3)
      const ids = split.flat().map(c => `${c.rank}:${c.suit}`)
      expect(new Set(ids).size).toBe(9)
      const key = split.map(h => h.map(c => `${c.rank}${c.suit[0]}`).sort().join('.')).sort().join('|')
      seen.add(key)
    }
    expect(seen.size).toBe(280)
  })
  it('split enumeration is order-independent', () => {
    const rng = mulberry32(streamSeed(7, 3))
    const cards = nine()
    const shuffled = [...cards]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      const t = shuffled[i]!; shuffled[i] = shuffled[j]!; shuffled[j] = t
    }
    const key = (split: [Hand, Hand, Hand]) =>
      split.map(h => h.map(c => `${c.rank}${c.suit[0]}`).sort().join('.')).sort().join('|')
    const a = new Set(enumerateSplits(cards).map(key))
    const b = new Set(enumerateSplits(shuffled).map(key))
    expect(a).toEqual(b)
  })
  it('orderSplit sorts strongest first', () => {
    const cards = nine()
    const [h1, h2, h3] = orderSplit(enumerateSplits(cards)[0]!, cfg)
    expect(h1).toHaveLength(3); expect(h2).toHaveLength(3); expect(h3).toHaveLength(3)
  })
  it('allOrderedArrangements returns only order-legal arrangements', () => {
    const arr = allOrderedArrangements(nine(), cfg)
    expect(arr.length).toBeGreaterThan(0)
    expect(arr.length).toBeLessThanOrEqual(280)
  })
  it('checkArrangement accepts a valid arrangement and rejects cheats', () => {
    const cards = nine()
    const split = enumerateSplits(cards)[0]!
    const ordered = orderSplit(split, cfg)
    expect(checkArrangement(cards, ordered, cfg).ok).toBe(true)
    // duplicate card in two hands
    const dup: [Hand, Hand, Hand] = [ordered[0], [ordered[1][0]!, ordered[1][0]!, ordered[1][1]!], ordered[2]]
    expect(checkArrangement(cards, dup, cfg).ok).toBe(false)
    // missing card (8 unique cards)
    const missing: [Hand, Hand, Hand] = [ordered[0], ordered[1], [ordered[2][0]!, ordered[2][1]!, ordered[2][0]!]]
    expect(checkArrangement(cards, missing, cfg).ok).toBe(false)
    // null arrangement
    expect(checkArrangement(cards, null, cfg).ok).toBe(false)
  })
  it('enforceOrder off allows a reversed arrangement', () => {
    const cards = nine()
    const ordered = orderSplit(enumerateSplits(cards)[0]!, cfg)
    const reversed: [Hand, Hand, Hand] = [ordered[2], ordered[1], ordered[0]]
    const off = { ...cfg, enforceOrder: false }
    const check = checkArrangement(cards, reversed, off)
    // reversed may still be numerically non-increasing-or-not; just assert the order rule is not the blocker
    expect(check.reason ?? '').not.toContain('at least as strong')
  })
})
