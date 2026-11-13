/**
 * Multiplayer over WebRTC (PeerJS). The host's browser runs the authoritative
 * engine; guests receive redacted per-seat snapshots and send actions.
 * No server, no database: the game itself needs nothing but the two browsers.
 * Public lobby listing (optional) rides on Gun's public relays — unreachable
 * relays never break the game itself.
 */
import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import { publishPublicRoom } from './lobby'
import { createGame, applyAction, type GameState, type Phase, type RoundOutcome, type PlayerState, type LogEntry } from '../engine/game'
import { buildPlayerView } from '../ai/view'
import { botArrangement, decisionRng } from '../ai/bot'
import { DEFAULT_CONFIG } from '../engine/config'
import { ChatLog, isNameTaken, sanitizeChatText, newChatId, type ChatMsg } from '../chat/chat'
import type { GameConfig } from '../engine/config'
import type { Card, Hand } from '../engine/types'

export interface RoomSettings {
  name: string
  isPublic: boolean
  startingChips: number    // integer cents — suggested buy-in for the room (display + fallback)
  boot: number             // integer cents
  winCondition: GameConfig['winCondition']
  salamiBonusMultiplier: number
  enforceOrder: boolean
  aceTwoThreeRank: 'second_highest' | 'lowest'
  allowTwoThreeFive: boolean
  fourOfAKindAutoWin: boolean
  fourPairsRedeal: boolean
  seed: number
}
export const DEFAULT_ROOM_SETTINGS: RoomSettings = { name: 'Kitti table', isPublic: false, startingChips: 2000, boot: 100, winCondition: 'any_two', salamiBonusMultiplier: 1, enforceOrder: true, aceTwoThreeRank: 'second_highest', allowTwoThreeFive: false, fourOfAKindAutoWin: false, fourPairsRedeal: false, seed: Math.floor(Math.random() * 2 ** 31) }

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const newRoomCode = (): string => {
  const b = new Uint8Array(5); crypto.getRandomValues(b)
  return Array.from(b, x => ROOM_CODE_ALPHABET[x % ROOM_CODE_ALPHABET.length]).join('')
}
/**
 * WebRTC network config. Public STUN servers find your external address;
 * the OpenRelay project's free public TURN servers relay traffic for the
 * minority of networks (symmetric NATs, locked-down office/school/carrier
 * networks) where a direct connection between two browsers is impossible.
 * Both are free, anonymous, and require no account or API key.
 */
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ],
}

const peerId = (code: string) => `kitti-room-${code.toUpperCase()}`

export interface SeatSnapshot {
  id: number; name: string; isBot: boolean; personality: PlayerState['personality']
  chips: number; lockedIn: boolean; eliminated: boolean
  cards: Card[]; arrangement: [Hand, Hand, Hand] | null
}
export interface Snapshot {
  phase: Phase; round: number; dealerIndex: number; pot: number
  kittiStreak: number; totalKittis: number; activeCount: number
  config: GameConfig; outcome: RoundOutcome | null; gameoverMessage: string | null
  log: LogEntry[]; players: SeatSnapshot[]; yourSeat: number; started: boolean; chipsInPlay: number; chat: ChatMsg[]
}

type HostMsg =
  | { t: 'state'; view: Snapshot }
  | { t: 'rejected'; message: string }
  | { t: 'hostLeft' }
  | { t: 'kicked' }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'roster'; members: RoomMember[]; botsToAdd: number }
type GuestMsg =
  | { t: 'hello'; name: string; buyIn: number }
  | { t: 'lockIn'; arrangement: [Hand, Hand, Hand] }
  | { t: 'nextRound' }
  | { t: 'leave' }
  | { t: 'ping' }
  | { t: 'rebuy'; cents: number }
  | { t: 'chat'; text: string }


/** Redacted, serializable view of the state for one viewer. Opponent cards are only visible at reveal time. */
function snapshotFor(state: GameState, viewerSeat: number, chat: ChatMsg[] = []): Snapshot {
  const revealAll = state.phase !== 'arranging'
  return {
    phase: state.phase, round: state.round, dealerIndex: state.dealerIndex, pot: state.pot,
    kittiStreak: state.kittiStreak, totalKittis: state.totalKittis, activeCount: state.activeCount,
    config: { ...state.config }, outcome: state.outcome, gameoverMessage: state.gameoverMessage,
    log: state.log.slice(-60), started: true, yourSeat: viewerSeat, chipsInPlay: state.chipsInPlay, chat: chat.slice(-60),
    players: state.players.map(p => ({
      id: p.id, name: p.name, isBot: p.isBot, personality: p.personality,
      chips: p.chips, lockedIn: p.lockedIn, eliminated: p.eliminated,
      cards: revealAll || p.id === viewerSeat ? p.cards.map(c => ({ ...c })) : [],
      arrangement: revealAll || p.id === viewerSeat ? p.arrangement : null,
    })),
  }
}
/** Local (guest-side) projection typed as GameState so the single-player UI works unchanged. */
export function snapshotToGameState(s: Snapshot): GameState {
  return {
    config: s.config, seed: 0, round: s.round, dealerIndex: s.dealerIndex, pot: s.pot,
    kittiStreak: s.kittiStreak, totalKittis: s.totalKittis,
    players: s.players.map(p => ({ ...p, cards: p.cards, arrangement: p.arrangement }) as PlayerState),
    undealt: [], phase: s.phase, outcome: s.outcome, gameoverMessage: s.gameoverMessage,
    log: s.log, activeCount: s.activeCount, chipsInPlay: s.chipsInPlay,
  }
}

export type RoomStatus = 'idle' | 'connecting' | 'lobby' | 'playing' | 'hostLeft' | 'error'
export interface RoomMember { seat: number; name: string; isBot: boolean; joined: boolean; stack: number }
export interface RosterInfo { members: RoomMember[]; botsToAdd: number }

export class RoomSession {
  readonly role: 'host' | 'guest'
  private peer: Peer | null = null
  private conns = new Map<number, DataConnection>() // host: seat -> guest conn
  private hostConn: DataConnection | null = null     // guest: connection to host
  private code = ''
  private state: GameState | null = null
  private settings: RoomSettings | null = null
  private humans = new Map<number, string>()         // host: seat -> name
  private buyIns = new Map<number, number>()         // host: seat -> buy-in cents
  private botsToAdd = 1                              // host: chosen after everyone joins
  private nextRoundReady = new Set<number>()
  private started = false
  private myName = ''
  private lobbyPing: ReturnType<typeof setInterval> | null = null
  private joinBuyIn = 2000
  private terminating = false
  private chatLog = new ChatLog()
  private chatRate = new Map<number, number>()
  onChat: (msgs: ChatMsg[]) => void = () => {}
  onStatus: (s: RoomStatus, message?: string) => void = () => {}
  onSnapshot: (s: Snapshot) => void = () => {}
  onRoster: (info: RosterInfo) => void = () => {}
  onDealFinalized: () => void = () => {}
  onToast: (message: string) => void = () => {}

  constructor(role: 'host' | 'guest', name: string) { this.role = role; this.myName = name }

  /** HOST: update my own buy-in amount (integer cents) while still in the lobby. */
  setHostBuyIn(cents: number) {
    if (this.role !== 'host') return
    const v = Math.floor(cents)
    if (!Number.isFinite(v) || v < 100 || v > 1_000_000) return
    this.buyIns.set(0, v)
    if (this.settings?.isPublic) {
      const seatsOpen = Math.max(0, 5 - this.humans.size)
      void publishPublicRoom(this.code, true, { name: this.settings.name, seatsOpen, boot: this.settings.boot, startingChips: v, winCondition: this.settings.winCondition })
    }
    this.emitRoster()
  }

  /** HOST: choose how many bots sit at the table — 0 allowed from 2+ humans. */
  setBotsToAdd(n: number) {
    if (this.role !== 'host') return
    const cap = Math.max(0, 5 - this.humans.size)
    this.botsToAdd = Math.max(0, Math.min(4, Math.min(Math.floor(n), cap)))
    this.emitRoster()
  }

  /** Send a chat line (any human; host relays for guests). Rate-limited to 1 line / 1.2 s per seat. */
  chatSend(text: string) {
    const clean = sanitizeChatText(text)
    if (!clean) return
    if (this.role === 'guest') { try { this.hostConn?.send({ t: 'chat', text: clean }) } catch { /* noop */ } return }
    const res = this.makeChatMsg(0, clean)
    if (!res.ok) { this.onToast(res.error); return }
    this.pushChat(res.msg)
  }
  private makeChatMsg(seat: number, text: string): { ok: true; msg: ChatMsg } | { ok: false; error: string } {
    const clean = sanitizeChatText(text)
    if (!clean) return { ok: false, error: 'Say something first' }
    const now = Date.now()
    if (now - (this.chatRate.get(seat) ?? 0) < 1200) return { ok: false, error: 'Slow down a touch…' }
    this.chatRate.set(seat, now)
    return { ok: true, msg: { id: newChatId(), from: this.humans.get(seat) ?? `Seat ${seat + 1}`, seat, text: clean, kind: 'user', at: now } }
  }
  private pushChat(msg: ChatMsg) {
    this.chatLog.push(msg)
    for (const [, conn] of this.conns) { try { conn.send({ t: 'chat', msg }) } catch { /* drop */ } }
    this.onChat(this.chatLog.all())
  }
  /** Guest-side: a host-relayed chat message — dedupe, sanitize, emit. */
  private ingestRelayedChat(msg: ChatMsg) {
    if (!msg || typeof msg.text !== 'string') return
    const clean: ChatMsg = { id: String(msg.id ?? newChatId()), from: sanitizeChatText(msg.from ?? 'Guest'), seat: typeof msg.seat === 'number' ? msg.seat : -1, text: sanitizeChatText(msg.text), kind: msg.kind === 'system' ? 'system' : 'user', at: typeof msg.at === 'number' ? msg.at : Date.now() }
    if (!clean.text) return
    if (this.chatLog.all().some(m => m.id === clean.id)) return
    this.onChat(this.chatLog.push(clean))
  }
  private pushSystem(text: string) {
    const msgs = this.chatLog.pushSystem('Table', text)
    const msg = msgs[msgs.length - 1]!
    for (const [, conn] of this.conns) { try { conn.send({ t: 'chat', msg }) } catch { /* drop */ } }
    this.onChat(this.chatLog.all())
  }

  /** HOST only: remove a guest from the lobby before the game starts. */
  kickPlayer(seat: number): { ok: boolean; error?: string } {
    if (this.role !== 'host') return { ok: false, error: 'Only the host can kick players' }
    if (this.started) return { ok: false, error: 'Kick is available before the game starts' }
    if (seat === 0) return { ok: false, error: 'The host cannot be kicked' }
    const conn = this.conns.get(seat)
    if (!conn) return { ok: false, error: 'That seat is already free' }
    this.pushSystem(`${this.humans.get(seat) ?? 'A player'} was kicked by the host.`)
    try { conn.send({ t: 'kicked' }) } catch { /* drop */ }
    try { conn.close() } catch { /* noop */ }
    this.conns.delete(seat)
    this.humans.delete(seat)
    this.buyIns.delete(seat)
    this.emitRoster()
    return { ok: true }
  }

  /** Any human: re-buy between hands (host applies it; guests ask the host). */
  rebuy(cents: number) {
    if (this.role === 'guest') { try { this.hostConn?.send({ t: 'rebuy', cents: Math.floor(cents) }) } catch { /* noop */ } return }
    if (!this.state) return
    const r = applyAction(this.state, { type: 'REBUY', playerId: 0, cents: Math.floor(cents) })
    if (!r.ok) { this.onToast(r.error.message); return }
    this.pushSystem(`${this.humans.get(0) ?? 'You'} re-buys for $${(Math.floor(cents) / 100).toFixed(2)}.`)
    this.state = r.value
    this.afterBotsAct()
    this.broadcastState()
  }

  /** HOST: create a room with the code and settings. Resolves once the peer is open. */
  async hostRoom(code: string, settings: RoomSettings): Promise<void> {
    this.code = code.toUpperCase(); this.settings = settings; this.humans.set(0, this.myName); this.buyIns.set(0, settings.startingChips)
    this.onStatus('connecting')
    await new Promise<void>((resolve, reject) => {
      const p = new Peer(peerId(this.code), { debug: 0, config: ICE_CONFIG })
      this.peer = p
      p.on('open', () => resolve())
      p.on('error', e => { if (!this.started) reject(e); else this.onToast('Connection problem') })
      p.on('connection', c => this.onGuestConnect(c))
    })
    if (this.settings.isPublic) {
      const meta = () => ({ name: settings.name, seatsOpen: Math.max(0, 5 - this.humans.size), boot: settings.boot, startingChips: this.buyIns.get(0) ?? settings.startingChips, winCondition: settings.winCondition })
      void publishPublicRoom(this.code, true, meta())
      // heartbeat: republish with a fresh timestamp every 10 minutes — the listing
      // only ever shows rooms whose host is still alive and announcing
      this.lobbyPing = setInterval(() => void publishPublicRoom(this.code, true, meta()), 10 * 60 * 1000)
    }
    this.onStatus('lobby')
    this.emitRoster()
  }

  private onGuestConnect(c: DataConnection) {
    let seatAssigned = -1
    c.on('data', (raw: unknown) => {
      const msg = raw as GuestMsg
      if (msg.t === 'hello') {
        const cleanName = String(msg.name ?? 'Guest').trim().slice(0, 24) || 'Guest'
        if (isNameTaken(cleanName, [...this.humans.values()])) {
          c.send({ t: 'rejected', message: `“${cleanName}” is taken at this table — pick another name.` })
          return
        }
        const seat = this.reserveSeat(cleanName)
        if (seat === -1) { c.send({ t: 'rejected', message: 'Room is full' }); return }
        const rawBuyIn = Number(msg.buyIn)
        const cleanBuyIn = Number.isFinite(rawBuyIn) ? Math.max(100, Math.min(1_000_000, Math.floor(rawBuyIn))) : this.settings?.startingChips ?? 2000
        seatAssigned = seat
        this.conns.set(seat, c)
        this.humans.set(seat, cleanName)
        this.buyIns.set(seat, cleanBuyIn)
        this.emitRoster()
        this.pushSystem(`${cleanName} joined the room.`)
        c.send({ t: 'state', view: this.gameOrLobbyView(seat) })
      } else if (seatAssigned !== -1) {
        this.handleGuestMsg(seatAssigned, msg)
      }
    })
    c.on('close', () => { if (seatAssigned !== -1) this.guestLeft(seatAssigned) })
    c.on('error', () => { if (seatAssigned !== -1) this.guestLeft(seatAssigned) })
  }
  private reserveSeat(_name: string): number {
    // host is seat 0; next free human seat in order
    if (!this.settings) return -1
    for (let s = 1; s < 5; s++) if (!this.humans.has(s)) return s
    return -1
  }
  private gameOrLobbyView(seat: number): Snapshot {
    if (this.state) return snapshotFor(this.state, seat, this.chatLog.all())
    // lobby placeholder: minimal not-started view
    const cfg = roomSettingsToConfig(this.settings!)
    return {
      phase: 'arranging', round: 1, dealerIndex: 0, pot: 0, kittiStreak: 0, totalKittis: 0,
      activeCount: 1 + this.botsToAdd, config: cfg, outcome: null, gameoverMessage: null,
      log: [{ id: 0, text: `Waiting for players in ${this.code}…` }], players: [], yourSeat: seat, started: false, chipsInPlay: 0, chat: this.chatLog.all(),
    }
  }
  private handleGuestMsg(seat: number, msg: GuestMsg) {
    if (!this.state) { // lobby: nothing to apply yet
      if (msg.t === 'leave') this.guestLeft(seat)
      else if (msg.t === 'chat') {
        const incoming = msg as unknown as { msg?: ChatMsg; text?: string }
        if (incoming.msg) this.ingestRelayedChat(incoming.msg)
        else if (incoming.text !== undefined) { const r = this.makeChatMsg(seat, incoming.text); if (r.ok) this.pushChat(r.msg) }
      }
      return
    }
    if (msg.t === 'lockIn') {
      const res = applyAction(this.state, { type: 'LOCK_IN', playerId: seat, arrangement: msg.arrangement })
      if (!res.ok) { const c = this.conns.get(seat); c?.send({ t: 'rejected', message: res.error.message }); return }
      this.state = res.value; this.afterBotsAct()
    } else if (msg.t === 'nextRound') {
      this.nextRoundReady.add(seat); void this.maybeAdvance()
    } else if (msg.t === 'chat') {
      const incoming = msg as unknown as { msg?: ChatMsg; text?: string }
      if (incoming.msg) this.ingestRelayedChat(incoming.msg)
      else if (incoming.text !== undefined) { const r = this.makeChatMsg(seat, incoming.text); if (r.ok) this.pushChat(r.msg) }
      return
    } else if (msg.t === 'rebuy') {
      if (!this.state) return
      const cents = Math.floor(Number(msg.cents) || 0)
      const res = applyAction(this.state, { type: 'REBUY', playerId: seat, cents })
      if (!res.ok) { const c = this.conns.get(seat); try { c?.send({ t: 'rejected', message: res.error.message }) } catch { /* noop */ } this.onToast(res.error.message); return }
      this.pushSystem(`${this.humans.get(seat) ?? 'A player'} re-buys for $${(cents / 100).toFixed(2)}.`)
      this.state = res.value
      this.afterBotsAct()
      this.broadcastState()
      return
    } else if (msg.t === 'leave') {
      this.guestLeft(seat)
    } else if (msg.t === 'ping') {
      this.conns.get(seat)?.send({ t: 'state', view: snapshotFor(this.state, seat, this.chatLog.all()) })
    }
  }
  private guestLeft(seat: number) {
    const name = this.humans.get(seat)
    this.conns.get(seat)?.close(); this.conns.delete(seat); this.humans.delete(seat)
    if (name) this.pushSystem(`${name} left — a bot takes their seat.`)
    this.onToast(`Seat ${seat + 1} left — a bot takes over.`)
    if (this.state) {
      const p = this.state.players[seat]
      if (p) this.state = { ...this.state, players: this.state.players.map(x => x.id === seat ? { ...x, name: `${x.name} (bot)`, isBot: true } : x) }
      this.afterBotsAct()
    } else this.emitRoster()
  }
  /** Anyone may start the game — the creator has no privileges beyond room settings. */
  async start(): Promise<boolean> {
    if (this.role !== 'host' || this.started || !this.settings) return false
    const s = this.settings
    const humanCount = this.humans.size
    const seatsLeft = Math.max(0, 5 - humanCount)
    // bots are chosen after joins; a lone human at an empty table still needs company
    const chosen = Math.min(seatsLeft, Math.max(0, this.botsToAdd))
    const bots = humanCount === 1 && chosen === 0 ? 1 : chosen
    const hostStack = this.buyIns.get(0) ?? s.startingChips
    const cfg = { ...roomSettingsToConfig(s), botCount: humanCount - 1 + bots, startingChips: hostStack }
    // per-seat stacks: humans bring their chosen buy-ins, bots match the host's
    const stacks = new Map<number, number>()
    for (let i = 0; i < humanCount; i++) stacks.set(i, this.buyIns.get(i) ?? s.startingChips)
    for (let i = humanCount; i < humanCount + bots; i++) stacks.set(i, hostStack)
    const seed = s.seed >>> 0
    const game = createGame(cfg, seed, this.myName, stacks)
    // rename seats to room members
    const playerList = game.players.map(p => {
      if (this.humans.has(p.id)) {
        // human seat: replace the generated bot persona with the joined member
        return { ...p, name: this.humans.get(p.id)!, isBot: false, personality: null }
      }
      return p
    })
    this.state = { ...game, players: playerList }
    this.started = true
    this.pushSystem('Seats are set — the game begins. Good luck!')
    this.nextRoundReady.clear()
    if (this.lobbyPing) { clearInterval(this.lobbyPing); this.lobbyPing = null }
    if (this.settings?.isPublic) void publishPublicRoom(this.code, false, null)
    this.afterBotsAct()
    return true
  }
  /** Drives bot seats and phase transitions; call after every state change. */
  private afterBotsAct() {
    if (!this.state) return
    let changed = true
    while (changed) {
      changed = false
      if (this.state.phase === 'arranging') {
        for (const p of this.state.players) {
          if (p.isBot && !p.lockedIn && !p.eliminated) {
            const view = buildPlayerView(this.state, p.id)
            const { arrangement: arr } = botArrangement(view, decisionRng(this.state.seed, this.state.round, p.id))
            const res = applyAction(this.state, { type: 'LOCK_IN', playerId: p.id, arrangement: arr })
            if (res.ok) { this.state = res.value; changed = true }
          }
        }
      }
    }
    this.broadcastState()
    this.onSnapshot(snapshotFor(this.state, 0, this.chatLog.all()))
  }
  private broadcastState() {
    if (!this.state) return
    for (const [seat, conn] of this.conns) {
      try { conn.send({ t: 'state', view: snapshotFor(this.state, seat, this.chatLog.all()) }) } catch { /* dropped peer will be reaped by its close handler */ }
    }
    this.onStatus('playing')
  }
  private async maybeAdvance() {
    if (!this.state || this.state.phase !== 'roundEnd') return
    const humansActive = this.state.players.filter(p => !p.isBot && !p.eliminated).map(p => p.id)
    const ready = humansActive.filter(id => this.nextRoundReady.has(id) || !this.humans.has(id))
    if (ready.length === humansActive.length) {
      const res = applyAction(this.state, { type: 'NEXT_ROUND' })
      if (res.ok) { this.state = res.value; this.nextRoundReady.clear(); this.afterBotsAct() }
    }
  }
  /** HOST only: force the next round immediately (overrides unready seats). */
  forceNextRound(): void {
    if (this.role !== 'host' || !this.state || this.state.phase !== 'roundEnd') return
    const res = applyAction(this.state, { type: 'NEXT_ROUND' })
    if (res.ok) { this.state = res.value; this.nextRoundReady.clear(); this.afterBotsAct() }
  }
  /** Guest: send our own NEXT_ROUND vote. Host advances when every live human voted. */
  sendNextRound() {
    if (this.role === 'guest') { this.hostConn?.send({ t: 'nextRound' }); return }
    this.nextRoundReady.add(0); void this.maybeAdvance()
  }
  /** Guest: lock in our own arrangement. Host validates against our dealt cards. */
  sendLockIn(arrangement: [Hand, Hand, Hand]): void {
    if (this.role === 'guest') { this.hostConn?.send({ t: 'lockIn', arrangement }); return }
    if (!this.state) return
    const res = applyAction(this.state, { type: 'LOCK_IN', playerId: 0, arrangement })
    if (res.ok) { this.state = res.value; this.afterBotsAct() } else this.onToast(res.error.message)
  }
  /** Guest: connect to a host's room code. */
  async join(code: string, buyIn: number = 2000): Promise<string | null> {
    this.joinBuyIn = Math.max(100, Math.floor(buyIn))
    this.code = code.toUpperCase(); this.onStatus('connecting')
    return new Promise(resolve => {
      const p = new Peer({ debug: 0, config: ICE_CONFIG })
      this.peer = p
      let settled = false
      const fail = (msg: string) => { if (settled) return; settled = true; this.onStatus('error', msg); resolve(msg) }
      p.on('open', () => {
        const c = p.connect(peerId(this.code), { reliable: true })
        this.hostConn = c
        c.on('open', () => { c.send({ t: 'hello', name: this.myName, buyIn: this.joinBuyIn }) })
        c.on('data', (raw: unknown) => {
          const msg = raw as HostMsg
          if (msg.t === 'rejected') { if (settled) { this.onToast(msg.message) } else { clearTimeout(joinedTimer); fail(msg.message) } return }
          if (msg.t === 'hostLeft') { this.onStatus('hostLeft', 'The host left the room'); resolve(null); return }
          if (msg.t === 'kicked') { this.terminating = true; this.onStatus('hostLeft', 'The host removed you from the room'); try { c.close() } catch { /* noop */ } return }
          if (msg.t === 'roster') { this.onRoster({ members: msg.members, botsToAdd: msg.botsToAdd ?? 0 }); return }
          if (msg.t === 'chat') { this.ingestRelayedChat((msg as unknown as { msg: ChatMsg }).msg); return }
          if (msg.t === 'state') {
            if (!settled) { settled = true; clearTimeout(joinedTimer); this.onStatus(msg.view.started ? 'playing' : 'lobby'); resolve(null) }
            this.onSnapshot(msg.view)
            if (msg.view.chat) this.onChat(this.chatLog.replaceWith(msg.view.chat))
          }
        })
        c.on('close', () => { if (this.terminating) return; this.onStatus('hostLeft', 'The host left the room') })
        c.on('error', () => fail('Lost connection to host'))
      })
      const brokerTimer = setTimeout(() => fail('Could not reach the room service. School/work networks often block it — try a phone hotspot.'), 12000)
      const joinedTimer = setTimeout(() => fail('The connection to the host stalled. If this network is restrictive, try a phone hotspot.'), 25000)
      p.on('open', () => { clearTimeout(brokerTimer) })
      p.on('error', (e: { type?: string; message?: string }) => {
        if (e?.type === 'peer-unavailable') fail('Room not found. It may have closed — or it is private. Ask the host for the code again.')
        else if (e?.type === 'network' || e?.type === 'server-error' || e?.type === 'socket-error' || e?.type === 'socket-closed') fail('Could not reach the room service. School/work networks often block it — try a phone hotspot.')
        else fail(e?.message ?? 'Could not reach the room')
      })
    })
  }
  /** Leave the room cleanly. Host leaving shuts the room down for everyone. */
  leave() {
    if (this.lobbyPing) { clearInterval(this.lobbyPing); this.lobbyPing = null }
    if (this.role === 'guest') { try { this.hostConn?.send({ t: 'leave' }) } catch { /* noop */ } this.hostConn?.close() }
    else {
      for (const [, c] of this.conns) { try { c.send({ t: 'hostLeft' }); c.close() } catch { /* noop */ } }
      if (this.settings?.isPublic) void publishPublicRoom(this.code, false, null)
    }
    this.peer?.destroy(); this.peer = null; this.state = null; this.humans.clear(); this.conns.clear(); this.started = false
  }
  private emitRoster() {
    const members: RoomMember[] = [...this.humans.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seat, name]) => ({ seat, name, isBot: false, joined: true, stack: this.buyIns.get(seat) ?? this.settings?.startingChips ?? 0 }))
    const info: RosterInfo = { members, botsToAdd: this.botsToAdd }
    this.onRoster(info)
    for (const [, c] of this.conns) { try { c.send({ t: 'roster', members: info.members, botsToAdd: info.botsToAdd }) } catch { /* drop */ } }
  }
  get roomCode() { return this.code }
}

function roomSettingsToConfig(s: RoomSettings): GameConfig {
  return {
    ...DEFAULT_CONFIG, botCount: 1, startingChips: s.startingChips, boot: s.boot,
    winCondition: s.winCondition, salamiBonusMultiplier: s.salamiBonusMultiplier, enforceOrder: s.enforceOrder,
    aceTwoThreeRank: s.aceTwoThreeRank, allowTwoThreeFive: s.allowTwoThreeFive,
    fourOfAKindAutoWin: s.fourOfAKindAutoWin, fourPairsRedeal: s.fourPairsRedeal,
  }
}
