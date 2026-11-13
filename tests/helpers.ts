import { GameState, createGame, applyAction } from '../src/engine/game'
import { Hand } from '../src/engine/types'
import { DEFAULT_CONFIG, GameConfig } from '../src/engine/config'
import { buildDeck, shuffle, assertDeckIntegrity } from '../src/engine/deck'
import { mulberry32, streamSeed } from '../src/engine/rng'
import { Card, compareCard } from '../src/engine/types'

export const testConfig = (over: Partial<GameConfig> = {}): GameConfig => ({
  ...DEFAULT_CONFIG,
  botCount: 1,
  rolloutSamples: 8,
  botThinkMs: [0, 0],
  devAsserts: true,
  ...over
})

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const
export const C = (rank: number, suitIndex: number): Card => ({ rank: rank as Card['rank'], suit: SUITS[suitIndex]! })

/** Rig a fresh game so each player holds the given cards (then fix undealt). */
export function rigGame(config: GameConfig, seed: number, hands: Card[][]): GameState {
  const state = createGame(config, seed)
  const all = buildDeck()
  const used = new Set<string>()
  const dealt: Card[][] = []
  for (const h of hands) {
    for (const c of h) {
      const id = `${c.rank}:${c.suit}`
      if (used.has(id)) throw new Error(`rigGame: duplicate card designed in ${id}`)
      used.add(id)
    }
    dealt.push(h.slice())
  }
  const undealt = all.filter(c => !used.has(`${c.rank}:${c.suit}`))
  return {
    ...state,
    players: state.players.map((p, i) => ({
      ...p,
      cards: (dealt[i] ?? []).slice().sort(compareCard),
      arrangement: null,
      lockedIn: false
    })),
    undealt
  }
}

/** Deal a real game and force arrangements equal to engines' auto picks; returns the state after all players locked in. */
export function freshRigged(config: GameConfig, seed: number): GameState {
  const state = createGame(config, seed)
  assertDeckIntegrity(shuffle(buildDeck(), mulberry32(streamSeed(seed, 1))))
  return state
}

export const cardKey = (c: Card): string => `${c.rank}${c.suit[0]}`
export const sortedKeys = (cards: Card[]): string[] => cards.map(cardKey).sort()

/** Rig cards and lock in arrangements in seat order; returns the resolved (roundEnd/gameover) state. */
export function resolveRig(
  config: GameConfig,
  seed: number,
  hands: [Hand, Hand, Hand][]
): GameState {
  let state = rigGame(config, seed, hands.map(h => h.flat()))
  for (const p of state.players) {
    if (p.eliminated) continue
    const res = applyAction(state, { type: 'LOCK_IN', playerId: p.id, arrangement: hands[p.id]! })
    if (!res.ok) throw new Error(`lock failed for ${p.name}: ${res.error.message}`)
    state = res.value
  }
  return state
}
