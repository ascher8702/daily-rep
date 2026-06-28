'use client'

import { Switch } from 'antd'

/**
 * The app's single on/off control — antd's Switch, themed to the Blaze brand by the global
 * ConfigProvider (see components/AntdProvider). Wrapping it here keeps every call site framework-
 * agnostic and gives one place to adjust toggle styling/behaviour.
 */
export function Toggle({
  on,
  onChange,
  disabled,
  id,
  ariaLabel,
}: {
  on: boolean
  onChange: () => void
  disabled?: boolean
  id?: string
  ariaLabel?: string
}) {
  return <Switch checked={on} onChange={() => onChange()} disabled={disabled} id={id} aria-label={ariaLabel} />
}
