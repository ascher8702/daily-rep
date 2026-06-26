// TODO(legal): have counsel review and fill the [bracketed] placeholders (legal entity, contact
// email, jurisdiction, age threshold) before charging or submitting to the app stores.
import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy · Daily Rep',
  description: 'How Daily Rep collects, uses, stores, and protects your data.',
  alternates: { canonical: '/privacy' },
}

export default function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 24, 2026">
      <p>
        This Privacy Policy explains how <strong>Daily Rep</strong> ([Legal Entity]) collects, uses, and
        protects your information when you use the app. Daily Rep is offline-first: your data lives on your
        device and is synced to our cloud so you can use it across devices.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account:</strong> your email address and password. Passwords are handled and hashed by our
          authentication provider — we never store your password in plain text.
        </li>
        <li>
          <strong>Profile:</strong> your name, training goal, experience level, units, available equipment,
          session length, focus/avoided muscles, target training days per week, optional self-reported
          gender, and bodyweight.
        </li>
        <li>
          <strong>Training data:</strong> your workouts and the sets you log — exercises, weights, reps, RPE,
          warm-up flags, rest preferences, session notes, duration, and the bodyweight recorded with each
          session.
        </li>
        <li>
          <strong>On-device data:</strong> app preferences and your latest state are cached locally so the app
          works offline.
        </li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>To provide the service and sync your data securely across your devices.</li>
        <li>
          To compute your stats, weight-progression suggestions, personal records, recovery, and trends.
        </li>
        <li>To maintain security, prevent abuse, and operate and improve the app.</li>
      </ul>

      <h2>Analytics</h2>
      <p>
        We derive aggregate, server-side metrics to understand usage and improve the product. Any
        cross-user or cohort figures are <strong>K-anonymized</strong> — suppressed unless a group is large
        enough that no individual can be identified. We do <strong>not</strong> sell your data and do{' '}
        <strong>not</strong> use third-party advertising trackers.
      </p>

      <h2>Where your data is stored</h2>
      <p>
        Your cloud data is stored with our infrastructure provider, <strong>Supabase</strong> (a hosted
        Postgres platform), and protected by row-level security so that only your account can read your data.
        Data is transmitted over encrypted connections (HTTPS).
      </p>

      <h2>Sharing</h2>
      <p>
        We share data only with Supabase as our hosting/auth/database processor, and where required by law.
        We do not share your data with advertisers or data brokers.
      </p>

      <h2>Retention</h2>
      <p>
        We keep your data while your account is active. When you delete your account (Settings → Delete
        account), we remove your cloud data and your account. Local on-device data is cleared when you sign
        out or reset the app.
      </p>
      <p>
        To prevent repeated abuse of the free trial, we retain a minimal record of which email addresses
        have already started a trial (a normalized form of the address) on a lawful-basis of our legitimate
        interest in preventing fraud. This record is kept after account deletion solely for that purpose and
        is not used to contact you or for any other use.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>Access &amp; portability:</strong> export your data anytime via Settings → Download my data.
        </li>
        <li>
          <strong>Correction:</strong> edit your profile and training data directly in the app.
        </li>
        <li>
          <strong>Deletion:</strong> delete your account and all associated cloud data via Settings → Delete
          account.
        </li>
        <li>
          Residents of the EU/UK (GDPR) and California (CCPA/CPRA) have additional rights; contact us to
          exercise them.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        Daily Rep is not directed to children under [13/16], and we do not knowingly collect their personal
        data.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy and will revise the “Last updated” date above. Material changes will be
        communicated in the app.
      </p>
    </LegalPage>
  )
}
