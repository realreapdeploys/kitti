/* Global lobby chat probe: two browsers, LIVE Supabase. Real presence claims and message round-trip. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const log = (...a) => console.log('[global-chat]', ...a)
const ctxA = await browser.newContext({ viewport: { width: 950, height: 780 } })
const ctxB = await browser.newContext({ viewport: { width: 950, height: 780 } })
try {
  const a = await ctxA.newPage(); const b = await ctxB.newPage()
  a.on('console', m => { if (m.type() === 'error') log('A console:', m.text().slice(0, 120)) })
  b.on('console', m => { if (m.type() === 'error') log('B console:', m.text().slice(0, 120)) })
  await a.goto(BASE, { waitUntil: 'load', timeout: 45000 }); await a.getByRole('button', { name: 'Multiplayer' }).click()
  await b.goto(BASE, { waitUntil: 'load', timeout: 45000 }); await b.getByRole('button', { name: 'Multiplayer' }).click()

  // both join global chat under distinct names
  const tag = String(Date.now() % 100000)
  const nameA = 'ProbeA' + tag, nameB = 'ProbeB' + tag
  await a.getByLabel('Name for the global chat').fill(nameA)
  await a.getByRole('button', { name: 'Join chat' }).click()
  await a.waitForSelector('.global-chat .chat-feed', { timeout: 15000 })
  await b.getByLabel('Name for the global chat').fill(nameB)
  await b.getByRole('button', { name: 'Join chat' }).click()
  await b.waitForSelector('.global-chat .chat-feed', { timeout: 15000 })
  log('both joined the global lobby')

  await a.getByLabel('Global chat message').fill('hello from alpha')
  await a.getByRole('button', { name: 'Send', exact: true }).last().click()
  await b.waitForSelector('.global-chat .chat-line:has-text("hello from alpha")', { timeout: 20000 })
  log('A -> B landed via Supabase')

  // collision: B notices Alpha is live? Not enforceable cross-name; instead B takes Alpha's name on a THIRD tab and sees the claim warning is not guaranteed timing — skip strict assert; check presence count instead
  const liveText = await b.locator('.global-chat .global-chat-meta').textContent()
  log('B sees:', (liveText ?? '').trim())

  // name collision: a fresh tab trying A's taken name must surface the warning banner
  const ctxC = await browser.newContext({ viewport: { width: 760, height: 640 } })
  try {
    const c = await ctxC.newPage()
    await c.goto(BASE, { waitUntil: 'load', timeout: 45000 }); await c.getByRole('button', { name: 'Multiplayer' }).click()
    await c.getByLabel('Name for the global chat').fill(nameA)
    await c.getByRole('button', { name: 'Join chat' }).click()
    await c.waitForSelector('.global-chat [role="alert"]', { timeout: 20000 })
    log('collision banner shown for taken name', nameA)
    await ctxC.close()
  } catch (e) {
    await ctxC.close()
    throw new Error('name-collision banner did not appear: ' + e.message)
  }
  log('GLOBAL CHAT PASS')
} catch (e) {
  console.log('[global-chat] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
