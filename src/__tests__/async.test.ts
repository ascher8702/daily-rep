import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { settleWithin } from '../lib/async'

describe('settleWithin', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('calls onValue and never onTimeout when the promise resolves in time', async () => {
    const onValue = vi.fn()
    const onError = vi.fn()
    const onTimeout = vi.fn()
    settleWithin(Promise.resolve('ok'), 8000, { onValue, onError, onTimeout })
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(8000)
    expect(onValue).toHaveBeenCalledWith('ok')
    expect(onTimeout).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError and never onTimeout when the promise rejects in time', async () => {
    const onValue = vi.fn()
    const onError = vi.fn()
    const onTimeout = vi.fn()
    const err = new Error('nope')
    settleWithin(Promise.reject(err), 8000, { onValue, onError, onTimeout })
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(8000)
    expect(onError).toHaveBeenCalledWith(err)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(onValue).not.toHaveBeenCalled()
  })

  it('fires onTimeout when the promise hangs, then still delivers a late resolve to onValue', async () => {
    const onValue = vi.fn()
    const onError = vi.fn()
    const onTimeout = vi.fn()
    let resolve!: (v: string) => void
    const hung = new Promise<string>((r) => { resolve = r })
    settleWithin(hung, 8000, { onValue, onError, onTimeout })

    vi.advanceTimersByTime(8000)
    expect(onTimeout).toHaveBeenCalledTimes(1)
    expect(onValue).not.toHaveBeenCalled()

    resolve('late')
    await vi.advanceTimersByTimeAsync(0)
    expect(onValue).toHaveBeenCalledWith('late') // slow-but-successful result is not dropped
    expect(onTimeout).toHaveBeenCalledTimes(1) // and the timeout never fires twice
  })
})
