import { Card, Rank, SUITS } from './types'
import { Rng } from './rng'

export function buildDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ rank: rank as Rank, suit })
  }
  return deck
}

/** Fisher-Yates. The only shuffle permitted. */
export function shuffle(deck: Card[], rng: Rng): Card[] {
  const d = deck.slice()
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = d[i]!
    d[i] = d[j]!
    d[j] = tmp
  }
  return d
}

export function assertDeckIntegrity(deck: Card[]): void {
  if (deck.length !== 52) throw new Error(`deck integrity: length ${deck.length} != 52`)
  const seen = new Set<string>()
  const rankCount = new Array<number>(15).fill(0)
  const suitCount: Record<string, number> = {}
  for (const c of deck) {
    const id = `${c.rank}:${c.suit}`
    if (seen.has(id)) throw new Error(`deck integrity: duplicate card ${id}`)
    seen.add(id)
    rankCount[c.rank] = (rankCount[c.rank] ?? 0) + 1
    suitCount[c.suit] = (suitCount[c.suit] ?? 0) + 1
  }
  for (let r = 2; r <= 14; r++) {
    if (rankCount[r] !== 4) throw new Error(`deck integrity: rank ${r} appears ${rankCount[r]} times`)
  }
  for (const suit of SUITS) {
    if (suitCount[suit] !== 13) throw new Error(`deck integrity: suit ${suit} appears ${suitCount[suit] ?? 0} times`)
  }
}

/** Counts every card across all hands and the unused leftovers; throws unless total is 52 unique cards. */
export function assertCardConservation(hands: Card[][], unused: Card[]): void {
  const all = [...unused, ...hands.flat()]
  if (all.length !== 52) throw new Error(`card conservation: ${all.length} cards in play, expected 52`)
  assertDeckIntegrity(all)
}
