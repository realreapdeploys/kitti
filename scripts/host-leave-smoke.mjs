/* Host leaves mid-game: the guest must flip from the frozen table back to home with a note. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:65493/'
const browser = await chromium.launch()
const log = (...a) => console.log('[host-leave]', ...a)
const hostCtx = await browser.newContext({ viewport: { width: 950, height: 750 } })
const guestCtx = await browser.newContext({ viewport: { width: 950, height: 750 } })
try {
  const host = await hostCtx.newPage(); host.on('console', m => { if (m.type() === 'error') log('host console error:', m.text().slice(0, 160)) })
  const guest = await guestCtx.newPage(); guest.on('console', m => { if (m.type() === 'error') log('guest console error:', m.text().slice(0, 160)) })
  await host.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await host.getByRole('button', { name: 'Multiplayer' }).click()
  await host.getByLabel('Your name').fill('HostHolly')
  await host.getByLabel('Room name').fill('Host Leave Smoke')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForSelector('.room-code', { timeout: 20000 })
  const code = (await host.locator('.room-code').textContent())?.trim()
  log('room', code)

  await guest.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await guest.getByRole('button', { name: 'Multiplayer' }).click()
  await guest.getByLabel('Your name').first().fill('GuestGary')
  await guest.getByLabel('Room code').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  await host.waitForFunction(() => document.querySelectorAll('.room-roster li').length >= 2, null, { timeout: 20000 })
  await host.getByRole('button', { name: 'Start game' }).click()
  await host.waitForSelector('.arrange-panel', { timeout: 20000 })
  await guest.waitForSelector('.arrange-panel', { timeout: 20000 })
  log('game running on both screens')

  await host.getByRole('button', { name: 'Leave table' }).click()
  await host.getByRole('button', { name: 'Leave — close room' }).click()
  await guest.waitForSelector('.home-note:has-text("The host left the room")', { timeout: 25000 })
  log('guest flipped home with the note — PASS')
} catch (e) {
  console.log('[host-leave] FAIL:', e.message)
  process.exitCode = 1
} finally { await browser.close() }
