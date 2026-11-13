import { SimplePool, finalizeEvent, generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
const sk = generateSecretKey(); const pk = getPublicKey(sk)
const pool = new SimplePool()
const RELAYS = ['wss://nos.lol', 'wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nostrelay.pl']
const ev = finalizeEvent({ kind: 30000, created_at: Math.floor(Date.now() / 1000), tags: [['t', 'kitti-room'], ['d', 'TESTROOM1']], content: JSON.stringify({ code: 'TESTROOM1', name: 'Probe room', ts: Date.now() }) }, sk)
try {
  await Promise.race([Promise.allSettled(pool.publish(RELAYS, ev)), new Promise(r => setTimeout(r, 8000))])
  console.log('published event', ev.id.slice(0, 8), 'to', RELAYS.length, 'relays')
} catch (e) { console.log('publish error:', e.message) }
let found = []
try {
  found = await pool.querySync(RELAYS, { kinds: [30000], '#t': ['kitti-room'], since: Math.floor(Date.now() / 1000) - 600 })
} catch (e) { console.log('sub error:', e.message) }
console.log('found events:', found.map(f => { try { return JSON.parse(f.content).code } catch { return '?' } }))
process.exit(0)
