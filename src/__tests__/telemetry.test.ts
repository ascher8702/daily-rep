import { describe, it, expect, vi, afterEach } from 'vitest'
import { reportError, reportEvent, registerTelemetrySink, hasTelemetrySink } from '../lib/telemetry'

describe('telemetry seam', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    registerTelemetrySink(null) // never leak a sink across tests
  })

  it('reportError logs in development and never throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => reportError(new Error('boom'), { scope: 'unit-test' })).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('reportError no-ops (no console) in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportError(new Error('boom'), { scope: 'unit-test' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('reportError never throws on odd inputs (undefined / string / no context)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => reportError(undefined)).not.toThrow()
    expect(() => reportError('a string error', {})).not.toThrow()
    expect(() => reportError({ weird: true })).not.toThrow()
    spy.mockRestore()
  })

  it('reportEvent logs in dev, no-ops in prod, never throws', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    expect(() => reportEvent('workout_started', { plan: 'ppl' })).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockReset()
    vi.stubEnv('NODE_ENV', 'production')
    reportEvent('workout_started')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('hasTelemetrySink reflects whether a backend is registered', () => {
    expect(hasTelemetrySink()).toBe(false)
    registerTelemetrySink({ captureError: () => {} })
    expect(hasTelemetrySink()).toBe(true)
    registerTelemetrySink(null)
    expect(hasTelemetrySink()).toBe(false)
  })

  it('forwards to a registered sink in production (so prod no longer ships blind)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const captureError = vi.fn()
    const captureEvent = vi.fn()
    registerTelemetrySink({ captureError, captureEvent })

    const err = new Error('boom')
    reportError(err, { scope: 'unit-test' })
    reportEvent('workout_started', { plan: 'ppl' })

    expect(captureError).toHaveBeenCalledWith(err, { scope: 'unit-test' })
    expect(captureEvent).toHaveBeenCalledWith('workout_started', { plan: 'ppl' })
  })

  it('a throwing sink never propagates out of reportError/reportEvent', () => {
    vi.stubEnv('NODE_ENV', 'production')
    registerTelemetrySink({
      captureError: () => { throw new Error('sink down') },
      captureEvent: () => { throw new Error('sink down') },
    })
    expect(() => reportError(new Error('boom'))).not.toThrow()
    expect(() => reportEvent('x')).not.toThrow()
  })

  it('does not forward to the sink in development (keeps dev quiet, avoids double-report)', () => {
    const captureError = vi.fn()
    registerTelemetrySink({ captureError })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    reportError(new Error('boom'))
    expect(captureError).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
