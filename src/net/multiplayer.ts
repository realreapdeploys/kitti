/**
 * Multiplayer over Supabase Realtime. The host's browser runs the authoritative
 * engine; guests receive redacted per-seat snapshots upserted by the host into
 * room_seat_state, and send actions by inserting into room_actions. Chat rides
 * room_messages, roster rides room_participants. Anonymous auth means no account;
 * Row Level Security enforces seat ownership and host authority server-side.
 * Everything still works over HTTPS/WSS :443, so restrictive networks that block
 * WebRTC/STUN/TURN are fine. The previous PeerJS transport is archived in
 * archive/multiplayer.peerjs-backup.ts for reference.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { sb, ensureIdentity, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase'
import { publishPublicRoom } from './lobby'
import { createGame, applyAction, type GameState, type Phase, type RoundOutcome, type PlayerState, type LogEntry } from '../engine/game'
import { buildPlayerView } from '../ai/view'
import { botArrangement, decisionRng } from '../ai/bot'
import { DEFAULT_CONFIG } from '../engine/config'
import { ChatLog, normalizeName, sanitizeChatText, newChatId, type ChatMsg } from '../chat/chat'
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
const clampBuyIn = (raw: number, fallback: number) => {
  const v = Number(raw)
  if (!Number.isFinite(v)) return fallback
  return Math.max(100, Math.min(1_000_000, Math.floor(v)))
}

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

export type RoomStatus = 'idle' | 'connecting' | 'lobby' | 'playing' | 'hostLeft' | 'error'
export interface RoomMember { seat: number; name: string; isBot: boolean; joined: boolean; stack: number }
export interface RosterInfo { members: RoomMember[]; botsToAdd: number }

type Row<T> = T & Record<string, unknown>

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
/** Local projection for one guest seat, typed as GameState so the single-player UI works unchanged. */
export function snapshotToGameState(s: Snapshot): GameState {
  return {
    config: s.config, seed: 0, round: s.round, dealerIndex: s.dealerIndex, pot: s.pot,
    kittiStreak: s.kittiStreak, totalKittis: s.totalKittis,
    players: s.players.map(p => ({ ...p, cards: p.cards, arrangement: p.arrangement }) as PlayerState),
    undealt: [], phase: s.phase, outcome: s.outcome, gameoverMessage: s.gameoverMessage,
    log: s.log, activeCount: s.activeCount, chipsInPlay: s.chipsInPlay,
  }
}

const iso = (t: number) => new Date(t).toISOString()
const ROOM_TTL_MS = 45 * 60 * 1000

export class RoomSession {
  role: 'host' | 'guest'
  private channel: RealtimeChannel | null = null
  private userId: string | null = null
  private mySeat = 0
  private state: GameState | null = null
  private settings: RoomSettings | null = null
  private code = ''
  private humans = new Map<number, string>()          // seat -> display name (host: authoritative; guest: mirrored)
  private buyIns = new Map<number, number>()          // host: seat -> buy-in cents
  private botsToAdd = 1                               // host: chosen after everyone joins
  private nextRoundReady = new Set<number>()
  private myName: string
  private joinBuyIn = 2000
  private terminating = false
  private gotSnapshot = false
  private chatLog = new ChatLog()
  private chatRate = new Map<number, number>()
  private hostHeartbeat: ReturnType<typeof setInterval> | null = null
  private resnapshot: ReturnType<typeof setInterval> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private started = false
  onChat: (msgs: ChatMsg[]) => void = () => {}
  onStatus: (s: RoomStatus, message?: string) => void = () => {}
  onSnapshot: (s: Snapshot) => void = () => {}
  onRoster: (info: RosterInfo) => void = () => {}
  onDealFinalized: () => void = () => {}
  onToast: (message: string) => void = () => {}

  constructor(role: 'host' | 'guest', name: string) { this.role = role; this.myName = sanitizeChatText(name).slice(0, 24) || 'Player' }

  /** HOST: update my own buy-in amount (integer cents) while still in the lobby. */
  setHostBuyIn(cents: number) {
    if (this.role !== 'host') return
    const v = clampBuyIn(cents, this.settings?.startingChips ?? 2000)
    this.buyIns.set(0, v)
    void this.touchRoom()
    this.emitRoster()
  }

  /** HOST: choose how many bots sit at the table — 0 allowed from 2+ humans. */
  setBotsToAdd(n: number) {
    if (this.role !== 'host') return
    const cap = Math.max(0, 5 - this.humans.size)
    this.botsToAdd = Math.max(0, Math.min(4, Math.min(Math.floor(n), cap)))
    this.emitRoster()
  }

  /** Send a chat line. Guests insert straight into the room's chat table; no host relay needed.
   *  The sender's line is echoed immediately (dimmed) — replaced with the server row on ack. */
  chatSend(text: string) {
    const clean = sanitizeChatText(text)
    if (!clean) return
    const now = Date.now()
    const seat = this.role === 'host' ? 0 : this.mySeat
    if (now - (this.chatRate.get(seat) ?? 0) < 1200) { this.onToast('Slow down a touch…'); return }
    this.chatRate.set(seat, now)
    // optimistic echo — instant feel for the sender; the 1.2 s rate limit still applies
    const tempId = 'tmp-' + newChatId()
    const temp: ChatMsg = { id: tempId, from: this.myName, seat, text: clean, kind: 'user', at: now, pending: true }
    this.onChat(this.chatLog.push(temp))
    void (async () => {
      const { data, error } = await sb().from('room_messages')
        .insert({ room_code: this.code, from_seat: seat, name: this.myName, body: clean, kind: 'user' })
        .select('id, created_at')
        .single()
      if (error || !data) {
        this.chatRate.delete(seat)
        this.dropPending(tempId)
        this.onToast('Could not send — try again')
        return
      }
      this.finalizePending(tempId, String((data as { id: number }).id))
    })()
  }

  private dropPending(tempId: string) {
    this.chatLog.replaceWith(this.chatLog.all().filter(m => m.id !== tempId))
    this.onChat(this.chatLog.all())
  }

  /** Swap the dimmed optimistic line for the canonical server row (echo may arrive before or after). */
  private finalizePending(tempId: string, realId: string) {
    const all = this.chatLog.all()
    const temp = all.find(m => m.id === tempId)
    const from = temp?.from ?? this.myName
    const seat = temp?.seat ?? (this.role === 'host' ? 0 : this.mySeat)
    const text = temp?.text ?? ''
    const at = temp?.at ?? Date.now()
    const kind = temp?.kind ?? 'user'
    if (!text) return this.dropPending(tempId)
    const next = all.filter(m => m.id !== tempId && m.id !== realId)
    next.push({ id: realId, from, seat, text, kind, at, pending: false })
    next.sort((a, b) => a.at - b.at)
    this.chatLog.replaceWith(next)
    this.onChat(this.chatLog.all())
  }

  private ingestChatRow(row: Row<{ id: number; from_seat: number; name: string; body: string; kind: string; created_at: string }>) {
    const clean: ChatMsg = {
      id: String(row.id),
      from: sanitizeChatText(String(row.name ?? 'Guest')) || 'Guest',
      seat: typeof row.from_seat === 'number' ? row.from_seat : -1,
      text: sanitizeChatText(String(row.body ?? '')),
      kind: row.kind === 'system' ? 'system' : 'user',
      at: Date.parse(String(row.created_at)) || Date.now(),
    }
    if (!clean.text) return
    if (this.chatLog.all().some(m => m.id === clean.id)) return
    this.onChat(this.chatLog.push(clean))
  }

  private async pushSystem(text: string) {
    if (this.role !== 'host') return
    const clean = sanitizeChatText(text)
    if (!clean) return
    const tempId = 'tmp-' + newChatId()
    const tmp: ChatMsg = { id: tempId, from: 'Table', seat: -1, text: clean, kind: 'system', at: Date.now(), pending: true }
    this.onChat(this.chatLog.push(tmp))
    try {
      const { data, error } = await sb().from('room_messages')
        .insert({ room_code: this.code, from_seat: -1, name: 'Table', body: clean, kind: 'system' })
        .select('id')
        .single()
      if (error || !data) { console.log('[kitti] pushSystem insert failed', error ? JSON.stringify(error) : 'no-data'); this.onToast('Could not post a table update') } else { console.log('[kitti] pushSystem ok'); this.finalizePending(tempId, String((data as { id: number }).id)) }
    } catch {
      this.onToast('Could not post a table update')
    }
  }

  /** HOST only: remove a guest from the lobby before the game starts. */
  kickPlayer(seat: number): { ok: boolean; error?: string } {
    if (this.role !== 'host') return { ok: false, error: 'Only the host can kick players' }
    if (this.started) return { ok: false, error: 'Kick is available before the game starts' }
    if (seat === 0) return { ok: false, error: 'The host cannot be kicked' }
    if (!this.humans.has(seat)) return { ok: false, error: 'That seat is already free' }
    const name = this.humans.get(seat)!
    void (async () => {
      await this.pushSystem(`${name} was kicked by the host.`)
      await sb().from('room_participants').update({ kicked: true }).eq('room_code', this.code).eq('seat', seat)
      await new Promise(r => setTimeout(r, 400))
      await sb().from('room_participants').delete().eq('room_code', this.code).eq('seat', seat)
      this.humans.delete(seat); this.buyIns.delete(seat)
      this.emitRoster()
      void this.touchRoom()
    })()
    return { ok: true }
  }

  /** Any human: re-buy between hands (host applies it; guests ask the host). */
  rebuy(cents: number) {
    const v = Math.floor(cents)
    if (this.role === 'guest') { void this.sendAction('rebuy', { cents: v }); return }
    if (!this.state) return
    const r = applyAction(this.state, { type: 'REBUY', playerId: this.mySeat, cents: v })
    if (!r.ok) { this.onToast(r.error.message); return }
    void this.pushSystem(`${this.humans.get(0) ?? 'You'} re-buys for $${(v / 100).toFixed(2)}.`)
    this.state = r.value
    this.afterBotsAct()
  }

  // ---------------------------------------------------------------- host: room lifecycle

  /** HOST: create a room with the code and settings. */
  async hostRoom(code: string, settings: RoomSettings): Promise<void> {
    this.code = code.toUpperCase(); this.settings = settings; this.humans.set(0, this.myName); this.buyIns.set(0, settings.startingChips)
    this.onStatus('connecting')
    this.userId = await ensureIdentity()
    const now = Date.now()
    const { error } = await sb().from('rooms').upsert({
      code: this.code, host_id: this.userId, name: settings.name.slice(0, 48),
      is_public: settings.isPublic, starting_chips: settings.startingChips, boot: settings.boot,
      win_condition: settings.winCondition, status: 'open', seats: 1,
      heartbeat_at: iso(now), expires_at: iso(now + ROOM_TTL_MS),
    }, { onConflict: 'code' })
    void sb().from('rooms').update({ host_name: this.myName.slice(0, 24) }).eq('code', this.code).eq('host_id', this.userId).then(({ error }) => { void error }, () => undefined)
    if (error) { this.onStatus('error', 'Could not create the room — ' + error.message); throw new Error(error.message) }
    const { error: seatErr } = await sb().from('room_participants').upsert({ room_code: this.code, seat: 0, user_id: this.userId, name: this.myName, buy_in: settings.startingChips }, { onConflict: 'room_code,seat' })
    if (seatErr) { this.onStatus('error', 'Could not seat you — ' + seatErr.message); throw new Error(seatErr.message) }
    this.subscribeRoom(this.code)
    this.startHeartbeat()
    void publishPublicRoom(this.code, settings.isPublic, { name: settings.name, hostName: this.myName, seatsOpen: Math.max(0, 5 - this.humans.size), boot: settings.boot, startingChips: settings.startingChips, winCondition: settings.winCondition })
    this.onStatus('lobby')
    this.emitRoster()
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.hostHeartbeat = setInterval(() => void this.touchRoom(), 20_000)
  }
  private stopHeartbeat() { if (this.hostHeartbeat) clearInterval(this.hostHeartbeat); this.hostHeartbeat = null }
  private touchRoom() {
    const now = Date.now()
    const uid = this.userId ?? ''
    console.log('[kitti] heartbeat write attempt', uid.slice(0, 8), this.code, 'humans=', this.humans.size)
    void sb().from('rooms').update({ heartbeat_at: iso(now), expires_at: iso(now + ROOM_TTL_MS), seats: Math.max(1, this.humans.size) }).eq('code', this.code).eq('host_id', uid)
      .then(({ error, count }) => console.log('[kitti] heartbeat result', error ? JSON.stringify(error) : `ok count=${count ?? '?'}`), () => undefined)
  }

  // ---------------------------------------------------------------- channel (both roles)

  private subscribeRoom(code: string) {
    const ch = sb().channel(`room:${code}`, { config: { presence: { key: this.userId ?? 'anon' } } })
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_actions', filter: `room_code=eq.${code}` }, payload => void this.onActionRow(payload.new as Row<{ id: number; seat: number; type: string; payload: Record<string, unknown>; created_at: string }>))
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_code=eq.${code}` }, payload => this.ingestChatRow(payload.new as never))
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_code=eq.${code}` }, payload => void this.onParticipantRow(payload))
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'room_seat_state', filter: `room_code=eq.${code}` }, payload => void this.onSeatStateRow(payload))
    ch.on('presence', { event: 'sync' }, () => this.onPresenceSync(ch))
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        void ch.track({ seat: this.role === 'host' ? 0 : this.mySeat, name: this.myName, role: this.role, at: Date.now() })
        void this.refetchRoomState()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.onToast('Connection problem — retrying…')
      }
    })
    this.channel = ch
    this.resnapshot = setInterval(() => void this.refetchRoomState(), 15_000)
    this.watchStart = Date.now()
    this.lastHostSeen = this.role === 'guest' ? 0 : Date.now()
    if (this.presenceWatch) clearInterval(this.presenceWatch)
    this.presenceWatch = setInterval(() => this.checkPresence(), 10_000)
    if (!this.unloadRegistered) {
      this.unloadRegistered = true
      window.addEventListener('pagehide', this.unloadSignal, { once: true })
      window.addEventListener('beforeunload', this.unloadSignal, { once: true })
    }
    if (this.retrack) clearInterval(this.retrack)
    this.retrack = setInterval(() => {
      void ch.track({ seat: this.role === 'host' ? 0 : this.mySeat, name: this.myName, role: this.role, at: Date.now() })
    }, 20_000)
  }

  /** Re-pull everything authoritative — used on (re)subscribe and every 30 s. */
  private async refetchRoomState() {
    if (this.terminating || !this.code) return
    try {
      const { data: parts } = await sb().from('room_participants').select('seat, name, buy_in, user_id, kicked').eq('room_code', this.code).order('seat')
      this.applyParticipantRows(parts ?? [])
      const { data: msgs } = await sb().from('room_messages').select('id, from_seat, name, body, kind, created_at').eq('room_code', this.code).order('created_at', { ascending: true }).limit(100)
      for (const m of msgs ?? []) this.ingestChatRow(m as never)
      if (this.role === 'guest') {
        const { data: seatRow } = await sb().from('room_seat_state').select('snapshot').eq('room_code', this.code).eq('seat', this.mySeat).maybeSingle()
        if (seatRow?.snapshot) this.acceptSnapshot(seatRow.snapshot as Snapshot)
      }
    } catch { /* keep trying on next tick */ }
  }

  private applyParticipantRows(rows: Array<{ seat: number; name: string; buy_in: number; user_id: string; kicked: boolean }>) {
    if (this.role === 'guest') {
      const own = rows.find(r => r.user_id === this.userId)
      // our own seat row is gone => the room was wiped (host left) — get out immediately
      if (!own && !this.terminating) {
        this.terminating = true
        this.onStatus('hostLeft', 'The host left the room')
        void this.cleanupChannel()
        return
      }
      if (own?.kicked && !this.terminating) { this.handleKicked(); return }
      this.humans = new Map(rows.filter(r => !r.kicked).map(r => [r.seat, r.name]))
      this.emitRoster()
      if (!this.humans.has(0) && !this.promoting && !this.terminating) void this.tryPromoteHost()
      return
    }
    const prev = new Map(this.humans)
    for (const r of rows) {
      if (r.seat === 0) { this.humans.set(0, this.myName); continue }
      if (r.kicked) { this.humans.delete(r.seat); this.buyIns.delete(r.seat); continue }
      this.humans.set(r.seat, r.name)
      if (!this.buyIns.has(r.seat)) this.buyIns.set(r.seat, r.buy_in)
    }
    for (const [seat] of prev) if (seat !== 0 && !this.humans.has(seat)) { /* DELETE event handles removal when live */ }
    this.emitRoster()
  }

  private onParticipantRow(payload: { eventType?: string; new?: unknown; old?: unknown }) {
    const ev = payload.eventType
    const row = (payload.new ?? payload.old) as { seat?: number; name?: string; buy_in?: number; user_id?: string; kicked?: boolean } | undefined
    if (!row || typeof row.seat !== 'number') return
    const seat = row.seat

    if (this.role === 'guest') {
      // DELETE payloads from a cascaded room wipe carry only (room_code, seat) under the
      // default replica identity — never user_id — so match our own row by SEAT.
      const rowKicked = (row as { kicked?: boolean }).kicked === true
      if (ev === 'DELETE' && seat === this.mySeat && !this.terminating) {
        this.terminating = true
        this.onStatus('hostLeft', 'The host left the room')
        void this.cleanupChannel()
        return
      }
      if (ev === 'UPDATE' && rowKicked && seat === this.mySeat && !this.terminating) { this.handleKicked(); return }
      if (ev === 'DELETE') { void this.refetchRoomState(); return }
      void this.refetchRoomState()
      return
    }
    // host
    if (seat === 0) return
    if (ev === 'INSERT' && row.user_id !== this.userId && !row.kicked) {
      this.humans.set(seat, row.name ?? `Seat ${seat + 1}`)
      this.buyIns.set(seat, row.buy_in ?? this.settings?.startingChips ?? 2000)
      void this.pushSystem(`${row.name ?? 'Someone'} joined the room.`)
      this.emitRoster()
      void this.touchRoom()
      return
    }
    if (ev === 'UPDATE' && row.kicked) { this.humans.delete(seat); this.buyIns.delete(seat); this.emitRoster(); void this.touchRoom(); return }
    if (ev === 'DELETE' && this.humans.has(seat)) this.guestLeft(seat)
  }

  private onSeatStateRow(payload: { eventType?: string; new?: unknown }) {
    if (this.role !== 'guest') return
    const row = payload.new as { seat?: number; snapshot?: Snapshot } | undefined
    if (row?.seat === this.mySeat && row?.snapshot) this.acceptSnapshot(row.snapshot)
  }

  private acceptSnapshot(view: Snapshot) {
    if (this.terminating) return
    const first = !this.gotSnapshot
    this.gotSnapshot = true
    if (first && this.watchdog) { clearTimeout(this.watchdog); this.watchdog = null }
    this.onStatus(view.started ? 'playing' : 'lobby')
    this.onSnapshot(view)
    if (view.chat) this.ingestList(view.chat)
  }

  // Presence watchdog (tab-close / crash detection — there is no DELETE event for hard closes):
  // a seat absent from presence for >150 s is removed; a guest seeing the host absent >60 s leaves cleanly.
  // 150 s because phones park their sockets when screens sleep — a short timeout kicks present players.
  private presenceWatch: ReturnType<typeof setInterval> | null = null
  private retrack: ReturnType<typeof setInterval> | null = null
  private unloadRegistered = false
  private watchStart = 0
  private lastPresenceSeen = new Map<number, number>()
  private lastHostSeen = 0

  private notePresence(state: Record<string, Array<{ role?: string; seat?: number }>>) {
    const now = Date.now()
    const everyone = Object.values(state).flat()
    const host = everyone.find(m => m.role === 'host')
    if (host) this.lastHostSeen = now
    const presentSeats = new Set<number>(everyone.filter(m => m.role === 'guest' && typeof m.seat === 'number').map(m => m.seat as number))
    for (const seat of presentSeats) this.lastPresenceSeen.set(seat, now)
  }

  private lastResync = 0
  private onPresenceSync(ch: RealtimeChannel) {
    const state = ch.presenceState() as Record<string, Array<{ role?: string; seat?: number }>>
    this.notePresence(state)
    // resync soon after any presence change (joined/left fast-path for host-loss)
    if (Date.now() - this.lastResync > 3000) {
      this.lastResync = Date.now()
      void this.refetchRoomState()
    }
  }

  private hbCheckAt = 0
  private async checkServerHeartbeat() {
    const now = Date.now()
    if (now - this.hbCheckAt < 30_000 || this.role !== 'guest' || this.terminating) return
    this.hbCheckAt = now
    try {
      const { data } = await sb().from('rooms').select('heartbeat_at').eq('code', this.code).maybeSingle()
      if (data?.heartbeat_at && Date.now() - new Date(data.heartbeat_at).getTime() > 45_000) {
        if (Date.now() - (this.promoteAttemptAt || 0) > 20_000) {
          this.promoteAttemptAt = Date.now()
          void this.tryPromoteHost()
        }
      }
    } catch { /* price of doing business — presence path remains as backstop */ }
  }

  private promoteAttemptAt = 0
  private checkPresence() {
    if (this.terminating || !this.code) return
    void this.checkServerHeartbeat()
    const now = Date.now()
    if (this.role === 'guest') {
      if (this.lastHostSeen === 0) {
        if (now - this.watchStart > 60_000) { /* joined before presence tracked — leave if host never appears */ }
        else return
      }
      if (now - this.lastHostSeen <= 45_000) return
      if (now - (this.promoteAttemptAt || 0) > 20_000) {
        this.promoteAttemptAt = now
        void this.tryPromoteHost()
      }
      if (now - this.lastHostSeen > 150_000) {
        // promotion unavailable (e.g. schema/RPC missing) — final fallback: eviction
        this.terminating = true
        this.onStatus('hostLeft', 'The host left the room')
        void (async () => {
          try { await sb().from('room_participants').delete().eq('room_code', this.code).eq('user_id', this.userId ?? '') } catch { /* noop */ }
          await this.cleanupChannel()
        })()
      }
      return
    }
    // host
    for (const [seat, name] of [...this.humans]) {
      if (seat === 0) continue
      const seen = this.lastPresenceSeen.get(seat)
      if (seen && now - seen <= 150_000) continue
      if (!seen && now - this.watchStart < 150_000) continue // grace for just-joined seats
      void (async () => {
        try {
          const { error } = await sb().from('room_participants').delete().eq('room_code', this.code).eq('seat', seat)
          if (error) { this.onToast(`Could not remove ${name} — ${error.message}`); return }
          this.guestLeft(seat) // backstop in case the realtime DELETE event is missed
        } catch (e) {
          this.onToast(`Could not remove ${name} — ${String(e)}`)
        }
      })()
      this.lastPresenceSeen.delete(seat)
    }
  }

  /** Unload-time fast path: the closing tab fires pagehide/beforeunload — fire a keepalive REST
   *  DELETE before it dies. Guests delete their seat row (the host then sees the DELETE and
   *  auto-locks them in); the host wipes the room row (guests resync and flip home within seconds). */
  private unloadSignal = () => {
    if (this.terminating || !this.code || !this.userId) return
    let token: string | null = null
    try {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
        const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as { access_token?: string; currentSession?: { access_token?: string } }
        token = raw.access_token ?? raw.currentSession?.access_token ?? null
        if (token) break
      }
    } catch { token = null }
    if (!token) return
    const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    const url = this.role === 'host'
      ? `${SUPABASE_URL}/rest/v1/room_participants?room_code=eq.${this.code}&seat=eq.0`
      : `${SUPABASE_URL}/rest/v1/room_participants?room_code=eq.${this.code}&user_id=eq.${this.userId}`
    try { void fetch(url, { method: 'DELETE', headers, keepalive: true }) } catch { /* best effort */ }
  }

  private handleKicked() {
    this.terminating = true
    this.onStatus('hostLeft', 'The host removed you from the room')
    void this.cleanupChannel()
  }
  private async cleanupChannel() {
    this.stopHeartbeat()
    if (this.resnapshot) clearInterval(this.resnapshot); this.resnapshot = null
    if (this.presenceWatch) clearInterval(this.presenceWatch); this.presenceWatch = null
    if (this.retrack) clearInterval(this.retrack); this.retrack = null
    if (this.channel) { try { await sb().removeChannel(this.channel) } catch { /* noop */ } this.channel = null }
  }

  /** Union merged chat list — nothing already shown is ever removed. */
  private ingestList(list: ChatMsg[]) {
    for (const m of list) this.chatLog.push(m)
    this.onChat(this.chatLog.all())
  }

  // ---------------------------------------------------------------- actions (guest -> host)

  private async sendAction(type: string, payload: Record<string, unknown>): Promise<boolean> {
    if (this.role !== 'guest' || !this.code || this.terminating) return false
    const { error } = await sb().from('room_actions').insert({ room_code: this.code, seat: this.mySeat, type, payload })
    if (error) { this.onToast('Could not reach the host — check your connection'); return false }
    return true
  }

  private async onActionRow(row: Row<{ id: number; seat: number; type: string; payload: Record<string, unknown> }>) {
    if (this.role !== 'host') return
    try {
      const seat = row.seat
      if (seat !== 0 && !this.humans.has(seat)) return // stale seat
      if (row.type === 'lock_in') {
        if (!this.state) return
        const arrangement = (row.payload as { arrangement?: [Hand, Hand, Hand] }).arrangement
        if (!arrangement) return
        const res = applyAction(this.state, { type: 'LOCK_IN', playerId: seat, arrangement })
        if (!res.ok) { void this.pushSystem(`Seat ${seat + 1}’s lock-in was rejected: ${res.error.message}`); return }
        this.state = res.value; this.afterBotsAct()
      } else if (row.type === 'next_round') {
        this.nextRoundReady.add(seat); void this.maybeAdvance()
      } else if (row.type === 'rebuy') {
        if (!this.state) return
        const cents = Math.floor(Number((row.payload as { cents?: number }).cents) || 0)
        const res = applyAction(this.state, { type: 'REBUY', playerId: seat, cents })
        if (!res.ok) { void this.pushSystem(`Re-buy rejected: ${res.error.message}`); this.onToast(`Seat ${seat + 1}: ${res.error.message}`); return }
        void this.pushSystem(`${this.humans.get(seat) ?? 'A player'} re-buys for $${(cents / 100).toFixed(2)}.`)
        this.state = res.value
        this.afterBotsAct()
      } else if (row.type === 'ping') {
        if (this.state) await this.writeSeatSnapshot(seat)
      } else if (row.type === 'leave') {
        this.guestLeft(seat)
      }
    } finally {
      void sb().from('room_actions').delete().eq('id', row.id)
    }
  }

  private async writeSeatSnapshot(seat: number) {
    if (!this.state) return
    const snapshot = snapshotFor(this.state, seat, this.chatLog.all())
    await sb().from('room_seat_state').upsert({ room_code: this.code, seat, snapshot, updated_at: iso(Date.now()) }, { onConflict: 'room_code,seat' })
  }

  private async broadcastState() {
    if (!this.state) return
    this.onStatus('playing')
    void this.syncRoomState()
    for (const [seat] of this.humans) {
      if (seat !== 0 && this.state.players[seat]) await this.writeSeatSnapshot(seat)
    }
  }
  private leftSeats = new Map<number, string>()
  private viewSeat = 0
  private promoting = false

  /** Leave handling (host-authoritative):
   *  - lock-in for them automatically if the round is mid-arranging
   *  - remove them for good once the round resolves — never replace with a bot */
  private leftHandled = new Set<number>()

  /** Persist the full engine state — required for the next seated player to adopt host duties. */
  private async syncRoomState() {
    if (this.role !== 'host' || !this.state || !this.code) return
    try {
      await sb().from('room_state').upsert({
        room_code: this.code,
        state: this.state as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'room_code' })
    } catch { /* table unavailable until the schema re-run — migration simply disabled */ }
  }

  /** Guest watch noticed the seat-0 host row missing. Exactly one caller wins the RPC; others stay guests. */
  private async tryPromoteHost() {
    if (this.promoting || this.terminating || this.role !== 'guest') return
    this.promoting = true
    console.log('[kitti] tryPromoteHost called', this.code)
    try {
      const { data, error } = await sb().rpc('promote_next_host', { p_code: this.code })
      console.log('[kitti] rpc result', JSON.stringify(data), error ? JSON.stringify(error) : 'no-error')
      if (error || !data) return // room gone, or race lost — the resync loop will settle it
      if (String(data) !== String(this.userId)) return // someone else was promoted
      await this.promoteToHost()
    } catch (e) {
      console.log('[kitti] promote exception', String(e))
      /* retry on the next resync */
    } finally {
      this.promoting = false
    }
  }

  /** Adopt host duties after promotion: load the full state and keep dealing. */
  private async promoteToHost() {
    console.log('[kitti] promoteToHost: fetching room_state')
    try {
      const { data, error } = await sb().from('room_state').select('state').eq('room_code', this.code).maybeSingle()
      console.log('[kitti] room_state response', data?.state ? 'state-present' : 'no-state', error ? JSON.stringify(error) : 'no-error')
      if (data?.state) this.state = data.state as unknown as GameState
    } catch (e) { console.log('[kitti] room_state exception', String(e)) /* fall through — newer snapshots may already have delivered the state */ }
    if (!this.state) {
      console.log('[kitti] promote failed — no state, evicting to home')
      this.terminating = true
      // delete the husk room ourselves (we are the recorded host now) so nobody waits on a corpse
      try { await this.leave() } catch { /* falls through to home */ }
      this.onStatus('hostLeft', 'The host left and the match could not be recovered — returning home')
      return
    }
    this.role = 'host'
    this.viewSeat = this.mySeat
    console.log('[kitti] promotion applied, role now host, viewSeat', this.mySeat)
    // the departed host counts as a leaver (same flow: open hand auto-arranged, removed after the round)
    this.leftSeats.set(0, 'The host')
    this.humans.delete(0)
    this.buyIns.delete(0)
    console.log('[kitti] posting takeover system line')
    void this.pushSystem(`The host left the table — ${this.myName} takes over.`).then(() => console.log('[kitti] takeover line settled'))
    this.started = true
    // a promoted host must refresh the heartbeat or OTHERS' watchdogs will evict THIS host as "dead"
    this.startHeartbeat()
    void this.touchRoom()
    this.afterBotsAct()
  }

  private guestLeft(seat: number) {
    if (this.leftHandled.has(seat)) return
    this.leftHandled.add(seat)
    const name = this.humans.get(seat)
    this.humans.delete(seat); this.buyIns.delete(seat)
    if (name) void this.pushSystem(`${name} left the table.`)
    this.onToast(`Seat ${seat + 1} left — will be removed after the round.`)
    this.leftSeats.set(seat, name ?? `Seat ${seat + 1}`)
    if (!this.state) { this.emitRoster(); void this.touchRoom(); return }
    this.settleLeftSeats()
    this.afterBotsAct()
    void this.touchRoom()
  }

  private settleLeftSeats() {
    if (!this.state || this.leftSeats.size === 0) return
    if (this.state.phase === 'arranging') {
      // mid-round: auto arrange + lock in their open hand so the round can finish
      for (const seat of [...this.leftSeats.keys()]) {
        const p = this.state.players[seat]
        if (p && !p.lockedIn && !p.eliminated) {
          try {
            const view = buildPlayerView(this.state, seat)
            const { arrangement } = botArrangement(view, decisionRng(this.state.seed, this.state.round, seat))
            const res = applyAction(this.state, { type: 'LOCK_IN', playerId: seat, arrangement })
            if (res.ok) this.state = res.value
          } catch { /* leave them; after round ends elimination removes them */ }
        }
      }
      return // post-round elimination happens when phase leaves 'arranging'
    }
    let removed = false
    const names: string[] = []
    const players = this.state.players.map(p => ({ ...p }))
    for (const [seat, name] of [...this.leftSeats]) {
      const p = players[seat]
      if (p && !p.eliminated) { p.eliminated = true; removed = true; names.push(name) }
      this.leftSeats.delete(seat)
    }
    if (removed) this.state = { ...this.state, players }
    if (names.length) void this.pushSystem(`${names.join(', ')} ${names.length === 1 ? 'was' : 'were'} removed from the table.`)
  }

  /** Anyone may start the game — the creator has no privileges beyond room settings. */
  async start(): Promise<boolean> {
    if (this.role !== 'host' || this.started || !this.settings || !this.userId) return false
    const s = this.settings
    const humanCount = this.humans.size
    const seatsLeft = Math.max(0, 5 - humanCount)
    const chosen = Math.min(seatsLeft, Math.max(0, this.botsToAdd))
    const bots = humanCount === 1 && chosen === 0 ? 1 : chosen
    const hostStack = this.buyIns.get(0) ?? s.startingChips
    const cfg = { ...roomSettingsToConfig(s), botCount: humanCount - 1 + bots, startingChips: hostStack }
    const stacks = new Map<number, number>()
    for (let i = 0; i < humanCount; i++) stacks.set(i, this.buyIns.get(i) ?? s.startingChips)
    for (let i = humanCount; i < humanCount + bots; i++) stacks.set(i, hostStack)
    const game = createGame(cfg, s.seed >>> 0, this.myName, stacks)
    const playerList = game.players.map(p => {
      if (this.humans.has(p.id)) return { ...p, name: this.humans.get(p.id)!, isBot: false, personality: null }
      return p
    })
    this.state = { ...game, players: playerList }
    this.started = true
    void this.pushSystem('Seats are set — the game begins. Good luck!')
    this.nextRoundReady.clear()
    void sb().from('rooms').update({ is_public: false, status: 'in_game' }).eq('code', this.code).eq('host_id', this.userId)
    this.afterBotsAct()
    return true
  }

  /** Drives bot seats and phase transitions; call after every state change. */
  private afterBotsAct() {
    if (!this.state) return
    this.settleLeftSeats()
    let changed = true
    let guard = 0
    while (changed) {
      changed = false
      guard += 1; if (guard > 200) break
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
    void this.broadcastState()
    this.onSnapshot(snapshotFor(this.state, this.viewSeat, this.chatLog.all()))
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
  /** Any human: send our own NEXT_ROUND vote. Host advances when every live human voted. */
  sendNextRound() {
    if (this.role === 'guest') { void this.sendAction('next_round', {}); return }
    this.nextRoundReady.add(0); void this.maybeAdvance()
  }
  /** Guest: lock in our own arrangement. Host validates against our dealt cards. */
  sendLockIn(arrangement: [Hand, Hand, Hand]): void {
    if (this.role === 'guest') { void this.sendAction('lock_in', { arrangement }); return }
    if (!this.state) return
    const res = applyAction(this.state, { type: 'LOCK_IN', playerId: this.mySeat, arrangement })
    if (res.ok) { this.state = res.value; this.afterBotsAct() } else this.onToast(res.error.message)
  }

  // ---------------------------------------------------------------- guest: join & leave

  /** Guest: join a room by code. Returns an error message, or null on success. */
  async join(code: string, buyIn: number = 2000): Promise<string | null> {
    this.joinBuyIn = clampBuyIn(buyIn, 2000)
    this.code = code.toUpperCase(); this.onStatus('connecting')
    this.userId = await ensureIdentity()
    const { data: room, error } = await sb().from('rooms').select('code, host_id, status, expires_at').eq('code', this.code).maybeSingle()
    if (error || !room) return this.fail('Room not found. It may have closed — or it is private. Ask the host for the code again.')
    if (Date.parse(String(room.expires_at)) < Date.now()) return this.fail('That room expired — ask the host to open a new one.')

    const { data: existing } = await sb().from('room_participants').select('seat, kicked').eq('room_code', this.code).eq('user_id', this.userId).maybeSingle()
    if (existing?.kicked) return this.fail('The host removed you from the room')

    if (existing) {
      // retake our seat — rejoin whether the room is lobby or already playing
      this.mySeat = existing.seat
      this.subscribeRoom(this.code)
      this.watchdog = setTimeout(() => this.fail('Could not reach the room. Try a phone hotspot if this network is restrictive.'), 25_000)
      void this.sendAction('ping', {})
      return null
    }
    if (room.status === 'in_game') return this.fail('A game is already in progress in that room.')

    // lobby: check name availability, then grab the first free seat 1..4
    const { data: others } = await sb().from('room_participants').select('name').eq('room_code', this.code)
    const taken = new Set((others ?? []).map(r => normalizeName(String(r.name ?? ''))))
    if (taken.has(normalizeName(this.myName))) return this.fail(`“${this.myName}” is taken at this table — pick another name.`)

    for (let seat = 1; seat <= 4; seat++) {
      const { error: seatErr } = await sb().from('room_participants').insert({ room_code: this.code, seat, user_id: this.userId, name: this.myName, buy_in: this.joinBuyIn })
      if (!seatErr) {
        this.mySeat = seat
        this.subscribeRoom(this.code)
        this.watchdog = setTimeout(() => this.fail('Could not reach the room. Try a phone hotspot if this network is restrictive.'), 25_000)
        void this.sendAction('ping', {})
        return null
      }
      if (seatErr.code !== '23505') return this.fail('Could not join the room — ' + seatErr.message)
    }
    return this.fail('Room is full')
  }
  private fail(msg: string): string { this.onStatus('error', msg); return msg }

  /** Leave the room cleanly. Host leaving shuts the room down for everyone. */
  leave() {
    void (async () => {
      if (this.resnapshot) clearInterval(this.resnapshot); this.resnapshot = null
      if (this.presenceWatch) clearInterval(this.presenceWatch); this.presenceWatch = null
    if (this.retrack) clearInterval(this.retrack); this.retrack = null
      if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = null
      if (this.role === 'guest') {
        // removing our row is the leave signal — the host applies bot takeover on the DELETE
        try { await sb().from('room_participants').delete().eq('room_code', this.code).eq('user_id', this.userId ?? '') } catch { /* noop */ }
      } else {
        // wiping the rooms row cascades to participants/snapshots/actions/messages — every guest sees the close
        try { await sb().from('rooms').delete().eq('code', this.code).eq('host_id', this.userId ?? '') } catch { /* noop */ }
      }
      this.terminating = true
      await this.cleanupChannel()
      this.state = null; this.humans.clear(); this.buyIns.clear(); this.started = false
    })()
  }

  private emitRoster() {
    const members: RoomMember[] = [...this.humans.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seat, name]) => ({ seat, name, isBot: false, joined: true, stack: this.buyIns.get(seat) ?? this.settings?.startingChips ?? 0 }))
    this.onRoster({ members, botsToAdd: this.role === 'host' ? this.botsToAdd : 0 })
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
