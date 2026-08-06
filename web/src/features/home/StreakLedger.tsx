/**
 * The streak ledger — Home's centrepiece.
 *
 * Replaces three flat stat boxes with one thing worth looking at: your last
 * fortnight as a row of bars you can actually interrogate. Hovering a day
 * pulls its numbers up; the current streak reads as a run of lit bars rather
 * than a number you have to trust.
 *
 * Everything here is measured. Bar height comes from logged study seconds and
 * nothing is invented to make the chart look fuller — an untouched day is a
 * stub, because that is the honest shape of a missed day.
 */

import { useEffect, useMemo, useState } from 'react'
import type { Stats } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { CountUp } from '../../components/ui/motion'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'

const DAYS = 14

export function StreakLedger({
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
  const peak = useMemo(
    () => Math.max(1, ...cells.map((c) => c.intensity)),
    [cells],
  )

  /** Trailing run of active days — the streak, read off the chart itself. */
  const litFrom = useMemo(() => {
    let i = cells.length
    while (i > 0 && cells[i - 1].intensity > 0) i -= 1
    return i
  }, [cells])

  if (loading) return <Skeleton className="h-56 rounded-xl" />
  if (!stats) return null

  const active = hover !== null ? cells[hover] : null
  const streak = stats.streak_days

  return (
    <section className="cardstock relative overflow-hidden rounded-xl p-5">
      {/* A warm wash behind the live run, so a streak literally glows. */}
      {streak > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 90% at 88% 100%, rgba(255,90,60,0.13), transparent 70%)',
          }}
        />
      )}

      <div className="relative flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <div className="flex items-center gap-2">
            <Icon
              name="flame"
              size={16}
              filled={streak > 0}
              className={streak > 0 ? 'text-brand' : 'text-faint'}
            />
            <span className="setcode">Current streak</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            {/* The streak is the one figure on Home worth a beat of its
                own — it counts up rather than snapping. Everything else
                stays still; a page of animating numbers reads as a slot
                machine, not a study app. */}
            <CountUp
              value={streak}
              className={cn(
                'nameplate text-[56px] leading-none tabular-nums',
                streak > 0 ? 'text-brand' : 'text-ink-3',
              )}
            />
            <span className="setcode">{streak === 1 ? 'day' : 'days'}</span>
          </div>
        </div>

        {/* Hovering a bar swaps this readout; otherwise it shows the week.
            This used to repeat a '▮' glyph per intensity step — a character
            the display face doesn't carry, so it rendered as empty boxes,
            and even correct it told you nothing. It shows the real figure
            now. The '~' is honest: see the study-time model in
            api/app/services/activity.py — these are estimates from completed
            actions, not measured wall-clock time. */}
        <div className="ml-auto text-right">
          <span className="setcode">
            {active ? formatDay(active.day) : 'This week'}
          </span>
          <div className="mt-1 nameplate text-[26px] leading-none tabular-nums text-ink">
            {active
              ? active.minutes > 0
                ? `~${active.minutes}m`
                : 'Nothing'
              : `~${stats.study_minutes_this_week}m`}
          </div>
        </div>
      </div>

      {/* The bars. */}
      <div
        className="relative mt-5 flex h-28 items-end gap-1.5"
        onMouseLeave={() => setHover(null)}
      >
        {cells.map((cell, i) => {
          const lit = i >= litFrom && cell.intensity > 0
          const isHover = hover === i
          const pct = cell.intensity === 0 ? 6 : 18 + (cell.intensity / peak) * 82
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
                  'w-full rounded-[4px] transition-all duration-300 ease-out',
                  lit
                    ? 'bg-brand'
                    : cell.intensity > 0
                      ? 'bg-brand/45'
                      : 'bg-line',
                  isHover && 'brightness-125',
                )}
                style={{
                  height: drawn ? `${pct}%` : '4%',
                  transitionDelay: drawn ? `${i * 34}ms` : '0ms',
                  boxShadow: lit ? '0 0 14px -4px rgba(255,90,60,0.7)' : undefined,
                }}
              />
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="setcode">{DAYS} days ago</span>
        <span className="setcode">Today</span>
      </div>
    </section>
  )
}

function formatDay(day: string): string {
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return day
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
