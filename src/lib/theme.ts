import type { Theme } from '../types'

/** An accent: an RGB triple per mode (bright for dark UI, deeper for contrast on light UI). */
export interface AccentDef {
  id: string
  label: string
  dark: string // "r g b"
  light: string
}

export const ACCENTS: AccentDef[] = [
  // light values are darkened to clear WCAG AA (>=4.5:1) for accent TEXT on white surfaces
  { id: 'lime', label: 'Lime', dark: '190 242 100', light: '77 124 15' },
  { id: 'blue', label: 'Blue', dark: '96 165 250', light: '37 99 235' },
  { id: 'violet', label: 'Violet', dark: '167 139 250', light: '124 58 237' },
  { id: 'cyan', label: 'Cyan', dark: '34 211 238', light: '14 116 144' },
  { id: 'orange', label: 'Orange', dark: '251 146 60', light: '194 65 12' },
  { id: 'rose', label: 'Rose', dark: '251 113 133', light: '225 29 72' },
]

export const DEFAULT_ACCENT = 'lime'
export const DEFAULT_THEME: Theme = 'system'

export function accentDef(id: string | undefined): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]
}

/** Whether the given theme resolves to dark right now (system → OS preference). */
export function resolveDark(theme: Theme | undefined): boolean {
  if (theme === 'light') return false
  if (theme === 'dark') return true
  // 'system' (or undefined)
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** Apply theme class + accent variable to <html>. Safe to call on every change. */
export function applyTheme(theme: Theme | undefined, accentId: string | undefined): void {
  if (typeof document === 'undefined') return
  const dark = resolveDark(theme)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  const a = accentDef(accentId)
  root.style.setProperty('--accent', dark ? a.dark : a.light)
}
