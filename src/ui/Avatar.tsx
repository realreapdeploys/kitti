import type { JSX } from 'react'
const PERSONALITIES: Record<string, { hue: string; label: string; emblem: JSX.Element }> = {
  safe: {
    hue: '#2e86c1',
    label: 'Safe',
    emblem: (
      <g stroke="#eaf4ff" strokeWidth="1.6" fill="none" strokeLinejoin="round">
        <path d="M16 5 L25 9 V15 C25 22 21.5 27 16 29.5 C10.5 27 7 22 7 15 V9 Z" fill="#1b4f72" />
        <path d="M12.5 15.5 L15.5 18.5 L20.5 12.5" strokeLinecap="round" />
      </g>
    )
  },
  aggressive: {
    hue: '#c0392b',
    label: 'Aggressive',
    emblem: (
      <g stroke="#ffe9e2" strokeWidth="1.5" fill="#e4572e" strokeLinejoin="round">
        <path d="M16 4 C13 10 8.5 12.5 10 18 C11 22.4 13.4 24.6 16 27 C18.6 24.6 21 22.4 22 18 C23.5 12.5 19 10 16 4 Z" />
        <path d="M16 12 C14.6 14.4 13.2 15.6 14 18.6 C14.6 20.8 15.4 21.6 16 22.6 C16.6 21.6 17.4 20.8 18 18.6 C18.8 15.6 17.4 14.4 16 12 Z" fill="#ffd9c4" stroke="none" />
      </g>
    )
  },
  balanced: {
    hue: '#1e8449',
    label: 'Balanced',
    emblem: (
      <g stroke="#eaffef" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M16 6 V24 M9 9 H23" />
        <path d="M7.5 9 L4.5 17.5 H10.5 Z M24.5 9 L21.5 17.5 H27.5 Z" fill="#27ae60" fillOpacity="0.6" />
        <path d="M10 26 H22" />
      </g>
    )
  },
  unpredictable: {
    hue: '#8e44ad',
    label: 'Unpredictable',
    emblem: (
      <g stroke="#f3e6ff" strokeWidth="1.5" fill="#a96be0" strokeLinejoin="round">
        <path d="M18 4 L9 18 H15 L12.5 28 L23 13.5 H16.5 L20.5 4 Z" />
      </g>
    )
  }
}
export const PERSONALITY_META = PERSONALITIES

/** Original generated avatar: personality emblem on a radial hue disc with jali dots. */
export function Avatar({ personality, size = 34 }: { personality: string | undefined; size?: number }) {
  const meta = PERSONALITIES[personality ?? 'balanced'] ?? PERSONALITIES['balanced']!
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} role="img" aria-label={`${meta.label} bot avatar`}>
      <defs>
        <radialGradient id={`av-${personality ?? 'balanced'}`} cx="0.38" cy="0.32" r="0.95">
          <stop offset="0" stopColor={meta.hue} stopOpacity="1" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.75" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={`url(#av-${personality ?? 'balanced'})`} />
      <circle cx="16" cy="16" r="15" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
      {[0, 60, 120, 180, 240, 300].map(a => (
        <circle key={a} cx="16" cy="16" r="13.2" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0" />
      ))}
      {meta.emblem}
    </svg>
  )
}
