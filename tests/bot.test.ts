import { describe, expect, it } from 'vitest'
import { buildPlayerView } from '../src/ai/view'
import { botArrangement, decisionRng, heuristicArrangement, decideArrangement, isValidForView } from '../src/ai/bot'
import { createGame, applyAction } from '../src/engine/game'
import { testConfig } from './helpers'
import { mulberry32, streamSeed } from '../src/engine/rng'
import { percentileTable } from '../src/ai/percentile'

describe('bot privacy — PlayerView has no hidden information', () => {
  it('changing opponents’ hidden cards does not change the bot decision', () => {
    const cfg = testConfig({ botCount: 3, rolloutSamples: 16 })
    const state = createGame(cfg, 424242)
    const botId = 1
    const rng = decisionRng(state.seed, state.round, botId)
    const viewA = buildPlayerView(state, botId)
    const first = botArrangement(viewA, rng)

    // Corrupt every other player's cards and the leftover pile, keep bot's cards and public info identical
    const botCards = state.players[botId]!.cards
    const corrupted = {
      ...state,
      undealt: [...state.undealt].reverse(),
      players: state.players.map(p =>
        p.id === botId ? { ...p, cards: botCards } : { ...p, cards: [...p.cards].reverse() }
      )
    }
    const viewB = buildPlayerView(corrupted, botId)
    const second = botArrangement(viewB, decisionRng(state.seed, state.round, botId))
    expect(second.arrangement).toEqual(first.arrangement)
  })
  it('PlayerView carries no opponent card lists by type construction', () => {
    const state = createGame(testConfig({ botCount: 2 }), 7)
    const view = buildPlayerView(state, 1)
    expect(Object.keys(view).sort()).toEqual(['cards', 'config', 'dealerIndex', 'kittiStreak', 'pot', 'round', 'seats', 'selfId', 'winCondition'])
    expect(view).not.toHaveProperty('opponentCards')
    expect(view).not.toHaveProperty('deck')
    expect(view).not.toHaveProperty('undealt')
    for (const seat of view.seats) {
      expect(Object.keys(seat).sort()).toEqual(['chips', 'eliminated', 'id', 'isBot', 'isDealer', 'lockedIn', 'name', 'personality'])
    }
  })
})

describe('bot determinism and legality', () => {
  it('same seed => identical arrangement; always legal', () => {
    const cfg = testConfig({ botCount: 2, rolloutSamples: 16 })
    const state = createGame(cfg, 98765)
    for (const p of state.players.filter(p => p.isBot)) {
      const v1 = buildPlayerView(state, p.id)
      const a1 = botArrangement(v1, decisionRng(state.seed, state.round, p.id))
      const a2 = botArrangement(v1, decisionRng(state.seed, state.round, p.id))
      expect(a1.arrangement).toEqual(a2.arrangement)
      expect(isValidForView(v1, a1.arrangement)).toBe(true)
      expect(a1.usedFallback).toBe(false)
    }
  })
  it('heuristic arrangement is always legal across 200 random deals', () => {
    const cfg = testConfig({ botCount: 1 })
    for (let seed = 1; seed <= 200; seed++) {
      const state = createGame(cfg, seed)
      const bot = state.players[1]!
      const arr = heuristicArrangement(bot.cards, {
        boot: cfg.boot, salamiBonusMultiplier: cfg.salamiBonusMultiplier,
        enforceOrder: cfg.enforceOrder, aceTwoThreeRank: cfg.aceTwoThreeRank,
        allowTwoThreeFive: cfg.allowTwoThreeFive, fourOfAKindAutoWin: cfg.fourOfAKindAutoWin,
        fourPairsRedeal: cfg.fourPairsRedeal, winCondition: cfg.winCondition, rolloutSamples: cfg.rolloutSamples
      })
      const flat = arr.flat()
      expect(new Set(flat.map(c => `${c.rank}:${c.suit}`)).size).toBe(9)
    }
  })
  it('bot decisions complete well under the 150ms budget', () => {
    const cfg = testConfig({ botCount: 4, rolloutSamples: 120 })
    const state = createGame(cfg, 13579)
    const bot = state.players[1]!
    const view = buildPlayerView(state, bot.id)
    percentileTable({ aceTwoThreeRank: view.config.aceTwoThreeRank, allowTwoThreeFive: view.config.allowTwoThreeFive }) // one-time per session; excluded from the per-decision budget
    decideArrangement(view, mulberry32(streamSeed(99, 99))) // warm the JIT once; timing the steady state, not first-call compilation
    let elapsed = Infinity
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now()
      decideArrangement(view, mulberry32(streamSeed(1, 1)))
      elapsed = Math.min(elapsed, performance.now() - t0)
    }
    expect(elapsed).toBeLessThan(150)
  })
  it('a full bot-vs-bot round resolves with at most one winner', () => {
    const cfg = testConfig({ botCount: 2, rolloutSamples: 12 })
    let state = createGame(cfg, 24680)
    for (const p of state.players) {
      if (!p.isBot) continue
      const view = buildPlayerView(state, p.id)
      const { arrangement } = botArrangement(view, decisionRng(state.seed, state.round, p.id))
      const res = applyAction(state, { type: 'LOCK_IN', playerId: p.id, arrangement })
      expect(res.ok).toBe(true)
      if (res.ok) state = res.value
    }
    // human plays with the heuristic too so the round can resolve
    const view = buildPlayerView(state, 0)
    const { arrangement } = botArrangement(view, decisionRng(state.seed, state.round, 0))
    const res = applyAction(state, { type: 'LOCK_IN', playerId: 0, arrangement })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.phase).toBe('roundEnd')
      expect(res.value.outcome).not.toBeNull()
      const winners = res.value.outcome!.roundResults.map(rr => rr.roundWinners.length)
      for (const w of winners) expect(w).toBeLessThanOrEqual(1)
    }
  })
})
