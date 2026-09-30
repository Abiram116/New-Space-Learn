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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react'
import { submitQuiz } from '../../api/quizzes'
import type { Quiz, QuizResult } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Icon } from '../../components/ui/Icon'
import { Leaf } from '../../components/ui/Surface'
import { useReducedMotion } from '../../components/ui/motion'
import { celebrate, useAmbience, useStudySession } from '../../components/celebrate'
import { clearStatsCache } from '../../lib/briefCache'
import { cn } from '../../lib/cn'
import { useAssessmentLock } from '../../lib/assessment'
import { anyModalOpen, quizKeyAction, stageKeyGate, type QuizKeyAction } from './keys'
import { KeyHints, StageCount, type KeyHint } from './StageKit'
import { useIsMobile } from '../../lib/useIsMobile'
import { PhoneQuizStage } from './PhoneQuiz'
import { haptic } from './phoneKit'
import { useImmersive } from '../../components/layout/immersive'

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
  // Phones get their own immersive stage (PhoneQuiz.tsx); the dock keeps its
  // compact layout and desktop its full one. Same state and handlers for all.
  const isMobile = useIsMobile()
  const phone = isMobile && !compact
  useImmersive(phone)

  const total = quiz.questions.length
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<number[]>(() => Array(total).fill(-1))
  const [revealed, setRevealed] = useState<boolean[]>(() => Array(total).fill(false))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seconds = useElapsed()
  // The room: brightens as questions are answered, pulses on a right answer,
  // dims for a breath on a miss. A no-op outside a <StudyAmbience>.
  const ambience = useAmbience()
  useStudySession()

  const q = quiz.questions[index]
  const chosen = answers[index]
  const isRevealed = revealed[index]
  const isCorrect = chosen === q.answer_index
  const answeredCount = revealed.filter(Boolean).length
  const isLast = index === total - 1

  useEffect(() => {
    ambience.progress(total ? answeredCount / total : 0)
  }, [ambience, answeredCount, total])

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
    (choiceIndex: number, el?: HTMLElement) => {
      // Locked once answered — see the note at the top of the file.
      if (revealed[index]) return
      const correct = choiceIndex === quiz.questions[index].answer_index
      let run = 0
      if (correct) {
        run = 1
        for (let i = index - 1; i >= 0; i--) {
          if (!revealed[i] || answers[i] !== quiz.questions[i].answer_index) break
          run++
        }
      }
      ambience.pulse(!correct ? 'miss' : run >= 3 ? 'bright' : 'good')
      if (phone) haptic(correct ? 10 : [14, 40, 14])
      // Three or more in a row earns a flicker of stars off the answer itself.
      if (run >= 3) celebrate('combo', { anchor: el, compact })
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
    [index, revealed, answers, quiz.questions, ambience, compact, phone],
  )

  // A second submit while the first is in flight — Enter pressed again, or a
  // click landing just after the key — would score the same attempt twice.
  const submitting = useRef(false)
  const finish = useCallback(async () => {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    try {
      // `seconds` is the same clock shown in the header, which pauses while
      // the tab is hidden (see useElapsed) — reusing it here instead of a
      // separate Date.now() diff keeps duration_seconds from counting time
      // the student spent on another tab.
      const result = await submitQuiz(quiz.id, answers, seconds)
      // The quiz average and streak just changed — see clearStatsCache.
      clearStatsCache()
      onFinished(result, answers, seconds)
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }, [quiz.id, answers, seconds, onFinished])

  /* ── Keyboard (full page only; see ./keys.ts) ───────────────────────── */

  // The option the keyboard is on. -1 until the first arrow key: a ring on
  // option A before anyone asked for one reads as a pre-selected answer.
  const [highlight, setHighlight] = useState(-1)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])
  // One advance per question, whatever arrives: a held Enter, or Enter
  // landing right after a click on Next, must not skip a question unseen.
  const advancedFrom = useRef(-1)

  const goNext = useCallback(() => {
    if (!revealed[index] || index >= total - 1 || advancedFrom.current === index) return
    advancedFrom.current = index
    setIndex(index + 1)
    setHighlight(-1)
  }, [revealed, index, total])

  // Leaving discards the attempt — answers are only sent on "See results" —
  // so the full page asks first. The dock keeps its one-tap Leave.
  const requestLeave = useCallback(
    (viaKey: boolean) => {
      if (busy) return
      if (compact || (!viaKey && answeredCount === 0)) {
        onExit()
        return
      }
      setConfirmLeave(true)
    },
    [busy, compact, answeredCount, onExit],
  )

  const act = useCallback(
    (a: QuizKeyAction) => {
      switch (a.type) {
        case 'highlight':
          setHighlight(a.index)
          optionRefs.current[a.index]?.focus()
          return
        case 'choose':
          setHighlight(a.index)
          choose(a.index, optionRefs.current[a.index] ?? undefined)
          return
        case 'advance':
          if (!isLast) goNext()
          else if (!busy) void finish()
          return
        case 'leave':
          requestLeave(true)
          return
      }
    },
    [choose, isLast, busy, finish, goNext, requestLeave],
  )

  // The listener is bound once; it reads the latest state through this.
  const live = useRef({ revealed: isRevealed, highlight, count: q.choices.length, confirmLeave, act })
  useLayoutEffect(() => {
    live.current = { revealed: isRevealed, highlight, count: q.choices.length, confirmLeave, act }
  })

  useEffect(() => {
    if (compact) return
    const onKey = (e: KeyboardEvent) => {
      const s = live.current
      const owner = (e.target as Element | null)?.closest?.('[data-quiz-choice]')
      const focused = owner ? Number(owner.getAttribute('data-quiz-choice')) : null
      const action = quizKeyAction(e.key, {
        revealed: s.revealed,
        highlight: s.highlight,
        count: s.count,
        focused,
      })
      const gate = stageKeyGate(e, {
        ownAttr: 'data-quiz-choice',
        modalOpen: s.confirmLeave || anyModalOpen(),
        wouldHandle: action !== null,
      })
      if (gate === 'ignore') return
      // Handled or swallowed, Space must not scroll and Enter must not also
      // click whatever the browser thinks is focused.
      e.preventDefault()
      if (gate === 'handle' && action) s.act(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compact])

  if (compact) {
    return (
      <div
        className={cn(
          'flex w-full flex-col',
          // `flex-1` in the dock, and this is the line the "quiz sits at the top
          // of the sidebar" report kept coming back for. The panels *around* this
          // were given flex-1 twice; the runner itself never was, so it sized to
          // its content and left the rest of the column empty no matter what its
          // parents did. A child that refuses to grow cannot be fixed from above.
          compact ? 'min-h-0 flex-1 gap-3' : 'mx-auto max-w-3xl gap-5 px-4 py-6 sm:px-6',
        )}
      >
        <ProgressHeader
          index={index}
          total={total}
          answered={answeredCount}
          seconds={seconds}
          compact={compact}
          onExit={onExit}
          // A student who submits and then immediately leaves before the
          // response lands would abandon an attempt that may well have
          // already been recorded server-side — the quiz was answered, the
          // score exists, and nothing on screen would ever have shown it.
          exitDisabled={busy}
        />

        {/* LEAF — a question stem is prose you read before you can answer, not an
            object you own. The choices stay pressable controls.

            Sized to its own content, not forced to fill the column. It used to
            take `flex-1` + its own `overflow-y-auto` in the dock, on the theory
            that a long stem needed room to scroll before scrolling the whole
            panel — but the dock panel that hosts this (`QuizzesPanel.tsx`)
            already scrolls, so that just meant a short question left Leaf
            claiming empty space it didn't need, and shoved the verdict + Next
            button down to wherever that empty space happened to end. One
            scroll container, not two, and the verdict now sits directly under
            the choices regardless of how much either one holds. */}
        <Leaf className={cn('pr-4', compact ? 'py-1' : 'py-2 pr-6')}>
          {/* Difficulty rides on the same small-caps line as the subtopic
              tag rather than a badge of its own — one more visual element here
              would compete with the choices below it for a line of real
              estate this dense. Absent on quizzes generated before the field
              existed. */}
          {(q.subtopic || q.difficulty) && (
            <span className="setcode">
              {q.subtopic}
              {q.subtopic && q.difficulty && ' · '}
              {q.difficulty}
            </span>
          )}
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
                onPick={(el) => choose(i, el)}
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

        {/* Inline, not a full replacement of the runner — losing
            `ProgressHeader` (and its "Leave") on a submit failure turned one
            bad request into a dead end: no retry, and the only way out was
            abandoning a fully-answered quiz. The answers are all still in
            state; the "Try again" button below just calls `finish()` again
            with the same ones. */}
        {error && (
          <div className="rounded-xl bg-coral-soft px-3.5 py-2.5 text-[13px] text-coral-deep">
            {error}
          </div>
        )}

        <div className={cn('flex items-center justify-between gap-2', compact && 'shrink-0')}>
          <span className="setcode">
            {isRevealed ? '' : 'Pick an answer to see how you did'}
          </span>
          {isRevealed &&
            (isLast ? (
              <Button onClick={finish} disabled={busy} size={compact ? 'sm' : 'md'}>
                {busy ? 'Scoring…' : error ? 'Try again' : 'See results'}
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

  if (phone) {
    const headline = isCorrect
      ? streak >= 3
        ? STREAK[Math.min(streak - 3, STREAK.length - 1)]
        : NICE[index % NICE.length]
      : 'Not this time.'
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <PhoneQuizStage
          index={index}
          total={total}
          seconds={seconds}
          clock={formatClock(seconds)}
          questions={quiz.questions}
          answers={answers}
          revealed={revealed}
          highlight={highlight}
          optionRefs={optionRefs}
          isLast={isLast}
          busy={busy}
          error={error}
          headline={headline}
          onChoose={(i, el) => choose(i, el)}
          onFocusOption={setHighlight}
          onNext={goNext}
          onFinish={finish}
          onLeave={() => requestLeave(false)}
        />
        <ConfirmDialog
          open={confirmLeave}
          title="Leave this quiz?"
          description={
            answeredCount > 0
              ? `You've answered ${answeredCount} of ${total}. Answers are only saved when you see your results, so this attempt won't count.`
              : 'Nothing has been answered yet, so there is nothing to lose.'
          }
          confirmLabel="Leave quiz"
          destructive
          onCancel={() => setConfirmLeave(false)}
          onConfirm={() => {
            setConfirmLeave(false)
            onExit()
          }}
        />
      </div>
    )
  }

  const letterOf = (i: number) => String.fromCharCode(65 + i)
  const lastLetter = letterOf(q.choices.length - 1)
  const hints: KeyHint[] = isRevealed
    ? [
        { keys: ['Enter'], label: isLast ? 'See results' : 'Next question' },
        { keys: ['Esc'], label: 'Leave' },
      ]
    : [
        { keys: ['up', 'down'], label: 'Move' },
        { keys: ['Enter'], label: 'Choose' },
        { keys: ['1', '–', String(q.choices.length), 'or', 'A', '–', lastLetter], label: 'Answer directly' },
        { keys: ['Esc'], label: 'Leave' },
      ]
  const stemId = `quiz-stem-${index}`

  return (
    <div className="study-stage flex w-full flex-1 flex-col">
      <div className="stage-grid">
        <div className="stage-main flex flex-col">
          <StageHeader
            index={index}
            total={total}
            seconds={seconds}
            tag={[q.subtopic, q.difficulty].filter(Boolean).join(' · ')}
            answers={answers}
            revealed={revealed}
            questions={quiz.questions}
            onLeave={() => requestLeave(false)}
            // A student who submits and then immediately leaves before the
            // response lands would abandon an attempt that may well have
            // already been recorded server-side.
            leaveDisabled={busy}
          />

          <h2
            id={stemId}
            className="stage-stem mt-[clamp(20px,3.2dvh,40px)] font-semibold leading-[1.3] tracking-[-0.01em] text-ink"
          >
            {q.q}
          </h2>

          <div
            role="radiogroup"
            aria-labelledby={stemId}
            className="mt-[clamp(18px,2.6dvh,32px)] flex flex-col gap-[clamp(8px,1.2dvh,12px)]"
          >
            {q.choices.map((choice, i) => (
              <StageChoice
                key={`${index}-${i}`}
                ref={(el) => void (optionRefs.current[i] = el)}
                index={i}
                letter={letterOf(i)}
                text={choice}
                picked={chosen === i}
                isAnswer={q.answer_index === i}
                revealed={isRevealed}
                active={!isRevealed && highlight === i}
                tabbable={highlight >= 0 ? highlight === i : i === 0}
                onFocus={() => !isRevealed && setHighlight(i)}
                onPick={(el) => choose(i, el)}
              />
            ))}
          </div>

          {/* The action row sits directly under the options on every question
              and never moves: the hint on the left, Next on the right, same
              height before and after answering. */}
          <div className="mt-[clamp(16px,2.4dvh,28px)] flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <KeyHints hints={hints} />
            <span className="stage-touch-only stage-label text-muted">
              {isRevealed ? '' : 'Pick an answer to see how you did'}
            </span>
            {isRevealed && (
              <Button
                onClick={isLast ? finish : goNext}
                disabled={busy}
                size="xl"
                className="ml-auto min-w-[10rem]"
              >
                {isLast ? (
                  busy ? 'Scoring…' : error ? 'Try again' : 'See results'
                ) : (
                  <>
                    Next <Icon name="arrowRight" size={15} />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Row three: what just happened. It is the live region — a screen
            reader hears the verdict the moment the choice locks. */}
        <div className="stage-below flex flex-col gap-3 pb-[var(--stage-pad-y)] pt-[clamp(14px,2dvh,24px)]" aria-live="polite">
          {error && (
            <div role="alert" className="stage-body rounded-xl bg-coral-soft px-4 py-3 text-coral-deep">
              {error}
            </div>
          )}
          {isRevealed && (
            <StageVerdict
              key={index}
              correct={isCorrect}
              streak={streak}
              index={index}
              explanation={q.explanation}
              answerText={q.choices[q.answer_index]}
              subtopic={q.subtopic}
              source={q.source}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title="Leave this quiz?"
        description={
          answeredCount > 0
            ? `You've answered ${answeredCount} of ${total}. Answers are only saved when you see your results, so this attempt won't count.`
            : 'Nothing has been answered yet, so there is nothing to lose.'
        }
        confirmLabel="Leave quiz"
        destructive
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false)
          onExit()
        }}
      />
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
  exitDisabled = false,
}: {
  index: number
  total: number
  answered: number
  seconds: number
  compact: boolean
  onExit: () => void
  /** True while a submission is in flight — leaving now wouldn't cancel it,
   *  just abandon the student before they see whether it landed. */
  exitDisabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onExit}
          disabled={exitDisabled}
          title={exitDisabled ? 'Scoring your quiz — one moment' : undefined}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] text-muted transition-colors cursor-pointer hover:text-ink disabled:cursor-default disabled:opacity-40"
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
          className="h-full w-full origin-left bg-brand t-meter duration-500 ease-out"
          style={{ transform: `scaleX(${total ? answered / total : 0})` }}
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
  onPick: (el: HTMLElement) => void
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
      onClick={(e) => onPick(e.currentTarget)}
      disabled={revealed}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 text-left t-control duration-200',
        compact ? 'text-[12.5px]' : 'text-[14px]',
        revealed ? 'cursor-default' : 'cursor-pointer',
        tone,
        // The reveal, felt: the right answer rises to meet you, a wrong pick
        // settles back under your finger. Transform-only springs.
        revealed && isAnswer && 'sl-pop',
        revealed && picked && !isAnswer && 'sl-settle',
      )}
    >
      <span
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold',
          revealed && (isAnswer || picked) && 'sl-bubble',
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
        !reduced && 'motion-safe:animate-[verdictIn_260ms_var(--ease-sl)]',
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

/* ── Stage pieces (full page) ────────────────────────────────────────── */

/**
 * Where you are, in one glance: Leave and the clock demoted to a quiet top
 * line, the question number large, and a slim bar that is also a record —
 * each segment turns lime or pink as that question is answered.
 */
function StageHeader({
  index,
  total,
  seconds,
  tag,
  answers,
  revealed,
  questions,
  onLeave,
  leaveDisabled,
}: {
  index: number
  total: number
  seconds: number
  tag: string
  answers: number[]
  revealed: boolean[]
  questions: Quiz['questions']
  onLeave: () => void
  leaveDisabled: boolean
}) {
  return (
    <header className="flex flex-col gap-[clamp(10px,1.6dvh,16px)]">
      <div className="stage-label flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onLeave}
          disabled={leaveDisabled}
          title={leaveDisabled ? 'Scoring your quiz — one moment' : undefined}
          className={cn(
            '-ml-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-muted',
            't-control duration-150 hover:bg-line-soft hover:text-ink',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300',
            'disabled:cursor-default disabled:opacity-40',
          )}
        >
          <Icon name="arrowLeft" size={14} /> Leave
        </button>
        {/* Elapsed, not a countdown: the same information without the
            pressure, and what the study record wants anyway. */}
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-faint" title="Time on this quiz">
          <Icon name="clock" size={14} />
          <span className="sr-only">Time on this quiz </span>
          {formatClock(seconds)}
        </span>
      </div>

      <StageCount current={index + 1} total={total} noun="Question">
        {tag && <span className="setcode stage-label min-w-0 truncate text-right">{tag}</span>}
      </StageCount>

      <div className="flex h-1.5 gap-[3px]" aria-hidden>
        {questions.map((qq, i) => {
          const state = revealed[i]
            ? answers[i] === qq.answer_index
              ? 'bg-mint'
              : 'bg-coral'
            : i === index
              ? 'bg-ink-3'
              : 'bg-line'
          return <span key={i} className={cn('h-full flex-1 rounded-full t-meter duration-300', state)} />
        })}
      </div>
    </header>
  )
}

function StageChoice({
  ref,
  index,
  letter,
  text,
  picked,
  isAnswer,
  revealed,
  active,
  tabbable,
  onFocus,
  onPick,
}: {
  ref?: Ref<HTMLButtonElement>
  index: number
  letter: string
  text: string
  picked: boolean
  isAnswer: boolean
  revealed: boolean
  /** The keyboard is on this one. */
  active: boolean
  /** Roving tabindex: one option in the tab order, arrows move within. */
  tabbable: boolean
  onFocus: () => void
  onPick: (el: HTMLElement) => void
}) {
  // After the reveal the correct answer is always marked, whether or not it
  // was chosen — leaving without knowing which one was right teaches nothing.
  const tone = !revealed
    ? active
      ? 'border-brand-300 bg-raised'
      : 'border-line bg-surface hover:border-brand-200 hover:bg-raised'
    : isAnswer
      ? 'border-mint/60 bg-mint-soft'
      : picked
        ? 'border-coral/60 bg-coral-soft'
        : 'border-line bg-surface opacity-50'
  const note = revealed ? (isAnswer ? (picked ? 'Your answer' : 'Correct answer') : picked ? 'Your answer' : '') : ''

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={picked}
      data-quiz-choice={index}
      data-active={active || undefined}
      tabIndex={tabbable ? 0 : -1}
      disabled={revealed}
      onFocus={(e) => {
        // Keyboard focus (Tab) moves the highlight with it; a mouse press
        // doesn't need a ring flashing under the pointer.
        let visible = true
        try {
          visible = e.currentTarget.matches(':focus-visible')
        } catch {
          /* selector unsupported — assume keyboard */
        }
        if (visible) onFocus()
      }}
      onClick={(e) => onPick(e.currentTarget)}
      className={cn(
        'group stage-option flex w-full items-center gap-[clamp(12px,1.3cqw,18px)] rounded-2xl border-[1.5px] text-left leading-snug text-ink',
        'px-[clamp(14px,1.5cqw,22px)] py-[clamp(12px,1.5dvh,17px)]',
        't-control duration-150',
        active && 'outline-2 outline-offset-[3px] outline-brand-300',
        revealed ? 'cursor-default' : 'cursor-pointer active:translate-y-px',
        tone,
        revealed && isAnswer && 'sl-pop',
        revealed && picked && !isAnswer && 'sl-settle',
      )}
    >
      <span
        className={cn(
          'grid size-[clamp(30px,2.1cqw,36px)] shrink-0 place-items-center rounded-[10px] font-mono text-[clamp(13px,0.9cqw,15px)] font-bold',
          't-control duration-150',
          revealed && (isAnswer || picked) && 'sl-bubble',
          !revealed
            ? active
              ? 'bg-brand text-[#1a120f]'
              : 'bg-line-soft text-ink-3 group-hover:bg-brand-soft group-hover:text-brand-deep'
            : isAnswer
              ? 'bg-mint text-[#12211a]'
              : picked
                ? 'bg-coral text-[#2a1210]'
                : 'bg-line-soft text-faint',
        )}
      >
        {revealed && isAnswer ? (
          <Icon name="check" size={16} />
        ) : revealed && picked ? (
          <Icon name="close" size={16} />
        ) : (
          letter
        )}
      </span>
      <span className="min-w-0 flex-1">{text}</span>
      {note && (
        <span
          className={cn(
            'stage-label shrink-0 font-semibold max-sm:hidden',
            isAnswer ? 'text-mint-deep' : 'text-coral-deep',
          )}
        >
          {note}
        </span>
      )}
    </button>
  )
}

/**
 * The verdict at stage size. Same rules as the dock's: a right answer gets a
 * line, a miss gets the answer, the why, and the concept to go back to.
 */
function StageVerdict({
  correct,
  streak,
  index,
  explanation,
  answerText,
  subtopic,
  source,
}: {
  correct: boolean
  streak: number
  index: number
  explanation?: string | null
  answerText: string
  subtopic?: string | null
  source?: string | null
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
        'rounded-2xl border px-[clamp(16px,1.8cqw,26px)] py-[clamp(14px,1.8dvh,20px)]',
        correct ? 'border-mint/35 bg-mint-soft/60' : 'border-coral/35 bg-coral-soft/60',
        !reduced && 'motion-safe:animate-[verdictIn_260ms_var(--ease-sl)]',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon
          name={correct ? 'check' : 'alert'}
          size={18}
          className={correct ? 'text-mint-deep' : 'text-coral-deep'}
        />
        <span
          className={cn(
            'text-[clamp(1.0625rem,0.9rem+0.35cqw,1.25rem)] font-bold',
            correct ? 'text-mint-deep' : 'text-coral-deep',
          )}
        >
          {headline}
        </span>
      </div>

      {!correct && (
        <p className="stage-body mt-2 leading-relaxed text-ink-2">
          The answer is <b className="text-ink">{answerText}</b>.
        </p>
      )}

      {explanation && (
        <p className="stage-body mt-2 max-w-[68ch] leading-relaxed text-ink-2">{explanation}</p>
      )}

      {!correct && subtopic && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="setcode stage-label">Worth revising</span>
          <span className="stage-label rounded-full bg-coral-soft px-2.5 py-1 font-semibold text-coral-deep">
            {subtopic}
          </span>
        </div>
      )}

      {!correct && source && (
        <div className="setcode stage-label mt-2 truncate" title={source}>
          {source}
        </div>
      )}
    </div>
  )
}

/* ── Time ────────────────────────────────────────────────────────────── */

/**
 * Seconds since mount, ticking once a second — paused while the tab isn't
 * visible. A quiz left open in a background tab was still racking up
 * duration_seconds for time nobody spent taking it; the interval now stops
 * on `visibilitychange` and picks back up when the tab is foregrounded
 * again, so the count only ever reflects time actually on screen.
 */
function useElapsed(): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    let id: number | null = null
    const start = () => {
      if (id === null && !document.hidden) {
        id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
      }
    }
    const stop = () => {
      if (id !== null) {
        window.clearInterval(id)
        id = null
      }
    }
    const onVisibility = () => (document.hidden ? stop() : start())
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
  return seconds
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
