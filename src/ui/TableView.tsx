import { motion } from 'framer-motion'
import type { GameState } from '../engine/game'
import { Avatar, PERSONALITY_META } from './Avatar'
import { formatChips } from './money'
import { useReducedMotion } from './motion/MotionConfig'

function seatStyle(index: number, total: number, viewerSeat = 0): { left: string; top: string } {
  const rel = (index - viewerSeat + total) % total
  const angle = ((90 + (360 / total) * rel) * Math.PI) / 180
  const top = Math.min(88, 50 + 40 * Math.sin(angle))
  const left = Math.min(86, Math.max(14, 50 + 43 * Math.cos(angle)))
  return { left: `${left}%`, top: `${top}%` }
}
const CHIP_COLORS = ['#c22e2e', '#124e35', '#1d3a6e', '#7a3fd6', '#b57f1e']

/** Table: oval felt, seats, pot with chip stack. Purely presentational; engine is truth. */
export function TableView({ state, humanSeat = 0 }: { state: GameState; humanSeat?: number }) {
  const total = state.players.length
  const reduced = useReducedMotion()
  const chipCount = Math.min(CHIP_COLORS.length, Math.max(1, Math.floor(Math.log2(state.pot / 10 + 1))))
  const dealerId = state.dealerIndex

  return (
    <div className="oval-table" role="table" aria-label="KITTI table">
      <div className="pot-center">
        <div className="pot-label">POT</div>
        <div className="pot-amount" aria-label={`Pot of ${formatChips(state.pot)}`}>{formatChips(state.pot)}</div>
        <div className="chip-stack" aria-hidden="true">
          {Array.from({ length: chipCount }, (_, i) => (
            <motion.div key={i} className="chip" initial={reduced ? false : { scale: 0, y: 8 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }} />
          ))}
        </div>
        <div className="pot-meta">Round {state.round} · Dealer: {state.players[dealerId]?.name}</div>
        {state.kittiStreak > 0 && <div className="kitti-badge">KITTI ×{state.kittiStreak} — POT CARRIES</div>}
      </div>

      {state.players.map(p => {
        const pos = seatStyle(p.id, total, humanSeat)
        const isDealer = p.id === dealerId
        const label = PERSONALITY_META[p.personality ?? 'balanced']?.label ?? ''
        return (
          <div
            key={p.id}
            className={`seat${p.id === 0 ? ' seat-human' : ''}`}
            style={pos}
            role="row"
            aria-label={`${p.name}, ${formatChips(p.chips)}${p.eliminated ? ', eliminated' : ''}${p.lockedIn ? ', locked in' : ''}`}
          >
            {isDealer && <motion.div className="turn-ring" layoutId="turn-ring" transition={{ type: 'spring', stiffness: 260, damping: 30 }} aria-hidden="true" />}
            <div className={`seat-nameplate${isDealer ? ' dealer' : ''}${p.eliminated ? ' eliminated' : ''}`}>
              <div className="seat-row">
                <span className="avatar" aria-hidden="true"><Avatar personality={p.personality ?? undefined} size={34} /></span>
                <span>
                  <span className="seat-name">{p.name}{p.id === humanSeat ? ' (you)' : ''}</span><br />
                  {p.personality && <span className="seat-personality">{label}</span>}
                </span>
              </div>
              <div className="seat-row" style={{ marginTop: 4 }}>
                <span className="seat-chips" aria-label="chips">◉ {formatChips(p.chips)}</span>
                {isDealer && <span className="badge badge-dealer">DEALER</span>}
                {p.lockedIn && !p.eliminated && <span className="badge badge-locked">LOCKED IN</span>}
                {p.eliminated && <span className="badge badge-out">OUT</span>}
              </div>
            </div>
            {p.id !== 0 && !p.eliminated && (
              <div className="seat-cards" aria-hidden="true" style={{ opacity: p.lockedIn ? 0.35 : 0.9 }}>
                {p.cards.map((_, i) => (
                  <motion.div key={i} className="mini-card" style={{ ['--tilt' as string]: `${(i - 4) * 1.6}deg` }} animate={{ scale: p.lockedIn ? 0.82 : 1 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
