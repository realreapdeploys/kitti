/**
 * Public room list over Supabase Postgres. No account, no server: anonymous auth
 * gives every browser a stable user id; RLS on the rooms table is the access control.
 * Freshness/openness is enforced by expires_at + heartbeats, so closed laptops
 * disappear from the list automatically.
 */
import { sb, ensureIdentity } from './supabase'

export interface PublicRoomRecord { code: string; name: string; hostName?: string; seatsOpen: number; startingChips: number; boot: number; winCondition: string; ts: number }
export interface PublicRoomList { rooms: PublicRoomRecord[]; relaysReached: number; totalRelays: number }

const TTL_SECONDS = 45 * 60
const nowIso = () => new Date().toISOString()
const laterIso = (secs: number) => new Date(Date.now() + secs * 1000).toISOString()

/** Publish (or refresh) this room in the public list. Call periodically while the lobby is open. */
export async function publishPublicRoom(code: string, open: boolean, meta: { name: string; hostName?: string; seatsOpen: number; startingChips: number; boot: number; winCondition: string } | null): Promise<void> {
  try {
    const hostId = await ensureIdentity()
    if (!open || !meta) {
      // room started or cancelled: drop the public listing, keep the row for the match
      await sb().from('rooms').update({ is_public: false }).eq('code', code).eq('host_id', hostId)
      return
    }
    const seatsSeated = Math.max(1, Math.min(5, 5 - meta.seatsOpen))
    await sb().from('rooms').upsert({
      code,
      host_id: hostId,
      name: meta.name.slice(0, 48),
      is_public: true,
      starting_chips: meta.startingChips,
      boot: meta.boot,
      win_condition: meta.winCondition,
      seats: seatsSeated,
      heartbeat_at: nowIso(),
      expires_at: laterIso(TTL_SECONDS),
    }, { onConflict: 'code' })
    // best-effort host_name write (column added in the 2025 schema refresh — ignore if absent)
    if (meta.hostName) {
      void sb().from('rooms').update({ host_name: meta.hostName.slice(0, 24) }).eq('code', code).eq('host_id', hostId).then(({ error }) => { void error }, () => undefined)
    }
  } catch { /* listing is best-effort — rooms still work by code */ }
}

/** Host heartbeat — keeps the listing alive (also called on lobby changes). */
export async function heartbeatPublicRoom(code: string, seatsSeated: number): Promise<void> {
  try {
    const hostId = await ensureIdentity()
    await sb().from('rooms').update({ seats: Math.max(1, Math.min(5, seatsSeated)), heartbeat_at: nowIso(), expires_at: laterIso(TTL_SECONDS) }).eq('code', code).eq('host_id', hostId)
  } catch { /* ignore */ }
}

/** Host: close the public listing for good (game over / leave). */
export async function removePublicRoom(code: string): Promise<void> {
  try {
    const hostId = await ensureIdentity()
    await sb().from('rooms').update({ is_public: false }).eq('code', code).eq('host_id', hostId)
  } catch { /* ignore */ }
}

/** Public rooms currently accepting players. */
export async function listPublicRooms(): Promise<PublicRoomList> {
  try {
    await ensureIdentity()
    let { data, error } = await sb()
      .from('rooms')
      .select('code, name, host_name, seats, starting_chips, boot, win_condition, heartbeat_at')
      .eq('is_public', true)
      .gt('expires_at', nowIso())
      .order('heartbeat_at', { ascending: false })
      .limit(50)
    if (error) {
      // column not present yet (schema not re-run): fall back to the base select
      const fallback = await sb()
        .from('rooms')
        .select('code, name, seats, starting_chips, boot, win_condition, heartbeat_at')
        .eq('is_public', true)
        .gt('expires_at', nowIso())
        .order('heartbeat_at', { ascending: false })
        .limit(50)
      data = fallback.data as typeof data
      error = fallback.error
      if (error) return { rooms: [], relaysReached: 0, totalRelays: 1 }
    }
    // housekeeping: sweep expired rooms (no server / cron required)
    void sb().from('rooms').delete().lt('expires_at', nowIso())
    const rooms = (data ?? []).map(r => ({
      code: r.code as string,
      name: r.name as string,
      seatsOpen: Math.max(0, 5 - (r.seats as number)),
      startingChips: r.starting_chips as number,
      boot: r.boot as number,
      winCondition: r.win_condition as string,
      hostName: (r as { host_name?: string }).host_name ? String((r as { host_name?: string }).host_name) : undefined,
      ts: Date.parse(r.heartbeat_at as string),
    }))
    return { rooms, relaysReached: 1, totalRelays: 1 }
  } catch {
    return { rooms: [], relaysReached: 0, totalRelays: 1 }
  }
}
