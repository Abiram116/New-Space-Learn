/**
 * Taking a quiz again: exactly as before, or reworded.
 *
 * Reworded keeps every concept and every right answer and changes the words
 * and the order, so the retake tests the idea rather than memory of how the
 * question was phrased. The choice is remembered on this device
 * (`retakeRewordSwitch`); "don't ask again" skips this screen next time
 * (`retakeAskSwitch`, undone from the quiz list's retake setting).
 */

import { useState } from 'react'
import type { Quiz } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Select } from '../../components/ui/Select'
import { cn } from '../../lib/cn'
import { retakeAskSwitch, retakeRewordSwitch } from './variant'

export type RetakeMode = 'same' | 'reworded'

export function RetakeChoice({
  quiz,
  busy,
  error,
  onPick,
  onBack,
  backLabel,
  phone,
}: {
  quiz: Quiz
  /** Rewording is on its way. */
  busy: boolean
  error: string | null
  onPick: (mode: RetakeMode) => void
  onBack: () => void
  backLabel: string
  phone: boolean
}) {
  const preferReworded = retakeRewordSwitch.use()
  const [dontAsk, setDontAsk] = useState(false)

  const pick = (mode: RetakeMode) => {
    if (busy) return
    retakeRewordSwitch.set(mode === 'reworded')
    if (dontAsk) retakeAskSwitch.set(false)
    onPick(mode)
  }

  const options: { mode: RetakeMode; title: string; detail: string }[] = [
    { mode: 'same', title: 'Same questions', detail: 'Exactly as before, word for word.' },
    {
      mode: 'reworded',
      title: 'Reworded',
      detail: "Same ideas and answers in new words, so you can't answer from memory of the phrasing.",
    },
  ]
  if (preferReworded) options.reverse()

  return (
    <div className={cn('mx-auto flex w-full max-w-lg flex-col gap-4', phone ? 'px-4 py-6' : 'p-6')}>
      <div>
        <p className="setcode">Taking it again</p>
        <h2 className="nameplate mt-1 text-[22px] leading-tight text-ink">{quiz.topic || 'This quiz'}</h2>
        <p className="mt-1 text-[13px] text-muted">
          {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
          {quiz.best_score != null && ` · best ${quiz.best_score}%`}
          {quiz.attempts ? ` · ${quiz.attempts} attempt${quiz.attempts === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2.5" role="group" aria-label="How to retake">
        {options.map((o, i) => (
          <button
            key={o.mode}
            type="button"
            disabled={busy}
            autoFocus={i === 0}
            onClick={() => pick(o.mode)}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border-[1.5px] px-4 text-left t-control duration-150',
              phone ? 'min-h-16 py-3.5' : 'py-3',
              i === 0 ? 'border-brand/60 bg-brand-tint' : 'border-line bg-surface hover:border-brand-200',
              busy ? 'cursor-default opacity-60' : 'cursor-pointer',
            )}
          >
            <Icon name={o.mode === 'reworded' ? 'sparkle' : 'refresh'} size={16} className="mt-0.5 shrink-0 text-brand-deep" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-ink">
                {busy && o.mode === 'reworded' ? 'Rewording…' : o.title}
                {i === 0 && !busy && <span className="setcode ml-2 text-brand-deep">Your usual</span>}
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{o.detail}</span>
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-coral-soft px-3.5 py-2.5 text-[13px] text-coral-deep">
          {error}
        </div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
        <input
          type="checkbox"
          checked={dontAsk}
          onChange={(e) => setDontAsk(e.target.checked)}
          className="size-4 accent-[var(--color-brand)]"
        />
        Remember my choice and don't ask again
      </label>

      <Button variant="secondary" size={phone ? 'lg' : 'md'} className={phone ? 'w-full' : 'self-start'} onClick={onBack} disabled={busy}>
        <Icon name="arrowLeft" size={14} /> {backLabel}
      </Button>
    </div>
  )
}

/** The retake setting, for the quiz list: ask each time, or always one way. */
export function RetakeSetting({ className }: { className?: string }) {
  const ask = retakeAskSwitch.use()
  const reword = retakeRewordSwitch.use()
  const value = ask ? 'ask' : reword ? 'reworded' : 'same'
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="setcode shrink-0">On retake</span>
      <Select
        value={value}
        ariaLabel="On retake"
        onChange={(v) => {
          retakeAskSwitch.set(v === 'ask')
          if (v !== 'ask') retakeRewordSwitch.set(v === 'reworded')
        }}
        options={[
          { value: 'ask', label: 'Ask each time' },
          { value: 'same', label: 'Same questions' },
          { value: 'reworded', label: 'Reworded' },
        ]}
      />
    </div>
  )
}
