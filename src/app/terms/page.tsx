import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service · Daily Rep',
  description: 'The terms that govern your use of Daily Rep.',
  alternates: { canonical: '/terms' },
}

export default function TermsOfServicePage() {
  return (
    <LegalPage title="Terms of Service" updated="June 24, 2026">
      <p>
        These Terms of Service (“Terms”) govern your use of <strong>Daily Rep</strong> (operated by Vladislav
        Tsoy) (the
        “Service”). By creating an account or using the Service, you agree to these Terms and to our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Health &amp; safety disclaimer</h2>
      <p>
        Daily Rep provides general fitness information and tracking tools and is{' '}
        <strong>not a substitute for professional medical or fitness advice</strong>. Estimated values (such
        as estimated 1-rep max and recovery) are approximations, not measurements. Consult a qualified
        professional before starting any exercise program. You exercise at your own risk and are responsible
        for training safely; stop and seek help if you feel unwell or experience pain.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 18 years old to use the Service.</li>
        <li>
          You are responsible for keeping your credentials secure and for activity under your account. One
          account per person.
        </li>
        <li>Provide accurate information and keep it up to date.</li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Don’t misuse the Service: no attempting to disrupt or gain unauthorized access, reverse-engineer,
        scrape, or use it to violate any law or another person’s rights.
      </p>

      <h2>Subscriptions &amp; payments</h2>
      <p>
        Daily Rep offers an optional paid subscription. Pricing is{' '}
        <strong>$7.99 per month</strong> or <strong>$59.99 per year</strong>, and new subscribers may be
        offered a <strong>30-day free trial</strong>. Subscriptions <strong>renew automatically</strong> at
        the end of each billing period unless you cancel beforehand. You can cancel at any time through the
        billing portal (Settings → Manage subscription); cancellation takes effect at the end of the current
        period, and you keep access until then. Except where required by law, payments are{' '}
        <strong>non-refundable</strong> and we do not provide refunds or credits for partial periods.
        Purchases made through the Apple App Store or Google Play are billed and managed by those stores and
        are also subject to their terms and refund policies.
      </p>

      <h2>Your content &amp; our content</h2>
      <p>
        Your training data is yours. The Service itself — including its software, design, exercise library,
        and content — is owned by Vladislav Tsoy and protected by intellectual-property laws. We grant you a
        personal, non-transferable license to use the Service.
      </p>

      <h2>Disclaimers</h2>
      <p>
        The Service is provided “as is” and “as available,” without warranties of any kind, including
        accuracy, fitness for a particular purpose, or uninterrupted availability.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Vladislav Tsoy is not liable for any indirect, incidental, or
        consequential damages, or for injury arising from your use of the Service.
      </p>

      <h2>Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time (Settings → Delete account). We may
        suspend or terminate access for violations of these Terms.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these Terms and will revise the “Last updated” date above. Continued use after changes
        means you accept the updated Terms.
      </p>

      <h2>Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of New Jersey, United States, without regard to
        conflict-of-laws rules.
      </p>
    </LegalPage>
  )
}
