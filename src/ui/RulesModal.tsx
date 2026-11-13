import { CardFace } from './CardView'
import type { Card } from '../engine/types'

const C = (rank: number, suit: Card['suit']): Card => ({ rank: rank as Card['rank'], suit })
const LADDER: { name: string; color: string; cards: [number, Card['suit']][] }[] = [
  { name: 'Trail', color: 'var(--tier-trail)', cards: [[14, 'spades'], [14, 'hearts'], [14, 'clubs']] },
  { name: 'Pure Run', color: 'var(--tier-pure-run)', cards: [[10, 'hearts'], [9, 'hearts'], [8, 'hearts']] },
  { name: 'Run', color: 'var(--tier-run)', cards: [[9, 'spades'], [8, 'hearts'], [7, 'diamonds']] },
  { name: 'Color', color: 'var(--tier-color)', cards: [[13, 'clubs'], [9, 'clubs'], [4, 'clubs']] },
  { name: 'Pair', color: 'var(--tier-pair)', cards: [[7, 'spades'], [7, 'hearts'], [13, 'diamonds']] },
  { name: 'High Card', color: 'var(--tier-high-card)', cards: [[14, 'spades'], [11, 'diamonds'], [8, 'clubs']] }
]

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Rules of KITTI" onClick={onClose}>
      <div className="rules-modal" onClick={e => e.stopPropagation()}>
        <h2>HOW TO PLAY</h2>
        <p style={{ fontSize: '.82rem' }}>Each player is dealt <strong>9 cards</strong> and splits them into <strong>three hands of three</strong>. Hands are shown one round at a time: Hand 1, Hand 2, Hand 3. With <code>enforceOrder</code> on (default), Hand 1 must be at least as strong as Hand 2, and Hand 2 at least as strong as Hand 3.</p>
        <h3 style={{ fontSize: '.8rem', letterSpacing: '.2em', color: 'var(--gold-soft)' }}>THE LADDER</h3>
        <div className="ladder" role="list" aria-label="Hand rankings, strongest first">
          {LADDER.map((row, i) => (
            <div className="ladder-row" role="listitem" key={row.name} style={{ borderLeftColor: row.color }}>
              <span style={{ width: '1.6em', fontFamily: 'var(--font-display)', fontWeight: 800, color: row.color }}>{i + 1}</span>
              <span style={{ width: '6.5em', fontWeight: 700, color: row.color }}>{row.name}</span>
              <span className="cards-row">{row.cards.map(([r, s]) => <CardFace key={`${r}${s}`} card={C(r, s)} small />)}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '.78rem' }}><strong>Run order:</strong> A-K-Q is highest; A-2-3 is second highest by default (configurable as the <em>lowest</em> run). Runs never wrap — K-A-2 is not a run. <strong>Suits never break ties</strong>; identical rank patterns are a true tie and the round is drawn.</p>
        <h3 style={{ fontSize: '.8rem', letterSpacing: '.2em', color: 'var(--gold-soft)' }}>WINNING, SALAMI, KITTI</h3>
        <p style={{ fontSize: '.78rem' }}>Take the pot by winning <strong>any 2 of the 3 rounds</strong> (or 2 consecutive, configurable). Win <strong>all three</strong> for a <strong>SALAMI</strong> — pot plus one boot per opponent. Nobody qualifying means a <strong>KITTI</strong>: no winner, the pot rolls over, fresh deck, ante again.</p>
        <h3 style={{ fontSize: '.8rem', letterSpacing: '.2em', color: 'var(--gold-soft)' }}>HOUSE RULES (off by default)</h3>
        <ul style={{ fontSize: '.78rem', marginTop: 0 }}>
          <li><strong>2-3-5 beats all:</strong> not-all-one-suit 2-3-5 outranks even a trail.</li>
          <li><strong>Four of a kind:</strong> holding four of a kind among your nine wins automatically.</li>
          <li><strong>Four pairs:</strong> forces a redeal counted as a kitti.</li>
        </ul>
        <div style={{ textAlign: 'right', marginTop: 'var(--s2)' }}><button className="btn btn-gold" onClick={onClose} autoFocus>Close</button></div>
      </div>
    </div>
  )
}
