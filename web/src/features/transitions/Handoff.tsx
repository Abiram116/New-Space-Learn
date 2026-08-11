/**
 * The handoffs between the three first-run screens.
 *
 * Signing up and finishing onboarding were both a bare
 * `navigate(..., { replace: true })` — an instant swap between two full-screen
 * layouts with different backgrounds, which is the one moment in the product
 * where a student is most likely to be deciding whether it feels finished.
 *
 * **Why this is a provider and not an animation inside a page.** The obvious
 * build is to animate inside `Onboarding`, then navigate at the end. That
 * cannot work: the moment you navigate, the page unmounts and takes its
 * animation with it, so the sequence ends on precisely the hard cut it exists
 * to hide. The overlay has to outlive the route change, which means living
 * above the router. Everything else here follows from that.
 *
 * **The transition is doing real work, not just filling time.** Under the
 * cover, the destination mounts and makes its first requests. That is the
 * argument for a transition that lasts a beat rather than a 150ms crossfade:
 * it is not decoration bolted onto a wait, it *is* the wait, made
 * deliberate — and it is why the dashboard is already painted and settled by
 * the time it is uncovered instead of assembling itself in front of you.
 *
 * Under `prefers-reduced-motion` the whole thing collapses to a short fade.
 * The work still happens; only the choreography goes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useReducedMotion } from '../../components/ui/motion'
import { lampGradient, MOTES, TABLE_IMAGE, TABLE_MASK, TABLE_SIZE, VIGNETTE } from '../../lib/room'

/**
 * `desk` — finishing onboarding. The payoff moment, so it is the long one:
 * the lamp comes up, the table rules itself in, and three sheets are laid
 * out. `threshold` — signing up. A doorway, deliberately brief, because
 * nothing has been earned yet and a fanfare here would be the product
 * congratulating itself for a form submit.
 */
export type HandoffVariant = 'desk' | 'threshold'

type Phase = 'in' | 'out'

/**
 * How long the choreography runs before the destination is uncovered.
 *
 * `threshold` was 950ms, on the reasoning that a sign-in should get out of the
 * way. That was wrong about what this moment is: it is the door into the
 * product, it happens while the session is being established and the next
 * route's chunk is downloading, and rushing it produced a transition nobody
 * registered as having happened. Both are unhurried now — the time is the
 * experience, and it is covering real work either way.
 */
// Both are sized so the choreography *finishes* before the uncover. `desk`:
// the frame lands at ~1250ms, opens out by ~2750ms, and the closing line
// settles at ~3080ms. `threshold`: the last pulse clears at ~2000ms. Cutting
// either short was the specific complaint that the transition did not complete
// before the page arrived.
const IN_MS: Record<HandoffVariant, number> = { desk: 3250, threshold: 2100 }
/** The uncover. Slower than the cover — leaving should feel like a reveal. */
const OUT_MS: Record<HandoffVariant, number> = { desk: 620, threshold: 560 }

/**
 * How long the curtain takes to become fully opaque, and how long to wait
 * after that before swapping the page underneath it.
 *
 * These two constants are why the destination used to flicker into view
 * mid-transition. The cover animation ran for 260ms and the route change fired
 * at `wait(260)` — the same number written twice, in two files' worth of
 * distance from each other, with **zero margin between them**. The navigation
 * landed on the exact frame the curtain first reached full opacity, so any
 * jitter at all (a long frame, React committing a beat late, the animation
 * starting one frame after the timer) swapped the page while the curtain was
 * still translucent, and you watched the dashboard appear *through* it.
 *
 * Now the fade owns `COVER_MS`, the sequencer waits `COVER_MS + COVER_SETTLE`,
 * and the margin is stated rather than assumed.
 */
const COVER_MS = 420
const COVER_SETTLE_MS = 110
/** Reduced motion: enough to hide the swap, not enough to be a sequence. */
const REDUCED_IN_MS = 220
const REDUCED_OUT_MS = 200

/**
 * A ceiling on the covered work.
 *
 * `run` is awaited under the overlay, so a hung request would otherwise mean
 * a permanent full-screen curtain with the app running fine underneath it.
 * Failing to a visible app beats failing to a beautiful hostage screen — the
 * same rule the boot splash follows.
 */
const WORK_CEILING_MS = 6000

type HandoffApi = {
  /**
   * Cover the screen, run `work` underneath, then uncover.
   *
   * Resolves once the overlay is fully gone, so a caller can await it and
   * know the handoff is finished rather than guessing with a timer.
   */
  play: (variant: HandoffVariant, work: () => void | Promise<void>) => Promise<void>
  /** True from the first frame of the cover to the last frame of the uncover. */
  playing: boolean
  /**
   * True once the destination should start its own entrance — either no
   * handoff is running, or the curtain has begun lifting.
   */
  revealing: boolean
}

const Ctx = createContext<HandoffApi | null>(null)

export function useHandoff(): HandoffApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useHandoff must be used inside <HandoffProvider>')
  return ctx
}

/**
 * Is a handoff currently driving navigation?
 *
 * Read by the auth guards, which otherwise race it. `RedirectIfAuthed` sends
 * any authenticated visitor to `/home`, and signing up authenticates you — so
 * the guard fired the moment the session landed and bounced the student to the
 * dashboard while the handoff was still on its way to the intake. Both
 * "worked"; they just disagreed, and the loser was whichever lost the race
 * that render.
 *
 * A handoff states where it is going, so while one is playing it owns
 * navigation and the guard stands down. Deliberately non-throwing, unlike
 * `useHandoff`: a guard must still render in a tree without the provider.
 */
export function useHandoffPlaying(): boolean {
  return useContext(Ctx)?.playing ?? false
}

/**
 * Should this screen play its entrance yet?
 *
 * The destination mounts *under* the curtain — that is the point, it is how the
 * page is finished and painted before anyone sees it. But it also meant every
 * entrance animation on that page ran and completed during the hold, so by the
 * time the curtain lifted the dashboard was already sitting there, static. The
 * first-run introduction has a nine-beat sequence nobody ever saw.
 *
 * So a covered screen waits. This flips true the moment the curtain starts
 * lifting, and the entrance plays *through* the uncover — the content arriving
 * as the cover leaves, which is the thing that reads as one continuous move
 * rather than two events that happened to be adjacent.
 *
 * Non-throwing: returns true with no provider, so a screen rendered outside a
 * handoff animates immediately and nothing has to know whether it is covered.
 */
export function useHandoffReveal(): boolean {
  return useContext(Ctx)?.revealing ?? true
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/**
 * Resolve once the browser has actually painted.
 *
 * A single frame is not enough: the first callback fires *before* the commit
 * that follows it has been painted, so uncovering there shows the destination
 * mid-assembly. Two frames means at least one full paint has landed.
 */
const painted = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  )

/**
 * The sequencing contract, separated from React so it can be tested directly.
 *
 * Everything that can go wrong with this transition is a timing question —
 * does the work really run while covered, does the cover really outlive the
 * work, does a hung request really let go — and none of those are answerable
 * by looking at a rendered overlay. Kept pure and exported so the tests can
 * assert the order of events instead of the pixels.
 */
export async function runHandoffSequence({
  inMs,
  outMs,
  coverMs = COVER_MS,
  ceilingMs = WORK_CEILING_MS,
  work,
  onPhase,
}: {
  inMs: number
  outMs: number
  /** Must match the curtain's fade-in, or the swap shows through it. */
  coverMs?: number
  ceilingMs?: number
  work: () => void | Promise<void>
  onPhase: (phase: Phase | null) => void
}): Promise<void> {
  try {
    onPhase('in')
    // Do not touch the page until the curtain is provably opaque. The margin
    // on top of the fade is the whole fix for the destination flickering into
    // view mid-transition — see COVER_MS.
    await wait(Math.min(coverMs + COVER_SETTLE_MS, inMs))

    const started = Date.now()
    try {
      await Promise.race([Promise.resolve(work()), wait(ceilingMs)])
    } catch {
      // A failed handoff is still a handoff: the caller owns its own error
      // reporting, and stranding the student behind the curtain because a
      // preference save 500'd would be the worse failure.
    }
    // Hold out the rest of the choreography, then wait for a real paint so the
    // reveal lands on a finished screen rather than a half-built one.
    await wait(Math.max(0, inMs - (Date.now() - started)))
    await painted()

    onPhase('out')
    await wait(outMs)
  } finally {
    onPhase(null)
  }
}

export function HandoffProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const [state, setState] = useState<{ variant: HandoffVariant; phase: Phase } | null>(
    null,
  )
  // Guards against a second `play` landing mid-sequence — a double-submit on
  // the finish button would otherwise restart the choreography on top of
  // itself and navigate twice.
  const busy = useRef(false)

  const play = useCallback(
    async (variant: HandoffVariant, work: () => void | Promise<void>) => {
      if (busy.current) return
      busy.current = true
      try {
        await runHandoffSequence({
          inMs: reduced ? REDUCED_IN_MS : IN_MS[variant],
          outMs: reduced ? REDUCED_OUT_MS : OUT_MS[variant],
          work,
          onPhase: (phase) => setState(phase ? { variant, phase } : null),
        })
      } finally {
        busy.current = false
      }
    },
    [reduced],
  )

  const api = useMemo(
    () => ({
      play,
      playing: state !== null,
      revealing: state === null || state.phase === 'out',
    }),
    [play, state],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      {state && <Curtain variant={state.variant} phase={state.phase} reduced={reduced} />}
    </Ctx.Provider>
  )
}

/* ── The curtain ─────────────────────────────────────────────────────── */


function Curtain({
  variant,
  phase,
  reduced,
}: {
  variant: HandoffVariant
  phase: Phase
  reduced: boolean
}) {
  return (
    <div
      // Announced rather than silent: a full-screen cover with no accessible
      // name is a screen reader dead end. `alert` would interrupt; `status` is
      // the polite register this deserves.
      role="status"
      aria-live="polite"
      aria-label={variant === 'desk' ? 'Setting up your desk' : 'Opening Space Learn'}
      className="fixed inset-0 z-[100] overflow-hidden bg-canvas"
      style={{
        // The cover duration is COVER_MS, the same constant the sequencer waits
        // on. Writing the number here independently is what let the two drift
        // into a zero-margin race in the first place.
        animation: `${phase === 'in' ? 'curtainIn' : 'curtainOut'} ${
          phase === 'in'
            ? reduced
              ? REDUCED_IN_MS
              : COVER_MS
            : reduced
              ? REDUCED_OUT_MS
              : OUT_MS[variant]
        }ms var(--ease-sl) both`,
      }}
    >
      {variant === 'desk' ? (
        <DeskScene reduced={reduced} />
      ) : (
        <ThresholdScene reduced={reduced} />
      )}
    </div>
  )
}


/* ── Threshold: the room is found, ring by ring ──────────────────────── */

/**
 * Signing in. A pulse goes out and the room comes back with it.
 *
 * The previous version was a lamp fading up under a line of text, and text was
 * the wrong instrument entirely — a caption explaining a moment that should
 * have been carried by the moment. This is motion doing the work: a point of
 * light at the top of the frame, then rings travelling outward from it, and the
 * table becoming visible in their wake. Sonar, essentially — the shape of
 * *finding* a space rather than being told about one.
 *
 * **It ends on the frame the destination starts on.** The rings are transient;
 * what remains when they have passed is the onboarding backdrop exactly — same
 * lamp, same graticule, same mask, same dust, all from `lib/room`. So the
 * curtain lifting is a continuity cut onto an identical picture rather than a
 * crossfade between two similar ones.
 */
function ThresholdScene({ reduced }: { reduced: boolean }) {
  return (
    <>
      {/* The lamp, blooming from its source rather than fading up as a wash —
          a lamp has a position, and the eye needs it for the room to have a
          shape. */}
      <div
        className="absolute inset-0"
        style={{
          background: lampGradient(),
          transformOrigin: '50% 0%',
          animation: reduced ? undefined : 'lampClick 1250ms var(--ease-out-expo) both',
        }}
      />

      {/* The pulse. Three rings leaving the lamp's position, each one wider and
          fainter than the last, so the room reads as being *found* outward from
          a source rather than switched on all at once. */}
      {!reduced && (
        <div className="pointer-events-none absolute inset-x-0 top-0 grid h-0 place-items-center">
          {[0, 260, 540].map((d, i) => (
            <span
              key={d}
              className="absolute rounded-full border"
              style={{
                width: '34rem',
                height: '34rem',
                marginTop: '-17rem',
                borderColor: `rgba(255,196,140,${0.3 - i * 0.07})`,
                animation: `pulseOut ${1900 + i * 160}ms ${180 + d}ms var(--ease-out-expo) both`,
              }}
            />
          ))}
        </div>
      )}

      {/* The table, found by the pulse. Shares the lamp's origin so the ruling
          appears to be revealed by the light spreading across it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: TABLE_IMAGE,
          backgroundSize: TABLE_SIZE,
          maskImage: TABLE_MASK,
          WebkitMaskImage: TABLE_MASK,
          transformOrigin: '50% 20%',
          animation: reduced ? undefined : 'roomIn 1500ms 320ms var(--ease-out-expo) both',
        }}
      />

      {/* Dust, arriving last — you only see it once there is enough light to
          catch it, which is also the moment the room stops being empty. */}
      {!reduced && (
        <div
          className="absolute inset-0"
          style={{ animation: 'dustIn 1000ms 900ms var(--ease-sl) both' }}
        >
          {MOTES.map((m) => (
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
        </div>
      )}

      <div
        className="absolute inset-0"
        style={{ background: VIGNETTE }}
      />
    </>
  )
}

/* ── Desk: four answers, one workspace ───────────────────────────────── */

/** The four sides of the frame, and the edge each one flies in from. */
const SIDES = [
  { key: 't', cls: 'left-0 top-0 h-px w-full origin-left', from: 'translate3d(0,-42vh,0)' },
  { key: 'b', cls: 'bottom-0 left-0 h-px w-full origin-right', from: 'translate3d(0,42vh,0)' },
  { key: 'l', cls: 'left-0 top-0 h-full w-px origin-top', from: 'translate3d(-42vw,0,0)' },
  { key: 'r', cls: 'right-0 top-0 h-full w-px origin-bottom', from: 'translate3d(42vw,0,0)' },
]

/**
 * Finishing the intake. Four answers close into one workspace.
 *
 * Two attempts preceded this and both were wrong in instructive ways. Card
 * outlines falling onto a table were generic — floating rectangles that could
 * have come from any template. Drafting the dashboard's plan was closer in
 * spirit but read as a *chart*: a row of gold bars and some rules, which says
 * "here is a graph" rather than "here is your desk".
 *
 * So it is built from what actually just happened. The student answered four
 * questions; four strokes converge from the four edges, close into a frame,
 * and that frame opens out to become the workspace. It is the shape of things
 * being *settled* — and it uses the opposite motion to the threshold scene by
 * design: that one travels outward from a point to find a room, this one
 * travels inward to four edges to build one.
 */
function DeskScene({ reduced }: { reduced: boolean }) {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80rem 52rem at 50% -16%, rgba(255,176,116,0.20), transparent 66%),' +
            'radial-gradient(40rem 30rem at 50% 6%, rgba(255,214,170,0.10), transparent 62%)',
          animation: reduced ? undefined : 'lampUp 1100ms var(--ease-sl) both',
        }}
      />

      <div
        className="absolute inset-0"
        style={{
          backgroundImage: TABLE_IMAGE,
          backgroundSize: TABLE_SIZE,
          maskImage: 'radial-gradient(70% 58% at 50% 46%, #000 20%, transparent 92%)',
          WebkitMaskImage: 'radial-gradient(70% 58% at 50% 46%, #000 20%, transparent 92%)',
          animation: reduced ? undefined : 'tableIn 1400ms 200ms var(--ease-sl) both',
        }}
      />

      {!reduced && (
        <div className="absolute inset-0 grid place-items-center">
          {/* The frame. Each side arrives from its own edge and lands; then the
              whole thing opens outward past the viewport, which is what turns
              "four lines met" into "the space is yours". */}
          <div
            className="relative h-[42vmin] w-[62vmin]"
            style={{ animation: 'frameOpen 1500ms 1250ms var(--ease-out-expo) both' }}
          >
            {SIDES.map((s, i) => (
              <span
                key={s.key}
                className={`absolute bg-[rgba(255,237,220,0.55)] ${s.cls}`}
                style={{
                  ['--from' as string]: s.from,
                  animation: `sideIn 900ms ${240 + i * 110}ms var(--ease-out-expo) both`,
                }}
              />
            ))}
            {/* The surface inside it, warming as the frame closes. */}
            <span
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(150deg, rgba(255,237,220,0.07), rgba(255,237,220,0.015) 60%)',
                animation: 'surfaceIn 900ms 900ms var(--ease-sl) both',
              }}
            />
          </div>
        </div>
      )}

      {/* The rule, then the line. The sweeping hairline is the product's
          signature beat — it is on the boot splash too, so finishing the intake
          rhymes with every launch after it. */}
      <div className="absolute inset-x-0 bottom-[16%] flex flex-col items-center gap-3.5 px-6">
        <div
          className="h-px w-full max-w-xs bg-[rgba(255,237,220,0.22)]"
          style={{
            transformOrigin: 'center',
            animation: reduced ? undefined : 'ruleSweep 820ms 2180ms var(--ease-sl) both',
          }}
        />
        <p
          className="text-center text-[13px] tracking-[0.02em] text-ink-3"
          style={{
            animation: reduced ? undefined : 'lineUp 680ms 2400ms var(--ease-sl) both',
          }}
        >
          Your desk is set.
        </p>
      </div>
    </>
  )
}
