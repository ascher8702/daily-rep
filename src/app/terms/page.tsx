import type { Metadata } from 'next'
import LegalPage from '@/components/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service · Daily Rep',
  description: 'The terms that govern your use of Daily Rep.',
  alternates: { canonical: '/terms' },
}

export default function TermsOfServicePage() {
  return (
    <LegalPage title="Terms of Service" updated="June 27, 2026">
      <p>
        These Terms of Service (“Terms”) govern your use of <strong>Daily Rep</strong> (operated by Vladislav
        Tsoy) (the
        “Service”). By creating an account or using the Service, you agree to these Terms and to our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>Health &amp; safety disclaimer</h2>
      <p>
        Daily Rep provides general fitness information and tracking tools and is{' '}
        <strong>not a substitute for professional medical or fitness advice, diagnosis, or treatment</strong>.
        Estimated values (such as estimated 1-rep max and recovery) are approximations, not measurements.
        Consult a qualified physician or licensed professional before starting, changing, or continuing any
        exercise program — especially if you have or may have an injury, illness, or other condition, or are
        pregnant. <strong>You exercise at your own risk.</strong> You are solely responsible for using proper
        form, selecting appropriate weights, and training safely; stop immediately and seek medical help if you
        feel unwell, dizzy, or experience pain.
      </p>
      <p>
        Features such as recovery estimates, generated workouts, training plans, exercise substitutions, and
        the “emphasize / working around” muscle preferences are{' '}
        <strong>conveniences based on the information you provide, not medical guidance</strong>. They do not
        detect, prevent, diagnose, or treat any injury or condition, and marking an area to “work around” does
        not guarantee that a workout, plan, or recommendation will avoid loading or aggravating it. Always use
        your own judgment and a professional’s advice over anything the Service suggests.
      </p>

      <h2>Assumption of risk &amp; release</h2>
      <p>
        Physical exercise carries inherent risks, including muscle strains, sprains, fractures, cardiac events,
        other serious injury, permanent disability, or death. By using the Service, you{' '}
        <strong>knowingly and voluntarily assume all risks</strong> associated with exercise and with following
        any information, workout, plan, or recommendation provided through the Service. To the maximum extent
        permitted by law, you <strong>release, waive, and hold harmless</strong> Vladislav Tsoy from any and
        all claims, demands, liabilities, or damages of any kind arising out of or related to your use of the
        Service or any injury, loss, or harm you may suffer, whether or not caused by negligence.
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
        To the maximum extent permitted by law, Vladislav Tsoy is{' '}
        <strong>not liable for any personal injury, death, or property damage</strong>, nor for any indirect,
        incidental, special, consequential, or punitive damages, arising out of or related to your use of the
        Service — including injuries connected to any exercise, weight, workout, training plan, exercise
        substitution, recovery estimate, or other recommendation generated or provided by the Service, and
        including any failure of the “working around” / injury-avoidance preferences to exclude a given
        movement. This applies regardless of the legal theory and even if we have been advised of the
        possibility of such damages. Where liability cannot be excluded, it is limited to the greater of the
        amount you paid for the Service in the 12 months before the claim or US$50. Some jurisdictions do not
        allow certain exclusions, so some of the above may not apply to you.
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
