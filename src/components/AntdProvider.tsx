'use client'

import { useEffect, useState } from 'react'
import { ConfigProvider, theme as antdTheme } from 'antd'
import { useStore } from '@/store/useStore'
import { accentDef, resolveDark } from '@/lib/theme'

/**
 * Global antd theme: maps antd's design tokens onto the app's Blaze brand so any antd component (the
 * Switch, for now) matches the rest of the UI — the user's accent drives `colorPrimary`, and the
 * dark/light algorithm follows the active theme. Wrapped by AntdRegistry (in the root layout) for
 * SSR-safe style extraction.
 */
export default function AntdProvider({ children }: { children: React.ReactNode }) {
  const accent = useStore((s) => s.profile.accent)
  const themePref = useStore((s) => s.profile.theme)

  // SSR / first paint: assume dark (the app's default + the no-flash script), then resolve accurately
  // on the client so a 'system' user can't flash the wrong algorithm.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted ? resolveDark(themePref) : true

  const a = accentDef(accent)
  const fill = dark ? a.dark : a.light // "r g b"

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: { colorPrimary: `rgb(${fill})` },
      }}
    >
      {children}
    </ConfigProvider>
  )
}
