import { GameConfig, Personality } from '../engine/config'
import { Card } from '../engine/types'
import { GameState } from '../engine/game'

export interface SeatView {
  id: number
  name: string
  isBot: boolean
  personality: Personality | null
  chips: number
  lockedIn: boolean
  eliminated: boolean
  isDealer: boolean
}

/**
 * Everything a bot is allowed to know. Deliberately has NO opponent cards field
 * and NO deck order — hidden information is unrepresentable.
 */
export interface PlayerView {
  selfId: number
  cards: Card[]
  seats: SeatView[]
  pot: number
  kittiStreak: number
  round: number
  dealerIndex: number
  winCondition: GameConfig['winCondition']
  config: Readonly<Pick<GameConfig,
    'boot' | 'salamiBonusMultiplier' | 'enforceOrder' | 'aceTwoThreeRank' |
    'allowTwoThreeFive' | 'fourOfAKindAutoWin' | 'fourPairsRedeal' | 'winCondition' | 'rolloutSamples'>>
}

export function buildPlayerView(state: GameState, playerId: number): PlayerView {
  const self = state.players.find(p => p.id === playerId)
  if (!self) throw new Error(`buildPlayerView: unknown player ${playerId}`)
  return {
    selfId: self.id,
    cards: self.cards.map(c => ({ ...c })),
    seats: state.players.map(p => ({
      id: p.id, name: p.name, isBot: p.isBot, personality: p.personality,
      chips: p.chips, lockedIn: p.lockedIn, eliminated: p.eliminated,
      isDealer: p.id === state.dealerIndex
    })),
    pot: state.pot,
    kittiStreak: state.kittiStreak,
    round: state.round,
    dealerIndex: state.dealerIndex,
    winCondition: state.config.winCondition,
    config: {
      boot: state.config.boot,
      salamiBonusMultiplier: state.config.salamiBonusMultiplier,
      enforceOrder: state.config.enforceOrder,
      aceTwoThreeRank: state.config.aceTwoThreeRank,
      allowTwoThreeFive: state.config.allowTwoThreeFive,
      fourOfAKindAutoWin: state.config.fourOfAKindAutoWin,
      fourPairsRedeal: state.config.fourPairsRedeal,
      winCondition: state.config.winCondition,
      rolloutSamples: state.config.rolloutSamples
    }
  }
}
