import { describe, it, expect } from 'vitest'
import { emitToast, subscribeToast } from '../lib/toast'

describe('toast bus', () => {
  it('delivers messages to subscribers and stops after unsubscribe', () => {
    const got: string[] = []
    const unsub = subscribeToast((t) => got.push(t.message))
    emitToast('hello')
    expect(got).toEqual(['hello'])
    unsub()
    emitToast('again')
    expect(got).toEqual(['hello']) // unsubscribed listener no longer receives
  })

  it('fans out to multiple subscribers and is a no-op with none', () => {
    expect(() => emitToast('nobody listening')).not.toThrow()
    const a: string[] = []
    const b: string[] = []
    const ua = subscribeToast((t) => a.push(t.message))
    const ub = subscribeToast((t) => b.push(t.message))
    emitToast('x')
    expect(a).toEqual(['x'])
    expect(b).toEqual(['x'])
    ua()
    ub()
  })

  it('carries an optional action (e.g. Undo) through to subscribers', () => {
    let received: { label: string; ran: boolean } | null = null
    let ran = false
    const unsub = subscribeToast((t) => {
      if (t.action) received = { label: t.action.label, ran: false }
    })
    emitToast('Set removed', { label: 'Undo', onAction: () => { ran = true } })
    unsub()
    expect(received).toMatchObject({ label: 'Undo' })
    expect(ran).toBe(false) // not invoked until the user acts
  })

  it('defaults tone to "default" and passes an explicit "pr" tone through', () => {
    const tones: (string | undefined)[] = []
    const unsub = subscribeToast((t) => tones.push(t.tone))
    emitToast('plain')
    emitToast('Bench PR — est. 1RM 225 lb', undefined, 'pr')
    unsub()
    expect(tones).toEqual(['default', 'pr'])
  })
})
