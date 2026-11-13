import { describe, expect, it } from 'vitest'
import { applyAction, assertInvariants, createGame, GameState } from '../src/engine/game'
import { buildPlayerView } from '../src/ai/view'
import { botArrangement, decisionRng } from '../src/ai/bot'
import { buildDeck } from '../src/engine/deck'
import { Hand, Card } from '../src/engine/types'
import { testConfig, resolveRig, C } from './helpers'

const hand = (a: Card, b: Card, c: Card): Hand => [a, b, c]
const spade = (r: number) => C(r, 0), heart = (r: number) => C(r, 1), club = (r: number) => C(r, 3), diamond = (r: number) => C(r, 2)

// Rigged tables where Round 1 -> seat 0 (trail 2s), Round 2 -> seat 1 (trail 3s), Round 3 -> nobody.
// Nobody reaches 2 wins => KITTI.
const RIGS: Record<number, [Hand, Hand, Hand][]> = {
  2: [
    [hand(spade(2), heart(2), club(2)), hand(spade(5), heart(9), club(6)), hand(spade(11), heart(11), heart(4))],
    [hand(diamond(2), diamond(9), heart(7)), hand(spade(3), heart(3), club(3)), hand(diamond(11), club(11), diamond(4))],
  ],
  3: [
    [hand(spade(2), heart(2), club(2)), hand(spade(5), heart(9), club(6)), hand(spade(14), heart(8), club(4))],
    [hand(diamond(2), diamond(9), heart(7)), hand(spade(3), heart(3), club(3)), hand(diamond(5), heart(11), club(10))],
    [hand(heart(12), diamond(10), club(8)), hand(diamond(7), heart(6), club(13)), hand(spade(4), heart(4), diamond(4))],
  ],
  4: [
    [hand(spade(2), heart(2), club(2)), hand(spade(5), heart(9), club(6)), hand(spade(14), heart(8), club(4))],
    [hand(diamond(2), diamond(9), heart(7)), hand(spade(3), heart(3), club(3)), hand(diamond(5), heart(11), club(10))],
    [hand(heart(12), diamond(10), club(8)), hand(diamond(7), heart(6), club(13)), hand(spade(4), heart(4), diamond(4))],
    [hand(diamond(14), club(9), heart(10)), hand(club(12), heart(13), diamond(8)), hand(diamond(13), spade(6), club(11))],
  ],
  5: [
    [hand(spade(2), heart(2), club(2)), hand(spade(5), heart(9), club(6)), hand(spade(14), heart(8), club(4))],
    [hand(diamond(2), diamond(9), heart(7)), hand(spade(3), heart(3), club(3)), hand(diamond(5), heart(11), club(10))],
    [hand(heart(12), diamond(10), club(8)), hand(diamond(7), heart(6), club(13)), hand(spade(4), heart(4), diamond(4))],
    [hand(diamond(14), club(9), heart(10)), hand(club(12), heart(13), diamond(8)), hand(diamond(13), spade(6), club(11))],
    [hand(heart(5), diamond(11), club(7)), hand(spade(12), diamond(6), spade(8)), hand(diamond(12), club(5), spade(7))],
  ],
}

describe.each([2, 3, 4, 5])('scripted full round at %i seats', (seats) => {
  it('deals a fresh, complete, conserved deck every round', () => {
    const cfg = testConfig({ botCount: (seats - 1) as 1 | 2 | 3 | 4 })
    const state = createGame(cfg, 12321)
    assertInvariants(state)
    expect(state.players.filter(p => !p.eliminated).every(p => p.cards.length === 9)).toBe(true)
    expect(state.undealt.length).toBe(52 - 9 * seats)
    expect(buildDeck()).toHaveLength(52)
  })

  it('forces a kitti (nobody reaches the win condition) and redeals conserved', () => {
    const cfg = testConfig({ botCount: (seats - 1) as 1 | 2 | 3 | 4, enforceOrder: false })
    const resolved = resolveRig(cfg, 999, RIGS[seats]!)
    expect(resolved.phase).toBe('roundEnd')
    expect(resolved.outcome?.roundResults[0]!.roundWinners).toEqual([0])
    expect(resolved.outcome?.roundResults[1]!.roundWinners).toEqual([1])
    if (seats === 2) {
      expect(resolved.outcome?.roundResults[2]!.drawn).toBe(true)
    } else {
      expect(resolved.outcome?.roundResults[2]!.roundWinners).toEqual([2])
    }
    expect(resolved.outcome?.kind).toBe('kitti')
    expect(resolved.kittiStreak).toBe(1)
    expect(resolved.pot).toBe(10 * seats)
    const next = applyAction(resolved, { type: 'NEXT_ROUND' })
    expect(next.ok).toBe(true)
    if (next.ok) {
      assertInvariants(next.value)
      expect(next.value.pot).toBe(20 * seats)
      expect(next.value.undealt.length).toBe(52 - 9 * seats)
      const ids = next.value.players.flatMap(p => p.cards.map(c => `${c.rank}:${c.suit}`))
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('plays through a full round with all seats decided from PlayerView only', () => {
    const cfg = testConfig({ botCount: (seats - 1) as 1 | 2 | 3 | 4, rolloutSamples: 8 })
    let state: GameState = createGame(cfg, 808)
    for (const p of state.players) {
      const view = buildPlayerView(state, p.id)
      const { arrangement, usedFallback } = botArrangement(view, decisionRng(state.seed, state.round, p.id))
      expect(usedFallback).toBe(false)
      const res = applyAction(state, { type: 'LOCK_IN', playerId: p.id, arrangement })
      expect(res.ok).toBe(true)
      if (res.ok) state = res.value
    }
    expect(state.phase).toBe('roundEnd')
    assertInvariants(state)
    expect(state.outcome).not.toBeNull()
    for (const rr of state.outcome!.roundResults) expect(rr.roundWinners.length).toBeLessThanOrEqual(1)
  })
})
