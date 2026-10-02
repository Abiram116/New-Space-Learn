/**
 * "Tell me how you like to learn" — the two intake questions a phone skipped,
 * offered once on desktop.
 *
 * A student who signed up on a phone answered three quick questions and was
 * never asked how explanations should be pitched, because that only matters to
 * the chat tutor and the tutor lives here. This card is the one place those
 * two questions come back: on Home and in Settings, until they're answered or
 * dismissed, and then never again on any device (the marker lives on the
 * server). Only the question(s) still unanswered are asked.
 *
 * The questions open inline rather than in a modal — they're optional, short,
 * and there is nothing on the page they need protecting from.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import { updateStudentModel } from '../../api/me'
import type { StudentModel } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useToast } from '../../components/ui/Toast'
import { readCache, subscribe, writeCache } from '../../lib/asyncCache'
import { cn } from '../../lib/cn'
import {
  buildStylePatch,
  DISMISS_STYLE_PATCH,
  pendingStyleQuestions,
  STUDENT_MODEL_KEY,
} from './skippedStyle'
import { STEPS, type ChoiceStep } from './steps'

const STYLE = STEPS.find((s): s is ChoiceStep => s.id === 'style')!
const DEPTH = STEPS.find((s): s is ChoiceStep => s.id === 'depth')!

/**
 * The student model as last fetched by anything (the onboarding gate, Profile,
 * Settings) — read from the shared cache, never fetched here, so Home pays no
 * extra request for an offer most students will never see.
 */
export function useCachedStudentModel(): StudentModel | undefined {
  const sub = useCallback((cb: () => void) => subscribe(STUDENT_MODEL_KEY, cb), [])
  const snap = useCallback(() => readCache<StudentModel>(STUDENT_MODEL_KEY)?.data, [])
  return useSyncExternalStore(sub, snap, () => undefined)
}

type CardProps = {
  model: StudentModel | null | undefined
  /** Called with the saved model, after the shared cache is updated. */
  onUpdated?: (m: StudentModel) => void
  className?: string
}

/** Renders nothing — and touches no context — unless there is something to ask. */
export function StyleIntakeCard(props: CardProps) {
  if (pendingStyleQuestions(props.model).length === 0) return null
  return <Offer {...props} />
}

function Offer({ model, onUpdated, className }: CardProps) {
  const { show, showError } = useToast()
  const [open, setOpen] = useState(false)
  const [styles, setStyles] = useState<string[]>([])
  const [depth, setDepth] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [gone, setGone] = useState(false)

  const pending = pendingStyleQuestions(model)
  if (gone || pending.length === 0) return null

  const commit = (m: StudentModel) => {
    writeCache(STUDENT_MODEL_KEY, m)
    onUpdated?.(m)
  }

  const save = async () => {
    setBusy(true)
    try {
      commit(await updateStudentModel(buildStylePatch({ styles, depth })))
      setGone(true)
      show('Saved. The tutor will explain things that way from now on.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  const dismiss = async () => {
    // Hide first: a slow backend must not leave a card someone just closed
    // sitting on screen. A failed dismiss only means it may come back once.
    setGone(true)
    try {
      commit(await updateStudentModel(DISMISS_STYLE_PATCH))
    } catch {
      /* quiet — see above */
    }
  }

  const answered = styles.length > 0 || depth !== null

  return (
    <section
      aria-labelledby="style-intake-title"
      className={cn('rounded-xl border border-line bg-surface', className)}
    >
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand">
          <Icon name="sparkle" size={15} filled />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="style-intake-title" className="text-[15px] font-semibold text-ink">
            Tell me how you like to learn
          </h2>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-muted">
            You skipped {pending.length === 2 ? 'two questions' : 'one question'} when you signed
            up on your phone. {pending.length === 2 ? 'They tell' : 'It tells'} the tutor how to
            explain things to you. It takes about 20 seconds.
          </p>
          {!open && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="style-intake-body">
                Answer {pending.length === 2 ? 'them' : 'it'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void dismiss()}>
                Not now
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          aria-label="Dismiss"
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-lg text-faint transition-colors hover:bg-line-soft hover:text-ink"
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      {open && (
        <div id="style-intake-body" className="flex flex-col gap-5 border-t border-line px-4 pb-4 pt-4">
          {pending.includes('style') && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[14px] font-semibold text-ink">{STYLE.ask}</legend>
              <p className="-mt-1 mb-1 text-[12.5px] text-faint">{STYLE.aside}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {STYLE.options.map((o) => {
                  const on = styles.includes(o.value)
                  return (
                    <Choice
                      key={o.value}
                      on={on}
                      role="checkbox"
                      label={o.label}
                      hint={o.hint}
                      onClick={() =>
                        setStyles((prev) => (on ? prev.filter((v) => v !== o.value) : [...prev, o.value]))
                      }
                    />
                  )
                })}
              </div>
            </fieldset>
          )}
          {pending.includes('depth') && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[14px] font-semibold text-ink">{DEPTH.ask}</legend>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                {DEPTH.options.map((o) => (
                  <Choice
                    key={o.value}
                    on={depth === o.value}
                    role="radio"
                    label={o.label}
                    hint={o.hint}
                    onClick={() => setDepth(depth === o.value ? null : o.value)}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void save()} disabled={busy || !answered} className="min-w-28">
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <span className="ml-auto text-[12.5px] text-faint">You can change this later in Settings.</span>
          </div>
        </div>
      )}
    </section>
  )
}

/** One choice as a tappable card — also what Settings › Learning is built from. */
export function Choice({
  on,
  role,
  label,
  hint,
  onClick,
}: {
  on: boolean
  role: 'checkbox' | 'radio'
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      onClick={onClick}
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-[11px] border px-3 py-2.5 text-left transition-colors',
        on ? 'border-brand/60 bg-brand-soft' : 'border-line bg-raised hover:border-line-dash',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid h-4 w-4 shrink-0 place-items-center border',
          role === 'radio' ? 'rounded-full' : 'rounded-[4px]',
          on ? 'border-brand bg-brand text-[#1a120f]' : 'border-line-dash',
        )}
      >
        {on && <Icon name="check" size={10} />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-[13.5px] font-semibold', on ? 'text-brand-deep' : 'text-ink')}>{label}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{hint}</span>
      </span>
    </button>
  )
}
