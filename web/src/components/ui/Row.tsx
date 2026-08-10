/**
 * Labelled setting rows — a label on the left, a control on the right, hairline
 * rules between.
 *
 * These lived inside `Settings.tsx` and are not settings-specific: nothing in
 * any of them knows what a preference is. They are the generic "row in a
 * grouped list" pattern the platform conventions have used for years, and any
 * screen with a list of labelled controls wants them. Leaving them in
 * `Settings.tsx` is what made that file 656 lines and made every other screen
 * that needed a labelled row invent its own spacing.
 *
 * `RowShell` is the one that matters — every other export is it plus a control.
 * A new row type should be another thin wrapper here, not a bespoke flex
 * container somewhere else, because the moment two of them disagree about
 * padding the list stops reading as a list.
 */

import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Toggle } from './Bits'

export function RowShell({
  label,
  hint,
  children,
  last,
}: {
  label: string
  hint?: string
  children: ReactNode
  /** Drops the bottom rule. The last row's rule would double the container's
   *  own border and read as a heavier line than the ones above it. */
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3.5 py-3',
        !last && 'border-b border-line-soft',
      )}
    >
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="text-[11px] text-faint">{hint}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * The autosave tell. Lowercase and small on purpose — a save that happened
 * because you typed is not an achievement, and a bright "Saved!" badge on
 * every keystroke rewards you for using a text field.
 */
export function SavingDot() {
  return (
    <span className="flex items-center gap-1 text-[10px] text-sun-deep">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
      saving…
    </span>
  )
}

export function RowWithToggle({
  label,
  hint,
  checked,
  onChange,
  last,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  last?: boolean
}) {
  return (
    <RowShell label={label} hint={hint} last={last}>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </RowShell>
  )
}

export function RowWithNumber({
  label,
  value,
  suffix,
  onChange,
  saving,
  min,
  max,
  last,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (next: number) => void
  saving?: boolean
  min?: number
  max?: number
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value)
          // Guarded because an empty field parses to NaN, which would be
          // persisted and come back as a broken number input.
          if (Number.isFinite(n)) onChange(n)
        }}
        className="w-16 rounded-md border border-line bg-well px-2 py-1 text-right text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
      {saving && <SavingDot />}
    </RowShell>
  )
}

export function RowWithTime({
  label,
  value,
  onChange,
  saving,
  last,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
  saving?: boolean
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last} hint="Off when empty.">
      <input
        type="time"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-line bg-well px-2 py-1 text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      {saving && <SavingDot />}
    </RowShell>
  )
}

export function RowWithText({
  label,
  value,
  placeholder,
  onChange,
  saving,
  last,
}: {
  label: string
  value: string | null
  placeholder?: string
  onChange: (next: string | null) => void
  saving?: boolean
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last}>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-52 rounded-md border border-line bg-well px-2 py-1 text-right text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      {saving && <SavingDot />}
    </RowShell>
  )
}

export function RowWithSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  saving,
  last,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  saving?: boolean
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border border-line bg-well px-2 py-1 text-sm text-ink outline-none transition-colors focus:border-brand"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {saving && <SavingDot />}
    </RowShell>
  )
}
