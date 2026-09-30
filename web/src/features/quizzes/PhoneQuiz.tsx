/**
 * Taking a quiz on a phone.
 *
 * Immersive and thumb-first: the question sits top-middle at 19px; the answers
 * are big stacked buttons in the lower half, where a thumb already is. Tapping
 * one is final and gives the verdict at once — the answers you didn't need
 * fold away, and a panel slides up from the bottom edge with the explanation
 * and a large "Next" pinned under it.
 *
 * Shares every piece of logic with the desktop stage (choose / next / finish /
 * leave live in QuizRunner); this file is layout and touch feel only.
 */

import { useEffect, useRef, type Ref } from 'react'
import type { Quiz } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { PhoneTopRow } from './phoneKit'

export type PhoneQuizProps = {
  index: number
  total: number
  seconds: number
  clock: string
  questions: Quiz['questions']
  answers: number[]
  revealed: boolean[]
  highlight: number
  optionRefs: { current: (HTMLButtonElement | null)[] }
  isLast: boolean
  busy: boolean
  error: string | null
  headline: string
  onChoose: (i: number, el: HTMLElement) => void
  onFocusOption: (i: number) => void
  onNext: () => void
  onFinish: () => void
  onLeave: () => void
}

export function PhoneQuizStage(p: PhoneQuizProps) {
  const q = p.questions[p.index]
  const chosen = p.answers[p.index]
  const isRevealed = p.revealed[p.index]
  const isCorrect = chosen === q.answer_index
  const tag = [q.subtopic, q.difficulty].filter(Boolean).join(' · ')
  const panelRef = useRef<HTMLDivElement>(null)

  // A long explanation starts at its first line, not wherever the last one ended.
  useEffect(() => {
    panelRef.current?.querySelector('[data-scroll]')?.scrollTo?.({ top: 0 })
  }, [p.index, isRevealed])

  const stemId = `quiz-stem-${p.index}`

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col" data-testid="phone-quiz">
      <PhoneTopRow
        onClose={p.onLeave}
        closeLabel="Leave quiz"
        closeDisabled={p.busy}
        current={p.index + 1}
        total={p.total}
        noun="Question"
        right={
          <span className="inline-flex items-center gap-1 font-mono text-[13px] tabular-nums text-faint" title="Time on this quiz">
            <Icon name="clock" size={13} />
            <span className="sr-only">Time on this quiz </span>
            {p.clock}
          </span>
        }
        bar={
          <div className="flex h-1.5 gap-[3px]" aria-hidden>
            {p.questions.map((qq, i) => {
              const state = p.revealed[i]
                ? p.answers[i] === qq.answer_index
                  ? 'bg-mint'
                  : 'bg-coral'
                : i === p.index
                  ? 'bg-ink-3'
                  : 'bg-line'
              return <span key={i} className={cn('h-full flex-1 rounded-full t-meter duration-300', state)} />
            })}
          </div>
        }
      />

      <div className="phone-quiz-body">
        <div className="phone-quiz-q px-5 pt-3">
          <div className="my-auto py-2">
            {tag && <p className="mb-2 truncate text-[12.5px] font-semibold uppercase tracking-wide text-faint">{tag}</p>}
            <h2
              id={stemId}
              className="text-[19px] font-semibold leading-[1.35] tracking-[-0.005em] text-ink [text-wrap:pretty]"
            >
              {q.q}
            </h2>
          </div>
        </div>

        <div className="phone-quiz-a">
          {p.error && (
            <div role="alert" className="mx-4 mb-2 rounded-xl bg-coral-soft px-4 py-3 text-[15px] text-coral-deep">
              {p.error}
            </div>
          )}

          <div
            role="radiogroup"
            aria-labelledby={stemId}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-3 pt-2"
          >
            {/* `mt-auto` rather than `justify-end`: bottom-aligned, but a list
                taller than the room still scrolls from its first row. */}
            <div className="mt-auto flex flex-col gap-2.5">
            {q.choices.map((choice, i) => (
              <PhoneChoice
                key={`${p.index}-${i}`}
                ref={(el) => void (p.optionRefs.current[i] = el)}
                index={i}
                letter={String.fromCharCode(65 + i)}
                text={choice}
                picked={chosen === i}
                isAnswer={q.answer_index === i}
                revealed={isRevealed}
                active={!isRevealed && p.highlight === i}
                tabbable={p.highlight >= 0 ? p.highlight === i : i === 0}
                onFocus={() => !isRevealed && p.onFocusOption(i)}
                onPick={(el) => p.onChoose(i, el)}
              />
            ))}
            </div>
          </div>

          {isRevealed && (
            <div
              ref={panelRef}
              key={p.index}
              aria-live="polite"
              className={cn(
                'phone-panel-up shrink-0 rounded-t-3xl border-x border-t px-4 pt-4',
                'pb-[max(12px,env(safe-area-inset-bottom))]',
                isCorrect ? 'border-mint/35 bg-mint-soft' : 'border-coral/35 bg-coral-soft',
              )}
            >
              <div data-scroll className="max-h-[30dvh] overflow-y-auto">
                <div className="flex items-center gap-2">
                  <Icon
                    name={isCorrect ? 'check' : 'alert'}
                    size={20}
                    className={isCorrect ? 'text-mint-deep' : 'text-coral-deep'}
                  />
                  <span className={cn('text-[18px] font-bold', isCorrect ? 'text-mint-deep' : 'text-coral-deep')}>
                    {p.headline}
                  </span>
                </div>
                {!isCorrect && (
                  <p className="mt-2 text-[16px] leading-relaxed text-ink-2">
                    The answer is <b className="text-ink">{q.choices[q.answer_index]}</b>.
                  </p>
                )}
                {q.explanation && (
                  <p className="mt-2 text-[16px] leading-relaxed text-ink-2">{q.explanation}</p>
                )}
                {!isCorrect && q.subtopic && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-muted">Worth revising</span>
                    <span className="rounded-full bg-coral-soft px-2.5 py-1 text-[13px] font-semibold text-coral-deep">
                      {q.subtopic}
                    </span>
                  </div>
                )}
                {!isCorrect && q.source && (
                  <p className="mt-2 truncate text-[12.5px] text-muted" title={q.source}>
                    {q.source}
                  </p>
                )}
              </div>
              <Button
                onClick={p.isLast ? p.onFinish : p.onNext}
                disabled={p.busy}
                size="xl"
                className="mt-3 min-h-14 w-full text-[17px]"
              >
                {p.isLast ? (
                  p.busy ? (
                    'Scoring…'
                  ) : p.error ? (
                    'Try again'
                  ) : (
                    'See results'
                  )
                ) : (
                  <>
                    Next <Icon name="arrowRight" size={16} />
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PhoneChoice({
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
  active: boolean
  tabbable: boolean
  onFocus: () => void
  onPick: (el: HTMLElement) => void
}) {
  // Once answered, only the two rows that matter stay: what you picked and
  // what was right. The rest have done their job and give the room to the
  // explanation.
  const folded = revealed && !isAnswer && !picked
  const tone = !revealed
    ? active
      ? 'border-brand-300 bg-raised'
      : 'border-line bg-surface active:bg-raised'
    : isAnswer
      ? 'border-mint/60 bg-mint-soft'
      : 'border-coral/60 bg-coral-soft'

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
      hidden={folded}
      onFocus={(e) => {
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
        'phone-tap flex min-h-14 w-full items-center gap-3 rounded-2xl border-[1.5px] px-3.5 py-2.5 text-left text-[16.5px] leading-snug text-ink',
        't-control duration-150',
        active && 'outline-2 outline-offset-[3px] outline-brand-300',
        revealed ? 'cursor-default' : 'cursor-pointer active:translate-y-px',
        revealed && isAnswer && !picked && 'phone-fold-short',
        tone,
        revealed && isAnswer && 'sl-pop',
        revealed && picked && !isAnswer && 'sl-settle',
      )}
    >
      <span
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-[10px] font-mono text-[14px] font-bold',
          revealed && (isAnswer || picked) && 'sl-bubble',
          !revealed
            ? active
              ? 'bg-brand text-[#1a120f]'
              : 'bg-line-soft text-ink-3'
            : isAnswer
              ? 'bg-mint text-[#12211a]'
              : 'bg-coral text-[#2a1210]',
        )}
      >
        {revealed && isAnswer ? <Icon name="check" size={17} /> : revealed && picked ? <Icon name="close" size={17} /> : letter}
      </span>
      <span className="min-w-0 flex-1">{text}</span>
    </button>
  )
}
