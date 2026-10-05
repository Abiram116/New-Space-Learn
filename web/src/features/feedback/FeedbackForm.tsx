/**
 * The feedback form — the same one in Settings › Feedback and on the landing
 * page's Feedback card.
 *
 * It asks the questions the server sends, in order, each drawn by its `kind`
 * (a rating, a 0–10 scale, pick one, pick any, a line, a paragraph), so the
 * two admins can change what is asked without a deploy. Guided questions come
 * first so nobody faces an empty box; the open one is last.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { friendlyMessage } from '../../api/errors'
import {
  getFeedbackForm,
  sendProductFeedback,
  type AnswerValue,
  type FeedbackQuestion,
} from '../../api/productFeedback'
import { Button } from '../../components/ui/Button'
import { Skeleton } from '../../components/ui/Skeleton'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'

type Answers = Record<string, AnswerValue | undefined>

/** Nothing chosen, or nothing but spaces. */
export function isBlank(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** Whether what was picked is a choice that asks for more ("Something broke"). */
export function asksForDetail(question: FeedbackQuestion, value: AnswerValue | undefined): boolean {
  const asks = question.detail_options ?? []
  if (!asks.length || value === undefined) return false
  return (Array.isArray(value) ? value : [value]).some((v) => typeof v === 'string' && asks.includes(v))
}

/** The required questions still unanswered, in order. */
export function missingRequired(questions: FeedbackQuestion[], answers: Answers): string[] {
  return questions.filter((q) => q.required && isBlank(answers[q.id])).map((q) => q.id)
}

const chip = (on: boolean) =>
  cn(
    'cursor-pointer rounded-full border px-3.5 py-2 text-[13.5px] transition-colors',
    on
      ? 'border-brand bg-brand font-semibold text-[#1a120f]'
      : 'border-white/10 bg-white/[0.04] font-medium text-ink-2 hover:border-white/25 hover:text-ink',
  )
const field =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[14.5px] text-ink outline-none transition-colors placeholder:text-faint focus:border-brand/70'

export function FeedbackForm({ source }: { source: 'landing' | 'settings' }) {
  const { session } = useAuth()
  const signedIn = Boolean(session)

  const [questions, setQuestions] = useState<FeedbackQuestion[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [details, setDetails] = useState<Record<string, string>>({})
  const [email, setEmail] = useState('')
  const [trap, setTrap] = useState('')
  const [missing, setMissing] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const load = useCallback(() => {
    setLoadError(null)
    getFeedbackForm()
      .then(setQuestions)
      .catch((err) => setLoadError(friendlyMessage(err)))
  }, [])
  useEffect(load, [load])

  const set = (id: string, value: AnswerValue | undefined) => {
    setAnswers((prev) => ({ ...prev, [id]: value }))
    setMissing((prev) => prev.filter((m) => m !== id))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!questions || sending) return
    const gaps = missingRequired(questions, answers)
    setMissing(gaps)
    if (gaps.length > 0) {
      // Take them to the first one they skipped rather than only saying so.
      formRef.current?.querySelector<HTMLElement>(`[data-question="${gaps[0]}"]`)?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }
    setSending(true)
    setSendError(null)
    try {
      await sendProductFeedback({
        source,
        answers: questions
          .filter((q) => !isBlank(answers[q.id]))
          .map((q) => {
            const value = answers[q.id]!
            const detail = asksForDetail(q, value) ? details[q.id]?.trim() : ''
            return {
              question_id: q.id,
              value: typeof value === 'string' ? value.trim() : value,
              ...(detail ? { detail } : {}),
            }
          }),
        contact_email: !signedIn && email.trim() ? email.trim() : undefined,
        page: (window.location.pathname + window.location.search).slice(0, 300),
        website: trap,
      })
      setSent(true)
      setAnswers({})
      setDetails({})
      setEmail('')
    } catch (err) {
      // Nothing typed is thrown away: the answers stay in the form.
      setSendError(friendlyMessage(err))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div role="status" className="rounded-2xl border border-brand/30 bg-brand/10 p-6">
        <p className="text-[17px] font-semibold text-ink">Thank you. We read every one.</p>
        <p className="mt-1.5 text-[14.5px] text-ink-2">
          This goes straight to the two of us, and it shapes what we build next.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="mt-4 cursor-pointer text-[13.5px] font-semibold text-brand-deep underline-offset-4 hover:underline"
        >
          Send another
        </button>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-[14px] text-coral-deep">
        <p>{loadError}</p>
        <Button size="sm" variant="secondary" onClick={load}>
          Try again
        </Button>
      </div>
    )
  }

  if (!questions) {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (questions.length === 0) {
    return <p className="text-[14.5px] text-muted">The feedback form isn't ready right now. Please check back soon.</p>
  }

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-7">
      {questions.map((q, i) => {
        const value = answers[q.id]
        const skipped = missing.includes(q.id)
        return (
          <fieldset key={q.id} data-question={q.id} className="min-w-0">
            <legend className="mb-3 flex gap-2.5 text-[15.5px] font-semibold leading-snug text-ink">
              <span className="setcode mt-[3px] shrink-0 tabular-nums text-brand">{String(i + 1).padStart(2, '0')}</span>
              <span>
                {q.prompt}
                {!q.required && <span className="ml-2 text-[12.5px] font-normal text-faint">optional</span>}
              </span>
            </legend>
            <Answer question={q} value={value} onChange={(v) => set(q.id, v)} />
            {asksForDetail(q, value) && (
              <input
                autoFocus
                value={details[q.id] ?? ''}
                maxLength={LIMITS.feedbackDetail}
                onChange={(e) => setDetails((prev) => ({ ...prev, [q.id]: e.target.value }))}
                placeholder="Tell us a bit more. What happened?"
                aria-label={`${q.prompt} — tell us more`}
                className={cn(field, 'mt-2.5')}
              />
            )}
            {skipped && (
              <p role="alert" className="mt-2 text-[13px] font-medium text-coral-deep">
                Please answer this one.
              </p>
            )}
          </fieldset>
        )
      })}

      {!signedIn && (
        <label className="flex flex-col gap-2">
          <span className="text-[14px] font-medium text-ink-2">
            Your email <span className="text-faint">— optional, if you'd like a reply</span>
          </span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            maxLength={LIMITS.feedbackEmail}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={field}
          />
        </label>
      )}

      {/* The bot trap. Off-screen and out of the tab order, not `display:none`
          — a bot fills in every field it finds; a person never reaches this. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>

      {sendError && (
        <p role="alert" className="rounded-xl bg-coral-soft px-4 py-3 text-[14px] text-coral-deep">
          {sendError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" disabled={sending} aria-busy={sending}>
          {sending ? 'Sending…' : 'Send feedback'}
        </Button>
        {missing.length > 0 && (
          <span className="text-[13.5px] text-coral-deep">
            {missing.length === 1 ? 'One question still needs an answer.' : `${missing.length} questions still need an answer.`}
          </span>
        )}
      </div>
    </form>
  )
}

/** One question's control, by kind. */
function Answer({
  question,
  value,
  onChange,
}: {
  question: FeedbackQuestion
  value: AnswerValue | undefined
  onChange: (value: AnswerValue | undefined) => void
}) {
  const { kind, options, prompt } = question

  if (kind === 'rating' || kind === 'scale') {
    const numbers = kind === 'rating' ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const ends = kind === 'rating' ? ['Not good', 'Excellent'] : ['Not likely', 'Very likely']
    return (
      <div>
        <div role="radiogroup" aria-label={prompt} className="flex flex-wrap gap-1.5">
          {numbers.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              onClick={() => onChange(n)}
              className={cn(
                'grid h-10 cursor-pointer place-items-center rounded-xl border text-[14.5px] font-semibold tabular-nums transition-colors',
                kind === 'rating' ? 'w-12' : 'w-10',
                value === n
                  ? 'border-brand bg-brand text-[#1a120f]'
                  : 'border-white/10 bg-white/[0.04] text-ink-2 hover:border-white/25 hover:text-ink',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex max-w-[30rem] justify-between text-[12px] text-faint">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      </div>
    )
  }

  if (kind === 'choice') {
    return (
      <div role="radiogroup" aria-label={prompt} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)} className={chip(value === o)}>
            {o}
          </button>
        ))}
      </div>
    )
  }

  if (kind === 'multi') {
    const picked = Array.isArray(value) ? value : []
    const toggle = (o: string) =>
      onChange(picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o])
    return (
      <div role="group" aria-label={prompt} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="checkbox"
            aria-checked={picked.includes(o)}
            onClick={() => toggle(o)}
            className={chip(picked.includes(o))}
          >
            {o}
          </button>
        ))}
      </div>
    )
  }

  const text = typeof value === 'string' ? value : ''
  if (kind === 'short') {
    return (
      <input
        aria-label={prompt}
        value={text}
        maxLength={LIMITS.feedbackShort}
        onChange={(e) => onChange(e.target.value)}
        className={field}
      />
    )
  }
  return (
    <div>
      <textarea
        aria-label={prompt}
        value={text}
        rows={4}
        maxLength={LIMITS.feedbackLong}
        onChange={(e) => onChange(e.target.value)}
        className={cn(field, 'resize-y leading-relaxed')}
      />
      <p className="mt-1 text-right text-[12px] tabular-nums text-faint">
        {text.length} / {LIMITS.feedbackLong}
      </p>
    </div>
  )
}
