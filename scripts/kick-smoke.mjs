/* Kick smoke: host creates room, guest joins, host kicks, guest lands back on the lobby menu with a message, host roster shows 1 member. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const log = (...a) => console.log('[kick-smoke]', ...a)
const hostCtx = await browser.newContext({ viewport: { width: 900, height: 700 } })
const guestCtx = await browser.newContext({ viewport: { width: 900, height: 700 } })
try {
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  await host.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await host.getByRole('button', { name: 'Multiplayer' }).click()
  await host.getByLabel('Your name').fill('HostHolly')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForSelector('.room-code', { timeout: 20000 })
  const code = (await host.locator('.room-code').textContent())?.trim()
  log('room created, code =', code)

  await guest.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await guest.getByRole('button', { name: 'Multiplayer' }).click()
  await guest.getByLabel('Your name').fill('GuestGary')
  await guest.getByLabel('Room code').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  await host.waitForFunction(() => document.querySelectorAll('.room-roster li').length >= 2, null, { timeout: 20000 })
  log('guest in host roster')

  await host.getByRole('button', { name: /Kick GuestGary/ }).click()
  await host.getByRole('button', { name: /Confirm kick of GuestGary/ }).click()
  await host.waitForFunction(() => document.querySelectorAll('.room-roster li').length === 1, null, { timeout: 10000 })
  log('host roster back to 1 after kick')

  await guest.getByRole('button', { name: 'Multiplayer' }).waitFor({ timeout: 10000 }).catch(() => {})
  await guest.waitForSelector('.home-note', { timeout: 15000 })
  const msg = (await guest.locator('.home-note').first().textContent())?.trim()
  log('guest sees:', msg)
  const inRoom = await guest.locator('.room-roster').count()
  log(inRoom === 0 ? 'KICK SMOKE PASS' : 'FAIL: guest still in room')
  if (inRoom !== 0) process.exitCode = 1
} catch (e) {
  console.log('[kick-smoke] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
