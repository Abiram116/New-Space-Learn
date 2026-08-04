/**
 * Profile — identity + real stats + activity heatmap + earned badges.
 *
 * No fabricated numbers. Everything comes from `/me/stats`. Delete-account is
 * hidden because there's no backend endpoint yet (better to omit than lie).
 */

import { useNavigate } from 'react-router-dom'
import { getStats } from '../../api/me'
import type { Stats } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { SectionLabel, Stat } from '../../components/ui/Bits'
import { Skeleton } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/Toast'
import { useAsync } from '../../lib/useAsync'
import { cn } from '../../lib/cn'
import { toneSoft } from '../../lib/tone'

const INTENSITY_CLASSES = ['bg-line-soft', 'bg-brand-200', 'bg-brand-300', 'bg-brand']

export function Profile() {
  const { user, signOut } = useAuth()
  const { showError } = useToast()
  const navigate = useNavigate()
  const stats = useAsync(() => getStats(), [])

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const email = user?.email ?? ''
  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
    : ''

  const doSignOut = async () => {
    try {
      await signOut()
      navigate('/signin', { replace: true })
    } catch (err) {
      showError(err)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-lg flex-col">
        {/* Identity header */}
        <header className="flex items-center gap-3.5 bg-brand-soft px-6 pt-6 pb-5">
          <div className="flex h-15 w-15 items-center justify-center rounded-[20px] bg-surface font-display text-[22px] font-semibold text-brand">
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-semibold">{displayName}</h1>
            <div className="truncate text-[12.5px] text-muted">
              {email}
              {joined ? ` · joined ${joined}` : ''}
            </div>
            {stats.data && (
              <div className="mt-1.5 flex gap-1.5 text-[11.5px]">
                <span className="rounded-full bg-surface px-2.5 py-1 font-semibold">
                  🔥 {stats.data.streak_days}-day streak
                </span>
                <span className="rounded-full bg-surface px-2.5 py-1 font-semibold">
                  Level {levelFrom(stats.data)}
                </span>
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          {stats.loading && <PageSpinner label="Loading your stats…" />}

          {stats.error && !stats.loading && (
            <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {stats.error}
            </div>
          )}

          {stats.data && (
            <>
              <div className="grid grid-cols-3 gap-2.5">
                <Card className="rounded-[14px] p-3">
                  <Stat value={String(stats.data.spaces_count)} label="Spaces" />
                </Card>
                <Card className="rounded-[14px] p-3">
                  <Stat value={String(stats.data.docs_indexed)} label="Docs" />
                </Card>
                <Card className="rounded-[14px] p-3">
                  <Stat
                    value={
                      stats.data.quiz_average != null ? `${stats.data.quiz_average}%` : '—'
                    }
                    label="Avg quiz"
                  />
                </Card>
              </div>

              <Card className="flex flex-col gap-2.5 p-4">
                <div className="flex text-[13px] font-semibold">
                  Study activity
                  <span className="ml-auto text-[11.5px] font-normal text-muted">
                    last {Math.ceil(stats.data.heatmap.length / 7)} weeks
                  </span>
                </div>
                <ActivityHeatmap cells={stats.data.heatmap} />
              </Card>

              <div className="flex flex-col gap-2">
                <SectionLabel>BADGES</SectionLabel>
                <div className="flex gap-2.5 text-center text-[11.5px]">
                  {stats.data.badges.map((badge) => (
                    <div
                      key={badge.id}
                      className={cn(
                        'flex-1 rounded-[14px] px-1.5 py-3',
                        badge.earned ? toneSoft[badge.tone] : 'bg-line-soft text-faint',
                      )}
                    >
                      {badge.earned ? badge.icon : '🔒'}
                      <div className={cn('mt-1', badge.earned && 'font-semibold')}>
                        {badge.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="mt-2 flex gap-2 text-[13px]">
            <Button
              variant="secondary"
              onClick={() => navigate('/settings')}
              className="flex-1"
            >
              Settings
            </Button>
            <Button
              onClick={doSignOut}
              className="flex-1 bg-coral-deep hover:bg-coral-deep/90"
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActivityHeatmap({ cells }: { cells: Stats['heatmap'] }) {
  // Split into rows of 14 columns to match the visual grid from the wireframe.
  const rows: (typeof cells)[] = []
  const COLS = 14
  for (let i = 0; i < cells.length; i += COLS) {
    rows.push(cells.slice(i, i + COLS))
  }
  if (rows.length === 0) {
    return <Skeleton className="h-16" />
  }
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, r) => (
        <div key={r} className="grid grid-cols-14 gap-1">
          {row.map((cell) => (
            <div
              key={cell.day}
              className={cn('aspect-square rounded', INTENSITY_CLASSES[Math.min(3, cell.intensity)])}
              title={`${cell.day} · intensity ${cell.intensity}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function levelFrom(stats: Stats): number {
  // Cheap, honest level formula: 1 point per minute studied this week, capped.
  const raw = Math.floor(stats.study_minutes_this_week / 20) + Math.floor(stats.max_streak / 3)
  return Math.max(1, Math.min(50, raw))
}
