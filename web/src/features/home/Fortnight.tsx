/**
 * The fortnight — the evidence under Home's standing figures.
 *
 * Your last fourteen days as a row of bars you can interrogate. Hovering a day
 * pulls its real number up; the current streak reads as a run of lit bars
 * rather than a figure you have to take on trust.
 *
 * This used to own the streak number too, inside its own `Ledger` box. Home is
 * one composition now: the streak sits on the standing rule above with the
 * other three figures, and this is what stands underneath them as proof. So it
 * draws no surface of its own — the band around it carries the rules.
 *
 * Everything here is measured. Bar height comes from logged study seconds and
 * nothing is invented to make the chart look fuller — an untouched day is a
 * stub, because that is the honest shape of a missed day.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Stats } from '../../api/types'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'

const DAYS = 14

export function Fortnight({
  stats,
  loading,
}: {
  stats: Stats | null
  loading: boolean
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Bars grow in on first paint, staggered left→right like a dealt row.
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    if (!stats) return
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [stats])

  const cells = useMemo(() => (stats ? stats.heatmap.slice(-DAYS) : []), [stats])

  /**
   * Scaled by MINUTES, not by the 0–3 `intensity` bucket.
   *
   * Intensity flattened the chart: a 10-minute day and a 55-minute day landed
   * in the same bucket and drew the same bar, so the shape carried almost no
   * information. Minutes are the real figure and are already on the wire.
   */
  const peak = useMemo(
    () => Math.max(1, ...cells.map((c) => c.minutes)),
    [cells],
  )

  /** Trailing run of active days — the streak, read off the chart itself. */
  const litFrom = useMemo(() => {
    let i = cells.length
    while (i > 0 && cells[i - 1].intensity > 0) i -= 1
    return i
  }, [cells])

  if (loading) return <Skeleton className="h-36 rounded-xl" />
  if (!stats) return null

  const active = hover !== null ? cells[hover] : null

  return (
    <div className="relative">
      {/* A warm wash behind the live run, so a streak literally glows. */}
      {stats.streak_days > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 top-6"
          style={{
            background:
              'radial-gradient(55% 90% at 92% 100%, rgba(255,90,60,0.13), transparent 70%)',
          }}
        />
      )}

      {/* Hovering a bar names the day and its real figure. Idle it prompts,
          because the week's total already sits on the rule above — repeating
          it here would be the same number twice in 100px.

          This readout used to repeat a '▮' glyph per intensity step: a
          character the display face doesn't carry, so it rendered as empty
          boxes, and even correct it told you nothing. The '~' is honest — see
          the study-time model in api/app/services/activity.py; these are
          estimates from completed actions, not measured wall-clock time. */}
      <div className="relative flex h-6 items-baseline justify-between">
        <span className="setcode">Last {DAYS} days</span>
        {active ? (
          <span className="flex items-baseline gap-2">
            <span className="setcode">{formatDay(active.day)}</span>
            <span className="text-[15px] font-bold tabular-nums text-ink">
              {active.minutes > 0 ? `~${active.minutes}m` : 'Nothing'}
            </span>
          </span>
        ) : (
          <span className="setcode">Hover a day</span>
        )}
      </div>

      <div
        className="relative mt-2 flex h-24 items-end gap-1.5"
        onMouseLeave={() => setHover(null)}
      >
        {/* NO goal line here, deliberately. `daily_goal` is measured in CARDS
            — that is what Settings labels it and what a user sets — while this
            chart is minutes. Drawing a cards target across a minutes axis
            would put a confident dashed line at a meaningless height. The goal
            is surfaced on Home's composition panel instead, where the units
            match. */}
        {cells.map((cell, i) => {
          const lit = i >= litFrom && cell.minutes > 0
          const isHover = hover === i
          // A day with any logged time keeps a visible floor, so "a little"
          // never renders identically to "nothing".
          const pct = cell.minutes === 0 ? 4 : Math.max(9, (cell.minutes / peak) * 100)
          return (
            <button
              key={cell.day}
              type="button"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${formatDay(cell.day)}: ${
                cell.minutes > 0 ? `about ${cell.minutes} minutes` : 'nothing logged'
              }`}
              className="group relative flex h-full flex-1 cursor-pointer items-end"
            >
              <span
                className={cn(
                  'w-full rounded-[4px] t-meter duration-300 ease-out',
                  lit
                    ? 'bg-brand'
                    : cell.minutes > 0
                      ? 'bg-brand/45'
                      : 'bg-line',
                  isHover && 'brightness-125',
                )}
                style={{
                  // Scaled from the baseline rather than grown: `height` on
                  // fourteen bars relayouts the chart every frame. `origin-bottom`
                  // makes them stand up off the rule they sit on, which is also
                  // the right gesture for a column chart.
                  height: '100%',
                  transformOrigin: 'bottom',
                  transform: `scaleY(${drawn ? pct / 100 : 0.04})`,
                  transitionDelay: drawn ? `${i * 34}ms` : '0ms',
                  boxShadow: lit ? '0 0 14px -4px rgba(255,90,60,0.7)' : undefined,
                }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function formatDay(day: string): string {
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
