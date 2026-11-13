/* Real frame-time measurement: plays a round at 3 and 5 seats with 4x CPU throttle,
   sampling requestAnimationFrame deltas through the deal -> arrange -> reveal flow. */
import { chromium } from 'playwright'
const URL = 'http://localhost:4173/' // uses the running preview server
const browser = await chromium.launch()
for (const bots of [2, 4]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await page.waitForSelector('.wordmark', { timeout: 30000 })
  const client = await ctx.newCDPSession(page)
  await client.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU || 4) })
  await page.getByRole('button', { name: bots === 1 ? '1 bot' : `${bots} bots` }).click()
  // instrument rAF before the action
  await page.evaluate(() => {
    window.__frames = []
    const loop = () => { window.__frames.push(performance.now()); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
  })
  await page.getByRole('button', { name: 'Deal me in' }).click()
  await page.waitForTimeout(1200) // deal + settle
  await page.getByRole('button', { name: 'Auto-arrange' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Lock In' }).click()
  await page.waitForTimeout(3500) // reveal animation
  const frames = await page.evaluate(() => window.__frames)
  const deltas = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b)
  const p50 = deltas[Math.floor(deltas.length * 0.5)] ?? 0
  const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? 0
  const max = deltas[deltas.length - 1] ?? 0
  const longTasks = deltas.filter(d => d > 50).length
  console.log(`seats=${bots + 1} frames=${frames.length} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms >50ms=${longTasks}`)
  await ctx.close()
}
await browser.close()
process.exit(0)
