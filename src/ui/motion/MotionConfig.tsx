import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SPRINGS, REDUCED_DURATION, type SpringSpec } from './springs'

/**
 * MotionConfig — one switch that flips the whole app between spring motion and
 * near-instant fades. Active when:
 *   - the user/OS requests reduced motion (prefers-reduced-motion), OR
 *   - matchMedia is unavailable (tests, SSR) — tests get instant feedback on purpose, OR
 *   - the provider is constructed with forceReduced.
 * All UI tests render under this provider, so timers and assertions stay deterministic.
 */

interface MotionConfigValue {
  reducedMotion: boolean
  spring: (name: keyof typeof SPRINGS) => SpringSpec | { duration: number }
  /** seconds for CSS transitions as fallback */
  duration: (name: keyof typeof SPRINGS) => number
}

const MotionConfigContext = createContext<MotionConfigValue>({
  reducedMotion: true,
  spring: () => ({ duration: REDUCED_DURATION }),
  duration: () => REDUCED_DURATION
})

const detectReduced = (): boolean => {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true // tests/SSR: instant
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

export function MotionConfigProvider({ children, forceReduced }: { children: ReactNode; forceReduced?: boolean }) {
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => forceReduced ?? detectReduced())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (forceReduced !== undefined) { setReducedMotion(forceReduced); return }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [forceReduced])

  const value = useMemo<MotionConfigValue>(() => ({
    reducedMotion,
    spring: name => (reducedMotion ? { duration: REDUCED_DURATION } : SPRINGS[name]),
    duration: () => (reducedMotion ? REDUCED_DURATION : 0.26)
  }), [reducedMotion])

  return <MotionConfigContext.Provider value={value}>{children}</MotionConfigContext.Provider>
}

export const useMotionConfig = (): MotionConfigValue => useContext(MotionConfigContext)
export const useReducedMotion = (): boolean => useContext(MotionConfigContext).reducedMotion

/** Convenience: stagger delay helper. Reduced motion => 0. */
export const staggerDelay = (index: number, base = 0.055): number => index * base
export const staggerDelayReduced = (): number => 0
