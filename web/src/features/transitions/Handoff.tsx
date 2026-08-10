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
const IN_MS: Record<HandoffVariant, number> = { desk: 1850, threshold: 1550 }
/** The uncover. Slower than the cover — leaving should feel like a reveal. */
const OUT_MS: Record<HandoffVariant, number> = { desk: 620, threshold: 560 }
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
  ceilingMs = WORK_CEILING_MS,
  work,
  onPhase,
}: {
  inMs: number
  outMs: number
  ceilingMs?: number
  work: () => void | Promise<void>
  onPhase: (phase: Phase | null) => void
}): Promise<void> {
  try {
    onPhase('in')
    // Let the cover land before the destination starts mounting, or the work
    // competes with the overlay's own first frames.
    await wait(Math.min(260, inMs))

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

  const api = useMemo(() => ({ play, playing: state !== null }), [play, state])

  return (
    <Ctx.Provider value={api}>
      {children}
      {state && <Curtain variant={state.variant} phase={state.phase} reduced={reduced} />}
    </Ctx.Provider>
  )
}

/* ── The curtain ─────────────────────────────────────────────────────── */

/**
 * Where the three sheets land. Slight rotations — dealt, not stacked.
 *
 * The spread is `min(164px, 26vw)` rather than a flat 164px: at 375px the
 * outer two sat 220px from centre inside a 187px half-width and were sliced
 * off by the curtain's `overflow-hidden`, so the phone version of the payoff
 * moment was one sheet and two offcuts.
 */
const SHEETS = [
  { key: 'l', x: 'calc(min(164px, 26vw) * -1)', r: -7, d: 620 },
  { key: 'c', x: '0px', r: 1.5, d: 740 },
  { key: 'r', x: 'min(164px, 26vw)', r: 8, d: 860 },
]

function Curtain({
  variant,
  phase,
  reduced,
}: {
  variant: HandoffVariant
  phase: Phase
  reduced: boolean
}) {
  const desk = variant === 'desk'
  return (
    <div
      // Announced rather than silent: a full-screen cover with no accessible
      // name is a screen reader dead end. `alert` would interrupt; `status`
      // is the polite register this deserves.
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] overflow-hidden bg-canvas"
      style={{
        animation: `${phase === 'in' ? 'curtainIn' : 'curtainOut'} ${
          phase === 'in'
            ? reduced
              ? REDUCED_IN_MS
              : 260
            : reduced
              ? REDUCED_OUT_MS
              : OUT_MS[variant]
        }ms var(--ease-sl) both`,
      }}
    >
      {/* The lamp coming up. Present in both variants — it is the constant
          that makes the two handoffs feel like one product. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(80rem 52rem at 50% -16%, rgba(255,176,116,0.20), transparent 66%),' +
            'radial-gradient(40rem 30rem at 50% 6%, rgba(255,214,170,0.10), transparent 62%)',
          animation: reduced ? undefined : 'lampUp 1100ms var(--ease-sl) both',
        }}
      />

      {/* The table ruling itself in, from the middle outward. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(245,237,228,0.05) 1px, transparent 1px),' +
            'linear-gradient(to bottom, rgba(245,237,228,0.05) 1px, transparent 1px)',
          backgroundSize: '30px 30px',
          maskImage: 'radial-gradient(70% 58% at 50% 42%, #000 20%, transparent 92%)',
          WebkitMaskImage: 'radial-gradient(70% 58% at 50% 42%, #000 20%, transparent 92%)',
          animation: reduced
            ? undefined
            : 'tableIn 1200ms 120ms var(--ease-sl) both',
        }}
      />

      {desk && !reduced && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative h-[190px] w-full max-w-lg">
            {/* Three sheets dealt onto the table — the dashboard being laid
                out, in the product's own material rather than a spinner. */}
            {SHEETS.map((s) => (
              <div
                key={s.key}
                className="absolute left-1/2 top-0 h-[150px] w-[92px] rounded-[10px] border border-[rgba(255,237,220,0.16)] sm:w-[112px]"
                style={{
                  background:
                    'linear-gradient(155deg, rgba(255,237,220,0.10), rgba(255,237,220,0.02) 60%)',
                  boxShadow: '0 18px 40px -22px rgba(0,0,0,0.9)',
                  ['--tx' as string]: s.x,
                  ['--tr' as string]: `${s.r}deg`,
                  animation: `sheetDeal 720ms ${s.d}ms var(--ease-sl) both`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* The rule, then the line. The sweeping hairline is the product's
          signature beat — it is on the boot splash, so the first run and every
          run after it open the same way. */}
      <div className="absolute inset-x-0 bottom-[18%] flex flex-col items-center gap-3.5 px-6">
        <div
          className="h-px w-full max-w-xs bg-[rgba(255,237,220,0.22)]"
          style={{
            transformOrigin: 'center',
            animation: reduced
              ? undefined
              : `ruleSweep 820ms ${desk ? 900 : 420}ms var(--ease-sl) both`,
          }}
        />
        <p
          className="text-center text-[13px] tracking-[0.02em] text-ink-3"
          style={{
            animation: reduced
              ? undefined
              : `lineUp 680ms ${desk ? 1120 : 700}ms var(--ease-sl) both`,
          }}
        >
          {desk ? 'Your desk is set.' : 'Come on in.'}
        </p>
      </div>
    </div>
  )
}
