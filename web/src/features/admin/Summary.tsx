/**
 * What the feedback says: the findings in words first, then the numbers behind
 * them, question by question. Everything is worked out on the server
 * (`services/feedback_summary.py`); this only draws it.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { friendlyMessage } from '../../api/errors'
import {
  getFeedbackSummary,
  SUMMARY_PERIODS,
  type FeedbackSummary,
  type SummaryItem,
  type SummaryPeriod,
} from '../../api/productFeedback'
import { cn } from '../../lib/cn'

const PERIOD_LABEL: Record<SummaryPeriod, string> = { 7: '7 days', 30: '30 days', 90: '90 days', 0: 'All time' }

const card = 'rounded-xl border border-line bg-surface p-4 sm:p-5'

/** 1–2 unhappy, 3 middling, 4–5 happy — the colour a person's rating is shown in. */
export function scoreTone(score: number | null): string {
  if (score === null) return 'bg-line text-muted'
  if (score <= 2) return 'bg-coral-soft text-coral-deep'
  if (score === 3) return 'bg-sun-soft text-sun-deep'
  return 'bg-jade-soft text-jade-deep'
}

export function percent(part: number, whole: number): number {
  return whole ? Math.round((100 * part) / whole) : 0
}

export function Summary() {
  const [days, setDays] = useState<SummaryPeriod>(30)
  const [data, setData] = useState<FeedbackSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    getFeedbackSummary(days)
      .then((s) => live && setData(s))
      .catch((err) => live && setError(friendlyMessage(err)))
    return () => {
      live = false
    }
  }, [days])

  const stale = data !== null && data.days !== days

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 self-start rounded-lg bg-well p-1" role="group" aria-label="Period">
        {SUMMARY_PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDays(p)}
            aria-pressed={days === p}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1 text-[13px] transition-colors',
              days === p ? 'bg-raised font-semibold text-ink' : 'font-medium text-muted hover:text-ink',
            )}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {error ? (
        <p className="text-[14px] text-coral-deep">{error}</p>
      ) : !data ? (
        <p className="text-[14px] text-muted">Reading the feedback…</p>
      ) : data.total === 0 ? (
        <p className={cn(card, 'text-[14px] text-muted')}>
          No feedback {data.days ? `in the last ${data.days} days` : 'yet'}.
          {data.previous_total ? ` There were ${data.previous_total} in the ${data.days} days before.` : ''}
        </p>
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity', stale && 'opacity-50')}>
          <Findings data={data} />
          <Tiles data={data} />
          <Days data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            {data.items.map((item) => (
              <Question key={item.question_id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Findings({ data }: { data: FeedbackSummary }) {
  return (
    <section aria-labelledby="findings" className={cn(card, 'border-brand/30')}>
      <h2 id="findings" className="setcode text-brand-deep">
        In short
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {data.takeaways.map((line, i) => (
          <li key={line} className={cn('flex gap-3 leading-snug', i === 0 ? 'text-[16px] font-semibold text-ink' : 'text-[14.5px] text-ink-2')}>
            <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
            {line}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Tiles({ data }: { data: FeedbackSummary }) {
  const rating = data.items.find((i) => i.kind === 'rating' && i.average !== null)
  const scale = data.items.find((i) => i.nps !== null)
  const change = data.previous_total === null ? null : data.total - data.previous_total
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Responses"
        value={data.total}
        note={
          change === null
            ? `${data.signed_in} signed in · ${data.visitors} visitors`
            : change === 0
              ? 'Same as the period before'
              : `${change > 0 ? '+' : '−'}${Math.abs(change)} on the period before`
        }
        tone={change && change > 0 ? 'good' : change && change < 0 ? 'bad' : undefined}
      />
      <Tile
        label="Overall rating"
        value={rating?.average != null ? rating.average.toFixed(1) : '—'}
        unit={rating ? '/ 5' : undefined}
        note={rating ? `${rating.positive_share}% gave 4 or 5` : 'No rating question answered'}
        tone={trend(rating)}
      />
      <Tile
        label="Recommend score"
        value={scale?.nps != null ? `${scale.nps > 0 ? '+' : ''}${scale.nps}` : '—'}
        note={scale ? `${scale.promoters} for · ${scale.detractors} against` : 'No 0–10 question answered'}
        tone={scale?.nps == null ? undefined : scale.nps > 0 ? 'good' : scale.nps < 0 ? 'bad' : undefined}
      />
      <Tile
        label="Waiting for a reply"
        value={data.want_reply}
        note={`${data.sources.landing ?? 0} from the landing page · ${data.sources.settings ?? 0} from Settings`}
      />
    </div>
  )
}

function trend(item: SummaryItem | undefined): 'good' | 'bad' | undefined {
  if (!item || item.average === null || item.previous_average === null) return undefined
  const moved = item.average - item.previous_average
  return moved > 0.05 ? 'good' : moved < -0.05 ? 'bad' : undefined
}

function Tile({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string
  value: ReactNode
  unit?: string
  note: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div className={card}>
      <p className="setcode text-faint">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="nameplate text-[30px] leading-none text-ink">{value}</span>
        {unit && <span className="text-[13px] text-muted">{unit}</span>}
      </p>
      <p className={cn('mt-2 text-[12.5px]', tone === 'good' ? 'text-jade-deep' : tone === 'bad' ? 'text-coral-deep' : 'text-muted')}>
        {note}
      </p>
    </div>
  )
}

function Days({ data }: { data: FeedbackSummary }) {
  if (data.by_day.length < 2) return null
  const peak = Math.max(1, ...data.by_day.map((d) => d.count))
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return (
    <section aria-labelledby="by-day" className={card}>
      <h2 id="by-day" className="setcode text-faint">
        Responses per day
      </h2>
      <div className="mt-3 flex h-20 items-end gap-[2px]" role="img" aria-label={`Busiest day: ${peak} responses`}>
        {data.by_day.map((d) => (
          <div
            key={d.date}
            title={`${label(d.date)} · ${d.count}`}
            className={cn('min-w-0 flex-1 rounded-t-[2px]', d.count ? 'bg-brand' : 'bg-line')}
            style={{ height: d.count ? `${Math.max(8, (100 * d.count) / peak)}%` : '2px' }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-faint">
        <span>{label(data.by_day[0].date)}</span>
        <span>{label(data.by_day[data.by_day.length - 1].date)}</span>
      </div>
    </section>
  )
}

function Question({ item }: { item: SummaryItem }) {
  const isText = item.kind === 'short' || item.kind === 'long'
  return (
    <section className={cn(card, isText && 'lg:col-span-2')}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14.5px] font-semibold leading-snug text-ink">{item.prompt}</h3>
        <span className="setcode shrink-0 text-faint">{item.responses} answered</span>
      </div>
      <div className="mt-3">
        {item.average !== null ? <Numbers item={item} /> : isText ? <Words item={item} /> : <Choices item={item} />}
      </div>
    </section>
  )
}

function Bars({ rows, total, tone }: { rows: [string, number][]; total: number; tone?: (label: string) => string }) {
  const peak = Math.max(1, ...rows.map(([, n]) => n))
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([label, n]) => (
        <li key={label} className="grid grid-cols-[minmax(1.5rem,auto)_1fr_auto] items-center gap-2.5 text-[13px]">
          <span className="max-w-[11rem] truncate text-ink-2" title={label}>
            {label}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-well">
            <span className={cn('block h-full rounded-full', tone?.(label) ?? 'bg-brand')} style={{ width: `${(100 * n) / peak}%` }} />
          </span>
          <span className="w-[4.5rem] text-right tabular-nums text-muted">
            {n} · {percent(n, total)}%
          </span>
        </li>
      ))}
    </ul>
  )
}

function Numbers({ item }: { item: SummaryItem }) {
  const top = item.kind === 'rating' ? 5 : 10
  const moved = item.previous_average === null || item.average === null ? 0 : item.average - item.previous_average
  // Highest first, so the good end reads at the top.
  const rows = Object.entries(item.distribution).reverse() as [string, number][]
  const tone = (label: string) => {
    const n = Number(label)
    if (item.kind === 'rating') return n >= 4 ? 'bg-jade' : n === 3 ? 'bg-sun' : 'bg-coral'
    return n >= 9 ? 'bg-jade' : n >= 7 ? 'bg-sun' : 'bg-coral'
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="nameplate text-[26px] leading-none text-brand">{item.average}</span>
        <span className="text-[13px] text-muted">
          average out of {top} · middle answer {item.median}
        </span>
        {Math.abs(moved) >= 0.05 && (
          <span className={cn('text-[12.5px]', moved > 0 ? 'text-jade-deep' : 'text-coral-deep')}>
            {moved > 0 ? '▲' : '▼'} {Math.abs(moved).toFixed(2)} since the period before
          </span>
        )}
      </p>
      {item.nps !== null && (
        <div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-well" role="img" aria-label={`Recommend score ${item.nps}`}>
            <span className="bg-jade" style={{ width: `${percent(item.promoters, item.responses)}%` }} />
            <span className="bg-sun" style={{ width: `${percent(item.passives, item.responses)}%` }} />
            <span className="bg-coral" style={{ width: `${percent(item.detractors, item.responses)}%` }} />
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted">
            {item.promoters} would recommend (9–10) · {item.passives} on the fence (7–8) · {item.detractors} would not (0–6)
          </p>
        </div>
      )}
      <Bars rows={rows} total={item.responses} tone={tone} />
    </div>
  )
}

function Choices({ item }: { item: SummaryItem }) {
  const rows = Object.entries(item.counts)
  if (!rows.length) return <p className="text-[13px] text-muted">Nothing to count yet.</p>
  return (
    <>
      <Bars rows={rows} total={item.responses} />
      {item.kind === 'multi' && (
        <p className="mt-2 text-[12px] text-faint">Share of people who picked each; they could pick several.</p>
      )}
    </>
  )
}

function Words({ item }: { item: SummaryItem }) {
  const [lowOnly, setLowOnly] = useState(false)
  const [word, setWord] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const low = item.texts.filter((t) => t.score !== null && t.score <= 2).length
  const shown = item.texts.filter(
    (t) => (!lowOnly || (t.score !== null && t.score <= 2)) && (!word || t.text.toLowerCase().includes(word)),
  )
  const visible = all ? shown : shown.slice(0, 6)
  if (!item.texts.length) return <p className="text-[13px] text-muted">Nobody wrote anything here.</p>

  const chip = (on: boolean) =>
    cn(
      'cursor-pointer rounded-full border px-2.5 py-0.5 text-[12.5px] transition-colors',
      on ? 'border-brand bg-brand-soft text-brand-deep' : 'border-line text-muted hover:text-ink',
    )
  return (
    <div className="flex flex-col gap-3">
      {(item.keywords.length > 0 || low > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {low > 0 && (
            <button type="button" aria-pressed={lowOnly} onClick={() => setLowOnly(!lowOnly)} className={chip(lowOnly)}>
              From unhappy people · {low}
            </button>
          )}
          {item.keywords.map((k) => (
            <button
              key={k.word}
              type="button"
              aria-pressed={word === k.word}
              onClick={() => setWord(word === k.word ? null : k.word)}
              className={chip(word === k.word)}
              title={`Mentioned in ${k.count} answers`}
            >
              {k.word} · {k.count}
            </button>
          ))}
        </div>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {visible.map((t, i) => (
          <li key={`${t.created_at}-${i}`} className="rounded-lg border border-line bg-well p-3">
            <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink">{t.text}</p>
            <p className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">
              <span className={cn('rounded-full px-1.5 py-px font-semibold tabular-nums', scoreTone(t.score))}>
                {t.score === null ? 'no rating' : `rated ${t.score}/5`}
              </span>
              {t.created_at && new Date(t.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </p>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p className="text-[13px] text-muted">Nothing matches.</p>}
      {shown.length > 6 && (
        <button type="button" onClick={() => setAll(!all)} className="cursor-pointer self-start text-[13px] text-brand-deep hover:underline">
          {all ? 'Show fewer' : `Show all ${shown.length}`}
        </button>
      )}
    </div>
  )
}
