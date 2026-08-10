/**
 * First run — a short conversation, not a form.
 *
 * A new account has nothing: no subjects, no cards, no history. Dropping
 * someone straight into a dashboard of zeroes teaches them the product is
 * empty, and a settings form of dropdowns teaches them it is admin. The one
 * thing the app genuinely needs before it can be useful is a sense of how this
 * person wants to be taught — and the natural way to collect that in a product
 * whose whole surface is a chat is to *ask*, in the same shape they'll be
 * using for everything else.
 *
 * **Nothing here is a model call.** The questions are fixed, the "typing" is a
 * timer, and the replies are chosen from what was tapped. Spending a real
 * generation on a scripted intake would be slow, cost quota, and risk the
 * model improvising a question we don't have a preference key for. It looks
 * like the chat because that is honest about where you are, not because
 * anything is being inferred.
 *
 * **It does not ask what you are studying for.** That was on the original list
 * and it is the one question to cut: it changes on a fortnightly cycle, it is
 * already a field in Settings, and asking it here would have someone type
 * "finals" on day one and be reminded of it in March. Preferences are stable;
 * goals are not.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateStudentModel } from '../../api/me'
import { Icon } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { useAuth } from '../../auth/AuthProvider'
import { cn } from '../../lib/cn'
import { useHandoff } from '../transitions/Handoff'
import { markOnboarded } from './state'

type Step = {
  id: string
  /** What the app says. */
  ask: string
  /** Tappable answers. The label is what the student sees and what is stored. */
  options: { label: string; value: string }[]
  /** Where the answer goes. */
  field: 'learning_style' | 'teaching_preference' | 'session_length_minutes'
  /** Free text instead of options. */
  freeform?: boolean
  /**
   * Several answers can be true at once.
   *
   * "What makes it click" is genuinely not one thing — an example *and* a
   * comparison is the honest answer for most people, and forcing a single
   * pick throws away half of what they would have told us. Single-select
   * stays the default because most questions really do have one answer, and
   * a multi-select that only ever takes one tap is a worse single-select.
   */
  multi?: boolean
}

const STEPS: Step[] = [
  {
    id: 'style',
    ask: "When something's new to you, what makes it click? Pick as many as fit.",
    field: 'learning_style',
    multi: true,
    options: [
      { label: 'A concrete example', value: 'examples first, then the general rule' },
      { label: 'The idea behind it', value: 'the intuition first, then the detail' },
      { label: 'The formal definition', value: 'the precise definition first, then examples' },
      { label: 'Seeing it compared', value: 'comparisons against things I already know' },
    ],
  },
  {
    id: 'depth',
    ask: 'And how much do you want at once?',
    field: 'teaching_preference',
    options: [
      { label: 'Keep it short', value: 'Keep explanations short and direct.' },
      { label: 'Go deep', value: 'Go into real depth; I would rather have too much than too little.' },
      { label: 'Depends — read the room', value: 'Match the depth to the question rather than a fixed length.' },
    ],
  },
  {
    id: 'session',
    ask: 'Roughly how long is one of your study sessions?',
    field: 'session_length_minutes',
    options: [
      { label: '15 minutes', value: '15' },
      { label: '30 minutes', value: '30' },
      { label: 'An hour', value: '60' },
      { label: 'Longer', value: '120' },
    ],
  },
  {
    id: 'anything',
    ask: 'Anything else about how you like to be taught? Skip it if nothing comes to mind.',
    field: 'teaching_preference',
    freeform: true,
    options: [],
  },
]

type Turn = { role: 'app' | 'me'; text: string }

export function Onboarding() {
  const navigate = useNavigate()
  const { showError } = useToast()
  const { session } = useAuth()
  const reduced = useReducedMotion()
  const { play } = useHandoff()

  const [stepIndex, setStepIndex] = useState(0)
  const [turns, setTurns] = useState<Turn[]>([])
  const [typing, setTyping] = useState(true)
  const [freeText, setFreeText] = useState('')
  const [saving, setSaving] = useState(false)
  const answers = useRef<Record<string, string>>({})
  const scroller = useRef<HTMLDivElement>(null)
  const step = STEPS[stepIndex]

  // The "typing" pause. Long enough that the question feels considered, short
  // enough that four of them don't become a wait — and skipped entirely under
  // reduced motion, where a simulated delay is just a delay.
  useEffect(() => {
    if (stepIndex >= STEPS.length) return
    setTyping(true)
    const delay = reduced ? 0 : 620
    const id = window.setTimeout(() => {
      setTurns((prev) => [...prev, { role: 'app', text: STEPS[stepIndex].ask }])
      setTyping(false)
    }, delay)
    return () => window.clearTimeout(id)
  }, [stepIndex, reduced])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns, typing])

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
        // free-text one. Joined rather than last-wins so a student who says
        // both keeps both.
        const teaching = [collected.teaching_preference, collected.teaching_extra]
          .filter(Boolean)
          .join(' ')
        if (teaching) patch.teaching_preference = teaching

        if (Object.keys(patch).length > 0) await updateStudentModel(patch)
      } catch (err) {
        // A failed save must not trap someone on the intake screen forever —
        // these are preferences, all of them editable in Settings, and none
        // worth blocking first use over.
        showError(err)
      } finally {
        /**
         * With the user id — without it, Skip did nothing at all.
         *
         * `markOnboarded()` falls back to an un-suffixed key, but
         * `hasSkippedLocally` only ever reads the per-user one. So skipping
         * wrote a flag nothing reads: the gate re-checked the server, found no
         * preferences (because you skipped), and sent you straight back to the
         * intake. "Skip for now" was a button that reloaded the screen it was
         * trying to leave.
         */
        markOnboarded(session?.user?.id ?? null)
        // The one moment this product gets to feel like an arrival. The
        // dashboard mounts and fetches underneath the curtain, so it is
        // finished and painted by the time it is uncovered — the transition
        // is the loading state, not an animation played next to one.
        void play('desk', () => {
          navigate('/home', { replace: true })
        })
      }
    },
    [navigate, play, session, showError],
  )

  /* Selections for the current multi-select question. Keyed by option label
     so re-tapping toggles rather than duplicating. Cleared on every step. */
  const [picked, setPicked] = useState<string[]>([])

  const answer = useCallback(
    (label: string, value: string) => {
      setPicked([])
      setTurns((prev) => [...prev, { role: 'me', text: label }])
      const key = step.freeform ? 'teaching_extra' : step.field
      if (value) answers.current[key] = value

      if (stepIndex === STEPS.length - 1) void finish(answers.current)
      else setStepIndex((i) => i + 1)
    },
    [step, stepIndex, finish],
  )

  /** Commit a multi-select: one turn, one joined preference. */
  const commitMulti = useCallback(() => {
    if (picked.length === 0) return
    const chosen = step.options.filter((o) => picked.includes(o.label))
    answer(
      chosen.map((o) => o.label).join(', '),
      // Joined into one sentence rather than stored as a list: every consumer
      // of `learning_style` interpolates it into a prompt, and a JSON array
      // appearing mid-sentence there would read as a bug to the model.
      chosen.map((o) => o.value).join('; '),
    )
  }, [picked, step, answer])

  const skip = useCallback(() => {
    void finish(answers.current)
  }, [finish])

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas">
      <Backdrop />

      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <Logo />
        <button
          type="button"
          onClick={skip}
          disabled={saving}
          className="text-[13.5px] text-muted transition-colors cursor-pointer hover:text-ink"
        >
          Skip for now
        </button>
      </header>

      {/* Top-aligned, and sized to its content.
          Two things were wrong before. `flex-1` on the transcript pushed the
          answer chips to the bottom edge of the viewport, so the last question
          sat up by the heading with several hundred pixels of nothing between
          it and the buttons that answered it — the two halves of one exchange,
          as far apart as the layout could put them. Centring the block fixed
          the gap but floated everything in the middle of the screen, which is
          the same complaint in a different direction.
          So: it starts at the top and grows downward, the transcript sizes to
          its content and scrolls past a cap, and the chips sit directly under
          the question where the eye already is. The empty lower half is not a
          problem to solve with layout — it is the room, and the card field
          behind it is what fills it. */}
      {/* Centred in the viewport and set large.
          This was `max-w-xl` pinned to the top of the page: on a 2000px
          display it put a 576px column of 13px type in the upper-left eighth
          of the screen and left the rest black. A previous comment here
          argued the empty lower half "is the room" — that was a rationalisation
          of a layout problem, and the screenshot settles it. A first screen
          with four short questions on it has no reason to hug the top edge.
          `justify-center` on a `flex-1` main puts the block on the optical
          centre, and the type scale below is sized for the screen it is
          actually shown on rather than for a phone that has been stretched. */}
      <main className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 pb-12">
        {/* The arrival, settling in three beats: the heading, the line under
            it, then a rule drawn across. Slow and staggered rather than
            snappy — this screen is meant to feel like sitting down, and a
            fast entrance would undo what the backdrop is doing. */}
        <div className="pb-7">
          <h1
            className="nameplate text-[clamp(38px,6vw,72px)] leading-[0.98] text-ink"
            style={
              reduced ? undefined : { animation: 'settleIn 720ms 60ms var(--ease-sl) both' }
            }
          >
            Before we start
          </h1>
          <p
            className="mt-3 max-w-lg text-[clamp(15px,1.35vw,18px)] leading-relaxed text-ink-3"
            style={
              reduced ? undefined : { animation: 'settleIn 720ms 220ms var(--ease-sl) both' }
            }
          >
            Four quick questions so answers land the way you like them. You can
            change any of it later in Settings.
          </p>
          <div
            aria-hidden
            className="mt-6 h-px w-full origin-left bg-line"
            style={
              reduced ? undefined : { animation: 'ruleSweep 820ms 380ms var(--ease-sl) both' }
            }
          />
        </div>

        <div
          ref={scroller}
          className="flex max-h-[38vh] flex-col gap-3.5 overflow-y-auto py-1"
        >
          {turns.map((t, i) => (
            <Bubble key={i} role={t.role} text={t.text} reduced={reduced} />
          ))}
          {typing && <Typing />}
        </div>

        {!typing && stepIndex < STEPS.length && (
          <div className="shrink-0 pt-4">
            {step.freeform ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const text = freeText.trim()
                  answer(text || 'Nothing in particular', text)
                }}
                className="flex items-end gap-2 rounded-[22px] border border-line bg-raised px-4 py-3 focus-within:border-brand/50"
              >
                <input
                  autoFocus
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="e.g. use analogies, and don't skip the maths"
                  className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
                />
                <button
                  type="submit"
                  disabled={saving}
                  aria-label="Send"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-[#1a120f] transition-transform cursor-pointer hover:brightness-110 active:scale-95"
                >
                  <Icon name="arrowRight" size={15} />
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {step.options.map((o, i) => {
                    const on = picked.includes(o.label)
                    return (
                      <button
                        key={o.value}
                        type="button"
                        // On a multi-select the chip is a toggle, so it carries
                        // pressed state; on a single-select it commits and the
                        // step advances, so there is no state to carry.
                        aria-pressed={step.multi ? on : undefined}
                        onClick={() =>
                          step.multi
                            ? setPicked((prev) =>
                                prev.includes(o.label)
                                  ? prev.filter((l) => l !== o.label)
                                  : [...prev, o.label],
                              )
                            : answer(o.label, o.value)
                        }
                        style={
                          reduced ? undefined : { animationDelay: `${i * 45}ms` }
                        }
                        className={cn(
                          'rounded-full border px-4 py-2.5 text-[14.5px]',
                          'transition-all duration-200 cursor-pointer active:scale-[0.97]',
                          !reduced &&
                            'motion-safe:animate-[chipIn_320ms_cubic-bezier(0.22,1,0.36,1)_both]',
                          on
                            ? 'border-brand bg-brand-soft font-semibold text-brand-deep'
                            : 'border-line bg-raised text-ink-2 hover:border-brand/50 hover:bg-brand-soft hover:text-brand-deep',
                        )}
                      >
                        {step.multi && (
                          <Icon
                            name={on ? 'check' : 'plus'}
                            size={11}
                            className="mr-1.5 -mt-px inline-block"
                          />
                        )}
                        {o.label}
                      </button>
                    )
                  })}
                </div>

                {/* Multi-select needs an explicit commit — with no "done" the
                    only way to move on would be a chip tap, which is the same
                    gesture as choosing, and nothing would ever be multiple.
                    Disabled until something is picked so the button never
                    promises a step it won't take. */}
                {step.multi && (
                  <button
                    type="button"
                    onClick={commitMulti}
                    disabled={picked.length === 0}
                    className={cn(
                      'self-start rounded-full px-5 py-2.5 text-[14.5px] font-semibold',
                      'transition-all duration-200',
                      picked.length > 0
                        ? 'bg-brand text-[#1a120f] cursor-pointer hover:brightness-110 active:scale-[0.97]'
                        : 'cursor-default bg-line-soft text-faint',
                    )}
                  >
                    {picked.length === 0
                      ? 'Pick what fits'
                      : `Continue with ${picked.length}`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {saving && (
          <p className="shrink-0 pt-3 text-center text-[12.5px] text-muted">Setting things up…</p>
        )}
      </main>
    </div>
  )
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

function Bubble({ role, text, reduced }: { role: 'app' | 'me'; text: string; reduced: boolean }) {
  const mine = role === 'me'
  return (
    <div
      className={cn(
        'max-w-[85%]',
        mine ? 'self-end' : 'self-start',
        !reduced && 'motion-safe:animate-[bubbleIn_320ms_cubic-bezier(0.22,1,0.36,1)]',
      )}
    >
      <div
        className={cn(
          'rounded-[18px] px-4 py-3 text-[15px] leading-relaxed',
          mine
            ? 'rounded-br-[4px] bg-brand text-[#1a120f]'
            : 'rounded-bl-[4px] border border-line bg-raised text-ink',
        )}
      >
        {text}
      </div>
    </div>
  )
}

function Typing() {
  return (
    <div className="flex h-8 items-center gap-1.5 self-start rounded-[16px] rounded-bl-[4px] border border-line bg-raised px-3.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-brand"
          style={{ animation: `thinkPulse 1.15s ${i * 0.16}s ease-in-out infinite` }}
        />
      ))}
    </div>
  )
}

/**
 * An empty binder, waiting.
 *
 * The first version was two flat radial washes, which is what a blank page
 * looks like when you have added a gradient to it. This is a first impression
 * and it should say what the product is: the visual atom here is a card, a new
 * account is an empty collection, so the room is a field of card silhouettes
 * with the lamp already on over it. It reads as somewhere the student is about
 * to fill rather than as a form they have to get through.
 *
 * **Still cheap on purpose.** First run is the slowest moment in the app — a
 * cold Render instance, the first API call in flight — and it is exactly where
 * a canvas loop turns a first impression into a stutter. Everything here is
 * declarative CSS: transforms and opacity only, so it runs on the compositor,
 * with no rAF, no state, and no work on the main thread. Under reduced motion
 * the whole field holds still and only the lamp remains.
 */

/** Deterministic so the composition is designed rather than rolled per load. */
/**
 * Dust in the lamplight.
 *
 * The one moving thing on this screen, and the whole reason it reads as a
 * *room* rather than a gradient: still air with motes turning slowly through
 * a beam is the visual signature of a quiet space nobody has walked through
 * in a while. Durations are 30–60s — slow enough that you never catch one
 * moving, you only notice the field has changed when you look back.
 *
 * Nine of them, none larger than 3px. It is texture, not an animation.
 */
const MOTES = [
  { x: 22, y: 34, s: 2.5, o: 0.30, d: 0, dur: 52 },
  { x: 31, y: 58, s: 1.5, o: 0.20, d: 7, dur: 44 },
  { x: 44, y: 26, s: 2, o: 0.26, d: 3, dur: 60 },
  { x: 52, y: 47, s: 1.5, o: 0.16, d: 12, dur: 38 },
  { x: 39, y: 71, s: 3, o: 0.22, d: 5, dur: 56 },
  { x: 60, y: 63, s: 1.5, o: 0.18, d: 16, dur: 47 },
  { x: 68, y: 38, s: 2, o: 0.24, d: 9, dur: 41 },
  { x: 27, y: 18, s: 1.5, o: 0.14, d: 20, dur: 58 },
  { x: 57, y: 15, s: 2, o: 0.20, d: 14, dur: 50 },
]

/**
 * A quiet study space, after hours.
 *
 * This was a field of nine drifting card outlines under a foil sweep — busy,
 * and pitched at "collection" when the moment is meant to be *arrival*. The
 * brief here is the opposite of spectacle: someone is stepping into a room
 * where the lamp is already on and nothing is happening yet.
 *
 * So it is built from four things and no more — a lamp, a table, dust, and
 * the room falling away — which is also why it costs almost nothing to run:
 * ten infinite transform animations became nine 2px dots.
 */
function Backdrop() {
  const reduced = useReducedMotion()
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The lamp. One source, warm and high, pooling down the page — a desk
          lamp left on rather than the two-source stage lighting the landing
          page uses. Tungsten rather than brand orange: at this size the brand
          hue reads as an alert, and warm amber reads as a room. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80rem 52rem at 50% -18%, rgba(255,176,116,0.13), transparent 66%),' +
            'radial-gradient(44rem 34rem at 50% 8%, rgba(255,214,170,0.07), transparent 60%)',
        }}
      />

      {/* The table. The product's own graticule, masked to the lit pool so it
          reads as ruling on a surface the lamp happens to be falling on —
          not as wallpaper running out to the window frame. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(245,237,228,0.032) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(245,237,228,0.032) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          maskImage: 'radial-gradient(78% 62% at 50% 26%, #000 22%, transparent 92%)',
          WebkitMaskImage:
            'radial-gradient(78% 62% at 50% 26%, #000 22%, transparent 92%)',
        }}
      />

      {/* Dust, turning in the light. Skipped entirely under reduced motion —
          a static dot field is just specks on the screen, so there is nothing
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

      {/* The room falling away. One vignette, not the two that were stacked
          here before — they were compounding to near-black at the corners and
          flattening the lamp into a spotlight. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 100% at 50% 30%, transparent 32%, rgba(18,14,12,0.55) 78%, rgba(14,11,9,0.82) 100%)',
        }}
      />
    </div>
  )
}
