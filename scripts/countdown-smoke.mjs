/* Single-player: reveal should auto-advance in ~20s without clicking Next Round. */
import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 })
  await page.getByLabel('Seed').fill('12345')
  await page.getByRole('button', { name: 'Deal me in' }).click()
  await page.getByRole('listitem').first().waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: 'Auto-arrange' }).click()
  await page.getByRole('button', { name: 'Lock In' }).click()
  await page.waitForSelector('[class*="reveal"], .banner, .reveal-hands', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const timerText = await page.locator('.round-countdown').textContent().catch(() => 'NOT FOUND')
  console.log('[countdown] timer text:', JSON.stringify(timerText))
  const t0 = Date.now()
  await page.waitForSelector('.hand-tray', { timeout: 30000 }) // back to arranging (round 2)
  console.log('[countdown] auto-advanced after', ((Date.now() - t0) / 1000).toFixed(1), 's from reveal — PASS')
} catch (e) {
  console.log('[countdown] FAIL:', e.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
