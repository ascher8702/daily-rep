import { describe, it, expect, vi, afterEach } from 'vitest'
import { reportError, reportEvent } from '../lib/telemetry'

describe('telemetry seam', () => {
  afterEach(() => vi.unstubAllEnvs())

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
})
