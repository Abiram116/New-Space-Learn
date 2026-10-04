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
import { SectionLabel } from '../../components/ui/Bits'
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
 * A numbered section heading: 1 Sources, 2 How it answers, 3 Make something.
 * The numbers are the product in three beats — what the AI reads, how it
 * answers, what you make from it — so a stranger can read the dock top to
 * bottom and learn what the app does.
 */
export function DockSectionHead({
  step,
  id,
  children,
  aside,
}: {
  step?: number
  id?: string
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      {step !== undefined && (
        <span
          aria-hidden
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-line-soft font-mono text-[10.5px] font-bold text-ink-3"
        >
          {step}
        </span>
      )}
      <SectionLabel>
        <span id={id}>{children}</span>
      </SectionLabel>
      {aside && <div className="ml-auto flex shrink-0 items-center">{aside}</div>}
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
        'flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-brand px-3 py-2',
        'text-[13px] font-bold text-[#1a120f] t-control duration-200',
        busy ? 'animate-pulse cursor-default' : 'cursor-pointer hover:brightness-110 active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100',
        className,
      )}
      {...props}
    >
      {busy ? <Spinner size={13} /> : <Icon name={icon} size={14} />}
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
        'inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1',
        'text-[12px] font-bold text-ink-2 t-control hover:border-brand/40 hover:text-ink',
        'disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  )
}

/** What an empty list is, and how things get into it. */
export function DockEmpty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-line-dash bg-well/40 px-4 py-6 text-center">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-line-soft text-ink-3">
        <Icon name={icon} size={17} />
      </span>
      <p className="text-[13px] font-bold text-ink">{title}</p>
      <p className="max-w-[24ch] text-[12px] leading-snug text-muted">{children}</p>
    </div>
  )
}

/** The way to the full page: a quiet text link, never competing with the main button. */
export function DockLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex min-h-8 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold text-muted transition-colors hover:text-brand-deep"
    >
      {children} <Icon name="arrowRight" size={12} />
    </Link>
  )
}
