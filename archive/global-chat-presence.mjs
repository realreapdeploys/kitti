/* Presence convergence probe: two browsers on public relays; wait one heartbeat and see the counter flip. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const log = (...a) => console.log('[presence]', ...a)
const ctxA = await browser.newContext({ viewport: { width: 950, height: 780 } })
const ctxB = await browser.newContext({ viewport: { width: 950, height: 780 } })
try {
  const a = await ctxA.newPage(); const b = await ctxB.newPage()
  const tag = String(Date.now() % 100000)
  const nameA = 'Pa' + tag, nameB = 'Pb' + tag
  await a.goto(BASE, { waitUntil: 'load', timeout: 45000 }); await a.getByRole('button', { name: 'Multiplayer' }).click()
  await a.getByLabel('Name for the global chat').fill(nameA)
  await a.getByRole('button', { name: 'Join chat' }).click()
  await a.waitForSelector('.global-chat .chat-feed', { timeout: 15000 })
  await b.goto(BASE, { waitUntil: 'load', timeout: 45000 }); await b.getByRole('button', { name: 'Multiplayer' }).click()
  await b.getByLabel('Name for the global chat').fill(nameB)
  await b.getByRole('button', { name: 'Join chat' }).click()
  await b.waitForSelector('.global-chat .chat-feed', { timeout: 15000 })
  // wait for heartbeat-driven refresh (client re-publishes + re-queries every 25s)
  await b.waitForTimeout(27000)
  const meta = (await b.locator('.global-chat .global-chat-meta').textContent()) ?? ''
  log('B meta after heartbeat:', meta.trim())
  log(/1 other/.test(meta) ? 'PRESENCE CONVERGES — PASS' : 'PRESENCE STALE — relays did not deliver claims in 27s')
} catch (e) {
  console.log('[presence] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
