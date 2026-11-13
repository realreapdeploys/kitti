import type { Card } from '../engine/types'
import { DeckCard, DeckCardBack } from './DeckCard'

export function CardFace({ card, small = false }: { card: Card; small?: boolean }) {
  let fourColor = false
  try { fourColor = localStorage.getItem('kitti-four-color') === 'on' } catch { /* ignore */ }
  return <DeckCard card={card} fourColor={fourColor} className={small ? 'sm' : ''} />
}

export function CardBack({ small = false }: { small?: boolean }) {
  return <DeckCardBack className={small ? 'sm' : ''} />
}

export function CardSlotEmpty() {
  return (
    <svg viewBox="0 0 100 140" className="deck-card sm" role="img" aria-label="Empty slot">
      <rect x="1.5" y="1.5" width="97" height="137" rx="10" fill="rgba(0,0,0,0.32)" stroke="#b98a2f" strokeOpacity="0.55" strokeWidth="1.5" />
      {[[20,18],[80,18],[20,122],[80,122]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r="2.4" fill="#e8b64c" fillOpacity="0.35" />)}
    </svg>
  )
}
