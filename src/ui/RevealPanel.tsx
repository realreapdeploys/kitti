import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GameState } from '../engine/game'
import { describeHand } from '../engine/evaluate'
import { CardFace, CardBack } from './CardView'
import { Hand } from '../engine/types'
import { SPRINGS } from './motion/springs'
import { useReducedMotion } from './motion/MotionConfig'
import { playSound } from './sound'
import { formatChips } from './money'

/** A round hand that flips from face-down to face-up in real 3D. */
function FlipHand({ revealed, winner, drawn, children }: { revealed: boolean; winner: boolean; drawn: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={`reveal-hand${winner ? ' winner' : ''}${drawn ? ' drawn' : ''}${revealed && !winner && !drawn ? ' dim' : ''}`}
      animate={{ scale: revealed && winner ? (reduced ? 1 : 1.06) : 1 }}
      transition={reduced ? { duration: 0.08 } : SPRINGS.bouncy}
      style={{ perspective: 700 }}
    >
      <div style={{ transformStyle: 'preserve-3d' }}>
        {children}
      </div>
    </motion.div>
  )
}
const CONFETTI_COLORS = ['#e8b64c', '#f5d98b', '#e4572e', '#ff8a63', '#7fd08f', '#b78cff', '#4fd0c2']

function Confetti() {
  const pieces = Array.from({ length: 42 }, (_, i) => i)
  return (
    <div className="confetti-layer" aria-hidden="true">
      {pieces.map(i => {
        const left = (i * 97.3) % 100
        const delay = (i % 14) * 0.09
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
        return (
          <motion.span
            key={i}
            className="confetto"
            style={{ left: `${left}%`, background: color, borderRadius: i % 3 === 0 ? '50%' : 1 }}
            initial={{ y: '-8%', opacity: 0, rotate: 0 }}
            animate={{ y: '120%', opacity: [0, 1, 1, 0.4], rotate: (i % 2 ? 1 : -1) * (140 + (i * 37) % 220) }}
            transition={{ duration: 2.4 + (i % 5) * 0.35, delay, ease: 'easeIn', repeat: 1 }}
          />
        )
      })}
    </div>
  )
}

export function RevealPanel({ state, onNext, countdownSeconds = null, nextLabel = 'Next Round', note, humanSeat = 0 }: { state: GameState; onNext: () => void; countdownSeconds?: number | null; nextLabel?: string; note?: string; humanSeat?: number }) {
  const [step, setStep] = useState(0) // 0 = nothing revealed yet; increments to 3
  const reduced = useReducedMotion()

  useEffect(() => {
    setStep(0)
    const base = reduced ? 120 : 520
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 1; i <= 3; i++) {
      timers.push(setTimeout(() => { setStep(i); playSound('flip') }, base * i))
    }
    return () => timers.forEach(clearTimeout)
  }, [state.round, state.outcome, reduced])

  useEffect(() => {
    if (step >= 3 && state.outcome) {
      playSound(state.outcome.kind === 'salami' ? 'salami' : state.outcome.kind === 'kitti' ? 'kitti' : 'win')
    }
  }, [step, state.outcome])

  const outcome = state.outcome
  if (!outcome) return null
  const eCfg = { aceTwoThreeRank: state.config.aceTwoThreeRank, allowTwoThreeFive: state.config.allowTwoThreeFive }
  const allRevealed = step >= 3

  return (
    <section className="reveal-panel" aria-label="Showdown">
      {[0, 1, 2].map(r => {
        const rr = outcome.roundResults[r]!
        const revealed = step > r
        return (
          <div className="reveal-round" key={r} aria-label={`Round ${r + 1}`}>
            <div className="round-tag">ROUND {r + 1}{rr.drawn && revealed ? ' · DRAWN' : ''}</div>
            <div className="reveal-hands">
              {rr.evaluations.map(({ playerId }) => {
                const p = state.players[playerId]!
                const isWinner = revealed && !rr.drawn && rr.roundWinners.includes(playerId)
                const handCards = p.arrangement![r]! as Hand
                // '(you)' marks YOUR seat, not seat 0
                return (
                  <FlipHand key={playerId} revealed={revealed} winner={isWinner} drawn={rr.drawn && revealed}>
                    <div className="who">{p.name}{p.id === humanSeat ? ' (you)' : ''}{isWinner ? ' ★' : ''}</div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {revealed
                        ? handCards.map((c, i) => (
                            <motion.div
                              key={i}
                              initial={reduced ? { opacity: 0 } : { rotateY: 90, opacity: 0 }}
                              animate={reduced ? { opacity: 1 } : { rotateY: 0, opacity: 1 }}
                              transition={reduced ? { duration: 0.08 } : { type: 'spring', stiffness: 260, damping: 22, delay: i * 0.06 }}
                            >
                              <CardFace card={c} small />
                            </motion.div>
                          ))
                        : [0, 1, 2].map(i => <CardBack key={i} small />)}
                    </div>
                    <div className="hand-desc">{revealed ? describeHand(handCards, eCfg) : ''}</div>
                  </FlipHand>
                )
              })}
            </div>
          </div>
        )
      })}

      <AnimatePresence>
        {allRevealed && (
          <motion.div
            key={`banner-${outcome.kind}-${state.round}`}
            initial={reduced ? { opacity: 0 } : { scale: 0.3, opacity: 0, y: -18 }}
            animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0.1 } : SPRINGS.bouncy}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}
          >
            {outcome.kind === 'salami' && <Confetti />}
            <div className={`banner ${outcome.kind === 'win' ? 'banner-win' : outcome.kind === 'salami' ? 'banner-salami' : 'banner-kitti'}`} role="alert">
              {outcome.kind === 'kitti'
                ? 'KITTI'
                : outcome.kind === 'salami'
                  ? (outcome.winnerId === humanSeat ? 'SALAMI! YOU WIN!' : `SALAMI! ${state.players[outcome.winnerId!]!.name} WINS`)
                  : (outcome.winnerId === humanSeat ? 'WINNER — YOU!' : `WINNER — ${state.players[outcome.winnerId!]!.name}`)}
            </div>
            <p className="banner-sub">
              {outcome.kind === 'kitti'
                ? `No winner — the pot of ${formatChips(outcome.potBefore)} carries over. Ante again.`
                : outcome.winnerId === humanSeat
                  ? `You take the pot of ${formatChips(outcome.potBefore)}${outcome.kind === 'salami' ? ' plus the salami bonus' : ''}.`
                  : `${state.players[outcome.winnerId!]!.name} takes the pot of ${formatChips(outcome.potBefore)}${outcome.kind === 'salami' ? ' plus the salami bonus' : ''}.`}
            </p>
            <button className="btn btn-gold btn-cta" onClick={onNext} autoFocus>
              {outcome.kind === 'kitti' ? 'Redeal' : nextLabel}
            </button>
            {note && <p style={{ textAlign: 'center', opacity: 0.7, fontSize: '.75rem', margin: '.25rem 0 0' }}>{note}</p>}
            {countdownSeconds !== null && countdownSeconds !== undefined && (
              <p className="round-countdown" role="timer" aria-live="polite">Auto-starts in {countdownSeconds}s</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {!allRevealed && <p style={{ textAlign: 'center', opacity: 0.7, fontSize: '0.8rem', margin: 0 }}>Revealing…</p>}
    </section>
  )
}
