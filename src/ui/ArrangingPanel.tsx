import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, Hand } from '../engine/types'
import { GameState } from '../engine/game'
import { checkArrangement } from '../engine/arrange'
import { describeHand } from '../engine/evaluate'
import { heuristicArrangement } from '../ai/bot'
import { CardFace, CardSlotEmpty } from './CardView'
import { SPRINGS } from './motion/springs'
import { useReducedMotion } from './motion/MotionConfig'
import { playSound } from './sound'

interface Props {
  state: GameState
  onLockIn: (arrangement: [Hand, Hand, Hand]) => void
  lockError: string | null
  /** Seat index of the local human. Defaults to 0 (single player). */
  humanSeat?: number
}
const cardKey = (c: Card): string => `${c.rank}-${c.suit}`
const tierOf = (label: string): string =>
  label.includes('Trail') ? 't-trail'
    : label.includes('Pure Run') ? 't-pure'
      : label.includes('Run') ? 't-run'
        : label.includes('Color') ? 't-color'
          : label.includes('Pair') ? 't-pair' : 't-high'

export function ArrangingPanel({ state, onLockIn, lockError, humanSeat = 0 }: Props) {
  const me = state.players[humanSeat]!
  const reduced = useReducedMotion()
  const [tray, setTray] = useState<Card[]>([])
  const [slots, setSlots] = useState<(Card | null)[]>(Array(9).fill(null))
  const [selected, setSelected] = useState<number | null>(null)

  const cardsKey = `${state.round}:${me.cards.map(c => `${c.rank}${c.suit}`).join(',')}:${humanSeat}`
  const cardsKeyRef = useRef('') // '' forces the first mount to initialise the tray
  useEffect(() => {
    if (cardsKeyRef.current === cardsKey) return
    cardsKeyRef.current = cardsKey
    setTray(me.cards.slice())
    setSlots(Array(9).fill(null))
    setSelected(null)
  }, [cardsKey, me.cards])

  const evalCfg = useMemo(() => ({
    aceTwoThreeRank: state.config.aceTwoThreeRank,
    allowTwoThreeFive: state.config.allowTwoThreeFive,
    enforceOrder: state.config.enforceOrder
  }), [state.config])

  const hands: (Hand | null)[] = [0, 1, 2].map(h => {
    const three = slots.slice(h * 3, h * 3 + 3)
    return three.every(Boolean) ? (three as Card[]) as unknown as Hand : null
  })
  const fullArrangement = hands.every(Boolean) ? (hands as [Hand, Hand, Hand]) : null
  const check = checkArrangement(me.cards, fullArrangement, evalCfg)
  const qualityLabels = hands.map(h => (h ? describeHand(h, evalCfg) : ''))
  const orderBroken = !check.ok && !!fullArrangement && !!check.reason && check.reason.includes('at least as strong')
  const spring = reduced ? { duration: 0.08 } : SPRINGS.snappy

  const placeCard = (card: Card, handIdx: number): void => {
    const start = handIdx * 3
    const free = [0, 1, 2].map(i => slots[start + i]).findIndex(s => s === null)
    if (free === -1) return
    setSlots(s => { const n = [...s]; n[start + free] = card; return n })
    setTray(t => { const i = t.findIndex(c => c === card); const n = [...t]; if (i >= 0) n.splice(i, 1); return n })
    playSound('deal')
  }
  const removeFromSlot = (slotIdx: number): void => {
    const card = slots[slotIdx]
    if (!card) return
    setSlots(s => { const n = [...s]; n[slotIdx] = null; return n })
    setTray(t => [...t, card])
  }
  const handleTrayClick = (idx: number): void => setSelected(sel => (sel === idx ? null : idx))
  const handleSlotClick = (handIdx: number): void => {
    if (selected === null) return
    const card = tray[selected]
    if (!card) { setSelected(null); return }
    placeCard(card, handIdx)
    setSelected(null)
  }
  const handleDrop = (e: DragEvent, handIdx: number): void => {
    e.preventDefault()
    const raw = e.dataTransfer.getData('text/plain')
    if (raw.startsWith('slot:')) {
      const slotIdx = Number(raw.slice(5))
      const c = slots[slotIdx]
      if (c) { removeFromSlot(slotIdx); placeCard(c, handIdx) }
      return
    }
    const idx = Number(raw)
    const card = Number.isFinite(idx) ? tray[idx] : undefined
    if (card) placeCard(card, handIdx)
  }
  const autoArrange = (): void => {
    const viewConfig = {
      boot: state.config.boot, salamiBonusMultiplier: state.config.salamiBonusMultiplier,
      enforceOrder: state.config.enforceOrder, aceTwoThreeRank: state.config.aceTwoThreeRank,
      allowTwoThreeFive: state.config.allowTwoThreeFive, fourOfAKindAutoWin: state.config.fourOfAKindAutoWin,
      fourPairsRedeal: state.config.fourPairsRedeal, winCondition: state.config.winCondition,
      rolloutSamples: state.config.rolloutSamples
    }
    const best = heuristicArrangement(me.cards, viewConfig)
    setTray([])
    setSlots(best.flat().slice())
    setSelected(null)
    playSound('flip')
  }
  const reset = (): void => {
    setTray(me.cards.slice()); setSlots(Array(9).fill(null)); setSelected(null)
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key >= '1' && e.key <= '3' && selected !== null) { handleSlotClick(Number(e.key) - 1); e.preventDefault() }
    else if (e.key === 'Backspace') {
      for (let i = 8; i >= 0; i--) if (slots[i]) { removeFromSlot(i); break }
    }
  }


  return (
    <section className="arrange-panel" aria-label="Arrange your nine cards" onKeyDown={onKeyDown}>
      <div className="hand-tray" role="list" aria-label="Your cards">
        <AnimatePresence mode="popLayout">
          {tray.map((c, i) => (
            <button
              key={cardKey(c)}
              className="card-btn tray-card-wrap"
              role="listitem"
              aria-pressed={selected === i}
              aria-label={`${c.rank} of ${c.suit}${selected === i ? ', selected' : ''}`}
              draggable
              onDragStart={e => e.dataTransfer.setData('text/plain', String(i))}
              onClick={() => handleTrayClick(i)}
            >
              <motion.span layout layoutId={cardKey(c)} transition={spring} style={{ display: 'block' }}>
                <CardFace card={c} />
                {selected === i && <span className="tray-glow" aria-hidden="true" />}
              </motion.span>
            </button>
          ))}
        </AnimatePresence>
        {tray.length === 0 && <p style={{ opacity: 0.6, alignSelf: 'center', margin: 0 }}>All cards placed.</p>}
      </div>

      <div className="slots-row">
        {[0, 1, 2].map(h => {
          const slice = slots.slice(h * 3, h * 3 + 3)
          const invalid = orderBroken
          const name = qualityLabels[h]
          return (
            <div
              key={h}
              className={`slot${invalid ? ' invalid' : ''}`}
              role="group"
              aria-label={`Hand ${h + 1}`}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={e => e.currentTarget.classList.remove('drag-over')}
              onDrop={e => { e.currentTarget.classList.remove('drag-over'); handleDrop(e, h) }}
              onClick={() => handleSlotClick(h)}
            >
              <div className="slot-title">HAND {h + 1} <span style={{ opacity: 0.55, fontSize: '.58rem' }}>· press {h + 1}</span></div>
              <div className="slot-body">
                {slice.map((c, i) => c ? (
                  <button
                    key={cardKey(c)}
                    className="card-btn"
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', `slot:${h * 3 + i}`)}
                    onClick={e => { e.stopPropagation(); removeFromSlot(h * 3 + i) }}
                    aria-label={`Remove ${c.rank} of ${c.suit} from Hand ${h + 1}`}
                  >
                    <motion.span layout layoutId={cardKey(c)} transition={spring} style={{ display: 'block' }}>
                      <CardFace card={c} small />
                    </motion.span>
                  </button>
                ) : <CardSlotEmpty key={i} />)}
              </div>
              <div className={`slot-name ${name ? tierOf(name) : ''}`} aria-live="polite">{name}</div>
              <div className="slot-warn">{invalid && state.config.enforceOrder ? 'Order rule broken' : ''}</div>
            </div>
          )
        })}
      </div>

      <p className={`order-warning${orderBroken ? ' show' : ''}`} role="alert">
        {orderBroken ? `⚠ ${check.reason}` : ''}
      </p>

      <div className="arrange-actions">
        <button className="btn" onClick={autoArrange}>Auto-arrange</button>
        <button className="btn" onClick={reset}>Reset</button>
        <button
          className="btn btn-gold"
          disabled={!check.ok}
          title={check.ok ? 'Lock in your arrangement' : check.reason ?? 'Arrangement incomplete'}
          onClick={() => { if (fullArrangement) { playSound('lock'); onLockIn(fullArrangement) } }}
          aria-disabled={!check.ok}
        >
          Lock In
        </button>
      </div>
      {lockError && <p className="order-warning show" role="alert">{lockError}</p>}
      <p className="arrange-hint">Tap a card, then a hand (or press 1 / 2 / 3). Drag &amp; drop works. Backspace returns the last card.</p>
    </section>
  )
}
