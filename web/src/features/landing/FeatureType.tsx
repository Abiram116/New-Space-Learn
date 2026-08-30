/**
 * The middle of the landing page: one locked frame holding five columns.
 *
 * LAYOUT
 *
 * Five full-height columns standing side by side. The open one takes about
 * 55% of the width and shows the claim on the left with its diagram beside
 * it on the right; the other four collapse to a narrow spine carrying an
 * icon and a label set vertically. Pointing at a collapsed column opens it
 * and folds the previous one back down.
 *
 * (An earlier pass put the diagram BELOW the text, reasoning that a column
 * is tall and narrow so the vertical axis is where the room is. Measured
 * against a real desktop viewport, most of the page is wide, not narrow —
 * that version left the entire right two-thirds of the open column empty.
 * Side by side is what actually uses the space.)
 *
 * FIVE STAGES, NOT FOUR. Retrieval and The Hand-off were already here.
 * Rehearse and Student Model are new — Rehearse shows a real flashcard
 * grading interaction instead of nothing, and Student Model replaces a
 * generic streak/day-count chart that never demonstrated the product's
 * actual differentiator: weak-topic detection derived from real quiz
 * evidence. Skills stays last, unchanged in substance.
 *
 * MOBILE SHOWS THE DIAGRAMS TOO. They used to be `hidden lg:flex` — a phone
 * visitor got a heading and one line of body copy and never saw a single
 * demonstration. Below `lg` the diagram now renders under the text instead
 * of beside it, at a reduced but real size — simplified, never hidden.
 *
 * NO MAGNETIC SNAP. A wheel-based auto-scroll used to pull the page the
 * rest of the way into this frame once it got close. Removed: native
 * scrolling should behave like native scrolling, and nothing about reaching
 * a sticky-pinned frame requires a scroll-jack to work correctly.
 *
 * WHY THIS SHAPE RATHER THAN FIVE SCROLL FRAMES
 *
 * Every earlier version gave each capability its own full-viewport element
 * and tried to make those elements hand off during scroll. Transparent
 * panels never covered each other (overlapping text); opaque ones covered
 * fine but drew a hard colour-to-colour line across the viewport where they
 * met (the seam that read as a rendering fault); extra wrapper height fixed
 * the overlap and opened dead scroll gaps instead. Columns sharing one frame
 * cannot produce any of those: nothing stacks, nothing covers, nothing meets
 * anything at a moving edge.
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
 * `ref` is `position: relative`, `104svh` tall — 100svh for the sticky
 * content plus a thin margin so the pin doesn't let go mid-hover — and the
 * inner content is `position: sticky; top: 14 (below the fixed nav)`, which
 * is what makes it read as LOCKED. Was 150svh, then 112svh, now cut to as
 * little margin as the sticky mechanism needs: direct feedback, twice, that
 * scrolling once you'd already picked a column moved nothing on screen and
 * felt like dead scrollbar.
 *
 * THIS COMPONENT NO LONGER MEASURES `closeProgress`. It used to — `Close`
 * (rendered separately, fixed, in `Landing.tsx`) tracked this same
 * wrapper's scroll distance so the pinned frame and the fixed panel that
 * rises over it shared one number. That coupling broke the moment
 * `Differentiator` needed to sit, fully visible, IN BETWEEN this frame and
 * `Close`: `Close` is `position: fixed`, so once its measured progress hits
 * 1 it covers the viewport permanently regardless of what's further down
 * the document — anything placed after this element in the DOM would be
 * scrolled to, but never actually seen, hidden behind an already-landed
 * panel. `Close`'s measurement now lives on a dedicated spacer in
 * `Landing.tsx` (`CloseReveal`), positioned after `Differentiator` instead
 * of wrapped around this frame, so the panel stays fully hidden until the
 * visitor has scrolled past both this frame AND the differentiator beat.
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { Icon, type IconName } from '../../components/ui/Icon'
import { useReducedMotion } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { Threads } from './wow'

type Tone = 'sky' | 'sun' | 'mint' | 'azure' | 'coral'

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
    icon: 'refresh',
    label: 'Rehearse',
    heading: 'Graded once. Timed right.',
    support:
      'Grade a card honestly and the schedule adjusts on the spot — easier cards drift further out, ones you missed come straight back.',
  },
  {
    tone: 'azure',
    icon: 'target',
    label: 'Student model',
    heading: 'It knows what you skipped.',
    support:
      'Weak spots and improving ones are pulled from your actual quiz scores, not a guess — and the next thing it explains accounts for both.',
  },
  {
    tone: 'coral',
    icon: 'skill',
    label: 'Skills',
    heading: 'You pick how it teaches.',
    support:
      "Socratic Tutor won't hand you the answer. Exam Cram runs rapid-fire. Same material, your way through it — set per topic.",
  },
]

const TONE_HEX: Record<Tone, string> = {
  sky: '#35d6e8',
  sun: '#ffc53d',
  mint: '#b8ff3c',
  azure: '#5590ff',
  coral: '#ff3d8b',
}
const TONE_TEXT: Record<Tone, string> = {
  sky: 'text-sky',
  sun: 'text-sun',
  mint: 'text-mint',
  azure: 'text-azure',
  coral: 'text-coral',
}
/* Dim "R G B" triples the fixed `<Lamp/>` reads off `--tint` (Landing.tsx). */
const TONE_TINT: Record<Tone, string> = {
  sky: '20 55 60',
  sun: '62 46 18',
  mint: '42 58 18',
  azure: '22 34 56',
  coral: '60 20 40',
}

/** Deliberately faint now — a hairline suggestion of the frame, not a hard rule. */
const EDGE = '#7a685835'

export function FeatureType() {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(0)
  const reduced = useReducedMotion()

  // `--tint` recolours the pointer-following lamp glow in `Landing.tsx`.
  // This used to be gated on `closeProgress < 0.5` because `Close`'s own
  // reveal used to be measured off this exact element — no longer true
  // (see `Landing.tsx`'s `CloseReveal`, which now owns that measurement on
  // a dedicated spacer placed after `Differentiator`), so a plain
  // IntersectionObserver is the whole story: tint on while this frame is
  // roughly in view, off once it isn't. The gap between here and `Close`
  // landing (while `Differentiator` is on screen) is deliberately untinted
  // — that beat doesn't need the lamp's colour to change under it.
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

  useEffect(() => {
    if (!nearby) {
      document.documentElement.style.removeProperty('--tint')
      return
    }
    document.documentElement.style.setProperty('--tint', TONE_TINT[FEATURES[open].tone])
    return () => {
      document.documentElement.style.removeProperty('--tint')
    }
  }, [open, nearby])

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
    // `104svh` — as close to the 100svh of actual pinned content as the
    // sticky mechanism can get: a few svh of margin so it doesn't release
    // mid-hover, not a deliberate "explore room" pause (that used to be
    // 150svh / a 50svh margin — cut hard, twice now, on direct feedback that
    // scrolling once you'd already picked a column moved nothing on screen).
    // No longer measured for `closeProgress` — see the header note.
    <div ref={ref} className="relative h-[104svh]">
      <div className="sticky top-14 h-[calc(100svh-3.5rem)] overflow-hidden">
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
        // Collapsed columns get a fixed, generous minimum height on mobile
        // (a stacked row still needs room for icon + label) but the OPEN
        // column is the one that should actually grow — `flex-grow` alone
        // handles that in the vertical-stack layout below `lg`.
        !isOpen && 'min-h-[76px] lg:min-h-0',
      )}
      style={{
        flexGrow: isOpen ? 6 : 0.6,
        flexBasis: 0,
        // Every column carries ITS OWN tone at all times now, not the
        // neutral EDGE colour while closed — a dim wash of the tone at rest,
        // full strength once open, so the dividers read as five colours from
        // the first frame rather than only revealing colour on hover.
        borderColor: isOpen ? `${TONE_HEX[f.tone]}45` : `${TONE_HEX[f.tone]}20`,
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

      {/* OPEN — the claim and its diagram, stacked down the column.
          `overflow-y-auto` below `lg` only: a stacked mobile row has a
          fixed, tight height budget (the five rows share one 100svh
          frame), and now that the diagram renders on every breakpoint
          instead of being hidden, some phones at larger text-zoom genuinely
          don't have room for heading + copy + diagram without it. A
          contained scroll inside the open row is the honest fallback —
          nothing is clipped or lost, and it never touches the page's own
          scroll. Desktop has the whole sticky viewport height and never
          needs it. */}
      <div
        className="relative h-full overflow-y-auto transition-opacity duration-500 lg:overflow-visible"
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
      // Text left, diagram right on desktop; text ABOVE diagram below `lg`
      // rather than the diagram disappearing entirely — a phone visitor
      // used to get heading + one line of body copy and nothing that
      // actually showed the capability. `min-h-0` on the diagram track
      // keeps it from forcing the column taller than the viewport when the
      // whole thing is a vertical stack.
      className="grid grid-cols-1 gap-4 px-6 py-5 sm:gap-6 sm:px-10 sm:py-7 lg:h-full lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-10 lg:px-14 lg:py-10"
    >
      <div className="max-w-[32ch]">
        <span data-label className="setcode block text-[13px]" style={{ color: TONE_HEX[f.tone] }}>
          {f.label}
        </span>
        <h2
          className={cn(
            'nameplate mt-2 text-[clamp(24px,4.1vw,58px)] leading-[0.98] sm:mt-4 sm:leading-[0.94]',
            TONE_TEXT[f.tone],
          )}
          style={{ perspective: 900 }}
        >
          {words.map((w, i) => (
            <Fragment key={`${w}-${i}`}>
              <span className="inline-block overflow-hidden pb-[0.06em] align-bottom">
                <span data-word className="inline-block" style={{ transformOrigin: 'top center' }}>
                  {w}
                </span>
              </span>
              {i < words.length - 1 && ' '}
            </Fragment>
          ))}
        </h2>
        <p data-support className="mt-3 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2 sm:mt-5 sm:text-[15px] lg:text-[16px]">
          {f.support}
        </p>
      </div>

      {/* The diagram's own track — a fixed, reduced height below `lg` so it
          reads as a real illustration rather than the empty space it used
          to be, and full column height at `lg` and up. */}
      <div className="relative flex h-[295px] min-h-0 shrink-0 items-center overflow-hidden sm:h-[320px] lg:h-full lg:overflow-visible">
        <FrameArt tone={f.tone} index={index} active={open} reduced={reduced} />
      </div>
    </div>
  )
}

/* ── The diagrams ──────────────────────────────────────────────────────
   One per capability, showing what that capability actually does. Generic
   shapes and real product labels only — no invented course, page number or
   quoted passage, because a fabricated document reads as a mock-up rather
   than as proof. Every diagram renders at every breakpoint now — nothing is
   `hidden` below `lg`, only smaller. */

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
          tl.fromTo('[data-rcard]', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 })
          tl.fromTo(
            '[data-qbubble]',
            { opacity: 0, y: 8 },
            { opacity: 1, y: 0, duration: 0.4 },
            '-=0.2',
          )
          tl.fromTo(
            '[data-line]',
            { scaleX: 0, opacity: 0 },
            { scaleX: 1, opacity: 1, duration: 0.5, stagger: 0.06, transformOrigin: 'left center' },
            '-=0.05',
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
          // Handled by HandoffArt's own effect — it needs to drive React
          // state (Threads' `progress` prop), which a plain GSAP DOM
          // timeline can't do. See that component.
          break
        case 2:
          tl.fromTo('[data-rcard]', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 })
          tl.fromTo(
            '[data-rgrade]',
            { opacity: 0, scale: 0.9 },
            { opacity: 1, scale: 1, duration: 0.4, stagger: 0.06 },
            '-=0.2',
          )
          break
        case 3:
          tl.fromTo('[data-scard]', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5 })
          tl.fromTo(
            '[data-schip]',
            { opacity: 0, y: 8 },
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.12 },
            '-=0.2',
          )
          tl.fromTo('[data-sarrow]', { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.35 })
          tl.fromTo(
            '[data-snext]',
            { opacity: 0, y: 8, scale: 0.96 },
            { opacity: 1, y: 0, scale: 1, duration: 0.4 },
            '-=0.1',
          )
          break
        default:
          tl.fromTo('[data-skill]', { opacity: 0, x: 24 }, { opacity: 1, x: 0, duration: 0.55, stagger: 0.08 })
          tl.fromTo('[data-dot]', { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(2.4)' }, '-=0.25')
      }
    }, el)
    return () => ctx.revert()
  }, [active, index, reduced])

  return (
    <div ref={ref} className="absolute inset-0 flex items-center">
      {index === 0 && <RetrievalArt tone={tone} />}
      {index === 1 && <HandoffArt tone={tone} active={active} reduced={reduced} />}
      {index === 2 && <RehearseArt tone={tone} active={active} reduced={reduced} />}
      {index === 3 && <StudentModelArt tone={tone} />}
      {index === 4 && <SkillsArt tone={tone} />}
    </div>
  )
}

/**
 * MATERIAL → QUESTION → GROUNDED ANSWER → SOURCE, as one card instead of an
 * abstract page of lines — the same question that comes back as a flashcard
 * in Rehearse, so the two stages read as one continuous study session
 * rather than two unrelated illustrations.
 */
function RetrievalArt({ tone }: { tone: Tone }) {
  const widths = ['88%', '70%', '94%']
  return (
    <div data-rcard className="cardstock w-full max-w-[460px] rounded-[14px] px-5 py-5">
      <div className="flex items-center gap-2 text-ink-3">
        <Icon name="doc" size={13} />
        <span className="setcode text-[10.5px]">Your material</span>
      </div>
      <div data-qbubble className="mt-3 flex items-start gap-2.5 rounded-[10px] bg-line-soft px-3.5 py-2.5">
        <Icon name="chat" size={14} className="mt-0.5 shrink-0 text-ink-3" />
        <span className="text-[13.5px] leading-snug text-ink-2">
          What does the ascending limb of the loop do?
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {widths.map((w, i) => (
          <div key={i} className="relative">
            <div
              data-line
              className="h-[8px] rounded-full"
              style={{ width: w, background: i === 1 ? TONE_HEX[tone] : '#3b3028' }}
            />
            {i === 1 && (
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
        className="mt-4 inline-flex items-center gap-2 rounded-full border px-3.5 py-2"
        style={{ borderColor: `${TONE_HEX[tone]}55`, background: `${TONE_HEX[tone]}14` }}
      >
        <Icon name="doc" size={13} style={{ color: TONE_HEX[tone] }} />
        <span className="text-[12.5px] font-semibold" style={{ color: TONE_HEX[tone] }}>
          Cited · page 14
        </span>
      </div>
    </div>
  )
}

/**
 * THE HAND-OFF, made real. One conversation, in sequence, becoming a note,
 * a card and a quiz question — each rendered with the app's own card
 * surface (`.cardstock`, the same treatment a real flashcard or deck tile
 * uses), not a generic labelled box. `Threads` (`wow.tsx`) draws the
 * connecting line between each pair exactly while that hand-off happens,
 * then lets it fade — a thread that stayed on screen permanently would be
 * decoration; one that appears exactly as one thing becomes the next is the
 * explanation. `Threads` takes a continuous 0→1 `progress` (it computes its
 * own fade-in/fade-out from that single number), so this drives four short
 * value ramps — one per hop, GSAP-tweened, `onUpdate` into local state —
 * rather than the imperative-only style the rest of this file uses; the
 * cost is a few dozen re-renders confined to one diagram over about two
 * seconds when a column opens, not a page-wide continuous effect.
 */
function HandoffArt({ tone, active, reduced }: { tone: Tone; active: boolean; reduced: boolean }) {
  const [hop, setHop] = useState([0, 0, 0])
  const wrapRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setRect({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!active) {
      setHop([0, 0, 0])
      return
    }
    if (reduced) {
      setHop([1, 1, 1])
      return
    }
    const state = { a: 0, b: 0, c: 0 }
    const tl = gsap.timeline({ delay: 0.2 })
    tl.to(state, {
      a: 1,
      duration: 0.5,
      ease: 'power1.inOut',
      onUpdate: () => setHop([state.a, state.b, state.c]),
    })
    tl.to(
      state,
      { b: 1, duration: 0.5, ease: 'power1.inOut', onUpdate: () => setHop([state.a, state.b, state.c]) },
      '-=0.15',
    )
    tl.to(
      state,
      { c: 1, duration: 0.5, ease: 'power1.inOut', onUpdate: () => setHop([state.a, state.b, state.c]) },
      '-=0.15',
    )
    return () => {
      tl.kill()
    }
  }, [active, reduced])

  const cx = rect.w / 2
  const stepY = rect.h > 0 ? rect.h / 4 : 0
  const points = [0, 1, 2, 3].map((i) => ({ x: cx, y: stepY * i + stepY / 2 }))

  const cards: { icon: IconName; title: string; detail: string }[] = [
    { icon: 'chat', title: 'Chat', detail: 'cited answer' },
    { icon: 'note', title: 'Note', detail: 'AI-marked' },
    { icon: 'deck', title: 'Cards', detail: 'SM-2 spaced' },
    { icon: 'quiz', title: 'Quiz', detail: 'auto-graded' },
  ]

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full max-w-[420px] flex-col justify-between gap-1.5 py-0.5 sm:gap-3 sm:py-1 lg:max-h-[460px]"
    >
      {!reduced && (
        <Threads
          origin={points[0]}
          targets={[points[1]]}
          progress={hop[0]}
          tone={`${TONE_HEX[tone]}88`}
        />
      )}
      {!reduced && (
        <Threads
          origin={points[1]}
          targets={[points[2]]}
          progress={hop[1]}
          tone={`${TONE_HEX[tone]}88`}
        />
      )}
      {!reduced && (
        <Threads
          origin={points[2]}
          targets={[points[3]]}
          progress={hop[2]}
          tone={`${TONE_HEX[tone]}88`}
        />
      )}
      {cards.map((c, i) => {
        const shown = reduced || i === 0 || hop[i - 1] > 0.35
        return (
          <Fragment key={c.title}>
            {i > 0 && (
              // A persistent connector, not just the transient `Threads`
              // flash — once the sequence settles the thread fades to
              // nothing by design (see `Threads`), so this is what keeps
              // "one thing becoming the next" legible at rest, not only
              // mid-transition.
              <div
                aria-hidden
                className="relative z-10 flex justify-center transition-opacity duration-500"
                style={{ opacity: shown ? 1 : 0 }}
              >
                <Icon name="chevronDown" size={13} style={{ color: `${TONE_HEX[tone]}90` }} />
              </div>
            )}
            <div
              className="cardstock t-move relative z-10 flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 duration-500 sm:gap-3 sm:rounded-[12px] sm:px-3.5 sm:py-2.5"
              style={{
                opacity: shown ? 1 : 0,
                transform: shown ? 'translateY(0)' : 'translateY(10px)',
                borderColor: i === 0 ? `${TONE_HEX[tone]}66` : undefined,
              }}
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full sm:h-8 sm:w-8"
                style={{ background: `${TONE_HEX[tone]}20`, color: TONE_HEX[tone] }}
              >
                <Icon name={c.icon} size={12} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold text-ink">{c.title}</span>
                <span className="setcode text-[10.5px]">{c.detail}</span>
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/**
 * REHEARSE, as a real grading interaction rather than an abstract bar
 * chart: one card, a grade picked, and the interval visibly moving —
 * exactly the arithmetic in `api/app/routers/flashcards.py`'s SM-2 step
 * (README §Proof), staged here rather than re-derived. Reuses this file's
 * own `.cardstock` surface and `GRAMMAR.card` motion verb (a lift, not an
 * invented gesture) for the card itself.
 *
 * Gated on `active`, same as `HandoffArt` — every diagram in this file is
 * actually mounted for all five columns from first render (only hidden by
 * opacity while its column is collapsed), so a timer with no gate fires
 * once on page load and is long since settled by the time a visitor
 * actually opens this column. `reduced` skips straight to the graded,
 * settled state — no transition to watch, but nothing missing either.
 */
function RehearseArt({ tone, active, reduced }: { tone: Tone; active: boolean; reduced: boolean }) {
  const [graded, setGraded] = useState<'again' | 'good' | null>(null)

  useEffect(() => {
    if (!active) {
      setGraded(null)
      return
    }
    if (reduced) {
      setGraded('good')
      return
    }
    const t = window.setTimeout(() => setGraded('good'), 1100)
    return () => window.clearTimeout(t)
  }, [active, reduced])

  const picked = graded === 'good'
  const interval = picked ? '9 days' : '4 days'

  return (
    <div className="w-full max-w-[420px]">
      <div data-rcard className="cardstock rounded-[14px] px-5 py-5">
        <span className="setcode text-[10.5px]">Card 3 of 12 · due today</span>
        <p className="mt-2 text-[16px] font-semibold leading-snug text-ink">
          What does the ascending limb of the loop do?
        </p>
        <div className="mt-4 flex items-center gap-2.5">
          {(['again', 'hard', 'good', 'easy'] as const).map((g) => {
            const isPicked = g === 'good' && picked
            return (
              <span
                key={g}
                data-rgrade
                className="t-control rounded-[8px] border px-2.5 py-1.5 text-[10.5px] font-bold uppercase tracking-wide duration-300"
                style={
                  isPicked
                    ? {
                        borderColor: TONE_HEX[tone],
                        background: `${TONE_HEX[tone]}22`,
                        color: TONE_HEX[tone],
                        transform: 'scale(1.08)',
                      }
                    : { borderColor: 'var(--color-line)', color: 'var(--color-ink-3)' }
                }
              >
                {g}
              </span>
            )
          })}
        </div>
      </div>
      <div
        className="mt-4 flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-[13.5px] text-ink-3 transition-colors duration-300"
        style={{ background: picked ? `${TONE_HEX[tone]}14` : 'transparent' }}
      >
        <Icon name="clock" size={15} style={{ color: TONE_HEX[tone] }} />
        <span>
          {picked ? 'Next review moved to' : 'Next review in'}{' '}
          <span
            className="t-control font-bold duration-300"
            style={{ color: TONE_HEX[tone], display: 'inline-block', transform: picked ? 'scale(1.12)' : 'scale(1)' }}
          >
            {interval}
          </span>
        </span>
      </div>
    </div>
  )
}

/**
 * STUDENT MODEL, replacing a generic streak/day-count chart that never
 * showed the actual differentiator. Weak / improving / next-focus, using
 * the exact illustrative examples already established in the README's
 * Personalization section — countercurrent multiplication, cellular
 * respiration — so the same story is told the same way on both surfaces
 * rather than inventing a second set of fictional numbers.
 */
function StudentModelArt({ tone }: { tone: Tone }) {
  return (
    <div data-scard className="cardstock w-full max-w-[460px] rounded-[14px] px-5 py-4">
      <span className="setcode text-[10.5px]">From your last 12 quizzes</span>

      {/* QUIZ RESULT → SIGNAL, as two labelled readings rather than bare
          bars — each one names the concept, not just a percentage, because
          "58% → 81%" alone is a stat; "cellular respiration, 58% → 81%" is
          the model actually tracking a specific thing you studied. */}
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 rounded-[10px] bg-line-soft px-3.5 py-2">
          <span className="flex flex-col">
            <span className="setcode text-[10px] text-coral">missed</span>
            <span className="text-[13px] font-semibold text-ink">Countercurrent multiplication</span>
          </span>
          <span data-schip className="setcode shrink-0 text-[12px] text-coral">
            2 / 5
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[10px] bg-line-soft px-3.5 py-2">
          <span className="flex flex-col">
            <span className="setcode text-[10px] text-mint">improving</span>
            <span className="text-[13px] font-semibold text-ink">Cellular respiration</span>
          </span>
          <span data-schip className="setcode shrink-0 text-[12px] text-mint">
            58% → 81%
          </span>
        </div>
      </div>

      {/* The causal arrow — evidence becomes a decision, not just a readout. */}
      <div data-sarrow className="flex justify-center py-1">
        <Icon name="chevronDown" size={15} style={{ color: TONE_HEX[tone] }} />
      </div>

      <div
        data-snext
        className="flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5"
        style={{ borderColor: `${TONE_HEX[tone]}55`, background: `${TONE_HEX[tone]}14` }}
      >
        <Icon name="target" size={16} style={{ color: TONE_HEX[tone] }} className="shrink-0" />
        <span className="flex flex-col">
          <span className="setcode text-[10px]" style={{ color: TONE_HEX[tone] }}>
            next focus
          </span>
          <span className="text-[13px] font-semibold text-ink">
            Revisit countercurrent multiplication before moving on
          </span>
        </span>
      </div>
    </div>
  )
}

/**
 * Three teaching styles, one switched on — each with its own REAL behaviour
 * description, word for word from the skill's own `description` column
 * (`supabase/migrations/20260803120200_rag_functions.sql`,
 * `20260815090000_more_library_skills.sql`), not a paraphrase invented for
 * the page. Same question, three different rows of actual behaviour is the
 * whole point of Skills — this is what makes the difference concrete
 * instead of asserted.
 */
function SkillsArt({ tone }: { tone: Tone }) {
  const skills = [
    { name: 'Socratic Tutor', behavior: 'Never gives the answer first — asks guiding questions.' },
    { name: 'Exam Cram', behavior: 'Timed rapid-fire recall — one concept, one minute.' },
    { name: 'Debugging Mentor', behavior: 'Guides you to the bug instead of handing you the fix.' },
  ]
  return (
    <div className="flex w-full max-w-[460px] flex-col gap-3">
      {skills.map((s, i) => (
        <div
          key={s.name}
          data-skill
          className="flex items-center justify-between gap-3 rounded-[14px] border-2 px-5 py-3.5 transition-transform"
          style={
            i === 0
              ? {
                  borderColor: TONE_HEX[tone],
                  background: `${TONE_HEX[tone]}18`,
                  transform: 'scale(1.03)',
                }
              : { borderColor: 'var(--color-line)', background: 'var(--color-surface)' }
          }
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span
              className="text-[15.5px] font-bold"
              style={{ color: i === 0 ? TONE_HEX[tone] : 'var(--color-ink-3)' }}
            >
              {s.name}
            </span>
            <span className="text-[11.5px] leading-snug text-ink-3">{s.behavior}</span>
          </span>
          {i === 0 ? (
            <span
              data-dot
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full"
              style={{ background: TONE_HEX[tone], color: '#152608' }}
            >
              <Icon name="check" size={14} />
            </span>
          ) : (
            <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-line-dash" />
          )}
        </div>
      ))}
    </div>
  )
}
