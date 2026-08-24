/**
 * The middle of the landing page: one locked frame holding four columns.
 *
 * LAYOUT
 *
 * Four full-height columns standing side by side. The open one takes about
 * 60% of the width and shows the claim on the left with its diagram beside
 * it on the right; the other three collapse to a narrow spine carrying an
 * icon and a label set vertically. Pointing at a collapsed column opens it
 * and folds the previous one back down.
 *
 * (An earlier pass put the diagram BELOW the text, reasoning that a column
 * is tall and narrow so the vertical axis is where the room is. Measured
 * against a real desktop viewport, 60% of the page is wide, not narrow —
 * that version left the entire right two-thirds of the open column empty.
 * Side by side is what actually uses the space.)
 *
 * Headings are deliberately SHORT here — this predates the side-by-side fix
 * and remains true independent of it: a sentence like "One conversation
 * becomes your notes, your deck, your test" wraps to four ragged lines at
 * display size even at full column width. The long form of each claim moved
 * into the support line underneath, where it has room.
 *
 * WHY THIS SHAPE RATHER THAN FOUR SCROLL FRAMES
 *
 * Every earlier version gave each capability its own full-viewport element
 * and tried to make those elements hand off during scroll. Transparent
 * panels never covered each other (overlapping text); opaque ones covered
 * fine but drew a hard colour-to-colour line across the viewport where they
 * met (the seam that read as a rendering fault); extra wrapper height fixed
 * the overlap and opened dead scroll gaps instead. Four columns sharing one
 * frame cannot produce any of those: nothing stacks, nothing covers, nothing
 * meets anything at a moving edge.
 *
 * BORDERS
 *
 * The dividers are `--color-line` elsewhere in the app, which measures
 * 1.35:1 against this ground — technically present, visually absent, and the
 * reason the columns read as one undivided field. They use a dedicated
 * brighter edge at 3.25:1, clearing the 3:1 floor for meaningful non-text
 * boundaries, so the structure is legible before anything is hovered. The
 * open column swaps its edge for its own tone, which is what makes the
 * active state unmistakable.
 *
 * BACKGROUND AND COLOUR
 *
 * The frame is transparent — the page's single fixed `<Lamp/>` runs
 * continuously behind it, which is what `Landing.tsx`'s header rule asks
 * for. No column owns a slab of coloured ground. Identity arrives as a burst
 * of the column's colour when it opens, plus the lamp's ambient `--tint`.
 *
 * THE HANDOFF INTO Close — LOCKED, NOT RECEDING
 *
 * Three earlier versions all had this frame doing something as `Close`
 * arrived: scaling down, blurring, dimming — the idea being that a visibly
 * retreating plane sells depth better than a flat one Close just slides
 * over. Fed back plainly: the frame should not move or fade at all; it
 * should stay exactly as it is, locked, while `Close` — fully opaque —
 * physically rises up and covers it. The covering itself is what does the
 * work; a frame trying to ALSO animate away underneath an incoming opaque
 * panel was two motions competing for the same visual moment, and one of
 * them (this one) was invisible the instant Close's edge passed over it
 * anyway — motion nobody could ever actually see, spent on it regardless.
 *
 * So: this component now owns the scroll measurement itself. `ref` is
 * `position: relative`, `172svh` tall — 100svh for the sticky content plus
 * 72svh of genuine scroll room — and the inner content is `position:
 * sticky; top: 0`, which is what makes it read as LOCKED: once reached, it
 * holds at the top of the viewport for the full 72svh that follows, not
 * receding, not fading, just present, while `Close` (rendered separately,
 * fixed, in `Landing.tsx`) rises over it. `useScrollProgress` on this same
 * wrapper produces `closeProgress`, reported upward through
 * `onCloseProgress` so `Close` can track the identical number rather than
 * two components independently guessing at the same scroll position.
 */

import { useEffect, useRef, useState } from 'react'
import { useScrollProgress } from '../../lib/useScrollProgress'
import { gsap } from 'gsap'
import { Icon, type IconName } from '../../components/ui/Icon'
import { useReducedMotion } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { lenisRef } from './SmoothScroll'

type Tone = 'sky' | 'sun' | 'mint' | 'coral'

type Feature = {
  tone: Tone
  icon: IconName
  label: string
  heading: string
  support: string
}

const FEATURES: Feature[] = [
  {
    tone: 'sky',
    icon: 'doc',
    label: 'Retrieval',
    heading: 'Every answer names its page.',
    support:
      "Ask anything about what you've uploaded. It only draws on what your material actually says, and it always says where it found it.",
  },
  {
    tone: 'sun',
    icon: 'deck',
    label: 'The hand-off',
    heading: 'One chat. Notes, deck, test.',
    support:
      'No separate app, nothing to re-type. The conversation that explained it becomes the note, the deck and the quiz about it.',
  },
  {
    tone: 'mint',
    icon: 'skill',
    label: 'Skills',
    heading: 'You pick how it teaches.',
    support:
      "Socratic Tutor won't hand you the answer. Exam Cram runs rapid-fire. Same material, your way through it — set per topic.",
  },
  {
    tone: 'coral',
    icon: 'flame',
    label: 'Progress',
    heading: 'Your streak is real.',
    support:
      "Or it doesn't move. The streak, the cards due, the quiz average — every number is pulled from what you actually did.",
  },
]

const TONE_HEX: Record<Tone, string> = {
  sky: '#35d6e8',
  sun: '#ffc53d',
  mint: '#b8ff3c',
  coral: '#ff3d8b',
}
const TONE_TEXT: Record<Tone, string> = {
  sky: 'text-sky',
  sun: 'text-sun',
  mint: 'text-mint',
  coral: 'text-coral',
}
/* Dim "R G B" triples the fixed `<Lamp/>` reads off `--tint` (Landing.tsx). */
const TONE_TINT: Record<Tone, string> = {
  sky: '20 55 60',
  sun: '62 46 18',
  mint: '42 58 18',
  coral: '60 20 40',
}

/** 3.25:1 on the page ground — see the header note on borders. */
const EDGE = '#7a6858'

export function FeatureType({
  onCloseProgress,
}: {
  onCloseProgress: (p: number) => void
}) {
  const { ref, progress: closeProgress } = useScrollProgress<HTMLDivElement>()
  const [open, setOpen] = useState(0)
  const reduced = useReducedMotion()

  // Reported upward rather than owned by `Landing()` — see the header note:
  // this component now measures its own scroll room, and `Close` tracks the
  // identical number through this callback instead of a shared hook call.
  useEffect(() => {
    onCloseProgress(closeProgress)
  }, [closeProgress, onCloseProgress])

  // `--tint` recolours the pointer-following lamp glow in `Landing.tsx` — a
  // history of exactly how NOT to gate this lives in git blame on this
  // line; the short version is that watching element geometry always left
  // some lag between "the content is gone" and "the observer noticed".
  // With `closeProgress` continuous, the direct fix: a coarse
  // IntersectionObserver just for "are we roughly in this part of the
  // page" (keeps the tint off before the section has ever been reached),
  // gated by `closeProgress < 0.5` so the tint hands off to `Close`'s own
  // (see `Landing.tsx`) once the scrub is more than halfway to landed
  // rather than lingering until the very last pixel.
  const [nearby, setNearby] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setNearby(e.isIntersecting), {
      threshold: 0.05,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const inView = nearby && closeProgress < 0.5

  useEffect(() => {
    if (!inView) {
      document.documentElement.style.removeProperty('--tint')
      return
    }
    document.documentElement.style.setProperty('--tint', TONE_TINT[FEATURES[open].tone])
    return () => {
      document.documentElement.style.removeProperty('--tint')
    }
  }, [open, inView])

  // MAGNETIC ENTRY. Approaching this section on a mouse wheel — discrete
  // notches, not a continuous gesture — a scroll can settle a few dozen
  // pixels short of the frame's own edge, and the visitor is left looking
  // at a sliver of Hero with the pinned frame not quite engaged. This pulls
  // the rest of the way in: once wheel input has been idle for 160ms (the
  // scroll has genuinely settled, not mid-gesture), if the frame's top edge
  // is within a quarter-viewport of the current scroll position, animate
  // the remaining distance through Lenis — never a raw `window.scrollTo`,
  // which would fight Lenis's own virtual position rather than move it.
  //
  // Directional and one-way on purpose. Only engages while scrolling DOWN
  // (`deltaY > 0`) toward a frame that hasn't been reached yet (`rect.top >
  // 0`) — a visitor scrolling back UP, away from the section, is not
  // magnetically dragged back into it against their own gesture. Skipped
  // entirely once inside the frame's own scroll room (`rect.top <= 0`):
  // the pull is for arriving at the edge, not a tether while exploring.
  useEffect(() => {
    if (reduced) return
    const el = ref.current
    if (!el) return
    const SNAP_ZONE = window.innerHeight * 0.28
    let goingDown = false
    let timer: number | undefined

    const onWheel = (e: WheelEvent) => {
      goingDown = e.deltaY > 0
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const lenis = lenisRef.current
        if (!lenis || !goingDown) return
        const rect = el.getBoundingClientRect()
        if (rect.top > 0 && rect.top < SNAP_ZONE) {
          lenis.scrollTo(el, { duration: 0.85, easing: (t: number) => 1 - Math.pow(1 - t, 3) })
        }
      }, 160)
    }

    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      if (timer) window.clearTimeout(timer)
    }
  }, [reduced])

  /* Reduced motion gets the whole argument as a plain stack — no collapsing,
     no pinning, every capability legible without an interaction. */
  if (reduced) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-20 px-6 py-24 sm:px-10">
        {FEATURES.map((f, i) => (
          <Body key={f.label} feature={f} index={i} open reduced />
        ))}
      </div>
    )
  }

  return (
    // `172svh` — 100svh of pinned content plus 72svh of genuine scroll room
    // — is what `useScrollProgress` measures against to produce
    // `closeProgress`. The inner block is `sticky top-0`, so it holds the
    // full viewport, unmoving, for that entire 72svh of scroll: locked, not
    // receding, exactly as asked. `Close` (a `position: fixed` overlay in
    // `Landing.tsx`) rises over it on the same scroll gesture.
    <div ref={ref} className="relative h-[172svh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* The frame's own top and bottom edges, so the band reads as a
            deliberate object rather than as content that happens to be
            there. Thickened from the default 1px to 2px — 1px measured
            3.25:1 in colour contrast but read as a hairline at this scale,
            closer to decoration than structure. */}
        <div
          className="flex h-full flex-col border-y-2 lg:flex-row"
          style={{ borderColor: EDGE }}
        >
          {FEATURES.map((f, i) => (
            <Column
              key={f.label}
              feature={f}
              index={i}
              isOpen={open === i}
              isLast={i === FEATURES.length - 1}
              onOpen={() => setOpen(i)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Column({
  feature: f,
  index,
  isOpen,
  isLast,
  onOpen,
}: {
  feature: Feature
  index: number
  isOpen: boolean
  isLast: boolean
  onOpen: () => void
}) {
  /* Bumped each time this column opens, so the arrival burst is a fresh
     element with a fresh animation rather than a finished one restarted. */
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    if (isOpen) setBeat((b) => b + 1)
  }, [isOpen])

  return (
    <button
      type="button"
      /* Hover for pointers, focus for keyboards, click for touch. Hover alone
         would make this unreachable by keyboard and dead on a phone. */
      onMouseEnter={onOpen}
      onFocus={onOpen}
      onClick={onOpen}
      aria-expanded={isOpen}
      className={cn(
        'group relative min-h-0 min-w-0 cursor-pointer overflow-hidden text-left',
        !isLast && 'border-b-2 lg:border-b-0 lg:border-r-2',
        'transition-[flex-grow,border-color] duration-700 ease-[var(--ease-out-expo)]',
      )}
      style={{
        flexGrow: isOpen ? 3.6 : 0.8,
        flexBasis: 0,
        // Every column carries ITS OWN tone at all times now, not the
        // neutral EDGE colour while closed — a dim wash of the tone at rest,
        // full strength once open, so the four dividers read as four
        // colours from the first frame rather than only revealing colour on
        // hover.
        borderColor: isOpen ? `${TONE_HEX[f.tone]}b0` : `${TONE_HEX[f.tone]}4a`,
      }}
    >
      {/* THE PUNCH — this column's colour blooming and burning off as it
          opens. The only colour it ever carries; it never keeps a fill. */}
      {isOpen && (
        <div
          key={beat}
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(46ch 44ch at 34% 40%, ${TONE_HEX[f.tone]}30 0%, transparent 66%)`,
            animation: 'featureBeat 1100ms var(--ease-out-expo) both',
          }}
        />
      )}

      {/* COLLAPSED — the spine. Vertical on desktop where the column is a
          narrow strip; horizontal below `lg`, where the layout stacks and
          each one is a wide short row instead. */}
      <div
        className="absolute inset-0 flex items-center gap-4 px-6 transition-opacity duration-300 lg:flex-col lg:justify-center lg:px-0 lg:py-12"
        style={{ opacity: isOpen ? 0 : 1, pointerEvents: isOpen ? 'none' : undefined }}
      >
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors"
          style={{ borderColor: `${TONE_HEX[f.tone]}66`, color: TONE_HEX[f.tone] }}
        >
          <Icon name={f.icon} size={18} />
        </span>
        <span className="nameplate whitespace-nowrap text-[18px] text-ink-3 transition-colors group-hover:text-ink lg:rotate-180 lg:[writing-mode:vertical-rl]">
          {f.label}
        </span>
      </div>

      {/* OPEN — the claim and its diagram, stacked down the column. */}
      <div
        className="relative h-full transition-opacity duration-500"
        style={{ opacity: isOpen ? 1 : 0, transitionDelay: isOpen ? '150ms' : '0ms' }}
      >
        <Body feature={f} index={index} open={isOpen} reduced={false} />
      </div>

      <style>{`
        @keyframes featureBeat {
          0%   { opacity: 0; transform: scale(0.84); }
          30%  { opacity: 1; transform: scale(1.03); }
          100% { opacity: 0; transform: scale(1.28); }
        }
      `}</style>
    </button>
  )
}

/** An opened column's content — shared with the reduced-motion stack. */
function Body({
  feature: f,
  index,
  open,
  reduced,
}: {
  feature: Feature
  index: number
  open: boolean
  reduced: boolean
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || reduced) return
    const el = root.current
    if (!el) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.14 })
      tl.fromTo('[data-label]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4 }, 0)
      tl.fromTo(
        '[data-word]',
        { opacity: 0, yPercent: 106, rotateX: -55 },
        { opacity: 1, yPercent: 0, rotateX: 0, duration: 0.75, stagger: 0.045 },
        0.04,
      )
      tl.fromTo('[data-support]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, 0.26)
    }, el)
    return () => ctx.revert()
  }, [open, reduced])

  const words = f.heading.split(' ')

  return (
    <div
      ref={root}
      // Text left, diagram right — a two-track grid rather than a stack. The
      // earlier version stacked them because it assumed an open column was
      // narrow; measured against a real desktop viewport it's ~60% of the
      // page, wide enough that stacking just left the whole right two-thirds
      // of the column empty (visible in the screenshot that prompted this).
      className="grid h-full grid-cols-1 items-center gap-8 px-7 py-10 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:px-14"
    >
      <div className="max-w-[34ch]">
        <span data-label className="setcode block text-[13px]" style={{ color: TONE_HEX[f.tone] }}>
          {f.label}
        </span>
        <h2
          className={cn(
            'nameplate mt-4 text-[clamp(38px,5.6vw,88px)] leading-[0.94]',
            TONE_TEXT[f.tone],
          )}
          style={{ perspective: 900 }}
        >
          {words.map((w, i) => (
            <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.06em] align-bottom">
              <span data-word className="inline-block" style={{ transformOrigin: 'top center' }}>
                {w}
              </span>
              {i < words.length - 1 && ' '}
            </span>
          ))}
        </h2>
        <p data-support className="mt-5 max-w-[46ch] text-[16px] leading-relaxed text-ink-2">
          {f.support}
        </p>
      </div>

      {/* The diagram's own track, filling the second half of the grid. */}
      <div className="relative hidden h-full min-h-0 items-center lg:flex">
        <FrameArt tone={f.tone} index={index} active={open} reduced={reduced} />
      </div>
    </div>
  )
}

/* ── The diagrams ──────────────────────────────────────────────────────
   One per capability, showing what that capability actually does. Generic
   shapes and real product labels only — no invented course, page number or
   quoted passage, because a fabricated document reads as a mock-up rather
   than as proof. */

function FrameArt({
  tone,
  index,
  active,
  reduced,
}: {
  tone: Tone
  index: number
  active: boolean
  reduced: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active || reduced) return
    const el = ref.current
    if (!el) return
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, delay: 0.24 })
      switch (index) {
        case 0:
          tl.fromTo(
            '[data-line]',
            { scaleX: 0, opacity: 0 },
            { scaleX: 1, opacity: 1, duration: 0.6, stagger: 0.045, transformOrigin: 'left center' },
          )
          tl.fromTo('[data-glow]', { opacity: 0 }, { opacity: 1, duration: 0.4 }, '-=0.2')
          tl.fromTo(
            '[data-chip]',
            { opacity: 0, y: 12, scale: 0.92 },
            { opacity: 1, y: 0, scale: 1, duration: 0.5 },
            '-=0.15',
          )
          break
        case 1:
          tl.fromTo('[data-seed]', { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.5 })
          tl.fromTo(
            '[data-shard]',
            { x: 0, y: 0, opacity: 0, rotate: 0 },
            {
              opacity: 1,
              duration: 0.65,
              stagger: 0.08,
              x: (i: number) => [-86, 0, 86][i],
              y: (i: number) => [36, 88, 24][i],
              rotate: (i: number) => [-7, 2, 8][i],
            },
            '-=0.2',
          )
          tl.to('[data-seed]', { opacity: 0.16, scale: 0.86, duration: 0.45 }, '-=0.45')
          break
        case 2:
          tl.fromTo('[data-skill]', { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.55, stagger: 0.08 })
          tl.fromTo('[data-dot]', { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(2.4)' }, '-=0.25')
          break
        default:
          tl.fromTo(
            '[data-bar]',
            { scaleY: 0 },
            { scaleY: 1, duration: 0.6, stagger: 0.05, transformOrigin: 'bottom center' },
          )
          tl.fromTo(
            { v: 0 },
            { v: 0 },
            {
              v: 26,
              duration: 0.85,
              ease: 'power2.out',
              onUpdate() {
                const node = el.querySelector('[data-count]')
                if (node) node.textContent = String(Math.round(this.targets()[0].v))
              },
            },
            '-=0.45',
          )
      }
    }, el)
    return () => ctx.revert()
  }, [active, index, reduced])

  return (
    <div ref={ref} className="absolute inset-0 flex items-center">
      {index === 0 && <RetrievalArt tone={tone} />}
      {index === 1 && <HandoffArt tone={tone} />}
      {index === 2 && <SkillsArt tone={tone} />}
      {index === 3 && <StreakArt tone={tone} />}
    </div>
  )
}

/** A page of prose, one line igniting and naming where it came from. */
function RetrievalArt({ tone }: { tone: Tone }) {
  const widths = ['92%', '78%', '86%', '64%', '88%']
  return (
    <div className="w-full max-w-[440px]">
      <div className="flex flex-col gap-2.5">
        {widths.map((w, i) => (
          <div key={i} className="relative">
            <div
              data-line
              className="h-[7px] rounded-full"
              style={{ width: w, background: i === 3 ? TONE_HEX[tone] : '#3b3028' }}
            />
            {i === 3 && (
              <div
                data-glow
                aria-hidden
                className="pointer-events-none absolute -inset-x-4 -inset-y-3"
                style={{ background: `radial-gradient(closest-side, ${TONE_HEX[tone]}33, transparent)` }}
              />
            )}
          </div>
        ))}
      </div>
      <div
        data-chip
        className="mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
        style={{ borderColor: `${TONE_HEX[tone]}55`, background: `${TONE_HEX[tone]}14` }}
      >
        <Icon name="doc" size={12} style={{ color: TONE_HEX[tone] }} />
        <span className="setcode" style={{ color: TONE_HEX[tone] }}>
          cited · page 14
        </span>
      </div>
    </div>
  )
}

/** One thing becoming three. */
function HandoffArt({ tone }: { tone: Tone }) {
  const shards: { icon: IconName; label: string }[] = [
    { icon: 'note', label: 'Note' },
    { icon: 'deck', label: 'Deck' },
    { icon: 'quiz', label: 'Quiz' },
  ]
  return (
    <div className="relative h-[300px] w-full max-w-[420px]">
      <div
        data-seed
        className="absolute left-1/2 top-1 h-[68px] w-[68px] -translate-x-1/2 rounded-[16px] border"
        style={{ borderColor: `${TONE_HEX[tone]}66`, background: `${TONE_HEX[tone]}18` }}
      />
      {shards.map((s) => (
        <div
          key={s.label}
          data-shard
          className="cardstock absolute left-1/2 top-1 flex w-[104px] -translate-x-1/2 flex-col gap-1.5 rounded-[13px] p-2.5"
        >
          <Icon name={s.icon} size={13} style={{ color: TONE_HEX[tone] }} />
          <span className="text-[11.5px] font-semibold text-ink">{s.label}</span>
          <div className="h-1 w-3/5 rounded-full bg-line" />
        </div>
      ))}
    </div>
  )
}

/** Three teaching styles; one of them switched on. */
function SkillsArt({ tone }: { tone: Tone }) {
  const skills = ['Socratic Tutor', 'Exam Cram', 'Debugging Mentor']
  return (
    <div className="flex w-full max-w-[420px] flex-col gap-2.5">
      {skills.map((s, i) => (
        <div
          key={s}
          data-skill
          className="flex items-center justify-between gap-3 rounded-[12px] border px-3.5 py-2.5"
          style={
            i === 0
              ? { borderColor: `${TONE_HEX[tone]}66`, background: `${TONE_HEX[tone]}16` }
              : { borderColor: 'var(--color-line)', background: 'var(--color-surface)' }
          }
        >
          <span
            className="text-[13px] font-semibold"
            style={{ color: i === 0 ? TONE_HEX[tone] : 'var(--color-ink-3)' }}
          >
            {s}
          </span>
          {i === 0 ? (
            <span
              data-dot
              className="grid h-[18px] w-[18px] place-items-center rounded-full"
              style={{ background: TONE_HEX[tone], color: '#152608' }}
            >
              <Icon name="check" size={10} />
            </span>
          ) : (
            <span className="h-[18px] w-[18px] rounded-full border border-line-dash" />
          )}
        </div>
      ))}
    </div>
  )
}

/** Days that actually happened. */
function StreakArt({ tone }: { tone: Tone }) {
  const days = [0.35, 0.7, 0.5, 1, 0.28, 0.82, 0.62, 0.44, 0.9, 0.55]
  return (
    <div className="w-full max-w-[420px]">
      <div className="flex items-center gap-3">
        <Icon name="flame" size={22} style={{ color: TONE_HEX[tone] }} />
        <span className="nameplate text-[44px] leading-none text-ink" data-count>
          0
        </span>
        <span className="setcode mb-1 self-end">days</span>
      </div>
      <div className="mt-5 flex h-[110px] items-end gap-2">
        {days.map((v, i) => (
          <div
            key={i}
            data-bar
            className="flex-1 rounded-t-[4px]"
            style={{
              height: `${v * 100}%`,
              background: i === 3 || i === 8 ? TONE_HEX[tone] : `${TONE_HEX[tone]}3d`,
            }}
          />
        ))}
      </div>
      <div className="ruled-datum" />
    </div>
  )
}
