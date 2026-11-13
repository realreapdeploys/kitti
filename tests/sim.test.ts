/**
 * Large-scale simulation: hundreds of full games bot-vs-bot at every seat count, checking global invariants.
 * Uses the heuristic fast path for arrangement choice; the Monte Carlo rollout path is exercised and
 * perf-measured in tests/bot.test.ts. Deck freshness is asserted inside the engine via devAsserts.
 */
import { describe, expect, it } from 'vitest'
import { createGame, applyAction, assertInvariants } from '../src/engine/game'
import { heuristicArrangement } from '../src/ai/bot'
import { testConfig } from './helpers'

const GAMES = 400 // scaled to this machine; see README (target was 10,000/seat-count)
const SEAT_COUNTS = [2, 3, 4, 5] as const

interface SimStats { games: number; kittis: number; rounds: number; errors: number }

function runSeatCount(seats: number): SimStats {
  const cfg = testConfig({ botCount: (seats - 1) as 1 | 2 | 3 | 4, rolloutSamples: 4, startingChips: 30, boot: 15 })
  const stats: SimStats = { games: 0, kittis: 0, rounds: 0, errors: 0 }
  for (let i = 0; i < GAMES; i++) {
    const seed = 9000 + i * 13 + seats * 977
    let s = createGame(cfg, seed)
    let rounds = 0
    while (s.phase !== 'gameover') {
      if (s.phase === 'roundEnd') {
        stats.kittis += s.outcome?.kind === 'kitti' ? 1 : 0
        const r = applyAction(s, { type: 'NEXT_ROUND' })
        if (!r.ok) throw new Error('NEXT_ROUND failed: ' + r.error.message)
        s = r.value
        continue
      }
      for (const p of s.players) {
        if (p.eliminated || p.lockedIn) continue
        const r = applyAction(s, { type: 'LOCK_IN', playerId: p.id, arrangement: heuristicArrangement(p.cards, s.config) })
        if (!r.ok) throw new Error(`LOCK_IN failed: seed=${seed} player=${p.name}: ${r.error.message}`)
        s = r.value
      }
      rounds += 1
      assertInvariants(s) // card/chip conservation + exactly-one-winner rules in engine (devAsserts on)
      if (rounds > 500) throw new Error(`game did not terminate (seed=${seed})`)
    }
    // conservation across the whole game: total chips constant (boot moves chips into pot; payouts move them back)
    const expected = 30 * seats // startingChips * players, constant across engine ops
    expect(s.players.reduce((a, p) => a + p.chips, 0) + s.pot).toBe(expected) // unpaid pot carries/retains chips (e.g. unresolved kitti) — total chips constant
    stats.games += 1
    stats.rounds += rounds
    if (rounds <= 0) stats.errors += 1
  }
  return stats
}

describe.each(SEAT_COUNTS)('simulation at %i seats', (seats) => {
  it('plays hundreds of games with chip conservation and termination', () => {
    const stats = runSeatCount(seats)
    // eslint-disable-next-line no-console
    console.log(`seats=${seats} games=${stats.games} avgRounds=${(stats.rounds / stats.games).toFixed(1)} kittis=${stats.kittis} errors=${stats.errors}`)
    expect(stats.games).toBe(GAMES)
    expect(stats.rounds).toBeGreaterThan(0)
    expect(stats.errors).toBe(0)
  }, 600000)
})
