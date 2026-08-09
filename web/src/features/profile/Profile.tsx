/**
 * Profile — the collector's page.
 *
 * Previously this was a 512px column floating in the middle of a wide screen,
 * which made a page about accumulation feel like a receipt. It now uses the
 * full width: identity across the top, standing beneath it, then the activity
 * ledger and the badge case side by side.
 *
 * Every number comes from `/me/stats`. Delete-account stays absent because no
 * endpoint exists — omitting it is honest, showing a dead button is not.
 */

import { useNavigate } from 'react-router-dom'
import type { Badge, Stats } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon3D } from '../../components/ui/Icon3D'
import { Icon, type IconName } from '../../components/ui/Icon'

import { Skeleton } from '../../components/ui/Skeleton'
import { Ledger } from '../../components/ui/Surface'
import { getCachedStats } from '../../lib/briefCache'
import { useAsync } from '../../lib/useAsync'
import { cn } from '../../lib/cn'
import { toneSoft, toneText } from '../../lib/tone'

/** Heatmap steps, warm→hot, so a dense week reads at a glance. */
const INTENSITY = ['bg-line-soft', 'bg-brand/25', 'bg-brand/55', 'bg-brand']

export function Profile() {
  const { user } = useAuth()
  const navigate = useNavigate()
  // Shared cache with Home — Profile was refetching the same payload on
  // every visit, which is the exact back-navigation cost fixed elsewhere.
  const stats = useAsync(() => getCachedStats(), [])

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const email = user?.email ?? ''
  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : ''

  const d = stats.data

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-7 sm:px-7">
        {/* Identity */}
        <header className="flex flex-wrap items-center gap-4">
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-brand text-[22px] font-extrabold text-[#1a120f] shadow-[inset_0_2px_0_rgba(255,255,255,0.35),0_8px_20px_-8px_rgba(255,90,60,0.6)]">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="nameplate truncate text-[clamp(26px,4vw,38px)] leading-none text-ink">
              {displayName}
            </h1>
            <p className="mt-1 truncate text-[13px] text-muted">
              {email}
              {joined ? ` · collecting since ${joined}` : ''}
            </p>
          </div>
          {/* Only one action here. Profile is where you read your record;
              signing out lives with the account it belongs to, in Settings. */}
          <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>
            <Icon name="settings" size={14} /> Settings
          </Button>
        </header>

        {stats.error && !stats.loading && (
          <div className="rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-deep">
            {stats.error}
          </div>
        )}

        {/* A brand-new account used to land on a wall of zeroes and empty
            charts with nothing explaining them. Say what this page will
            become instead of rendering a blank ledger. */}
        {d && !stats.loading && d.spaces_count === 0 && d.docs_indexed === 0 && (
          <EmptyState
            icon="seal"
            title="Nothing on the record yet"
            description="This is where your streak, badges and study history collect. Make a subject, add a topic, and the ledger starts filling itself in."
            action={<Button onClick={() => navigate('/home')}>Go to Home</Button>}
          />
        )}

        {/* Standing */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            icon="flame"
            label="Current streak"
            value={d ? `${d.streak_days}` : null}
            unit={d?.streak_days === 1 ? 'day' : 'days'}
            tone="brand"
            loading={stats.loading}
          />
          <StatTile
            icon="seal"
            label="Longest streak"
            value={d ? `${d.max_streak}` : null}
            unit={d?.max_streak === 1 ? 'day' : 'days'}
            tone="sun"
            loading={stats.loading}
          />
          <StatTile
            icon="doc"
            label="Sources indexed"
            value={d ? `${d.docs_indexed}` : null}
            unit=""
            tone="sky"
            loading={stats.loading}
          />
          <StatTile
            icon="target"
            label="Quiz average"
            value={d ? (d.quiz_average != null ? `${d.quiz_average}` : '—') : null}
            unit={d?.quiz_average != null ? '%' : ''}
            tone="mint"
            loading={stats.loading}
          />
        </section>

        <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          {/* Activity ledger — and now actually a Ledger. This was already
              named one in the markup while rendering as cardstock. Six months
              of your own activity is the thing you are measured against; the
              badge case beside it stays a Card because badges are things you
              own. Those two being the same material was the confusion. */}
          <Ledger className="flex flex-col gap-3 p-5 pt-0">
            <div className="flex items-baseline gap-2">
              <h2 className="nameplate text-[20px] text-ink">Activity</h2>
              <span className="setcode ml-auto">
                {d ? `${d.study_minutes_this_week} min this week` : 'last 26 weeks'}
              </span>
            </div>
            {stats.loading ? (
              <Skeleton className="h-28 rounded-lg" />
            ) : d ? (
              <Heatmap cells={d.heatmap} />
            ) : null}
            <div className="mt-1 flex items-center gap-2">
              <span className="setcode">Less</span>
              <div className="flex gap-1">
                {INTENSITY.map((c) => (
                  <span key={c} className={cn('h-2.5 w-2.5 rounded-[3px]', c)} />
                ))}
              </div>
              <span className="setcode">More</span>
            </div>
          </Ledger>

          {/* Badge case — stays a Card. Badges are earned objects you keep. */}
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-baseline gap-2">
              <h2 className="nameplate text-[20px] text-ink">Badges</h2>
              {d && (
                <span className="setcode ml-auto">
                  {d.badges.filter((b) => b.earned).length} of {d.badges.length}
                </span>
              )}
            </div>
            {stats.loading ? (
              <div className="grid grid-cols-3 gap-2.5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : d ? (
              <div className="grid grid-cols-3 gap-2.5">
                {d.badges.map((b) => (
                  <BadgeSeal key={b.id} badge={b} />
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}

function StatTile({
  icon,
  label,
  value,
  unit,
  tone,
  loading,
}: {
  icon: IconName
  label: string
  value: string | null
  unit: string
  tone: 'brand' | 'sky' | 'sun' | 'mint'
  loading: boolean
}) {
  const lit = value !== null && value !== '—' && value !== '0'
  return (
    // LEDGER — a streak count or a quiz average is a figure about you, not an
    // object you hold. It also loses `foil`: foil is the collectible cue, and
    // spending it on a statistic is what made every number look like loot.
    <Ledger className="flex flex-col gap-2 p-4 pt-3">
      <span
        className={cn(
          'grid h-7 w-7 place-items-center rounded-md',
          toneSoft[tone],
          lit ? toneText[tone] : 'text-faint',
        )}
      >
        <Icon3D name={icon} size={15} lifted={lit} />
      </span>
      {loading ? (
        <Skeleton className="h-8 w-14 rounded" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'nameplate text-[34px] leading-none tabular-nums',
              lit ? toneText[tone] : 'text-ink-3',
            )}
          >
            {value ?? '—'}
          </span>
          {unit && <span className="setcode">{unit}</span>}
        </div>
      )}
      <span className="setcode">{label}</span>
    </Ledger>
  )
}

/**
 * A badge is a foil seal. Tier drives how precious it looks; an unearned one
 * shows its hint rather than a bare padlock, so it reads as a target instead
 * of a locked door.
 */
function BadgeSeal({ badge }: { badge: Badge }) {
  const tierRing = {
    common: 'ring-line',
    rare: 'ring-sky/40',
    elite: 'ring-sun/50',
  }[badge.tier]

  return (
    <div
      title={badge.earned ? badge.label : badge.hint}
      className={cn(
        'group relative flex flex-col items-center gap-1.5 rounded-lg p-2.5 text-center ring-1 transition-all duration-200',
        badge.earned && badge.tier !== 'common' && 'foil hover:-translate-y-0.5',
        badge.earned ? cn('bg-raised', tierRing) : 'bg-well/60 ring-line/60',
      )}
    >
      <span
        className={cn(
          'grid h-9 w-9 place-items-center rounded-full',
          badge.earned
            ? cn(toneSoft[badge.tone], toneText[badge.tone])
            : 'bg-line-soft text-faint',
        )}
      >
        <Icon
          name={(badge.icon as IconName) ?? 'seal'}
          size={17}
          filled={badge.earned}
        />
      </span>
      <span
        className={cn(
          'text-[11px] leading-tight',
          badge.earned ? 'font-bold text-ink' : 'text-faint',
        )}
      >
        {badge.label}
      </span>
      {badge.tier !== 'common' && badge.earned && (
        <span className="setcode text-[9px]">{badge.tier}</span>
      )}
      {!badge.earned && (
        <span className="setcode text-[9px] leading-tight">{badge.hint}</span>
      )}
    </div>
  )
}

function Heatmap({ cells }: { cells: Stats['heatmap'] }) {
  if (!cells.length) return <Skeleton className="h-28 rounded-lg" />

  // Weeks as columns, weekdays as rows — the layout everyone already reads.
  // The backend returns ~26 Monday-aligned weeks, which is enough columns that
  // small square cells fill the card instead of huddling on the left.
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // Month ticks, placed on the first week that enters a new month.
  const months: { label: string; col: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, i) => {
    const d = new Date(week[0]?.day ?? '')
    if (Number.isNaN(d.getTime())) return
    if (d.getMonth() !== lastMonth) {
      lastMonth = d.getMonth()
      months.push({ label: d.toLocaleDateString(undefined, { month: 'short' }), col: i })
    }
  })

  return (
    <div className="flex w-full gap-2">
      <div className="flex shrink-0 flex-col justify-between py-[13px]">
        {['Mon', 'Wed', 'Fri'].map((d) => (
          <span key={d} className="setcode text-[9px] leading-none">
            {d}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div
          className="mb-1 grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
        >
          {weeks.map((_, i) => {
            const tick = months.find((m) => m.col === i)
            return (
              <span key={i} className="setcode text-[9px] leading-none">
                {tick ? tick.label : ''}
              </span>
            )
          })}
        </div>

        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}
        >
          {weeks.map((week, w) => (
            <div key={w} className="grid grid-rows-7 gap-[3px]">
              {week.map((cell) => (
                <span
                  key={cell.day}
                  title={cell.day}
                  className={cn(
                    'aspect-square w-full rounded-[2px] transition-colors',
                    INTENSITY[Math.min(3, cell.intensity)],
                  )}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
