/**
 * Building blocks for the Settings page: the section card, the labelled row,
 * the spring switch, the autosave tell and the small live previews.
 *
 * Motion rules, all of them: transform and opacity (plus a stroke offset on
 * two tiny SVG gauges), nothing that animates layout, blur or shadow, and
 * every one of them stands still under `prefers-reduced-motion`.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../../components/ui/Icon'
import { useReducedMotion } from '../../components/ui/motion'
import { cn } from '../../lib/cn'

/** Slight overshoot — the "spring" in the switch thumb and the nav indicator. */
export const SPRING = 'var(--ease-spring, cubic-bezier(0.34, 1.45, 0.64, 1))'

// ── Autosave tell ──────────────────────────────────────────────────────

function Tell({ kind }: { kind: 'saving' | 'saved' }) {
  const reduced = useReducedMotion()
  const [on, setOn] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  const enter = cn('t-move duration-200 ease-out motion-reduce:transition-none', on ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0')
  if (kind === 'saving') {
    return (
      <span className={cn('flex items-center gap-1.5 text-[12px] text-sun-deep', enter)}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun motion-reduce:animate-none" />
        saving…
      </span>
    )
  }
  return (
    <span role="status" className={cn('flex items-center gap-1 text-[12px] text-jade-deep', enter)}>
      <span
        aria-hidden
        className={cn('grid h-4 w-4 place-items-center rounded-full bg-jade-soft t-move duration-300 motion-reduce:transition-none', on ? 'scale-100' : 'scale-50')}
        style={{ transitionTimingFunction: SPRING }}
      >
        <Icon name="check" size={10} />
      </span>
      saved
    </span>
  )
}

/** "saving…" → "saved ✓", then gone. Remounts per state so each one arrives. */
export function SaveTell({ saving, saved }: { saving?: boolean; saved?: boolean }) {
  if (saving) return <Tell key="saving" kind="saving" />
  if (saved) return <Tell key="saved" kind="saved" />
  return null
}

// ── Cards and rows ─────────────────────────────────────────────────────

export function SettingsCard({
  icon,
  title,
  hint,
  tell,
  tone = 'default',
  children,
  className,
}: {
  icon?: IconName
  title: string
  hint?: string
  tell?: ReactNode
  tone?: 'default' | 'danger' | 'hero'
  children: ReactNode
  className?: string
}) {
  const danger = tone === 'danger'
  return (
    <section
      className={cn(
        't-control h-full rounded-2xl border p-5 max-sm:p-4',
        danger
          ? 'border-coral/35 bg-coral-soft/25'
          : tone === 'hero'
            ? 'border-brand/25 bg-gradient-to-br from-brand-tint via-surface to-surface p-6 hover:border-brand/45 max-sm:p-4'
            : 'border-line bg-surface hover:border-line-dash',
        className,
      )}
    >
      <header className="mb-4 flex items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-[11px]',
              danger ? 'bg-coral-soft text-coral-deep' : 'bg-brand-soft text-brand-deep',
            )}
          >
            <Icon name={icon} size={17} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-h-5 items-center gap-2">
            <h3 className={cn('font-display font-semibold leading-tight', tone === 'hero' ? 'text-[18px]' : 'text-[16px]', danger ? 'text-coral-deep' : 'text-ink')}>{title}</h3>
            {tell}
          </div>
          {hint && <p className="mt-1 text-[13px] leading-snug text-muted">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  )
}

/** A label, its hint and a control — rules between rows, none after the last. */
export function SettingRow({
  label,
  hint,
  saving,
  saved,
  children,
  last,
}: {
  label: string
  hint?: string
  saving?: boolean
  saved?: boolean
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className={cn('flex min-h-14 items-center gap-4 py-3 text-[14px]', !last && 'border-b border-line-soft')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium text-ink">
          <span>{label}</span>
          <SaveTell saving={saving} saved={saved} />
        </div>
        {hint && <div className="mt-0.5 text-[12.5px] leading-snug text-faint">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** The app's switch, with a springier thumb. Same role and name as `Toggle`. */
export function SpringSwitch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className='group relative grid h-6 w-11 shrink-0 cursor-pointer place-items-center max-md:h-11 max-md:w-12 before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[""] max-md:before:hidden'
    >
      <span
        aria-hidden
        className={cn(
          'relative block h-6 w-11 rounded-full ring-1 ring-inset transition-colors duration-200 group-hover:ring-2',
          checked ? 'bg-brand ring-brand-300/50' : 'bg-line ring-line-dash/60',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.5)] transition-[translate,scale,background-color] duration-300 group-active:scale-90 motion-reduce:transition-none',
            checked ? 'translate-x-5 bg-[#1a120f]' : 'translate-x-0 bg-ink-3',
          )}
          style={{ transitionTimingFunction: SPRING }}
        />
      </span>
    </button>
  )
}

// ── Choices ────────────────────────────────────────────────────────────

/** A selectable card with an icon — the first-run choices, as cards. */
export function OptionCard({
  on,
  role,
  icon,
  label,
  hint,
  onClick,
}: {
  on: boolean
  role: 'checkbox' | 'radio'
  icon: IconName
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={cn(
        't-control group flex min-h-16 cursor-pointer items-start gap-3 rounded-[14px] border p-3 text-left hover:-translate-y-px active:scale-[0.985] motion-reduce:transform-none',
        on ? 'border-brand/60 bg-brand-soft' : 'border-line bg-raised hover:border-line-dash',
      )}
    >
      <span
        aria-hidden
        className={cn(
          't-control grid h-9 w-9 shrink-0 place-items-center rounded-[10px]',
          on ? 'bg-brand text-[#1a120f]' : 'bg-well text-ink-3 group-hover:text-ink',
        )}
      >
        <Icon name={on && role === 'checkbox' ? 'check' : icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[14px] font-semibold leading-tight', on ? 'text-brand-deep' : 'text-ink')}>{label}</span>
        <span className="mt-1 block text-[12.5px] leading-snug text-muted">{hint}</span>
      </span>
    </button>
  )
}

/** A segmented control whose thumb slides between options (transform only). */
export function Segmented({
  label,
  options,
  value,
  onPick,
}: {
  label: string
  options: { value: string; label: string }[]
  /** Index into `options`, or -1 when none is chosen. */
  value: number
  onPick: (value: string) => void
}) {
  const n = options.length
  return (
    <div role="radiogroup" aria-label={label} className="relative grid rounded-[13px] bg-well p-1" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
      <span
        aria-hidden
        data-index={value}
        className={cn(
          'absolute inset-y-1 left-1 rounded-[10px] bg-brand-soft ring-1 ring-brand/50 t-move duration-300 motion-reduce:transition-none',
          value < 0 && 'opacity-0',
        )}
        style={{ width: `calc((100% - 0.5rem) / ${n})`, transform: `translateX(${Math.max(value, 0) * 100}%)`, transitionTimingFunction: SPRING }}
      />
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === i}
          onClick={() => onPick(o.value)}
          className={cn(
            'relative z-10 min-h-10 cursor-pointer rounded-[10px] px-2 text-[13.5px] t-control max-md:min-h-11',
            value === i ? 'font-semibold text-brand-deep' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        't-control min-h-10 cursor-pointer rounded-full border px-4 text-[13.5px] hover:-translate-y-px active:scale-95 max-md:min-h-11 motion-reduce:transform-none',
        on ? 'border-brand/60 bg-brand-soft font-semibold text-brand-deep' : 'border-line bg-raised text-ink-2 hover:border-line-dash',
      )}
    >
      {children}
    </button>
  )
}

// ── Live previews (drawn from the student's own values) ────────────────

const GAUGE_EASE = 'stroke-dashoffset 500ms var(--ease-out-expo)'

function Gauge({ frac, size, stroke, ticks, children, tint }: { frac: number; size: number; stroke: number; ticks?: number; children: ReactNode; tint: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const f = Math.min(1, Math.max(0, frac))
  const reduced = useReducedMotion()
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
        {ticks &&
          Array.from({ length: ticks }, (_, i) => {
            const a = (i / ticks) * 2 * Math.PI
            const x1 = size / 2 + Math.cos(a) * (r - stroke)
            const y1 = size / 2 + Math.sin(a) * (r - stroke)
            const x2 = size / 2 + Math.cos(a) * (r - stroke - 3)
            const y2 = size / 2 + Math.sin(a) * (r - stroke - 3)
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={1} className="stroke-line-dash" />
          })}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f)}
          className={tint}
          style={{ transition: reduced ? 'none' : GAUGE_EASE }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  )
}

/** The daily goal as a ring that fills toward 100 cards. */
export function GoalRing({ goal }: { goal: number }) {
  return (
    <Gauge frac={goal / 100} size={104} stroke={8} tint="stroke-brand">
      <span className="leading-none">
        <span className="block font-display text-[22px] font-semibold text-ink tabular-nums">{goal}</span>
        <span className="mt-0.5 block text-[10.5px] uppercase tracking-wider text-faint">a day</span>
      </span>
    </Gauge>
  )
}

/** A session as a slice of the clock face — a full circle is an hour. */
export function SessionDial({ minutes }: { minutes: number }) {
  return (
    <Gauge frac={minutes / 60} size={104} stroke={8} ticks={12} tint="stroke-sky">
      <span className="leading-none">
        <span className="block font-display text-[22px] font-semibold text-ink tabular-nums">{minutes}</span>
        <span className="mt-0.5 block text-[10.5px] uppercase tracking-wider text-faint">min</span>
      </span>
    </Gauge>
  )
}

/** Seven days: the streak so far, and a spare day when a freeze is on. */
export function StreakDots({ days, freeze }: { days: number; freeze: boolean }) {
  const lit = Math.min(days, 7)
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <span
          key={i}
          className={cn('h-2.5 w-2.5 rounded-full t-control', i < lit ? 'bg-brand' : 'bg-line')}
        />
      ))}
      <span
        className={cn(
          'ml-1 grid h-5 w-5 place-items-center rounded-full border border-dashed t-control',
          freeze ? 'border-sky text-sky' : 'border-line-dash text-transparent',
        )}
      >
        <Icon name="seal" size={11} />
      </span>
    </div>
  )
}

// ── Number stepper ─────────────────────────────────────────────────────

const clampInt = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)))

/**
 * A number you can nudge: – and + either side of a centred field. Holding a
 * button repeats; ArrowUp/Down step, PageUp/Down take bigger steps, Home/End
 * jump to the limits. Changes save once they settle (one request per burst),
 * and typing saves on Enter or leaving the field. No native spinner anywhere.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  unit,
  label,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  label: string
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const cur = useRef(value)
  const committed = useRef(value)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hold = useRef<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    cur.current = value
    committed.current = value
    setDraft(String(value))
  }, [value])
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current)
      if (hold.current) clearTimeout(hold.current)
    },
    [],
  )

  const flush = () => {
    if (settle.current) clearTimeout(settle.current)
    settle.current = null
    if (cur.current !== committed.current) {
      committed.current = cur.current
      onCommit(cur.current)
    }
  }
  const set = (n: number, soon = true) => {
    const next = clampInt(n, min, max)
    cur.current = next
    setDraft(String(next))
    if (settle.current) clearTimeout(settle.current)
    if (soon) settle.current = setTimeout(flush, 450)
  }
  const nudge = (d: number) => set(cur.current + d)
  const stop = () => {
    if (hold.current) {
      clearTimeout(hold.current)
      clearInterval(hold.current as ReturnType<typeof setInterval>)
      hold.current = null
      flush()
    }
  }
  const press = (d: number) => {
    nudge(d)
    hold.current = setTimeout(() => {
      hold.current = setInterval(() => nudge(d), 70)
    }, 400)
  }
  const typed = () => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n)) return setDraft(String(cur.current))
    set(n, false)
    flush()
  }

  const btn =
    't-control grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-[11px] border border-line bg-raised text-ink-2 select-none touch-manipulation hover:border-line-dash hover:text-ink active:scale-90 disabled:cursor-default disabled:opacity-40 max-md:h-11 max-md:w-11 motion-reduce:transform-none'
  const holdProps = (d: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      press(d)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) nudge(d)
    },
  })

  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-1.5">
      <button type="button" aria-label={`Decrease ${label}`} disabled={cur.current <= min} {...holdProps(-step)} className={btn}>
        <Icon name="minus" size={15} />
      </button>
      <input
        type="text"
        role="spinbutton"
        inputMode="numeric"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(draft) || value}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, String(max).length))}
        onBlur={typed}
        onKeyDown={(e) => {
          const k = e.key
          const d = k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : k === 'PageUp' ? step * 10 : k === 'PageDown' ? -step * 10 : 0
          if (d) {
            e.preventDefault()
            nudge(d)
          } else if (k === 'Home' || k === 'End') {
            e.preventDefault()
            set(k === 'Home' ? min : max)
          } else if (k === 'Enter') {
            e.preventDefault()
            typed()
          }
        }}
        className="h-10 w-16 rounded-[11px] border border-line bg-well px-1 text-center font-display text-[16px] font-semibold tabular-nums text-ink outline-none transition-colors [appearance:textfield] focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25 max-md:h-11 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button type="button" aria-label={`Increase ${label}`} disabled={cur.current >= max} {...holdProps(step)} className={btn}>
        <Icon name="plus" size={15} />
      </button>
      {unit && <span className="ml-1 text-[13px] text-muted">{unit}</span>}
    </div>
  )
}
