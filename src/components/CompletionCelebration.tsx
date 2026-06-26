'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { playCompletionChime, celebrationHaptic } from '@/lib/celebrate'

interface Piece {
  id: number
  left: number // vw
  dx: number // px horizontal drift
  dy: number // px fall distance
  rot: number // deg
  dur: number // ms
  delay: number // ms
  size: number // px
  color: string
  round: boolean
}

// brand-themed confetti (follows the chosen accent) + a few festive constants
const COLORS = [
  'rgb(var(--color-accent))',
  'rgb(var(--color-accent-warm))',
  'rgb(var(--color-accent-hot))',
  'rgb(var(--color-recovery-fresh))',
  'rgb(var(--color-core))',
  '#FFFFFF',
]

/**
 * One-shot workout-completion celebration: a confetti burst over the hero plus the chime + success
 * haptic. Fires exactly once on mount; renders nothing (and skips the burst) under prefers-reduced-
 * motion, but still plays the (brief) chime/haptic. Mount it only on a FRESH completion.
 */
export default function CompletionCelebration({ count = 80 }: { count?: number }) {
  const fired = useRef(false)
  const [pieces, setPieces] = useState<Piece[]>([])

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    playCompletionChime()
    celebrationHaptic()

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduce) return

    const w = window.innerWidth || 390
    const h = window.innerHeight || 800
    const arr: Piece[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      left: 50 + (Math.random() * 2 - 1) * 8, // burst from near the badge
      dx: (Math.random() * 2 - 1) * w * 0.55, // fan out
      dy: h * (0.55 + Math.random() * 0.6), // and fall
      rot: (Math.random() * 2 - 1) * 720,
      dur: 1700 + Math.random() * 1000,
      delay: Math.random() * 140,
      size: 7 + Math.random() * 6,
      color: COLORS[i % COLORS.length],
      round: Math.random() < 0.5,
    }))
    setPieces(arr)
    const longest = Math.max(...arr.map((p) => p.dur + p.delay))
    const t = setTimeout(() => setPieces([]), longest + 200)
    return () => clearTimeout(t)
  }, [count])

  if (!pieces.length) return null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece absolute top-[15%] block"
          style={
            {
              left: `${p.left}vw`,
              width: p.size,
              height: p.size,
              background: p.color,
              borderRadius: p.round ? '9999px' : '2px',
              animationDuration: `${p.dur}ms`,
              animationDelay: `${p.delay}ms`,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
