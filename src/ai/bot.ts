import { Personality } from '../engine/config'
import { Hand, Card, compareCard } from '../engine/types'
import { EvalConfig, evaluateHand, compareEvaluations } from '../engine/evaluate'
import { Rng, mulberry32, streamSeed } from '../engine/rng'
import { percentileTable, handPercentile, cardDeckIndex } from './percentile'
import { PlayerView } from './view'

export type Arrangement = [Hand, Hand, Hand]

const eCfgOf = (cfg: PlayerView['config']): EvalConfig => ({
  aceTwoThreeRank: cfg.aceTwoThreeRank,
  allowTwoThreeFive: cfg.allowTwoThreeFive
})

// The 280 unordered index splits of {0..8}: shape-only, computed once and reused.
let splitIdxCache: [number, number, number][][] | null = null
function indexSplits(): [number, number, number][][] {
  if (splitIdxCache) return splitIdxCache
  const combos = (n: number, k: number): number[][] => {
    const res: number[][] = []
    const rec = (start: number, acc: number[]): void => {
      if (acc.length === k) { res.push(acc.slice()); return }
      for (let i = start; i <= n - (k - acc.length); i++) rec(i + 1, [...acc, i])
    }
    rec(0, [])
    return res
  }
  const seen = new Set<string>()
  const keyOf = (idxs: number[]): string => idxs.slice().sort((a, b) => a - b).join(',')
  const out: [number, number, number][][] = []
  for (const a of combos(9, 3)) {
    const remA = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(i => !a.includes(i))
    for (const bLocal of combos(6, 3)) {
      const b = bLocal.map(i => remA[i]!)
      const c = remA.filter(i => !b.includes(i))
      const key = [keyOf(a), keyOf(b), keyOf(c)].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      out.push([a as [number, number, number], b as [number, number, number], c as [number, number, number]])
    }
  }
  splitIdxCache = out
  return out
}

/** Ascending index triple (i<j<k) lookup, allocation-free. */
const pct3 = (table: Float64Array, i0: number, i1: number, i2: number): number => {
  let i = i0, j = i1, k = i2
  if (i > j) { const t = i; i = j; j = t }
  if (j > k) { const t = j; j = k; k = t }
  if (i > j) { const t = i; i = j; j = t }
  return table[(i * 52 + j) * 52 + k]!
}

interface ScoredSplit { ordered: Arrangement; heuristic: number }

/** All ordered candidate arrangements for 9 cards, scored by summed hand percentile. */
function scoredCandidates(cards: Card[], table: Float64Array): ScoredSplit[] {
  const out: ScoredSplit[] = []
  const idx = cards.map(cardDeckIndex)
  for (const split of indexSplits()) {
    const sa = split[0]!, sb = split[1]!, sc = split[2]!
    const pA = pct3(table, idx[sa[0]]!, idx[sa[1]]!, idx[sa[2]]!)
    const pB = pct3(table, idx[sb[0]]!, idx[sb[1]]!, idx[sb[2]]!)
    const pC = pct3(table, idx[sc[0]]!, idx[sc[1]]!, idx[sc[2]]!)
    const hA = [cards[sa[0]]!, cards[sa[1]]!, cards[sa[2]]!] as Hand
    const hB = [cards[sb[0]]!, cards[sb[1]]!, cards[sb[2]]!] as Hand
    const hC = [cards[sc[0]]!, cards[sc[1]]!, cards[sc[2]]!] as Hand
    const hands: [Hand, number][] = [[hA, pA], [hB, pB], [hC, pC]]
    hands.sort((x, y) => y[1] - x[1])
    out.push({ ordered: [hands[0]![0], hands[1]![0], hands[2]![0]], heuristic: hands[0]![1] + hands[1]![1] + hands[2]![1] })
  }
  return out
}

/** Fast heuristic: the arrangement with the highest summed hand percentile. Allocation-light. */
export function heuristicArrangement(cards: Card[], cfg: PlayerView['config']): Arrangement {
  const table = percentileTable(eCfgOf(cfg))
  const idx = cards.map(cardDeckIndex)
  let bestScore = -Infinity
  let bestSplit: [[number, number, number], [number, number, number], [number, number, number]] | null = null
  let bestP = [0, 0, 0]
  for (const split of indexSplits()) {
    const sa = split[0]!, sb = split[1]!, sc = split[2]!
    const pA = pct3(table, idx[sa[0]]!, idx[sa[1]]!, idx[sa[2]]!)
    const pB = pct3(table, idx[sb[0]]!, idx[sb[1]]!, idx[sb[2]]!)
    const pC = pct3(table, idx[sc[0]]!, idx[sc[1]]!, idx[sc[2]]!)
    const score = pA + pB + pC
    if (score > bestScore) {
      bestScore = score
      bestSplit = split as unknown as [[number, number, number], [number, number, number], [number, number, number]]
      bestP = [pA, pB, pC]
    }
  }
  const bs = bestSplit!
  const sa = bs[0]!, sb = bs[1]!, sc = bs[2]!
  const groups: [Hand, number][] = [
    [[cards[sa[0]]!, cards[sa[1]]!, cards[sa[2]]!] as Hand, bestP[0]!],
    [[cards[sb[0]]!, cards[sb[1]]!, cards[sb[2]]!] as Hand, bestP[1]!],
    [[cards[sc[0]]!, cards[sc[1]]!, cards[sc[2]]!] as Hand, bestP[2]!]
  ]
  groups.sort((x, y) => y[1] - x[1])
  return [groups[0]![0], groups[1]![0], groups[2]![0]] as Arrangement
}

interface RolloutResult { winProb: number; salamiProb: number; h1h2Percentile: number }

/** Estimate win/salami probabilities of one candidate arrangement by Monte Carlo rollout. */
function evaluateCandidate(
  candidate: Arrangement,
  view: PlayerView,
  table: Float64Array,
  rng: Rng,
  samples: number
): RolloutResult {
  const eCfg = eCfgOf(view.config)
  const unseen: Card[] = []
  const ourIds = new Set(view.cards.map(c => `${c.rank}:${c.suit}`))
  for (let rank = 2; rank <= 14; rank++) {
    for (const suit of ['spades', 'hearts', 'diamonds', 'clubs'] as const) {
      if (!ourIds.has(`${rank}:${suit}`)) unseen.push({ rank: rank as Card['rank'], suit })
    }
  }
  const opponents = view.seats.filter(s => s.id !== view.selfId && !s.eliminated)

  let wins = 0
  let salamis = 0
  const candEvs = candidate.map(h => evaluateHand(h, eCfg))

  for (let s = 0; s < samples; s++) {
    // partial Fisher-Yates to deal each opponent 9 cards from the 43 unseen cards
    const pool = unseen.slice()
    const need = opponents.length * 9
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i))
      const t = pool[i]!; pool[i] = pool[j]!; pool[j] = t
    }
    let offset = 0
    const oppEvsByRound: ReturnType<typeof evaluateHand>[][] = [[], [], []]
    for (const _opp of opponents) {
      const oppCards = pool.slice(offset, offset + 9)
      offset += 9
      const oppArr = heuristicArrangement(oppCards, view.config)
      for (let r = 0; r < 3; r++) oppEvsByRound[r]!.push(evaluateHand(oppArr[r]!, eCfg))
    }
    const wonR = [0, 0, 0]
    for (let r = 0; r < 3; r++) {
      const cand = candEvs[r]!
      const oppEvs = oppEvsByRound[r]!
      let best = cand
      for (const oe of oppEvs) if (compareEvaluations(oe, best) > 0) best = oe
      const candIsBest = compareEvaluations(cand, best) === 0
      const oppWinners = candIsBest ? oppEvs.filter(oe => compareEvaluations(oe, best) === 0).length : 0
      wonR[r] = candIsBest && oppWinners === 0 ? 1 : 0
    }
    const roundsWon = wonR[0]! + wonR[1]! + wonR[2]!
    const qualifies = view.config.winCondition === 'any_two'
      ? roundsWon >= 2
      : (wonR[0]! === 1 && wonR[1]! === 1) || (wonR[1]! === 1 && wonR[2]! === 1)
    if (qualifies) {
      wins += 1
      if (roundsWon === 3) salamis += 1
    }
  }
  const h1h2Percentile = handPercentile(table, candidate[0]) + handPercentile(table, candidate[1])
  return { winProb: wins / samples, salamiProb: salamis / samples, h1h2Percentile }
}

const SHORTLIST = 12

/** Deterministic Monte Carlo bot decision. `rng` should be seeded per decision for reproducibility. */
export function decideArrangement(view: PlayerView, rng: Rng): Arrangement {
  const eCfg = eCfgOf(view.config)
  const personality: Personality = view.seats.find(s => s.id === view.selfId)?.personality ?? 'balanced'
  const table = percentileTable(eCfg)

  // Phase 1: heuristic shortlist (all 280 splits, keep the best few by heuristic score)
  const shortlist = scoredCandidates(view.cards, table)
    .sort((a, b) => b.heuristic - a.heuristic)
    .slice(0, SHORTLIST)

  // Phase 2: Monte Carlo on the shortlist. Sample count is reduced deterministically
  // with opponent count so decisions stay inside the time budget regardless of table size.
  const opponents = Math.max(1, view.seats.filter(s => s.id !== view.selfId && !s.eliminated).length)
  const samples = Math.max(4, Math.floor(view.config.rolloutSamples / opponents))

  const results = shortlist.map(cand => ({
    cand: cand.ordered,
    r: evaluateCandidate(cand.ordered, view, table, rng, samples),
    heuristic: cand.heuristic
  }))

  const salamiWeight = personality === 'aggressive' ? 0.9 : personality === 'balanced' ? 0.35 : personality === 'safe' ? 0.1 : 0.5
  const scoreOf = (r: RolloutResult, heuristic: number): number => {
    let s = r.winProb + salamiWeight * r.salamiProb + heuristic * 0.0001
    if (personality === 'aggressive') s += r.h1h2Percentile * 0.0004 // stack the top two hands
    if (personality === 'safe') s = r.winProb * 1.2 + salamiWeight * r.salamiProb // maximize lock-in chance
    return s
  }
  const scoredResults = results.map(x => ({ ...x, score: scoreOf(x.r, x.heuristic) }))
  scoredResults.sort((a, b) => b.score - a.score)

  if (personality === 'unpredictable' && scoredResults.length >= 3) {
    const top3 = scoredResults.slice(0, 3)
    const floorScore = Math.min(...top3.map(x => x.score))
    const weights = top3.map(x => x.score - floorScore + 0.05)
    const total = weights.reduce((a, b) => a + b, 0)
    let pick = rng() * total
    for (let i = 0; i < 3; i++) {
      pick -= weights[i]!
      if (pick <= 0) return top3[i]!.cand
    }
    return top3[0]!.cand
  }
  return scoredResults[0]!.cand
}

/** Decision-time RNG stream, derived from game seed + round + seat: reproducible per deal. */
export function decisionRng(seed: number, round: number, seatId: number): Rng {
  return mulberry32(streamSeed(seed, 0xB07 ^ (round * 1000003) ^ (seatId * 9176 + 7)))
}

/**
 * Public entry: returns a guaranteed-legal arrangement for the bot's own cards.
 * Falls back to the fast heuristic (always legal) if the Monte Carlo result fails validation.
 */
export function botArrangement(view: PlayerView, rng: Rng): { arrangement: Arrangement; usedFallback: boolean } {
  const candidate = decideArrangement(view, rng)
  if (isValidForView(view, candidate)) return { arrangement: candidate, usedFallback: false }
  return { arrangement: heuristicArrangement(view.cards, view.config), usedFallback: true }
}

export function isValidForView(view: PlayerView, arrangement: Arrangement): boolean {
  const flat = arrangement.flat()
  if (flat.length !== 9) return false
  const want = new Map<string, number>()
  for (const c of view.cards) want.set(`${c.rank}:${c.suit}`, (want.get(`${c.rank}:${c.suit}`) ?? 0) + 1)
  const seen = new Map<string, number>()
  for (const c of flat) seen.set(`${c.rank}:${c.suit}`, (seen.get(`${c.rank}:${c.suit}`) ?? 0) + 1)
  for (const [k, v] of want) if (seen.get(k) !== v) return false
  if (view.config.enforceOrder) {
    const eCfg = eCfgOf(view.config)
    const e = arrangement.map(h => evaluateHand(h, eCfg))
    if (compareEvaluations(e[0]!, e[1]!) < 0) return false
    if (compareEvaluations(e[1]!, e[2]!) < 0) return false
  }
  return true
}

/** Exported for tests: percentile table builder passthrough. */
export const __percentileTable = percentileTable
export const __sorted9 = (cards: Card[]): Card[] => [...cards].sort(compareCard)
