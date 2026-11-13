/**
 * One quiet screen of numbers: people, what they do, how far they get, and what
 * they say. Fetched once on open and again only when Refresh is pressed; the
 * server works it out from a few counts and keeps the result for a minute.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { adminFetch } from '../../api/admin'
import { friendlyMessage } from '../../api/errors'
import { getFeedbackSummary, type FeedbackSummary, type SummaryItem } from '../../api/productFeedback'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Responses } from './Responses'

type Windowed = { total: number; this_week: number | null; last_week: number | null }
export type DashboardData = {
  generated_at: string
  users: {
    total: number
    new_7d: number
    new_30d: number
    active_1d: number
    active_7d: number
    active_30d: number
    daily: { date: string; count: number }[]
  }
  usage: Record<'messages' | 'files' | 'notes' | 'cards' | 'quizzes' | 'reviews', Windowed>
  funnel: { steps: { label: string; count: number; percent: number }[]; approximate: boolean }
}

const num = (n: number) => n.toLocaleString()

const USAGE_ROWS: { key: keyof DashboardData['usage']; label: string }[] = [
  { key: 'messages', label: 'Questions asked' },
  { key: 'files', label: 'Files uploaded' },
  { key: 'notes', label: 'Notes' },
  { key: 'cards', label: 'Flashcards' },
  { key: 'quizzes', label: 'Quizzes taken' },
  { key: 'reviews', label: 'Cards reviewed' },
]

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {note && <p className="mt-1 text-[13px] text-faint">{note}</p>}
      </div>
      {children}
    </section>
  )
}

function Big({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <p className="text-[36px] font-semibold leading-none tabular-nums text-ink sm:text-[44px]">{num(value)}</p>
      <p className="mt-2 text-[13.5px] text-muted">{label}</p>
      {hint && <p className="text-[12.5px] text-faint">{hint}</p>}
    </div>
  )
}

/** Daily active people for the last 30 days: plain bars in an SVG. */
function DailyBars({ days }: { days: { date: string; count: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.count))
  const w = 600
  const h = 90
  const slot = w / Math.max(1, days.length)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Active people per day, last 30 days" className="h-24 w-full text-brand">
      {days.map((d, i) => {
        const bar = Math.max(d.count ? 3 : 1, (d.count / max) * (h - 4))
        return (
          <rect key={d.date} x={i * slot + slot * 0.15} y={h - bar} width={slot * 0.7} height={bar} rx={1.5} fill="currentColor" opacity={d.count ? 0.9 : 0.2}>
            <title>{`${d.date}: ${d.count}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function Bar({ label, count, of }: { label: string; count: number; of: number }) {
  const share = of ? Math.round((100 * count) / of) : 0
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-[13.5px]">
      <span className="truncate text-ink-2">{label}</span>
      <span className="tabular-nums text-muted">
        {count} · {share}%
      </span>
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-well">
        <div className="h-full rounded-full bg-brand" style={{ width: `${share}%` }} />
      </div>
    </div>
  )
}

function change(w: Windowed): string {
  if (w.this_week === null || w.last_week === null) return ''
  const diff = w.this_week - (w.last_week ?? 0)
  return diff === 0 ? 'same as last week' : `${diff > 0 ? '+' : '−'}${Math.abs(diff)} on last week`
}

function QuestionBars({ item }: { item: SummaryItem }) {
  const counts = Object.keys(item.counts).length ? item.counts : item.distribution
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14.5px] font-medium text-ink">
        {item.prompt} <span className="font-normal text-faint">({item.responses})</span>
      </p>
      {entries.map(([label, n]) => (
        <Bar key={label} label={label} count={n} of={item.responses} />
      ))}
    </div>
  )
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  const load = useCallback(() => {
    setError(null)
    adminFetch<DashboardData>('/admin/dashboard')
      .then(setData)
      .catch((err) => setError(friendlyMessage(err)))
    getFeedbackSummary(0)
      .then(setFeedback)
      .catch(() => setFeedback(null))
    setRound((r) => r + 1)
  }, [])

  // Once, on open. No timers: the Refresh button is the only way to ask again.
  useEffect(load, [load])

  return (
    <div className="flex flex-col gap-12">
      <div className="flex items-center gap-3">
        <p className="text-[22px] font-semibold text-ink">Hello Boss</p>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={load}>
          <Icon name="refresh" size={14} /> Refresh
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-[14px] text-coral-deep">
          {error}
        </p>
      ) : !data ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : (
        <>
          <Section title="People" note="Everyone who has opened the app and set it up.">
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
              <Big label="Signed up" value={data.users.total} />
              <Big label="New in 7 days" value={data.users.new_7d} />
              <Big label="New in 30 days" value={data.users.new_30d} />
              <Big label="Active today" value={data.users.active_1d} />
              <Big label="Active in 7 days" value={data.users.active_7d} />
              <Big label="Active in 30 days" value={data.users.active_30d} />
            </div>
            <div>
              <p className="mb-2 text-[13px] text-muted">People active each day, last 30 days</p>
              <DailyBars days={data.users.daily} />
            </div>
          </Section>

          <Section title="What people do">
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
              {USAGE_ROWS.map(({ key, label }) => {
                const w = data.usage[key]
                const hint =
                  w.this_week === null ? '' : `${num(w.this_week)} this week · ${change(w)}`
                return <Big key={key} label={label} value={w.total} hint={hint} />
              })}
            </div>
          </Section>

          <Section
            title="How far people get"
            note={
              data.funnel.approximate
                ? 'Rough: worked out from the most recent activity only.'
                : 'Each step as a share of everyone who signed up.'
            }
          >
            <ol className="flex flex-col gap-3">
              {data.funnel.steps.map((s) => (
                <li key={s.label}>
                  <Bar label={s.label} count={s.count} of={data.funnel.steps[0].count} />
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}

      <Section title="Feedback" note={feedback ? `${num(feedback.total)} responses so far.` : undefined}>
        {feedback && feedback.items.some((i) => Object.keys(i.counts).length || Object.keys(i.distribution).length) && (
          <div className="grid gap-8 md:grid-cols-2">
            {feedback.items.map((item) => (
              <QuestionBars key={item.question_id} item={item} />
            ))}
          </div>
        )}
        <h3 className="text-[14.5px] font-medium text-ink">Latest responses</h3>
        <Responses key={round} />
      </Section>
    </div>
  )
}
