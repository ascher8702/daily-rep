'use client'

import { useRouter } from 'next/navigation'
import { useStore, resolvePlan } from '@/store/useStore'
import { useAuth } from '@/store/useAuth'
import { useEntitlement } from '@/store/useEntitlement'
import { buildUserDataExport, downloadJson } from '@/lib/dataExport'
import { fmtDate } from '@/lib/format'
import { emitToast } from '@/lib/toast'
import { useConfirm } from '@/components/ConfirmProvider'
import { SectionLabel } from '@/components/settings/ui'
import { BoltMark } from '@/components/billing/shared'
import {
  SlidersIcon, CalendarIcon, ShieldCheckIcon, MoonIcon, DownloadIcon, RefreshIcon, LockIcon, KeyIcon, HeartPulseIcon, ChevronRight,
} from '@/components/icons'
import { activeAvoidances, avoidanceLabel } from '@/lib/injuries'

function HubRow({
  icon, tint = 'neutral', title, sub, badge, onClick, last,
}: {
  icon: React.ReactNode
  tint?: 'blaze' | 'lime' | 'neutral'
  title: string
  sub?: string
  badge?: { label: string; tone: 'lime' | 'blaze' | 'rose' }
  onClick: () => void
  last?: boolean
}) {
  const tintCls = tint === 'blaze' ? 'bg-blaze/[0.12] text-blaze-label' : tint === 'lime' ? 'bg-[#C6F24E]/[0.12] text-[#C6F24E]' : 'bg-raised text-fg/70'
  const badgeCls = badge?.tone === 'lime' ? 'text-[#C6F24E] bg-[#C6F24E]/[0.12]' : badge?.tone === 'rose' ? 'text-[#fb7185] bg-[#fb7185]/[0.12]' : 'text-blaze-label bg-blaze/[0.12]'
  return (
    <>
      <button onClick={onClick} className="w-full flex items-center gap-3 px-[15px] py-3.5 text-left active:bg-raised/40 transition">
        <span className={`grid place-items-center h-8 w-8 rounded-[9px] shrink-0 ${tintCls}`}>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-bold">{title}</div>
          {sub && <div className="text-[11.5px] text-fg/45 truncate">{sub}</div>}
        </div>
        {badge && <span className={`text-[10px] font-extrabold uppercase tracking-[0.03em] rounded-md px-[7px] py-1 ${badgeCls}`}>{badge.label}</span>}
        <ChevronRight size={14} className="text-fg/35 shrink-0" />
      </button>
      {!last && <div className="h-px bg-hairline/[0.06] ml-[54px]" />}
    </>
  )
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-card border border-hairline/10 overflow-hidden">{children}</div>
}

export default function SettingsPage() {
  const router = useRouter()
  const confirm = useConfirm()
  const profile = useStore((s) => s.profile)
  const activePlan = useStore((s) => s.activePlan)
  const customPlans = useStore((s) => s.customPlans)
  const workouts = useStore((s) => s.workouts)
  const current = useStore((s) => s.current)
  const loadSampleData = useStore((s) => s.loadSampleData)
  const authEmail = useAuth((s) => s.email)
  const signOut = useAuth((s) => s.signOut)
  const deleteAccount = useAuth((s) => s.deleteAccount)
  const ent = useEntitlement()

  const initial = (profile.name.trim()[0] || 'A').toUpperCase()
  const avoiding = activeAvoidances(profile)
  const injurySub = avoiding.length
    ? `Avoiding ${avoiding.map(avoidanceLabel).join(', ')}`
    : 'Train around an injury or a sore area'
  const activePlanName = activePlan ? resolvePlan(activePlan.planId, customPlans)?.name : undefined
  const fmt = (iso: string | null) => (iso ? fmtDate(new Date(iso).getTime()) : '')

  // Membership row summary + badge from entitlement state.
  let memberSub = 'Subscribe to unlock everything'
  let memberBadge: { label: string; tone: 'lime' | 'blaze' | 'rose' } | undefined
  if (ent.hasSubscription) {
    const planLabel = ent.plan === 'monthly' ? 'Monthly' : 'Annual'
    if (ent.cancelAtPeriodEnd) {
      memberSub = `Pro · ${planLabel} · ends ${fmt(ent.currentPeriodEnd)}`
      memberBadge = { label: 'Canceling', tone: 'rose' }
    } else if (ent.status === 'trialing') {
      memberSub = `Pro · ${planLabel} · free until ${fmt(ent.currentPeriodEnd)}`
      memberBadge = { label: 'Active', tone: 'lime' }
    } else {
      memberSub = `Pro · ${planLabel} · renews ${fmt(ent.currentPeriodEnd)}`
      memberBadge = { label: 'Active', tone: 'lime' }
    }
  } else if (ent.inTrial) {
    memberSub = `Free trial · ${ent.trialDaysLeft} day${ent.trialDaysLeft === 1 ? '' : 's'} left`
    memberBadge = { label: 'Trial', tone: 'blaze' }
  }
  const profileBadge = ent.hasSubscription ? 'Pro' : ent.inTrial ? 'Trial' : null

  const onLoadSample = async () => {
    const needsConfirm = workouts.length > 0 || current !== null || activePlan !== null
    if (!needsConfirm || (await confirm({ title: 'Load sample history?', body: 'This replaces your current history with ~8 weeks of sample sessions.', confirmLabel: 'Load sample', tone: 'danger' }))) {
      loadSampleData()
    }
  }
  const onExport = () => {
    const s = useStore.getState()
    const when = new Date().toISOString()
    downloadJson(`daily-rep-export-${when.slice(0, 10)}.json`, buildUserDataExport({ profile: s.profile, workouts: s.workouts, customPlans: s.customPlans, activePlan: s.activePlan, planProgress: s.planProgress, email: authEmail ?? null, when }))
  }
  const onDelete = async () => {
    if (!(await confirm({ title: 'Delete account?', body: 'This permanently deletes your account and ALL your data — profile, workouts and stats — from this device and the cloud. This cannot be undone.', confirmLabel: 'Delete account', tone: 'danger' }))) return
    const err = await deleteAccount()
    if (err) emitToast(`Couldn't delete account: ${err}`)
  }

  return (
    <div className="bg-bg min-h-[100dvh] text-fg px-5 safe-top animate-fade-in">
      <header className="pt-12 pb-1">
        <h1 className="text-[30px] font-black uppercase tracking-[-0.02em] font-display">Settings</h1>
        <p className="text-[13px] font-semibold text-fg/50 mt-0.5">Tune how Daily Rep builds your training.</p>
      </header>

      {/* Profile header → profile & appearance */}
      <button onClick={() => router.push('/settings/profile')} className="w-full mt-4 flex items-center gap-3.5 rounded-[18px] bg-card border border-hairline/10 p-4 text-left active:scale-[0.99] transition">
        <span className="grid place-items-center h-[54px] w-[54px] rounded-2xl bg-gradient-blaze text-on-accent text-2xl font-black shrink-0">{initial}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[18px] font-black truncate">{profile.name.trim() || 'Your profile'}</div>
          <div className="text-[12.5px] font-semibold text-fg/50 truncate mt-px">{authEmail ?? 'Local account'}</div>
        </div>
        {profileBadge && (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-on-accent bg-gradient-blaze rounded-md px-2.5 py-[5px] shrink-0">
            <BoltMark size={11} /> {profileBadge}
          </span>
        )}
      </button>

      <SectionLabel accent className="mt-[22px] mb-2.5">Training</SectionLabel>
      <Group>
        <HubRow icon={<SlidersIcon size={17} strokeWidth={1.9} />} tint="blaze" title="Training preferences" sub="Goal · experience · equipment" onClick={() => router.push('/settings/training')} />
        <HubRow icon={<CalendarIcon size={17} strokeWidth={1.9} />} tint="blaze" title="Training plan" sub={activePlanName ? `Following ${activePlanName}` : 'Push/Pull/Legs, Upper/Lower and more'} onClick={() => router.push('/plans')} />
        <HubRow icon={<HeartPulseIcon size={17} strokeWidth={1.9} />} tint="blaze" title="Injuries" sub={injurySub} badge={avoiding.length ? { label: `${avoiding.length}`, tone: 'rose' } : undefined} onClick={() => router.push('/settings/injuries')} last />
      </Group>

      <SectionLabel className="mt-[22px] mb-2.5">Account</SectionLabel>
      <Group>
        <HubRow icon={<ShieldCheckIcon size={17} strokeWidth={1.9} />} tint="lime" title="Membership" sub={memberSub} badge={memberBadge} onClick={() => router.push('/settings/membership')} />
        {authEmail && (
          <HubRow icon={<KeyIcon size={17} strokeWidth={1.9} />} title="Sign-in & security" sub="Email & password" onClick={() => router.push('/settings/account')} />
        )}
        <HubRow icon={<MoonIcon size={17} strokeWidth={1.9} />} title="Profile & appearance" sub="Name, body metrics, theme" onClick={() => router.push('/settings/profile')} last />
      </Group>

      <SectionLabel className="mt-[22px] mb-2.5">Data</SectionLabel>
      <Group>
        <HubRow icon={<DownloadIcon size={17} strokeWidth={1.9} />} title="Download my data" onClick={onExport} />
        <HubRow icon={<RefreshIcon size={17} strokeWidth={1.9} />} title="Load sample data" onClick={onLoadSample} />
        <HubRow icon={<LockIcon size={17} strokeWidth={1.9} />} title="Privacy &amp; Terms" onClick={() => router.push('/privacy')} last />
      </Group>

      <div className="flex gap-2.5 mt-6">
        <button onClick={signOut} className="flex-1 rounded-[13px] border border-hairline/10 bg-card text-fg/70 font-extrabold text-sm py-3.5 active:scale-[0.99] transition">Sign out</button>
        <button onClick={onDelete} className="flex-1 rounded-[13px] border border-[#fb7185]/40 bg-[#fb7185]/[0.06] text-[#fb7185] font-extrabold text-sm py-3.5 active:scale-[0.99] transition">Delete account</button>
      </div>

      <footer className="mt-9 mb-2 flex flex-col items-center text-center">
        <div className="text-[11px] text-fg/30">Daily Rep</div>
      </footer>
    </div>
  )
}
