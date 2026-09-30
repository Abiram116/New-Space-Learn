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
  saving,
}: {
  label: string
  hint?: string
  /** Shows the autosave tell beside the LABEL, not beside the control — the
   *  control is right-aligned, so anything appended to it shoves it sideways
   *  every time a save starts. The label column has slack to absorb it. */
  saving?: boolean
  children: ReactNode
  /** Drops the bottom rule. The last row's rule would double the container's
   *  own border and read as a heavier line than the ones above it. */
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-3 px-4 py-2.5 text-[14px]',
        !last && 'border-b border-line-soft',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          {saving && <SavingDot />}
        </div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-snug text-faint">{hint}</div>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
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
    <span className="flex items-center gap-1 text-[12px] text-sun-deep">
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
    <RowShell label={label} last={last} saving={saving}>
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
        className="h-10 w-20 max-md:h-11 rounded-[10px] border border-line bg-well px-2.5 text-right text-[14px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      />
      {suffix && <span className="text-[13px] text-muted">{suffix}</span>}
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
    <RowShell label={label} last={last} saving={saving} hint="Off when empty.">
      <input
        type="time"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-10 rounded-[10px] border border-line bg-well px-2.5 text-[14px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      />
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
    <RowShell label={label} last={last} saving={saving}>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-10 w-40 rounded-[10px] border border-line bg-well px-2.5 text-right text-[14px] text-ink sm:w-56 outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      />
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
    <RowShell label={label} last={last} saving={saving}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-10 rounded-[10px] border border-line bg-well px-2.5 text-[14px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </RowShell>
  )
}
