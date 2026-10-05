/**
 * The small pieces every part of the dock is built from, so the overview and
 * the panels read as one design rather than five.
 *
 * Three rules they enforce:
 *
 *   - **One primary action per screen**, always at the top and always the same
 *     shape (`DockAction`): orange, full width, with a sparkle. A screen that
 *     needs a second button gets a quiet one (`DockQuietButton`).
 *   - **An empty screen explains itself** (`DockEmpty`): what goes here, and how
 *     it gets here. "No decks yet." told nobody anything.
 *   - **A way out sits above the main button** (`DockLink`), in the same place
 *     on every panel, quiet enough never to be mistaken for it.
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'

/** A small ring, same construction as the page spinner. */
export function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none motion-reduce:border-t-current motion-reduce:opacity-60"
    />
  )
}

/**
 * A section heading in the dock. Plain words at reading size, not tiny mono
 * caps: the dock is read at arm's length beside a chat, and "MAKE FROM THIS
 * CHAT" in 11px grey was the first thing the owner called too small. A heading
 * can carry a short line under it (`hint`) and one control on the right
 * (`aside`) — Change, Edit, a count.
 */
export function DockSectionHead({
  step,
  id,
  children,
  aside,
  hint,
}: {
  step?: number
  id?: string
  children: ReactNode
  aside?: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex min-h-8 items-center gap-2">
        {step !== undefined && (
          <span
            aria-hidden
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-line-soft text-[11.5px] font-bold text-ink-3"
          >
            {step}
          </span>
        )}
        <h3 id={id} className="min-w-0 flex-1 truncate text-[14px] font-extrabold tracking-[-0.005em] text-ink">
          {children}
        </h3>
        {aside && <div className="ml-auto flex shrink-0 items-center">{aside}</div>}
      </div>
      {hint && <p className="text-[13px] leading-snug text-muted">{hint}</p>}
    </div>
  )
}

/** The one primary action on a screen. Busy stays live orange, not greyed out:
 *  the AI actively writing should read as more alive, not less. */
export function DockAction({
  busy = false,
  busyLabel,
  icon = 'sparkle',
  children,
  className,
  ...props
}: {
  busy?: boolean
  busyLabel?: string
  icon?: IconName
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      className={cn(
        'flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-brand px-4 py-2.5',
        'text-[15px] font-bold text-[#1a120f] t-control duration-200',
        busy ? 'animate-pulse cursor-default' : 'cursor-pointer hover:brightness-110 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100',
        className,
      )}
      {...props}
    >
      {busy ? <Spinner size={15} /> : <Icon name={icon} size={16} />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}

/** A secondary button: outlined, small, never the loudest thing on screen. */
export function DockQuietButton({
  icon,
  children,
  className,
  ...props
}: { icon?: IconName; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-raised px-3.5 py-1.5',
        'text-[13.5px] font-bold text-ink-2 t-control hover:border-brand/40 hover:text-ink',
        'disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  )
}

/** What an empty list is, and how things get into it. */
export function DockEmpty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line-dash bg-well/40 px-5 py-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-line-soft text-ink-2">
        <Icon name={icon} size={22} />
      </span>
      <p className="mt-1 text-[15px] font-bold text-ink">{title}</p>
      <p className="max-w-[28ch] text-[13.5px] leading-snug text-muted">{children}</p>
    </div>
  )
}

/** The way to the full page: a quiet text link, never competing with the main button. */
export function DockLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-10 items-center justify-center gap-1.5 rounded-md text-[13.5px] font-semibold text-muted transition-colors hover:text-brand-deep"
    >
      {children} <Icon name="arrowRight" size={14} />
    </Link>
  )
}

/**
 * Where a panel's way out and main button live. It follows the list, so with
 * three notes the button sits right under them instead of at the far bottom of
 * an empty column; with thirty it sticks to the bottom edge, so it is never
 * scrolled away. A short fade above it says there is more underneath.
 */
export function DockFooter({ children }: { children: ReactNode }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-10 -mx-3.5 -mb-3.5 mt-1 flex flex-col gap-1 bg-surface px-3.5 pb-3.5 pt-2',
        'before:pointer-events-none before:absolute before:inset-x-0 before:-top-5 before:h-5 before:bg-gradient-to-t before:from-surface before:to-transparent',
      )}
    >
      {children}
    </div>
  )
}

/** A thin meter for a score or a share, drawn with a transform so it costs no layout. */
export function DockMeter({ value, tone }: { value: number; tone: 'mint' | 'sun' | 'coral' | 'sky' | 'brand' }) {
  const bar = { mint: 'bg-mint', sun: 'bg-sun', coral: 'bg-coral', sky: 'bg-sky', brand: 'bg-brand' }[tone]
  return (
    <span aria-hidden className="block h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
      <span
        className={cn('block h-full w-full origin-left rounded-full t-meter duration-500', bar)}
        style={{ transform: `scaleX(${Math.min(1, Math.max(0.02, value / 100))})` }}
      />
    </span>
  )
}

/** The one small control a section heading can carry: Change, Edit. Turns
 *  solid while what it opened is open, so "Done" is plainly the way back. */
export function DockHeadButton({
  pressed = false,
  children,
  className,
  ...props
}: { pressed?: boolean; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-bold t-control duration-200',
        pressed
          ? 'bg-brand text-[#1a120f] hover:brightness-110'
          : 'border border-line text-brand-deep hover:border-brand/50 hover:bg-brand-soft',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
