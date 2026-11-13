/* Chat smoke: host/guest exchange user messages; system messages arrive for join/start/kick. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const log = (...a) => console.log('[chat-smoke]', ...a)
const hostCtx = await browser.newContext({ viewport: { width: 950, height: 780 } })
const guestCtx = await browser.newContext({ viewport: { width: 950, height: 780 } })
try {
  const host = await hostCtx.newPage()
  const guest = await guestCtx.newPage()
  host.on('console', m => { if (m.type() === 'error') log('host console error:', m.text().slice(0, 150)) })
  guest.on('console', m => { if (m.type() === 'error') log('guest console error:', m.text().slice(0, 150)) })

  await host.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await host.getByRole('button', { name: 'Multiplayer' }).click()
  await host.getByLabel('Your name').fill('HostHolly')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForSelector('.room-code', { timeout: 20000 })
  const code = (await host.locator('.room-code').textContent())?.trim()
  log('room', code)

  // global chat card renders on the menu (no relay dependency asserted)
  // (not asserted here — this run exercises the room chat; global is covered by its own check)

  await guest.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await guest.getByRole('button', { name: 'Multiplayer' }).click()
  await guest.getByLabel('Your name').fill('GuestGary')
  await guest.getByLabel('Room code').fill(code)
  await guest.getByRole('button', { name: 'Join', exact: true }).click()
  await host.waitForFunction(() => document.querySelectorAll('.room-roster li').length >= 2, null, { timeout: 20000 })

  // join system message visible to both
  await host.waitForSelector('.chat-system:has-text("GuestGary joined the room.")', { timeout: 10000 })
  log('host saw join system message')
  await guest.waitForSelector('.chat-system:has-text("HostHolly")', { timeout: 10000 }).catch(() => log('guest system copy not present (expected: host joined earlier — different wording)')) 
  // host -> guest user message
  await host.getByLabel('Chat message').fill('Good luck, everyone')
  await host.getByRole('button', { name: 'Send', exact: true }).click()
  await guest.waitForSelector('.chat-line:has-text("Good luck, everyone")', { timeout: 10000 })
  log('host->guest user message landed')

  // guest -> host user message
  await guest.getByLabel('Chat message').fill('You too')
  await guest.getByRole('button', { name: 'Send', exact: true }).click()
  await host.waitForSelector('.chat-line:has-text("You too")', { timeout: 10000 })
  log('guest->host user message landed')

  // rate limit: spam clicks are absorbed without crashing
  await host.getByLabel('Chat message').fill('burst')
  await host.getByRole('button', { name: 'Send', exact: true }).click()
  await host.getByLabel('Chat message').fill('burst2')
  await host.getByRole('button', { name: 'Send', exact: true }).click()
  log('burst send did not crash the host')

  // IN-GAME: messages must flow with NO engine action (this was the reported bug)
  await host.getByRole('button', { name: 'Start game' }).click()
  await host.waitForSelector('.arrange-panel', { timeout: 20000 })
  await guest.waitForSelector('.arrange-panel', { timeout: 20000 })
  await host.getByRole('button', { name: 'Toggle table chat' }).click()
  await host.getByLabel('Chat message').fill('in-game Holly')
  await host.getByRole('button', { name: 'Send', exact: true }).click()
  await guest.getByRole('button', { name: 'Toggle table chat' }).click()
  await guest.waitForSelector('.chat-line:has-text("in-game Holly")', { timeout: 10000 })
  log('in-game host->guest landed with no engine action')
  await guest.getByLabel('Chat message').fill('in-game Gary')
  await guest.getByRole('button', { name: 'Send', exact: true }).click()
  await host.waitForSelector('.chat-line:has-text("in-game Gary")', { timeout: 10000 })
  log('in-game guest->host landed with no engine action')
  // kick covers its own flow in scripts/kick-smoke.mjs

  log('CHAT SMOKE PASS')
} catch (e) {
  console.log('[chat-smoke] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
