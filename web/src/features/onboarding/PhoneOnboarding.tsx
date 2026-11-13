/**
 * First run on a phone — three light questions, then Today.
 *
 * The desktop intake is a title sequence around a live canvas organism. On a
 * phone that is the wrong trade: it costs battery and frame budget on the
 * slowest device the student owns, at the moment they're deciding whether the
 * app is worth keeping. So a phone gets the same save path with less
 * ceremony:
 *
 *   1. what to call you
 *   2. how long a session usually is (15 / 30 / 60, 15 pre-picked)
 *   3. what you're working towards (optional)
 *
 * The two "how do you like it explained" questions are skipped on purpose —
 * they only shape the chat tutor, which lives on desktop — and the skip is
 * recorded (`intake_skipped_style`) so desktop can offer them once.
 *
 * The one authored moment is the finish: the three cards of the mark fan out
 * from a stack, transform and opacity only, ~1.2s, then Today. Under reduced
 * motion it is a still mark and an immediate hand-off.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateStudentModel } from '../../api/me'
import { useAuth } from '../../auth/AuthProvider'
import { Icon } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { getCachedBrief, getCachedStats } from '../../lib/briefCache'
import { writeCache } from '../../lib/asyncCache'
import { cn } from '../../lib/cn'
import { buildPhonePatch, STUDENT_MODEL_KEY } from './skippedStyle'
import { markOnboarded } from './state'
import { EXAM_CONTEXT_MAX, firstName, NAME_MAX } from './steps'

/** The phone's session choices. "Longer" is a desktop habit; Settings still has it. */
export const PHONE_SESSIONS = [
  { value: '15', label: '15 minutes', hint: 'Between other things' },
  { value: '30', label: '30 minutes', hint: 'A focused block' },
  { value: '60', label: 'An hour', hint: 'A proper sitting' },
] as const

export const PHONE_DEFAULT_SESSION = '15'

const FINALE_MS = 1250

type Step = 0 | 1 | 2

export function PhoneOnboarding() {
  const navigate = useNavigate()
  const { user, setDisplayName } = useAuth()
  const { show, showError } = useToast()
  const reduced = useReducedMotion()

  const initialName = ((user?.user_metadata?.display_name as string | undefined) ?? '').trim()
  const [step, setStep] = useState<Step>(0)
  const [name, setName] = useState(initialName)
  const [session, setSession] = useState<string>(PHONE_DEFAULT_SESSION)
  const [goal, setGoal] = useState('')
  const [finishing, setFinishing] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const saved = useRef<Promise<void> | null>(null)

  // Each step starts with focus where its answer goes — an input when there is
  // one (the keyboard comes up with it), the heading otherwise.
  useEffect(() => {
    if (finishing) return
    const target = inputRef.current ?? headingRef.current
    target?.focus({ preventScroll: true })
    if (window.scrollY > 0) window.scrollTo({ top: 0 })
  }, [step, finishing])

  const save = useCallback(
    (answers: { name: string; session: string; goal: string }) => {
      if (saved.current) return saved.current
      saved.current = (async () => {
        const trimmed = answers.name.trim()
        const jobs: Promise<unknown>[] = [
          updateStudentModel(buildPhonePatch({ name: trimmed, session: answers.session, goal: answers.goal })).then(
            (m) => writeCache(STUDENT_MODEL_KEY, m),
          ),
        ]
        if (trimmed && trimmed !== initialName) jobs.push(setDisplayName(trimmed))
        const failed = (await Promise.allSettled(jobs)).find((r) => r.status === 'rejected')
        // Never trap anyone here: every one of these is in Settings.
        if (failed) showError(failed.reason)
        markOnboarded(user?.id ?? null)
      })()
      return saved.current
    },
    [initialName, setDisplayName, showError, user],
  )

  const finish = useCallback(
    (answers: { name: string; session: string; goal: string }) => {
      if (finishing) return
      setFinishing(true)
      const saving = save(answers)
      // Warm Today's first requests while the mark plays, once the answers
      // they depend on are stored.
      void saving.then(() => {
        getCachedStats().catch(() => {})
        getCachedBrief().catch(() => {})
      })
      const hold = reduced ? 0 : FINALE_MS
      void Promise.all([saving, new Promise((r) => window.setTimeout(r, hold))]).then(() =>
        navigate('/home', { replace: true }),
      )
    },
    [finishing, navigate, reduced, save],
  )

  const skipAll = () => {
    show('You can answer these later in Settings.', 'info')
    markOnboarded(user?.id ?? null)
    navigate('/home', { replace: true })
  }

  const next = (e?: FormEvent) => {
    e?.preventDefault()
    if (step < 2) setStep((s) => (s + 1) as Step)
    else finish({ name, session, goal })
  }

  if (finishing) return <Finale name={firstName(name)} reduced={reduced} />

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <style>{PHONE_CSS}</style>
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))]">
        <Logo size={24} textClassName="text-[16px]" />
        <button
          type="button"
          onClick={skipAll}
          className="min-h-11 cursor-pointer rounded-full px-3 text-[15px] text-muted transition-colors active:bg-line-soft"
        >
          Skip
        </button>
      </header>

      <div className="mx-auto w-full max-w-xl px-4 pt-3" aria-hidden>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-line">
              <span
                className={cn('absolute inset-0 origin-left rounded-full', i < step ? 'bg-brand/55' : 'bg-brand')}
                style={{
                  transform: `scaleX(${i <= step ? 1 : 0})`,
                  transition: reduced ? undefined : 'transform 500ms var(--ease-sl)',
                }}
              />
            </span>
          ))}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{`Question ${step + 1} of 3`}</p>

      <form
        key={step}
        onSubmit={next}
        className={cn(
          'mx-auto flex w-full max-w-xl flex-1 flex-col px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-8 [@media(max-height:640px)]:pb-[max(12px,env(safe-area-inset-bottom))] [@media(max-height:640px)]:pt-3 [@media(max-height:500px)]:pt-5',
          !reduced && 'po-in',
        )}
      >
        {step === 0 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} id="po-ask" className="nameplate text-[clamp(26px,min(8.5vw,9vh),36px)] leading-[1.02] outline-none">
              What should we call you?
            </h1>
            <p className="mt-2.5 [@media(max-height:640px)]:mt-1.5 text-[15px] leading-relaxed text-ink-3">It’s how we'll say hi on Today.</p>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              autoComplete="given-name"
              enterKeyHint="next"
              aria-labelledby="po-ask"
              placeholder="Your name"
              className="mt-7 min-h-12 w-full border-0 border-b border-line bg-transparent pb-2 text-[22px] font-semibold text-ink outline-none transition-colors placeholder:font-normal placeholder:text-faint focus:border-brand/70"
            />
          </>
        )}

        {step === 1 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} id="po-ask" className="nameplate text-[clamp(26px,min(8.5vw,9vh),36px)] leading-[1.02] outline-none">
              How long do you usually study in one go?
            </h1>
            <p className="mt-2.5 [@media(max-height:640px)]:mt-1.5 text-[15px] leading-relaxed text-ink-3">
              We'll fit your reviews to this. You can change it later.
            </p>
            <div role="radiogroup" aria-labelledby="po-ask" className="mt-6 [@media(max-height:640px)]:mt-3 grid gap-2.5 [@media(max-height:640px)]:gap-2 [@media(min-width:600px)_and_(max-height:500px)]:grid-cols-3">
              {PHONE_SESSIONS.map((o) => {
                const on = session === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setSession(o.value)}
                    className={cn(
                      'flex min-h-16 [@media(max-height:640px)]:min-h-[52px] w-full cursor-pointer items-center gap-3.5 rounded-[14px] border px-4 py-3 [@media(max-height:640px)]:py-2 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.985]',
                      on ? 'border-brand/70 bg-brand-soft' : 'border-line bg-raised/70',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-6 w-6 shrink-0 place-items-center rounded-full border',
                        on ? 'border-brand bg-brand text-[#1a120f]' : 'border-line-dash',
                      )}
                    >
                      {on && <Icon name="check" size={12} />}
                    </span>
                    <span className="min-w-0">
                      <span className={cn('block text-[17px] font-semibold', on ? 'text-brand-deep' : 'text-ink')}>
                        {o.label}
                      </span>
                      <span className="mt-0.5 block text-[13.5px] text-muted">{o.hint}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1 ref={headingRef} tabIndex={-1} id="po-ask" className="nameplate text-[clamp(26px,min(8.5vw,9vh),36px)] leading-[1.02] outline-none">
              What are you working towards?
            </h1>
            <p className="mt-2.5 [@media(max-height:640px)]:mt-1.5 text-[15px] leading-relaxed text-ink-3">
              An exam, a course or a job. You can skip this.
            </p>
            <input
              ref={inputRef}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              maxLength={EXAM_CONTEXT_MAX}
              autoComplete="off"
              enterKeyHint="done"
              aria-labelledby="po-ask"
              placeholder="e.g. Biology finals in June"
              className="mt-7 min-h-12 w-full border-0 border-b border-line bg-transparent pb-2 text-[19px] font-semibold text-ink outline-none transition-colors placeholder:font-normal placeholder:text-faint focus:border-brand/70"
            />
          </>
        )}

        {/* Directly under the answer rather than pinned to the bottom edge:
            with the keyboard up, a bottom-pinned button is the one thing it
            covers. On the choice step there is no keyboard, so it sinks to
            the thumb zone instead. */}
        <div className={cn('flex flex-col gap-2 pt-7 [@media(max-height:640px)]:pt-4', step === 1 && 'mt-auto')}>
          <button
            type="submit"
            className="flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-brand px-5 text-[17px] font-semibold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_3px_0_#a8331d] transition-transform active:translate-y-[2px]"
          >
            {step === 2 ? (goal.trim() ? 'Finish' : 'Finish without one') : 'Continue'}
            <Icon name="arrowRight" size={16} />
          </button>
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 text-[15px] text-muted"
            >
              <Icon name="arrowLeft" size={13} /> Back
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

/**
 * The brand moment: the mark's three cards come off a single stack and fan
 * into the logo, the wordmark settles, a line of welcome. Pure CSS keyframes on
 * transform and opacity, so it composites and costs nothing to the main thread.
 */
function Finale({ name, reduced }: { name: string; reduced: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-6 text-center text-ink"
    >
      <style>{PHONE_CSS}</style>
      <svg width="96" height="96" viewBox="0 0 32 32" fill="none" aria-hidden className={reduced ? undefined : 'po-mark'}>
        <g className="po-card po-c1">
          <rect x="4.2" y="9.6" width="14" height="19" rx="2.6" transform="rotate(-19 4.2 9.6)" fill="#2EE6D6" fillOpacity="0.32" stroke="#2EE6D6" strokeOpacity="0.55" strokeWidth="1.1" />
        </g>
        <g className="po-card po-c2">
          <rect x="9.6" y="6.6" width="14" height="19" rx="2.6" transform="rotate(-8 9.6 6.6)" fill="#FFC53D" fillOpacity="0.34" stroke="#FFC53D" strokeOpacity="0.6" strokeWidth="1.1" />
        </g>
        <g className="po-card po-c3">
          <rect x="14.4" y="5.2" width="14" height="19.6" rx="2.8" transform="rotate(4 14.4 5.2)" fill="#FF5A3C" stroke="#FF8B76" strokeWidth="1.1" />
          <path d="M18.4 12.2h6.6M18.4 15.6h4.3" stroke="#1A120F" strokeOpacity="0.62" strokeWidth="1.5" strokeLinecap="round" transform="rotate(4 14.4 5.2)" />
        </g>
      </svg>
      <div className={reduced ? undefined : 'po-words'}>
        <p className="nameplate text-[30px] leading-tight">{name ? `You’re set, ${name}.` : 'You’re set.'}</p>
        <p className="mt-2 text-[15px] text-ink-3">Opening Today…</p>
      </div>
    </div>
  )
}

const PHONE_CSS = `
.po-in { animation: po-rise 420ms var(--ease-sl) both; }
@keyframes po-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.po-card { transform-box: view-box; transform-origin: 16px 28px; }
.po-mark .po-c1 { animation: po-fan-1 900ms 80ms var(--ease-sl) both; }
.po-mark .po-c2 { animation: po-fan-2 900ms 40ms var(--ease-sl) both; }
.po-mark .po-c3 { animation: po-fan-3 900ms 0ms var(--ease-sl) both; }
@keyframes po-fan-1 { from { opacity: 0; transform: translate(6px, 2px) rotate(19deg); } to { opacity: 1; transform: none; } }
@keyframes po-fan-2 { from { opacity: 0; transform: translate(3px, 1px) rotate(8deg); } to { opacity: 1; transform: none; } }
@keyframes po-fan-3 { from { opacity: 0; transform: translateY(6px) scale(0.92); } to { opacity: 1; transform: none; } }
.po-words { animation: po-rise 520ms 420ms var(--ease-sl) both; }
@media (prefers-reduced-motion: reduce) {
  .po-in, .po-mark .po-card, .po-words { animation: none !important; }
}
`
