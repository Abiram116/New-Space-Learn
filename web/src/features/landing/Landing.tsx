/**
 * Landing — one continuous film, not a stack of sections.
 *
 * Two structural rules, both learned the hard way:
 *
 * 1. THE LIGHT IS ONE LIGHT. Every section used to carry its own radial-gradient
 *    "lamp" inside an `overflow-hidden` box, so the gradient was clipped at each
 *    section boundary and left a hard horizontal seam across the page. There is
 *    now exactly one `<Lamp/>`, fixed to the viewport, behind everything. Never
 *    add a per-section background again — that is what made it look cheap.
 *
 * 2. IT IS ONE OBJECT. The page does not list features. A single page of the
 *    student's own material enters, and then keeps becoming the next thing:
 *    the passage that answered you, the deck built from it, the test that comes
 *    back. Nothing new ever appears; you only watch the same thing transform.
 *    That IS the product's claim, so the page argues by demonstration rather
 *    than by bullet.
 *
 * No numbered section markers. The order is felt through the transformation,
 * and labelling it "01 / RETRIEVAL" turned a film into a brochure.
 *
 * Every claim here is one the build can keep. No usage numbers, customers,
 * testimonials or benchmarks appear anywhere, because none exist.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { Logo, LogoMark } from '../../components/ui/Logo'
import { cn } from '../../lib/cn'
import { mapRange, useScrollProgress } from '../../lib/useScrollProgress'
import { HeroReveal } from './HeroReveal'
import { SmoothScroll } from './SmoothScroll'
import {
  attractor,
  CTA,
  DraftingCursor,
  MaskedLines,
  SourceDrift,
  VelocityTilt,
} from './wow'

export function Landing() {
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
          <Film />
          <Close />
        </div>
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

/* ── The pack, and going through it ────────────────────────────────────
   The card is not decoration and not a logo plate. It is a topic you have
   not opened yet — your own uploads, sealed. So the transition is not the
   card sliding away to reveal a headline underneath; the camera goes THROUGH
   it. The pack scales past the viewport and you come out inside, which is
   the literal claim: everything after this point is what was in there. */

/**
 * One pinned take, from sealed pack to finished test.
 *
 * This used to be two separate pinned sections back to back, and that is
 * precisely what made the page feel like slides: each pinned scene is a
 * self-contained full-screen composition, so every boundary between them
 * reads as a cut. Merged into a single sticky viewport, the pack fly-through
 * and the transformation are one continuous camera move with no seam to see.
 *
 * Ranges overlap deliberately — the next thing starts arriving before the
 * previous one has finished leaving, which is the difference between a
 * dissolve and a cut.
 */
function Film() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>()

  const sweep = mapRange(progress, 0, 0.07, 0, 1)
  const through = mapRange(progress, 0.05, 0.17, 0, 1)
  const inside = mapRange(progress, 0.13, 0.24, 0, 1)
  const insideOut = mapRange(progress, 0.29, 0.37, 0, 1)
  const stage = mapRange(progress, 0.32, 0.4, 0, 1)

  // Four beats across the back two-thirds of the take.
  const BEAT_FROM = 0.38
  const slot = (i: number) => {
    const size = (1 - BEAT_FROM) / BEATS.length
    const start = BEAT_FROM + i * size
    const end = start + size
    const inn = mapRange(progress, start, start + size * 0.26, 0, 1)
    const out = i === BEATS.length - 1 ? 0 : mapRange(progress, end - size * 0.26, end, 0, 1)
    return inn * (1 - out)
  }
  // Whichever beat is actually most visible — not a floor() of raw progress.
  // The floor flipped the caption at the arithmetic boundary while the old
  // beat was still the one on screen, so for the length of every crossfade the
  // label described something you could no longer see.
  const active = [0, 1, 2, 3].reduce((best, i) => (slot(i) > slot(best) ? i : best), 0)

  // ── Everything originates from one point ──────────────────────────────
  // The highlighted sentence in the source passage is the origin. Its centre
  // is measured once laid out, and every beat then GROWS FROM IT rather than
  // fading in place — the answer, the deck and the quiz all expand out of the
  // exact spot on the page they were derived from. That is the single mental
  // image the whole landing exists to leave behind: this all starts from your
  // material.
  const stageRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLElement>(null)
  const [origin, setOrigin] = useState({ x: -1, y: -1 })

  useLayoutEffect(() => {
    const measure = () => {
      const s = stageRef.current
      const m = markRef.current
      if (!s || !m) return
      const sr = s.getBoundingClientRect()
      const mr = m.getBoundingClientRect()
      if (mr.width === 0) return
      setOrigin({
        x: mr.left + mr.width / 2 - sr.left,
        y: mr.top + mr.height / 2 - sr.top,
      })
    }
    measure()
    // Re-measure after fonts land: the mark moves when the display face swaps
    // in, and an origin measured against the fallback is wrong by a line.
    document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Feed the dust. It pulls toward the origin while the page is actively
  // producing something from it, and lets go once the deck is out.
  useEffect(() => {
    const s = stageRef.current
    if (!s || origin.x < 0) {
      attractor.pull = 0
      return
    }
    const sr = s.getBoundingClientRect()
    attractor.x = sr.left + origin.x
    attractor.y = sr.top + origin.y
    attractor.pull = Math.max(slot(0), slot(1)) * stage
    return () => {
      attractor.pull = 0
    }
  })

  // Colour progression. The room takes the temperature of the surface you are
  // reading — warm for the page, mint where the citation is, pink at the deck,
  // orange at the quiz. Written to the root so the fixed lamp can pick it up
  // without the two components having to know about each other, and only while
  // the stage is actually on screen.
  useEffect(() => {
    const root = document.documentElement
    const TINTS = ['51 36 29', '18 62 62', '62 26 44', '64 40 20']
    root.style.setProperty('--tint', stage > 0.35 ? TINTS[active] : TINTS[0])
    return () => {
      root.style.removeProperty('--tint')
    }
  }, [active, stage])

  return (
    <div ref={ref} className="relative h-[620svh]">
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden">
        {/* The sealed pack. Scales past the frame rather than shrinking away —
            you are moving toward it, not it away from you. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          style={{
            opacity: 1 - through,
            transform: `scale(${1 + through * 7})`,
            filter: `blur(${through * 7}px)`,
          }}
        >
          <div
            className="relative h-[62svh] max-h-[560px] w-[min(78vw,440px)] overflow-hidden rounded-[26px]"
            style={{
              background:
                'linear-gradient(150deg,#3a2620 0%,#2b1e1a 30%,#41291f 55%,#2a1d19 78%,#3c2721 100%)',
              boxShadow:
                'inset 0 2px 0 rgba(255,237,220,0.18), inset 0 -40px 80px rgba(0,0,0,0.55), 0 60px 120px -30px rgba(0,0,0,0.95)',
            }}
          >
            <div
              aria-hidden
              className="absolute inset-[-30%]"
              style={{
                background:
                  'linear-gradient(115deg,transparent 40%,rgba(255,197,61,0.22) 46%,rgba(53,214,232,0.28) 51%,rgba(255,61,139,0.22) 56%,transparent 62%)',
                transform: `translateX(${-55 + sweep * 110}%)`,
              }}
            />
            <div className="relative flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <LogoMark size={72} />
              <span className="nameplate text-[38px] leading-[0.9] text-ink">Space Learn</span>
              <span className="setcode">Everything you uploaded · still sealed</span>
            </div>
          </div>
        </div>

        {/* Inside. Arrives from further away than the pack left, so the two
            movements read as one continuous push rather than a cut. Then it
            recedes as the work itself comes forward. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10"
          style={{
            opacity: inside * (1 - insideOut),
            transform: `translateY(-50%) scale(${0.82 + inside * 0.18 + insideOut * 0.5})`,
            filter: `blur(${insideOut * 10}px)`,
          }}
        >
          <h2 className="nameplate -mx-[8vw] select-none text-center leading-[0.78] tracking-[-0.02em] text-ink">
            <span className="block -rotate-[1.5deg]">
              <span className="text-[clamp(64px,15vw,230px)]">One</span>{' '}
              <span className="align-top text-[clamp(22px,3.6vw,58px)] text-ink-3">
                conversation.
              </span>
            </span>
            <span className="block rotate-[1deg] text-brand">
              <span className="align-top text-[clamp(18px,3vw,48px)] text-ink-3">
                everything it
              </span>{' '}
              <span className="text-[clamp(64px,15vw,230px)]">becomes.</span>
            </span>
          </h2>
        </div>

        {/* …and the same take keeps rolling into the work itself. Same sticky
            viewport, so there is no boundary between the promise and the proof. */}
        {/* CAMERA. The scene is very slightly pushed in and panned across the
            length of the take — about 3% of zoom and a dozen pixels of drift,
            far too little to notice as movement and just enough that the shot
            is never geometrically still. That is the difference between
            watching a scene and watching a screenshot of one.

            Applied to the scene's CONTENT, never to a page-level wrapper: a
            transform on an ancestor re-parents `position: fixed` and
            `sticky`, which would unpin every scene on the page and stop the
            lamp covering the viewport. A camera has to move inside the frame,
            not move the frame. */}
        <div
          className="absolute inset-0 z-10 flex flex-col justify-center"
          style={{
            opacity: stage,
            transform:
              `scale(${(0.94 + stage * 0.06 + progress * 0.03).toFixed(4)}) ` +
              `translate3d(${((progress - 0.5) * -16).toFixed(2)}px, ${((progress - 0.5) * -11).toFixed(2)}px, 0)`,
          }}
        >
          <div className="mx-auto w-full max-w-5xl px-5">
            {/* The standing headline. It was lost when the pack scene and the
                transformation were merged into one take, which left the stage
                floating in ~40svh of dead space — the blank band that made the
                bottom of this scene look unfinished. It also gives the four
                beats something to be an answer to. */}
            {/* Wiped in line by line rather than faded. At display size a fade
                makes type appear; a wipe makes it arrive. */}
            <MaskedLines
              className="nameplate mb-7 block max-w-2xl text-[clamp(24px,3.8vw,46px)] leading-[0.94]"
              progress={stage}
              lines={[
                'Watch one page become',
                <span key="b" className="text-brand">
                  everything you'll be tested on.
                </span>,
              ]}
            />

            {/* The stage carries the scroll's inertia — it skews with the
                direction of travel and settles when you stop. Safe to wrap
                here because nothing inside is sticky or fixed. */}
            <VelocityTilt className="relative h-[42svh] min-h-[270px]">
              <div ref={stageRef} className="absolute inset-0">
                {/* The SHEET PERSISTS. It is one element for all four beats, so
                    the paper never leaves — only what is printed on it changes.
                    Beats used to be four separate panels cross-fading, which
                    reads as one thing REPLACING another; a page that stays while
                    its contents transform is the actual claim being made. */}
                <div
                  className="leaf absolute inset-0"
                  style={{
                    // Driven off the stage, NOT off a max() of the beat slots.
                    // With max() the sheet bottomed out to ~0.09 halfway through
                    // every crossfade — the paper blinked out between beats,
                    // which is the exact opposite of "the page persists". This
                    // way it is simply present for the whole take, dimming to a
                    // third only under the deck, because those cards were pulled
                    // OUT of that page and it has to still be lying there.
                    opacity: stage * (1 - slot(2) * 0.66),
                  }}
                />
                <Sheet o={slot(0)} origin={origin} markRef={markRef} />
                <AnswerStage o={slot(1)} origin={origin} />
                <DeckStage o={slot(2)} origin={origin} />
                <TestStage o={slot(3)} origin={origin} />

                {/* No drawn threads. Literal curved lines from the sentence to
                    the artifacts looked like clip-art over the type — the
                    traceability idea was right, the rendering was not. It is
                    already carried better and more quietly by the fact that
                    every beat SCALES OUT OF the highlighted sentence, and by
                    the dust leaning toward it. Motion states the relationship;
                    it does not need to be annotated. */}
              </div>
            </VelocityTilt>

            {/* Says what you're looking at. The only thing that tells you the
                page has moved on — no numbered markers. */}
            <div className="mt-7 flex min-h-[3.5rem] flex-col gap-1.5">
              <span className="nameplate text-[17px] text-ink">{BEATS[active].at}</span>
              <span className="max-w-lg text-[13.5px] leading-relaxed text-ink-3">
                {BEATS[active].note}
              </span>
            </div>

            <div className="mt-5 flex gap-1.5">
              {BEATS.map((b, i) => (
                <span
                  key={b.at}
                  className={cn(
                    'h-px flex-1 transition-colors duration-300',
                    i === active ? 'bg-brand' : 'bg-line',
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BEATS = [
  { at: 'The page you uploaded', note: 'Split into passages and indexed the moment it lands.' },
  { at: 'The answer it produced', note: 'Built only from passages your document actually contains.' },
  { at: 'The deck it turned into', note: 'One conversation, a whole deck — each card keeps its page.' },
  { at: 'The test it comes back as', note: 'Wrong answers point at the paragraph that would have fixed them.' },
]

type Origin = { x: number; y: number }

/**
 * Shared frame for a beat.
 *
 * Beats do not fade in place — they SCALE OUT OF THE ORIGIN. Setting
 * `transform-origin` to the measured centre of the highlighted sentence means
 * the answer, the deck and the quiz each visibly expand from the exact spot on
 * the page they were derived from. Opacity still rides along, because without
 * it the outgoing beat would sit behind the incoming one at full strength, but
 * the movement is what the eye reads, and the movement says "this came from
 * there".
 */
function Beat({
  o,
  origin,
  children,
}: {
  o: number
  origin?: Origin
  children: React.ReactNode
}) {
  const hasOrigin = origin && origin.x >= 0
  return (
    <div
      className="absolute inset-0"
      style={{
        opacity: o,
        transformOrigin: hasOrigin ? `${origin.x}px ${origin.y}px` : '50% 50%',
        transform: `scale(${(0.82 + o * 0.18).toFixed(4)})`,
        pointerEvents: o > 0.5 ? 'auto' : 'none',
      }}
    >
      {children}
    </div>
  )
}

function Sheet({
  o,
  origin,
  markRef,
}: {
  o: number
  origin?: Origin
  markRef?: React.Ref<HTMLElement>
}) {
  return (
    <Beat o={o} origin={origin}>
      {/* No `leaf` class here — the sheet behind these beats is a single
          persistent element, so each beat only prints ON it. */}
      <div className="h-full overflow-hidden py-6 pl-[clamp(16px,3vw,34px)]">
        <div className="setcode mb-4">physiology-wk6.pdf · p.31</div>
        <p className="max-w-2xl text-[15px] leading-[2] text-ink-3">
          The descending limb is permeable to water but not to salt, so fluid
          leaving it grows steadily more concentrated.{' '}
          {/* THE ORIGIN. Everything the page produces is measured from the
              centre of this element and grows out of it. */}
          <mark ref={markRef} className="bg-sky-soft px-1 text-sky-deep">
            The ascending limb reverses the arrangement: it pumps salt out and
            holds water in.
          </mark>{' '}
          Running the two side by side multiplies a modest gradient into a steep
          one along the length of the loop.
        </p>
      </div>
    </Beat>
  )
}

function AnswerStage({ o, origin }: { o: number; origin?: Origin }) {
  return (
    <Beat o={o} origin={origin}>
      <div className="h-full py-6 pl-[clamp(16px,3vw,34px)]">
        <div className="setcode mb-3">Answer</div>
        <p className="max-w-2xl text-[16px] leading-[1.8] text-ink">
          Because the two limbs do opposite jobs. One sheds water, the other
          pumps out salt — stacked against each other they turn a small
          difference into a steep one.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-sky/30 bg-sky-soft px-3 py-1.5">
          <Icon name="doc" size={12} className="text-sky-deep" />
          <span className="setcode text-sky-deep">physiology-wk6.pdf · p.31</span>
        </div>
      </div>
    </Beat>
  )
}

const CARDS = [
  'What does the descending limb do?',
  'What does the ascending limb do?',
  'Why does the arrangement matter?',
  'What is countercurrent multiplication?',
  'Where does the steep gradient form?',
]

function DeckStage({ o, origin }: { o: number; origin?: Origin }) {
  return (
    <Beat o={o} origin={origin}>
      <div className="flex h-full items-center justify-center">
        <div className="relative h-full w-full">
          {CARDS.map((q, i) => {
            const mid = (CARDS.length - 1) / 2
            const off = i - mid
            return (
              // Two nested boxes on purpose: the OUTER one carries the
              // scroll-driven fan, the INNER one carries the hover lift. They
              // both animate `transform`, so sharing a node would mean the
              // scroll value overwrites the hover value every frame.
              <div
                key={q}
                className="absolute left-1/2 top-1/2 w-[min(56vw,220px)]"
                style={{
                  height: 'min(34svh,230px)',
                  // The deck LIFTS OFF the sheet rather than appearing on it:
                  // it rises as it fans, so the cards read as having been
                  // pulled out of the page you were just reading.
                  transform: `translate(-50%,-50%) translateX(${off * 34 * o}px) translateY(${(Math.abs(off) * -7 - 26) * o}px) rotate(${off * 6 * o}deg)`,
                  zIndex: 10 - Math.abs(Math.round(off)),
                }}
              >
                <div className="cardstock group flex h-full w-full flex-col justify-between rounded-xl p-4 transition-transform duration-300 ease-out hover:-translate-y-2.5 hover:rotate-[-1.5deg]">
                  <span className="setcode text-sun">Card {i + 1}</span>
                  <p className="text-[13.5px] font-semibold leading-snug text-ink">{q}</p>
                  <span className="setcode transition-colors group-hover:text-sun-deep">
                    p.31 · due today
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Beat>
  )
}

function TestStage({ o, origin }: { o: number; origin?: Origin }) {
  const options = [
    'It pumps salt out and holds water in',
    'It absorbs water and holds salt in',
    'It is impermeable to both',
    'It reverses only under load',
  ]
  return (
    <Beat o={o} origin={origin}>
      <div className="h-full py-6 pl-[clamp(16px,3vw,34px)]">
        <div className="setcode mb-3">Question 2 of 5</div>
        <p className="max-w-2xl text-[15.5px] font-semibold leading-snug text-ink">
          What does the ascending limb of the loop of Henle do?
        </p>
        <ul className="mt-4 flex max-w-xl flex-col gap-2">
          {options.map((opt, i) => (
            <li
              key={opt}
              className={cn(
                'flex items-center gap-2.5 rounded-[10px] border px-3 py-2 text-[13px]',
                // Options lift on hover. A quiz answer is a thing you pick up,
                // so it should move under the cursor before you commit.
                'transition-transform duration-200 ease-out hover:-translate-y-0.5',
                i === 0
                  ? 'border-mint/40 bg-mint-soft text-mint-deep'
                  : 'border-line text-muted hover:border-line-dash',
              )}
            >
              <span
                className={cn(
                  'grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                  i === 0 ? 'border-mint text-mint' : 'border-line-dash',
                )}
              >
                {i === 0 && <Icon name="check" size={10} />}
              </span>
              {opt}
            </li>
          ))}
        </ul>
      </div>
    </Beat>
  )
}

/* ── Close ─────────────────────────────────────────────────────────────
   The wordmark is set on ONE line and sits in the band above the figure's
   head rather than behind its body. Stacked over two lines it was buried:
   the figure covered the middle of both words and neither read. One line,
   higher up, and the whole thing is legible with the figure crossing only
   its lower edge. */

function Close() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>()

  // Front-loaded on purpose. These used to ramp across the first quarter of a
  // 220svh section, so the opening screen of the close was simply empty — a
  // large blank hold that read as the page having ended early.
  const copy = mapRange(progress, 0, 0.12, 0, 1)
  const press = mapRange(progress, 0.06, 0.55, 0, 1)
  // Starts only once this section is genuinely pinned. Beginning at ~0 meant
  // the figure was already climbing while the previous scene still owned the
  // screen, so its head appeared over the fold as a stray second cutout.
  const rise = mapRange(progress, 0.08, 0.42, 0, 1)

  return (
    <div ref={ref} className="relative h-[220svh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* Copy and figure get SEPARATE BANDS — they are never stacked.
            Layering them behind a scrim put the "Start free" button squarely
            on the reader's head, and no amount of scrim fixes type sitting on
            a face. A two-column grid guarantees they cannot collide: copy
            left, figure right. Below `lg` the grid stacks to two rows, copy
            above, figure below — still no overlap. */}
        <div
          className="relative z-30 mx-auto grid h-full w-full max-w-6xl grid-rows-[auto_1fr] px-5 sm:px-8 lg:grid-cols-[1fr_1fr] lg:grid-rows-1 lg:items-center lg:gap-8"
        >
          <div
            className="flex flex-col items-center gap-5 pt-[11svh] text-center lg:items-start lg:pt-0 lg:text-left"
            style={{ opacity: copy, transform: `translateY(${(1 - copy) * 22}px)` }}
          >
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
              Parked a full 100% below its own box until the rise starts, so it
              is completely out of frame rather than poking a head above the
              fold during the scene before this one — that early peek read as a
              second, smaller cutout. */}
          <div
            className="relative flex min-h-0 items-end justify-center lg:h-full lg:justify-end"
            style={{ transform: `translateY(${(1 - rise) * 100}%)` }}
          >
            <img
              src="/student-reading.webp"
              alt=""
              aria-hidden
              className="max-h-full max-w-full select-none object-contain object-bottom"
            />
          </div>
        </div>

        {/* Centering and animation live on DIFFERENT elements on purpose. Both
            used to sit on one node as `translateX(-50%)` in a class and a
            second `transform` inline — same CSS property, so the inline one
            silently destroyed the centering and both the wordmark and the
            figure drifted hundreds of pixels off axis. Flex centers the outer
            box; the inner box only ever carries the scroll transform. */}
        <div
          aria-hidden
          /* Sits BELOW the copy column, not behind it. At 13svh the stamp's
             top edge landed around the same y as the CTA, so "Start free"
             printed straight over the S of SPACE. The copy block is vertically
             centred, so dropping the stamp to the floor clears it at every
             viewport height while still leaving the left half of the wordmark
             in open space beside the figure. */
          className="pointer-events-none absolute inset-x-0 bottom-[2svh] z-0 flex justify-center"
          style={{ transform: `scale(${0.95 + press * 0.05})` }}
        >
          {/* FOIL STAMP, not an outline and not a mono wireframe.
              A hairline outline at this scale reads as a placeholder — thin,
              even, and lifeless. Real foil stamping is the opposite: the ink
              is only visible where light rakes across it, so the letterform
              brightens through the middle and falls away at both ends.

              That is exactly what a `background-clip: text` gradient does, and
              it is already this brand's own device (`.foil`). Set in the heavy
              display face at tight tracking so it reads as one designed
              lockup rather than spaced-out characters, and the whole sweep
              travels as you scroll, so the light moves across the metal
              instead of the type merely fading up. */}
          <span
            className="nameplate select-none whitespace-nowrap text-center text-[clamp(38px,11.5vw,196px)] leading-[0.86] tracking-[-0.035em]"
            style={{
              backgroundImage:
                'linear-gradient(100deg,' +
                'rgba(245,237,228,0.02) 18%,' +
                'rgba(255,197,61,0.10) 34%,' +
                'rgba(245,237,228,0.20) 46%,' +
                'rgba(53,214,232,0.10) 57%,' +
                'rgba(255,90,60,0.07) 68%,' +
                'rgba(245,237,228,0.02) 84%)',
              backgroundSize: '260% 100%',
              backgroundPosition: `${120 - press * 150}% 0`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Space Learn
          </span>
        </div>

        {/* No scrim here any more. It existed to keep the headline readable
            while the copy sat ON TOP of the figure — and its own top edge was
            a flat full-width band that hid the continuous lamp behind it,
            which is one of the seams that made the page read as slides. Now
            that copy and figure occupy separate columns, nothing overlaps, so
            the scrim has no job and the light runs uninterrupted. */}

        {/* One mark, bottom right. The page used to end with the wordmark three
            times over — stamped behind the figure, again as a corner label, and
            a third time in a footer under it. Repetition at the close reads as
            filler; the stamped one is the statement, so the others go. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-end px-5 pb-5 sm:px-8">
          <span className="setcode text-right">
            No card needed
            <br />
            Nothing to pay
          </span>
        </div>
      </div>
    </div>
  )
}
