/**
 * Small phone-only building blocks shared by cards, quizzes, notes and docs.
 * Rendered only behind `useIsMobile()` — the desktop layouts never import
 * from here at render time.
 */

import { useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { BottomSheet } from '../../components/ui/BottomSheet'
import './phone.css'

/** A 10ms tick where the platform has one; silent everywhere else. */
export function haptic(ms: number | number[] = 10): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not available — nothing to do */
  }
}

/** Reads a boolean flag that should only ever be shown once. Never throws. */
export function seenOnce(key: string): { seen: boolean; mark: () => void } {
  let seen = false
  try {
    seen = localStorage.getItem(key) === '1'
  } catch {
    /* private mode */
  }
  return {
    seen,
    mark: () => {
      try {
        localStorage.setItem(key, '1')
      } catch {
        /* ignore */
      }
    },
  }
}

/* ── Immersive top row ─────────────────────────────────────────────────── */

/**
 * Close ×, a big "3 / 12" in the middle, an optional right slot — and a thin
 * progress bar underneath. Used by card review and quiz taking.
 */
export function PhoneTopRow({
  onClose,
  closeLabel,
  current,
  total,
  noun,
  right,
  bar,
  closeDisabled,
}: {
  onClose: () => void
  closeLabel: string
  current: number
  total: number
  noun: string
  right?: ReactNode
  bar: ReactNode
  closeDisabled?: boolean
}) {
  return (
    <header className="shrink-0 px-2 pt-1" data-testid="phone-top-row">
      <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center">
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={closeLabel}
          className="phone-tap grid size-11 place-items-center rounded-full text-muted active:bg-line-soft disabled:opacity-40"
        >
          <Icon name="close" size={20} />
        </button>
        <p
          className="flex items-baseline gap-1.5 leading-none"
          aria-label={`${noun} ${current} of ${total}`}
        >
          <span className="nameplate text-[22px] tabular-nums text-ink" aria-hidden>
            {current}
          </span>
          <span className="nameplate text-[15px] tabular-nums text-faint" aria-hidden>
            / {total}
          </span>
        </p>
        <div className="flex justify-end pr-2">{right}</div>
      </div>
      <div className="px-2 pb-1">{bar}</div>
    </header>
  )
}

/* ── Page chrome for library lists ─────────────────────────────────────── */

export function PhoneTitle({
  title,
  sub,
  right,
  onBack,
  backLabel = 'Back',
  hideTitle = false,
}: {
  title: string
  sub?: string
  right?: ReactNode
  onBack?: () => void
  backLabel?: string
  /** The phone's top bar already names the section — say it to screen readers
   *  only and let the visible line be the useful one (the count, the status). */
  hideTitle?: boolean
}) {
  return (
    <div className={cn('flex shrink-0 items-center gap-1 px-4', hideTitle ? 'min-h-12 pb-1 pt-1' : 'pb-2 pt-3')}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          className="phone-tap -ml-2 grid size-11 shrink-0 place-items-center rounded-full text-ink-3 active:bg-line-soft"
        >
          <Icon name="arrowLeft" size={20} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1
          className={cn(
            hideTitle
              ? 'sr-only'
              : 'nameplate line-clamp-2 break-words text-[24px] leading-tight text-ink',
          )}
        >
          {title}
        </h1>
        {sub && (
          <p className={cn('truncate', hideTitle ? 'text-[15px] text-ink-2' : 'text-[13px] text-muted')}>{sub}</p>
        )}
      </div>
      {right}
    </div>
  )
}

/** Scrolls sideways under the title; bleeds to the screen edge. */
export function ChipRow<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('phone-chips flex shrink-0 gap-2 overflow-x-auto px-4 pb-2', className)}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'phone-tap inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-semibold',
              on
                ? 'border-brand/40 bg-brand-soft text-brand-deep'
                : 'border-line bg-surface text-ink-3 active:bg-raised',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn('text-[12.5px] tabular-nums', on ? 'text-brand-deep/80' : 'text-faint')}>
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** One edge-to-edge list row: a wide tap target, and a ⋯ for everything else. */
export function ListRow({
  onOpen,
  onMore,
  moreLabel,
  children,
  trailing,
  className,
}: {
  onOpen: () => void
  onMore?: () => void
  moreLabel?: string
  children: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <li className="flex items-stretch border-b border-line-soft">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'phone-tap flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left active:bg-surface',
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</span>
        {trailing}
      </button>
      {onMore ? (
        <button
          type="button"
          onClick={onMore}
          aria-label={moreLabel ?? 'More actions'}
          className="phone-tap grid w-12 shrink-0 place-items-center text-faint active:bg-surface"
        >
          <Icon name="more" size={18} />
        </button>
      ) : (
        <span className="w-2 shrink-0" aria-hidden />
      )}
    </li>
  )
}

/* ── ⋯ bottom sheet ────────────────────────────────────────────────────── */

export type SheetAction = {
  label: string
  icon: IconName
  onSelect: () => void
  danger?: boolean
}

export function ActionSheet({
  open,
  title,
  actions,
  onClose,
}: {
  open: boolean
  title?: string
  actions: SheetAction[]
  onClose: () => void
}) {
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <ul className="flex flex-col">
        {actions.map((a) => (
          <li key={a.label}>
            <button
              type="button"
              onClick={() => {
                onClose()
                a.onSelect()
              }}
              className={cn(
                'phone-tap flex min-h-14 w-full items-center gap-3.5 rounded-xl px-2 text-left text-[16px] font-semibold active:bg-line-soft',
                a.danger ? 'text-coral-deep' : 'text-ink',
              )}
            >
              <Icon name={a.icon} size={19} />
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  )
}

/** Holds "which row's sheet is open" so lists don't each re-derive it. */
export function useRowSheet<T>() {
  const [target, setTarget] = useState<T | null>(null)
  return { target, open: (t: T) => setTarget(t), close: () => setTarget(null) }
}

/* ── Two drawn icons the shared set doesn't have ───────────────────────── */

export function CameraIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="12.5" r="3.4" />
    </svg>
  )
}

export function FolderIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l1.8 2H18.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
    </svg>
  )
}
