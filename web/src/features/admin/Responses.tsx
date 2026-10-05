/** Every response, newest first: read one in full, search them, remove junk. */

import { useEffect, useMemo, useState } from 'react'
import { friendlyMessage } from '../../api/errors'
import {
  deleteResponse,
  listResponses,
  RESPONSES_PAGE,
  type FeedbackResponse,
  type StoredAnswer,
} from '../../api/productFeedback'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { scoreTone } from './format'

const shown = (value: StoredAnswer['value']) => (Array.isArray(value) ? value.join(', ') : String(value))
/** The answer with what they added after it, for search and the spreadsheet. */
const full = (a: StoredAnswer) => (a.detail ? `${shown(a.value)} — ${a.detail}` : shown(a.value))

const overall = (r: FeedbackResponse): number | null => {
  const first = r.answers.find((a) => a.kind === 'rating')
  return typeof first?.value === 'number' ? first.value : null
}

/** One line per response, for a spreadsheet. Quoted so commas and line breaks survive. */
export function toCsv(rows: FeedbackResponse[]): string {
  const prompts = [...new Set(rows.flatMap((r) => r.answers.map((a) => a.prompt)))]
  // A leading = + - @ would run as a formula in a spreadsheet; an apostrophe makes it text.
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`
  const lines = rows.map((r) =>
    [r.created_at, r.source, r.signed_in ? 'signed in' : 'visitor', r.contact_email ?? '', ...prompts.map((p) => {
      const a = r.answers.find((x) => x.prompt === p)
      return a ? full(a) : ''
    })].map(cell).join(','),
  )
  return [['When', 'From', 'Who', 'Reply to', ...prompts].map(cell).join(','), ...lines].join('\n')
}

export function Responses() {
  const { show, showError } = useToast()
  const [rows, setRows] = useState<FeedbackResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [done, setDone] = useState(false)
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<FeedbackResponse | null>(null)

  useEffect(() => {
    listResponses()
      .then((r) => {
        setRows(r)
        setDone(r.length < RESPONSES_PAGE)
      })
      .catch((err) => setError(friendlyMessage(err)))
  }, [])

  const older = async () => {
    if (!rows?.length || loadingMore) return
    setLoadingMore(true)
    try {
      const more = await listResponses(rows[rows.length - 1].created_at)
      setRows([...rows, ...more])
      setDone(more.length < RESPONSES_PAGE)
    } catch (err) {
      showError(err)
    } finally {
      setLoadingMore(false)
    }
  }

  const remove = async () => {
    if (!removing) return
    const target = removing
    setRemoving(null)
    try {
      await deleteResponse(target.id)
      setRows((prev) => prev?.filter((r) => r.id !== target.id) ?? prev)
      show('Response deleted.', 'success')
    } catch (err) {
      showError(err)
    }
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!rows || !q) return rows ?? []
    return rows.filter(
      (r) => r.contact_email?.toLowerCase().includes(q) || r.answers.some((a) => full(a).toLowerCase().includes(q)),
    )
  }, [rows, query])

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'space-learn-feedback.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  if (error) return <p className="text-[14px] text-coral-deep">{error}</p>
  if (!rows) return <p className="text-[14px] text-muted">Loading responses…</p>
  if (rows.length === 0) return <p className="text-[14px] text-muted">No feedback yet.</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what people wrote"
          aria-label="Search responses"
          className="min-w-0 flex-1 rounded-lg border border-line bg-well px-3 py-2 text-[14px] text-ink outline-none placeholder:text-faint focus:border-brand/70 sm:max-w-sm"
        />
        <span className="setcode text-faint">
          {visible.length} of {rows.length} loaded
        </span>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={download} disabled={!visible.length}>
          Download CSV
        </Button>
      </div>

      <ul className="flex flex-col gap-2">
        {visible.map((r) => {
          const score = overall(r)
          return (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
                <span className={cn('rounded-full px-1.5 py-px font-semibold tabular-nums', scoreTone(score))}>
                  {score === null ? 'no rating' : `${score}/5`}
                </span>
                <span>{new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span>· {r.source === 'landing' ? 'Landing page' : 'Settings'}</span>
                <span>· {r.signed_in ? 'Signed-in user' : 'Visitor'}</span>
                {r.contact_email && (
                  <a href={`mailto:${r.contact_email}`} className="text-brand-deep hover:underline">
                    · Reply to {r.contact_email}
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setRemoving(r)}
                  aria-label="Delete this response"
                  title="Delete"
                  className="ml-auto grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-line-soft hover:text-coral-deep"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {r.answers.map((a) => (
                  <div key={a.question_id} className={cn('text-[13.5px]', (a.kind === 'long' || a.kind === 'short') && 'sm:col-span-2')}>
                    <dt className="text-[12.5px] text-muted">{a.prompt}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words text-ink">
                      {shown(a.value)}
                      {a.kind === 'rating' && <span className="text-faint"> / 5</span>}
                      {a.kind === 'scale' && <span className="text-faint"> / 10</span>}
                      {a.detail && <span className="mt-0.5 block text-ink-2">“{a.detail}”</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          )
        })}
      </ul>
      {visible.length === 0 && <p className="text-[14px] text-muted">Nothing matches “{query}” in what is loaded.</p>}
      {!done && (
        <Button variant="secondary" size="sm" className="self-start" disabled={loadingMore} onClick={() => void older()}>
          {loadingMore ? 'Loading…' : 'Load older'}
        </Button>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Delete this response?"
        description="It is removed for good and drops out of the summary. Use this for spam and tests."
        confirmLabel="Delete"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  )
}
