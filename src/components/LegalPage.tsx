import Link from 'next/link'
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '@/lib/support'

/** Minimal, signed-out-friendly chrome for the public legal pages (privacy / terms). Server component;
 *  the prose styling is applied via descendant selectors so the pages stay plain HTML. Blaze reading view
 *  (Archivo display title + section headers, Hanken body, blaze-label links) — matches the design mockup. */
export default function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="animate-fade-in px-5 pb-16">
      <header className="safe-top pt-5">
        <Link
          href="/"
          className="inline-flex items-center gap-0.5 min-h-[44px] text-[13px] font-semibold text-fg/50 active:text-fg/80 -ml-1"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Daily Rep
        </Link>
        <h1 className="font-display text-[26px] font-black uppercase tracking-[-0.02em] leading-[0.95] mt-2">
          {title}
        </h1>
        <p className="text-[12px] text-fg/40 mt-1.5">Last updated {updated}</p>
      </header>
      <div className="mt-[18px] space-y-3.5 text-[14px] leading-[1.65] text-fg/70 [&_h2]:font-display [&_h2]:mt-[22px] [&_h2]:mb-[7px] [&_h2]:text-[15px] [&_h2]:font-extrabold [&_h2]:text-fg [&_a]:text-blaze-label [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_strong]:text-fg/90 [&_strong]:font-semibold">
        {children}
      </div>
      <p className="mt-7 text-[13px] text-fg/40">
        Questions? Contact{' '}
        <a href={SUPPORT_MAILTO} className="text-blaze-label underline">
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>
  )
}
