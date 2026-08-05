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
import { getStats } from '../../api/me'
import type { Space, Stats, Subspace } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { getCachedBrief } from '../../lib/briefCache'
import { useAsync } from '../../lib/useAsync'
import { toneDot, toneSoft, toneText } from '../../lib/tone'
import { NewSpaceModal } from '../spaces/NewSpaceModal'
import { useSpaces } from '../spaces/SpacesProvider'
import { StreakLedger } from './StreakLedger'

export function Home() {
  const { spaces, loading: spacesLoading } = useSpaces()
  const stats = useAsync(() => getStats(), [])
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
              <Link to={due > 0 ? `${first.link}/flashcards` : first.link}>
                <Button size="lg">
                  {due > 0 ? `Review ${due} card${due === 1 ? '' : 's'}` : 'Pick up where you left off'}
                  <Icon name="arrowRight" size={15} />
                </Button>
              </Link>
              {due > 0 && (
                <Link to={first.link}>
                  <Button variant="secondary" size="lg">
                    Or open {first.subspace.name}
                  </Button>
                </Link>
              )}
            </div>
          )}
        </header>

        {/* ── First run ── */}
        {!spacesLoading && !anySpaces && (
          <EmptyState
            icon="sparkle"
            title="Nothing in the binder yet"
            description="Make a subject for something you're studying, add a topic inside it, then drop in a PDF and start asking."
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

        {/* ── Topics as face-up cards ── */}
        {anySubspaces && (
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="nameplate text-[22px] text-ink">Your topics</h2>
              <span className="setcode">{entries.length} in play</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {entries.slice(0, 6).map((entry) => (
                <TopicCard key={entry.subspace.id} entry={entry} />
              ))}
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
          <Icon name={icon} size={13} filled={lit} />
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
        link: `/s/${s.id}/${sub.id}`,
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

// `Stats` is referenced by the async hook's generic inference above.
export type { Stats }
