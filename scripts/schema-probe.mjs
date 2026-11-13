/* Verify the two new schema features: host_name round-trip + empty-room GC trigger. */
import { createClient } from '@supabase/supabase-js'
const URL = 'https://rzbujszafrvvuzghcrrh.supabase.co'
const KEY = 'sb_publishable_R_GVnnGER-b9hJYwD5wS5g__d2keKtF'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const host = createClient(URL, KEY, opts)
const { data: hAuth } = await host.auth.signInAnonymously()
const uid = hAuth.user.id
const code = 'S' + Math.random().toString(36).slice(2, 6).toUpperCase()
const later = new Date(Date.now() + 45 * 60000).toISOString()

const { error: e1 } = await host.from('rooms').insert({ code, host_id: uid, name: 'Schema Probe', is_public: true, status: 'open', seats: 1, expires_at: later })
console.log('room insert:', e1 ? `ERR ${e1.message}` : 'ok')
const { error: e2 } = await host.from('rooms').update({ host_name: 'ProbeHolly' }).eq('code', code).eq('host_id', uid)
console.log('host_name update:', e2 ? `ERR ${e2.message}` : 'ok')
const { data: row, error: e3 } = await host.from('rooms').select('code, name, host_name').eq('code', code).maybeSingle()
console.log('host_name read-back:', e3 ? `ERR ${e3.message}` : JSON.stringify(row))
const { error: e4 } = await host.from('room_participants').insert({ room_code: code, seat: 0, user_id: uid, name: 'ProbeHolly', buy_in: 2000 })
console.log('seat insert:', e4 ? `ERR ${e4.message}` : 'ok')
const { error: e5 } = await host.from('room_participants').delete().eq('room_code', code).eq('seat', 0)
console.log('seat delete:', e5 ? `ERR ${e5.message}` : 'ok')
const { data: gone } = await host.from('rooms').select('code').eq('code', code)
console.log('room row after last participant deleted:', JSON.stringify(gone))
console.log(gone?.length === 0 ? 'GC TRIGGER WORKS — room was deleted server-side' : 'ROOM STILL PRESENT — trigger not firing')
// safety cleanup if the trigger did not fire
await host.from('rooms').delete().eq('code', code)
process.exit(0)
