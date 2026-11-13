/* REST-only repro: can a host delete a guest's participant row? */
import { createClient } from '@supabase/supabase-js'
const URL = 'https://rzbujszafrvvuzghcrrh.supabase.co'
const KEY = 'sb_publishable_R_GVnnGER-b9hJYwD5wS5g__d2keKtF'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const host = createClient(URL, KEY, opts)
const guest = createClient(URL, KEY, opts)
const code = 'D' + Math.random().toString(36).slice(2, 6).toUpperCase()

const { data: hAuth } = await host.auth.signInAnonymously()
const { data: gAuth } = await guest.auth.signInAnonymously()
console.log('host', hAuth.user?.id.slice(0, 8), 'guest', gAuth.user?.id.slice(0, 8))

const { error: e1 } = await host.from('rooms').insert({ code, host_id: hAuth.user.id, name: 'Probe Table', is_public: false, status: 'open', seats: 1 })
console.log('room insert', e1 ? `ERR ${e1.message}` : 'ok')
const { error: e2 } = await host.from('room_participants').insert({ room_code: code, seat: 0, user_id: hAuth.user.id, name: 'ProbeHost', buy_in: 2000 })
console.log('host seat', e2 ? `ERR ${e2.message}` : 'ok')
const { error: e3 } = await guest.from('room_participants').insert({ room_code: code, seat: 1, user_id: gAuth.user.id, name: 'ProbeGuest', buy_in: 2000 })
console.log('guest seat', e3 ? `ERR ${e3.message}` : 'ok')
const del = await host.from('room_participants').delete().eq('room_code', code).eq('seat', 1).select()
console.log('host delete guest row:', del.error ? `ERR code=${del.error.code} msg=${del.error.message}` : JSON.stringify(del.data))
const { data: remains } = await host.from('room_participants').select('seat, name').eq('room_code', code)
console.log('rows after:', JSON.stringify(remains))
// cleanup
await host.from('rooms').delete().eq('code', code)
process.exit(0)
