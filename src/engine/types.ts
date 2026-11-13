export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs'
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'] as const
export type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14

export interface Card { rank: Rank; suit: Suit }

export const cardId = (c: Card): string => `${c.rank}${c.suit[0]}`

export const compareCard = (a: Card, b: Card): number =>
  a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)

export type Hand = [Card, Card, Card]

export const CATEGORY = {
  TRAIL: 6,
  PURE_RUN: 5,
  RUN: 4,
  COLOR: 3,
  PAIR: 2,
  HIGH_CARD: 1,
  TWO_THREE_FIVE: 7 // house rule: beats everything including a trail
} as const
export type Category = typeof CATEGORY[keyof typeof CATEGORY]

export const CATEGORY_NAME: Record<Category, string> = {
  [CATEGORY.TRAIL]: 'Trail',
  [CATEGORY.PURE_RUN]: 'Pure Run',
  [CATEGORY.RUN]: 'Run',
  [CATEGORY.COLOR]: 'Color',
  [CATEGORY.PAIR]: 'Pair',
  [CATEGORY.HIGH_CARD]: 'High Card',
  [CATEGORY.TWO_THREE_FIVE]: '2-3-5'
}

export interface EvaluatedHand {
  cards: Hand
  category: Category
  tiebreakers: number[]
}
