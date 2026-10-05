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

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Quiz, QuizResult } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Ledger } from '../../components/ui/Surface'
import { CountUp, Stagger } from '../../components/ui/motion'
import { celebrateQuiz, useAmbience } from '../../components/celebrate'
import { Reaction, scoreArc } from '../../components/mascot'
import { quizSituation } from '../../lib/botVoice'
import { bestVerdict, scoreTier } from '../../components/celebrate/logic'
import { cn } from '../../lib/cn'
import { formatClock } from './QuizRunner'
import { StickyActionBar } from '../../components/ui/StickyActionBar'
import { useIsMobile } from '../../lib/useIsMobile'
import './stage.css'

/** Results already celebrated, by identity — a remount mustn't replay it. */
const celebrated = new WeakSet<QuizResult>()

export function QuizResults({
  quiz,
  answers,
  result,
  onRetake,
  onBack,
  backLabel = 'Back to quizzes',
  compact = false,
}: {
  quiz: Quiz
  answers: number[]
  result: QuizResult
  onRetake: () => void
  onBack: () => void
  /** What the way out is called — where it goes. */
  backLabel?: string
  compact?: boolean
}) {
  const isMobile = useIsMobile() && !compact
  const missed = useMemo(
    () =>
      quiz.questions
        .map((q, i) => ({ q, i }))
        .filter(({ q, i }) => answers[i] !== q.answer_index),
    [quiz.questions, answers],
  )
  const right = quiz.questions.length - missed.length
  // Server-computed per-quiz history: nothing to say on a first attempt.
  const verdict = bestVerdict(result.previous_best, result.score, result.attempts)

  // The finish, tiered by the real score: fireworks for a perfect sheet,
  // something smaller down to 60%, and below that no fireworks at all — an
  // encouraging line, and the misses below doing the actual work.
  const scoreRef = useRef<HTMLDivElement>(null)
  const ambience = useAmbience()
  useEffect(() => {
    if (celebrated.has(result)) return // StrictMode's second mount
    celebrated.add(result)
    const tier = scoreTier(result.score)
    ambience.progress(1)
    if (tier !== 'none') ambience.pulse(tier === 'grand' ? 'bright' : 'good')
    celebrateQuiz(
      {
        score: result.score,
        right,
        total: quiz.questions.length,
        previousBest: result.previous_best,
      },
      { anchor: scoreRef, compact },
    )
  }, [result, quiz.questions.length, right, compact, ambience])

  /** Concepts to revise, worst first — the actionable output of a quiz. */
  const weakConcepts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { q } of missed) {
      const tag = (q.subtopic || '').trim()
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [missed])

  const [filter, setFilter] = useState<'all' | 'missed'>('all')

  if (compact) {
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
          <div ref={scoreRef} className="flex items-baseline gap-1 self-start">
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

          {/* Directly under the score it qualifies. A new best is a badge; any
              later attempt gets one quiet line; a first attempt gets nothing. */}
          {verdict.kind === 'best' && (
            <div
              role="status"
              data-testid="quiz-best-badge"
              className="inline-flex items-center gap-1.5 self-start rounded-full bg-mint-soft px-2.5 py-1 text-[12px] font-semibold text-mint-deep motion-safe:animate-[verdictIn_320ms_var(--ease-sl)_both]"
            >
              <Icon name="sparkle" size={12} />
              New best! {verdict.previous}% → {verdict.score}%
            </div>
          )}
          {verdict.kind === 'later' && (
            <p data-testid="quiz-best-line" className="text-[12px] tabular-nums text-muted">
              Best: {verdict.best}% · try {verdict.attempts}
            </p>
          )}

          {/* Pop, reacting to the score. Real text, so it reads the same with the bots off. */}
          <Reaction
            agent="quiz"
            situation={quizSituation(result.score)}
            facts={{ score: result.score }}
            mood={scoreArc(result.score).mood}
            settle={scoreArc(result.score).settle}
            size={compact ? 48 : 56}
            lineKey={`${quiz.id}:${result.attempts ?? 0}:${result.score}`}
            className="self-start"
          />

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
              <span className="setcode">Study these</span>
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
              {backLabel}
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
                    // The misconception behind the CHOSEN wrong option, not the
                    // correct one — that's what the student actually needs
                    // named. Absent on an unanswered question or a quiz from
                    // before the field existed.
                    misconception={
                      answers[i] >= 0 ? q.misconceptions?.[answers[i]] : null
                    }
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

  const questions = quiz.questions
  const shown = filter === 'missed' ? missed : questions.map((q, i) => ({ q, i }))
  const tone =
    result.score >= 80 ? 'text-mint-deep' : result.score >= 60 ? 'text-sky-deep' : 'text-coral-deep'

  return (
    <div className="study-stage flex w-full flex-1 flex-col">
      <div className={isMobile ? 'flex-1 px-4 py-4' : 'px-[var(--stage-pad-x)] py-[var(--stage-pad-y)]'}>
        <div className="stage-results">
          {/* LEDGER — a score is the definitive "measured against" object.
              Sticky beside the review on a wide stage, so the number you came
              back for never scrolls away while you read the misses. */}
          <Ledger className="stage-score-panel flex flex-col gap-[clamp(14px,2dvh,20px)] pb-[clamp(18px,2.4dvh,28px)]">
            <div ref={scoreRef} className="flex items-baseline gap-1 self-start">
              <CountUp value={result.score} className={cn('nameplate stage-score leading-none tabular-nums', tone)} />
              <span className={cn('nameplate text-[clamp(1.5rem,1rem+1cqw,2.25rem)] leading-none', tone)}>%</span>
            </div>

            {/* Directly under the score it qualifies. A new best is a badge; any
                later attempt gets one quiet line; a first attempt gets nothing. */}
            {verdict.kind === 'best' && (
              <div
                role="status"
                data-testid="quiz-best-badge"
                className="stage-label inline-flex items-center gap-1.5 self-start rounded-full bg-mint-soft px-3 py-1.5 font-semibold text-mint-deep motion-safe:animate-[verdictIn_320ms_var(--ease-sl)_both]"
              >
                <Icon name="sparkle" size={14} />
                New best! {verdict.previous}% → {verdict.score}%
              </div>
            )}
            {verdict.kind === 'later' && (
              <p data-testid="quiz-best-line" className="stage-label tabular-nums text-muted">
                Best: {verdict.best}% · try {verdict.attempts}
              </p>
            )}

            {/* Pop, reacting to the score. Real text, so it reads the same with the bots off. */}
            <Reaction
              agent="quiz"
              situation={quizSituation(result.score)}
              facts={{ score: result.score }}
              mood={scoreArc(result.score).mood}
            settle={scoreArc(result.score).settle}
              size={compact ? 48 : 56}
              lineKey={`${quiz.id}:${result.attempts ?? 0}:${result.score}`}
              className="self-start"
            />

            <div className="ruled-datum grid grid-cols-3 gap-3 pt-[clamp(12px,1.6dvh,16px)]">
              <StageFigure label="Right" value={`${right}/${questions.length}`} />
              <StageFigure label="Missed" value={`${missed.length}`} />
              {result.duration_seconds != null && (
                <StageFigure label="Time" value={formatClock(result.duration_seconds)} />
              )}
            </div>

            {weakConcepts.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="stage-label font-semibold text-ink-3">Study these</span>
                <div className="flex flex-wrap gap-1.5">
                  {weakConcepts.map(([tag, n]) => (
                    <span
                      key={tag}
                      className="stage-label rounded-full bg-coral-soft px-2.5 py-1 font-semibold text-coral-deep"
                    >
                      {tag}
                      {n > 1 && <span className="ml-1 opacity-70">×{n}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* On a phone these live in the pinned bar below, in thumb reach. */}
            {!isMobile && (
              <div className="mt-1 flex flex-col gap-2.5">
                <Button onClick={onRetake} size="xl">
                  <Icon name="refresh" size={16} /> Retake
                </Button>
                <Button variant="secondary" onClick={onBack} size="lg">
                  {backLabel}
                </Button>
              </div>
            )}
          </Ledger>

          {/* Every question, open. Misses carry the full story — your answer,
              the right one, why, and the mix-up behind the pick; the ones you
              got right are a single compact row. "Missed" narrows to the work. */}
          <section className="flex min-w-0 flex-col gap-4" aria-labelledby="quiz-review-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="quiz-review-heading"
                className="text-[clamp(1.25rem,1rem+0.6cqw,1.625rem)] font-bold tracking-[-0.01em] text-ink"
              >
                Review
              </h2>
              <div role="tablist" aria-label="Filter questions" className="flex rounded-xl border border-line bg-well p-1">
                {(
                  [
                    ['all', 'All', questions.length],
                    ['missed', 'Missed', missed.length],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={filter === key}
                    aria-controls="quiz-review-list"
                    onClick={() => setFilter(key)}
                    className={cn(
                      'stage-label inline-flex cursor-pointer items-center gap-2 rounded-lg px-3.5 py-1.5 font-semibold max-md:min-h-11',
                      't-control duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
                      filter === key ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,237,220,0.06)]' : 'text-muted hover:text-ink',
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        'rounded-md px-1.5 font-mono text-[0.85em] tabular-nums',
                        filter === key
                          ? key === 'missed' && count > 0
                            ? 'bg-coral-soft text-coral-deep'
                            : 'bg-line-soft text-ink-3'
                          : 'text-faint',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div id="quiz-review-list" role="list" className="flex flex-col gap-2.5" data-testid="quiz-review">
              {shown.length === 0 && (
                <p className="stage-body rounded-2xl border border-mint/30 bg-mint-soft/40 px-5 py-4 text-mint-deep">
                  You got them all right. Great job!
                </p>
              )}
              <Stagger step={30} max={180}>
                {shown.map(({ q, i }) => {
                  const pick = answers[i]
                  const wasRight = pick === q.answer_index
                  return wasRight ? (
                    <StageCorrectRow key={i} number={i + 1} question={q.q} answer={q.choices[q.answer_index]} />
                  ) : (
                    <StageMissedRow
                      key={i}
                      number={i + 1}
                      question={q.q}
                      chosen={pick >= 0 ? q.choices[pick] : null}
                      answer={q.choices[q.answer_index]}
                      explanation={q.explanation}
                      subtopic={q.subtopic}
                      // The misconception behind the CHOSEN wrong option, not
                      // the correct one — that's what needs naming. Absent on
                      // an unanswered question or an older quiz.
                      misconception={pick >= 0 ? q.misconceptions?.[pick] : null}
                    />
                  )
                })}
              </Stagger>
            </div>
          </section>
        </div>
      </div>
      {isMobile && (
        <StickyActionBar className="mt-auto">
          <Button variant="secondary" onClick={onBack} className="min-h-14 flex-1">
            Back
          </Button>
          <Button onClick={onRetake} className="min-h-14 flex-[1.5]">
            <Icon name="refresh" size={16} /> Retake
          </Button>
        </StickyActionBar>
      )}
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
  misconception,
  compact,
}: {
  number: number
  question: string
  chosen: string | null
  answer: string
  explanation?: string | null
  subtopic?: string | null
  misconception?: string | null
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
      {/* The specific confusion behind the wrong pick — one line, only when
          this question was tagged for it (task 3/8: quizzes generated before
          misconception tagging have nothing here). */}
      {misconception && (
        <p className="mt-1 text-[12px] font-medium text-coral-deep">
          Common mix-up: {misconception}
        </p>
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

/* ── Stage pieces (full page) ────────────────────────────────────────── */

function StageFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="nameplate text-[clamp(1.375rem,1rem+0.7cqw,1.875rem)] leading-none tabular-nums text-ink">
        {value}
      </span>
      <span className="stage-label text-muted">{label}</span>
    </div>
  )
}

/** A question you got right: one row, the answer beside a tick. */
function StageCorrectRow({ number, question, answer }: { number: number; question: string; answer: string }) {
  return (
    <div
      role="listitem"
      className="flex items-start gap-3 rounded-2xl border border-line-soft bg-surface/60 px-[clamp(14px,1.5cqw,20px)] py-3"
    >
      <span className="stage-label mt-[0.2em] w-6 shrink-0 font-mono tabular-nums text-faint">{number}</span>
      <div className="min-w-0 flex-1">
        <p className="stage-body leading-snug text-ink-2">{question}</p>
        <p className="stage-label mt-1 flex items-start gap-1.5 font-semibold text-mint-deep">
          <Icon name="check" size={14} className="mt-[0.2em] shrink-0" />
          <span className="min-w-0">{answer}</span>
        </p>
      </div>
    </div>
  )
}

/** A miss, open: what you picked, what was right, why, and the mix-up. */
function StageMissedRow({
  number,
  question,
  chosen,
  answer,
  explanation,
  subtopic,
  misconception,
}: {
  number: number
  question: string
  chosen: string | null
  answer: string
  explanation?: string | null
  subtopic?: string | null
  misconception?: string | null
}) {
  return (
    <div
      role="listitem"
      className="flex items-start gap-3 rounded-2xl border border-coral/30 bg-coral-soft/40 px-[clamp(14px,1.5cqw,20px)] py-[clamp(14px,1.8dvh,18px)]"
    >
      <span className="stage-label mt-[0.25em] w-6 shrink-0 font-mono tabular-nums text-coral-deep">{number}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[clamp(1rem,0.85rem+0.35cqw,1.1875rem)] font-semibold leading-snug text-ink">{question}</p>

        <dl className="stage-body mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 @max-[36rem]:grid-cols-1 @max-[36rem]:gap-y-0.5">
          <dt className="stage-label pt-[0.15em] text-muted">Your answer</dt>
          <dd className={cn('flex items-start gap-1.5', chosen ? 'text-coral-deep' : 'italic text-muted')}>
            {chosen ? (
              <>
                <Icon name="close" size={15} className="mt-[0.25em] shrink-0" />
                <span className="line-through decoration-coral/60">{chosen}</span>
              </>
            ) : (
              'Not answered'
            )}
          </dd>
          <dt className="stage-label pt-[0.15em] text-muted @max-[36rem]:mt-2">Correct</dt>
          <dd className="flex items-start gap-1.5 font-semibold text-mint-deep">
            <Icon name="check" size={15} className="mt-[0.25em] shrink-0" />
            <span>{answer}</span>
          </dd>
        </dl>

        {explanation && (
          <p className="stage-body mt-3 max-w-[68ch] leading-relaxed text-ink-2">{explanation}</p>
        )}
        {/* The specific confusion behind the wrong pick — only when this
            question was tagged for it. */}
        {misconception && (
          <p className="stage-body mt-2 font-medium text-coral-deep">Common mix-up: {misconception}</p>
        )}
        {subtopic && <span className="setcode stage-label mt-3 block">{subtopic}</span>}
      </div>
    </div>
  )
}
