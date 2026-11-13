import { memo } from 'react'
import type { Card } from '../engine/types'

/**
 * All 52 cards, the back and empty slots as original SVG — generated from data, no assets.
 * Corner indices large and readable; pips use a classic symmetric layout; the court cards
 * are geometric medallions (J = lance & star, Q = lotus, K = crown & sun) drawn from primitives.
 */

const RANKS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const rankLabel = (r: number): string => RANKS[r] ?? String(r)

type SuitName = Card['suit']

const SUIT_PATHS: Record<SuitName, string> = {
  // centered at 0,0 roughly inside 20x20 box
  spades: 'M0,-8 C-7,-1 -9,5 -5,8 C-2.6,10 0,8.5 0,6 C0,8.5 2.6,10 5,8 C9,5 7,-1 0,-8 Z',
  hearts: 'M0,7 C-8,0 -10,-5 -6.5,-8 C-4,-10 -1,-8.6 0,-6.4 C1,-8.6 4,-10 6.5,-8 C10,-5 8,0 0,7 Z',
  diamonds: 'M0,-9 L6.2,0 L0,9 L-6.2,0 Z',
  clubs: 'M0,-8 A4.6,4.6 0 1 1 -4.2,-0.5 A4.6,4.6 0 1 1 4.2,-0.5 A4.6,4.6 0 1 1 0,-8.01 M0,3.6 C0,6 0,7.5 0,9 M-2.4,9 L2.4,9 Z'
}

// Pip anchor points in a 60x90 field (x: 6..54, y: 6..84), column positions: left=13, mid=30, right=47
const L = 13, M = 30, R = 47, T = 9, MT = 19, UQ = 30, MQ = 45, LQ = 60, B2 = 71, B = 81
const PIP_LAYOUT: Record<number, [number, number][]> = {
  2: [[M, T], [M, B]],
  3: [[M, T], [M, M + 15], [M, B]],
  4: [[L, T], [R, T], [L, B], [R, B]],
  5: [[L, T], [R, T], [M, MQ], [L, B], [R, B]],
  6: [[L, T], [R, T], [L, MQ], [R, MQ], [L, B], [R, B]],
  7: [[L, T], [R, T], [M, MT + 1], [L, MQ], [R, MQ], [L, B], [R, B]],
  8: [[L, T], [R, T], [M, MT + 1], [L, MQ], [R, MQ], [M, LQ + 1], [L, B], [R, B]],
  9: [[L, T], [R, T], [M, MT], [L, UQ], [R, UQ], [L, LQ], [R, LQ], [M, B2], [M, B]],
  10: [[L, T], [R, T], [M, MT], [L, UQ], [R, UQ], [L, LQ], [R, LQ], [M, LQ + 11], [L, B], [R, B]]
}
// 10 is rare/awkward with 9-row model; normalize: use classic 10 = 4 columns pairs + two mids
PIP_LAYOUT[10] = [[L, T], [R, T], [M, MT], [L, UQ], [R, UQ], [L, LQ], [R, LQ], [M, LQ + 10], [L, B], [R, B]]
PIP_LAYOUT[9] = [[L, T], [R, T], [L, MT + 1], [R, MT + 1], [M, MQ], [L, LQ + 1], [R, LQ + 1], [L, B], [R, B]]
PIP_LAYOUT[8] = [[L, T], [R, T], [L, MT + 1], [R, MT + 1], [L, MQ], [R, MQ], [L, B], [R, B]]
PIP_LAYOUT[7] = [[L, T], [R, T], [M, MT + 6], [L, MQ], [R, MQ], [L, B], [R, B]]

const shade = (dark: boolean): string => (dark ? '#1c2733' : '#a61b1b')

export interface DeckCardProps {
  card: Card
  /** four-color accessibility deck: spades ink, hearts crimson, diamonds blue, clubs green */
  fourColor?: boolean
  className?: string
}

const suitColor = (suit: SuitName, fourColor: boolean): string => {
  if (!fourColor) return shade(suit === 'spades' || suit === 'clubs')
  switch (suit) {
    case 'spades': return '#1f2733'
    case 'hearts': return '#a61b1b'
    case 'diamonds': return '#0f5fc0'
    case 'clubs': return '#0d7a3f'
  }
}

const Pip = memo(function Pip({ suit, x, y, color, scale = 1 }: { suit: SuitName; x: number; y: number; color: string; scale?: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <path d={SUIT_PATHS[suit]} fill={color} fillRule="evenodd" strokeLinejoin="round" stroke={color} strokeWidth="0.4" />
    </g>
  )
})

const CourtMedallion = memo(function CourtMedallion({ rank, color }: { rank: number; color: string }) {
  // Original geometric court art: each rank = a celestial/martial emblem inside a ring.
  return (
    <g transform="translate(50,70)">
      <circle r="24.5" fill="none" stroke={color} strokeWidth="2.4" strokeOpacity="0.9" />
      <circle r="19.5" fill="none" stroke={color} strokeWidth="0.9" strokeOpacity="0.55" />
      {rank === 11 && ( // Jack: eight-pointed lance star — the young knight's spear
        <g stroke={color} strokeWidth="2" strokeLinejoin="round" fill={color} fillOpacity="0.12">
          <path d="M0,-14 L3.4,-4.5 L13,-7.5 L5.5,1 L13,9.5 L3.4,6.5 L0,16 L-3.4,6.5 L-13,9.5 L-5.5,1 L-13,-7.5 L-3.4,-4.5 Z" />
          <circle r="2.6" fill={color} fillOpacity="1" stroke="none" />
        </g>
      )}
      {rank === 12 && ( // Queen: lotus with pearls — the festival queen
        <g stroke={color} strokeWidth="1.8" strokeLinejoin="round" fill={color} fillOpacity="0.14">
          <path d="M0,-13 C5,-8 5,-2 0,6 C-5,-2 -5,-8 0,-13 Z" />
          <path d="M-10,-7 C-6.5,-4 -6,2.5 -1.5,7.5 C-9.5,6 -11.5,-1.5 -10,-7 Z" />
          <path d="M10,-7 C6.5,-4 6,2.5 1.5,7.5 C9.5,6 11.5,-1.5 10,-7 Z" />
          <path d="M-13,7 L13,7 M-9,12 L9,12" strokeOpacity="0.85" />
        </g>
      )}
      {rank === 13 && ( // King: crown over a rising sun — the patron of the feast
        <g stroke={color} strokeWidth="1.9" strokeLinejoin="round" fill={color} fillOpacity="0.15">
          <path d="M-12,6 L-9,-8 L-4.5,0.5 L0,-12 L4.5,0.5 L9,-8 L12,6 Z" />
          <path d="M-12,11.5 L12,11.5" strokeOpacity="0.85" />
          <circle cy="0" r="1.6" fill={color} stroke="none" />
        </g>
      )}
      <text y="33.5" textAnchor="middle" fontSize="11" fontWeight="700" fill={color} fontFamily="Georgia, serif" opacity="0.95">
        {rankLabel(rank)}
      </text>
    </g>
  )
})

export const DeckCard = memo(function DeckCard({ card, fourColor = false, className }: DeckCardProps) {
  const color = suitColor(card.suit, fourColor)
  const label = `${rankLabel(card.rank)} of ${card.suit}`
  const pips = PIP_LAYOUT[card.rank]
  const isCourt = card.rank >= 11 && card.rank <= 13
  const isAce = card.rank === 14
  return (
    <svg viewBox="0 0 100 140" className={`deck-card${className ? ' ' + className : ''}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.14" />
        </linearGradient>
        <radialGradient id="paper" cx="0.35" cy="0.3" r="1.1">
          <stop offset="0" stopColor="#fffdf4" />
          <stop offset="0.7" stopColor="#faf3e2" />
          <stop offset="1" stopColor="#efe6cf" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="url(#paper)" stroke="#241c12" strokeOpacity="0.28" strokeWidth="1.4" />
      <rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="url(#sheen)" pointerEvents="none" />
      {/* corner indices */}
      <g fill={color} fontFamily="'Fraunces', Georgia, serif" fontWeight="800">
        <text x="9" y="21" fontSize="17" textAnchor="middle">{rankLabel(card.rank)}</text>
        <text x="9" y="35.5" fontSize="13.5" textAnchor="middle">{{ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[card.suit]}</text>
        <g transform="rotate(180 91 119)">
          <text x="91" y="121" fontSize="17" textAnchor="middle">{rankLabel(card.rank)}</text>
          <text x="91" y="135.5" fontSize="13.5" textAnchor="middle">{{ spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[card.suit]}</text>
        </g>
      </g>
      {/* centre */}
      {isAce && (
        <g transform="translate(50,72)">
          <circle r="21" fill="none" stroke={color} strokeWidth="1.4" strokeOpacity="0.7" />
          <path d={SUIT_PATHS[card.suit]} fill={color} fillRule="evenodd" transform="scale(2.1)" strokeLinejoin="round" stroke={color} strokeWidth="0.3" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map(a => (
            <line key={a} x1="0" y1="0" x2="0" y2="-27" stroke={color} strokeWidth="1.1" strokeOpacity="0.35" transform={`rotate(${a})`} />
          ))}
        </g>
      )}
      {isCourt && <CourtMedallion rank={card.rank} color={color} />}
      {pips && !isAce && pips.slice(0, 10).map(([x, y], i) => <Pip key={i} suit={card.suit} x={x} y={y + 34} color={color} scale={card.rank >= 8 ? 0.8 : 0.95} />)}
    </svg>
  )
})

/** Original mandala card back — deep emerald field, gold ring, petal lattice. */
export const DeckCardBack = memo(function DeckCardBack({ className }: { className?: string }) {
  const petals = Array.from({ length: 16 }, (_, i) => i * 22.5)
  return (
    <svg viewBox="0 0 100 140" className={`deck-card deck-back${className ? ' ' + className : ''}`} role="img" aria-label="Face-down card">
      <defs>
        <radialGradient id="backFelt" cx="0.5" cy="0.5" r="0.85">
          <stop offset="0" stopColor="#155a43" />
          <stop offset="0.55" stopColor="#0f3d2e" />
          <stop offset="1" stopColor="#07281b" />
        </radialGradient>
      </defs>
      <rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="url(#backFelt)" stroke="#b98a2f" strokeWidth="3" />
      <rect x="6.5" y="6.5" width="87" height="127" rx="7" fill="none" stroke="#b98a2f" strokeWidth="1.1" strokeOpacity="0.85" />
      <g transform="translate(50,70)" stroke="#e8b64c" fill="none">
        <circle r="26" strokeWidth="2" strokeOpacity="0.95" />
        <circle r="20" strokeWidth="0.8" strokeOpacity="0.6" />
        {petals.map(a => (
          <g key={a} transform={`rotate(${a})`}>
            <path d="M0,-25 C3.6,-19 3.6,-13 0,-9 C-3.6,-13 -3.6,-19 0,-25 Z" strokeWidth="1.15" strokeOpacity="0.9" />
          </g>
        ))}
        <circle r="7.5" strokeWidth="1.6" strokeOpacity="0.95" />
        <circle r="2.3" fill="#e8b64c" stroke="none" strokeOpacity="0.95" />
        {[45, 135, 225, 315].map(a => (
          <g key={a} transform={`rotate(${a})`}>
            <path d="M0,-38 C2.4,-34.5 2.4,-31 0,-28 C-2.4,-31 -2.4,-34.5 0,-38 Z" strokeWidth="1" strokeOpacity="0.55" />
          </g>
        ))}
      </g>
    </svg>
  )
})
