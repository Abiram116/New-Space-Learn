/**
 * The trust pages from the landing page: a full-width card in the hero's ember
 * dark that drifts up out of the bottom-right corner, hung just below the
 * ABOUT · CONTACT / PRIVACY · TERMS links. Those links are its navigation —
 * another one sends this card away and brings the next — so the card carries
 * only the page and a close button.
 *
 * While it is up the landing page dims and softens behind it, and the corner
 * links are drawn again above that dimming so they stay bright and clickable.
 *
 * TrustLayer decides when it is on screen and which way it moves.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { setPageScrollLocked } from '../../lib/scrollLock'
import { TrustArticle } from './TrustArticle'
import { TRUST_DOCS } from './TrustContent'
import { TrustCornerLinks } from './TrustCornerLinks'
import { TRUST_PAGES, type TrustSlug } from './pages'

export type CardMotion = 'enter' | 'leave'

// Same rule as `components/ui/Modal`: `tabindex="-1"` opts a control out.
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/></filter><rect width='180' height='180' filter='url(%23n)'/></svg>\")"

export function TrustCard({
  slug,
  motion,
  onClose,
}: {
  slug: TrustSlug
  /** enter: drift up out of the bottom-right corner · leave: glide back into it */
  motion: CardMotion
  onClose: () => void
}) {
  const cardRef = useRef<HTMLElement>(null)
  const linksRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const latestClose = useRef(onClose)
  useEffect(() => {
    latestClose.current = onClose
  })

  // While a card is up the landing page holds still underneath it, Esc closes
  // it, and focus moves into it (and back out when it goes).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    // Lock on <html>, never <body>: the landing page clips <html> sideways (no
    // scrollbars), so a hidden-overflow <body> becomes its own one-screen box
    // and the page snaps back to its top. Hidden overflow on <html> holds the
    // scroll position exactly where the student was.
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    setPageScrollLocked(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        latestClose.current()
        return
      }
      if (e.key !== 'Tab') return
      // Tab stays with the card and the corner links that are its tabs, in the
      // order they sit in the page; past either end it comes round again
      // rather than wandering into the dimmed page underneath. The links are
      // not drawn on a phone, hence the visibility check (`checkVisibility`
      // is missing from older browsers, which then simply try them).
      const stops = [linksRef.current, cardRef.current]
        .flatMap((root) => (root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)) : []))
        .filter((el) => el.checkVisibility?.() ?? true)
      if (stops.length === 0) {
        e.preventDefault()
        return
      }
      const active = document.activeElement
      const card = cardRef.current
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (active === card) {
        // Focus rests on the card itself when it arrives. Forward, the browser
        // already goes to the card's first control; backward it would leave
        // for the page underneath whenever the links are not drawn.
        if (!e.shiftKey) return
        e.preventDefault()
        const above = stops.filter((el) => !card?.contains(el))
        ;(above[above.length - 1] ?? last).focus()
      } else if (!stops.some((el) => el === active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      root.style.overflow = overflow
      setPageScrollLocked(false)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [])

  // Each page names the browser tab, and takes focus as it arrives.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true })
    const before = document.title
    document.title = `${TRUST_PAGES[slug].title} · Space Learn`
    const mine = document.title
    return () => {
      // Only if the tab still says what this card set: leaving for another
      // page (which has named the tab already) must not be undone from here
      // when the card finishes sliding away.
      if (document.title === mine) document.title = before
    }
  }, [slug])

  const doc = TRUST_DOCS[slug]
  const leaving = motion === 'leave'

  return createPortal(
    <>
      {/* The landing page, dimmed and softened behind the card — enough to put
          the card in front without hiding where you are. A click on it closes. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-[#0b0604]/40 backdrop-blur-[5px]',
          leaving
            ? 'motion-safe:animate-[trustFadeOut_460ms_var(--ease-in-out-sl)_both]'
            : 'motion-safe:animate-[trustFade_700ms_var(--ease-sl)_both]',
        )}
      />

      {/* The corner links again, above the dimming, so they stay the card's tabs. */}
      <div ref={linksRef} className="contents">
        <TrustCornerLinks className="fixed right-0 top-16 z-[55] hidden px-5 sm:px-8 md:block" />
      </div>

      <section
        key={slug}
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-title"
        className={cn(
          // Phones have no corner links, so the card takes the screen; on
          // larger screens it hangs below the links, edge to edge.
          'fixed inset-3 z-50 flex origin-bottom-right flex-col overflow-hidden rounded-[22px] border border-white/[0.09] outline-none',
          'md:inset-x-8 md:bottom-6 md:top-[124px]',
          'bg-[#150c09] shadow-[0_50px_140px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.06)]',
          // Soft on purpose: a short drift up from the bottom-right corner and
          // a fade, eased out over most of a second; leaving glides back.
          leaving
            ? 'motion-safe:animate-[cardOut_460ms_var(--ease-in-out-sl)_both]'
            : 'motion-safe:animate-[cardIn_820ms_var(--ease-sl)_both]',
        )}
        style={{
          // The hero's glow, coming from the corner the links sit in.
          backgroundImage:
            'radial-gradient(100ch 60ch at 100% 0%, rgba(255,107,69,0.26) 0%, rgba(178,58,27,0.10) 45%, transparent 75%),' +
            'radial-gradient(70ch 50ch at 0% 100%, rgba(120,40,18,0.18) 0%, transparent 70%)',
        }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 opacity-[0.06] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
        {/* Lit from above: a hairline of light along the top edge, and — once,
            as the card lands — an orange sheen travelling along it. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[2px] overflow-hidden">
          {!leaving && (
            <span className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-brand to-transparent opacity-0 motion-safe:animate-[cardSheen_1500ms_560ms_var(--ease-in-out-sl)_both]" />
          )}
        </span>

        <header className="flex shrink-0 items-start gap-4 px-6 pb-7 pt-8 sm:px-12 sm:pt-11">
          <div className="min-w-0 flex-1">
            <p className="setcode text-brand">{TRUST_PAGES[slug].label}</p>
            <h2 id="trust-title" className="nameplate mt-3 text-[clamp(30px,3.8vw,50px)] leading-[0.95] text-[#f6ede4]">
              {TRUST_PAGES[slug].title}
            </h2>
            {doc.meta && <p className="mt-3 text-[13px] text-faint">{doc.meta}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white/[0.07] text-ink-2 transition-colors hover:bg-white/[0.14] hover:text-ink"
          >
            <Icon name="close" size={17} />
          </button>
        </header>

        {/* `data-lenis-prevent`: the landing page's smooth scroller leaves this
            scroll alone, so the card scrolls and the page behind does not. */}
        <div
          ref={scrollRef}
          data-lenis-prevent
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* The short version, the key facts, then the full text one section
              at a time at a reading measure (TrustArticle). Content rises in a
              beat after the card lands. */}
          <div className="px-6 pb-14 pt-1 motion-safe:animate-[cardContentIn_760ms_220ms_var(--ease-sl)_both] sm:px-12">
            <TrustArticle slug={slug} variant="card" scrollRef={scrollRef} />
          </div>
        </div>
      </section>
    </>,
    document.body,
  )
}
