/* Debug: can a second browser see a public room listed on the relays? */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:65493/'
const browser = await chromium.launch()
const errors = { a: [], b: [] }
try {
  // User A: host a PUBLIC room
  const ctxA = await browser.newContext({ viewport: { width: 900, height: 800 } })
  const a = await ctxA.newPage()
  a.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.a.push(m.type() + ': ' + m.text().slice(0, 300)) })
  a.on('pageerror', e => errors.a.push('pageerror: ' + e.message))
  await a.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await a.getByRole('button', { name: 'Multiplayer' }).click()
  await a.getByLabel('Your name').fill('PublicHost')
  await a.getByRole('radio', { name: 'Public' }).click()
  await a.waitForTimeout(200)
  await a.getByRole('button', { name: 'Create room' }).click()
  await a.waitForSelector('.room-code', { timeout: 20000 })
  const code = (await a.locator('.room-code').textContent())?.trim()
  console.log('[lobby] host A created public room, code =', code)

  // User B: look for public rooms
  const ctxB = await browser.newContext({ viewport: { width: 900, height: 800 } })
  const b = await ctxB.newPage()
  b.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.b.push(m.type() + ': ' + m.text().slice(0, 300)) })
  b.on('pageerror', e => errors.b.push('pageerror: ' + e.message))
  await b.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await b.getByRole('button', { name: 'Multiplayer' }).click()
  await b.getByRole('button', { name: 'Refresh public rooms' }).click()
  await b.waitForTimeout(4000)
  const listHtml = await b.locator('.public-rooms').innerHTML()
  const meta = await b.locator('.public-rooms li').count()
  console.log('[lobby] B sees', meta, 'public rooms')
  console.log('[lobby] B list html:', listHtml.slice(0, 500))
  console.log('[lobby] A console:', JSON.stringify(errors.a, null, 1))
  console.log('[lobby] B console:', JSON.stringify(errors.b, null, 1))
} catch (e) {
  console.log('[lobby] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
