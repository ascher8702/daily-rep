import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// minimal Web Audio fakes so we can assert the chime wiring without a real audio stack
function fakeAudioContext(state: 'running' | 'suspended' = 'running') {
  const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(() => osc), start: vi.fn(), stop: vi.fn() }
  const gain = {
    gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn(() => gain),
  }
  return {
    state,
    currentTime: 0,
    resume: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
    destination: {},
    _osc: osc,
  }
}

// the module caches a singleton AudioContext, so reset module state between cases
beforeEach(() => vi.resetModules())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('celebrationHaptic', () => {
  it('fires a multi-pulse vibration pattern when supported', async () => {
    const vibrate = vi.fn()
    vi.stubGlobal('navigator', { vibrate })
    const { celebrationHaptic } = await import('../lib/celebrate')
    celebrationHaptic()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate.mock.calls[0][0].length).toBeGreaterThan(1) // a pattern, not a single buzz
  })

  it('no-ops when the Vibration API is absent (e.g. iOS Safari)', async () => {
    vi.stubGlobal('navigator', {})
    const { celebrationHaptic } = await import('../lib/celebrate')
    expect(() => celebrationHaptic()).not.toThrow()
  })
})

describe('playCompletionChime', () => {
  it('schedules a 4-note arpeggio through Web Audio', async () => {
    const ctx = fakeAudioContext('running')
    vi.stubGlobal('window', { AudioContext: vi.fn(() => ctx) })
    const { playCompletionChime } = await import('../lib/celebrate')
    playCompletionChime()
    expect(ctx.createOscillator).toHaveBeenCalledTimes(4) // C5 E5 G5 C6
    expect(ctx._osc.start).toHaveBeenCalled()
  })

  it('unlockAudio resumes a suspended context', async () => {
    const ctx = fakeAudioContext('suspended')
    vi.stubGlobal('window', { AudioContext: vi.fn(() => ctx) })
    const { unlockAudio } = await import('../lib/celebrate')
    unlockAudio()
    expect(ctx.resume).toHaveBeenCalled()
  })

  it('no-ops when Web Audio is unavailable', async () => {
    vi.stubGlobal('window', {})
    const { playCompletionChime } = await import('../lib/celebrate')
    expect(() => playCompletionChime()).not.toThrow()
  })
})
