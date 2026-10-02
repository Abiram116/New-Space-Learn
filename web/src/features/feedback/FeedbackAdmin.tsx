/**
 * The admin side of the feedback form: change what is asked, and read what
 * people said. Shown only to the accounts on the server's admin list — and the
 * server checks that again on every call, so hiding this is a courtesy, not
 * the lock.
 */

import { useCallback, useEffect, useState } from 'react'
import { friendlyMessage } from '../../api/errors'
import {
  createQuestion,
  deleteQuestion,
  getFeedbackSummary,
  listQuestions,
  listResponses,
  reorderQuestions,
  updateQuestion,
  type FeedbackQuestion,
  type FeedbackResponse,
  type FeedbackSummary,
  type QuestionKind,
} from '../../api/productFeedback'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'

const KIND_LABEL: Record<QuestionKind, string> = {
  rating: 'Rating 1–5',
  scale: 'Scale 0–10',
  choice: 'Pick one',
  multi: 'Pick any',
  short: 'One line',
  long: 'Paragraph',
}
const KINDS = Object.keys(KIND_LABEL) as QuestionKind[]
const hasOptions = (kind: QuestionKind) => kind === 'choice' || kind === 'multi'

/** One choice per line → a clean list. */
export function parseOptions(text: string): string[] {
  return [...new Set(text.split('\n').map((l) => l.trim()).filter(Boolean))]
}

const field =
  'w-full rounded-lg border border-line bg-well px-3 py-2 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand/70'

export function FeedbackAdmin() {
  const [tab, setTab] = useState<'questions' | 'responses'>('questions')
  return (
    <section aria-labelledby="feedback-admin" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="feedback-admin" className="text-[14.5px] font-semibold text-ink">
          Manage feedback
        </h3>
        <span className="setcode rounded-full bg-brand-soft px-2 py-0.5 text-brand-deep">Admin</span>
        <div className="ml-auto flex gap-1 rounded-lg bg-well p-1">
          {(['questions', 'responses'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn(
                'cursor-pointer rounded-md px-3 py-1 text-[13px] capitalize transition-colors',
                tab === t ? 'bg-raised font-semibold text-ink' : 'font-medium text-muted hover:text-ink',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === 'questions' ? <Questions /> : <Responses />}
    </section>
  )
}

// ── Questions ──────────────────────────────────────────────────────────

function Questions() {
  const { show, showError } = useToast()
  const [list, setList] = useState<FeedbackQuestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [removing, setRemoving] = useState<FeedbackQuestion | null>(null)

  const load = useCallback(() => {
    listQuestions()
      .then(setList)
      .catch((err) => setError(friendlyMessage(err)))
  }, [])
  useEffect(load, [load])

  const patch = async (q: FeedbackQuestion, change: Parameters<typeof updateQuestion>[1]) => {
    try {
      const updated = await updateQuestion(q.id, change)
      setList((prev) => prev?.map((x) => (x.id === q.id ? updated : x)) ?? prev)
    } catch (err) {
      showError(err)
    }
  }

  const move = async (index: number, by: -1 | 1) => {
    if (!list) return
    const next = [...list]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    setList(next) // straight away; put back if the server says no
    try {
      await reorderQuestions(next.map((q) => q.id))
    } catch (err) {
      setList(list)
      showError(err)
    }
  }

  const remove = async () => {
    if (!removing) return
    const target = removing
    setRemoving(null)
    try {
      await deleteQuestion(target.id)
      setList((prev) => prev?.filter((q) => q.id !== target.id) ?? prev)
      show('Question deleted.', 'success')
    } catch (err) {
      showError(err)
    }
  }

  if (error) return <p className="text-[14px] text-coral-deep">{error}</p>
  if (!list) return <p className="text-[14px] text-muted">Loading questions…</p>

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted">
        People see the active questions, in this order. Retire one to stop asking it without losing its answers.
      </p>
      <ul className="flex flex-col gap-2">
        {list.map((q, i) =>
          editing === q.id ? (
            <li key={q.id}>
              <QuestionEditor
                question={q}
                onCancel={() => setEditing(null)}
                onSave={async (values) => {
                  await patch(q, { prompt: values.prompt, required: values.required, ...(hasOptions(q.kind) ? { options: values.options } : {}) })
                  setEditing(null)
                }}
              />
            </li>
          ) : (
            <li
              key={q.id}
              className={cn('flex items-start gap-3 rounded-lg border border-line bg-well px-3 py-2.5', !q.active && 'opacity-60')}
            >
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  aria-label={`Move “${q.prompt}” up`}
                  disabled={i === 0}
                  onClick={() => void move(i, -1)}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted hover:bg-line-soft hover:text-ink disabled:cursor-default disabled:opacity-30"
                >
                  <Icon name="chevronDown" size={13} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button
                  type="button"
                  aria-label={`Move “${q.prompt}” down`}
                  disabled={i === list.length - 1}
                  onClick={() => void move(i, 1)}
                  className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted hover:bg-line-soft hover:text-ink disabled:cursor-default disabled:opacity-30"
                >
                  <Icon name="chevronDown" size={13} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-ink">{q.prompt}</p>
                <p className="mt-0.5 text-[12.5px] text-muted">
                  {KIND_LABEL[q.kind]}
                  {hasOptions(q.kind) && ` · ${q.options.join(', ')}`}
                  {' · '}
                  {q.required ? 'Required' : 'Optional'}
                  {!q.active && ' · Retired'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(q.id)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void patch(q, { active: !q.active })}>
                  {q.active ? 'Retire' : 'Restore'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoving(q)} aria-label={`Delete “${q.prompt}”`}>
                  <Icon name="trash" size={14} />
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>

      {editing === 'new' ? (
        <QuestionEditor
          onCancel={() => setEditing(null)}
          onSave={async (values) => {
            try {
              const made = await createQuestion(values)
              setList((prev) => [...(prev ?? []), made])
              setEditing(null)
              show('Question added.', 'success')
            } catch (err) {
              showError(err)
            }
          }}
        />
      ) : (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> Add a question
        </Button>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Delete this question?"
        description="It disappears from the form for good. Answers already given are kept. To stop asking it but keep it here, retire it instead."
        confirmLabel="Delete"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => void remove()}
      />
    </div>
  )
}

type Draft = { prompt: string; kind: QuestionKind; options: string[]; required: boolean }

function QuestionEditor({
  question,
  onSave,
  onCancel,
}: {
  /** Absent when adding. The kind of an existing question cannot change: its
   *  old answers would stop making sense. */
  question?: FeedbackQuestion
  onSave: (values: Draft) => Promise<void>
  onCancel: () => void
}) {
  const [prompt, setPrompt] = useState(question?.prompt ?? '')
  const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'choice')
  const [optionsText, setOptionsText] = useState((question?.options ?? []).join('\n'))
  const [required, setRequired] = useState(question?.required ?? true)
  const [busy, setBusy] = useState(false)

  const options = parseOptions(optionsText)
  const problem =
    prompt.trim().length < 3
      ? 'Write the question.'
      : hasOptions(kind) && options.length < 2
        ? 'Give at least two choices, one per line.'
        : hasOptions(kind) && options.some((o) => o.length > LIMITS.feedbackOption)
          ? `Keep each choice under ${LIMITS.feedbackOption} characters.`
          : null

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-well p-3"
      onSubmit={async (e) => {
        e.preventDefault()
        if (problem || busy) return
        setBusy(true)
        try {
          await onSave({ prompt: prompt.trim(), kind, options: hasOptions(kind) ? options : [], required })
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="setcode">Question</span>
        <input
          autoFocus
          value={prompt}
          maxLength={LIMITS.feedbackPrompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should we ask?"
          className={field}
        />
      </label>
      {!question && (
        <div className="flex flex-col gap-1.5">
          <span className="setcode">Answered with</span>
          <Select
            value={kind}
            onChange={(v) => setKind(v as QuestionKind)}
            ariaLabel="Answered with"
            options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            className="max-w-xs"
          />
        </div>
      )}
      {hasOptions(kind) && (
        <label className="flex flex-col gap-1.5">
          <span className="setcode">Choices — one per line</span>
          <textarea
            rows={Math.max(3, options.length + 1)}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            className={cn(field, 'resize-y leading-relaxed')}
          />
        </label>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-2">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-[var(--color-brand)]" />
        People must answer this
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={Boolean(problem) || busy}>
          {busy ? 'Saving…' : question ? 'Save' : 'Add question'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {problem && <span className="text-[12.5px] text-muted">{problem}</span>}
      </div>
    </form>
  )
}

// ── Responses ──────────────────────────────────────────────────────────

function Responses() {
  const [summary, setSummary] = useState<FeedbackSummary | null>(null)
  const [rows, setRows] = useState<FeedbackResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    Promise.all([getFeedbackSummary(), listResponses()])
      .then(([s, r]) => {
        setSummary(s)
        setRows(r)
        setDone(r.length < 30)
      })
      .catch((err) => setError(friendlyMessage(err)))
  }, [])

  const older = async () => {
    if (!rows?.length || loadingMore) return
    setLoadingMore(true)
    try {
      const more = await listResponses(rows[rows.length - 1].created_at)
      setRows([...rows, ...more])
      setDone(more.length < 30)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setLoadingMore(false)
    }
  }

  if (error) return <p className="text-[14px] text-coral-deep">{error}</p>
  if (!rows || !summary) return <p className="text-[14px] text-muted">Loading responses…</p>
  if (rows.length === 0) return <p className="text-[14px] text-muted">No feedback yet.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {summary.items
          .filter((item) => item.average !== null || Object.keys(item.counts).length > 0)
          .map((item) => (
            <div key={item.question_id} className="rounded-lg border border-line bg-well p-3">
              <p className="text-[12.5px] text-muted">{item.prompt}</p>
              {item.average !== null ? (
                <p className="mt-1 text-[14px] text-ink">
                  <span className="nameplate text-[22px] text-brand">{item.average}</span>
                  <span className="ml-1.5 text-muted">
                    average of {item.responses} · out of {item.kind === 'rating' ? 5 : 10}
                  </span>
                </p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-ink-2">
                  {Object.entries(item.counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([choice, n]) => (
                      <li key={choice} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{choice}</span>
                        <span className="tabular-nums text-muted">{n}</span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
      </div>
      <p className="setcode text-faint">Latest {rows.length} of the most recent · summary over the last {summary.total}</p>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-well p-3">
            <p className="setcode text-faint">
              {new Date(r.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {r.source === 'landing' ? 'Landing page' : 'Settings'} · {r.signed_in ? 'Signed-in user' : 'Visitor'}
              {r.contact_email && (
                <>
                  {' · '}
                  <a href={`mailto:${r.contact_email}`} className="text-brand-deep hover:underline">
                    {r.contact_email}
                  </a>
                </>
              )}
            </p>
            <dl className="mt-2 flex flex-col gap-1.5">
              {r.answers.map((a) => (
                <div key={a.question_id} className="text-[13.5px]">
                  <dt className="text-muted">{a.prompt}</dt>
                  <dd className="whitespace-pre-wrap text-ink">{Array.isArray(a.value) ? a.value.join(', ') : String(a.value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {!done && (
        <Button variant="secondary" size="sm" className="self-start" disabled={loadingMore} onClick={() => void older()}>
          {loadingMore ? 'Loading…' : 'Load older'}
        </Button>
      )}
    </div>
  )
}
