/**
 * Global lobby chat + live presence over Supabase.
 * Anonymous auth gives every browser a stable id; a unique index on
 * presence.name_key enforces "one live claim per name" for real — no relay races.
 * Key facts a caller can rely on: connect() resolves even when the requested name is taken
 * (client.nameTaken tells you); send() is a no-op while the name is taken.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { sb, ensureIdentity } from '../net/supabase'
import { ChatLog, normalizeName, sanitizeChatText, suggestFreeName, type ChatMsg } from './chat'

const CHAT_LOG_MAX = 60
const FETCH_LIMIT = 60
const HISTORY_MIN_MS = 40 * 60 * 1000

export class GlobalChatClient {
  readonly userId: string
  /** The display name this client is currently claiming (may change via switchName). */
  name: string
  /** True when someone else holds a live claim on our name — send() is disabled. */
  nameTaken = false
  /** Other live players right now (name claims, fresh within 2 min). */
  others: string[] = []
  private chatLog = new ChatLog(CHAT_LOG_MAX)
  private lastSend = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private channel: RealtimeChannel | null = null
  onMessage: (msgs: ChatMsg[]) => void = () => {}
  onPresence: (others: string[]) => void = () => {}

  private constructor(userId: string, name: string) { this.userId = userId; this.name = name }

  static async connect(rawName: string): Promise<GlobalChatClient> {
    const userId = await ensureIdentity()
    const client = new GlobalChatClient(userId, sanitizeChatText(rawName).slice(0, 24) || 'Player')
    await client.sweep()
    await client.claim(client.name).catch(() => undefined)
    await client.refreshPresence().catch(() => undefined)
    // chat channel: live inserts + history
    client.channel = sb()
      .channel('global-chat')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'global_messages' }, payload => {
        const r = payload.new as { id: number; name: string; body: string; created_at: string }
        client.ingest({ id: String(r.id), from: r.name, seat: -1, text: r.body, kind: 'user', at: Date.parse(r.created_at) })
      })
      .subscribe()
    const since = new Date(Date.now() - HISTORY_MIN_MS).toISOString()
    const { data } = await sb().from('global_messages').select('id, name, body, created_at').gt('created_at', since).order('created_at', { ascending: true }).limit(FETCH_LIMIT)
    if (data?.length) { for (const r of data) client.ingest({ id: String(r.id), from: r.name, seat: -1, text: r.body, kind: 'user', at: Date.parse(r.created_at as string) }) }
    client.heartbeat = setInterval(() => { void client.heartbeatOnce() }, 25_000)
    return client
  }

  private async sweep() {
    try { await sb().from('presence').delete().lt('expires_at', new Date().toISOString()) } catch { /* best effort */ }
  }

  /** Try to claim `name`. Sets nameTaken=true when held by someone else. */
  private async claim(name: string): Promise<void> {
    const nameKey = normalizeName(name)
    await sb().from('presence').delete().eq('user_id', this.userId)
    const { error } = await sb().from('presence').insert({ user_id: this.userId, name_key: nameKey, name })
    if (!error) { this.nameTaken = false; return }
    // unique violation → someone holds it (stale rows swept above; this is a real claim)
    if (error.code === '23505') { this.nameTaken = true; return }
    throw error
  }

  async switchName(rawName: string): Promise<boolean> {
    const name = sanitizeChatText(rawName).slice(0, 24)
    if (!name) return false
    await this.sweep()
    await this.claim(name)
    this.name = name
    await this.refreshPresence().catch(() => undefined)
    return !this.nameTaken
  }

  suggestedName(): string {
    return suggestFreeName(this.name, this.others)
  }

  private async heartbeatOnce() {
    try {
      if (!this.nameTaken) {
        await sb().from('presence').update({ expires_at: new Date(Date.now() + 120_000).toISOString(), name: this.name, name_key: normalizeName(this.name) }).eq('user_id', this.userId)
      }
      await this.sweep()
      await this.refreshPresence()
    } catch { /* keep session alive silently */ }
  }

  async refreshPresence(): Promise<string[]> {
    const { data, error } = await sb().from('presence').select('name').gt('expires_at', new Date().toISOString()).neq('user_id', this.userId)
    if (error) return this.others
    this.others = (data ?? []).map(r => r.name as string)
    this.onPresence(this.others)
    return this.others
  }

  async send(rawText: string): Promise<boolean> {
    if (this.nameTaken) return false
    const body = sanitizeChatText(rawText)
    if (!body) return false
    if (Date.now() - this.lastSend < 1500) return false
    this.lastSend = Date.now()
    const { error } = await sb().from('global_messages').insert({ user_id: this.userId, name: this.name, body })
    return !error
  }

  private ingest(msg: ChatMsg) {
    const text = sanitizeChatText(msg.text)
    if (!text) return
    const clean: ChatMsg = { ...msg, text, from: sanitizeChatText(msg.from) || 'Guest' }
    const existing = this.chatLog.all()
    if (existing.some(m => m.id === clean.id)) return
    this.onMessage(this.chatLog.push(clean))
  }

  async disconnect(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    if (this.channel) { try { await sb().removeChannel(this.channel) } catch { /* noop */ } this.channel = null }
    try { await sb().from('presence').delete().eq('user_id', this.userId) } catch { /* noop */ }
  }
}
