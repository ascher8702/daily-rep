import type { Theme } from '../types'

/** An accent: a brand fill per mode plus a two-stop gradient (hot → warm) like the original Blaze, and
 *  the text colour that sits ON a solid fill of it. Dark-mode gradients are vivid two-hue ramps; the
 *  light-mode gradient is derived from the (deeper, AA-safe) light fill so on-fill white text stays
 *  legible. The label colour is derived in {@link accentVars}. */
export interface AccentDef {
  id: string
  label: string
  /** solid brand fill, dark mode ("r g b") */
  dark: string
  /** solid brand fill, light mode (deeper, to clear WCAG AA as text + carry white on-fill text) */
  light: string
  /** dark-mode gradient start (the deeper/hotter end) */
  hotDark: string
  /** dark-mode gradient end (the lighter/warmer end) */
  warmDark: string
  /** text on a solid fill, dark mode (a near-black tint) */
  onDark: string
  /** text on a solid fill, light mode (white) */
  onLight: string
}

export const ACCENTS: AccentDef[] = [
  // Blaze = the original brand orange + its signature red-orange → orange gradient. Default.
  { id: 'blaze', label: 'Blaze', dark: '255 90 44', light: '194 65 12', hotDark: '255 77 46', warmDark: '255 122 30', onDark: '26 10 4', onLight: '255 255 255' },
  { id: 'lime', label: 'Lime', dark: '190 242 100', light: '77 124 15', hotDark: '132 204 22', warmDark: '190 242 100', onDark: '24 28 10', onLight: '255 255 255' },
  { id: 'blue', label: 'Blue', dark: '96 165 250', light: '37 99 235', hotDark: '59 130 246', warmDark: '34 211 238', onDark: '10 20 40', onLight: '255 255 255' },
  { id: 'violet', label: 'Violet', dark: '167 139 250', light: '124 58 237', hotDark: '139 92 246', warmDark: '217 70 239', onDark: '24 16 44', onLight: '255 255 255' },
  { id: 'cyan', label: 'Cyan', dark: '34 211 238', light: '14 116 144', hotDark: '34 211 238', warmDark: '45 212 191', onDark: '8 26 30', onLight: '255 255 255' },
  { id: 'rose', label: 'Rose', dark: '251 113 133', light: '225 29 72', hotDark: '244 63 94', warmDark: '236 72 153', onDark: '40 10 16', onLight: '255 255 255' },
]

export const DEFAULT_ACCENT = 'blaze'
export const DEFAULT_THEME: Theme = 'system'

export function accentDef(id: string | undefined): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS.find((a) => a.id === DEFAULT_ACCENT) ?? ACCENTS[0]
}

/** Whether the given theme resolves to dark right now (system → OS preference). */
export function resolveDark(theme: Theme | undefined): boolean {
  if (theme === 'light') return false
  if (theme === 'dark') return true
  // 'system' (or undefined)
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

/** Mix an "r g b" triple toward white (amt > 0) or black (amt < 0) by |amt| in 0..1. */
export function shade(triple: string, amt: number): string {
  const [r, g, b] = triple.split(/\s+/).map(Number)
  const target = amt >= 0 ? 255 : 0
  const k = Math.min(1, Math.abs(amt))
  const mix = (c: number) => Math.round(c + (target - c) * k)
  return `${mix(r)} ${mix(g)} ${mix(b)}`
}

/**
 * The full brand-token ramp the chosen accent resolves to in a given mode. The picker only stores an
 * accent id; everything the UI paints "Blaze" (fills, gradients, labels, shadows) reads these vars, so
 * setting them re-themes the whole brand — not just the legacy `--accent` outline colour.
 */
export function accentVars(accentId: string | undefined, dark: boolean): Record<string, string> {
  const a = accentDef(accentId)
  const fill = dark ? a.dark : a.light
  // dark mode uses the accent's bespoke two-hue gradient; light mode keeps both stops deep (derived
  // from the AA-safe light fill) so white on-fill text stays legible across the whole gradient.
  const hot = dark ? a.hotDark : shade(fill, -0.1)
  const warm = dark ? a.warmDark : shade(fill, 0.08)
  return {
    '--accent': fill, // legacy var (focus outline + text-lime/bg-lime utilities)
    '--color-accent': fill, // solid brand fill
    '--color-accent-hot': hot, // gradient start
    '--color-accent-warm': warm, // gradient end
    // accent-coloured TEXT on surfaces: lighten the fill in dark mode for AA; the light fill is already AA on white
    '--color-accent-label': dark ? shade(fill, 0.32) : fill,
    '--color-on-accent': dark ? a.onDark : a.onLight, // text on a solid fill
  }
}

/** Apply the resolved accent brand vars to an element (the <html> root in the app). */
export function applyAccentVars(root: HTMLElement, accentId: string | undefined, dark: boolean): void {
  const vars = accentVars(accentId, dark)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
}

/** Apply theme class + the accent's full brand ramp to <html>. Safe to call on every change. */
export function applyTheme(theme: Theme | undefined, accentId: string | undefined): void {
  if (typeof document === 'undefined') return
  const dark = resolveDark(theme)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.classList.toggle('light', !dark)
  applyAccentVars(root, accentId, dark)
}
