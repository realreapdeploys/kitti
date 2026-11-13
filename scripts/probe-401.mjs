import { chromium } from 'playwright'
const BASE = process.env.BASE
const b = await chromium.launch()
const p = await b.newPage()
p.on('response', r => { if (r.status() >= 400) console.log('ERR', r.status(), r.request().method(), r.url().slice(0, 140)) })
await p.goto(BASE, { waitUntil: 'load', timeout: 45000 })
await p.getByRole('button', { name: 'Multiplayer' }).click()
await p.waitForTimeout(1500)
await p.getByLabel('Your name').fill('ProbeHost')
await p.getByLabel('Room name').fill('Probe room')
await p.getByRole('button', { name: 'Create room' }).click()
await p.waitForTimeout(4000)
console.log('probe done')
await b.close()
