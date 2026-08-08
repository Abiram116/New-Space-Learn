/**
 * Home — the re-entry surface.
 *
 * The old version opened with "Good evening, Abiram", which tells a student
 * nothing they didn't already know. This opens with where they actually stand,
 * written from their own material, and puts the one thing worth doing next
 * directly under it.
 *
 * Everything shown is real: the brief comes from `/me/brief` (with honest
 * deterministic copy behind it), counts come from `/me/stats`, and the topics
 * come from the spaces list. Nothing here is invented for decoration.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  ForecastDay,
  Space,
  Stats,
  StudyComposition,
  Subspace,
} from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Tip } from '../../components/ui/Tip'
import { Icon3D } from '../../components/ui/Icon3D'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Stagger } from '../../components/ui/motion'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { getCachedBrief, getCachedStats } from '../../lib/briefCache'
import { subspacePath } from '../../lib/nav'
import { useAsync } from '../../lib/useAsync'
import { toneDot, toneSoft, toneText } from '../../lib/tone'
import { NewSpaceModal } from '../spaces/NewSpaceModal'
import { useSpaces } from '../spaces/SpacesProvider'
import { StreakLedger } from './StreakLedger'

export function Home() {
  const { spaces, loading: spacesLoading } = useSpaces()
  const stats = useAsync(() => getCachedStats(), [])
  const brief = useAsync(() => getCachedBrief(), [])
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  const anySpaces = spaces.length > 0
  const entries = activeSubspaces(spaces)
  const anySubspaces = entries.length > 0
  const first = entries[0]
  // Subjects that exist but hold nothing yet — shown as empty binder slots.
  const emptySubjects = spaces.filter((sp) => sp.subspaces.length === 0).slice(0, 3)

  const due = stats.data?.cards_due ?? 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-7 sm:px-7 sm:py-9">
        {/* ── The brief ── */}
        <header className="flex flex-col gap-4">
          {brief.loading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-11 w-2/3 rounded-lg" />
              <Skeleton className="h-4 w-1/2 rounded" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <h1 className="nameplate max-w-3xl text-[clamp(30px,5.5vw,52px)] text-ink">
                {brief.data?.headline ?? 'Ready when you are'}
              </h1>
              <p className="max-w-xl text-[14.5px] leading-relaxed text-ink-3">
                {brief.data?.body ??
                  'Add a topic to your space and start asking questions about your own material.'}
              </p>
            </div>
          )}

          {anySubspaces && first && (
            <div className="flex flex-wrap items-center gap-2.5">
              {brief.data?.suggestion ? (
                /* This is the one action the product is actually
                   recommending, computed from real weak-signal data — it
                   shouldn't look identical to a generic "open something"
                   button. The foil ring marks it as the considered pick. */
                <Link to={brief.data.suggestion.route}>
                  <Button
                    size="lg"
                    className="ring-2 ring-brand/30 ring-offset-2 ring-offset-canvas transition-shadow hover:ring-brand/60"
                  >
                    {brief.data.suggestion.label}
                    <Icon name="arrowRight" size={15} />
                  </Button>
                </Link>
              ) : (
                <Link to={due > 0 ? `${first.link}/flashcards` : first.link}>
                  <Button size="lg">
                    {due > 0 ? `Review ${due} card${due === 1 ? '' : 's'}` : 'Pick up where you left off'}
                    <Icon name="arrowRight" size={15} />
                  </Button>
                </Link>
              )}
            </div>
          )}
        </header>

        {/* ── First run ── */}
        {!spacesLoading && !anySpaces && (
          /* First words the product ever says. It should sound like the
             companion introducing itself and what it will do, not a
             database reporting zero rows. */
          <EmptyState
            icon="sparkle"
            title="Let's start with what you're studying"
            description="Give me a subject and a topic inside it, then drop in your lecture notes or a PDF. From there I'll answer from your own material, and turn what you cover into cards, notes and quizzes."
            action={<Button onClick={() => setNewSpaceOpen(true)}>Create your first subject</Button>}
          />
        )}

        {/* ── Standing: the ledger leads, the two live counts flank it ── */}
        {anySpaces && (
          <section className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
            <StreakLedger stats={stats.data} loading={stats.loading} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <StandingCard
                icon="deck"
                label="Cards due"
                value={stats.loading ? null : `${due}`}
                unit={due === 1 ? 'card' : 'cards'}
                tone="sun"
                lit={due > 0}
                detail={due > 0 ? 'Ready to review now.' : 'Nothing waiting. Nice.'}
                to={first && due > 0 ? `${first.link}/flashcards` : undefined}
              />
              <StandingCard
                icon="target"
                label="Quiz average"
                value={
                  stats.loading
                    ? null
                    : stats.data?.quiz_average != null
                      ? `${stats.data.quiz_average}`
                      : '—'
                }
                unit={stats.data?.quiz_average != null ? '%' : ''}
                tone="sky"
                lit={(stats.data?.quiz_average ?? 0) >= 80}
                detail={
                  stats.data?.quiz_average != null
                    ? 'Across your last five.'
                    : 'Take one to find out.'
                }
                to={first ? `${first.link}/quizzes` : undefined}
              />
            </div>
          </section>
        )}

        {/* ── What's coming, and what you actually did ──
            Both read from the same `/me/stats` payload Home already waits on,
            so neither costs a request. */}
        {anySpaces && !stats.loading && stats.data && (
          <section className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Tip id="home-forecast-v1" icon="clock">
                Cards return on a schedule, not all at once. Today's column is
                what's actually waiting — the rest is what's coming, so you can
                see a heavy day before it lands.
              </Tip>
              <DueForecast days={stats.data.due_forecast} />
            </div>
            <Composition
              data={stats.data.composition}
              dailyGoal={stats.data.daily_goal}
            />
          </section>
        )}

        {/* ── Topics as face-up cards ── */}
        {anySubspaces && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="nameplate text-[22px] text-ink">Your topics</h2>
              <span className="setcode">{entries.length} in play</span>
            </div>
            {/* Topic cards deal themselves in left-to-right, in keeping with
                the card-table world. Capped stagger — see ui/motion. */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stagger>
                {entries.slice(0, 6).map((entry) => (
                  <TopicCard key={entry.subspace.id} entry={entry} />
                ))}
              </Stagger>
              {emptySubjects.map((space) => (
                <DashedCard
                  key={space.id}
                  className="flex min-h-[132px] flex-col justify-between gap-2 p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('h-3.5 w-1 shrink-0 rounded-full', toneDot[space.tone])} />
                    <span className="setcode truncate">{space.name}</span>
                  </div>
                  <div>
                    <p className="text-[13px] leading-snug text-muted">
                      No topics yet. Add one from the rail to start collecting.
                    </p>
                  </div>
                </DashedCard>
              ))}
            </div>
          </section>
        )}

        {anySpaces && !anySubspaces && (
          <EmptyState
            icon="target"
            title="Your subject has no topics yet"
            description="Open it in the rail and add a topic — that's where documents, chat, and cards live."
          />
        )}
      </div>

      <NewSpaceModal open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} />
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────

function StandingCard({
  icon,
  label,
  value,
  unit,
  tone,
  lit,
  detail,
  to,
}: {
  icon: IconName
  label: string
  value: string | null
  unit: string
  tone: 'sun' | 'sky'
  lit: boolean
  detail: string
  to?: string
}) {
  const body = (
    <Card
      foil={lit}
      className={cn(
        'flex h-full flex-col gap-2.5 p-4 transition-transform duration-200',
        to && 'hover:-translate-y-0.5',
        lit && 'ring-1',
        lit && { sun: 'ring-sun/30', sky: 'ring-sky/30' }[tone],
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'grid h-6 w-6 place-items-center rounded-md',
            toneSoft[tone],
            lit ? toneText[tone] : 'text-faint',
          )}
        >
          <Icon3D name={icon} size={14} lifted={lit} />
        </span>
        <span className="setcode">{label}</span>
      </div>

      {value === null ? (
        <Skeleton className="h-9 w-16 rounded" />
      ) : (
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'nameplate text-[40px] leading-none tabular-nums',
              lit ? toneText[tone] : 'text-ink-3',
            )}
          >
            {value}
          </span>
          {unit && <span className="setcode">{unit}</span>}
        </div>
      )}

      <p className="mt-auto text-[12px] leading-snug text-muted">{detail}</p>
    </Card>
  )
  return to ? <Link to={to} className="contents">{body}</Link> : body
}

function TopicCard({ entry }: { entry: ActiveEntry }) {
  const { space, subspace } = entry
  const counts = subspace.counts ?? {}
  const bits: string[] = []
  if (counts.docs) bits.push(`${counts.docs} doc${counts.docs === 1 ? '' : 's'}`)
  if (counts.cards) bits.push(`${counts.cards} card${counts.cards === 1 ? '' : 's'}`)
  if (counts.notes) bits.push(`${counts.notes} note${counts.notes === 1 ? '' : 's'}`)

  return (
    <Link to={entry.link}>
      <Card
        className={cn(
          'flex h-full flex-col gap-3 p-4 transition-transform duration-200 hover:-translate-y-0.5',
          'ring-1 ring-transparent hover:ring-brand/25',
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn('h-3.5 w-1 shrink-0 rounded-full', toneDot[space.tone])} />
          <span className="setcode truncate">{space.name}</span>
        </div>

        <div className="nameplate text-[21px] leading-tight text-ink">{subspace.name}</div>

        <div className="mt-auto flex flex-col gap-1.5">
          <span className="setcode">{bits.length ? bits.join(' · ') : 'Nothing added yet'}</span>
          <span className="setcode">{relativeShort(subspace.last_activity_at)}</span>
        </div>
      </Card>
    </Link>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

type ActiveEntry = { space: Space; subspace: Subspace; link: string; sortKey: number }

function activeSubspaces(spaces: Space[]): ActiveEntry[] {
  const out: ActiveEntry[] = []
  for (const s of spaces) {
    for (const sub of s.subspaces) {
      out.push({
        space: s,
        subspace: sub,
        link: subspacePath(s, sub),
        sortKey: sub.last_activity_at ? Date.parse(sub.last_activity_at) : 0,
      })
    }
  }
  return out.sort((a, b) => b.sortKey - a.sortKey)
}


function relativeShort(iso: string | null): string {
  if (!iso) return 'Not opened yet'
  const diff = Date.now() - Date.parse(iso)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

/**
 * Cards falling due over the next seven days.
 *
 * This is the single strongest piece of evidence that the spaced repetition is
 * real rather than a label: the schedule is visible, and today's column is the
 * work in front of you. The data has always existed on every card as `due_at`
 * — it was simply never asked for beyond "how many are due right now".
 */
function DueForecast({ days }: { days?: ForecastDay[] }) {
  // Defensive by design, not by superstition. This renders from a cached API
  // payload, and a cache written by an older deploy will not have this field —
  // that exact case took the whole of Home down behind the error boundary.
  // A dashboard panel with missing data should show nothing; it should never
  // be able to destroy the page around it.
  const safe = Array.isArray(days) ? days : []
  const peak = Math.max(1, ...safe.map((d) => d.count))
  const total = safe.reduce((n, d) => n + d.count, 0)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <span className="setcode-strong">Coming due</span>
        <span className="setcode">next 7 days · {total} total</span>
      </div>

      {total === 0 ? (
        <p className="text-[13.5px] text-muted">
          Nothing scheduled yet. Cards appear here the moment you grade one.
        </p>
      ) : (
        <div className="flex h-[104px] items-end gap-2">
          {safe.map((d, i) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'text-[11px] font-bold tabular-nums',
                  i === 0 ? 'text-brand' : 'text-faint',
                )}
              >
                {d.count || ''}
              </span>
              <span
                className={cn(
                  'w-full rounded-[3px] transition-[height]',
                  i === 0 ? 'bg-brand' : 'bg-line-dash',
                )}
                style={{ height: `${Math.max(d.count ? 6 : 2, (d.count / peak) * 72)}px` }}
              />
              <span className={cn('setcode', i === 0 && 'text-brand')}>
                {i === 0 ? 'today' : dayLabel(d.day)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/**
 * Where the last seven days actually went.
 *
 * Study *time* was already shown; study *shape* never was, even though the
 * three counters behind this have been written on every chat message, card
 * grade and quiz submission since the app shipped. One stacked bar rather than
 * three numbers, because the useful question is proportion — "am I only ever
 * chatting and never testing myself" — not absolute counts.
 */
function Composition({
  data,
  dailyGoal,
}: {
  data?: StudyComposition
  dailyGoal?: number
}) {
  // Same reasoning as DueForecast: a stale cached payload has no `composition`,
  // and reading `.chat_messages` off undefined would throw during render.
  const parts = [
    { key: 'Asked', n: data?.chat_messages ?? 0, cls: 'bg-sky', text: 'text-sky-deep' },
    { key: 'Reviewed', n: data?.cards_reviewed ?? 0, cls: 'bg-sun', text: 'text-sun-deep' },
    { key: 'Tested', n: data?.quizzes_taken ?? 0, cls: 'bg-coral', text: 'text-coral-deep' },
  ]
  const total = parts.reduce((n, p) => n + p.n, 0)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <span className="setcode-strong">This week</span>
        <span className="setcode">what you did</span>
      </div>

      {total === 0 ? (
        <p className="text-[13.5px] text-muted">
          Nothing logged in the last seven days. Ask something, grade a card, or
          take a quiz and it shows up here.
        </p>
      ) : (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-line-soft">
            {parts.map(
              (p) =>
                p.n > 0 && (
                  <span
                    key={p.key}
                    className={p.cls}
                    style={{ width: `${(p.n / total) * 100}%` }}
                  />
                ),
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {parts.map((p) => (
              <div key={p.key} className="flex items-baseline justify-between">
                <span className={cn('setcode', p.n > 0 && p.text)}>{p.key}</span>
                <span className="text-[13px] font-bold tabular-nums text-ink-3">
                  {p.n}
                </span>
              </div>
            ))}
          </div>

          {/* The goal, measured in the SAME unit it is set in. `daily_goal` is
              cards per day (see Settings), so the honest comparison is against
              cards reviewed over seven days — not against study minutes, which
              is a different axis entirely. */}
          {dailyGoal ? (
            <div className="ruled-datum flex items-baseline justify-between pt-2.5">
              <span className="setcode">Goal · {dailyGoal} cards/day</span>
              <span
                className={cn(
                  'text-[12px] font-bold tabular-nums',
                  data && data.cards_reviewed >= dailyGoal * 7
                    ? 'text-mint-deep'
                    : 'text-faint',
                )}
              >
                {data?.cards_reviewed ?? 0} / {dailyGoal * 7}
              </span>
            </div>
          ) : null}
        </>
      )}
    </Card>
  )
}

/** Weekday initial for a forecast column. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? ''
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
}

// `Stats` is referenced by the async hook's generic inference above.
export type { Stats }
