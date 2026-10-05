/**
 * The landing page on a phone — usually someone who tapped a shared link.
 *
 * The desktop page is a scroll-scrubbed film: Lenis smoothing, pinned GSAP
 * sections, a canvas of dust. On a phone all of that fights the thumb (native
 * momentum scrolling is the smooth scroll) and costs battery for a visitor
 * who has thirty seconds to decide. So this is the same identity — the lamp
 * light, the display face, the flare orange — on a plain native-scroll page:
 *
 *   - what it does, in one line
 *   - one "Get started", pinned in the thumb zone
 *   - an honest line on what a phone is for, and "Send myself the link" for
 *     the desk
 *
 * Every claim is one the product keeps; nothing is invented.
 */

import { TRUST_PAGES, TRUST_SLUGS } from '../trust/pages'
import { useTrustLinks } from '../trust/useTrustLinks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { prefetchAuthChunks } from '../../routes/lazyRoutes'
import { sendLink, shareMessage } from '../home/share'

const WHAT: { icon: IconName; tone: string; title: string; body: string }[] = [
  {
    icon: 'doc',
    tone: 'text-sky',
    title: 'Answers with the page',
    body: 'Add a PDF or your notes. Every answer shows the page it came from.',
  },
  {
    icon: 'deck',
    tone: 'text-sun',
    title: 'Cards that come back on time',
    body: 'A card comes back right when you’re about to forget it.',
  },
  {
    icon: 'quiz',
    tone: 'text-coral',
    title: 'Quizzes that show what to study',
    body: 'Get a score and see what you missed, so you know where to start.',
  },
]

export function PhoneLanding() {
  useEffect(prefetchAuthChunks, [])
  const reduced = useReducedMotion()
  const { show } = useToast()
  const [sharing, setSharing] = useState(false)

  const share = async () => {
    setSharing(true)
    const url = `${window.location.origin}/welcome`
    const msg = shareMessage(await sendLink({ title: 'Space Learn', url }), url)
    if (msg) show(msg.text, msg.kind)
    setSharing(false)
  }

  const rise = (ms: number) =>
    reduced ? undefined : { animation: `pl-rise 560ms ${ms}ms var(--ease-sl) both` }

  return (
    <div className="relative min-h-dvh bg-canvas text-ink">
      <style>{`
        @keyframes pl-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { [style*="pl-rise"] { animation: none !important; } }
      `}</style>
      {/* The lamp, as still light — the desktop's pools, no pointer tracking, no canvas. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage:
            'radial-gradient(70ch 52ch at 18% 0%, #3a2a20 0%, transparent 62%),' +
            'radial-gradient(60ch 50ch at 100% 70%, #2c1e17 0%, transparent 60%)',
        }}
      />

      <div className="relative mx-auto flex w-full max-w-xl flex-col px-5 pb-[calc(112px+env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]">
        <header className="flex h-14 items-center justify-between">
          <Link to="/" aria-label="Space Learn">
            <Logo size={26} textClassName="text-[17px]" />
          </Link>
          <Link
            to="/signin"
            className="flex min-h-11 items-center rounded-[10px] px-3 text-[15px] font-semibold text-ink-3 active:bg-line-soft"
          >
            Sign in
          </Link>
        </header>

        <section className="flex flex-col gap-4 pt-8">
          <h1 className="nameplate text-[clamp(32px,min(11.5vw,11vh),54px)] leading-[0.9] text-ink" style={rise(0)}>
            One page in. <span className="text-brand">Notes, cards and a quiz</span> out.
          </h1>
          <p className="text-[16.5px] leading-relaxed text-ink-3" style={rise(120)}>
            Add what you’re studying and practice with cards and quizzes. Every answer
            shows its page.
          </p>
        </section>

        <figure className="mt-7 overflow-hidden rounded-[18px] border border-line bg-well" style={rise(220)}>
          <img
            src="/story-poster.webp"
            alt="An illustrated study room: someone working at a desk by a window"
            width={1600}
            height={905}
            loading="eager"
            decoding="async"
            className="aspect-video w-full object-cover"
          />
        </figure>

        <section className="mt-7 flex flex-col gap-3 rounded-xl border border-line bg-surface/80 p-4" style={rise(300)}>
          <p className="text-[15.5px] leading-relaxed text-ink-2">
            Revise anywhere on your phone. Add files and chat with the tutor on a computer.
          </p>
          <button
            type="button"
            onClick={() => void share()}
            disabled={sharing}
            className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[12px] border border-line bg-raised text-[15.5px] font-semibold text-ink active:translate-y-[1px] disabled:opacity-60"
          >
            <Icon name="send" size={15} /> Send myself the link
          </button>
        </section>

        <ul className="mt-9 flex flex-col">
          {WHAT.map((w) => (
            <li key={w.title} className="flex gap-3.5 border-t border-line py-4 last:border-b">
              <Icon name={w.icon} size={18} className={`mt-0.5 shrink-0 ${w.tone}`} />
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold text-ink">{w.title}</h2>
                <p className="mt-1 text-[14.5px] leading-relaxed text-muted">{w.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-[14.5px] text-muted">
          Already have an account?{' '}
          <Link to="/signin" className="inline-flex min-h-11 items-center font-semibold text-brand">
            Sign in
          </Link>
        </p>

        {/* The trust pages. The desktop landing puts them in the top-right
            corner; on a phone they sit at the end of the page, thumb-sized. */}
        <PhoneTrustLinks />
      </div>

      {/* The one action, where the thumb rests. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line/70 bg-canvas/92 px-5 pb-[max(14px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md [@media(max-height:500px)]:pb-[max(8px,env(safe-area-inset-bottom))] [@media(max-height:500px)]:pt-2">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-1.5">
          <Link
            to="/signup"
            className="flex min-h-[52px] w-full items-center [@media(max-height:500px)]:min-h-12 justify-center gap-2 rounded-[14px] bg-brand text-[17px] font-bold text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_3px_0_#a8331d] transition-transform active:translate-y-[2px]"
          >
            Get started
            <Icon name="arrowRight" size={16} />
          </Link>
          <span className="text-[12.5px] text-faint [@media(max-height:500px)]:hidden">Free while in preview. No credit card needed.</span>
        </div>
      </div>
    </div>
  )
}

/** The trust pages (Feedback lives inside the app); each slides in as a card over this page (see TrustLayer). */
function PhoneTrustLinks() {
  const { linkProps } = useTrustLinks()
  return (
    <nav aria-label="About Space Learn" className="mt-2 flex flex-wrap justify-center gap-x-1">
      {TRUST_SLUGS.filter((slug) => slug !== 'feedback').map((slug) => (
        <Link
          key={slug}
          {...linkProps(slug)}
          className="setcode inline-flex min-h-11 items-center px-2 text-[13px] text-muted active:text-ink"
        >
          {TRUST_PAGES[slug].label}
        </Link>
      ))}
    </nav>
  )
}

