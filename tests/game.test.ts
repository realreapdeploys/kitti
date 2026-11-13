import { describe, expect, it } from 'vitest'
import { applyAction, createGame, GameState, countPairs, fourOfAKindRank } from '../src/engine/game'
import { Hand, Card } from '../src/engine/types'
import { rigGame, testConfig, C } from './helpers'

const lockAll = (state: GameState, arrangements: [Hand, Hand, Hand][]): GameState => {
  let cur = state
  for (const p of cur.players) {
    if (p.eliminated) continue
    const res = applyAction(cur, { type: 'LOCK_IN', playerId: p.id, arrangement: arrangements[p.id]! })
    if (!res.ok) throw new Error(`lock failed for ${p.name}: ${res.error.message}`)
    cur = res.value
  }
  return cur
}

const mkRig = (hands: [Hand, Hand, Hand][], over = {}): GameState =>
  rigGame(testConfig({ enforceOrder: false, botCount: (hands.length - 1) as 1 | 2 | 3 | 4, ...over }), 12345, hands.map(h => h.flat()))

const hand = (a: Card, b: Card, c: Card): Hand => [a, b, c]
const spade = (r: number) => C(r, 0), heart = (r: number) => C(r, 1), club = (r: number) => C(r, 3), diamond = (r: number) => C(r, 2)

import { buildDeck } from '../src/engine/deck'
const botNine = (exclude: Card[] = []): Card[] => {
  const used = new Set(exclude.map(c => `${c.rank}:${c.suit}`))
  return buildDeck().filter(c => !used.has(`${c.rank}:${c.suit}`)).slice(0, 9)
}
const botArranged = (n: Card[]): [Hand, Hand, Hand] => [
  [n[0]!, n[1]!, n[2]!], [n[3]!, n[4]!, n[5]!], [n[6]!, n[7]!, n[8]!]
]

describe('round resolution â€” any_two', () => {
  it('wins pot when taking 2 of 3 rounds', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(14), heart(14), club(14)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(2), heart(5), club(9)),
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(10), heart(10), club(4)),
      hand(diamond(9), heart(7), club(5)),
      hand(diamond(12), heart(12), club(12)),
    ]
    let s = mkRig([mine, bots])
    const potBefore = s.pot
    s = lockAll(s, [mine, bots])
    expect(s.phase).toBe('roundEnd')
    expect(s.outcome?.kind).toBe('win')
    expect(s.outcome?.winnerId).toBe(0)
    expect(s.players[0]!.chips).toBe(1000 - 10 + potBefore)
  })

  it('only one round won and one round drawn => kitti; pot carries over', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(13), heart(13), club(13)), // trail kings — wins R1
      hand(spade(2), heart(5), club(9)),    // junk — loses R2
      hand(spade(11), heart(11), club(3)),  // pair jacks kicker 3 — R3 drawn
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(14), heart(14), club(4)), // pair aces — loses R1
      hand(diamond(12), heart(12), club(7)), // pair queens — wins R2
      hand(diamond(11), club(11), diamond(3)), // pair jacks kicker 3 — identical pattern, drawn
    ]
    let s = mkRig([mine, bots])
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.roundResults[0]!.roundWinners).toEqual([0])
    expect(s.outcome?.roundResults[1]!.roundWinners).toEqual([1])
    expect(s.outcome?.roundResults[2]!.drawn).toBe(true)
    expect(s.outcome?.kind).toBe('kitti')
    expect(s.kittiStreak).toBe(1)
    expect(s.totalKittis).toBe(1)
    expect(s.pot).toBe(20)
    const res = applyAction(s, { type: 'NEXT_ROUND' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.pot).toBe(40)
  })

  it('salami wins pot plus capped bonus from each opponent', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(14), heart(14), club(14)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(12), heart(12), club(12)),
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(10), heart(10), club(4)),
      hand(diamond(9), heart(7), club(5)),
      hand(diamond(8), heart(6), club(3)),
    ]
    let s = rigGame(testConfig({ enforceOrder: false, botCount: 1, startingChips: 20, boot: 10, salamiBonusMultiplier: 3 }), 999, [mine.flat(), bots.flat()])
    expect(s.players[1]!.chips).toBe(10)
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.kind).toBe('salami')
    expect(s.players[1]!.chips).toBe(0)
    expect(s.players[0]!.chips).toBe(10 + 20 + 10)
  })

  it('each player winning one round and one round drawn => kitti; round winners recorded', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(9), heart(9), club(2)),   // pair 9s kicker 2 — loses R1
      hand(spade(14), heart(14), club(14)), // trail aces — wins R2
      hand(spade(11), heart(11), diamond(3)), // pair jacks kicker 3 — R3 drawn
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(9), club(9), diamond(5)), // pair 9s kicker 5 — wins R1
      hand(diamond(12), heart(12), club(3)), // pair queens — loses R2
      hand(diamond(11), club(11), spade(3)), // pair jacks kicker 3 — identical pattern, drawn
    ]
    let s = mkRig([mine, bots])
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.roundResults[0]!.roundWinners).toEqual([1])
    expect(s.outcome?.roundResults[1]!.roundWinners).toEqual([0])
    expect(s.outcome?.roundResults[2]!.drawn).toBe(true)
    expect(s.outcome?.kind).toBe('kitti')
  })

  it('identical rank patterns are drawn; drawn round assists nobody', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(14), spade(5), club(2)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(8), heart(6), club(4)),
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(heart(14), club(5), diamond(2)),
      hand(diamond(12), heart(12), club(12)),
      hand(diamond(14), club(14), spade(9)),
    ]
    let s = mkRig([mine, bots])
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.roundResults[0]!.drawn).toBe(true)
    expect(s.outcome?.roundResults[0]!.roundWinners).toEqual([])
    expect(s.outcome?.roundResults[1]!.roundWinners).toEqual([0])
    expect(s.outcome?.roundResults[2]!.roundWinners).toEqual([1])
    expect(s.outcome?.kind).toBe('kitti')
  })
})

describe('round resolution â€” consecutive_two', () => {
  it('rounds 1+2 wins, even though round 3 was lost', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(14), heart(14), club(14)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(2), heart(5), club(9)),
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(10), heart(10), club(4)),
      hand(diamond(9), heart(7), club(5)),
      hand(diamond(12), heart(12), diamond(3)),
    ]
    let s = rigGame(testConfig({ enforceOrder: false, botCount: 1, winCondition: 'consecutive_two' }), 777, [mine.flat(), bots.flat()])
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.kind).toBe('win')
    expect(s.outcome?.winnerId).toBe(0)
  })
  it('rounds 1+3 (non-consecutive) does NOT win', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(14), heart(14), club(14)),
      hand(spade(2), heart(5), club(9)),
      hand(spade(12), heart(12), club(12)),
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(10), heart(10), club(4)),
      hand(diamond(13), heart(13), club(13)),
      hand(diamond(9), heart(7), club(5)),
    ]
    let s = rigGame(testConfig({ enforceOrder: false, botCount: 1, winCondition: 'consecutive_two' }), 777, [mine.flat(), bots.flat()])
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.kind).toBe('kitti')
  })
  it('rounds 2+3 wins', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(2), heart(5), club(9)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(14), heart(14), club(14)),
    ]
    const bots: [Hand, Hand, Hand] = [
      hand(diamond(12), heart(12), club(12)),
      hand(diamond(9), heart(7), club(5)),
      hand(diamond(8), heart(6), club(3)),
    ]
    let s = rigGame(testConfig({ enforceOrder: false, botCount: 1, winCondition: 'consecutive_two' }), 777, [mine.flat(), bots.flat()])
    s = lockAll(s, [mine, bots])
    expect(s.outcome?.kind).toBe('win')
    expect(s.outcome?.winnerId).toBe(0)
  })
})

describe('lock-in validation', () => {
  it('rejects an out-of-order arrangement', () => {
    const mineNine = [...hand(spade(14), heart(14), club(14)), ...hand(spade(13), heart(13), club(13)), ...hand(spade(2), heart(5), club(9))]
    const s = rigGame(testConfig({ enforceOrder: true, botCount: 1 }), 31337, [mineNine, botNine(mineNine)])
    const bad: [Hand, Hand, Hand] = [
      hand(spade(2), heart(5), club(9)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(14), heart(14), club(14)),
    ]
    const res = applyAction(s, { type: 'LOCK_IN', playerId: 0, arrangement: bad })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.type).toBe('INVALID_ARRANGEMENT')
  })
  it('rejects reusing cards', () => {
    const nine = [...hand(spade(2), heart(3), club(4)), ...hand(spade(5), heart(6), club(7)), ...hand(spade(8), heart(9), club(10))]
    const s = rigGame(testConfig({ enforceOrder: false, botCount: 1 }), 31337, [nine, botNine(nine)])
    const dup: [Hand, Hand, Hand] = [
      hand(spade(2), heart(3), club(4)),
      hand(spade(2), heart(6), club(7)),
      hand(spade(8), heart(9), club(10)),
    ]
    const res = applyAction(s, { type: 'LOCK_IN', playerId: 0, arrangement: dup })
    expect(res.ok).toBe(false)
  })
  it('double lock-in is rejected', () => {
    const mine: [Hand, Hand, Hand] = [
      hand(spade(14), heart(14), club(14)),
      hand(spade(13), heart(13), club(13)),
      hand(spade(12), heart(12), club(12)),
    ]
    const s = rigGame(testConfig({ enforceOrder: false, botCount: 1 }), 31337, [mine.flat(), botNine(mine.flat())])
    const res1 = applyAction(s, { type: 'LOCK_IN', playerId: 0, arrangement: mine })
    expect(res1.ok).toBe(true)
    if (res1.ok) {
      const res2 = applyAction(res1.value, { type: 'LOCK_IN', playerId: 0, arrangement: mine })
      expect(res2.ok).toBe(false)
      if (!res2.ok) expect(res2.error.type).toBe('ALREADY_LOCKED')
    }
  })
  it('NEXT_ROUND mid-round is rejected', () => {
    const s = createGame(testConfig(), 42)
    const res = applyAction(s, { type: 'NEXT_ROUND' })
    expect(res.ok).toBe(false)
  })
})

describe('elimination and game end', () => {
  it('human unable to afford the boot on round 1 => game over', () => {
    const s = createGame(testConfig({ startingChips: 0, boot: 10, botCount: 1 }), 123)
    expect(s.phase).toBe('gameover')
    expect(s.players[0]!.eliminated).toBe(true)
  })
})

describe('four of a kind / four pairs', () => {
  it('countPairs counts pairs correctly', () => {
    const four = [C(2, 0), C(2, 1), C(5, 0), C(5, 1), C(7, 0), C(7, 1), C(9, 0), C(9, 1), C(11, 0)]
    expect(countPairs(four)).toBe(4)
    expect(countPairs([C(2, 0), C(3, 1), C(5, 0), C(7, 1), C(9, 0), C(11, 1), C(13, 0), C(14, 1), C(6, 0)])).toBe(0)
  })
  it('fourOfAKindRank finds the quad rank or null', () => {
    expect(fourOfAKindRank([C(7, 0), C(7, 1), C(7, 2), C(7, 3), C(2, 0), C(3, 1), C(5, 0), C(9, 1), C(11, 0)])).toBe(7)
    expect(fourOfAKindRank([C(7, 0), C(7, 1), C(7, 2), C(8, 3), C(2, 0), C(3, 1), C(5, 0), C(9, 1), C(11, 0)])).toBeNull()
  })
  it('four of a kind auto-wins the round when the house rule is on', () => {
    const myNine: Card[] = [C(7, 0), C(7, 1), C(7, 2), C(7, 3), C(2, 0), C(5, 1), C(9, 2), C(3, 3), C(13, 0)]
    const bot = botNine(myNine)
    const myArr: [Hand, Hand, Hand] = [
      [myNine[4]!, myNine[5]!, myNine[6]!],
      [myNine[3]!, myNine[7]!, myNine[8]!],
      [myNine[0]!, myNine[1]!, myNine[2]!],
    ]
    const s = rigGame(testConfig({ enforceOrder: false, botCount: 1, fourOfAKindAutoWin: true }), 555, [myNine, bot])
    const locked = lockAll(s, [myArr, botArranged(bot)])
    expect(locked.outcome?.kind).toBe('win')
    expect(locked.outcome?.winnerId).toBe(0)
  })
  it('dealt hands never contain four pairs when the house rule forces redeals', () => {
    // With the rule on, 100 fresh games must never deal a four-pair hand into arranging phase
    for (let seed = 1; seed <= 100; seed++) {
      const s = createGame(testConfig({ botCount: 4, fourPairsRedeal: true }), seed)
      for (const p of s.players) expect(countPairs(p.cards)).toBeLessThan(4)
    }
  })
})
