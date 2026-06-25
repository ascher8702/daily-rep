import { useEffect, useState } from 'react'

/** Re-renders on an interval so countdowns/elapsed times stay live. */
export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, active])
  return now
}
