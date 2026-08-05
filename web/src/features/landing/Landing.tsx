/**
 * Landing — Persuade mode, inside the Foil Binder world.
 *
 * Structure: the pack opening. A sealed foil pack sits on the table; scrolling
 * tears it and the cards spill out, and every card that lands is a real thing
 * the product makes — an answer with its citation, a flashcard, a quiz, a
 * skill. The ritual the audience already knows (opening a pack) carries the
 * mechanism (your material becomes a collection you play from).
 *
 * The scroll scene is driven by one rAF-throttled progress value per pinned
 * section, transform/opacity only. Under `prefers-reduced-motion` progress
 * pins at 1, so reduced-motion visitors get the finished composition rather
 * than a frozen half-open pack.
 *
 * Every card's content is illustrative of the artifact's shape. No usage
 * numbers, customers, or benchmarks are claimed anywhere on this page,
 * because none exist yet.
 */

import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Logo, LogoMark } from '../../components/ui/Logo'
import { cn } from '../../lib/cn'
import { mapRange, useInView, useScrollProgress } from '../../lib/useScrollProgress'
import {
  CodeMarquee,
  DealText,
  FoilText,
  ParallaxLayer,
  Rise,
  usePointerParallax,
} from './motion'

export function Landing() {
  return (
    <div className="min-h-full bg-canvas text-ink">
      <TopBar />
      <Hero />
      <CodeMarquee
        items={[
          'lecture-04.pdf · p.12',
          'organic-chem-ch7.pdf · p.3',
          'notes.md · §3',
          'seminar-slides.pdf · p.41',
          'thermo-problem-set.pdf · p.8',
          'paper-attention.pdf · p.5',
        ]}
      />
      <PackScene />
      <Loop />
      <Collection />
      <Close />
      <Footer />
    </div>
  )
}

// ── Chrome ─────────────────────────────────────────────────────────────

function TopBar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line/60 bg-canvas/80 backdrop-blur-md">
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

// ── Hero: the sealed pack ──────────────────────────────────────────────

function Hero() {
  const { ref, pos } = usePointerParallax<HTMLDivElement>()

  return (
    <section
      ref={ref}
      className="relative flex min-h-[100svh] items-center overflow-hidden pt-14"
    >
      <TableLight />

      {/* Depth is built from real layers, not a flat image: the grid sits
          furthest back, loose cards float between, the pack rides in front.
          Each layer answers the pointer at its own rate, so moving the mouse
          produces actual parallax rather than a single tilting picture. */}
      <ParallaxLayer
        depth={9}
        pos={pos}
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            'linear-gradient(to right,#3b3028 1px,transparent 1px),' +
            'linear-gradient(to bottom,#3b3028 1px,transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage: 'radial-gradient(75% 65% at 55% 45%, black, transparent)',
        }}
      >
        <span className="sr-only" />
      </ParallaxLayer>

      <FloatingCards pos={pos} />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col gap-6">
          <h1 className="nameplate text-[clamp(46px,9vw,104px)] leading-[0.86] text-ink">
            <DealText as="span" className="block">
              It remembers
            </DealText>
            <span className="relative inline-block text-brand">
              <FoilText>
                <DealText as="span" delay={140}>
                  what you forgot
                </DealText>
              </FoilText>
              <svg
                aria-hidden
                viewBox="0 0 200 12"
                className="absolute -bottom-1 left-0 w-full text-brand/50"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 8C40 3 70 3 110 6s60 4 88 1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <DealText as="span" className="block" delay={300}>
              and picks up right there.
            </DealText>
          </h1>

          <Rise delay={520}>
            <p className="max-w-md text-[15px] leading-relaxed text-ink-3">
              Drop in your lecture PDFs. It reads them, remembers what you've
              actually covered, and tells you what to study next — with cards,
              notes and quizzes it writes for you, each one still pointing back
              at the page it came from.
            </p>
          </Rise>

          <Rise delay={620}>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/signup"
                className="group inline-flex items-center gap-2 rounded-[13px] bg-brand px-6 py-3.5 text-[15px] font-bold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_0_#a8331d,0_10px_28px_-10px_rgba(255,90,60,0.7)] transition-all active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_#a8331d]"
              >
                Open your first pack
                <Icon
                  name="arrowRight"
                  size={17}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
              <span className="setcode">Free while in preview</span>
            </div>
          </Rise>
        </div>

        <ParallaxLayer depth={-26} pos={pos}>
          <SealedPack />
        </ParallaxLayer>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <span className="setcode animate-pulse">Scroll to open</span>
      </div>
    </section>
  )
}

/** Loose cards drifting at different depths behind and beside the pack. */
function FloatingCards({ pos }: { pos: { x: number; y: number } }) {
  const cards = [
    { top: '14%', left: '4%', rot: -14, depth: 16, tone: 'sky', delay: 0 },
    { top: '68%', left: '12%', rot: 9, depth: 26, tone: 'sun', delay: 1.4 },
    { top: '10%', left: '78%', rot: 11, depth: 34, tone: 'mint', delay: 0.7 },
    { top: '74%', left: '84%', rot: -8, depth: 20, tone: 'coral', delay: 2.1 },
  ] as const

  return (
    <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden>
      {cards.map((c, i) => (
        <ParallaxLayer
          key={i}
          depth={c.depth}
          pos={pos}
          className="absolute"
          style={{ top: c.top, left: c.left }}
        >
          <div
            className="h-[112px] w-[80px] rounded-lg border border-line opacity-70"
            style={{
              background: 'linear-gradient(160deg,#2e251f,#211b17)',
              ['--r' as string]: `${c.rot}deg`,
              transform: `rotate(${c.rot}deg)`,
              animation: `cardBob 7s ${c.delay}s ease-in-out infinite`,
              boxShadow: '0 18px 36px -14px rgba(0,0,0,0.85)',
            }}
          >
            <div
              className="mx-auto mt-3 h-1 w-6 rounded-full"
              style={{
                background: {
                  sky: '#2EE6D6',
                  sun: '#FFC53D',
                  mint: '#B8FF3C',
                  coral: '#FF3D8B',
                }[c.tone],
              }}
            />
            <div className="mt-3 space-y-1.5 px-3">
              <div className="h-1 w-full rounded-full bg-line" />
              <div className="h-1 w-4/5 rounded-full bg-line" />
              <div className="h-1 w-2/3 rounded-full bg-line" />
            </div>
          </div>
        </ParallaxLayer>
      ))}
      <style>{`
        @keyframes cardBob {
          0%,100% { transform: translateY(0) rotate(var(--r,0deg)); }
          50%     { transform: translateY(-16px) rotate(var(--r,0deg)); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="cardBob"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

/** The pack itself: foil pouch, crimp edge, and a slow shimmer. */
function SealedPack() {
  return (
    <div className="relative mx-auto flex h-[320px] w-full max-w-[300px] items-center justify-center sm:h-[420px]">
      <div
        className="relative h-full w-[230px] sm:w-[260px]"
        style={{ animation: 'packFloat 6s ease-in-out infinite' }}
      >
        {/* body */}
        <div
          className="absolute inset-0 overflow-hidden rounded-[18px] border border-line"
          style={{
            background:
              'linear-gradient(150deg,#3a2620 0%,#2b1e1a 30%,#41291f 55%,#2a1d19 78%,#3c2721 100%)',
            boxShadow:
              'inset 0 2px 0 rgba(255,237,220,0.14), inset 0 -20px 40px rgba(0,0,0,0.5), 0 30px 60px -20px rgba(0,0,0,0.9)',
          }}
        >
          {/* foil sweep */}
          <div
            aria-hidden
            className="absolute inset-[-30%]"
            style={{
              background:
                'linear-gradient(115deg,transparent 40%,rgba(255,197,61,0.22) 46%,rgba(46,230,214,0.26) 51%,rgba(255,61,139,0.22) 56%,transparent 62%)',
              animation: 'foilSweep 5.5s linear infinite',
            }}
          />
          {/* crimp */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-5 opacity-70"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg,#4a3c32 0 3px,transparent 3px 7px)',
            }}
          />
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-5 opacity-70"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg,#4a3c32 0 3px,transparent 3px 7px)',
            }}
          />

          <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <LogoMark size={46} />
            <span className="nameplate text-[26px] leading-[0.9] text-ink">
              Space Learn
            </span>
            <span className="setcode">Starter pack</span>
            <span className="mt-2 rounded-full border border-line px-2.5 py-1 setcode">
              Contains your syllabus
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes packFloat {
          0%,100% { transform: translateY(0) rotate(-2deg); }
          50%     { transform: translateY(-14px) rotate(2deg); }
        }
        @keyframes foilSweep {
          0%   { transform: translateX(-55%); }
          100% { transform: translateX(55%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="packFloat"], [style*="foilSweep"] { animation: none !important; }
        }
      `}</style>
    </div>
  )
}

// ── The pinned scene: cards spill out ──────────────────────────────────

type SpillCard = {
  icon: IconName
  kind: string
  title: string
  body: string
  code?: string
  tone: 'brand' | 'sky' | 'sun' | 'mint' | 'coral'
  /** Final resting spot, in % of the stage. */
  x: number
  y: number
  rot: number
}

const SPILL: SpillCard[] = [
  {
    icon: 'chat',
    kind: 'Answer',
    title: 'Why does value iteration converge?',
    body: 'Because the Bellman operator is a contraction — each sweep shrinks the error by at least the discount factor.',
    code: 'lecture-04.pdf · p.12',
    tone: 'brand',
    x: 6,
    y: 8,
    rot: -7,
  },
  {
    icon: 'deck',
    kind: 'Flashcard',
    title: 'What does the discount factor do?',
    body: 'How much future reward counts against reward you could take right now.',
    code: 'deck · Bellman',
    tone: 'sun',
    x: 62,
    y: 4,
    rot: 6,
  },
  {
    icon: 'quiz',
    kind: 'Quiz',
    title: 'A policy maps…',
    body: 'states to actions · actions to rewards · rewards to states · states to values',
    code: '5 questions',
    tone: 'sky',
    x: 10,
    y: 56,
    rot: 5,
  },
  {
    icon: 'skill',
    kind: 'Skill',
    title: 'Socratic Tutor',
    body: 'Never hands you the answer. Asks one question at a time until you get there yourself.',
    code: 'active in this topic',
    tone: 'mint',
    x: 58,
    y: 52,
    rot: -5,
  },
]

function PackScene() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>()

  // Three beats inside the pin: tear, spill, settle. The tear window is
  // short on purpose — it used to hold a bare, textureless rectangle on
  // screen for nearly a third of the pin before anything happened.
  const tear = mapRange(progress, 0, 0.16, 0, 1)
  const spill = mapRange(progress, 0.14, 0.7, 0, 1)
  const headline = mapRange(progress, 0.55, 0.9, 0, 1)

  return (
    <div ref={ref} className="relative h-[320svh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <TableLight />

        <div className="relative mx-auto w-full max-w-6xl px-5">
          {/* The same pack from the hero, now mid-tear rather than a bare box. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            style={{ opacity: 1 - tear }}
          >
            <div
              className="relative h-[300px] w-[240px] overflow-hidden rounded-[18px] border border-line"
              style={{
                background:
                  'linear-gradient(150deg,#3a2620 0%,#2b1e1a 30%,#41291f 55%,#2a1d19 78%,#3c2721 100%)',
                boxShadow:
                  'inset 0 2px 0 rgba(255,237,220,0.14), inset 0 -20px 40px rgba(0,0,0,0.5), 0 30px 60px -20px rgba(0,0,0,0.9)',
                transform: `scale(${1 - tear * 0.25})`,
              }}
            >
              <div
                aria-hidden
                className="absolute inset-[-30%]"
                style={{
                  background:
                    'linear-gradient(115deg,transparent 40%,rgba(255,197,61,0.22) 46%,rgba(46,230,214,0.26) 51%,rgba(255,61,139,0.22) 56%,transparent 62%)',
                  transform: `translateX(${-55 + tear * 110}%)`,
                }}
              />
              <div
                aria-hidden
                className="absolute inset-x-0 top-0 h-5 opacity-70"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(90deg,#4a3c32 0 3px,transparent 3px 7px)',
                }}
              />
              <div className="relative flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
                <LogoMark size={40} />
                <span className="nameplate text-[22px] leading-[0.9] text-ink">
                  Space Learn
                </span>
                <span className="setcode">Starter pack</span>
              </div>
            </div>
          </div>

          {/* The stage the cards land on. */}
          <div className="relative mx-auto h-[68svh] w-full">
            {SPILL.map((card, i) => {
              const stagger = mapRange(spill, i * 0.12, 0.55 + i * 0.12, 0, 1)
              const eased = 1 - Math.pow(1 - stagger, 3)
              return (
                <article
                  key={card.kind}
                  className="cardstock foil absolute w-[248px] rounded-xl p-4 sm:w-[286px]"
                  style={
                    {
                      left: `${card.x}%`,
                      top: `${card.y}%`,
                      zIndex: 10 + i,
                      opacity: eased,
                      transform: `translate3d(${(1 - eased) * (card.x < 40 ? -90 : 90)}px, ${(1 - eased) * 60}px, 0) rotate(${card.rot * eased}deg) scale(${0.86 + eased * 0.14})`,
                    } as CSSProperties
                  }
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className={cn(
                        'grid h-6 w-6 place-items-center rounded-md',
                        {
                          brand: 'bg-brand-soft text-brand-deep',
                          sky: 'bg-sky-soft text-sky-deep',
                          sun: 'bg-sun-soft text-sun-deep',
                          mint: 'bg-mint-soft text-mint-deep',
                          coral: 'bg-coral-soft text-coral-deep',
                        }[card.tone],
                      )}
                    >
                      <Icon name={card.icon} size={13} />
                    </span>
                    <span className="setcode">{card.kind}</span>
                  </div>
                  <p className="nameplate text-[18px] leading-tight text-ink">{card.title}</p>
                  <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{card.body}</p>
                  {card.code && (
                    <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2">
                      <Icon name="doc" size={11} className="shrink-0 text-faint" />
                      <span className="setcode truncate">{card.code}</span>
                    </div>
                  )}
                </article>
              )
            })}

            {/* The thesis, arriving once the cards have landed. */}
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4"
              style={{
                opacity: headline,
                transform: `translateY(calc(-50% + ${(1 - headline) * 16}px))`,
              }}
            >
              <h2 className="nameplate max-w-lg text-center text-[clamp(28px,4.5vw,52px)] leading-[0.92] text-ink">
                One conversation.
                <br />
                <span className="text-brand">Everything it becomes.</span>
              </h2>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── The loop ───────────────────────────────────────────────────────────

const STEPS = [
  {
    icon: 'upload' as IconName,
    title: 'Drop in your material',
    body: 'Lecture slides, a textbook chapter, your own messy notes. It gets read and indexed, page by page.',
  },
  {
    icon: 'chat' as IconName,
    title: 'Ask it anything',
    body: "Answers come back citing the page they came from, so you can check them. If it isn't in your material, it says so instead of guessing.",
  },
  {
    icon: 'deck' as IconName,
    title: 'Keep what mattered',
    body: 'Turn the answer into cards, a note, or a quiz in one click. Reviews come back on a schedule that follows how well you actually knew it.',
  },
]

function Loop() {
  return (
    <section className="relative border-t border-line py-24 sm:py-32">
      <div className="mx-auto w-full max-w-6xl px-5">
        <h2 className="nameplate mb-14 max-w-2xl text-[clamp(30px,5vw,60px)] leading-[0.92]">
          The loop that
          <br />
          <span className="text-brand">actually sticks.</span>
        </h2>

        <ol className="flex flex-col">
          {STEPS.map((step, i) => (
            <StepRow key={step.title} step={step} index={i} last={i === STEPS.length - 1} />
          ))}
        </ol>
      </div>
    </section>
  )
}

function StepRow({
  step,
  index,
  last,
}: {
  step: (typeof STEPS)[number]
  index: number
  last: boolean
}) {
  const { ref, seen } = useInView<HTMLLIElement>()
  return (
    <li
      ref={ref}
      className={cn(
        'grid gap-5 border-t border-line py-9 transition-all duration-700 ease-out sm:grid-cols-[auto_1fr_1.2fr] sm:items-start sm:gap-8',
        last && 'border-b',
        seen ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
      )}
      style={{ transitionDelay: `${index * 90}ms` }}
    >
      <span className="nameplate text-[40px] leading-none text-line-dash sm:text-[56px]">
        {String(index + 1).padStart(2, '0')}
      </span>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand-soft text-brand-deep">
          <Icon name={step.icon} size={18} />
        </span>
        <h3 className="nameplate text-[24px] leading-tight text-ink sm:text-[28px]">
          {step.title}
        </h3>
      </div>
      <p className="max-w-md text-[14px] leading-relaxed text-ink-3">{step.body}</p>
    </li>
  )
}

// ── What accumulates ───────────────────────────────────────────────────

function Collection() {
  const { ref, seen } = useInView<HTMLDivElement>()
  return (
    <section className="relative overflow-hidden border-t border-line py-24 sm:py-32">
      <TableLight />
      <div ref={ref} className="relative mx-auto w-full max-w-6xl px-5">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div className="flex flex-col gap-5">
            <h2 className="nameplate text-[clamp(30px,5vw,58px)] leading-[0.92]">
              It piles up
              <br />
              <span className="text-brand">whether you notice or not.</span>
            </h2>
            <p className="max-w-md text-[14.5px] leading-relaxed text-ink-3">
              Every session leaves something behind: a streak you don't want to
              break, cards coming due, a quiz average that finally moves. Nothing
              here is decorative — it's all counted from what you actually did.
            </p>
            <Link
              to="/signup"
              className="group inline-flex w-fit items-center gap-2 rounded-[12px] border border-line bg-raised px-5 py-3 text-[14px] font-bold text-ink transition-colors hover:border-brand/50"
            >
              Start your collection
              <Icon
                name="arrowRight"
                size={16}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { icon: 'flame' as IconName, v: '14', l: 'day streak', tone: 'brand' },
              { icon: 'deck' as IconName, v: '32', l: 'cards due', tone: 'sun' },
              { icon: 'target' as IconName, v: '88', l: 'quiz avg', tone: 'sky' },
              { icon: 'seal' as IconName, v: '6', l: 'badges', tone: 'coral' },
              { icon: 'doc' as IconName, v: '11', l: 'sources', tone: 'mint' },
              { icon: 'note' as IconName, v: '24', l: 'notes', tone: 'brand' },
            ].map((tile, i) => (
              <div
                key={tile.l}
                className={cn(
                  'cardstock foil flex flex-col gap-2 rounded-xl p-3.5 transition-all duration-700 ease-out',
                  seen ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
                )}
                style={{ transitionDelay: `${i * 70}ms` }}
              >
                <span
                  className={cn(
                    'grid h-7 w-7 place-items-center rounded-md',
                    {
                      brand: 'bg-brand-soft text-brand-deep',
                      sky: 'bg-sky-soft text-sky-deep',
                      sun: 'bg-sun-soft text-sun-deep',
                      mint: 'bg-mint-soft text-mint-deep',
                      coral: 'bg-coral-soft text-coral-deep',
                    }[tile.tone as 'brand'],
                  )}
                >
                  <Icon name={tile.icon} size={14} filled />
                </span>
                <span className="nameplate text-[30px] leading-none tabular-nums text-ink">
                  {tile.v}
                </span>
                <span className="setcode">{tile.l}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="setcode mt-6 lg:text-right">Figures shown are illustrative</p>
      </div>
    </section>
  )
}

// ── Close ──────────────────────────────────────────────────────────────

function Close() {
  return (
    <section className="relative overflow-hidden border-t border-line">
      <TableLight />
      <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center gap-7 px-5 py-28 text-center sm:py-36">
        <h2 className="nameplate text-[clamp(38px,7.5vw,86px)] leading-[0.88]">
          Stop rereading.
          <br />
          <span className="text-brand">Start recalling.</span>
        </h2>
        <p className="max-w-md text-[15px] leading-relaxed text-ink-3">
          Bring one subject you're behind on. That's enough to see whether this
          works for you.
        </p>
        <Link
          to="/signup"
          className="group inline-flex items-center gap-2 rounded-[13px] bg-brand px-7 py-4 text-[16px] font-bold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_3px_0_#a8331d,0_12px_32px_-10px_rgba(255,90,60,0.75)] transition-all active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_0_0_#a8331d]"
        >
          Open your first pack
          <Icon
            name="arrowRight"
            size={18}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
        <span className="setcode">No card needed · Free while in preview</span>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-line py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-3 px-5 sm:flex-row">
        <div className="flex items-center gap-2">
          <LogoMark size={22} />
          <span className="nameplate text-[15px]">Space Learn</span>
        </div>
        <div className="setcode sm:ml-auto">Built for students who ran out of time</div>
      </div>
    </footer>
  )
}

/** Shared warm pools — the lamp over the table, reused per section. */
function TableLight() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage:
          'radial-gradient(70ch 50ch at 20% 10%, #33241d 0%, transparent 60%),' +
          'radial-gradient(60ch 45ch at 88% 78%, #2c1e17 0%, transparent 58%)',
      }}
    />
  )
}
