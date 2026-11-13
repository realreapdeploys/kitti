/**
 * Global lobby chat over the same free, anonymous public Nostr relay mesh used
 * by the public room listing. No account, no server. Everything is best-effort:
 * relays may flap, duplicate or drop messages; the UI degrades honestly when
 * none are reachable. All messages are public — nothing private is sent here.
 */
import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { ChatLog, isNameTaken, sanitizeChatText, type ChatMsg } from './chat'

const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net']
const CHAT_TAG = 'kitti-global-chat'
const PRES_TAG = 'kitti-presence'
const CHAT_KIND = 20_001 // ephemeral
const PRES_KIND = 20_002 // ephemeral presence claim
const HISTORY_MS = 40 * 60 * 1000
const PRESENCE_TTL_MS = 95_000
const HEARTBEAT_MS = 25_000

export interface GlobalChatStatus {
  relaysReached: number
  totalRelays: number
}
export interface PresenceClaim { pubkey: string; name: string }

export class GlobalChatClient {
  readonly key: Uint8Array
  /** The event pubkey (x-only) — this is what the relays see, not the raw secret key. */
  readonly pubkey: string
  private pool = new SimplePool()
  private sub: { close: (reason?: string) => void } | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private lastSend = 0
  private sentIds = new Set<string>()
  private name: string
  private log = new ChatLog()
  /** How many relays answered the last presence query (0-3). */
  relaysUp = 0
  onMessage: (msgs: ChatMsg[]) => void = () => {}
  onPresence: (others: string[]) => void = () => {}

  private constructor(name: string) {
    this.key = generateSecretKey()
    this.pubkey = getPublicKey(this.key)
    this.name = name
  }

  static async connect(name: string): Promise<GlobalChatClient> {
    const client = new GlobalChatClient(name)
    await client.publishPresence().catch(() => undefined)
    client.heartbeat = setInterval(() => { void client.publishPresence().catch(() => undefined); void client.refreshPresence().catch(() => undefined) }, HEARTBEAT_MS)
    // subscribe to chat history + live messages
    client.sub = client.pool.subscribeMany(RELAYS, { kinds: [CHAT_KIND], '#t': [CHAT_TAG], since: Math.floor(Date.now() / 1000) - HISTORY_MS / 1000 }, {
      onevent: ev => {
        try {
          const d = JSON.parse(ev.content) as { text?: string; from?: string }
          if (this0(d)) client.ingest(d.from!, d.text!, ev.created_at * 1000, ev.id)
        } catch { /* malformed event — ignore */ }
      },
    })
    await client.refreshPresence().catch(() => undefined)
    // relays may take a few seconds to accept the first publish — re-query twice more
    setTimeout(() => { void client.refreshPresence().catch(() => undefined) }, 2000)
    setTimeout(() => { void client.refreshPresence().catch(() => undefined) }, 5000)
    return client
  }

  private async publishPresence(): Promise<void> {
    const ev = finalizeEvent({
      kind: PRES_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', PRES_TAG]],
      content: JSON.stringify({ name: this.name, at: Date.now() }),
    }, this.key)
    await withTimeout(Promise.allSettled(this.pool.publish(RELAYS, ev)), 5000)
  }

  /** Who else is live right now? Best-effort; claims older than the TTL are ignored. */
  async refreshPresence(): Promise<string[]> {
    const filter = { kinds: [PRES_KIND], '#t': [PRES_TAG], since: Math.floor(Date.now() / 1000) - PRESENCE_TTL_MS / 1000 }
    const perRelay = RELAYS.map(r => this.pool.querySync([r], filter).catch(() => null))
    const settled = (await withTimeout(Promise.allSettled(perRelay), 7000)) ?? []
    this.relaysUp = settled.filter(r => r.status === 'fulfilled').length
    const seen = new Map<string, { name: string; at: number }>()
    for (const res of settled) {
      if (res.status !== 'fulfilled') continue
      for (const e of res.value as Array<{ pubkey: string; content: string }>) {
        try {
          const d = JSON.parse(e.content) as { name?: string; at?: number }
          if (!d.name) continue
          if (Date.now() - (d.at ?? 0) > PRESENCE_TTL_MS) continue
          const prev = seen.get(e.pubkey)
          if (!prev || (d.at ?? 0) > prev.at) seen.set(e.pubkey, { name: d.name, at: d.at ?? 0 })
        } catch { /* ignore */ }
      }
    }
    // exclude ourselves when comparing
    const others = [...seen.entries()].filter(([pk]) => pk !== this.pubkey).map(([, v]) => v.name)
    this.onPresence(others)
    return others
  }

  /** Is our chat name taken by someone else's live claim? */
  isMyNameTaken(others: string[]): boolean {
    return isNameTaken(this.name, others)
  }

  async send(text: string): Promise<boolean> {
    const clean = sanitizeChatText(text)
    if (!clean) return false
    const now = Date.now()
    if (now - this.lastSend < 1500) return false
    this.lastSend = now
    const ev = finalizeEvent({
      kind: CHAT_KIND,
      created_at: Math.floor(now / 1000),
      tags: [['t', CHAT_TAG]],
      content: JSON.stringify({ text: clean, from: this.name }),
    }, this.key)
    this.sentIds.add(ev.id)
    this.ingest(this.name, clean, now, ev.id)
    await withTimeout(Promise.allSettled(this.pool.publish(RELAYS, ev)), 5000)
    return true
  }

  private ingest(from: string, text: string, at: number, id: string) {
    const msg: ChatMsg = { id, from, seat: -1, text: sanitizeChatText(text), kind: 'user', at }
    if (!msg.text) return
    // sender echo may arrive before our optimistic insert; dedupe by id AND (from+text+~2s)
    const recent = this.log.all().slice(-4)
    if (recent.some(m => m.id === id || (m.from === msg.from && m.text === msg.text && Math.abs(m.at - msg.at) < 4000))) return
    this.onMessage(this.log.push(msg))
  }

  async disconnect(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    try { this.sub?.close('gone') } catch { /* noop */ }
    this.sub = null
    try { this.pool.close(RELAYS) } catch { /* noop */ }
  }
}

// tiny helpers kept local to avoid pulling config from nostr-tools internals
function this0(d: { text?: string; from?: string }): boolean { return Boolean(d.from && d.text) }
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))])
}
