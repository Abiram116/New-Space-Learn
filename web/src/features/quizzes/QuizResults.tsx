/**
 * What the quiz came to.
 *
 * The old version was a centred column of every question in order, with no
 * scroll container of its own — so on a twenty-question quiz the page grew
 * past the viewport and the score, the thing you actually came back for,
 * scrolled away off the top. It also gave a question you got right the same
 * space as one you got wrong, which is backwards: the ones you missed are the
 * entire reason to look at this screen.
 *
 * So: the verdict pins, the review scrolls beside it, and misses come first
 * with their explanation already open. Correct answers collapse into a quiet
 * strip — present, checkable, not competing.
 */

import { useMemo, useState } from 'react'
import type { Quiz, QuizResult } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Ledger } from '../../components/ui/Surface'
import { CountUp, Stagger } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { formatClock } from './QuizRunner'

export function QuizResults({
  quiz,
  answers,
  result,
  onRetake,
  onBack,
  compact = false,
}: {
  quiz: Quiz
  answers: number[]
  result: QuizResult
  onRetake: () => void
  onBack: () => void
  compact?: boolean
}) {
  const missed = useMemo(
    () =>
      quiz.questions
        .map((q, i) => ({ q, i }))
        .filter(({ q, i }) => answers[i] !== q.answer_index),
    [quiz.questions, answers],
  )
  const right = quiz.questions.length - missed.length

  /** Concepts to revise, worst first — the actionable output of a quiz. */
  const weakConcepts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { q } of missed) {
      const tag = (q.subtopic || '').trim()
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [missed])

  return (
    <div
      className={cn(
        'flex min-h-0 w-full flex-1',
        compact ? 'flex-col gap-3' : 'mx-auto max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:gap-8',
        !compact && 'flex-col lg:flex-row lg:items-start',
      )}
    >
      {/* LEDGER — a score is the definitive "measured against" object. */}
      <Ledger
        className={cn(
          'flex shrink-0 flex-col gap-3 p-5 pt-0',
          !compact && 'lg:sticky lg:top-6 lg:w-72',
        )}
      >
        <span className="setcode">Score</span>
        <div className="flex items-baseline gap-1">
          <CountUp
            value={result.score}
            className={cn(
              'nameplate text-[48px] leading-none tabular-nums',
              result.score >= 80
                ? 'text-mint-deep'
                : result.score >= 60
                  ? 'text-sky-deep'
                  : 'text-coral-deep',
            )}
          />
          <span className="setcode">%</span>
        </div>

        {/* Four figures on one rule, per the design track: a result is a set of
            measurements, not a set of cards. */}
        <div className="flex items-baseline gap-4 border-t border-line pt-3">
          <Figure label="right" value={`${right}`} />
          <Figure label="missed" value={`${missed.length}`} />
          {result.duration_seconds != null && (
            <Figure label="taken" value={formatClock(result.duration_seconds)} />
          )}
        </div>

        {weakConcepts.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            <span className="setcode">Revise these</span>
            <div className="flex flex-wrap gap-1.5">
              {weakConcepts.map(([tag, n]) => (
                <span
                  key={tag}
                  className="rounded-full bg-coral-soft px-2 py-0.5 text-[11px] font-semibold text-coral-deep"
                >
                  {tag}
                  {n > 1 && <span className="ml-1 opacity-70">×{n}</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-1 flex flex-col gap-2">
          <Button onClick={onRetake} size="sm">
            <Icon name="refresh" size={13} /> Retake
          </Button>
          <Button variant="ghost" onClick={onBack} size="sm">
            Back to quizzes
          </Button>
        </div>
      </Ledger>

      {/* The review scrolls in its OWN container so the verdict above stays
          put. Without this the page grew past the viewport and the score —
          the thing you came back for — scrolled off the top. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {missed.length > 0 && (
          <section className="flex flex-col gap-2">
            <span className="setcode">
              What went wrong ({missed.length})
            </span>
            <Stagger step={30} max={180}>
              {missed.map(({ q, i }) => (
                <MissedQuestion
                  key={i}
                  number={i + 1}
                  question={q.q}
                  chosen={answers[i] >= 0 ? q.choices[answers[i]] : null}
                  answer={q.choices[q.answer_index]}
                  explanation={q.explanation}
                  subtopic={q.subtopic}
                  compact={compact}
                />
              ))}
            </Stagger>
          </section>
        )}

        {right > 0 && (
          <CorrectStrip
            items={quiz.questions
              .map((q, i) => ({ q, i }))
              .filter(({ q, i }) => answers[i] === q.answer_index)}
          />
        )}
      </div>
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="nameplate text-[20px] leading-none tabular-nums text-ink">{value}</span>
      <span className="setcode">{label}</span>
    </div>
  )
}

function MissedQuestion({
  number,
  question,
  chosen,
  answer,
  explanation,
  subtopic,
  compact,
}: {
  number: number
  question: string
  chosen: string | null
  answer: string
  explanation?: string | null
  subtopic?: string | null
  compact: boolean
}) {
  return (
    <div className="rounded-xl border border-coral/30 bg-coral-soft/40 px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="setcode shrink-0">{number}</span>
        <span
          className={cn(
            'min-w-0 font-medium leading-snug text-ink',
            compact ? 'text-[12.5px]' : 'text-[13.5px]',
          )}
        >
          {question}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1 text-[12.5px]">
        {chosen && (
          <div className="flex items-start gap-1.5 text-coral-deep">
            <Icon name="close" size={11} className="mt-0.5 shrink-0" />
            <span className="line-through opacity-80">{chosen}</span>
          </div>
        )}
        <div className="flex items-start gap-1.5 text-mint-deep">
          <Icon name="check" size={11} className="mt-0.5 shrink-0" />
          <span className="font-semibold">{answer}</span>
        </div>
      </div>
      {explanation && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{explanation}</p>
      )}
      {subtopic && <span className="setcode mt-1.5 block">{subtopic}</span>}
    </div>
  )
}

/**
 * The ones you got right, collapsed.
 *
 * Present because "did I actually get that one?" is a real question, quiet
 * because a correct answer needs no explanation and giving it a full card
 * would bury the misses it sits next to.
 */
function CorrectStrip({ items }: { items: { q: Quiz['questions'][number]; i: number }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 self-start text-[12px] text-muted transition-colors cursor-pointer hover:text-ink"
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
        {items.length} correct
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {items.map(({ q, i }) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px]"
            >
              <Icon name="check" size={11} className="mt-1 shrink-0 text-mint-deep" />
              <div className="min-w-0">
                <div className="leading-snug text-ink-2">{q.q}</div>
                <div className="mt-0.5 font-semibold text-mint-deep">
                  {q.choices[q.answer_index]}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
