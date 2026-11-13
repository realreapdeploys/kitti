/**
 * Tiny Web Audio sound pack — generated, no files, works offline.
 * Default MUTED; toggle persisted in localStorage as `kitti-sound`.
 */

export type SoundName = 'deal' | 'flip' | 'chip' | 'win' | 'salami' | 'kitti' | 'lock' | 'button'

const KEY = 'kitti-sound'

export const isSoundOn = (): boolean => {
  try { return localStorage.getItem(KEY) === 'on' } catch { return false }
}
export const setSound = (on: boolean): void => {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

let ctx: AudioContext | null = null
const ac = (): AudioContext | null => {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

const tone = (freq: number, t0: number, dur: number, type: OscillatorType, peak = 0.16) => {
  const c = ac(); if (!c) return
  const o = c.createOscillator(); const g = c.createGain()
  o.type = type; o.frequency.setValueAtTime(freq, t0)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(peak, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0); o.stop(t0 + dur + 0.02)
}

/** Play a sound if enabled. Never throws. */
export function playSound(name: SoundName): void {
  if (!isSoundOn()) return
  const c = ac(); if (!c) return
  const t = c.currentTime
  switch (name) {
    case 'deal': tone(660 + Math.random() * 40, t, 0.07, 'triangle', 0.1); break
    case 'flip': tone(880, t, 0.09, 'sine', 0.12); tone(1320, t + 0.05, 0.08, 'sine', 0.08); break
    case 'chip': tone(1560, t, 0.045, 'square', 0.07); tone(1180, t + 0.045, 0.05, 'square', 0.06); break
    case 'lock': tone(440, t, 0.12, 'triangle', 0.14); tone(660, t + 0.09, 0.16, 'triangle', 0.12); break
    case 'win': [523, 659, 784].forEach((f, i) => tone(f, t + i * 0.11, 0.35, 'sine', 0.16)); break
    case 'salami': [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, t + i * 0.09, 0.4, 'triangle', 0.18)); break
    case 'kitti': tone(196, t, 0.4, 'sawtooth', 0.14); tone(98, t + 0.22, 0.55, 'sawtooth', 0.16); break
    case 'button': tone(980, t, 0.05, 'sine', 0.07); break
  }
}
