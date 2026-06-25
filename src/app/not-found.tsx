import Link from 'next/link'

// Branded 404 for unmatched routes (replaces Next's default bare page).
export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-6 animate-fade-in">
      <div className="text-5xl font-extrabold text-fg/15 tabular-nums">404</div>
      <h1 className="text-xl font-extrabold mt-2">Page not found</h1>
      <p className="text-sm text-fg/55 mt-1.5 max-w-xs leading-snug">
        That page doesn’t exist. Let’s get you back to training.
      </p>
      <Link href="/" className="btn-primary mt-5">
        Back to Daily Rep
      </Link>
    </div>
  )
}
