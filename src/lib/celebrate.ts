// Workout-completion celebration: a synthesized "ta-da" chime (no audio asset → works offline) plus a
// success haptic. The chime is built from Web Audio oscillators so there's nothing to download and it
// theme-stays silent if the platform blocks audio.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) {
    try {
      ctx = new AC()
    } catch {
      return null
    }
  }
  return ctx
}

/**
 * Prime audio inside a user-gesture handler (e.g. tapping "Finish") so iOS unlocks playback for the
 * chime that fires on the next screen — iOS only allows an AudioContext to start from a real gesture.
 * Safe to call repeatedly / on platforms without Web Audio.
 */
export function unlockAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}

/** A short ascending major-chord arpeggio ("ta-da"), played via Web Audio. No-op if audio is blocked. */
export function playCompletionChime(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
  const master = c.createGain()
  master.gain.value = 0.5
  master.connect(c.destination)
  const start = c.currentTime + 0.02
  // C5 · E5 · G5 · C6 — a bright major arpeggio that resolves up an octave
  const notes = [523.25, 659.25, 783.99, 1046.5]
  notes.forEach((freq, i) => {
    const t = start + i * 0.085
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'triangle' // soft, bell-ish
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.015) // quick attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5) // gentle decay
    osc.connect(gain).connect(master)
    osc.start(t)
    osc.stop(t + 0.55)
  })
}

/** A celebratory success buzz (Android honours this; iOS Safari ignores the Vibration API). */
export function celebrationHaptic(): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate([0, 35, 45, 35, 45, 110])
  }
}
