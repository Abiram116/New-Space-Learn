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

import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Logo, LogoMark } from '../../components/ui/Logo'
import { cn } from '../../lib/cn'
import { mapRange, useInView, useScrollProgress } from '../../lib/useScrollProgress'
import { HeroReveal } from './HeroReveal'
import { CardSequence, type SequenceCard } from './CardSequence'
import { SmoothScroll } from './SmoothScroll'

/**
 * The page reads as one continuous move inward:
 *
 *   1. HeroReveal — the headline holds the screen, the room shows along the
 *      bottom edge, and scrolling lifts it into a framed window.
 *   2. PackScene — the frame is pushed out by the cards; the pack tears and
 *      what the product actually makes lands on the table.
 *   3. Collection — what accumulates once you're using it.
 *   4. Close — the last image, then the footer.
 *
 * The video appears once, at the top, and never returns. Showing it again
 * would undercut it: it exists to establish the world, not to decorate.
 */
export function Landing() {
  return (
    <SmoothScroll>
      <div className="min-h-full bg-canvas text-ink">
        <TopBar />
        <HeroReveal
          src="/story.webm"
          fallbackSrc="/story.mp4"
          poster="/story-poster.webp"
        />
        <PackScene />
        <CardSequence cards={SPILL} />
        <Collection />
        <Close />
        <Footer />
      </div>
    </SmoothScroll>
  )
}

// ── Chrome ─────────────────────────────────────────────────────────────

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

// ── Hero: the sealed pack ──────────────────────────────────────────────

// ── The pinned scene: cards spill out ──────────────────────────────────

const SPILL: SequenceCard[] = [
  {
    icon: 'chat',
    kind: 'Answer',
    title: 'Why does value iteration converge?',
    body: 'Because the Bellman operator is a contraction — each sweep shrinks the error by at least the discount factor.',
    code: 'lecture-04.pdf · p.12',
    tone: 'brand',
  },
  {
    icon: 'deck',
    kind: 'Flashcard',
    title: 'What does the discount factor do?',
    body: 'How much future reward counts against reward you could take right now.',
    code: 'deck · Bellman',
    tone: 'sun',
  },
  {
    icon: 'quiz',
    kind: 'Quiz',
    title: 'A policy maps…',
    body: 'states to actions · actions to rewards · rewards to states · states to values',
    code: '5 questions',
    tone: 'sky',
  },
  {
    icon: 'skill',
    kind: 'Skill',
    title: 'Socratic Tutor',
    body: 'Never hands you the answer. Asks one question at a time until you get there yourself.',
    code: 'active in this topic',
    tone: 'mint',
  },
]

function PackScene() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>()

  const tear = mapRange(progress, 0.05, 0.45, 0, 1)
  const headline = mapRange(progress, 0.35, 0.75, 0, 1)

  return (
    <div ref={ref} className="relative h-[200svh]">
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden">
        <TableLight />

        {/* The pack, which opens and hands over to the sequence below. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
          style={{ opacity: 1 - tear }}
        >
          <div
            className="relative h-[62svh] max-h-[560px] w-[min(78vw,440px)] overflow-hidden rounded-[26px]"
            style={{
              background:
                'linear-gradient(150deg,#3a2620 0%,#2b1e1a 30%,#41291f 55%,#2a1d19 78%,#3c2721 100%)',
              boxShadow:
                'inset 0 2px 0 rgba(255,237,220,0.18), inset 0 -40px 80px rgba(0,0,0,0.55), 0 60px 120px -30px rgba(0,0,0,0.95)',
              transform: `scale(${1 - tear * 0.22}) rotate(${tear * -4}deg)`,
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
            <div className="relative flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
              <LogoMark size={72} />
              <span className="nameplate text-[38px] leading-[0.9] text-ink">Space Learn</span>
              <span className="setcode">Starter pack</span>
            </div>
          </div>
        </div>

        {/* Scale contrast is the whole idea: "One" is enormous and
            "conversation." is small and tucked under its shoulder, so the
            line reads as one thing becoming many — which is what it says.
            Pushed past the container so the viewport crops it. */}
        <div
          className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2"
          style={{
            opacity: headline,
            transform: `translateY(calc(-50% + ${(1 - headline) * 24}px))`,
          }}
        >
          <h2 className="nameplate -mx-[8vw] select-none text-center leading-[0.78] tracking-[-0.02em] text-ink">
            <span className="block -rotate-[1.5deg]">
              <span className="text-[clamp(72px,17vw,260px)]">One</span>{' '}
              <span className="align-top text-[clamp(24px,4vw,64px)] text-ink-3">
                conversation.
              </span>
            </span>
            <span className="block rotate-[1deg] text-brand">
              <span className="align-top text-[clamp(20px,3.4vw,54px)] text-ink-3">
                everything it
              </span>{' '}
              <span className="text-[clamp(72px,17vw,260px)]">becomes.</span>
            </span>
          </h2>
        </div>
      </div>
    </div>
  )
}

// ── What accumulates ───────────────────────────────────────────────────

function Collection() {
  const { ref, seen } = useInView<HTMLDivElement>()
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
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
    // The last screen. The figure is a cutout, not a picture: no frame, no
    // panel, no edge — just the shape printed straight onto the page, so the
    // background runs behind and around it. Anything boxed here would read
    // as an image *on* the page rather than part of it.
    <section className="relative flex min-h-[100svh] flex-col overflow-hidden">
      <TableLight />

      <div className="relative flex flex-1 flex-col items-center justify-end px-5 pt-24">
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <h2 className="nameplate text-[clamp(38px,7.5vw,92px)] leading-[0.88]">
            Stop rereading.
            <br />
            <span className="text-brand">Start recalling.</span>
          </h2>
          <p className="max-w-md text-[15px] leading-relaxed text-ink-3">
            Bring one subject you're behind on. That's enough to see whether
            this works for you.
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
        </div>

        {/* Oversized wordmark sunk into the background, with the cutout
            standing in front of it. Two things make this work rather than
            look like a stray label: it is far larger than any real heading
            (so it reads as texture, not copy), and it is low enough in
            contrast that the figure always wins. It is also `aria-hidden`
            — it is a graphic device, and a screen reader announcing the
            product name a third time is noise. */}
        <div className="relative mt-8 flex w-full justify-center">
          {/* Stacked, not on one line: two short words centred over each
              other make a solid block for the cutout to stand against,
              where a single long line just becomes a thin strip. */}
          <span
            aria-hidden
            className="nameplate pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 select-none text-center text-[clamp(78px,15vw,230px)] leading-[0.78] text-ink/[0.055]"
          >
            Space
            <br />
            Learn
          </span>

          {/* Runs off the bottom edge rather than sitting on it — a cutout
              that stops short reads as a sticker. */}
          <img
            src="/student-reading.webp"
            alt=""
            aria-hidden
            className="relative h-[38svh] max-w-full select-none object-contain object-bottom sm:h-[46svh]"
          />
        </div>
      </div>

      {/* Ending marks, pinned to the two bottom corners. */}
      <div className="pointer-events-none relative flex items-end justify-between px-5 pb-5 sm:px-8">
        <span className="setcode">Space Learn · preview</span>
        <span className="setcode text-right">
          No card needed
          <br />
          Free while in preview
        </span>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="py-8">
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
