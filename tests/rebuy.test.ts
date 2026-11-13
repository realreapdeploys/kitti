import { describe, it, expect } from 'vitest'
import { createGame, applyAction, type GameState } from '../src/engine/game'
import { DEFAULT_CONFIG } from '../src/engine/config'
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const cfg = { ...DEFAULT_CONFIG, botCount: 1 as const, enforceOrder: false, devAsserts: true }

const brokeBotState = (): GameState => {
  const g = createGame(cfg, 42)
  const s = clone(g)
  s.phase = 'roundEnd'
  const bot = s.players[1]!
  s.chipsInPlay -= bot.chips
  bot.chips = 0
  bot.eliminated = true
  s.activeCount = 1
  return s
}

describe('re-buy', () => {
  it('creates games with per-seat opening stacks and tracks chipsInPlay', () => {
    const g = createGame(cfg, 7, 'You', new Map([[0, 50000], [1, 12345]]))
    expect(g.players[0]!.chips + g.config.boot).toBe(50000) // boot was paid; stack = override - boot
    expect(g.players[1]!.chips + g.config.boot).toBe(12345)
    expect(g.chipsInPlay).toBe(50000 + 12345)
  })

  it('revives an eliminated player between hands, exactly once', () => {
    const s = brokeBotState()
    const r = applyAction(s, { type: 'REBUY', playerId: 1, cents: 2000 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const bot = r.value.players[1]!
    expect(bot.chips).toBe(2000)
    expect(bot.eliminated).toBe(false)
    expect(r.value.activeCount).toBe(2)
    expect(r.value.chipsInPlay).toBe(s.chipsInPlay + 2000)
    // conservation explicitly holds afterwards
    const total = r.value.players.reduce((sum, p) => sum + p.chips, 0) + r.value.pot
    expect(total).toBe(r.value.chipsInPlay)
  })

  it('allows topping up a playing stack between hands', () => {
    const base = clone(createGame(cfg, 99))
    base.phase = 'roundEnd'
    const r = applyAction(base, { type: 'REBUY', playerId: 0, cents: 1500 })
    expect(r.ok).toBe(true)
  })

  it('rejects re-buys during a live hand', () => {
    const live = createGame(cfg, 11) // phase is arranging
    const r = applyAction(live, { type: 'REBUY', playerId: 0, cents: 1000 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.type).toBe('NOT_BETWEEN_HANDS')
  })

  it('rejects nonsense amounts', () => {
    for (const cents of [0, 99, 1_000_001, Number.NaN]) {
      const s = brokeBotState()
      const r = applyAction(s, { type: 'REBUY', playerId: 1, cents })
      expect(r.ok).toBe(false)
    }
    const s = brokeBotState()
    expect(applyAction(s, { type: 'REBUY', playerId: 1, cents: 100 }).ok).toBe(true)
  })
})
