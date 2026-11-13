/* Stage-1 verification against the LIVE Supabase project: auth, RLS, unique names, message round-trip. */
import { createClient } from '@supabase/supabase-js'
const URL = 'https://rzbujszafrvvuzghcrrh.supabase.co'
const KEY = 'sb_publishable_R_GVnnGER-b9hJYwD5wS5g__d2keKtF'
const mk = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const log = (...a) => console.log('[rest-smoke]', ...a)
const tag = String(Date.now() % 1000000)
const nameA = 'RsA' + tag, nameB = 'RsB' + tag
const t0 = Date.now()
const anon = async (c) => { const { data, error } = await c.auth.signInAnonymously(); if (error) throw new Error('anon sign-in failed: ' + error.message); return data.session.user.id }
try {
  const A = mk(), B = mk()
  const uidA = await anon(A), uidB = await anon(B)
  log('two anonymous sessions signed in', uidA.slice(0, 8), uidB.slice(0, 8))
  // sweep + claim names
  await A.from('presence').delete().lt('expires_at', new Date().toISOString())
  await A.from('presence').delete().eq('user_id', uidA)
  await B.from('presence').delete().eq('user_id', uidB)
  const { error: eA } = await A.from('presence').insert({ user_id: uidA, name_key: nameA.toLowerCase(), name: nameA })
  if (eA) throw new Error('A claim failed: ' + eA.message)
  const { error: eB } = await B.from('presence').insert({ user_id: uidB, name_key: nameB.toLowerCase(), name: nameB })
  if (eB) throw new Error('B claim failed: ' + eB.message)
  log('claims ok')
  // collision: B tries to squat A's name (case-insensitive key)
  const { data: holder } = await A.from('presence').select('name_key').eq('name_key', nameA.toLowerCase())
  const { error: eCollide } = await B.from('presence').insert({ user_id: uidB, name_key: nameA.toLowerCase(), name: nameA })
  log('collision rejected with code', eCollide?.code ?? 'NO-ERROR')
  if (!eCollide || eCollide.code !== '23505') throw new Error('name uniqueness NOT enforced: ' + JSON.stringify(eCollide))
  // RLS: B tries to delete A's presence row (must affect 0 rows)
  const { count } = await B.from('presence').delete({ count: 'exact' }).eq('user_id', uidA)
  log('cross-user delete affected rows:', count ?? 0)
  if ((count ?? 0) !== 0) throw new Error('RLS broken: B deleted A presence row')
  // global message round trip
  const { error: eMsg } = await B.from('global_messages').insert({ user_id: uidB, name: nameB, body: 'rest-smoke ' + tag })
  if (eMsg) throw new Error('B insert failed: ' + eMsg.message)
  const { data: seen } = await A.from('global_messages').select('id,name,body').eq('body', 'rest-smoke ' + tag)
  if (!seen?.length) throw new Error('A could not read B message (SELECT policy broken?)')
  log('A sees B message id=', seen[0].id)
  // rooms table write path (Stage 1 heartbeat)
  const { error: eRoom } = await A.from('rooms').upsert({ code: 'SMK' + tag.slice(-2), host_id: uidA, name: 'smoke', is_public: true, starting_chips: 200000, boot: 5000, win_condition: 'any_two', seats: 1, heartbeat_at: new Date().toISOString(), expires_at: new Date(Date.now() + 45 * 60 * 1000).toISOString() }, { onConflict: 'code' })
  if (eRoom) throw new Error('rooms upsert failed: ' + eRoom.message)
  const { data: room } = await B.from('rooms').select('code,name,starting_chips').eq('code', 'SMK' + tag.slice(-2))
  if (!room?.length) throw new Error('rooms read-back failed')
  log('rooms read-back ok:', room[0].code)
  // cleanup: own rows only
  await B.from('global_messages').delete().eq('user_id', uidB).eq('body', 'rest-smoke ' + tag)
  await A.from('rooms').delete().eq('code', 'SMK' + tag.slice(-2))
  log('cleanup done')
  log('REST SMOKE PASS in', Date.now() - t0, 'ms')
} catch (e) {
  console.log('[rest-smoke] FAIL:', e.message)
  process.exitCode = 1
}
