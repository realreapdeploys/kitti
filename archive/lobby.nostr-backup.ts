/**
 * Public room lobby over Nostr's free, anonymous, public relay mesh.
 * No account, no server: any client can publish an ephemeral-signed event;
 * listings are plain kind-30000 "parameterized replaceable" events tagged
 * ["t", "kitti-public-room"] and replaceable by room code (d tag).
 * Freshness/openness is enforced client-side on read.
 */
import { SimplePool, finalizeEvent, generateSecretKey } from 'nostr-tools'

/** Keep one ephemeral key per tab session so heartbeats replace, not pile up. */

const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net']
const TAG = 'kitti-public-room'
const SUBKIND = 30000
const TTL_MS = 45 * 60 * 1000 // 45 minutes: rooms not re-announced by their host vanish

export interface PublicRoomRecord { code: string; name: string; seatsOpen: number; startingChips: number; boot: number; winCondition: string; ts: number }
export interface PublicRoomList { rooms: PublicRoomRecord[]; relaysReached: number; totalRelays: number }

let secret: Uint8Array | null = null
const key = (): Uint8Array => (secret ??= generateSecretKey())

export async function publishPublicRoom(code: string, open: boolean, meta: Omit<PublicRoomRecord, 'ts' | 'code'> | null): Promise<void> {
  try {
    const ev = finalizeEvent({
      kind: SUBKIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', TAG], ['d', code]],
      content: JSON.stringify(open && meta ? { code, ...meta, ts: Date.now(), open: true } : { code, ts: Date.now(), open: false }),
    }, key())
    const pool = new SimplePool()
    await Promise.race([Promise.allSettled(pool.publish(RELAYS, ev)), new Promise(r => setTimeout(r, 6000))])
    pool.close(RELAYS)
  } catch { /* relays unreachable — listing just won't update; rooms still work by code */ }
}

export async function listPublicRooms(): Promise<PublicRoomList> {
  const total = RELAYS.length
  try {
    const pool = new SimplePool()
    const filter = { kinds: [SUBKIND], '#t': [TAG], since: Math.floor(Date.now() / 1000) - TTL_MS / 1000 }
    // querySync resolves as soon as relays answer; track which ones did by racing per-relay
    const perRelay = RELAYS.map(relay => pool.querySync([relay], filter).catch(() => [] as never[]))
    const settled = await Promise.race([
      Promise.allSettled(perRelay),
      new Promise<PromiseSettledResult<never[]>[]>(r => setTimeout(() => r(perRelay.map(() => ({ status: 'rejected' as const, reason: 'timeout' }))), 7000)),
    ])
    const rooms = new Map<string, PublicRoomRecord & { open?: boolean; created_at?: number }>()
    let relaysReached = 0
    for (const res of settled) {
      if (res.status !== 'fulfilled') continue
      relaysReached++
      for (const e of res.value as Array<{ id: string; pubkey: string; created_at: number; content: string }>) {
        try {
          const d = JSON.parse(e.content) as Partial<PublicRoomRecord> & { open?: boolean }
          if (!d.code) continue
          const prev = rooms.get(d.code)
          if (prev && (prev.created_at ?? 0) >= e.created_at) continue
          rooms.set(d.code, { code: d.code, name: d.name ?? '', seatsOpen: d.seatsOpen ?? 2, startingChips: d.startingChips ?? 0, boot: d.boot ?? 0, winCondition: d.winCondition ?? 'any_two', ts: d.ts ?? 0, open: d.open, created_at: e.created_at })
        } catch { /* malformed content — skip */ }
      }
    }
    pool.close(RELAYS)
    return {
      rooms: [...rooms.values()].filter(r => r.open && Date.now() - (r.ts ?? 0) < TTL_MS).map(({ open: _o, created_at: _c, ...r }) => r as PublicRoomRecord).sort((a, b) => b.ts - a.ts),
      relaysReached,
      totalRelays: total,
    }
  } catch {
    return { rooms: [], relaysReached: 0, totalRelays: total }
  }
}
