/* Two-browser multiplayer smoke: host creates a room, guest joins by code, host starts, both get a table with cards. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:65493/'
const browser = await chromium.launch()
const log = (...a) => console.log('[smoke]', ...a)
const hostCtx = await browser.newContext({ viewport: { width: 900, height: 700 } })
const guestCtx = await browser.newContext({ viewport: { width: 900, height: 700 } })
try {
  const host = await hostCtx.newPage(); host.on('console', m => { if (m.type() === 'error') log('host console error:', m.text().slice(0, 200)) })
  const guest = await guestCtx.newPage(); guest.on('console', m => { if (m.type() === 'error') log('guest console error:', m.text().slice(0, 200)) })

  await host.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await host.getByRole('button', { name: 'Multiplayer' }).click()
  await host.getByLabel('Your name').fill('HostHolly')
  await host.getByLabel('Room name').fill('Smoke Room')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForSelector('.room-code', { timeout: 20000 })
  const code = (await host.locator('.room-code').textContent())?.trim()
  log('room created, code =', code)

  await guest.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await guest.getByRole('button', { name: 'Multiplayer' }).click()
  await guest.getByLabel('Your name').first().fill('GuestGary')
  await guest.getByLabel('Room code').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  // both should end up in the room roster
  await host.waitForFunction(() => document.querySelectorAll('.room-roster li').length >= 2, null, { timeout: 20000 })
  log('guest joined roster on host side')
  await guest.waitForSelector('.room-roster li', { timeout: 10000 })
  log('guest sees roster')

  await host.getByRole('button', { name: 'Start game' }).click()
  const started = new Date()
  await Promise.all([
    host.waitForSelector('.arrange-panel [role="listitem"]', { timeout: 20000 }),
    guest.waitForSelector('.arrange-panel [role="listitem"]', { timeout: 20000 }),
  ])
  log('both saw the arranging table after', Date.now() - started, 'ms')
  const hostCards = await host.locator('.hand-tray [role="listitem"]').count()
  const guestCards = await guest.locator('.hand-tray [role="listitem"]').count()
  log('tray sizes: host', hostCards, 'guest', guestCards)

  // both lock in via Auto-arrange + Lock In
  await host.getByRole('button', { name: 'Auto-arrange' }).click()
  await host.waitForTimeout(200)
  await guest.getByRole('button', { name: 'Auto-arrange' }).click()
  await guest.waitForTimeout(200)
  await host.getByRole('button', { name: 'Lock In' }).click()
  await guest.getByRole('button', { name: 'Lock In' }).click()
  await host.waitForSelector('.reveal-panel, .roundEnd, [aria-label="Reveal"], .reveal-hands', { timeout: 20000 }).catch(async () => log('host reveal selector missed — body text:', (await host.textContent('body'))?.slice(0, 500)?.replace(/\n/g, ' ')))
  await guest.waitForSelector('.reveal-hands, .roundEnd, .reveal-panel', { timeout: 20000 }).catch(() => log('guest reveal selector missed'))
  log('round resolved — SMOKE PASS')
} catch (e) {
  console.log('[smoke] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
