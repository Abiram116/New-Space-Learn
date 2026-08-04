/**
 * Home dashboard — real data via `/me/stats` + the spaces list.
 *
 * We deliberately don't fabricate a "recent activity" feed because there's no
 * unified events endpoint yet. Instead we show real signals we already have:
 * streak, cards-due, quiz average, and the last few subspaces the user
 * touched.
 */

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getStats } from '../../api/me'
import type { Space, Stats, Subspace } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { ProgressBar } from '../../components/ui/Bits'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { useAsync } from '../../lib/useAsync'
import { toneDot, toneSoft } from '../../lib/tone'
import { NewSpaceModal } from '../spaces/NewSpaceModal'
import { useSpaces } from '../spaces/SpacesProvider'
import { useState } from 'react'

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function Home() {
  const { user } = useAuth()
  const { spaces, loading: spacesLoading } = useSpaces()
  const stats = useAsync(() => getStats(), [])
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)

  const displayName =
    (user?.user_metadata?.display_name as string | undefined)?.split(' ')[0] ||
    user?.email?.split('@')[0] ||
    'there'

  const greeting = useMemo(getGreeting, [])

  const anySpaces = spaces.length > 0
  const anySubspaces = spaces.some((s) => s.subspaces.length > 0)
  const firstSubspaceLink = firstSubspace(spaces)

  return (
    <div className="flex flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="font-display text-[26px] font-semibold">
            {greeting}, {displayName}
          </h1>
          <p className="text-[13.5px] text-muted">
            {tagline(stats.data, stats.loading, stats.error)}
          </p>
        </div>
        {anySubspaces && firstSubspaceLink ? (
          <Link
            to={firstSubspaceLink}
            className="ml-auto rounded-[11px] bg-ink px-4 py-2.5 text-[13px] font-semibold text-white"
          >
            ✦ Jump into a chat
          </Link>
        ) : anySpaces ? null : (
          <Button className="ml-auto" onClick={() => setNewSpaceOpen(true)}>
            + New space
          </Button>
        )}
      </div>

      {/* First-time empty state */}
      {!spacesLoading && !anySpaces && (
        <EmptyState
          icon="✨"
          title="Start with your first subject"
          description="Create a space for a subject you're learning, then add a topic and drop in a PDF."
          action={<Button onClick={() => setNewSpaceOpen(true)}>Create a space</Button>}
        />
      )}

      {/* Tiles */}
      {anySpaces && (
        <div className="grid gap-3.5 lg:grid-cols-[1.4fr_1fr_1fr]">
          <StreakTile stats={stats.data} loading={stats.loading} />
          <SoftTile
            tone="sun"
            label="CARDS DUE"
            labelClass="text-sun-deep"
            loading={stats.loading}
            value={stats.data ? String(stats.data.cards_due) : null}
            detail={
              stats.data && firstSubspaceLink
                ? stats.data.cards_due > 0
                  ? 'ready to review'
                  : 'all caught up'
                : '—'
            }
            action="Review"
            to={firstSubspaceLink ? `${firstSubspaceLink}/flashcards` : '#'}
            disabled={!firstSubspaceLink}
          />
          <SoftTile
            tone="sky"
            label="QUIZ AVG"
            labelClass="text-sky-deep"
            loading={stats.loading}
            value={
              stats.data?.quiz_average != null ? `${stats.data.quiz_average}%` : '—'
            }
            detail={
              stats.data?.quiz_average != null ? 'last 5 quizzes' : 'take a quiz to seed'
            }
            action="See quizzes"
            to={firstSubspaceLink ? `${firstSubspaceLink}/quizzes` : '#'}
            disabled={!firstSubspaceLink}
          />
        </div>
      )}

      {anySubspaces && (
        <section>
          <div className="mb-2.5 flex items-baseline">
            <h2 className="font-display text-base font-semibold">Continue learning</h2>
            <span className="ml-auto text-[12.5px] font-semibold text-brand">
              {activeSubspaces(spaces).length} active
            </span>
          </div>
          <div className="grid gap-3.5 md:grid-cols-3">
            {topActive(spaces, 3).map((entry) => (
              <Link
                key={entry.subspace.id}
                to={`/s/${entry.space.id}/${entry.subspace.id}`}
              >
                <Card className="flex h-full flex-col gap-2 p-3.5 transition-colors hover:border-brand-200">
                  <div className="flex items-center gap-2 text-[11.5px] text-muted">
                    <span className={cn('h-1.5 w-1.5 rounded-[2px]', toneDot[entry.space.tone])} />
                    {entry.space.name}
                  </div>
                  <div className="text-[14.5px] font-bold">{entry.subspace.name}</div>
                  <div className="text-xs text-muted">
                    {relativeShort(entry.subspace.last_activity_at)}
                  </div>
                  <ProgressBar
                    value={progressFrom(entry.subspace)}
                    tone={entry.space.tone}
                    className="mt-auto"
                  />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {anySpaces && !anySubspaces && (
        <EmptyState
          icon="🧭"
          title="Add a topic to your space"
          description="Open a space in the sidebar and click '+ add topic' — that's where docs and chat live."
        />
      )}

      <NewSpaceModal open={newSpaceOpen} onClose={() => setNewSpaceOpen(false)} />
    </div>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────

function StreakTile({ stats, loading }: { stats: Stats | null; loading: boolean }) {
  if (loading) return <Skeleton className="h-32 rounded-2xl" />
  if (!stats) return null
  const week = stats.heatmap.slice(-7)
  const maxCell = Math.max(1, ...week.map((c) => c.intensity))
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
        🔥 Streak
        <span className="ml-auto font-display text-xl font-semibold text-ink">
          {stats.streak_days} {stats.streak_days === 1 ? 'day' : 'days'}
        </span>
      </div>
      <div className="flex h-14 items-end gap-1">
        {week.map((cell, i) => {
          const isToday = i === week.length - 1
          const height = 20 + (cell.intensity / maxCell) * 80
          return (
            <div
              key={cell.day}
              className={cn(
                'flex-1 rounded-md',
                isToday ? 'bg-brand' : cell.intensity >= 2 ? 'bg-mint' : 'bg-mint-soft',
              )}
              style={{ height: `${height}%` }}
            />
          )
        })}
      </div>
      <div className="flex justify-between text-[10.5px] text-faint">
        {DAY_LABELS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
    </Card>
  )
}

function SoftTile({
  tone,
  label,
  labelClass,
  loading,
  value,
  detail,
  action,
  to,
  disabled,
}: {
  tone: 'sun' | 'sky'
  label: string
  labelClass: string
  loading: boolean
  value: string | null
  detail: string
  action: string
  to: string
  disabled?: boolean
}) {
  if (loading) return <Skeleton className="h-32 rounded-2xl" />
  const actionClass = cn(
    'mt-auto rounded-[10px] bg-surface py-2 text-center text-[12.5px] font-semibold',
    disabled && 'opacity-50 pointer-events-none',
  )
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-2xl p-4', toneSoft[tone])}>
      <div className={cn('text-xs font-bold', labelClass)}>{label}</div>
      <div className="font-display text-3xl font-semibold">{value ?? '—'}</div>
      <div className="text-xs text-muted">{detail}</div>
      {disabled ? (
        <div className={actionClass}>{action}</div>
      ) : (
        <Link to={to} className={actionClass}>
          {action}
        </Link>
      )}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function tagline(stats: Stats | null, loading: boolean, error: string | null): string {
  if (loading) return 'Loading your progress…'
  // A failed load previously kept saying "Loading…" forever. Say what happened.
  if (error || !stats) return "Your progress didn't load. Refresh to try again."
  const bits: string[] = []
  if (stats.cards_due > 0) bits.push(`${stats.cards_due} cards due`)
  if (stats.study_minutes_this_week > 0)
    bits.push(`${stats.study_minutes_this_week}m studied this week`)
  if (!bits.length) return 'Nothing queued — a good time to start.'
  return bits.join(' · ')
}

function firstSubspace(spaces: Space[]): string | null {
  for (const s of spaces) {
    for (const sub of s.subspaces) {
      return `/s/${s.id}/${sub.id}`
    }
  }
  return null
}

type ActiveEntry = { space: Space; subspace: Subspace; sortKey: number }

function activeSubspaces(spaces: Space[]): ActiveEntry[] {
  const out: ActiveEntry[] = []
  for (const s of spaces) {
    for (const sub of s.subspaces) {
      out.push({
        space: s,
        subspace: sub,
        sortKey: sub.last_activity_at ? Date.parse(sub.last_activity_at) : 0,
      })
    }
  }
  return out.sort((a, b) => b.sortKey - a.sortKey)
}

function topActive(spaces: Space[], n: number): ActiveEntry[] {
  return activeSubspaces(spaces).slice(0, n)
}

function progressFrom(sub: Subspace): number {
  // Rough "how full is this topic" indicator using counts (0..100).
  const c = sub.counts
  const total = (c.docs ?? 0) * 15 + (c.notes ?? 0) * 8 + (c.cards ?? 0) * 3 + (c.quizzes ?? 0) * 10
  return Math.max(6, Math.min(100, total))
}

function relativeShort(iso: string | null): string {
  if (!iso) return 'Untouched'
  const diff = Date.now() - Date.parse(iso)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
