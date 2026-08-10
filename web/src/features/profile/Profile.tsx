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

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Badge, Stats } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
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
  const { user, setDisplayName } = useAuth()
  const navigate = useNavigate()
  const { showError } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
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

  const commitName = async () => {
    const name = draft.trim()
    setEditing(false)
    if (!name || name === displayName) return
    try {
      await setDisplayName(name)
    } catch (err) {
      showError(err)
    }
  }

  const d = stats.data

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Fills the height instead of stacking into the top third.
          `max-w-5xl` on a 1900px monitor put every element in a centred column
          with a blank lower half — the page read as a receipt printed in the
          middle of a desk. Wider cap, and `min-h-full` with the ledger row
          allowed to grow means the activity map and badge case take the space
          that was empty rather than the page ending early. */}
      <div className="mx-auto flex min-h-full w-full max-w-[92rem] flex-col gap-6 px-4 py-7 sm:px-8">
        {/* Identity */}
        <header className="flex flex-wrap items-center gap-4">
          {/* A seal, not a coloured square.
              The flat brand tile read as a placeholder avatar waiting for a
              photo upload that this app does not have. A foil seal is a thing
              this product already means something by — it is what a badge is
              — so the identity mark belongs to the same world as the record
              underneath it. The ring and inner glow give it depth without a
              drop shadow, which `Ledger` surfaces never use. */}
          {/* It behaves like foil, because that is what it is.
              A static disc is a placeholder avatar whether or not it is
              drawn well. This one has a highlight that travels slowly across
              it — the same tilt-sheen a real foil card throws, at room speed
              rather than animation speed — and an orbiting ring that marks it
              as the one earned object on the page you did not have to unlock.
              Transform and opacity only, so it composites off the main
              thread; both stop dead under reduced motion, leaving the drawn
              seal exactly as it was. */}
          <span className="group relative grid h-16 w-16 shrink-0 place-items-center">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-full border border-brand/25 opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-safe:animate-[sealOrbit_9s_linear_infinite]"
            />
            <span
              aria-hidden
              className="absolute inset-0 overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_25%,var(--color-brand-300),var(--color-brand)_55%,var(--color-brand-deep))] ring-1 ring-brand/40 transition-transform duration-500 group-hover:scale-[1.04]"
            >
              <span
                aria-hidden
                className="absolute inset-0 motion-safe:animate-[sealSheen_7s_ease-in-out_infinite]"
                style={{
                  background:
                    'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)',
                  backgroundSize: '260% 260%',
                }}
              />
            </span>
            <span
              aria-hidden
              className="absolute inset-[3px] rounded-full ring-1 ring-[rgba(255,237,220,0.25)]"
            />
            <span className="relative nameplate text-[21px] leading-none text-[#1a120f]">
              {initials}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName()
                  if (e.key === 'Escape') setEditing(false)
                }}
                aria-label="Your name"
                maxLength={60}
                className="nameplate w-full max-w-md rounded-[10px] border border-brand/50 bg-well px-2.5 py-1 text-[clamp(24px,3.6vw,34px)] leading-tight text-ink outline-none"
              />
            ) : (
              <h1 className="group flex min-w-0 items-center gap-2">
                <span className="nameplate truncate text-[clamp(26px,4vw,38px)] leading-none text-ink">
                  {displayName}
                </span>
                {/* Edit lives on the name itself rather than in a settings
                    round-trip — this is the one field on the page that is
                    yours to change, so it should be changeable where you
                    read it. */}
                <button
                  type="button"
                  onClick={() => {
                    setDraft(displayName)
                    setEditing(true)
                  }}
                  aria-label="Rename yourself"
                  title="Rename yourself"
                  className="shrink-0 rounded-md p-1.5 text-muted transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
                >
                  <Icon name="pencil" size={14} />
                </button>
              </h1>
            )}
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

        {/* `flex-1` on the row, not just the page: this is the part with
            content that scales, so it is the part that should absorb the
            leftover height. */}
        <div className="grid flex-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* Activity ledger — and now actually a Ledger. This was already
              named one in the markup while rendering as cardstock. Six months
              of your own activity is the thing you are measured against; the
              badge case beside it stays a Card because badges are things you
              own. Those two being the same material was the confusion. */}
          {/* `border-b-0`: a ledger rule underlines figures so the eye can
              read them against it. Here it lands at the bottom of a panel with
              nothing beneath it, so it divides nothing and just draws a line
              across the page — the same "rule with nothing to divide" that was
              removed from the note canvas. The material stays; its trailing
              stroke does not. */}
          <Ledger className="flex h-full flex-col gap-3 border-b-0 p-5 pt-0">
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
          {/* `self-start`, not `h-full`. Stretching the badge case to match
              the activity panel left a tall empty box under a 3-row grid of
              seals — the card was sized by its neighbour rather than by what
              was in it. It hugs its contents now; the two panels top-align,
              which is what a pair of unrelated-height panels should do. */}
          <Card className="flex flex-col gap-3 self-start p-5">
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
 * shows how close you are, so it reads as a target rather than a locked door.
 *
 * **Uniform height, deliberately.** These tiles used to print the full hint
 * ("Get fifty cards to a known state.") under the label. Grid rows size to
 * their tallest item, so one three-line hint stretched every tile beside it and
 * the whole case turned into a column of tall, mostly-empty boxes. The standing
 * is a progress rail now — one fixed-height row that says the same thing
 * faster — and the hint moved to the tooltip, where a sentence belongs. Labels
 * clamp to two lines with a reserved minimum so every tile matches whatever its
 * neighbours do.
 */
function BadgeSeal({ badge }: { badge: Badge }) {
  const tierRing = {
    common: 'ring-line',
    rare: 'ring-sky/40',
    elite: 'ring-sun/50',
  }[badge.tier]

  return (
    <div
      /* The hint lives here now rather than in the tile: a sentence is a
         tooltip's job, and printing it was what made every row tall. */
      title={badge.earned ? badge.label : `${badge.hint} (${badge.progress} of ${badge.target})`}
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
      {/* Two lines maximum, with the space for two always reserved, so a
          one-word label and a wrapping one produce the same tile. */}
      <span
        className={cn(
          'line-clamp-2 min-h-[2.1em] text-[11px] leading-tight',
          badge.earned ? 'font-bold text-ink' : 'text-faint',
        )}
      >
        {badge.label}
      </span>

      {/* One fixed-height slot for the footer, whatever goes in it — this is
          what actually keeps the row uniform. */}
      <div className="flex h-3 w-full items-center justify-center">
        {badge.earned ? (
          badge.tier !== 'common' && <span className="setcode text-[9px]">{badge.tier}</span>
        ) : badge.target > 1 ? (
          /* Standing, not the rule. "7 of 10" is a target you are close to;
             the rule alone is a wall you may not have started climbing. Drawn
             rather than written, because a bar is read at a glance and costs
             one line instead of three. */
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-line-soft"
            title={`${badge.progress} of ${badge.target}`}
          >
            <div
              className="h-full rounded-full bg-brand/70 transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round((badge.progress / badge.target) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Heatmap({ cells }: { cells: Stats['heatmap'] }) {
  // Drawn once per mount, staggered across the columns. `useState` + rAF
  // rather than a CSS-only animation because the stagger has to be indexed by
  // column, and 26 keyframe rules would be worse than one delay expression.
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  if (!cells.length) return <Skeleton className="h-28 rounded-lg" />

  // Weeks as columns, weekdays as rows — the layout everyone already reads.
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

  /* Both label tracks share the cell grid's geometry instead of guessing at
     it, which is what was wrong before.

     The weekday column used `justify-between` over three labels — so Mon sat
     at 0%, Wed at 50% and Fri at 100% of the height, while their actual rows
     are the 1st, 3rd and 5th of seven. Nothing lined up with anything. It is
     the same 7-row grid as the cells now, with each label placed in its own
     row, so alignment is structural rather than approximated.

     The month row had every week rendering a `<span>` in a ~6px column, which
     clipped a three-letter month to about one letter. Ticks are now grid
     items placed at their starting column and allowed to overflow to the
     right, the way a real axis tick behaves. */
  const cols = { gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }

  return (
    <div className="flex w-full gap-2">
      {/* Weekday axis, on the cells' own row grid. */}
      <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-[calc(0.5rem+3px)]">
        {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => (
          <span
            key={i}
            className="setcode flex items-center text-[9px] leading-none"
          >
            {d}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 grid h-2 gap-[3px]" style={cols}>
          {months.map((m) => (
            <span
              key={m.label + m.col}
              // `col + 1` because CSS grid lines are 1-indexed. Overflow is
              // deliberate: a tick labels the column it starts at and is
              // allowed to run past it.
              style={{ gridColumnStart: m.col + 1 }}
              className="setcode overflow-visible whitespace-nowrap text-[9px] leading-none"
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className="grid gap-[3px]" style={cols}>
          {weeks.map((week, w) => (
            <div key={w} className="grid grid-rows-7 gap-[3px]">
              {week.map((cell, d) => (
                <span
                  key={cell.day}
                  title={`${cell.day}${cell.minutes ? ` — about ${cell.minutes} min` : ''}`}
                  className={cn(
                    'aspect-square w-full rounded-[2px]',
                    'transition-[opacity,transform,background-color] duration-300 ease-out',
                    INTENSITY[Math.min(3, cell.intensity)],
                  )}
                  style={{
                    opacity: drawn ? 1 : 0,
                    // Scale from the cell's own centre so the wave reads as
                    // the map developing rather than sliding in from an edge.
                    transform: drawn ? 'scale(1)' : 'scale(0.4)',
                    // Column-dominant delay with a small per-row offset, so it
                    // sweeps left to right with a slight diagonal rather than
                    // marching in rigid vertical bars. Capped so the last
                    // column is never more than ~half a second behind.
                    transitionDelay: drawn ? `${Math.min(w * 14 + d * 4, 520)}ms` : '0ms',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
