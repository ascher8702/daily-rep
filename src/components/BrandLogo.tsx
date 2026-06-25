import { cx } from './ui/Button'

/**
 * Charge Bolt — the Daily Rep brand mark (a lightning bolt on a dark rounded tile), per the
 * `Daily Rep Logo - Charge Bolt` design. The orange gradient bolt + near-black tile are FIXED brand
 * colours (intentionally hard-coded brand art, not themeable UI tokens). The tile surface uses the
 * `on-accent` token (#1A0A04) so it matches the in-app brand black.
 *
 * Use `<BrandLogo wordmark tagline="Strength, measured" />` for the app-icon brand lockup
 * (Auth / Onboarding hero, splash), or `<ChargeBolt />` for the bare mark.
 */

export const CHARGE_BOLT_PATH = 'M58 8 L28 54 H46 L42 92 L74 42 H54 Z'

/** The bare lightning bolt. `dark` renders it in near-black (#180A04) for use on the gradient tile;
 *  otherwise it's the orange brand gradient (transparent background). */
export function ChargeBolt({ size = 40, dark = false, className }: { size?: number; dark?: boolean; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Daily Rep"
    >
      <defs>
        <linearGradient id="chargeBoltGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF4D2E" />
          <stop offset="1" stopColor="#FF7A1E" />
        </linearGradient>
      </defs>
      <path d={CHARGE_BOLT_PATH} fill={dark ? '#180A04' : 'url(#chargeBoltGrad)'} />
    </svg>
  )
}

/** App-icon brand lockup: the bolt on a dark tile, optionally with the wordmark + tagline below. */
export function BrandLogo({
  size = 64,
  wordmark = false,
  tagline,
  tile = 'dark',
  className,
}: {
  /** edge length of the icon tile in px */
  size?: number
  /** render the "Daily Rep" wordmark under the tile */
  wordmark?: boolean
  /** small uppercase tagline under the wordmark (only shown with `wordmark`) */
  tagline?: string
  /** `dark` = near-black tile + gradient bolt (for light/orange backgrounds, e.g. the Auth hero);
   *  `gradient` = orange gradient tile + dark bolt (the brand "Primary" lockup, for dark backgrounds) */
  tile?: 'dark' | 'gradient'
  className?: string
}) {
  const isGradient = tile === 'gradient'
  return (
    <div className={cx('inline-flex flex-col items-center', className)}>
      <span
        className={cx('grid place-items-center', isGradient ? 'bg-gradient-blaze shadow-button' : 'bg-on-accent shadow-lg')}
        style={{ width: size, height: size, borderRadius: size * 0.27 }}
      >
        <ChargeBolt size={size * 0.56} dark={isGradient} />
      </span>
      {wordmark && (
        <span
          className="mt-3 font-display font-black uppercase tracking-[-0.02em] leading-none"
          style={{ fontSize: size * 0.5 }}
        >
          Daily Rep
        </span>
      )}
      {wordmark && tagline && (
        <span className="mt-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-fg/45">
          {tagline}
        </span>
      )}
    </div>
  )
}

export default BrandLogo
