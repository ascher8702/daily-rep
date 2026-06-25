'use client'

import { useRouter } from 'next/navigation'
import TrialStart from '@/screens/TrialStart'

/** Reachable by a trialing user (trial banner / settings) to lock in a plan early. */
export default function SubscribePage() {
  const router = useRouter()
  return <TrialStart context="subscribe" onClose={() => router.back()} />
}
