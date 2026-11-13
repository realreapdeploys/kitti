/* Capture every major screen × 3 viewports × 2 themes into shots/ */
import { chromium } from 'playwright'
const PORT = process.env.PORT || '4173'
const BASE = `http://localhost:${PORT}/`
const VIEWPORTS = { phone: { width: 390, height: 844 }, tablet: { width: 820, height: 1180 }, desktop: { width: 1440, height: 900 } }
const THEMES = ['evening', 'daylight']
const browser = await chromium.launch()
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce' })
    await ctx.addInitScript(t => { try { localStorage.setItem('kitti-theme', t) } catch {} }, theme)
    const page = await ctx.newPage()
    const tag = `${vpName}-${theme}`
    await page.goto(BASE, { waitUntil: 'load', timeout: 45000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `shots/${tag}-setup.png` })
    await page.getByLabel('Seed').fill('12345')
    await page.getByRole('button', { name: 'Deal me in' }).click()
    await page.getByRole('listitem').first().waitFor()
    await page.waitForTimeout(250)
    await page.screenshot({ path: `shots/${tag}-arranging.png` })
    await page.getByRole('button', { name: 'Auto-arrange' }).click()
    await page.waitForTimeout(120)
    await page.screenshot({ path: `shots/${tag}-autoarranged.png` })
    await page.getByRole('button', { name: 'Lock In' }).click()
    await page.waitForSelector('.banner, .arrange-panel', { timeout: 8000 })
    await page.waitForTimeout(2200) // reveal staggers (reduced motion => fast)
    await page.screenshot({ path: `shots/${tag}-reveal.png` })
    await page.getByRole('button', { name: /Rules/ }).click()
    await page.waitForSelector('.rules-modal')
    await page.screenshot({ path: `shots/${tag}-rules.png` })
    await page.keyboard.press('Escape').catch(() => {})
    await page.getByRole('button', { name: 'Close' }).click().catch(() => {})
    await page.close(); await ctx.close()
    console.log('done', tag)
  }
}
await browser.close()
