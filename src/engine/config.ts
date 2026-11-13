export type WinCondition = 'any_two' | 'consecutive_two'
export type AceTwoThreeRank = 'second_highest' | 'lowest'
export type Personality = 'safe' | 'aggressive' | 'balanced' | 'unpredictable'

export interface GameConfig {
  /** Chips each player starts the game with. */
  startingChips: number
  /** Ante every seated player pays into the pot each round. */
  boot: number
  /** 'any_two' wins any 2 of the 3 rounds; 'consecutive_two' wins rounds 1+2 or 2+3. */
  winCondition: WinCondition
  /** Salami winner collects boot * this from each opponent (capped). 1 = one boot each. */
  salamiBonusMultiplier: number
  /** Hand 1 must be >= Hand 2 >= Hand 3. */
  enforceOrder: boolean
  /** Where A-2-3 sits: second highest run (default) or lowest run. */
  aceTwoThreeRank: AceTwoThreeRank
  /** House rule: 2-3-5 (not all one suit) beats everything, including a trail. */
  allowTwoThreeFive: boolean
  /** House rule: four of a kind among the 9 cards wins the round automatically. */
  fourOfAKindAutoWin: boolean
  /** House rule: four pairs among the 9 cards forces a redeal that counts as a kitti. */
  fourPairsRedeal: boolean
  /** 1..4 bots. */
  botCount: number
  /** Monte Carlo rollouts per candidate split (bot decisions). */
  rolloutSamples: number
  /** UI only: bot "thinking" delay range in ms. */
  botThinkMs: [number, number]
  /** Run deck/chip conservation asserts after every action (dev aid). */
  devAsserts: boolean
}

export const DEFAULT_CONFIG: GameConfig = {
  startingChips: 1000,
  boot: 10,
  winCondition: 'any_two',
  salamiBonusMultiplier: 1,
  enforceOrder: true,
  aceTwoThreeRank: 'second_highest',
  allowTwoThreeFive: false,
  fourOfAKindAutoWin: false,
  fourPairsRedeal: false,
  botCount: 2,
  rolloutSamples: 120,
  botThinkMs: [300, 900],
  devAsserts: true
}
