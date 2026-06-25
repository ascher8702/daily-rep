import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CSS-variable palette so the whole app re-themes (light/dark + accent) by flipping a
        // root class — no per-component changes needed for ink/lime/fg usages.
        ink: {
          900: 'rgb(var(--ink-900) / <alpha-value>)',
          800: 'rgb(var(--ink-800) / <alpha-value>)',
          700: 'rgb(var(--ink-700) / <alpha-value>)',
          600: 'rgb(var(--ink-600) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
        },
        // themable foreground (replaces hardcoded text-white so light mode flips the text)
        fg: 'rgb(var(--fg) / <alpha-value>)',
        // accent — driven by the user's chosen accent + theme; `lime` kept as the class name
        // so the 133 existing lime usages need no change.
        lime: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          500: 'rgb(var(--accent) / <alpha-value>)',
          600: 'rgb(var(--accent) / <alpha-value>)',
        },

        // ---- Charge/Blaze namespace (redesign; primitives read from these) ----
        // surfaces
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        card: 'rgb(var(--color-card) / <alpha-value>)',
        raised: 'rgb(var(--color-raised) / <alpha-value>)',
        hairline: 'rgb(var(--color-border) / <alpha-value>)',
        // action accent (orange)
        blaze: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hot: 'rgb(var(--color-accent-hot) / <alpha-value>)',
          warm: 'rgb(var(--color-accent-warm) / <alpha-value>)',
          label: 'rgb(var(--color-accent-label) / <alpha-value>)',
        },
        'on-accent': 'rgb(var(--color-on-accent) / <alpha-value>)',
        // recovery / muscle-split semantics (mode-invariant)
        recovery: {
          fresh: 'rgb(var(--color-recovery-fresh) / <alpha-value>)',
          moderate: 'rgb(var(--color-recovery-moderate) / <alpha-value>)',
          rest: 'rgb(var(--color-recovery-rest) / <alpha-value>)',
        },
        split: {
          pull: 'rgb(var(--color-pull) / <alpha-value>)',
          core: 'rgb(var(--color-core) / <alpha-value>)',
          legs: 'rgb(var(--color-legs) / <alpha-value>)',
        },
      },
      fontFamily: {
        // Hanken Grotesk body / Archivo display — injected by next/font (layout.tsx)
        sans: ['var(--font-hanken)', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        display: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Blaze named type scale: [size, { lineHeight, letterSpacing?, fontWeight }]
        'display-lg': ['40px', { lineHeight: '0.9', letterSpacing: '-0.02em', fontWeight: '900' }],
        'display-md': ['30px', { lineHeight: '0.95', letterSpacing: '-0.02em', fontWeight: '900' }],
        'display-sm': ['26px', { lineHeight: '0.95', letterSpacing: '-0.02em', fontWeight: '900' }],
        'num-lg': ['40px', { lineHeight: '1', fontWeight: '900' }],
        'num-md': ['26px', { lineHeight: '1', fontWeight: '900' }],
        'num-sm': ['24px', { lineHeight: '1', fontWeight: '900' }],
        'num-xs': ['21px', { lineHeight: '1', fontWeight: '900' }],
        'heading-lg': ['26px', { lineHeight: '1.15', fontWeight: '800' }],
        'heading-md': ['23px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '800' }],
        'heading-sm': ['19px', { lineHeight: '1.1', letterSpacing: '-0.01em', fontWeight: '900' }],
        'body-lg': ['15px', { lineHeight: '1.4', fontWeight: '600' }],
        'body-md': ['14px', { lineHeight: '1.45', fontWeight: '600' }],
        'body-sm': ['13px', { lineHeight: '1.45', fontWeight: '600' }],
        'label-md': ['12px', { lineHeight: '1', letterSpacing: '0.1em', fontWeight: '800' }],
        'label-sm': ['11px', { lineHeight: '1', letterSpacing: '0.12em', fontWeight: '800' }],
        chip: ['12px', { lineHeight: '1', letterSpacing: '0.03em', fontWeight: '700' }],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        card: 'var(--radius-card)',
        hero: 'var(--radius-hero)',
        blaze: 'var(--radius-md)',
      },
      boxShadow: {
        button: 'var(--shadow-button)',
        'button-lg': 'var(--shadow-button-lg)',
        hero: 'var(--shadow-hero)',
        icon: 'var(--shadow-icon)',
        1: 'var(--shadow-1)',
      },
      backgroundImage: {
        // gradient-* prefix avoids colliding with the `blaze` color's bg-blaze (solid) utility
        'gradient-blaze': 'var(--gradient-blaze)',
        'gradient-blaze-h': 'var(--gradient-blaze-h)',
      },
      spacing: {
        hero: '18px',
        gutter: '20px',
        group: '26px',
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { transform: 'translateY(-120%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pop: {
          '0%': { transform: 'scale(0.96)', opacity: '0.6' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up 0.25s ease-out',
        'slide-down': 'slide-down 0.25s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        pop: 'pop 0.15s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
