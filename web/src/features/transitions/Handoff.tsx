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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { lampGradient, MOTES, TABLE_IMAGE, TABLE_MASK, TABLE_SIZE, VIGNETTE } from '../../lib/room'

/**
 * `iris` — finishing onboarding. The intake's organism has just flown into the
 * logo and lit it; the light spreads out from the logo to cover the screen,
 * and the app is then revealed by an iris opening from the same point — so
 * the whole move has one origin, and it is where the app's own mark sits on
 * the other side. `threshold` — signing up. A doorway, deliberately brief,
 * because nothing has been earned yet and a fanfare here would be the product
 * congratulating itself for a form submit.
 */
export type HandoffVariant = 'iris' | 'threshold'

/** Where an `iris` opens from, in viewport pixels, and the lockup to hold lit
 *  while the page is swapped underneath. */
export type HandoffOptions = {
  origin?: { x: number; y: number }
  lockup?: { left: number; top: number; height: number }
}

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
// Both are sized so the choreography *finishes* before the uncover. `iris`:
// the light has covered the screen at ~720ms and the lit logo holds for a
// beat while home mounts under it. `threshold`: the last pulse clears at
// ~2000ms. Cutting either short was the specific complaint that the transition
// did not complete before the page arrived.
// `iris` holds only briefly past its cover: the reveal waits on the page
// being ready (`pageSettled`), not on a fixed clock.
const IN_MS: Record<HandoffVariant, number> = { iris: 380, threshold: 2100 }
/** The uncover. Slower than the cover — leaving should feel like a reveal. */
const OUT_MS: Record<HandoffVariant, number> = { iris: 1250, threshold: 560 }

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
/** The iris cover is a wave crossing the screen, so it takes longer to be
 *  opaque everywhere — and the sequencer must wait for exactly that. */
const COVER_BY: Record<HandoffVariant, number> = { iris: 780, threshold: COVER_MS }
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

/**
 * How long to wait, after the work, for the destination to stop loading.
 *
 * The route change mounts the destination, but mounting is not arriving:
 * Home shows a skeleton until `/spaces` answers, and uncovering onto that is
 * exactly the half-built frame the cover exists to hide. So the reveal waits
 * for the page to stop declaring itself busy — capped, because a slow API
 * must still end in a usable app, not a curtain.
 */
const READY_CEILING_MS = 1800

/**
 * Resolve once nothing on the page is `aria-busy` for a few frames running —
 * the convention every loading skeleton here already follows, so no screen
 * has to know it is being waited on.
 */
export function pageSettled(): Promise<void> {
  return new Promise((resolve) => {
    let calm = 0
    const tick = () => {
      calm = document.querySelector('[aria-busy="true"]') ? 0 : calm + 1
      if (calm >= 3) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

type HandoffApi = {
  /**
   * Cover the screen, run `work` underneath, then uncover.
   *
   * Resolves once the overlay is fully gone, so a caller can await it and
   * know the handoff is finished rather than guessing with a timer.
   */
  play: (variant: HandoffVariant, work: () => void | Promise<void>, options?: HandoffOptions) => Promise<void>
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
  readyCeilingMs = READY_CEILING_MS,
  work,
  ready,
  onPhase,
}: {
  inMs: number
  outMs: number
  /** Must match the curtain's fade-in, or the swap shows through it. */
  coverMs?: number
  ceilingMs?: number
  readyCeilingMs?: number
  work: () => void | Promise<void>
  /** Resolves when the destination has finished loading. Capped. */
  ready?: () => Promise<void>
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
    if (ready) {
      try {
        await Promise.race([ready(), wait(readyCeilingMs)])
      } catch {
        /* a readiness probe failing is not a reason to hold the cover */
      }
    }
    await painted()

    onPhase('out')
    await wait(outMs)
  } finally {
    onPhase(null)
  }
}

export function HandoffProvider({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion()
  const [state, setState] = useState<{ variant: HandoffVariant; phase: Phase; options?: HandoffOptions } | null>(
    null,
  )
  // Guards against a second `play` landing mid-sequence — a double-submit on
  // the finish button would otherwise restart the choreography on top of
  // itself and navigate twice.
  const busy = useRef(false)

  const play = useCallback(
    async (variant: HandoffVariant, work: () => void | Promise<void>, options?: HandoffOptions) => {
      if (busy.current) return
      busy.current = true
      try {
        await runHandoffSequence({
          inMs: reduced ? REDUCED_IN_MS : IN_MS[variant],
          outMs: reduced ? REDUCED_OUT_MS : OUT_MS[variant],
          coverMs: reduced ? REDUCED_IN_MS : COVER_BY[variant],
          work,
          ready: pageSettled,
          onPhase: (phase) => setState(phase ? { variant, phase, options } : null),
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
      {state &&
        (state.variant === 'iris' && !reduced ? (
          <IrisCurtain phase={state.phase} options={state.options} />
        ) : (
          <Curtain variant={state.variant} phase={state.phase} reduced={reduced} />
        ))}
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
      aria-label={variant === 'iris' ? 'Setting up your desk' : 'Opening Space Learn'}
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
      {/* Under reduced motion the iris is only this plain fade. */}
      {variant === 'threshold' && <ThresholdScene reduced={reduced} />}
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

/* ── Iris: out of the logo, into the app ─────────────────────────────── */

const FEATHER = 110
/** The disc and rim are drawn small and scaled up: a transform, so the cover
 *  wave runs on the compositor. Their soft edges only get softer with scale,
 *  which is what an expanding wave of light should look like anyway. */
const DISC = 240
const quartInOut = (p: number) => (p < 0.5 ? 8 * p ** 4 : 1 - (-2 * p + 2) ** 4 / 2)
const expoOut = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p))
const sineInOut = (p: number) => -(Math.cos(Math.PI * p) - 1) / 2

/**
 * Finishing the intake. The logo has just been lit by the student's own
 * galaxy flying into it; now its light spreads outward and covers the room
 * (`in`), the lit lockup holds while home mounts — and finishes loading —
 * underneath, and then an iris opens from that same point (`out`), revealing
 * the app from its own mark outward. A rim of light rides the edge both ways,
 * so the cover reads as a wave and the reveal as an aperture, never a fade.
 *
 * `in` is a small disc scaled up by transform — composited, no repaint. `out`
 * needs a hole, which no transform can make, so it is a feathered radial mask
 * written once per frame on a single flat layer; the rim that rides it is
 * again a scaled element. One rAF loop per phase writes styles directly: no
 * React state per frame, nothing that touches layout.
 */
function IrisCurtain({ phase, options }: { phase: Phase; options?: HandoffOptions }) {
  const disc = useRef<HTMLDivElement>(null)
  const cover = useRef<HTMLDivElement>(null)
  const rim = useRef<HTMLDivElement>(null)
  const lockup = useRef<HTMLDivElement>(null)
  const o = options?.origin ?? { x: 44, y: 36 }

  useLayoutEffect(() => {
    const W = window.innerWidth
    const H = window.innerHeight
    const far = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y)) + 24
    const dur = phase === 'in' ? COVER_BY.iris : OUT_MS.iris
    const t0 = performance.now()
    let raf = 0
    const ringAt = (r: number, a: number) => {
      const el = rim.current
      if (!el) return
      el.style.transform = `translate(-50%, -50%) scale(${((r * 2) / DISC).toFixed(4)})`
      el.style.opacity = String(Math.max(0, a))
    }
    if (phase === 'out' && cover.current && disc.current) {
      disc.current.style.visibility = 'hidden'
      cover.current.style.visibility = 'visible'
    }
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur)
      if (phase === 'in') {
        const r = far * 1.08 * quartInOut(p)
        if (disc.current) disc.current.style.transform = `translate(-50%, -50%) scale(${((r * 2) / DISC).toFixed(4)})`
        ringAt(r * 0.96, p < 0.75 ? 0.9 : ((1 - p) / 0.25) * 0.9)
      } else {
        const r = (far + FEATHER) * (0.55 * expoOut(p) + 0.45 * sineInOut(p))
        const m = `radial-gradient(circle at ${o.x}px ${o.y}px, transparent ${Math.max(0, r - FEATHER).toFixed(1)}px, #000 ${r.toFixed(1)}px)`
        const el = cover.current
        if (el) {
          el.style.maskImage = m
          el.style.setProperty('-webkit-mask-image', m)
        }
        ringAt(r - FEATHER * 0.5, (1 - p) * 0.8)
        if (lockup.current) lockup.current.style.opacity = String(Math.max(0, 1 - p * 2.4))
      }
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    tick(t0)
    return () => cancelAnimationFrame(raf)
  }, [phase, o.x, o.y])

  const lk = options?.lockup
  const circle = (extra: CSSProperties): CSSProperties => ({
    position: 'absolute',
    left: o.x,
    top: o.y,
    width: DISC,
    height: DISC,
    borderRadius: '50%',
    transform: 'translate(-50%, -50%) scale(0)',
    willChange: 'transform',
    ...extra,
  })
  return (
    <div role="status" aria-live="polite" aria-label="Setting up your desk" className="pointer-events-auto fixed inset-0 z-[100] overflow-hidden">
      {/* In: the light the galaxy brought, spreading from the logo. */}
      <div
        ref={disc}
        style={circle({
          background:
            'radial-gradient(closest-side, rgba(92,70,54,1) 0%, var(--color-canvas) 34%, var(--color-canvas) 90%, transparent 100%)',
        })}
      />
      {/* Out: the same room, with an aperture opening in it. */}
      <div ref={cover} className="absolute inset-0 bg-canvas" style={{ visibility: 'hidden' }} />
      <div
        ref={rim}
        aria-hidden
        style={circle({
          background:
            'radial-gradient(closest-side, transparent 88%, rgba(255,214,176,0.22) 94%, rgba(255,236,216,0.55) 97.5%, transparent 100%)',
          opacity: 0,
        })}
      />
      {lk && (
        <div ref={lockup} aria-hidden className="absolute flex items-center" style={{ left: lk.left, top: lk.top, height: lk.height }}>
          <span
            className="absolute rounded-full"
            style={{
              left: o.x - lk.left - 70,
              top: o.y - lk.top - 70,
              width: 140,
              height: 140,
              background: 'radial-gradient(closest-side, rgba(255,196,150,0.32), transparent)',
            }}
          />
          <Logo />
        </div>
      )}
    </div>
  )
}
