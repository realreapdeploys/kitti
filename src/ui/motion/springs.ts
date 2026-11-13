/**
 * Motion tokens — the only springs used anywhere in the UI.
 * Stiffness/damping/mass mirror what framer-motion accepts; the bezier
 * triples are the CSS fallback for elements animated purely in CSS.
 */

export interface SpringSpec { stiffness: number; damping: number; mass: number }

export const SPRINGS: Record<'snappy' | 'smooth' | 'gentle' | 'bouncy', SpringSpec> = {
  snappy: { stiffness: 520, damping: 34, mass: 0.9 }, // ~180ms settle, crisp UI
  smooth: { stiffness: 300, damping: 30, mass: 1.0 }, // ~280ms settle, general purpose
  gentle: { stiffness: 170, damping: 24, mass: 1.1 }, // ~450ms settle, large elements/arcs
  bouncy: { stiffness: 380, damping: 18, mass: 0.9 }  // visible overshoot, banners/celebration
}

/** cubic-bezier fallbacks matched (visually) to the springs above. */
export const BEZIERS: Record<keyof typeof SPRINGS, string> = {
  snappy: 'cubic-bezier(0.2, 0.9, 0.25, 1.15)',
  smooth: 'cubic-bezier(0.3, 0.9, 0.3, 1.05)',
  gentle: 'cubic-bezier(0.35, 0.8, 0.4, 1.0)',
  bouncy: 'cubic-bezier(0.3, 1.35, 0.4, 1.1)'
}

/** Durations (seconds) used when reduced motion is requested. */
export const REDUCED_DURATION = 0.08

/** Small human-readable durations for CSS transitions (ms). */
export const MS: Record<keyof typeof SPRINGS, number> = {
  snappy: 170, smooth: 260, gentle: 430, bouncy: 520
}
