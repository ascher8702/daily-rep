/** Lightweight placeholder shown for the one frame before the client store hydrates (AppShell
 *  !mounted), so a cold open doesn't flash an empty screen then pop the real layout in. Shaped
 *  like the Home screen (the default landing): greeting, today's-workout hero, recovery, stats. */
export default function HomeSkeleton() {
  return (
    <div className="px-5 pt-6 safe-top animate-pulse" aria-hidden="true">
      {/* greeting */}
      <div className="h-3 w-20 rounded bg-raised/60" />
      <div className="mt-2 h-7 w-52 rounded-lg bg-raised/70" />

      {/* today's workout hero */}
      <div className="mt-6 rounded-2xl border border-hairline/[0.08] bg-card/60 p-5">
        <div className="h-3 w-40 rounded bg-raised/60" />
        <div className="mt-3 h-7 w-36 rounded-lg bg-raised/70" />
        <div className="mt-2 h-3 w-44 rounded bg-raised/50" />
        <div className="mt-4 flex gap-2">
          <div className="h-6 w-20 rounded-full bg-raised/50" />
          <div className="h-6 w-24 rounded-full bg-raised/50" />
        </div>
        <div className="mt-4 space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-raised/60" />
              <div className="h-4 flex-1 rounded bg-raised/50" />
            </div>
          ))}
        </div>
        <div className="mt-4 h-12 w-full rounded-xl bg-raised/60" />
      </div>

      {/* recovery card */}
      <div className="mt-3.5 rounded-2xl border border-hairline/[0.08] bg-card/60 p-4">
        <div className="h-5 w-24 rounded bg-raised/60" />
        <div className="mt-3 flex gap-4">
          <div className="h-40 w-[38%] rounded-xl bg-raised/40" />
          <div className="flex-1 space-y-2 pt-1">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-3 w-full rounded bg-raised/40" />
            ))}
          </div>
        </div>
      </div>

      {/* stat strip */}
      <div className="mt-3.5 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl border border-hairline/[0.08] bg-card/60" />
        ))}
      </div>
    </div>
  )
}
