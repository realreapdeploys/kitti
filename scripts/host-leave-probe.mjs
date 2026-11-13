import { createClient } from '@supabase/supabase-js'
const URL = 'https://rzbujszafrvvuzghcrrh.supabase.co'
const KEY = 'sb_publishable_R_GVnnGER-b9hJYwD5wS5g__d2keKtF'
const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const code = process.argv[2]
await client.auth.signInAnonymously()
const { data: parts } = await client.from('room_participants').select('seat, name, user_id').eq('room_code', code)
console.log('participants left:', JSON.stringify(parts))
const { data: room } = await client.from('rooms').select('code, host_id, status').eq('code', code).maybeSingle()
console.log('room row:', JSON.stringify(room))
process.exit(0)
