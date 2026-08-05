/**
 * The Space Learn mark.
 *
 * Three cards fanned from a single corner — the binder's whole idea in one
 * shape: separate pieces of your material, held together, spreading open. The
 * foil tones run across them so the mark carries the palette without needing
 * the wordmark beside it.
 *
 * Deliberately not a generic sparkle or a rounded-square glyph; those are the
 * marks every tool ships, and they say nothing about what this one does.
 */

import { cn } from '../../lib/cn'

export function LogoMark({
  size = 28,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* Back card — cool foil, furthest of the fan. */}
      <rect
        x="4.2"
        y="9.6"
        width="14"
        height="19"
        rx="2.6"
        transform="rotate(-19 4.2 9.6)"
        fill="#2EE6D6"
        fillOpacity="0.32"
        stroke="#2EE6D6"
        strokeOpacity="0.55"
        strokeWidth="1.1"
      />
      {/* Middle card — gold. */}
      <rect
        x="9.6"
        y="6.6"
        width="14"
        height="19"
        rx="2.6"
        transform="rotate(-8 9.6 6.6)"
        fill="#FFC53D"
        fillOpacity="0.34"
        stroke="#FFC53D"
        strokeOpacity="0.6"
        strokeWidth="1.1"
      />
      {/* Front card — the flare, upright and solid: the one you're holding. */}
      <rect
        x="14.4"
        y="5.2"
        width="14"
        height="19.6"
        rx="2.8"
        transform="rotate(4 14.4 5.2)"
        fill="#FF5A3C"
        stroke="#FF8B76"
        strokeWidth="1.1"
      />
      {/* Two rules on the front card: a question and its answer. */}
      <path
        d="M18.4 12.2h6.6M18.4 15.6h4.3"
        stroke="#1A120F"
        strokeOpacity="0.62"
        strokeWidth="1.5"
        strokeLinecap="round"
        transform="rotate(4 14.4 5.2)"
      />
    </svg>
  )
}

/**
 * Mark plus wordmark.
 *
 * The lockup is alive rather than a fixed image: the mark's cards fan a little
 * wider on hover, and a foil highlight travels across the wordmark's letters —
 * the same iridescence the cards carry, so the identity behaves like the
 * material it's made of. Both settle back when you leave, and both stop
 * entirely under reduced motion.
 */
export function Logo({
  size = 28,
  className,
  textClassName,
}: {
  size?: number
  className?: string
  textClassName?: string
}) {
  return (
    <span className={cn('group/logo flex min-w-0 items-center gap-2.5', className)}>
      <span className="logo-mark inline-flex">
        <LogoMark size={size} />
      </span>
      <span
        className={cn(
          'logo-word relative nameplate truncate text-[19px] text-ink',
          textClassName,
        )}
        data-text="Space Learn"
      >
        Space Learn
      </span>

      <style>{`
        .logo-mark { transition: transform 420ms cubic-bezier(0.16,1,0.3,1); }
        .group\\/logo:hover .logo-mark { transform: rotate(-6deg) scale(1.06); }

        .logo-word::after {
          content: attr(data-text);
          position: absolute;
          inset: 0;
          background-image: linear-gradient(
            100deg,
            transparent 44%,
            rgba(255,197,61,0.9) 48%,
            rgba(46,230,214,0.9) 51%,
            rgba(255,61,139,0.9) 54%,
            transparent 59%
          );
          background-size: 260% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          pointer-events: none;
          animation: logoFoil 6s ease-in-out infinite;
        }
        @keyframes logoFoil {
          0%, 100% { background-position: 165% 0; }
          55%      { background-position: -65% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .logo-mark { transition: none; }
          .logo-word::after { animation: none; opacity: 0; }
        }
      `}</style>
    </span>
  )
}
