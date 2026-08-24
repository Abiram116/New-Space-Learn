/**
 * Landing — a hero, four typographic statements, then a close.
 *
 * There used to be a single continuous scroll-jacked "film" here, built
 * around one physiology example. It staged a fictional student's document to
 * demonstrate the product instead of showing the product's own interface, so
 * it came out. Two more attempts at what should replace it — a subject-by-
 * subject demo, then a set of scroll-locked full-bleed colour panels copied
 * from an unrelated reference — both missed too. `FeatureType.tsx` is the
 * fourth: no scene, no borrowed look, four real capabilities stated directly
 * at display scale, locked in one at a time by the same `position: sticky`
 * mechanism `Close` (below) already uses. See `FeatureType.tsx`'s header for
 * the actual reasoning; this one just wires it in.
 *
 * One structural rule survives every rebuild, because it's true regardless of
 * what fills this section: THE LIGHT IS ONE LIGHT. Every section used to
 * carry its own radial-gradient "lamp" inside an `overflow-hidden` box, so
 * the gradient was clipped at each section boundary and left a hard
 * horizontal seam across the page. There is exactly one `<Lamp/>`, fixed to
 * the viewport, behind everything. Never give a section its own background
 * again — that's what made the page look cheap.
 *
 * Every claim here is one the build can keep. No usage numbers, customers,
 * testimonials or benchmarks appear anywhere, because none exist.
 */

import { useEffect, useRef, useState } from 'react'
import { prefetchAuthChunks } from '../../routes/lazyRoutes'
import { Link } from 'react-router-dom'
import { Logo } from '../../components/ui/Logo'
import { FeatureType } from './FeatureType'
import { HeroReveal } from './HeroReveal'
import { SmoothScroll } from './SmoothScroll'
import { attractor, CTA, DraftingCursor, SourceDrift } from './wow'

export function Landing() {
  // The warm-up ping moved to AuthProvider (mounts above the router, fires on
  // every load including this one) so it also covers a student who bookmarks
  // straight into an authenticated page and never sees this component. See
  // AuthProvider.tsx and docs/operations/performance-and-cost.md §6.

  // Sign in / Sign up are split out of the entry bundle, and this page is where
  // the click comes from. Warming them on idle means the split costs a
  // signed-in session 4KB less on every load and costs a visitor nothing.
  useEffect(prefetchAuthChunks, [])

  // THE HANDOFF. `FeatureType` now measures its own scroll room (see its
  // header: a `172svh` wrapper with a `sticky top-0 h-[100svh]` child) and
  // reports `closeProgress` up through this callback, rather than `Landing`
  // owning a separate spacer element for the same purpose. Two things used
  // to live in two different places — the pinned content and the scroll
  // distance that measures it — which is what let them drift out of sync
  // (a spacer shorter than the viewport silently zeroed `closeProgress` for
  // the whole page; see git blame here for the exact math). One component
  // owning both closes that gap structurally instead of by convention.
  //
  // `Close` stays `position: fixed` and outside `FeatureType` entirely —
  // it isn't part of what's being measured, only what's driven by the
  // measurement — so it's still rendered here as a sibling, fed the same
  // number.
  const [closeProgress, setCloseProgress] = useState(0)

  return (
    <SmoothScroll>
      {/* `cursor-none` is scoped to this wrapper on purpose — the reticle is a
          landing-page device, and an app you actually work in should keep the
          system cursor with all its real affordances (text I-beam, resize). */}
      <div className="sl-motion relative min-h-full bg-canvas text-ink lg:cursor-none">
        <DraftingCursor />
        <Lamp />
        <div className="relative z-10">
          <TopBar />
          <HeroReveal
            src="/story.webm"
            fallbackSrc="/story.mp4"
            poster="/story-poster.webp"
          />
          <FeatureType onCloseProgress={setCloseProgress} />
        </div>
        <Close progress={closeProgress} />
      </div>
    </SmoothScroll>
  )
}

/**
 * The single lamp over the whole table. `fixed` rather than per-section
 * `absolute`, which is the entire reason the page no longer has seams: a fixed
 * layer cannot be clipped by a section's overflow, so the light is continuous
 * from the first pixel to the last.
 */
/**
 * The lamp over the desk — one fixed layer, but a live one.
 *
 * Two things make it feel like a room rather than a CSS gradient:
 *
 * 1. It follows the pointer. A real lamp throws light from where you are
 *    looking, so a warm cone tracks the cursor at a lag. Set through CSS
 *    custom properties from a rAF loop, never React state — this updates on
 *    every pointer move and a re-render per move would be absurd.
 *
 * 2. It takes the colour of the surface you are currently reading. `--tint` is
 *    written by the film as the beats advance (warm for the page, mint at the
 *    citation, pink at the deck, orange at the quiz), so the room quietly
 *    changes temperature with the kind of work on screen. The transition is
 *    deliberately long — 1.6s — so it is felt rather than noticed.
 */
function Lamp() {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return
    let raf = 0
    let tx = 50
    let ty = 22
    let cx = 50
    let cy = 22
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 100
      ty = (e.clientY / window.innerHeight) * 100
    }
    const tick = () => {
      // Lag the light behind the cursor. Instant tracking reads as a gimmick;
      // trailing reads as a lamp with mass.
      cx += (tx - cx) * 0.045
      cy += (ty - cy) * 0.045
      const node = el.current
      if (node) {
        node.style.setProperty('--lx', `${cx.toFixed(2)}%`)
        node.style.setProperty('--ly', `${cy.toFixed(2)}%`)
      }
      raf = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <>
      <div
        ref={el}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={
          {
            '--lx': '50%',
            '--ly': '22%',
            transition: 'background-color 1600ms linear',
            backgroundImage:
              'radial-gradient(46ch 38ch at var(--lx) var(--ly), rgba(var(--tint,51 36 29) / 0.55) 0%, transparent 68%),' +
              'radial-gradient(90ch 70ch at 16% 4%, #33241d 0%, transparent 62%),' +
              'radial-gradient(76ch 58ch at 92% 88%, #2c1e17 0%, transparent 60%),' +
              'radial-gradient(60ch 60ch at 60% 45%, #281d18 0%, transparent 70%)',
          } as React.CSSProperties
        }
      />


      {/* ENGRAVED HATCH. The cutout is a hatched engraving, so the same
          hatching runs under the whole page at 3% — the illustration stops
          looking pasted onto flat CSS and starts looking like it was printed
          on the same stock as everything else. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='7' height='7'><path d='M-1 8 L8 -1' stroke='%23f5ede4' stroke-width='0.7'/></svg>\")",
          backgroundRepeat: 'repeat',
        }}
      />

      {/* FILM GRAIN. Large flat gradients on a dark ground band badly; a little
          noise breaks the banding up and is why the light reads as organic
          rather than as a CSS gradient. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.055] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>\")",
        }}
      />

      <Dust />
      <SourceDrift />
    </>
  )
}

/**
 * Dust in the lamplight — the one thing keeping the page alive when nothing
 * is animating.
 *
 * Canvas rather than DOM nodes: fifty absolutely-positioned divs each with
 * their own keyframe animation is fifty things for the compositor to track,
 * and it shows on a mid-range laptop. One canvas is one layer.
 *
 * Motes drift up and sideways, are brighter nearer the top-left where the lamp
 * actually is, and wrap rather than respawn so the field never visibly resets.
 */
function Dust() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    let raf = 0
    let w = 0
    let h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    type Mote = { x: number; y: number; r: number; vx: number; vy: number; a: number }
    let motes: Mote[] = []

    const seed = () => {
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round(Math.min(56, Math.max(24, (w * h) / 26000)))
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 0.09,
        vy: -0.05 - Math.random() * 0.16,
        a: 0.06 + Math.random() * 0.20,
      }))
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const m of motes) {
        // When the page is producing something from the source passage, the
        // dust leans toward it. Not a snap — a drift, weighted by how far away
        // the mote is, so the field visibly *flows* somewhere rather than
        // teleporting. This is the whole "everything is connected" idea done
        // with arithmetic instead of a particle library.
        if (attractor.pull > 0.02 && attractor.x >= 0) {
          const dx = attractor.x - m.x
          const dy = attractor.y - m.y
          const d = Math.hypot(dx, dy) || 1
          const g = (attractor.pull * 0.05) / Math.max(0.35, d / 260)
          m.x += (dx / d) * g
          m.y += (dy / d) * g
        }
        m.x += m.vx
        m.y += m.vy
        if (m.y < -6) m.y = h + 6
        if (m.x < -6) m.x = w + 6
        if (m.x > w + 6) m.x = -6
        // Brighter where the lamp pools (upper left), so the field reads as
        // dust catching light rather than as scattered dots.
        const lamp = 1 - Math.min(1, Math.hypot(m.x - w * 0.2, m.y - h * 0.15) / (Math.max(w, h) * 0.85))
        ctx.beginPath()
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(245,237,228,${m.a * (0.25 + lamp * 0.75)})`
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }

    seed()
    draw()
    window.addEventListener('resize', seed)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', seed)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  )
}

function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-gradient-to-b from-canvas via-canvas/85 to-transparent">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-5">
        <Link to="/" aria-label="Space Learn">
          <Logo size={26} textClassName="text-[18px]" />
        </Link>
        <nav className="ml-auto flex items-center gap-1.5">
          <Link
            to="/signin"
            className="rounded-[9px] px-3 py-2 text-[13px] font-bold text-ink-3 transition-colors hover:bg-line-soft hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="rounded-[10px] bg-brand px-3.5 py-2 text-[13px] font-bold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_2px_0_#a8331d] transition-transform active:translate-y-[2px]"
          >
            Start free
          </Link>
        </nav>
      </div>
    </header>
  )
}

/* ── Close ─────────────────────────────────────────────────────────────
   A FIXED OVERLAY, RISING WITH SCROLL — not a pinned scroll section with
   its own height (three earlier versions each gave it a wrapper height —
   220svh, then 150svh, then a boolean-triggered instant transition with
   none at all — and each missed differently: the first two left leftover
   scroll distance mapped to nothing happening; the boolean version arrived
   all at once instead of tracking the gesture that was supposed to drive
   it, reported live as "it should be scroll trigger linked... not come up
   fully at once").

   The fix that actually holds both properties at once: `Close` itself is
   `position: fixed` and owns no height of its own — so there's still
   nothing here to create a dead-scroll gap — but its entrance is driven by
   a CONTINUOUS `progress` value (0→1), not a boolean. `Landing()` builds
   that value from a plain spacer div sized to exactly the reveal distance
   (see there), so scrolling through that spacer scrubs this panel up from
   `translateY(100%)` to `0%` in lockstep, the way the reference this was
   built against actually behaves. Reaching `progress === 1` is the same
   moment as reaching the real bottom of the page's scrollable content —
   this is the last thing in document flow — which is what makes "no more
   scroll down beyond that" true with no extra clamping logic: there's
   nowhere further to go.

   The wordmark is set on ONE line and sits in the band above the figure's
   head rather than behind its body. Stacked over two lines it was buried:
   the figure covered the middle of both words and neither read. */

function Close({ progress }: { progress: number }) {
  // "Landed" — close enough to fully revealed that the panel reads as
  // settled rather than still arriving. Drives the things that should
  // happen ONCE, after the scrub finishes, not continuously across it: the
  // ambient tint, the foil sweep, and whether the panel is interactive.
  // 0.97 rather than a strict 1 because scroll rarely lands on an exact
  // integer and "almost entirely revealed" should count as landed.
  const landed = progress >= 0.97
  const hidden = progress <= 0.001

  useEffect(() => {
    if (!landed) {
      document.documentElement.style.removeProperty('--tint')
      return
    }
    document.documentElement.style.setProperty('--tint', '70 30 14')
    return () => {
      document.documentElement.style.removeProperty('--tint')
    }
  }, [landed])

  return (
    // `inert` only while truly untouched (`progress` at 0) — not just
    // `pointer-events: none` — so the CTA and the GitHub link aren't
    // reachable by keyboard Tab before any of the panel has scrolled into
    // view. Once scrubbing has started at all, the visible portion is
    // real and should be interactive, matching how the reference site's
    // own scroll-linked reveal behaves.
    <div
      className="fixed inset-0 z-30 overflow-hidden"
      style={{
        // Continuous, not transitioned — `progress` already comes from
        // Lenis-smoothed scroll (see `useScrollProgress`), so mapping it
        // straight to `translateY` is what makes this track the gesture
        // 1:1 instead of catching up to it after the fact.
        transform: `translateY(${((1 - progress) * 100).toFixed(2)}%)`,
        // Bold and orange, on purpose — asked to specifically NOT read as a
        // continuation of the page's warm-graphite canvas. Anchored
        // bottom-right (roughly where the figure stands) so the brightest
        // orange sits behind the art, while the copy column on the left
        // rests on the darker ember end of the same gradient — checked at
        // 15:1+ for the existing light ink-on-dark text there, so nothing
        // needed to change colour to stay legible; only the CTA button,
        // whose fill is this same brand orange, benefits from sitting on
        // the darker side rather than blending into a matching background.
        background:
          'radial-gradient(150ch 115ch at 88% 72%, #ff6b45 0%, #b23a1b 42%, #1f0d08 100%)',
        boxShadow: `0 ${(40 * progress).toFixed(0)}px ${(100 * progress).toFixed(0)}px -30px rgba(0,0,0,${(0.55 * progress).toFixed(2)})`,
      }}
      aria-hidden={hidden}
      {...(hidden ? ({ inert: '' } as Record<string, string>) : {})}
    >
      {/* THE DEPTH CUE. As this panel rises, its top edge is the leading
          surface sliding up and over whatever was on screen before it —
          the moment asked to read as "3D depth... at the top edge as it
          comes on top". A dark gradient hugging that edge, strongest at the
          midpoint of the scrub and fading out as the panel settles, reads
          as the edge casting a shadow onto the ground it's passing over
          rather than a flat sheet with no thickness. `sin(progress * π)`
          peaks exactly at progress 0.5 and returns to 0 at both ends, so
          the shadow is absent when the panel is barely visible (nothing
          to cast a shadow yet) AND absent once fully landed (nothing left
          to cast it onto). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-40 h-24"
        style={{
          opacity: Math.sin(Math.min(1, progress) * Math.PI) * 0.8,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.45), transparent)',
        }}
      />
      {/* Copy and figure get SEPARATE BANDS — they are never stacked.
          Layering them behind a scrim put the "Start free" button squarely
          on the reader's head, and no amount of scrim fixes type sitting on
          a face. A two-column grid guarantees they cannot collide: copy
          left, figure right. Below `lg` the grid stacks to two rows, copy
          above, figure below — still no overlap. */}
      <div className="relative z-30 mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_1fr] px-5 sm:px-8 lg:grid-cols-[1fr_1.3fr] lg:grid-rows-1 lg:items-center lg:gap-8">
        {/* Content is no longer independently animated — see the note
            below the panel's own transform. It's simply part of the
            panel now, present the instant the slide lands. */}
        <div className="flex flex-col items-center gap-5 pt-[11svh] text-center lg:items-start lg:pt-0 lg:text-left">
          <h2 className="nameplate max-w-lg text-[clamp(30px,5vw,66px)] leading-[0.9]">
            Bring one subject
            <br />
            <span className="text-brand">you're behind on.</span>
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-ink-3">
            One PDF is enough to see whether this works the way you study.
            Nothing to configure first.
          </p>
          <CTA to="/signup">Start free</CTA>
        </div>

        {/* The figure owns the second band and sits on the floor of it.
            Unlike copy (below), it rises in on its OWN clock, gated by
            `landed` rather than the continuous `progress` scrub — asked
            for directly: once the panel "feels like [a full] screen", the
            figure should arrive afterward as its own beat, "shinin[g]"
            in the same spirit as the foil sweep rather than riding the
            panel's rise in lockstep with everything else.

            Sized up on two axes: the grid column itself is wider than
            copy's (`1.3fr` vs `1fr`, was an even split), and the image is
            scaled 1.14× on top of that, anchored to `bottom` so it grows
            upward off the floor it's already standing on rather than
            growing from its own centre and floating up.

            No pointer parallax on this element — tried, and asked to drop
            it: constant motion on the one thing the eye rests on longest
            here worked against the "picture rises into place, done" beat
            rather than adding to it. The `filter: drop-shadow` pair stays
            — `drop-shadow` follows the artwork's actual alpha silhouette
            rather than its bounding box the way `box-shadow` would, so
            the shadow reads as genuinely cast BY the figure onto the
            panel, which is what still sells depth without any motion
            attached to it.

            No opacity fade either — asked for a plain, complete rise from
            below the frame, not a cross-fade with a slide riding along.
            `65svh` (not a small px offset) is what makes that literal:
            large enough that the resting position starts entirely below
            this panel's own `overflow-hidden` bounds, so before `landed`
            the figure isn't invisible because it's transparent, it's
            invisible because it is genuinely off-screen — the rise is
            the only thing that ever makes it appear. */}
        <div className="relative flex min-h-0 items-end justify-center lg:h-full lg:justify-end">
          <img
            src="/student-reading.webp"
            alt=""
            aria-hidden
            className="max-h-full max-w-full select-none object-contain object-bottom"
            style={{
              transform: `translateY(${landed ? 0 : 65}svh) scale(1.14)`,
              transformOrigin: 'bottom',
              filter:
                'drop-shadow(0 10px 14px rgba(0,0,0,0.35)) drop-shadow(0 30px 46px rgba(0,0,0,0.45))',
              // 1300ms still read as quick for a 65svh climb — same
              // front-loaded-curve issue as the wordmark sweep above.
              // 2100ms is where the rise itself becomes something to
              // watch rather than something that's already resolved by
              // the time it's noticed.
              transition: 'transform 2100ms var(--ease-out-expo) 150ms',
            }}
          />
        </div>
      </div>
      {/* WHY THE COPY NO LONGER FADES IN ON ITS OWN CLOCK.
          A first version staggered copy and figure behind the panel — copy
          160ms in, figure 240ms in, each with its own opacity/transform
          transition — reasoning that a beat of internal sequencing would
          read as considered. Live, it read as the opposite: "the
          background arrives, then separately the text arrives, then
          separately the figure arrives" was three things happening, not
          one. Copy stays fixed to that fix — it's simply part of the panel,
          present the instant the slide lands, carried along by the single
          `transform` on the outer element. The figure went back to its own
          clock deliberately (see above): asked for by name, and it isn't
          the same kind of stagger this note was written to rule out —
          it's gated on arrival being COMPLETE rather than merely started,
          same as the foil sweep already was. */}

      {/* FOIL STAMP, not an outline and not a mono wireframe. A hairline
          outline at this scale reads as a placeholder — thin, even, and
          lifeless. Real foil stamping is the opposite: the ink is only
          visible where light rakes across it, so the letterform brightens
          through the middle and falls away at both ends. That is exactly
          what a `background-clip: text` gradient does, and it is already
          this brand's own device (`.foil`).

          Same mechanism, same hues, same stop positions as before — asked
          to be improved, not changed. What moved: every stop's peak
          opacity is raised (0.10→0.16 gold, 0.20→0.34 the central flare,
          0.07→0.12 the brand-orange tail), so the light reads as
          genuinely catching the metal instead of a faint pass over it.
          The sweep is also slower still (900ms→1150ms→2200ms→3400ms).
          `--ease-out-expo` front-loads nearly all of its travel into the
          first third of whatever duration it's given, so each of these
          increases bought less perceived slowness than the raw number
          suggests — 3400ms is what it actually took for the front-loaded
          burst itself, not just the trailing settle, to stop reading as
          a snap. Deliberately long: this is a one-time flourish, not a
          UI affordance anyone is waiting on.

          Added on top: a layered `text-shadow`, which still renders
          against `background-clip: text` — the clip only affects the
          fill, not the shadow. First attempt read as the wordmark turning
          solid black: the gradient fill is deliberately faint everywhere
          the sweep isn't currently raking it (most stops sit at
          0.02–0.16 alpha), so a shadow strong enough to read on its own
          shows straight through that near-transparent fill instead of
          sitting behind it. Fixed by cutting every layer's opacity hard
          and dropping the wide 10px/26px spread entirely — that one
          layer alone was the black blob.

          Direction also matters and was backwards: a light edge on top
          with dark below is EMBOSSED, popping toward the viewer, which is
          not what a stamp does — a stamp presses IN. So: a faint dark
          line above the glyphs (the near wall of the impression, in its
          own shadow) and a fainter light line below (the far lip
          catching the same light the sweep does), both barely-there —
          just enough to read as a groove in the surface than a shine
          resting on top of it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[2svh] z-0 flex justify-center"
      >
        <span
          className="nameplate select-none whitespace-nowrap text-center text-[clamp(38px,11.5vw,196px)] leading-[0.86] tracking-[-0.035em]"
          style={{
            backgroundImage:
              'linear-gradient(100deg,' +
              'rgba(245,237,228,0.02) 18%,' +
              'rgba(255,197,61,0.16) 34%,' +
              'rgba(245,237,228,0.34) 46%,' +
              'rgba(53,214,232,0.16) 57%,' +
              'rgba(255,90,60,0.12) 68%,' +
              'rgba(245,237,228,0.02) 84%)',
            backgroundSize: '260% 100%',
            backgroundPosition: landed ? '-30% 0' : '120% 0',
            transition: 'background-position 3400ms var(--ease-out-expo) 220ms',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow:
              '0 -1px 1px rgba(10,5,2,0.32), 0 1px 0 rgba(255,240,215,0.16)',
          }}
        >
          Space Learn
        </span>
      </div>

      {/* One mark, bottom right. The page used to end with the wordmark
          three times over — stamped behind the figure, again as a corner
          label, and a third time in a footer under it. Repetition at the
          close reads as filler; the stamped one is the statement, so the
          others go. */}
      {/* No independent fade here either — same reasoning as the copy and
          figure above; this rides with the panel's own transform instead
          of arriving on its own delayed clock. */}
      {/* The "No card needed / Nothing to pay" pairing that used to sit
          opposite this is gone — asked to keep only the licence mark. What's
          left is sized up from `.setcode`'s 11.5px (a system-wide
          small-print size, so bumped locally rather than in the shared
          class) since standing alone at the old size read as too faint to
          register as this panel's one closing credit. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-5 pb-5 sm:px-8">
        <a
          href="https://github.com/Abiram116/New-Space-Learn"
          target="_blank"
          rel="noopener noreferrer"
          className="setcode pointer-events-auto text-[13.5px] transition-colors hover:text-ink"
        >
          MIT Licensed
          <br />
          Source on GitHub
        </a>
      </div>
    </div>
  )
}
