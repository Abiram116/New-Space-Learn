import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { toneBar, toneTrack } from '../../lib/tone'
import type { Tone } from '../../api/types'

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-[11px] font-bold tracking-[0.09em] text-faint', className)}>
      {children}
    </div>
  )
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
        'rounded-full px-2.5 py-1 text-[11.5px] font-medium',
        active ? 'bg-brand-soft font-semibold text-brand' : 'bg-line-soft text-muted',
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
        'rounded-full border-[1.5px] border-line px-3 py-1.5 text-[11.5px] text-ink-3 transition-colors hover:border-brand-200 hover:text-brand cursor-pointer',
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
    <div className={cn('h-1.5 rounded-full', toneTrack[tone], className)}>
      <div
        className={cn('h-1.5 rounded-full transition-all', toneBar[tone])}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
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
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer',
        checked ? 'justify-end bg-brand' : 'justify-start bg-line',
      )}
    >
      <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
    </button>
  )
}

export function Stat({
  value,
  label,
  className,
}: {
  value: string
  label: string
  className?: string
}) {
  return (
    <div className={cn('text-center text-[11.5px] text-muted', className)}>
      <div className="font-display text-xl font-semibold text-ink">{value}</div>
      {label}
    </div>
  )
}
