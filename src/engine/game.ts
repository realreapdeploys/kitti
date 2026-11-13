import { GameConfig } from './config'
import { buildDeck, shuffle, assertDeckIntegrity, assertCardConservation } from './deck'
import { mulberry32, streamSeed } from './rng'
import { Card, Hand, compareCard } from './types'
import { EvalConfig, compareEvaluations, evaluateHand } from './evaluate'
import { checkArrangement } from './arrange'
import { Personality } from './config'

export type Phase = 'arranging' | 'roundEnd' | 'gameover'
export type RoundOutcomeKind = 'win' | 'salami' | 'kitti'

export interface PlayerState {
  id: number
  name: string
  isBot: boolean
  personality: Personality | null
  chips: number
  cards: Card[]
  arrangement: [Hand, Hand, Hand] | null
  lockedIn: boolean
  eliminated: boolean
}

export interface RoundCompareResult {
  /** 1, 2 or 3 */
  round: number
  /** Best-hand evaluation per player id that participated. */
  evaluations: { playerId: number; ev: ReturnType<typeof evaluateHand> }[]
  /** Empty array => drawn round. */
  roundWinners: number[]
  drawn: boolean
}

export interface RoundOutcome {
  kind: RoundOutcomeKind
  winnerId: number | null
  potBefore: number
  payouts: { playerId: number; amount: number; reason: 'pot' | 'salami' }[]
  roundResults: RoundCompareResult[]
}

export interface LogEntry { id: number; text: string }

export interface GameState {
  config: GameConfig
  seed: number
  /** 1-based round number (increments on every redeal, including kittis). */
  round: number
  dealerIndex: number
  pot: number
  kittiStreak: number
  totalKittis: number
  players: PlayerState[]
  /** The unused leftover cards from the current deal (never shown). */
  undealt: Card[]
  phase: Phase
  outcome: RoundOutcome | null
  gameoverMessage: string | null
  log: LogEntry[]
  /** Explicit list of seats still in the game (not eliminated). */
  activeCount: number
  /** Total chips that must exist across stacks + pot. Set at creation, grown only by re-buys. */
  chipsInPlay: number
}

export type EngineError =
  | { type: 'WRONG_PHASE'; message: string }
  | { type: 'UNKNOWN_PLAYER'; message: string }
  | { type: 'PLAYER_ELIMINATED'; message: string }
  | { type: 'ALREADY_LOCKED'; message: string }
  | { type: 'INVALID_ARRANGEMENT'; message: string }
  | { type: 'NOTHING_TO_SETTLE'; message: string }
  | { type: 'NOT_BETWEEN_HANDS'; message: string }

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }

export type GameAction =
  | { type: 'LOCK_IN'; playerId: number; arrangement: [Hand, Hand, Hand] }
  | { type: 'NEXT_ROUND' }
  | { type: 'REBUY'; playerId: number; cents: number }

const BOT_NAMES = ['Ravi', 'Priya', 'Arjun', 'Meera', 'Deepak', 'Anika', 'Vikram', 'Sana']
const BOT_PERSONALITIES: Personality[] = ['safe', 'aggressive', 'balanced', 'unpredictable']

let logId = 0
const makeLog = (text: string): LogEntry => ({ id: ++logId, text })

export function createGame(config: GameConfig, seed: number, humanName = 'You', initialStacks?: Map<number, number>): GameState {
  const rng = mulberry32(streamSeed(seed, 0xB07))
  const personalities = BOT_PERSONALITIES.slice()
  // shuffle personality assignment deterministically
  for (let i = personalities.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = personalities[i]!; personalities[i] = personalities[j]!; personalities[j] = t
  }
  // Bot names: sampled WITHOUT replacement from the pool on a dedicated stream, so no two bots ever share a name.
  const nameRng = mulberry32(streamSeed(seed, 0xA11C))
  const namePool = BOT_NAMES.slice()
  for (let i = namePool.length - 1; i > 0; i--) {
    const j = Math.floor(nameRng() * (i + 1))
    const t = namePool[i]!; namePool[i] = namePool[j]!; namePool[j] = t
  }
  const players: PlayerState[] = []
  players.push({
    id: 0, name: humanName, isBot: false, personality: null,
    chips: initialStacks?.get(0) ?? config.startingChips, cards: [], arrangement: null, lockedIn: false, eliminated: false
  })
  for (let b = 0; b < config.botCount; b++) {
    players.push({
      id: b + 1, name: namePool[b]!, isBot: true,
      personality: personalities[b % personalities.length]!,
      chips: initialStacks?.get(b + 1) ?? config.startingChips, cards: [], arrangement: null, lockedIn: false, eliminated: false
    })
  }
  const state: GameState = {
    config, seed, round: 0, dealerIndex: 0, pot: 0,
    kittiStreak: 0, totalKittis: 0, players,
    undealt: buildDeck(), phase: 'arranging', outcome: null, gameoverMessage: null,
    log: [makeLog(`Game started with seed ${seed}. ${config.botCount} bot${config.botCount > 1 ? 's' : ''}.`)],
    activeCount: players.length,
    chipsInPlay: players.reduce((sum, p) => sum + p.chips, 0)
  }
  return startRound(state, true)
}

const evalCfg = (config: GameConfig): EvalConfig => ({
  aceTwoThreeRank: config.aceTwoThreeRank,
  allowTwoThreeFive: config.allowTwoThreeFive
})

export function assertChipConservation(state: GameState): void {
  const total = state.players.reduce((s, p) => s + p.chips, 0) + state.pot
  const expected = state.chipsInPlay
  if (total !== expected) {
    throw new Error(`chip conservation violated: ${total} != ${expected}`)
  }
}

export function assertInvariants(state: GameState): void {
  assertChipConservation(state)
  const hands = state.players.map(p => p.cards)
  assertCardConservation(hands, state.undealt)
}

function startRound(prev: GameState, fresh: boolean): GameState {
  const state = structuredClone(prev) as GameState
  // Rotate dealer (not before the very first round)
  if (!fresh) {
    state.dealerIndex = nextActiveSeat(state, state.dealerIndex)
  }
  state.round += 1
  state.outcome = null
  state.phase = 'arranging'

  // --- Ante ---
  for (const p of state.players) {
    if (p.eliminated) continue
    if (p.chips < state.config.boot) {
      p.eliminated = true
      state.log.push(makeLog(`${p.name} cannot afford the boot and is eliminated.`))
    } else {
      p.chips -= state.config.boot
      state.pot += state.config.boot
    }
  }
  state.activeCount = state.players.filter(p => !p.eliminated).length
  if (state.config.devAsserts) assertChipConservation(state)

  // Game over checks after ante
  const active = state.players.filter(p => !p.eliminated)
  const human = state.players[0]!
  if (human.eliminated) {
    state.phase = 'gameover'
    state.gameoverMessage = 'You are out of chips. Game over.'
    state.log.push(makeLog(state.gameoverMessage))
    return state
  }
  if (active.length === 1) {
    state.phase = 'gameover'
    state.gameoverMessage = `${active[0]!.name} wins the table — everyone else is out.`
    state.log.push(makeLog(state.gameoverMessage))
    return state
  }

  // --- Deal from a brand-new, freshly shuffled deck, one card at a time from left of dealer ---
  dealFresh(state, 0)

  // --- Four pairs house rule: forced redeal counting as a kitti ---
  if (state.config.fourPairsRedeal) {
    let guard = 0
    while (guard++ < 50) {
      const offender = state.players.find(p => !p.eliminated && countPairs(p.cards) >= 4)
      if (!offender) break
      state.kittiStreak += 1
      state.totalKittis += 1
      state.log.push(makeLog(`${offender.name} has four pairs — redeal. This counts as a kitti.`))
      dealFresh(state, guard)
    }
  }

  if (state.config.devAsserts) assertInvariants(state)
  return state
}

function dealFresh(state: GameState, salt: number): void {
  const deckSeed = streamSeed(state.seed, 0xDEA1 + state.round * 131 + salt * 7919)
  const deck = shuffle(buildDeck(), mulberry32(deckSeed))
  assertDeckIntegrity(deck)
  for (const p of state.players) {
    p.cards = []
    p.arrangement = null
    p.lockedIn = false
  }
  // one card at a time, clockwise from left of dealer
  const n = state.players.length
  for (let round9 = 0; round9 < 9; round9++) {
    for (let k = 1; k <= n; k++) {
      const seat = (state.dealerIndex + k) % n
      const p = state.players[seat]!
      if (p.eliminated) continue
      p.cards.push(deck.pop()!)
    }
  }
  state.undealt = deck
  for (const p of state.players) {
    p.cards = [...p.cards].sort(compareCard)
  }
  assertCardConservation(state.players.map(p => p.cards), state.undealt)
}

export const countPairs = (cards: Card[]): number => {
  const m = new Map<number, number>()
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1)
  let pairs = 0
  for (const n of m.values()) if (n >= 2) pairs += Math.floor(n / 2)
  return pairs
}

export function fourOfAKindRank(cards: Card[]): number | null {
  const m = new Map<number, number>()
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1)
  let best: number | null = null
  for (const [r, n] of m) if (n >= 4 && (best === null || r > best)) best = r
  return best
}

const nextActiveSeat = (state: GameState, from: number): number => {
  const n = state.players.length
  for (let k = 1; k <= n; k++) {
    const s = (from + k) % n
    if (!state.players[s]!.eliminated) return s
  }
  return from
}

const EC = evalCfg

function resolveShowdown(state: GameState): RoundOutcome {
  const cfg = state.config
  const eCfg = EC(cfg)
  const seated = state.players.filter(p => !p.eliminated)
  const roundResults: RoundCompareResult[] = []

  // Four of a kind house rule: highest four-of-a-kind wins the whole round automatically.
  if (cfg.fourOfAKindAutoWin) {
    const holders = seated
      .map(p => ({ p, r: fourOfAKindRank(p.cards) }))
      .filter(x => x.r !== null)
    if (holders.length > 0) {
      holders.sort((a, b) => b.r! - a.r!)
      const top = holders[0]!
      const tied = holders.filter(h => h.r === top.r)
      roundResults.push(...buildRoundResults(state, seated, eCfg))
      if (tied.length === 1) {
        state.log.push(makeLog(`${top.p.name} holds four of a kind — automatic win!`))
        return finishWin(state, top.p.id, false, roundResults)
      }
      state.log.push(makeLog('Multiple players hold equal four of a kind — kitti.'))
      return finishKitti(state, roundResults)
    }
  }

  roundResults.push(...buildRoundResults(state, seated, eCfg))

  const wins = new Map<number, number>()
  for (const rr of roundResults) {
    for (const wid of rr.roundWinners) wins.set(wid, (wins.get(wid) ?? 0) + 1)
  }
  const winCount = (id: number): number => wins.get(id) ?? 0

  // Determine qualifying winners
  let qualifiers: number[]
  if (cfg.winCondition === 'any_two') {
    qualifiers = seated.filter(p => winCount(p.id) >= 2).map(p => p.id)
  } else {
    const won = (id: number, r: number): boolean =>
      roundResults[r - 1]!.roundWinners.includes(id)
    qualifiers = seated
      .filter(p => (won(p.id, 1) && won(p.id, 2)) || (won(p.id, 2) && won(p.id, 3)))
      .map(p => p.id)
  }
  if (qualifiers.length > 1) {
    // Mathematically impossible under both win conditions; fail loudly if it ever happens.
    throw new Error(`Invariant violated: multiple round winners ${qualifiers.join(',')}`)
  }
  if (qualifiers.length === 1) {
    const winnerId = qualifiers[0]!
    const salami = winCount(winnerId) === 3
    return finishWin(state, winnerId, salami, roundResults)
  }
  return finishKitti(state, roundResults)
}

function buildRoundResults(
  state: GameState,
  seated: PlayerState[],
  eCfg: EvalConfig
): RoundCompareResult[] {
  const out: RoundCompareResult[] = []
  for (let r = 0; r < 3; r++) {
    const evaluations = seated.map(p => ({
      playerId: p.id,
      ev: evaluateHand(p.arrangement![r]!, eCfg)
    }))
    let best = evaluations[0]!.ev
    for (const e of evaluations) {
      if (compareEvaluations(e.ev, best) > 0) best = e.ev
    }
    const roundWinners = evaluations.filter(e => compareEvaluations(e.ev, best) === 0).map(e => e.playerId)
    const drawn = roundWinners.length !== 1
    out.push({ round: r + 1, evaluations, roundWinners: drawn ? [] : roundWinners, drawn })
    const names = (id: number): string => state.players[id]!.name
    if (drawn) {
      state.log.push(makeLog(`Round ${r + 1} drawn.`))
    } else {
      const w = roundWinners[0]!
      const winEv = evaluations.find(e => e.playerId === w)!.ev
      state.log.push(makeLog(`${names(w)} won Round ${r + 1} with a ${CATEGORY_LABEL[winEv.category]}.`))
    }
  }
  return out
}

const CATEGORY_LABEL: Record<number, string> = {
  7: '2-3-5', 6: 'Trail', 5: 'Pure Run', 4: 'Run', 3: 'Color', 2: 'Pair', 1: 'High Card'
}

function finishWin(state: GameState, winnerId: number, salami: boolean, roundResults: RoundCompareResult[]): RoundOutcome {
  const potBefore = state.pot
  const payouts: RoundOutcome['payouts'] = []
  const winner = state.players[winnerId]!
  winner.chips += state.pot
  payouts.push({ playerId: winnerId, amount: state.pot, reason: 'pot' })
  state.pot = 0
  if (salami) {
    const per = state.config.boot * state.config.salamiBonusMultiplier
    for (const p of state.players) {
      if (p.id === winnerId || p.eliminated) continue
      const paid = Math.min(p.chips, per)
      p.chips -= paid
      winner.chips += paid
      if (paid > 0) payouts.push({ playerId: winnerId, amount: paid, reason: 'salami' })
    }
  }
  const kind: RoundOutcomeKind = salami ? 'salami' : 'win'
  state.log.push(makeLog(
    salami
      ? `SALAMI! ${winner.name} won all three rounds and takes the pot plus the bonus.`
      : `${winner.name} wins the round and takes the pot of ${potBefore}.`
  ))
  state.kittiStreak = 0
  assertChipConservation(state)
  return { kind, winnerId, potBefore, payouts, roundResults }
}

function finishKitti(state: GameState, roundResults: RoundCompareResult[]): RoundOutcome {
  const potBefore = state.pot
  state.kittiStreak += 1
  state.totalKittis += 1
  state.log.push(makeLog(`KITTI — no winner. Pot of ${potBefore} carries over. (${state.kittiStreak} in a row)`))
  assertChipConservation(state)
  return { kind: 'kitti', winnerId: null, potBefore, payouts: [], roundResults }
}

export function applyAction(prev: GameState, action: GameAction): Result<GameState, EngineError> {
  const state = structuredClone(prev) as GameState

  switch (action.type) {
    case 'LOCK_IN': {
      if (state.phase !== 'arranging') {
        return { ok: false, error: { type: 'WRONG_PHASE', message: 'Cannot lock in now — the round is not in the arranging phase.' } }
      }
      const player = state.players.find(p => p.id === action.playerId)
      if (!player) return { ok: false, error: { type: 'UNKNOWN_PLAYER', message: `No player with id ${action.playerId}` } }
      if (player.eliminated) return { ok: false, error: { type: 'PLAYER_ELIMINATED', message: `${player.name} is eliminated.` } }
      if (player.lockedIn) return { ok: false, error: { type: 'ALREADY_LOCKED', message: `${player.name} has already locked in.` } }
      const check = checkArrangement(player.cards, action.arrangement, {
        aceTwoThreeRank: state.config.aceTwoThreeRank,
        allowTwoThreeFive: state.config.allowTwoThreeFive,
        enforceOrder: state.config.enforceOrder
      })
      if (!check.ok) {
        return { ok: false, error: { type: 'INVALID_ARRANGEMENT', message: check.reason ?? 'Invalid arrangement' } }
      }
      player.arrangement = action.arrangement.map(h => [...h] as Hand) as [Hand, Hand, Hand]
      player.lockedIn = true
      if (state.config.devAsserts) assertInvariants(state)

      const waiting = state.players.filter(p => !p.eliminated && !p.lockedIn)
      if (waiting.length === 0) {
        const outcome = resolveShowdown(state)
        state.outcome = outcome
        state.phase = 'roundEnd'
        if (state.config.devAsserts) assertInvariants(state)
      }
      return { ok: true, value: state }
    }
    case 'NEXT_ROUND': {
      if (state.phase !== 'roundEnd') {
        return { ok: false, error: { type: 'WRONG_PHASE', message: 'NEXT_ROUND only valid after a round has been resolved.' } }
      }
      return { ok: true, value: startRound(state, false) }
    }
    case 'REBUY': {
      // Re-buys only happen between hands (roundEnd): nobody holds cards, so adding chips is safe.
      if (state.phase !== 'roundEnd') {
        return { ok: false, error: { type: 'NOT_BETWEEN_HANDS', message: 'Re-buy opens between hands — after this hand resolves.' } }
      }
      const player = state.players.find(p => p.id === action.playerId)
      if (!player) return { ok: false, error: { type: 'UNKNOWN_PLAYER', message: `No player with id ${action.playerId}` } }
      const cents = Math.floor(action.cents)
      if (!Number.isFinite(cents) || cents < 100 || cents > 1_000_000) {
        return { ok: false, error: { type: 'INVALID_ARRANGEMENT', message: 'Re-buy must be a whole number of cents between $1 and $10,000.' } }
      }
      player.chips += cents
      state.chipsInPlay += cents
      if (player.eliminated) {
        player.eliminated = false
        state.activeCount += 1
        state.log.push(makeLog(`${player.name} is back in with a $${(cents / 100).toFixed(2)} re-buy.`))
      } else {
        state.log.push(makeLog(`${player.name} adds $${(cents / 100).toFixed(2)} to their stack.`))
      }
      if (state.config.devAsserts) assertInvariants(state)
      return { ok: true, value: state }
    }
    default: {
      const never: never = action
      void never
      return { ok: false, error: { type: 'WRONG_PHASE', message: 'Unknown action' } }
    }
  }
}
