import { describe, it, expect, vi, afterEach } from 'vitest'
import { registerTelemetrySink } from '../lib/telemetry'
import { installGlobalErrorHandlers } from '../lib/globalErrors'

// The repo runs vitest under the `node` environment (no jsdom). installGlobalErrorHandlers accepts a
// target, so we drive it with a plain EventTarget and assert through the real telemetry path
// (handler → reportError → registered sink). reportError only forwards in production, so stub the env.
describe('installGlobalErrorHandlers', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    registerTelemetrySink(null)
  })

  function setup() {
    vi.stubEnv('NODE_ENV', 'production')
    const captureError = vi.fn()
    registerTelemetrySink({ captureError })
    const target = new EventTarget()
    const cleanup = installGlobalErrorHandlers(target as unknown as Window)
    return { captureError, target, cleanup }
  }

  function errorEvent(error: unknown, message: string): Event {
    const ev = new Event('error') as Event & { error?: unknown; message?: string }
    ev.error = error
    ev.message = message
    return ev
  }

  it('forwards uncaught errors with the window.onerror scope', () => {
    const { captureError, target, cleanup } = setup()
    const err = new Error('uncaught boom')
    target.dispatchEvent(errorEvent(err, 'uncaught boom'))
    expect(captureError).toHaveBeenCalledWith(err, expect.objectContaining({ scope: 'window.onerror' }))
    cleanup()
  })

  it('forwards unhandled promise rejections with the unhandledrejection scope', () => {
    const { captureError, target, cleanup } = setup()
    const reason = new Error('rejected')
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown }
    ev.reason = reason
    target.dispatchEvent(ev)
    expect(captureError).toHaveBeenCalledWith(reason, expect.objectContaining({ scope: 'unhandledrejection' }))
    cleanup()
  })

  it('falls back to the message when no error object is present', () => {
    const { captureError, target, cleanup } = setup()
    target.dispatchEvent(errorEvent(undefined, 'script error'))
    expect(captureError).toHaveBeenCalledWith('script error', expect.objectContaining({ scope: 'window.onerror' }))
    cleanup()
  })

  it('ignores empty resource-load error events (img/script 404s bubble with no error + empty message)', () => {
    const { captureError, target, cleanup } = setup()
    target.dispatchEvent(errorEvent(undefined, ''))
    expect(captureError).not.toHaveBeenCalled()
    cleanup()
  })

  it('cleanup removes the listeners so no further events are reported', () => {
    const { captureError, target, cleanup } = setup()
    cleanup()
    target.dispatchEvent(errorEvent(new Error('x'), 'x'))
    expect(captureError).not.toHaveBeenCalled()
  })
})
