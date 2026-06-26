'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HomeIcon, DumbbellIcon, ChartIcon, HistoryIcon, SettingsIcon } from './icons'

const TABS = [
  { to: '/', label: 'Today', Icon: HomeIcon, end: true },
  { to: '/library', label: 'Exercises', Icon: DumbbellIcon },
  { to: '/progress', label: 'Progress', Icon: ChartIcon },
  { to: '/history', label: 'History', Icon: HistoryIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

export default function BottomNav() {
  const pathname = usePathname()
  return (
    <nav className="sticky bottom-0 inset-x-0 z-30 bg-bg/[0.92] backdrop-blur-md border-t border-hairline/[0.08] safe-bottom">
      <div className="mx-auto max-w-md grid grid-cols-5">
        {TABS.map(({ to, label, Icon, end }) => {
          const isActive = end ? pathname === to : pathname.startsWith(to)
          // active tab is the fixed Blaze identity (decoupled from the accent picker), per the mockup
          return (
            <Link
              key={to}
              href={to}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[10px] transition ${
                isActive ? 'text-blaze-warm font-bold' : 'text-fg/40 font-semibold'
              }`}
            >
              <Icon size={23} strokeWidth={isActive ? 1.9 : 1.6} />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
