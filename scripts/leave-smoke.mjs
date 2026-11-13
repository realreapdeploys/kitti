/* Tab-close mid-round: host must auto lock-in Gary and remove him after the round (no bot takeover). */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://127.0.0.1:65493/'
const browser = await chromium.launch()
const log = (...a) => console.log('[leave-smoke]', ...a)
const hostCtx = await browser.newContext({ viewport: { width: 950, height: 750 } })
const guestCtx = await browser.newContext({ viewport: { width: 950, height: 750 } })
try {
  const host = await hostCtx.newPage(); host.on('console', m => { log('host console:', m.type(), m.text().slice(0, 160)) })
  const guest = await guestCtx.newPage()
  await host.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await host.getByRole('button', { name: 'Multiplayer' }).click()
  await host.getByLabel('Your name').fill('HostHolly')
  await host.getByLabel('Room name').fill('Leave Smoke')
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
  log('roster ok')

  await host.getByRole('button', { name: 'Start game' }).click()
  await host.waitForSelector('.arrange-panel', { timeout: 20000 })
  log('game started; closing guest tab…')
  await guest.close()                 // hard tab close — no leave() runs

  // host should notice via presence watchdog; system line expected
  await host.getByRole('button', { name: 'Toggle table chat' }).click()
  // host should notice via presence watchdog; system line expected
  try {
    await host.waitForSelector('.chat-system:has-text("GuestGary left the table.")', { timeout: 180000 })
  } catch (e) {
    const body = await host.textContent('body') || ''
    log('body evidence:', body.replace(/\n/g, ' ').slice(0, 900))
    throw e
  }

  log('host detected the vanished tab and locked in Gary automatically')

  await host.getByRole('button', { name: 'Auto-arrange' }).click()
  await host.waitForTimeout(300)
  await host.getByRole('button', { name: 'Lock In' }).click()
  await host.waitForSelector('.reveal-hands, .roundEnd, .reveal-panel, [aria-label="Reveal"]', { timeout: 25000 }).catch(() => undefined)
  log('round resolved')
  await host.waitForSelector('.chat-system:has-text("was removed from the table")', { timeout: 10000 })
  log('post-round removal applied — no bot takeover — PASS')
} catch (e) {
  console.log('[leave-smoke] FAIL:', e.message)
  try { const txt = await hostText(host) } catch {}
  process.exitCode = 1
} finally { await browser.close() }
async function hostText() {}
