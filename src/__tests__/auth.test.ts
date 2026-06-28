import { describe, it, expect, beforeEach } from 'vitest'
import { hashPassword, emailValid, passwordIssue, normalizeEmail, nameFromEmail } from '../lib/auth'
import { useAuth } from '../store/useAuth'
import { useStore } from '../store/useStore'

beforeEach(() => {
  useAuth.setState({ email: null, localOnly: false, pending: null })
  useStore.getState().resetAll()
})

describe('nameFromEmail (onboarding prefill)', () => {
  it('title-cases the local part and splits on separators', () => {
    expect(nameFromEmail('jane.doe@example.com')).toBe('Jane Doe')
    expect(nameFromEmail('john_smith@x.io')).toBe('John Smith')
  })
  it('strips digits from the local part', () => {
    expect(nameFromEmail('vlad8702@gmail.com')).toBe('Vlad')
  })
  it('returns empty string when nothing usable remains', () => {
    expect(nameFromEmail('12345@x.com')).toBe('')
    expect(nameFromEmail('')).toBe('')
  })
})

describe('auth helpers', () => {
  it('hashPassword is deterministic per salt and varies by salt', async () => {
    const a = await hashPassword('hunter2', 'salt1')
    const b = await hashPassword('hunter2', 'salt1')
    const c = await hashPassword('hunter2', 'salt2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('validates email + password and normalizes email', () => {
    expect(emailValid('a@b.com')).toBe(true)
    expect(emailValid('nope')).toBe(false)
    expect(passwordIssue('1234567')).toBeTruthy() // 7 chars — below the ≥8 sign-up floor
    expect(passwordIssue('12345678')).toBeNull() // 8 chars — acceptable
    expect(normalizeEmail('  A@B.COM ')).toBe('a@b.com')
  })
})

describe('useAuth (Supabase-backed)', () => {
  it('validates email + password locally before any network call', async () => {
    expect(await useAuth.getState().signUp('bad-email', 'secret1')).toMatch(/email/i)
    expect(await useAuth.getState().signUp('a@b.com', '123')).toMatch(/8 characters/i)
  })

  it('reports cloud-not-configured when Supabase env is absent (offline/test)', async () => {
    // the test env has no NEXT_PUBLIC_SUPABASE_* vars, so the client is null and auth degrades safely
    // password is ≥8 so it clears the local length check and reaches the not-configured branch
    expect(await useAuth.getState().signUp('a@b.com', 'secret12')).toMatch(/not configured/i)
    expect(await useAuth.getState().signIn('a@b.com', 'secret12')).toMatch(/not configured/i)
  })

  it('has no anonymous / local-only escape hatch (account required)', () => {
    const s = useAuth.getState() as unknown as Record<string, unknown>
    expect('continueLocal' in s).toBe(false)
    expect('enableCloud' in s).toBe(false)
  })

  it('scrubs local app data on sign-out so another account cannot inherit it', async () => {
    useStore.setState({
      profile: { ...useStore.getState().profile, onboarded: true, name: 'Account A' },
      workouts: [{ id: 'w-a', title: 'Private workout' } as never],
    })

    await useAuth.getState().signOut()

    expect(useStore.getState().workouts).toEqual([])
    expect(useStore.getState().profile.onboarded).toBe(false)
    expect(useAuth.getState()).toMatchObject({ email: null, localOnly: false, pending: null, recovering: false })
  })
})
