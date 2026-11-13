import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ThemeName } from './tokens'

const KEY = 'kitti-theme'

interface ThemeContextValue {
  theme: ThemeName
  toggleTheme: () => void
  setTheme: (t: ThemeName) => void
}
const ThemeContext = createContext<ThemeContextValue>({
  theme: 'evening',
  toggleTheme: () => undefined,
  setTheme: () => undefined
})

const readStored = (): ThemeName => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'daylight' ? 'daylight' : 'evening'
  } catch {
    return 'evening'
  }
}

/** Provides theme + persists choice + sets [data-theme] on <html>. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(readStored)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem(KEY, theme) } catch { /* ignore */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'evening' ? '#14100d' : '#f3ede2')
  }, [theme])

  const setTheme = (t: ThemeName) => setThemeState(t)
  const toggleTheme = () => setThemeState(t => (t === 'evening' ? 'daylight' : 'evening'))

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext)
