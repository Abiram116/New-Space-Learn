/**
 * The desktop first-run checklist: three steps, the next one as the button.
 *
 * Material in → something to be tested on → a question to the tutor. That is
 * the order the product actually works in, so it is the order a new account is
 * walked through, and each step lights up from counts Home already has (see
 * `deriveChecklist`). It is a ruled band rather than three cards: these are
 * steps you are measured against, not objects you own.
 */

import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import type { Checklist, StepId } from './checklist'

const WHAT: Record<StepId, string> = {
  material: 'A PDF, slides or lecture notes. Add them to a topic.',
  practice: 'Turn your file into cards or a quiz.',
  tutor: 'Ask about your file. Every answer shows the page.',
}

export type StepTarget =
  | { kind: 'link'; to: string; label: string; alt?: { to: string; label: string } }
  | { kind: 'button'; onClick: () => void; label: string }
  | { kind: 'hint'; text: string }

export function FirstSteps({
  checklist,
  targets,
  onHide,
  className,
}: {
  checklist: Checklist
  targets: Record<StepId, StepTarget>
  /** Offered once at least one step is done — "I've got it from here". */
  onHide?: () => void
  className?: string
}) {
  const { steps, next } = checklist
  const doneCount = steps.filter((s) => s.done).length
  return (
    <section aria-labelledby="first-steps-title" className={cn('ruled flex flex-col gap-4 pb-5', className)}>
      <div className="flex items-baseline gap-3">
        <h2 id="first-steps-title" className="nameplate text-[20px] text-ink">
          Let's get started
        </h2>
        <span className="setcode">
          {doneCount} of {steps.length} done
        </span>
        {onHide && doneCount > 0 && (
          <button
            type="button"
            onClick={onHide}
            className="ml-auto min-h-10 cursor-pointer rounded-[9px] px-2.5 text-[13px] text-faint transition-colors hover:bg-line-soft hover:text-ink"
          >
            Hide
          </button>
        )}
      </div>
      <ol className="grid gap-3 lg:grid-cols-3">
        {steps.map((s) => {
          const isNext = next?.id === s.id
          const target = targets[s.id]
          return (
            <li
              key={s.id}
              aria-current={isNext ? 'step' : undefined}
              className={cn(
                'flex flex-col gap-3 rounded-xl border p-4 text-left',
                isNext ? 'border-brand/45 bg-brand-tint' : 'border-line bg-surface/60',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[13px] font-bold tabular-nums',
                    s.done
                      ? 'border-mint/60 bg-mint-soft text-mint'
                      : isNext
                        ? 'border-brand bg-brand text-[#1a120f]'
                        : 'border-line-dash text-faint',
                  )}
                >
                  {s.done ? <Icon name="check" size={13} /> : s.n}
                </span>
                <span
                  className={cn(
                    'text-[15px] font-semibold',
                    s.done ? 'text-muted line-through decoration-line-dash' : 'text-ink',
                  )}
                >
                  {s.title}
                </span>
                <span className="sr-only">{s.done ? '(done)' : isNext ? '(next)' : ''}</span>
              </div>
              <p className={cn('text-[13.5px] leading-relaxed', s.done ? 'text-faint' : 'text-muted')}>{WHAT[s.id]}</p>
              {isNext && <StepAction target={target} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function StepAction({ target }: { target: StepTarget }) {
  if (target.kind === 'hint') return <p className="text-[13px] text-ink-3">{target.text}</p>
  if (target.kind === 'button') {
    return (
      <Button size="lg" onClick={target.onClick} className="mt-auto self-start">
        {target.label}
        <Icon name="arrowRight" size={15} />
      </Button>
    )
  }
  return (
    <div className="mt-auto flex flex-wrap items-center gap-3">
      <Link to={target.to}>
        <Button size="lg">
          {target.label}
          <Icon name="arrowRight" size={15} />
        </Button>
      </Link>
      {target.alt && (
        <Link to={target.alt.to} className="text-[13.5px] font-semibold text-ink-3 hover:text-ink">
          {target.alt.label}
        </Link>
      )}
    </div>
  )
}
