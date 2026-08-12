import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { toneBar, toneTrack } from '../../lib/tone'
import type { Tone } from '../../api/types'

/** Small print. Set in mono because on a card this is where codes live. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('setcode-strong', className)}>{children}</div>
}

export function Chip({
  children,
  active,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { active?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
        active
          ? 'bg-brand-soft text-brand-deep ring-1 ring-brand/30'
          : 'bg-line-soft text-muted',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export function OutlinePill({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-line bg-raised px-3 py-1.5 text-[11.5px] font-semibold text-ink-3',
        'transition-colors hover:border-brand/40 hover:text-brand-deep cursor-pointer',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function ProgressBar({
  value,
  tone = 'brand',
  className,
}: {
  value: number
  tone?: Tone
  className?: string
}) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full', toneTrack[tone], className)}>
      <div
        className={cn('h-full w-full origin-left t-meter duration-500 ease-out', toneBar[tone])}
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, value / 100))})` }}
      />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 cursor-pointer',
        checked ? 'bg-brand' : 'bg-line',
        'ring-1 ring-inset',
        checked ? 'ring-brand-300/50' : 'ring-line-dash/60',
      )}
    >
      <span
        className={cn(
          'absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-transform duration-200',
          checked ? 'translate-x-5 bg-[#1a120f]' : 'translate-x-0 bg-ink-3',
        )}
      />
    </button>
  )
}

/** A stat block: the number leads at display weight, the label is small print. */
export function Stat({
  value,
  label,
  tone,
  className,
}: {
  value: string
  label: string
  tone?: 'brand' | 'sky' | 'mint' | 'sun' | 'coral'
  className?: string
}) {
  const toneText = tone
    ? {
        brand: 'text-brand',
        sky: 'text-sky',
        mint: 'text-mint',
        sun: 'text-sun',
        coral: 'text-coral',
      }[tone]
    : 'text-ink'
  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      <div className={cn('nameplate text-[30px] tabular-nums', toneText)}>{value}</div>
      <div className="setcode">{label}</div>
    </div>
  )
}
