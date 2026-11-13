import { chromium } from 'playwright'
const BASE = process.env.BASE || 'http://localhost:4173/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
await page.goto(BASE, { waitUntil: 'load', timeout: 45000 })
await page.getByRole('button', { name: 'Multiplayer' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'shots/lobby-host.png', fullPage: true })
// open the host panel scrolled to house rules
await page.locator('.lobby-rules').scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await page.screenshot({ path: 'shots/lobby-rules.png' })
await browser.close()
console.log('lobby shots saved')
