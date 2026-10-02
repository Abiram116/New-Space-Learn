/**
 * The feedback form's questions: add, reword, reorder, retire, delete. What is
 * saved here is what the form asks from the next time it is opened.
 */

import { useCallback, useEffect, useState } from 'react'
import { friendlyMessage } from '../../api/errors'
import {
  createQuestion,
  deleteQuestion,
  listQuestions,
  reorderQuestions,
  updateQuestion,
  type FeedbackQuestion,
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

// ── Questions ──────────────────────────────────────────────────────────

export function Questions() {
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
      <p className="text-[13.5px] text-muted">
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
                  await patch(q, {
                    prompt: values.prompt,
                    required: values.required,
                    ...(hasOptions(q.kind) ? { options: values.options, detail_options: values.detail_options } : {}),
                  })
                  setEditing(null)
                }}
              />
            </li>
          ) : (
            <li
              key={q.id}
              className={cn('flex items-start gap-3 rounded-lg border border-line bg-surface px-3 py-2.5', !q.active && 'opacity-60')}
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
                  {q.detail_options?.length > 0 && ` · asks for more on: ${q.detail_options.join(', ')}`}
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

type Draft = { prompt: string; kind: QuestionKind; options: string[]; detail_options: string[]; required: boolean }

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
  const [asks, setAsks] = useState<string[]>(question?.detail_options ?? [])
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
          await onSave({
            prompt: prompt.trim(),
            kind,
            options: hasOptions(kind) ? options : [],
            detail_options: hasOptions(kind) ? options.filter((o) => asks.includes(o)) : [],
            required,
          })
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
      {hasOptions(kind) && options.length > 0 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="setcode mb-1.5">Ask “tell us more” when someone picks</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {options.map((o) => (
              <label key={o} className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink-2">
                <input
                  type="checkbox"
                  checked={asks.includes(o)}
                  onChange={(e) => setAsks((prev) => (e.target.checked ? [...prev, o] : prev.filter((x) => x !== o)))}
                  className="accent-[var(--color-brand)]"
                />
                {o}
              </label>
            ))}
          </div>
          <p className="text-[12.5px] text-faint">A small text box opens under the question for those choices. It is optional to fill in.</p>
        </fieldset>
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
