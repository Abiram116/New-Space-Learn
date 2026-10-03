/**
 * What the model calls have cost since the server last started: per model
 * today, then per task. Counted on the server (`services/usage.py`), which
 * keeps counts only — no prompt, reply or student.
 */

import { useCallback, useEffect, useState } from 'react'
import { adminFetch } from '../../api/admin'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'

type TaskRow = {
  task: string
  model: string
  calls: number
  prompt: number
  reply: number
  reasoning: number
  cached: number
  largest_prompt: number
  seconds: number
}

type ModelRow = {
  model: string
  day: string
  tokens_today: number
  calls_today: number
  refused_minute: number
  refused_day: number
  limits: Record<string, string>
}

type UsageSnapshot = { since: number; tasks: TaskRow[]; models: ModelRow[] }

const card = 'rounded-xl border border-line bg-surface p-4 sm:p-5'
const num = (n: number) => n.toLocaleString()
const short = (model: string) => model.split('/').pop() ?? model

export function Usage() {
  const [data, setData] = useState<UsageSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    adminFetch<UsageSnapshot>('/admin/usage')
      .then(setData)
      .catch((err) => setError(friendlyMessage(err)))
  }, [])

  useEffect(load, [load])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="text-[13.5px] text-muted">
          {data ? `Counted since the server started, ${new Date(data.since * 1000).toLocaleString()}.` : ' '}
        </p>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={load}>
          <Icon name="refresh" size={14} /> Refresh
        </Button>
      </div>

      {error ? (
        <p className="text-[14px] text-coral-deep">{error}</p>
      ) : !data ? (
        <p className="text-[14px] text-muted">Counting…</p>
      ) : data.tasks.length === 0 ? (
        <p className={cn(card, 'text-[14px] text-muted')}>No model calls since the server started.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.models.map((m) => (
              <section key={m.model} className={card}>
                <h2 className="setcode text-brand-deep">{short(m.model)}</h2>
                <p className="mt-2 text-[22px] font-semibold text-ink">{num(m.tokens_today)}</p>
                <p className="text-[13px] text-muted">
                  tokens today (UTC) · {num(m.calls_today)} calls
                </p>
                <p className="mt-2 text-[13px] text-ink-2">
                  {m.limits['remaining-tokens'] !== undefined &&
                    `${num(Number(m.limits['remaining-tokens']))} of ${num(Number(m.limits['limit-tokens'] ?? 0))} left this minute`}
                </p>
                {(m.refused_minute > 0 || m.refused_day > 0) && (
                  <p className="mt-1 text-[13px] text-coral-deep">
                    Refused: {m.refused_minute} for the minute limit, {m.refused_day} for the daily limit
                  </p>
                )}
              </section>
            ))}
          </div>

          <section className={cn(card, 'overflow-x-auto p-0 sm:p-0')}>
            <table className="w-full min-w-[640px] text-left text-[13.5px]">
              <thead className="text-[12px] uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2.5 font-medium">Task</th>
                  <th className="px-3 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                  <th className="px-3 py-2.5 text-right font-medium">Prompt / call</th>
                  <th className="px-3 py-2.5 text-right font-medium">Largest</th>
                  <th className="px-3 py-2.5 text-right font-medium">Reply / call</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cached</th>
                  <th className="px-4 py-2.5 text-right font-medium">Seconds / call</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={`${t.task}:${t.model}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">{t.task}</td>
                    <td className="px-3 py-2.5 text-muted">{short(t.model)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(t.calls)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(Math.round(t.prompt / t.calls))}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(t.largest_prompt)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {num(Math.round(t.reply / t.calls))}
                      {t.reasoning > 0 && (
                        <span className="text-muted"> ({num(Math.round(t.reasoning / t.calls))} thinking)</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {t.prompt ? `${Math.round((100 * t.cached) / t.prompt)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{(t.seconds / t.calls).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
