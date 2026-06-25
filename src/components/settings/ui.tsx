'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft } from '@/components/icons'

/** Back header for a settings subpage: round back button + uppercase title. */
export function BackHeader({ title, to = '/settings' }: { title: string; to?: string }) {
  const router = useRouter()
  return (
    <header className="safe-top px-5 pt-12 pb-2 flex items-center gap-3">
      <button onClick={() => router.push(to)} aria-label="Back" className="grid place-items-center h-[34px] w-[34px] rounded-full bg-raised text-fg/70">
        <ChevronLeft size={16} strokeWidth={2.2} />
      </button>
      <h1 className="text-[26px] font-black uppercase tracking-[-0.02em] font-display">{title}</h1>
    </header>
  )
}

/** Uppercase group label. `accent` paints it Blaze orange (the active/primary group). */
export function SectionLabel({ children, accent = false, className = '' }: { children: React.ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={`text-[11px] font-extrabold tracking-[0.12em] uppercase ${accent ? 'text-blaze-label' : 'text-fg/40'} ${className}`}>
      {children}
    </div>
  )
}

/** Selectable pill tile (goal / experience / units / equipment / rest). */
export function Tile({
  active,
  onClick,
  children,
  className = '',
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-center text-[13px] rounded-[11px] px-2 py-3 border transition ${
        active
          ? 'font-extrabold text-blaze-label bg-blaze/[0.12] border-blaze/40'
          : 'font-semibold text-fg/60 bg-raised border-hairline/[0.06]'
      } ${className}`}
    >
      {children}
    </button>
  )
}

/** Rounded-full selectable chip (focus muscles). */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-[13px] rounded-full px-3.5 py-2.5 border transition ${
        active ? 'font-extrabold text-blaze-label bg-blaze/[0.12] border-blaze/40' : 'font-semibold text-fg/65 bg-raised border-hairline/[0.06]'
      }`}
    >
      {children}
    </button>
  )
}
