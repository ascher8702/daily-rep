import { describe, it, expect } from 'vitest'
import { friendlyAuthError } from '../lib/auth'

const GENERIC = 'Something went wrong. Please try again.'

describe('friendlyAuthError', () => {
  it('never surfaces raw junk — falls back to the generic message', () => {
    expect(friendlyAuthError({ message: '{}' })).toBe(GENERIC)
    expect(friendlyAuthError({ message: '' })).toBe(GENERIC)
    expect(friendlyAuthError({ message: '[object Object]' })).toBe(GENERIC)
    expect(friendlyAuthError({ message: null })).toBe(GENERIC)
    expect(friendlyAuthError({ message: undefined })).toBe(GENERIC)
    expect(friendlyAuthError(null)).toBe(GENERIC)
    expect(friendlyAuthError(undefined)).toBe(GENERIC)
  })

  it('maps invalid credentials to a friendly message', () => {
    expect(friendlyAuthError({ message: 'Invalid login credentials' })).toBe(
      'Incorrect email or password.',
    )
    expect(friendlyAuthError({ code: 'invalid_credentials' })).toBe('Incorrect email or password.')
  })

  it('passes a normal human-readable message through unchanged', () => {
    expect(friendlyAuthError({ message: 'Password should be at least 8 characters.' })).toBe(
      'Password should be at least 8 characters.',
    )
  })

  it('maps an email-send failure to the friendly email message', () => {
    expect(friendlyAuthError({ code: 'over_email_send_rate_limit' })).toBe(
      'We could not send that email right now. Please try again in a few minutes.',
    )
    expect(friendlyAuthError({ code: 'unexpected_failure', message: '{}' })).toBe(
      'We could not send that email right now. Please try again in a few minutes.',
    )
    expect(friendlyAuthError({ message: 'Error sending confirmation email' })).toBe(
      'We could not send that email right now. Please try again in a few minutes.',
    )
  })
})
