/**
 * First run — a workbench, not a form and not a transcript.
 *
 * A new account has nothing: no subjects, no cards, no history. Dropping
 * someone into a dashboard of zeroes teaches them the product is empty, and a
 * settings form of dropdowns teaches them it is admin. The app genuinely needs
 * one thing before it can be useful — a sense of how this person wants to be
 * taught — so it asks.
 *
 * **The problem with asking.** Four questions from a product you have not used
 * yet is unpleasant in a specific way: you cannot tell what any answer will do,
 * so you start guessing at the response the form wants, and then you rush or
 * skip. Two earlier versions of this screen made it worse — a dropdown form,
 * then a simulated chat that put a fake typing delay in front of every
 * question, which is a wait dressed as a personality.
 *
 * **So the consequence is on screen.** Every choice visibly rewrites a sample
 * answer beside it. Pick "a concrete example" and it opens with a speedometer;
 * pick "the formal definition" and it opens with the limit. There is no hidden
 * correct answer because every answer is visible, which turns the question from
 * a test into a control you are operating — and demonstrates the hand-off the
 * product is built on before the student has uploaded a single page.
 *
 * **Nothing here is a model call.** The questions are fixed and the sample is
 * composed by lookup (see `preview.ts`). Spending a real generation on a
 * scripted screen would be slow, cost quota, and risk the model contradicting
 * the preference it is meant to be illustrating.
 *
 * **It does not ask what you are studying for.** That was on the original list
 * and it is the one question to cut: it changes on a fortnightly cycle, it is
 * already a field in Settings, and asking here would have someone type "finals"
 * on day one and be reminded of it in March. Preferences are stable; goals are
 * not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateStudentModel } from '../../api/me'
import { useAuth } from '../../auth/AuthProvider'
import { DraftingCursor } from '../../components/ui/DraftingCursor'
import { Icon } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import {
  LAMP_BASE_WARMTH,
  lampGradient,
  MOTES,
  TABLE_IMAGE,
  TABLE_MASK,
  TABLE_SIZE,
  VIGNETTE,
} from '../../lib/room'
import { useHandoff } from '../transitions/Handoff'
import { composeSample, SAMPLE_QUESTION, sessionShape } from './preview'
import { FREE_TEXT_MAX, STEPS } from './steps'
import { markOnboarded } from './state'

/**
 * The arrival waits for you, it does not race you.
 *
 * It was on a 4.2s timer, which was worse than either extreme: too short to
 * finish reading, long enough to feel like a wait, and it moved on whether you
 * were ready or not. Reading speed is not something to guess at.
 *
 * So the student starts it. Nothing advances until they act, and this ceiling
 * exists only so an unattended tab does not sit on the intro forever — it is a
 * failsafe, not a pace.
 */
const ARRIVAL_CEILING_MS = 45_000

/** Before this, a click is almost certainly the one that landed you here. */
const ARRIVAL_GUARD_MS = 900

/**
 * The arrival: a rule drawn across the table, and words appearing behind it.
 *
 * The one moment in the product that is purely atmosphere, and it earns the
 * exception. Signing up is a form; the intake is four questions; between those
 * two the student has had nothing but demands, and a screen that asks for
 * nothing is what makes the next one feel like a conversation rather than more
 * paperwork.
 *
 * The mechanism is a plotter, not a fade. A hairline draws outward from the
 * centre, and each line of text is revealed by a clip that opens from the
 * centre at the same rate — so the words read as being *drawn onto the table*
 * by the passing rule rather than fading in beside it. Drafting, in the app's
 * own idiom, and the reason it does not look like a generic splash.
 */
function Arrival() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 px-8"
      // The whole page is mid-arrival, so this is the only thing worth
      // announcing. Polite, not assertive: nothing here needs interrupting.
      role="status"
      aria-live="polite"
    >
      <p
        className="max-w-2xl text-center text-[clamp(24px,3.4vw,42px)] font-semibold leading-[1.15] text-ink"
        style={{ animation: 'wipeIn 1100ms 700ms var(--ease-sl) both' }}
      >
        Let's set the table.
      </p>

      {/* The rule. Drawn from the centre, and the text above is clipped open at
          the same rate — one gesture, two things revealed by it. */}
      <div
        aria-hidden
        className="h-px w-full max-w-md origin-center bg-[rgba(255,237,220,0.28)]"
        style={{ animation: 'ruleSweep 1000ms 300ms var(--ease-sl) both' }}
      />

      <p
        className="max-w-lg text-center text-[15px] leading-relaxed text-ink-3"
        style={{ animation: 'lineUp 900ms 1900ms var(--ease-sl) both' }}
      >
        Four questions about how you like to be taught. There are no wrong
        answers — you'll see what each one does as you pick it.
      </p>

      {/* The only instruction on screen, and it arrives last — after both
          lines have had time to be read rather than alongside them. It breathes
          so it stays findable without becoming the thing you look at. */}
      <span
        className="setcode"
        style={{ animation: 'lineUp 900ms 3200ms var(--ease-sl) both, breathe 3.4s 4100ms ease-in-out infinite' }}
      >
        Click anywhere when you're ready
      </span>
    </div>
  )
}

export function Onboarding() {
  const navigate = useNavigate()
  const { show, showError } = useToast()
  const { session } = useAuth()
  const reduced = useReducedMotion()
  const { play } = useHandoff()

  /**
   * The arrival sequence, before any question is asked.
   *
   * Four seconds of nothing being demanded. A student who has just signed up
   * has spent the last minute typing credentials into a form, and dropping
   * them straight onto question one makes the product feel like more of the
   * same admin — so the room gets a moment to be a room first, and the
   * questions arrive into a screen that already feels settled.
   *
   * Skipped instantly under reduced motion, and dismissible with any click or
   * key, because a beautiful thing you cannot get past stops being beautiful
   * the second time you see it.
   */
  const [arrived, setArrived] = useState(reduced)

  const [stepIndex, setStepIndex] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')
  const [saving, setSaving] = useState(false)
  const answers = useRef<Record<string, string>>({})
  /* Mirrors `answers.current` for rendering. The ref is what `finish` reads —
     it must not be a render behind — and this is what the preview reads. */
  const [chosen, setChosen] = useState<Record<string, string>>({})

  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1

  useEffect(() => {
    if (arrived) return
    const done = () => setArrived(true)

    // A short guard before input counts. Without it the click that submitted
    // the sign-up form — or the one that dismissed the handoff — arrives here
    // as the *first* event and skips the intro before it has drawn a frame.
    let armed = false
    const arm = window.setTimeout(() => {
      armed = true
    }, ARRIVAL_GUARD_MS)
    const onInput = () => {
      if (armed) done()
    }

    const ceiling = window.setTimeout(done, ARRIVAL_CEILING_MS)
    // Listening on the window rather than putting a button on screen: a "skip
    // intro" control would be the loudest thing in a composition whose whole
    // point is that nothing is being demanded yet.
    window.addEventListener('pointerdown', onInput)
    window.addEventListener('keydown', onInput)
    return () => {
      window.clearTimeout(arm)
      window.clearTimeout(ceiling)
      window.removeEventListener('pointerdown', onInput)
      window.removeEventListener('keydown', onInput)
    }
  }, [arrived])

  const finish = useCallback(
    async (collected: Record<string, string>) => {
      setSaving(true)
      try {
        const patch: Record<string, string | number> = {}
        if (collected.learning_style) patch.learning_style = collected.learning_style
        if (collected.session_length_minutes) {
          patch.session_length_minutes = Number(collected.session_length_minutes)
        }
        // Two steps write `teaching_preference` — the depth choice and the
        // free-text one. Joined rather than last-wins so a student who answers
        // both keeps both.
        const teaching = [collected.teaching_preference, collected.teaching_extra]
          .filter(Boolean)
          .join(' ')
        if (teaching) patch.teaching_preference = teaching

        if (Object.keys(patch).length > 0) await updateStudentModel(patch)
      } catch (err) {
        // A failed save must not trap someone on the intake forever — these are
        // preferences, all editable in Settings, none worth blocking first use.
        showError(err)
      } finally {
        // With the user id. Without it `markOnboarded` writes to a key that
        // `hasSkippedLocally` never reads, so skipping sent you straight back
        // to the screen you were trying to leave.
        markOnboarded(session?.user?.id ?? null)
        // The one moment this product gets to feel like an arrival. The
        // dashboard mounts and fetches underneath the curtain, so it is
        // finished and painted by the time it is uncovered.
        void play('desk', () => {
          navigate('/home', { replace: true })
        })
      }
    },
    [navigate, play, session, showError],
  )

  const commit = useCallback(
    (value: string, key?: string) => {
      const field = key ?? (step.freeform ? 'teaching_extra' : step.field)
      const next = { ...answers.current }
      if (value) next[field] = value
      answers.current = next
      setChosen(next)
      setPicked([])
      setFreeText('')
      if (isLast) void finish(next)
      else setStepIndex((i) => i + 1)
    },
    [step, isLast, finish],
  )

  const back = useCallback(() => {
    setPicked([])
    setStepIndex((i) => Math.max(0, i - 1))
  }, [])

  const skip = useCallback(() => {
    // Say where it went. Skipping is a legitimate choice, but leaving without
    // being told the questions still exist somewhere makes it look like a
    // one-time door you just closed — and these are the settings that decide
    // how every answer in the product is written.
    show('You can set these any time — Settings → How you learn.', 'info')
    void finish(answers.current)
  }, [finish, show])

  /* The sample, composed from what has been answered so far. */
  const sample = useMemo(
    () => composeSample(chosen.learning_style, chosen.teaching_preference),
    [chosen.learning_style, chosen.teaching_preference],
  )
  const shape = sessionShape(chosen.session_length_minutes)

  /** Single-select commits on tap; multi-select waits for Continue. */
  const canContinue = step.multi ? picked.length > 0 : true

  return (
    // `lg:cursor-none` scoped here, matching the landing page. First run is a
    // surface you are being *shown*, so it keeps the reticle; the app proper
    // does not, because a screen you work in needs the system cursor and every
    // affordance it carries.
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas lg:cursor-none">
      <DraftingCursor />
      <Backdrop reduced={reduced} lit={stepIndex} />

      {!arrived && <Arrival />}

      <header
        className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10"
        style={arrived && !reduced ? { animation: 'stepIn 700ms both var(--ease-sl)' } : undefined}
      >
        <Logo />
        <button
          type="button"
          onClick={skip}
          disabled={saving}
          className="rounded-full px-3 py-1.5 text-[13.5px] text-muted transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
        >
          Skip for now
        </button>
      </header>

      {/* Held back until the room has had its moment. Rendered rather than
          hidden so the layout is already resolved when it appears — a reflow
          on the first frame of the reveal would undo the whole effect. */}
      <main
        className={cn(
          'relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 items-center gap-10 px-6 pb-14',
          'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16 lg:px-10',
          !arrived && 'pointer-events-none',
        )}
        aria-hidden={!arrived}
        style={
          reduced
            ? undefined
            : arrived
              ? { animation: 'stepIn 820ms 120ms both var(--ease-sl)' }
              : { opacity: 0 }
        }
      >
        {/* ── The question ───────────────────────────────────────────── */}
        <section className="flex flex-col">
          <Progress index={stepIndex} total={STEPS.length} reduced={reduced} />

          {/* Keyed on the step so every question animates in as its own beat.
              This is the screen's one authored motion moment: the question and
              its choices arrive together, and nothing else on the page moves
              while you are reading them. */}
          <div
            key={step.id}
            style={
              reduced ? undefined : { animation: 'stepIn 520ms var(--ease-sl) both' }
            }
          >
            <h1 className="nameplate mt-7 text-[clamp(30px,3.6vw,50px)] leading-[1.02] text-ink">
              {step.ask}
            </h1>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-3">
              {step.aside}
            </p>

            <div className="mt-7">
              {step.freeform ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    commit(freeText.trim())
                  }}
                  className="flex flex-col gap-3"
                >
                  <textarea
                    autoFocus
                    rows={3}
                    /**
                     * Capped so the save cannot fail on length.
                     *
                     * `teaching_preference` allows 400 server-side and is
                     * written by *two* steps — the depth pick prefixes this
                     * text — so the room left here is 400 minus the longest
                     * depth value. Without the cap a student who typed a
                     * paragraph got a 422 that discarded the entire intake,
                     * including the three questions they had already answered.
                     * Stopping the input is kinder than validating it after
                     * the fact: there is nothing to correct if it cannot be
                     * over-typed in the first place.
                     */
                    maxLength={FREE_TEXT_MAX}
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        commit(freeText.trim())
                      }
                    }}
                    placeholder="e.g. use analogies, and don't skip the maths"
                    className="w-full resize-none rounded-[16px] border border-line bg-raised px-4 py-3.5 text-[15px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint focus:border-brand/60"
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-[14.5px] font-semibold text-[#1a120f] t-control duration-200 cursor-pointer hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
                    >
                      {saving ? 'Setting up…' : 'Finish'}
                      <Icon name="arrowRight" size={14} />
                    </button>
                    {!freeText.trim() && (
                      <span className="text-[13px] text-faint">
                        or leave it blank
                      </span>
                    )}
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex flex-col gap-2">
                    {step.options.map((o, i) => {
                      const on = picked.includes(o.label)
                      return (
                        <button
                          key={o.value}
                          type="button"
                          aria-pressed={step.multi ? on : undefined}
                          onClick={() =>
                            step.multi
                              ? setPicked((prev) =>
                                  prev.includes(o.label)
                                    ? prev.filter((l) => l !== o.label)
                                    : [...prev, o.label],
                                )
                              : commit(o.value)
                          }
                          style={reduced ? undefined : { animationDelay: `${120 + i * 55}ms` }}
                          className={cn(
                            'group flex items-center gap-3.5 rounded-[14px] border px-4 py-3 text-left',
                            'transition-[border-color,background-color,transform] duration-200',
                            'cursor-pointer active:scale-[0.995]',
                            !reduced && 'motion-safe:animate-[stepIn_420ms_var(--ease-sl)_both]',
                            on
                              ? 'border-brand/70 bg-brand-soft'
                              : 'border-line bg-raised/70 hover:border-brand/40 hover:bg-raised',
                          )}
                        >
                          {/* A mark, not a checkbox: it reads as a selection on
                              a sheet rather than as a form control. */}
                          <span
                            aria-hidden
                            className={cn(
                              'grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-colors',
                              on
                                ? 'border-brand bg-brand text-[#1a120f]'
                                : 'border-line text-transparent group-hover:border-brand/50',
                            )}
                          >
                            <Icon name="check" size={12} />
                          </span>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block text-[15.5px] font-semibold',
                                on ? 'text-brand-deep' : 'text-ink',
                              )}
                            >
                              {o.label}
                            </span>
                            <span className="mt-0.5 block text-[13px] leading-snug text-muted">
                              {o.hint}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {step.multi && (
                    <button
                      type="button"
                      onClick={() =>
                        commit(
                          step.options
                            .filter((o) => picked.includes(o.label))
                            // Joined into one sentence rather than stored as a
                            // list: every consumer interpolates this into a
                            // prompt, and a JSON array appearing mid-sentence
                            // would read as a bug to the model.
                            .map((o) => o.value)
                            .join('; '),
                        )
                      }
                      disabled={!canContinue}
                      className={cn(
                        'mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5',
                        'text-[14.5px] font-semibold t-control duration-200',
                        canContinue
                          ? 'bg-brand text-[#1a120f] cursor-pointer hover:brightness-110 active:scale-[0.98]'
                          : 'cursor-default bg-line-soft text-faint',
                      )}
                    >
                      {picked.length === 0 ? 'Pick what fits' : 'Continue'}
                      {picked.length > 0 && <Icon name="arrowRight" size={14} />}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {stepIndex > 0 && (
            <button
              type="button"
              onClick={back}
              className="mt-6 inline-flex w-fit items-center gap-1.5 text-[13px] text-muted transition-colors cursor-pointer hover:text-ink"
            >
              <Icon name="arrowLeft" size={12} /> Back
            </button>
          )}
        </section>

        {/* ── What the answers did ───────────────────────────────────── */}
        <Preview
          paragraphs={sample.paragraphs}
          shape={shape}
          reduced={reduced}
          answered={stepIndex}
        />
      </main>
    </div>
  )
}

/* ── Progress ─────────────────────────────────────────────────────────── */

/**
 * Four segments on a rule.
 *
 * Ruled stock rather than dots, because this is a measurement — how much is
 * left — and the app already says measurements sit on a rule. It exists to
 * answer "how long is this going to take" before the student has to wonder,
 * which is most of what makes a multi-step form feel like a chore.
 */
function Progress({
  index,
  total,
  reduced,
}: {
  index: number
  total: number
  reduced: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" role="presentation">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-[3px] flex-1 rounded-full',
              !reduced && 'transition-colors duration-500',
              i < index ? 'bg-brand/55' : i === index ? 'bg-brand' : 'bg-line',
            )}
          />
        ))}
      </div>
      <span className="setcode tabular-nums">
        {index + 1} / {total}
      </span>
    </div>
  )
}

/* ── Preview ──────────────────────────────────────────────────────────── */

/**
 * The sample answer, rewritten by whatever has been chosen.
 *
 * A Leaf, deliberately: this is a thing you *read*, and it is the one place on
 * this screen showing the product's actual output rather than its controls.
 * Labelled a sample and given a fixed question, so it illustrates behaviour
 * without implying the app has answered anything yet — nothing here may claim
 * usage that does not exist.
 */
function Preview({
  paragraphs,
  shape,
  reduced,
  answered,
}: {
  paragraphs: string[]
  shape: string | null
  reduced: boolean
  answered: number
}) {
  return (
    <aside className="lg:sticky lg:top-24">
      <div className="flex items-center gap-2 pb-3">
        <Icon name="sparkle" size={12} className="text-brand" />
        <span className="setcode">How answers will read</span>
      </div>

      <div className="leaf rounded-r-[14px] py-1 pr-5">
        <p className="text-[13px] font-semibold text-muted">{SAMPLE_QUESTION}</p>

        {/* Keyed on the composed text so a changed answer re-runs the fade.
            This is the payoff of the whole screen — the moment a choice stops
            being abstract — so it gets the motion, and the rest of the panel
            stays still. */}
        <div
          key={paragraphs.join('|')}
          className="mt-3 flex flex-col gap-3"
          style={reduced ? undefined : { animation: 'sampleIn 480ms var(--ease-sl) both' }}
        >
          {paragraphs.map((p, i) => (
            <p key={i} className="text-[14.5px] leading-[1.7] text-ink-2">
              {p}
            </p>
          ))}
        </div>

        {shape && (
          <p
            key={shape}
            className="mt-4 border-t border-line pt-3 text-[13px] leading-snug text-muted"
            style={reduced ? undefined : { animation: 'sampleIn 480ms var(--ease-sl) both' }}
          >
            {shape}
          </p>
        )}
      </div>

      <p className="mt-3 text-[12.5px] leading-snug text-faint">
        {answered === 0
          ? 'A sample, so you can see what each choice does.'
          : 'Every one of these is changeable later in Settings.'}
      </p>
    </aside>
  )
}

/* ── Backdrop ─────────────────────────────────────────────────────────── */

/**
 * A quiet study space, after hours.
 *
 * Built from four things and no more — a lamp, a table, dust, and the room
 * falling away. An earlier version had nine drifting card outlines under a
 * foil sweep, which was busy, pitched at "collection" when the moment is
 * *arrival*, and cost ten infinite transform animations to say it.
 *
 * `lit` rises with the step: the lamp warms very slightly as the student works
 * through, so finishing arrives somewhere brighter than it started. It is
 * meant to be felt rather than noticed.
 */
function Backdrop({ reduced, lit }: { reduced: boolean; lit: number }) {
  const warmth = LAMP_BASE_WARMTH + Math.min(lit, 3) * 0.018
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The lamp. One source, warm and high, pooling down the page — a desk
          lamp left on rather than the two-source stage lighting the landing
          page uses. Tungsten rather than brand orange: at this size the brand
          hue reads as an alert, and warm amber reads as a room. */}
      <div
        className="absolute inset-0 transition-[background] duration-[1200ms]"
        style={{
          background: lampGradient(warmth),
        }}
      />

      {/* The table. The product's own graticule, masked to the lit pool so it
          reads as ruling on a surface the lamp happens to fall on — not as
          wallpaper running out to the window frame. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: TABLE_IMAGE,
          backgroundSize: TABLE_SIZE,
          maskImage: TABLE_MASK,
          WebkitMaskImage: TABLE_MASK,
        }}
      />

      {/* Dust, turning in the light. Skipped entirely under reduced motion — a
          static dot field is just specks on the screen, so there is nothing
          worth keeping once the movement is gone. */}
      {!reduced &&
        MOTES.map((m) => (
          <div
            key={`${m.x}-${m.y}`}
            className="absolute rounded-full bg-[rgb(255,232,206)]"
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: m.s,
              height: m.s,
              opacity: m.o,
              filter: 'blur(0.4px)',
              animation: `mote ${m.dur}s ${m.d}s ease-in-out infinite`,
            }}
          />
        ))}

      {/* The room falling away. */}
      <div
        className="absolute inset-0"
        style={{
          background: VIGNETTE,
        }}
      />
    </div>
  )
}
