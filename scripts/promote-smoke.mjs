/* Host killed mid-game: one survivor must be promoted; chat shows the takeover line; round still resolves. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'https://realreapdeploys.github.io/kitti/'
const browser = await chromium.launch()
const log = (...a) => console.log('[promote]', ...a)
let failures = 0
const check = (name, ok) => { log((ok ? 'PASS' : 'FAIL') + ' | ' + name); if (!ok) failures++ }
const hostCtx = await browser.newContext({ viewport: { width: 950, height: 750 } })
const g1Ctx = await browser.newContext({ viewport: { width: 950, height: 750 } })
const g2Ctx = await browser.newContext({ viewport: { width: 950, height: 750 } })
let closing = false
try {
  const host = await hostCtx.newPage(); const g1 = await g1Ctx.newPage(); const g2 = await g2Ctx.newPage()
  for (const [label, p] of [['host',host],['g1',g1],['g2',g2]]) p.on('console', m => { if (m.type() === 'error' || (closing && label !== 'host')) log(label, 'console:', m.text().slice(0,220)) })
  for (const [label, p] of [['g1',g1],['g2',g2]]) {
    p.on('request', r => { if (closing && (/promote_next_host|room_state|heartbeat|\/rooms\b/.test(r.url()))) log(label, 'req', r.method(), r.url().slice(0,120)) })
    p.on('response', r => { if (closing && (/promote_next_host|room_state|heartbeat|\/rooms\b/.test(r.url())) && /promote_next_host|room_state|heartbeat|rooms/.test(r.url())) log(label, 'res', r.status(), r.url().slice(0,120)) })
    p.on('response', r => { if (closing && r.status() >= 400) log(label, 'http', r.status(), r.url().slice(0,100)) })
  }
  await host.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await host.getByRole('button', { name: 'Multiplayer' }).click()
  await host.getByLabel('Your name').fill('nirvy')
  await host.getByLabel('Room name').fill('Promote Gate')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForSelector('.room-code', { timeout: 20000 })
  const code = (await host.locator('.room-code').textContent())?.trim()
  log('room', code)
  await g1.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await g1.getByRole('button', { name: 'Multiplayer' }).click()
  await g1.getByLabel('Your name').first().fill('jordan')
  await g1.getByLabel('Room code').fill(code); await g1.getByRole('button', { name: 'Join', exact: true }).click()
  await g2.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await g2.getByRole('button', { name: 'Multiplayer' }).click()
  await g2.getByLabel('Your name').first().fill('satya')
  await g2.getByLabel('Room code').fill(code); await g2.getByRole('button', { name: 'Join', exact: true }).click()
  await host.waitForFunction(() => document.querySelectorAll('.room-roster li').length >= 3, null, { timeout: 25000 })
  await host.getByRole('button', { name: 'Start game' }).click()
  await host.waitForSelector('.arrange-panel', { timeout: 20000 })
  await g1.waitForSelector('.arrange-panel', { timeout: 20000 })
  await g2.waitForSelector('.arrange-panel', { timeout: 20000 })
  log('game running; closing host browser abruptly')
  // guests tap the header Chat toggle so the table chat overlay is visible
  for (const [label, g] of [['jordan', g1], ['satya', g2]]) {
    try {
      const toggle = g.getByRole('button', { name: /chat/i }).first()
      await toggle.click()
      log(label, 'opened table chat')
    } catch (e) { log(label, 'chat toggle click failed:', String(e).slice(0, 120)) }
  }
  closing = true
  await hostCtx.close()
  log('host browser closed — watching guests')
  const msgRe = /takes over/i
  const deadline = Date.now() + 80000
  let seenOn = null
  while (Date.now() < deadline && !seenOn) {
    if (await g1.locator('.chat-line', { hasText: msgRe }).count().catch(() => 0)) seenOn = 'jordan'
    else if (await g2.locator('.chat-line', { hasText: msgRe }).count().catch(() => 0)) seenOn = 'satya'
    else await new Promise(r => setTimeout(r, 800))
  }
  check(`takeover system line seen — got: ${seenOn || 'none'}`, !!seenOn)
  const g1Text = await g1.locator('body').innerText().catch(() => '(n/a)')
  const g2Text = await g2.locator('body').innerText().catch(() => '(n/a)')
  log('--- g1 page text (first 900 chars) ---'); console.log(g1Text.slice(0, 900))
  log('--- g2 page text (first 900 chars) ---'); console.log(g2Text.slice(0, 900))
  log('g1 .chat-system lines:', await g1.locator('.chat-system').count().catch(() => 'n/a'))
  log('g2 .chat-system lines:', await g2.locator('.chat-system').count().catch(() => 'n/a'))
  log('--- g1 chat feed ---'); console.log(await g1.locator('.chat-feed').first().innerText().catch(() => '(n/a)'))
  log('--- g2 chat feed ---'); console.log(await g2.locator('.chat-feed').first().innerText().catch(() => '(n/a)'))
  if (seenOn) {
    for (const [label, g] of [['jordan', g1], ['satya', g2]]) {
      try { await g.getByRole('button', { name: 'Auto-arrange' }).click({ timeout: 8000 }); log(label, 'auto-arranged') } catch { log(label, 'auto-arrange unavailable') }
      const btn = g.getByRole('button', { name: 'Lock In' }).first()
      try { await btn.click({ timeout: 8000 }); log(label, 'locked in') } catch { log(label, 'lock-in button not clickable (phase advanced)') }
    }
    const rd = Date.now() + 45000
    let reveal = false
    while (Date.now() < rd && !reveal) {
      if (await g1.locator('.reveal-panel').count()) reveal = true
      else if (await g2.locator('.reveal-panel').count()) reveal = true
      else await new Promise(r => setTimeout(r, 800))
    }
    check('round resolved and reveal panel visible to a survivor', reveal)
  }
} catch (e) {
  log('ERROR:', e.message); failures++
} finally {
  await Promise.allSettled([hostCtx.close(), g1Ctx.close(), g2Ctx.close()])
  await browser.close()
}
console.log(failures === 0 ? '[promote] PROMOTE QA PASS' : `[promote] ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
