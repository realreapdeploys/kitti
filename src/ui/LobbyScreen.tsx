import { useEffect, useState } from 'react'
import { DEFAULT_ROOM_SETTINGS, RoomSettings, RoomSession, newRoomCode, type RosterInfo } from '../net/multiplayer'
import { listPublicRooms, type PublicRoomList, type PublicRoomRecord } from '../net/lobby'
import { dollarsToChips, formatChips } from './money'
import { RoomChat } from './RoomChat'
import { GlobalChatPanel } from './GlobalChatPanel'
import type { ChatMsg } from '../chat/chat'

interface LobbyProps {
  onBack: () => void
  /** called with an active session plus latest snapshot whenever one arrives */
  onJoined: (session: RoomSession) => void
  /** shared live chat feed from the app (room-phase messages flow before the game starts) */
  chat?: ChatMsg[]
}

export type LobbyView = 'menu' | 'hosting' | 'joining' | 'room'

export function LobbyScreen({ onBack, onJoined, chat: chatProp }: LobbyProps) {
  const [view, setView] = useState<LobbyView>('menu')
  const [name, setName] = useState(() => { try { return localStorage.getItem('kitti-name') ?? '' } catch { return '' } })
  const [settings, setSettings] = useState<RoomSettings>({ ...DEFAULT_ROOM_SETTINGS })
  const [code, setCode] = useState('')
  const [session, setSession] = useState<RoomSession | null>(null)
  const [roster, setRoster] = useState<RosterInfo>({ members: [], botsToAdd: 1 })
  const [joinBuyIn, setJoinBuyIn] = useState('20')
  const [publicRooms, setPublicRooms] = useState<PublicRoomRecord[]>([])
  const [lobbyStatus, setLobbyStatus] = useState<PublicRoomList | null>(null)
  const [ignoredRooms, setIgnoredRooms] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('kitti-ignored-rooms') ?? '[]') as string[]) } catch { return new Set() }
  })
  const ignoreRoom = (code: string) => setIgnoredRooms(prev => { const n = new Set(prev).add(code); try { localStorage.setItem('kitti-ignored-rooms', JSON.stringify([...n])) } catch { /* ignore */ } return n })
  const [loadingPublic, setLoadingPublic] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [armedKick, setArmedKick] = useState<number | null>(null)
  const [localChat, setLocalChat] = useState<ChatMsg[]>([])
  const chat = chatProp ?? localChat

  const saveName = (n: string) => { setName(n); try { localStorage.setItem('kitti-name', n) } catch { /* ignore */ } }
  const playerName = () => (name.trim() || 'You').slice(0, 24)

  const refreshPublic = async () => {
    setLoadingPublic(true)
    try { const res = await listPublicRooms(); setPublicRooms(res.rooms); setLobbyStatus(res) } finally { setLoadingPublic(false) }
  }
  // auto-load on first view of the lobby — the ↻ button is for refreshing
  useEffect(() => { void refreshPublic() }, [])
  useEffect(() => {
    if (armedKick === null) return
    const t = setTimeout(() => setArmedKick(null), 3000)
    return () => clearTimeout(t)
  }, [armedKick])

  const create = () => {
    if (starting) return
    setStarting(true)
    const roomCode = newRoomCode()
    const s = new RoomSession('host', playerName())
    s.onRoster = setRoster
    s.onChat = chatProp ? () => undefined : setLocalChat
    s.onToast = m => setError(m)
    s.onStatus = (st, msg) => { if (st === 'error') { setError(msg ?? 'Something went wrong'); setStarting(false) } }
    s.hostRoom(roomCode, { ...settings, name: settings.name.trim() || 'Kitti table' })
      .then(() => { setSession(s); setView('room'); setStarting(false); onJoined(s) })
      .catch(e => { setError(e instanceof Error ? e.message : 'Could not open the room (is the network reachable?)'); setStarting(false) })
  }

  const join = (joinCode: string) => {
    const cleaned = joinCode.trim().toUpperCase()
    const buyIn = dollarsToChips(Number(joinBuyIn) || 20)
    if (cleaned.length < 5) { setError('Enter the 5-character room code'); return }
    setStarting(true); setError(null)
    const s = new RoomSession('guest', playerName())
    s.onRoster = setRoster
    s.onChat = chatProp ? () => undefined : setLocalChat
    s.onToast = m => setError(m)
    s.onStatus = (st, msg) => {
      if (st === 'hostLeft') {
        setError(msg ?? 'The host left the room')
        setSession(null)
        setRoster({ members: [], botsToAdd: 1 })
        setView('menu')
      } else if (st === 'error') setStarting(false)
    }
    s.join(cleaned, buyIn).then(err => {
      setStarting(false)
      if (err) { if (/room not found/i.test(err)) ignoreRoom(cleaned); setError(err); return }
      setSession(s); setView('room'); onJoined(s)
    })
  }

  const kick = (seat: number) => {
    if (armedKick !== seat) { setArmedKick(seat); return }
    setArmedKick(null)
    const res = session?.kickPlayer(seat)
    if (res && !res.ok) setError(res.error ?? 'Could not kick that player')
  }

  const start = () => { session?.start() }
  const leave = () => { session?.leave(); setSession(null); setRoster({ members: [], botsToAdd: 1 }); setLocalChat([]); setView('menu') }

  if (view === 'room' && session) {
    return (
      <section className="lobby-room" aria-label="Room lobby">
        <div className="lobby-card">
          <h2>{settings.name || 'Kitti table'}</h2>
          <div className="room-code-row">Room code <output className="room-code" aria-label="Room code">{session.roomCode}</output></div>
          <ul className="room-roster" aria-label="Players in room">
            {roster.members.map(m => (
              <li key={m.seat}>
                <span className="room-member">{m.name}{m.seat === 0 && <span className="room-you"> (host)</span>}<span className="public-meta"> {formatChips(m.stack)}</span></span>
                {session?.role === 'host' && m.seat !== 0 && (
                  <button className={`icon-btn kick-btn${armedKick === m.seat ? ' kick-btn-armed' : ''}`} onClick={() => kick(m.seat)} aria-label={armedKick === m.seat ? `Confirm kick of ${m.name}` : `Kick ${m.name} from the room`}>{armedKick === m.seat ? 'Sure?' : 'Kick'}</button>
                )}
              </li>
            ))}
          </ul>
          <div className="bot-stepper" role="group" aria-label="Bots joining the table">
            <span className="lobby-rules-label">Bots at start</span>
            {session.role === 'host' ? (<>
              <button className="icon-btn" onClick={() => session.setBotsToAdd(roster.botsToAdd - 1)} disabled={roster.botsToAdd <= 0} aria-label="Fewer bots">−</button>
              <output aria-live="polite">{roster.botsToAdd}</output>
              <button className="icon-btn" onClick={() => session.setBotsToAdd(roster.botsToAdd + 1)} disabled={roster.botsToAdd >= Math.max(0, 5 - roster.members.length)} aria-label="More bots">+</button>
            </>) : <output aria-live="polite">{roster.botsToAdd}</output>}
          </div>
          <p className="room-note">Players bring their own buy-ins. Bots enter with the host’s stack. A lone host gets at least one bot. <strong>0 bots</strong> is fine when the table seats 2+ humans.</p>
          <RoomChat messages={chat} onSend={t => session.chatSend(t)} title="Table chat" />
          <div className="room-actions">
            <button className="btn" onClick={leave}>Leave</button>
            <button className="btn btn-gold" onClick={start}>Start game</button>
          </div>
          {error && <p role="alert" className="tab-error">{error}</p>}
        </div>
      </section>
    )
  }

  return (
    <section className="lobby" aria-label="Multiplayer rooms">
      <div className="lobby-grid">
        <div className="lobby-card">
          <h2>Host a table</h2>
          <label className="lobby-label">Your name
            <input value={name} onChange={e => saveName(e.target.value)} placeholder="You" maxLength={24} aria-label="Your name" />
          </label>
          <label className="lobby-label">Room name
            <input value={settings.name} onChange={e => setSettings(s => ({ ...s, name: e.target.value }))} maxLength={48} aria-label="Room name" />
          </label>
          <div className="lobby-row" role="radiogroup" aria-label="Room visibility">
            <button className={`seg ${!settings.isPublic ? 'seg-active' : ''}`} role="radio" aria-checked={!settings.isPublic} onClick={() => setSettings(s => ({ ...s, isPublic: false }))}>Private</button>
            <button className={`seg ${settings.isPublic ? 'seg-active' : ''}`} role="radio" aria-checked={settings.isPublic} onClick={() => setSettings(s => ({ ...s, isPublic: true }))}>Public</button>
          </div>
          <div className="lobby-row">
            <label className="lobby-label">Your buy-in ($)
              <input type="number" min={1} step="0.5" value={settings.startingChips / 100} onChange={e => setSettings(s => ({ ...s, startingChips: Math.max(100, dollarsToChips(Number(e.target.value) || 20)) }))} aria-label="Your buy-in in dollars" />
            </label>
            <label className="lobby-label">Boot ($)
              <input type="number" min={0.5} step="0.5" value={settings.boot / 100} onChange={e => setSettings(s => ({ ...s, boot: Math.max(50, dollarsToChips(Number(e.target.value) || 1)) }))} aria-label="Boot in dollars" />
            </label>
          </div>
          <fieldset className="lobby-rules">
            <legend>House rules</legend>
            <div className="lobby-row">
              <span className="lobby-rules-label" id="wincond-label">Win condition</span>
              <div className="win-seg" role="group" aria-labelledby="wincond-label">
                <button className={settings.winCondition === 'any_two' ? 'seg-active btn-seg' : 'btn-seg'} onClick={() => setSettings(s => ({ ...s, winCondition: 'any_two' }))}>Any 2 of 3</button>
                <button className={settings.winCondition === 'consecutive_two' ? 'seg-active btn-seg' : 'btn-seg'} onClick={() => setSettings(s => ({ ...s, winCondition: 'consecutive_two' }))}>2 consecutive</button>
              </div>
            </div>
            <div className="lobby-row">
              <label className="lobby-label">Salami bonus (× boot)
                <input type="number" min={0} step={1} value={settings.salamiBonusMultiplier} onChange={e => setSettings(s => ({ ...s, salamiBonusMultiplier: Math.max(0, Number(e.target.value) || 0) }))} aria-label="Salami bonus multiplier" />
              </label>
              <label className="lobby-label">A-2-3 run order
                <select value={settings.aceTwoThreeRank} onChange={e => setSettings(s => ({ ...s, aceTwoThreeRank: e.target.value as 'second_highest' | 'lowest' }))} aria-label="A-2-3 run order">
                  <option value="second_highest">Second highest</option>
                  <option value="lowest">Lowest run</option>
                </select>
              </label>
            </div>
            <label className="field toggle"><input type="checkbox" checked={settings.enforceOrder} onChange={e => setSettings(s => ({ ...s, enforceOrder: e.target.checked }))} /> Enforce hand order</label>
            <label className="field toggle"><input type="checkbox" checked={settings.allowTwoThreeFive} onChange={e => setSettings(s => ({ ...s, allowTwoThreeFive: e.target.checked }))} /> 2-3-5 beats all</label>
            <label className="field toggle"><input type="checkbox" checked={settings.fourOfAKindAutoWin} onChange={e => setSettings(s => ({ ...s, fourOfAKindAutoWin: e.target.checked }))} /> Four of a kind auto-wins</label>
            <label className="field toggle"><input type="checkbox" checked={settings.fourPairsRedeal} onChange={e => setSettings(s => ({ ...s, fourPairsRedeal: e.target.checked }))} /> Four pairs forces redeal</label>
          </fieldset>
          <p className="room-note" style={{ marginTop: 4 }}>Tip: rooms are <strong>Private by default</strong> — choose “Public” above and everyone browsing the lobby can join.</p>
          <button className="btn btn-gold btn-big" disabled={starting} onClick={create}>{starting ? 'Opening room…' : 'Create room'}</button>
        </div>

        <div className="lobby-card">
          <h2>Join a table</h2>
          <div className="lobby-row join-row">
            <input className="room-code-input" value={code} onChange={e => setCode(e.target.value.toUpperCase().slice(0, 5))} placeholder="ABCDE" aria-label="Room code" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
            <label className="lobby-label join-buyin">Buy-in ($)
              <input type="number" min={1} step="0.5" value={joinBuyIn} onChange={e => setJoinBuyIn(e.target.value)} aria-label="Your buy-in in dollars" />
            </label>
            <button className="btn" disabled={starting || code.trim().length < 5} onClick={() => join(code)}>Join</button>
          </div>
          <h3 className="lobby-subhead">Public rooms <button className="icon-btn" onClick={refreshPublic} aria-label="Refresh public rooms" title="Refresh">↻</button></h3>
          {lobbyStatus && <p className="room-note lobby-relays" aria-live="polite">{lobbyStatus.rooms.length} open · via Supabase{lobbyStatus.relaysReached === 0 ? ' (not reachable right now)' : ''}</p>}
          {loadingPublic && <p className="room-note">Looking for open tables…</p>}
          {!loadingPublic && publicRooms.length === 0 && lobbyStatus?.relaysReached === 0 && <p role="alert" className="tab-error">Supabase isn’t reachable from this network right now — use a room code instead (that always works).</p>}
          {!loadingPublic && publicRooms.length === 0 && (lobbyStatus?.relaysReached ?? 1) > 0 && <p className="room-note">No open public rooms right now. <strong>Private is the default</strong> — when you host, flip the switch to “Public” above to appear here.</p>}
          <ul className="public-rooms">
            {publicRooms.filter(r => !ignoredRooms.has(r.code)).map(r => (
              <li key={r.code}>
                <span>{r.name}{r.hostName ? <em className="public-host"> · host {r.hostName}</em> : null}</span>
                <span className="public-meta">{r.seatsOpen} open · stack {formatChips(r.startingChips)} · boot {formatChips(r.boot)} · {Math.max(1, Math.round((Date.now() - r.ts) / 60000))}m ago</span>
                <button className="btn" onClick={() => join(r.code)}>Join {r.code}</button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="tab-error">{error}</p>}
        </div>
      </div>
      <GlobalChatPanel />
      <button className="btn lobby-back" onClick={onBack}>← Back</button>
    </section>
  )
}

