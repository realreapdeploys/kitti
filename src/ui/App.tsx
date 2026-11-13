import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, GameConfig } from '../engine/config'
import { GameState, applyAction, createGame } from '../engine/game'
import { Hand } from '../engine/types'
import { buildPlayerView } from '../ai/view'
import { botArrangement, decisionRng } from '../ai/bot'
import { SetupScreen, SetupValues } from './SetupScreen'
import { TableView } from './TableView'
import { ArrangingPanel } from './ArrangingPanel'
import { RevealPanel } from './RevealPanel'
import { RulesModal } from './RulesModal'
import { GameLog } from './GameLog'
import { LobbyScreen } from './LobbyScreen'
import { RoomSession, snapshotToGameState, type Snapshot } from '../net/multiplayer'
import { RoomChat } from './RoomChat'
import type { ChatMsg } from '../chat/chat'
import { formatChips, dollarsToChips } from './money'
import { ThemeProvider, useTheme } from './theme/useTheme'
import { MotionConfigProvider } from './motion/MotionConfig'
import { isSoundOn, setSound, playSound } from './sound'

const randomSeed = (): number => Math.floor(Math.random() * 2 ** 31)
/** Union two chat feeds by message id, newest last (60 max). Snapshot + live delivery both feed this. */
const mergeChatLogs = (a: ChatMsg[], b: ChatMsg[]): ChatMsg[] => {
  const byId = new Map<string, ChatMsg>()
  for (const m of a) byId.set(m.id, m)
  for (const m of b) byId.set(m.id, m)
  return [...byId.values()].sort((x, y) => x.at - y.at).slice(-60)
}

function TopBar({ inGame, onRules, onLeave, onMultiplayer, inLobby }: { inGame: boolean; onRules: () => void; onLeave: () => void; onMultiplayer: () => void; inLobby: boolean }) {
  const { theme, toggleTheme } = useTheme()
  const [sound, setSoundState] = useState(isSoundOn())
  const [fourColor, setFourColor] = useState(() => { try { return localStorage.getItem('kitti-four-color') === 'on' } catch { return false } })

  return (
    <header className="topbar">
      <div>
        <h1>KITTI</h1>
        <div className="sub">Nau Patti · Nine Card Brag</div>
      </div>
      <div className="topbar-actions">
        <button className="icon-btn" title={fourColor ? 'Four-color deck: on' : 'Four-color deck: off'} aria-pressed={fourColor}
          aria-label="Toggle four-color deck"
          onClick={() => { setFourColor(v => { const n = !v; try { localStorage.setItem('kitti-four-color', n ? 'on' : 'off') } catch { /* ignore */ } return n }) }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="7.5" cy="12" r="4.4" fill="#1f2733" /><circle cx="12" cy="12" r="4.4" fill="#a61b1b" fillOpacity="0.85" /><circle cx="16.5" cy="12" r="4.4" fill="#0f5fc0" fillOpacity="0.85" />
          </svg>
        </button>
        <button className="icon-btn" title={sound ? 'Sound on' : 'Sound off'} aria-pressed={sound} aria-label="Toggle sound"
          onClick={() => { const n = !sound; setSound(n); setSoundState(n); if (n) playSound('button') }}>
          {sound
            ? <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l6 5V4L8 9H4z" /><path d="M16.5 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /><path d="M19 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 9v6h4l6 5V4L8 9H4z" /><path d="M17 9.5 L22 14.5 M22 9.5 L17 14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>}
        </button>
        <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'evening' ? 'Switch to Daylight theme' : 'Switch to Evening theme'} title="Switch theme">
          {theme === 'evening'
            ? <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="currentColor" /><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4 4l2 2M18 18l2 2M20 4l-2 2M6 18l-2 2" /></g></svg>
            : <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z" /></svg>}
        </button>
        <button className="btn" onClick={onRules}>Rules</button>
        {!inGame && !inLobby && <button className="btn" onClick={onMultiplayer}>Multiplayer</button>}
        {inGame && <button className="btn btn-leave" onClick={onLeave}>Leave table</button>}
      </div>
    </header>
  )
}

function Game() {
  const [state, setState] = useState<GameState | null>(null)
  const [seed, setSeed] = useState<number>(0)
  const [showRules, setShowRules] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [homeNote, setHomeNote] = useState<string | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const [screen, setScreen] = useState<'home' | 'lobby'>('home')
  const [roundSecondsLeft, setRoundSecondsLeft] = useState<number | null>(null)
  const [mpSession, setMpSession] = useState<RoomSession | null>(null)
  const [mpChatLive, setMpChatLive] = useState<ChatMsg[]>([])
  const [mpSnap, setMpSnap] = useState<Snapshot | null>(null)
  const [rebuyOpen, setRebuyOpen] = useState(false)
  const [rebuyCustom, setRebuyCustom] = useState('10')
  const initialStacks = useRef<Map<number, number> | null>(null)
  const [showChat, setShowChat] = useState(false)
  const chatSeen = useRef(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const humanSeat = mpSnap?.yourSeat ?? 0
  const mpState: GameState | null = mpSnap && mpSnap.started ? snapshotToGameState(mpSnap) : null
  const activeState = mpState ?? state
  const roundRef = activeState?.phase === 'roundEnd' ? activeState.round : null

  const startGame = useCallback((values: SetupValues) => {
    const parsed = values.seed.trim() ? Number(values.seed.trim()) : randomSeed()
    const useSeed = Number.isFinite(parsed) ? Math.abs(Math.floor(parsed as number)) : randomSeed()
    const cfg: GameConfig = { ...DEFAULT_CONFIG, ...values }
    delete (cfg as Partial<SetupValues>).seed
    cfg.startingChips = dollarsToChips(values.startingChips)
    cfg.boot = dollarsToChips(values.boot)
    setSeed(useSeed)
    setLockError(null)
    const game = createGame(cfg, useSeed)
    initialStacks.current = new Map(game.players.map(p => [p.id, p.chips + cfg.boot]))
    setState(game)
  }, [])

  // Bots lock in on their own, after a randomized thinking delay (UI-only).
  useEffect(() => {
    if (!state || state.phase !== 'arranging') return
    if (mpSession) return // in rooms, the host's engine drives bots
    const pending = state.players.filter(p => p.isBot && !p.eliminated && !p.lockedIn)
    if (pending.length === 0) return
    const timers = pending.map(bot => {
      const [lo, hi] = state.config.botThinkMs
      const delay = lo + Math.random() * Math.max(0, hi - lo)
      return setTimeout(() => {
        const cur = stateRef.current
        if (!cur || cur.phase !== 'arranging') return
        const me = cur.players.find(p => p.id === bot.id)
        if (!me || me.lockedIn || me.eliminated) return
        const view = buildPlayerView(cur, bot.id)
        const rng = decisionRng(cur.seed, cur.round, bot.id)
        const { arrangement } = botArrangement(view, rng)
        setState(prev => {
          if (!prev) return prev
          const res = applyAction(prev, { type: 'LOCK_IN', playerId: bot.id, arrangement })
          return res.ok ? res.value : prev
        })
      }, delay)
    })
    return () => timers.forEach(clearTimeout)
  }, [state, mpSession])

  const humanLockIn = (arrangement: [Hand, Hand, Hand]) => {
    if (mpSession) { mpSession.sendLockIn(arrangement); setLockError(null); return }
    if (!state) return
    const res = applyAction(state, { type: 'LOCK_IN', playerId: 0, arrangement })
    if (res.ok) { setLockError(null); setState(res.value) } else setLockError(res.error.message)
  }
  const handleRebuy = (cents: number) => {
    setRebuyOpen(false)
    if (mpSession) { mpSession.rebuy(cents); return }
    if (!state) return
    const res = applyAction(state, { type: 'REBUY', playerId: 0, cents })
    if (res.ok) setState(res.value)
  }

  const nextRound = () => {
    if (mpSession) { if (mpSession.role === 'host') mpSession.forceNextRound(); else mpSession.sendNextRound(); return }
    if (!state) return
    const res = applyAction(state, { type: 'NEXT_ROUND' })
    if (res.ok) { setLockError(null); setState(res.value) }
  }
  // Auto-advance the reveal after 20s in every game; the host may force it sooner.
  const nextRoundRef = useRef(nextRound)
  nextRoundRef.current = nextRound
  useEffect(() => {
    if (roundRef === null) { setRoundSecondsLeft(null); return }
    const endAt = Date.now() + 20000
    const tick = () => {
      const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      setRoundSecondsLeft(left)
      if (left === 0) { window.clearInterval(iv); nextRoundRef.current() }
    }
    const iv = window.setInterval(tick, 500)
    tick()
    return () => window.clearInterval(iv)
  }, [roundRef])

  const teardownMp = (note?: string) => {
    setMpSession(null); setMpSnap(null); setMpChatLive([])
    initialStacks.current = null
    setState(null); setShowLeave(false); setScreen('home')
    if (note) setHomeNote(note)
  }
  const confirmLeave = () => {
    if (mpSession) mpSession.leave()
    teardownMp()
  }
  const attachSession = (s: RoomSession) => {
    setMpSession(s); setMpSnap(null); chatSeen.current = 0; setShowChat(false); setMpChatLive([])
    s.onSnapshot = snap => setMpSnap(snap)
    // live room-chat delivery — the overlay must work without waiting for engine actions
    s.onChat = msgs => setMpChatLive(msgs)
    // host-side room closure: flip straight back to home (otherwise the guest window is stuck on the table)
    s.onStatus = (st, msg) => { if (st === 'hostLeft') teardownMp(msg ?? 'The host left the room') }
  }

  const mpChat: ChatMsg[] = mergeChatLogs(mpChatLive, mpSnap?.chat ?? [])
  useEffect(() => { if (showChat) chatSeen.current = mpChat.length }, [showChat, mpChat.length])
  const unreadChat = Math.max(0, mpChat.length - (showChat ? mpChat.length : chatSeen.current))
  // First MP snapshot of a fresh table: record each seat's opening stack (chips + boot).
  useEffect(() => {
    if (!mpSnap?.started || initialStacks.current) return
    initialStacks.current = new Map(mpSnap.players.map(p => [p.id, p.chips + mpSnap.config.boot]))
  }, [mpSnap])

  const activeSeed = mpSession ? 'room' : seed

  return (
    <div className="app">
      <TopBar inGame={!!activeState} onRules={() => setShowRules(true)} onLeave={() => setShowLeave(true)} onMultiplayer={() => setScreen('lobby')} inLobby={screen === 'lobby'} />

      {screen === 'lobby' && !mpState && (
        <LobbyScreen onBack={() => setScreen('home')} onJoined={attachSession} chat={mpChat} />
      )}

      {screen !== 'lobby' && !activeState && <SetupScreen onStart={startGame} />}
      {homeNote && !activeState && screen === 'home' && (
        <p className="home-note" role="status"><span>{homeNote}</span><button className="icon-btn" aria-label="Dismiss" onClick={() => setHomeNote(null)}>×</button></p>
      )}

      {activeState && activeState.phase === 'gameover' && (
        <div className="gameover-wrap">
          <div className="gameover-card">
            <h2 style={{ color: 'var(--gold)', letterSpacing: '.25em', fontFamily: 'var(--font-display)' }}>GAME OVER</h2>
            <p>{activeState.gameoverMessage}</p>
            <p style={{ opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>Final stacks — You: {formatChips(activeState.players[humanSeat]!.chips)} · {activeState.players.filter(p => p.id !== humanSeat).map(p => `${p.name}: ${formatChips(p.chips)}`).join(' · ')}</p>
            <button className="btn btn-gold btn-cta" onClick={confirmLeave}>Back to home</button>
          </div>
        </div>
      )}

      {activeState && activeState.phase !== 'gameover' && (
        <main className="table-area">
          <TableView state={activeState} humanSeat={humanSeat} />
          {mpSession && (
            <>
              <button className={`chat-fab${showChat ? ' chat-fab-open' : ''}`} onClick={() => setShowChat(v => !v)} aria-expanded={showChat} aria-label="Toggle table chat">
                {showChat ? 'Close chat' : 'Chat'}{!showChat && unreadChat > 0 && <span className="chat-badge">{unreadChat}</span>}
              </button>
              {showChat && (
                <div className="chat-overlay">
                  <RoomChat compact messages={mpChat} onSend={t => mpSession.chatSend(t)} title="Table chat" />
                </div>
              )}
            </>
          )}
          {activeState.phase === 'roundEnd' && (() => {
            const me = activeState.players[humanSeat]
            if (!me || (!me.eliminated && me.chips > 0)) return null
            return <button className="rebuy-fab" onClick={() => setRebuyOpen(true)}>Add buy-in</button>
          })()}
          <div className="layout">
            <div>
              {activeState.phase === 'arranging' && (
                activeState.players[humanSeat]!.lockedIn
                  ? <section className="arrange-panel" aria-label="Waiting"><p style={{ textAlign: 'center', margin: 0 }}>Locked in. Waiting for the other players…</p></section>
                  : <ArrangingPanel state={activeState} onLockIn={humanLockIn} lockError={lockError} humanSeat={humanSeat} />
              )}
              {activeState.phase === 'roundEnd' && (
                <RevealPanel state={activeState} onNext={nextRound} humanSeat={humanSeat}
                  countdownSeconds={roundSecondsLeft}
                  nextLabel={mpSession ? (mpSession.role === 'host' ? 'Start next round' : 'Next round') : 'Next round'}
                  note={mpSession ? (mpSession.role === 'host' ? 'Start immediately — missing players are simply carried.' : 'The host can start early; auto-start otherwise.') : undefined}
                />
              )}
            </div>
            <GameLog entries={activeState.log} />
          </div>
        </main>
      )}

      <footer className="seedbar">
        <span>{mpSession ? 'Online room' : <>Seed: <code>{activeSeed || '—'}</code></>}</span>
        <span>Round {activeState?.round ?? 0} · Kittis: {activeState?.totalKittis ?? 0}</span>
        <span>52-card deck · Fisher–Yates shuffle</span>
      </footer>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {rebuyOpen && (
        <div className="rules-backdrop" role="dialog" aria-modal="true" aria-label="Add buy-in" onClick={() => setRebuyOpen(false)}>
          <div className="rules-modal leave-dialog" onClick={e => e.stopPropagation()}>
            <h2>Add buy-in</h2>
            <p>You are out of chips. Pick an amount to re-enter — it lands in your stack before the next hand.</p>
            <div className="room-actions">
              {[500, 1000, 2000].map(c => <button key={c} className="btn" onClick={() => handleRebuy(c)}>${(c / 100).toFixed(2)}</button>)}
            </div>
            <div className="lobby-row" style={{ marginTop: 12 }}>
              <label className="lobby-label">Custom ($)
                <input type="number" min={1} step="0.5" value={rebuyCustom} onChange={e => setRebuyCustom(e.target.value)} aria-label="Custom buy-in in dollars" />
              </label>
              <button className="btn btn-gold" onClick={() => { const v = dollarsToChips(Number(rebuyCustom) || 0); if (v >= 100) handleRebuy(v) }}>Add</button>
            </div>
            <div className="room-actions" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setRebuyOpen(false)}>Not now</button>
            </div>
          </div>
        </div>
      )}
      {showLeave && (
        <div className="rules-backdrop" role="dialog" aria-modal="true" aria-label="Leave the table?" onClick={() => setShowLeave(false)}>
          <div className="rules-modal leave-dialog" onClick={e => e.stopPropagation()}>
            <h2>Leave the table?</h2>
            <p>{mpSession
              ? (mpSession.role === 'host'
                  ? 'You created this room — leaving closes it for everyone.'
                  : 'Your open hand is auto-arranged and locked in, and you are removed right after the round resolves — no bot ever plays in your place.')
              : 'The bots will keep their seats. This match ends here.'}</p>
            <div className="room-actions">
              <button className="btn" onClick={() => setShowLeave(false)}>Stay</button>
              {mpSession && (mpSession.role === 'host'
                ? <button className="btn btn-danger" onClick={confirmLeave}>Leave — close room</button>
                : <button className="btn btn-gold" onClick={confirmLeave}>Leave — finish round, then leave</button>)}
              {!mpSession && <button className="btn btn-danger" onClick={confirmLeave}>Leave table</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfigProvider>
        <Game />
      </MotionConfigProvider>
    </ThemeProvider>
  )
}
