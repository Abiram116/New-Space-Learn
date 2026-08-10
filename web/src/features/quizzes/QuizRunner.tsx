/**
 * Taking a quiz, one question at a time, with the answer revealed the moment
 * you commit to a choice.
 *
 * **Why the reveal moved.** Holding every result until the end optimises for
 * grading and against learning. The instant after you answer is the only
 * moment you still remember *why* you picked what you picked — that is when
 * "actually, here's the distinction you missed" lands. Twenty minutes later,
 * scrolling a list of ticks and crosses, you are reading about a stranger's
 * reasoning. A wrong answer is the most valuable event in the whole quiz and
 * the old flow spent it.
 *
 * **The commit is final.** Once a choice is made it locks. That is what makes
 * the reveal honest: an answer you can revise after seeing the result is not
 * an answer, and the score would stop meaning anything — which matters here
 * because the student model, the brief and the card schedule are all built on
 * these scores being real.
 *
 * Renders in two densities. `compact` is the chat dock at ~320px; the full
 * layout adds the question grid. One component rather than two, because two
 * would drift and the second one would be the neglected one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { submitQuiz } from '../../api/quizzes'
import type { Quiz, QuizResult } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Leaf } from '../../components/ui/Surface'
import { useReducedMotion } from '../../components/ui/motion'
import { clearStatsCache } from '../../lib/briefCache'
import { cn } from '../../lib/cn'
import { useAssessmentLock } from '../../lib/assessment'

/**
 * Said when you get one right.
 *
 * A pool rather than one string, because the same six words after every
 * correct answer stops being encouragement and becomes chrome. Picked by
 * question index so it is stable across re-renders — a message that reshuffles
 * while you are reading it is worse than a repeated one.
 */
const NICE = [
  'Correct.',
  'That’s the one.',
  'Right — and for the right reason.',
  'Got it.',
  'Yes, exactly that.',
  'Clean.',
]

/** Said on a run of three or more. Earned, so it can be louder. */
const STREAK = ['Three in a row.', 'Four straight.', 'Five clean.', 'Still going.']

export type RunnerState = {
  index: number
  answers: number[]
  revealed: boolean[]
}

export function QuizRunner({
  quiz,
  compact = false,
  onFinished,
  onExit,
}: {
  quiz: Quiz
  compact?: boolean
  onFinished: (result: QuizResult, answers: number[], seconds: number) => void
  onExit: () => void
}) {
  // The composer locks for as long as this is mounted. Every exit path —
  // finishing, backing out, closing the panel, navigating away — unmounts it,
  // so there is no route that forgets to unlock.
  useAssessmentLock('quiz')

  const total = quiz.questions.length
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<number[]>(() => Array(total).fill(-1))
  const [revealed, setRevealed] = useState<boolean[]>(() => Array(total).fill(false))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startedAt = useRef(Date.now())
  const seconds = useElapsed()

  const q = quiz.questions[index]
  const chosen = answers[index]
  const isRevealed = revealed[index]
  const isCorrect = chosen === q.answer_index
  const answeredCount = revealed.filter(Boolean).length
  const isLast = index === total - 1

  /** How many correct in a row up to and including this question. */
  const streak = useMemo(() => {
    let n = 0
    for (let i = index; i >= 0; i--) {
      if (!revealed[i] || answers[i] !== quiz.questions[i].answer_index) break
      n++
    }
    return n
  }, [index, revealed, answers, quiz.questions])

  const choose = useCallback(
    (choiceIndex: number) => {
      // Locked once answered — see the note at the top of the file.
      if (revealed[index]) return
      setAnswers((prev) => {
        const next = [...prev]
        next[index] = choiceIndex
        return next
      })
      setRevealed((prev) => {
        const next = [...prev]
        next[index] = true
        return next
      })
    },
    [index, revealed],
  )

  const finish = useCallback(async () => {
    setBusy(true)
    try {
      const elapsed = Math.round((Date.now() - startedAt.current) / 1000)
      const result = await submitQuiz(quiz.id, answers, elapsed)
      // The quiz average and streak just changed — see clearStatsCache.
      clearStatsCache()
      onFinished(result, answers, elapsed)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }, [quiz.id, answers, onFinished])

  if (error) {
    return (
      <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">{error}</div>
    )
  }

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        compact ? 'gap-3' : 'mx-auto max-w-3xl gap-5 px-4 py-6 sm:px-6',
      )}
    >
      <ProgressHeader
        index={index}
        total={total}
        answered={answeredCount}
        seconds={seconds}
        compact={compact}
        onExit={onExit}
      />

      {/* LEAF — a question stem is prose you read before you can answer, not an
          object you own. The choices stay pressable controls. */}
      <Leaf className={cn('pr-4', compact ? 'py-1' : 'py-2 pr-6')}>
        {q.subtopic && <span className="setcode">{q.subtopic}</span>}
        <div
          className={cn(
            'mt-1 font-medium leading-relaxed text-ink',
            compact ? 'text-[13.5px]' : 'text-[15.5px]',
          )}
        >
          {q.q}
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {q.choices.map((choice, i) => (
            <Choice
              key={i}
              letter={String.fromCharCode(65 + i)}
              text={choice}
              compact={compact}
              picked={chosen === i}
              isAnswer={q.answer_index === i}
              revealed={isRevealed}
              onPick={() => choose(i)}
            />
          ))}
        </div>
      </Leaf>

      {isRevealed && (
        <Verdict
          correct={isCorrect}
          streak={streak}
          index={index}
          explanation={q.explanation}
          answerText={q.choices[q.answer_index]}
          subtopic={q.subtopic}
          source={q.source}
          compact={compact}
        />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="setcode">
          {isRevealed ? '' : 'Pick an answer to see how you did'}
        </span>
        {isRevealed &&
          (isLast ? (
            <Button onClick={finish} disabled={busy} size={compact ? 'sm' : 'md'}>
              {busy ? 'Scoring…' : 'See results'}
            </Button>
          ) : (
            <Button onClick={() => setIndex((i) => i + 1)} size={compact ? 'sm' : 'md'}>
              Next <Icon name="arrowRight" size={13} />
            </Button>
          ))}
      </div>
    </div>
  )
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

function ProgressHeader({
  index,
  total,
  answered,
  seconds,
  compact,
  onExit,
}: {
  index: number
  total: number
  answered: number
  seconds: number
  compact: boolean
  onExit: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-muted transition-colors cursor-pointer hover:text-ink"
        >
          <Icon name="arrowLeft" size={12} /> Leave
        </button>
        <span className="setcode ml-auto">
          {index + 1}/{total}
        </span>
        {/* Elapsed, not a countdown. A countdown makes a revision quiz feel
            like an exam and pushes guessing; elapsed time is the same
            information without the pressure, and it is what the study record
            wants anyway. */}
        <span className="setcode tabular-nums" title="Time on this quiz">
          {formatClock(seconds)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${(answered / total) * 100}%` }}
        />
      </div>
      {!compact && (
        <span className="setcode">
          {answered} of {total} answered
        </span>
      )}
    </div>
  )
}

function Choice({
  letter,
  text,
  compact,
  picked,
  isAnswer,
  revealed,
  onPick,
}: {
  letter: string
  text: string
  compact: boolean
  picked: boolean
  isAnswer: boolean
  revealed: boolean
  onPick: () => void
}) {
  // After the reveal the correct answer is always marked, whether or not it
  // was chosen — the point is to leave knowing which one was right, and a
  // wrong pick with nothing else highlighted teaches nothing.
  const tone = !revealed
    ? picked
      ? 'border-brand bg-brand-soft'
      : 'border-line bg-surface hover:border-brand-200'
    : isAnswer
      ? 'border-mint/60 bg-mint-soft'
      : picked
        ? 'border-coral/60 bg-coral-soft'
        : 'border-line bg-surface opacity-55'

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={revealed}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 text-left transition-all duration-200',
        compact ? 'text-[12.5px]' : 'text-[14px]',
        revealed ? 'cursor-default' : 'cursor-pointer',
        tone,
      )}
    >
      <span
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
          !revealed
            ? picked
              ? 'bg-brand text-[#1a120f]'
              : 'bg-line-soft text-muted'
            : isAnswer
              ? 'bg-mint text-[#12211a]'
              : picked
                ? 'bg-coral text-[#2a1210]'
                : 'bg-line-soft text-faint',
        )}
      >
        {revealed && isAnswer ? (
          <Icon name="check" size={11} />
        ) : revealed && picked ? (
          <Icon name="close" size={11} />
        ) : (
          letter
        )}
      </span>
      <span className="min-w-0 flex-1 leading-snug">{text}</span>
    </button>
  )
}

/**
 * What just happened, said immediately.
 *
 * Correct gets one short line and nothing else — dwelling on a right answer
 * wastes the student's attention and delays the next question. Wrong gets the
 * real estate: the answer, why, and which concept it belongs to, because that
 * is the moment the quiz can actually teach something.
 */
function Verdict({
  correct,
  streak,
  index,
  explanation,
  answerText,
  subtopic,
  source,
  compact,
}: {
  correct: boolean
  streak: number
  index: number
  explanation?: string | null
  answerText: string
  subtopic?: string | null
  source?: string | null
  compact: boolean
}) {
  const reduced = useReducedMotion()
  const headline = correct
    ? streak >= 3
      ? STREAK[Math.min(streak - 3, STREAK.length - 1)]
      : NICE[index % NICE.length]
    : 'Not this time.'

  return (
    <div
      className={cn(
        'rounded-xl border px-3 py-2.5',
        correct ? 'border-mint/35 bg-mint-soft/60' : 'border-coral/35 bg-coral-soft/60',
        // Grows in from the top edge rather than fading: the verdict arrives
        // as a consequence of the tap, and movement from the thing you just
        // pressed reads as causation.
        !reduced && 'motion-safe:animate-[verdictIn_260ms_cubic-bezier(0.22,1,0.36,1)]',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          name={correct ? 'check' : 'alert'}
          size={13}
          className={correct ? 'text-mint-deep' : 'text-coral-deep'}
        />
        <span
          className={cn(
            'text-[13px] font-bold',
            correct ? 'text-mint-deep' : 'text-coral-deep',
          )}
        >
          {headline}
        </span>
      </div>

      {!correct && (
        <p className={cn('mt-1.5 leading-relaxed text-ink-2', compact ? 'text-[12px]' : 'text-[13px]')}>
          The answer is <b className="text-ink">{answerText}</b>.
        </p>
      )}

      {explanation && (
        <p
          className={cn(
            'mt-1.5 leading-relaxed text-ink-2',
            compact ? 'text-[12px]' : 'text-[13px]',
          )}
        >
          {explanation}
        </p>
      )}

      {/* Only on a miss. Naming the concept is what turns "I got one wrong"
          into something you can actually go and revise — and it is the same
          tag the student model scores you on. */}
      {!correct && subtopic && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="setcode">Worth revising</span>
          <span className="rounded-full bg-coral-soft px-2 py-0.5 text-[11px] font-semibold text-coral-deep">
            {subtopic}
          </span>
        </div>
      )}

      {!correct && source && (
        <div className="setcode mt-1.5 truncate" title={source}>
          {source}
        </div>
      )}
    </div>
  )
}

/* ── Time ────────────────────────────────────────────────────────────── */

/** Seconds since mount, ticking once a second. */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  return seconds
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
