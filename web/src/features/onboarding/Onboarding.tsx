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

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateStudentModel } from '../../api/me'
import { Icon } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
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
}

const STEPS: Step[] = [
  {
    id: 'style',
    ask: "When something's new to you, what usually makes it click first?",
    field: 'learning_style',
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
  const reduced = useReducedMotion()

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
        markOnboarded()
        navigate('/home', { replace: true })
      }
    },
    [navigate, showError],
  )

  const answer = useCallback(
    (label: string, value: string) => {
      setTurns((prev) => [...prev, { role: 'me', text: label }])
      const key = step.freeform ? 'teaching_extra' : step.field
      if (value) answers.current[key] = value

      if (stepIndex === STEPS.length - 1) void finish(answers.current)
      else setStepIndex((i) => i + 1)
    },
    [step, stepIndex, finish],
  )

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
          className="text-[12.5px] text-muted transition-colors cursor-pointer hover:text-ink"
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
      <main className="relative z-10 mx-auto flex w-full max-w-xl flex-col px-5 pb-10 pt-2">
        <div className="pb-6">
          <h1 className="nameplate text-[clamp(26px,5vw,40px)] leading-[1.05] text-ink">
            Before we start
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
            Four quick questions so answers land the way you like them. You can
            change any of it later in Settings.
          </p>
        </div>

        <div
          ref={scroller}
          className="flex max-h-[44vh] flex-col gap-3 overflow-y-auto py-1"
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
                className="flex items-end gap-2 rounded-[20px] border border-line bg-raised px-3.5 py-2.5 focus-within:border-brand/50"
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
              <div className="flex flex-wrap gap-2">
                {step.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => answer(o.label, o.value)}
                    className={cn(
                      'rounded-full border border-line bg-raised px-3.5 py-2 text-[13px] text-ink-2',
                      'transition-all duration-200 cursor-pointer',
                      'hover:border-brand/50 hover:bg-brand-soft hover:text-brand-deep active:scale-[0.97]',
                    )}
                  >
                    {o.label}
                  </button>
                ))}
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
          'rounded-[16px] px-3.5 py-2.5 text-[13.5px] leading-relaxed',
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
const CARDS = [
  { x: 6, y: 12, w: 132, r: -14, o: 0.05, d: 0, dur: 44 },
  { x: 20, y: 62, w: 96, r: 9, o: 0.04, d: 6, dur: 52 },
  { x: 34, y: 24, w: 74, r: 22, o: 0.03, d: 12, dur: 38 },
  { x: 66, y: 16, w: 112, r: -8, o: 0.045, d: 3, dur: 48 },
  { x: 82, y: 54, w: 150, r: 13, o: 0.05, d: 9, dur: 56 },
  { x: 90, y: 20, w: 84, r: -20, o: 0.03, d: 15, dur: 42 },
  { x: 52, y: 78, w: 118, r: 6, o: 0.04, d: 2, dur: 50 },
  { x: 12, y: 86, w: 88, r: -11, o: 0.035, d: 18, dur: 46 },
  { x: 74, y: 88, w: 70, r: 17, o: 0.03, d: 11, dur: 40 },
]

function Backdrop() {
  const reduced = useReducedMotion()
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* The lamp. Warm from the top-left, a cool foil bounce bottom-right —
          the same two-source lighting the landing page uses, so first run
          belongs to the same world as the pitch. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(70rem 46rem at 12% -12%, rgba(255,90,60,0.18), transparent 62%),' +
            'radial-gradient(56rem 40rem at 98% 104%, rgba(53,214,232,0.12), transparent 64%)',
        }}
      />

      {/* The collection, not yet collected. */}
      {CARDS.map((c) => (
        <div
          key={`${c.x}-${c.y}`}
          className="absolute rounded-[14px] border border-[rgba(255,237,220,0.55)]"
          style={
            {
              left: `${c.x}%`,
              top: `${c.y}%`,
              width: c.w,
              // Trading-card proportions, so the silhouettes read as cards even
              // with no content in them.
              height: c.w * 1.4,
              opacity: c.o,
              // The rotation rides a custom property rather than `transform`,
              // because the keyframe animates `transform` and would otherwise
              // overwrite it — every card would snap square the moment the
              // animation started, which is the whole composition gone.
              '--r': `${c.r}deg`,
              transform: `rotate(${c.r}deg)`,
              background:
                'linear-gradient(150deg, rgba(255,237,220,0.10), transparent 55%)',
              animation: reduced
                ? undefined
                : `cardFloat ${c.dur}s ${c.d}s ease-in-out infinite`,
            } as CSSProperties
          }
        />
      ))}

      {/* Foil. One slow pass across the whole field — the sheen a real foil
          card throws when you tilt it, at the speed of a room rather than an
          animation. */}
      {!reduced && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(115deg, transparent 38%, rgba(255,237,220,0.045) 50%, transparent 62%)',
            backgroundSize: '250% 250%',
            animation: 'foilSweep 26s ease-in-out infinite',
          }}
        />
      )}

      {/* Vignette. The field is behind reading text, so the centre has to stay
          quieter than the edges or the type loses its ground. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(58rem 42rem at 50% 45%, rgba(30,24,21,0.86), rgba(30,24,21,0.35) 70%, transparent)',
        }}
      />
    </div>
  )
}
