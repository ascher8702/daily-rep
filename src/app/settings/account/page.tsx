'use client'

import { useState } from 'react'
import { useAuth } from '@/store/useAuth'
import { emitToast } from '@/lib/toast'
import { BackHeader, SectionLabel } from '@/components/settings/ui'
import { MailIcon, KeyIcon, LockIcon } from '@/components/icons'

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-card border border-hairline/10 p-4">{children}</div>
}

function Field({
  id, label, type, value, onChange, placeholder, autoComplete,
}: {
  id: string
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-fg/60 mb-1.5">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={type === 'email' ? 'email' : undefined}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl bg-raised border border-hairline/10 px-4 py-3.5 text-[15px] outline-none focus:border-blaze"
      />
    </div>
  )
}

function SaveButton({ busy, disabled, label }: { busy: boolean; disabled: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      className="w-full mt-1 rounded-[13px] bg-gradient-blaze text-on-accent font-black text-[15px] uppercase tracking-[0.03em] py-3.5 shadow-button active:scale-[0.99] disabled:opacity-40 disabled:active:scale-100 transition"
    >
      {busy ? 'Saving…' : label}
    </button>
  )
}

export default function AccountSecurityPage() {
  const email = useAuth((s) => s.email)
  const updateEmail = useAuth((s) => s.updateEmail)
  const updatePassword = useAuth((s) => s.updatePassword)

  // change email
  const [newEmail, setNewEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailErr, setEmailErr] = useState<string | null>(null)

  // change password
  const [pw, setPw] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState<string | null>(null)

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (emailBusy) return
    setEmailBusy(true)
    setEmailErr(null)
    const err = await updateEmail(newEmail)
    setEmailBusy(false)
    if (err) {
      setEmailErr(err)
    } else {
      setNewEmail('')
      emitToast('Check your new inbox to confirm the change.')
    }
  }

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwBusy) return
    if (pw !== pwConfirm) {
      setPwErr('Passwords don’t match')
      return
    }
    setPwBusy(true)
    setPwErr(null)
    const err = await updatePassword(pw)
    setPwBusy(false)
    if (err) {
      setPwErr(err)
    } else {
      setPw('')
      setPwConfirm('')
      emitToast('Password updated.')
    }
  }

  return (
    <div className="bg-bg min-h-[100dvh] text-fg animate-fade-in">
      <BackHeader title="Sign-in &amp; security" />
      <div className="px-5 pt-3.5 pb-12">
        {/* current account */}
        <div className="flex items-center gap-3 rounded-2xl bg-card border border-hairline/10 px-4 py-3.5">
          <span className="grid place-items-center h-9 w-9 rounded-[10px] bg-raised text-fg/70 shrink-0">
            <MailIcon size={17} strokeWidth={1.9} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-fg/40">Signed in as</div>
            <div className="text-[14.5px] font-bold truncate">{email ?? 'Local account'}</div>
          </div>
        </div>

        {/* change email */}
        <SectionLabel className="mt-[22px] mb-2.5">Change email</SectionLabel>
        <Card>
          <form onSubmit={submitEmail} className="space-y-3.5">
            <Field id="new-email" label="New email" type="email" value={newEmail} onChange={setNewEmail} placeholder="you@example.com" autoComplete="email" />
            {emailErr && (
              <div role="alert" className="rounded-xl bg-rose-400/10 border border-rose-400/30 px-3 py-2.5 text-sm text-rose-300">{emailErr}</div>
            )}
            <SaveButton busy={emailBusy} disabled={!newEmail} label="Send confirmation" />
          </form>
          <p className="mt-3 text-[11.5px] leading-snug text-fg/45">
            We&rsquo;ll email a confirmation link to your new address. The change takes effect once you confirm it.
          </p>
        </Card>

        {/* change password */}
        <SectionLabel className="mt-[22px] mb-2.5">Change password</SectionLabel>
        <Card>
          <form onSubmit={submitPassword} className="space-y-3.5">
            <Field id="account-new-password" label="New password" type="password" value={pw} onChange={setPw} placeholder="At least 8 characters" autoComplete="new-password" />
            <Field id="account-confirm-password" label="Confirm new password" type="password" value={pwConfirm} onChange={setPwConfirm} placeholder="Re-enter new password" autoComplete="new-password" />
            {pwErr && (
              <div role="alert" className="rounded-xl bg-rose-400/10 border border-rose-400/30 px-3 py-2.5 text-sm text-rose-300">{pwErr}</div>
            )}
            <SaveButton busy={pwBusy} disabled={!pw || !pwConfirm} label="Update password" />
          </form>
          <div className="mt-3 flex items-start gap-2">
            <KeyIcon size={13} className="text-fg/35 mt-0.5 shrink-0" strokeWidth={2} />
            <p className="text-[11.5px] leading-snug text-fg/45">
              Use at least 8 characters. If you signed in with Google or Apple, setting a password here adds email sign-in too.
            </p>
          </div>
        </Card>

        <div className="flex items-center justify-center gap-1.5 mt-6">
          <LockIcon size={13} className="text-fg/35" strokeWidth={2} />
          <span className="text-[11px] text-fg/40">Your credentials are encrypted and never shared.</span>
        </div>
      </div>
    </div>
  )
}
