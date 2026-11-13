import { describe, expect, it } from 'vitest'
import { buildDeck, shuffle, assertDeckIntegrity, assertCardConservation } from '../src/engine/deck'
import { mulberry32 } from '../src/engine/rng'

describe('deck', () => {
  it('builds exactly 52 unique cards, 4 per rank, 13 per suit', () => {
    const deck = buildDeck()
    expect(deck).toHaveLength(52)
    assertDeckIntegrity(deck)
  })
  it('has exactly 4 aces and 4 kings', () => {
    const deck = buildDeck()
    expect(deck.filter(c => c.rank === 14)).toHaveLength(4)
    expect(deck.filter(c => c.rank === 13)).toHaveLength(4)
  })
  it('Fisher-Yates shuffle preserves all 52 cards', () => {
    const rng = mulberry32(42)
    const s = shuffle(buildDeck(), rng)
    expect(s).toHaveLength(52)
    assertDeckIntegrity(s)
  })
  it('same seed produces identical order; different seeds differ', () => {
    const a = shuffle(buildDeck(), mulberry32(123))
    const b = shuffle(buildDeck(), mulberry32(123))
    const c = shuffle(buildDeck(), mulberry32(124))
    expect(a.map(x => `${x.rank}${x.suit}`)).toEqual(b.map(x => `${x.rank}${x.suit}`))
    expect(a.map(x => `${x.rank}${x.suit}`)).not.toEqual(c.map(x => `${x.rank}${x.suit}`))
  })
  it('assertDeckIntegrity throws on duplicates', () => {
    const deck = buildDeck()
    deck[1] = deck[0]!
    expect(() => assertDeckIntegrity(deck)).toThrow()
  })
  it('assertDeckIntegrity throws on wrong length', () => {
    expect(() => assertDeckIntegrity(buildDeck().slice(0, 51))).toThrow()
  })
  it('assertCardConservation passes on a full partition and throws otherwise', () => {
    const deck = buildDeck()
    const hands = [deck.slice(0, 9), deck.slice(9, 18)]
    const rest = deck.slice(18)
    expect(() => assertCardConservation(hands, rest)).not.toThrow()
    expect(() => assertCardConservation([...hands, hands[0]!], rest.slice(0, 34 - 9))).toThrow()
  })
})
