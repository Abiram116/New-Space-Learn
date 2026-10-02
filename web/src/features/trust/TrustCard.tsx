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
import { TRUST_DOCS } from './TrustContent'
import { TrustCornerLinks } from './TrustCornerLinks'
import { TRUST_PAGES, type TrustSlug } from './pages'

export type CardMotion = 'enter' | 'leave'

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
    return () => {
      document.title = before
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
      <TrustCornerLinks className="fixed right-0 top-16 z-[55] hidden px-5 sm:px-8 md:block" />

      <section
        key={slug}
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
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
        <div data-lenis-prevent className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* The width is the page's: the intro runs wide, and the sections sit
              in a grid of soft tiles, equal height along each row. Content
              rises in a beat after the card lands. */}
          <div className="px-6 pb-12 motion-safe:animate-[cardContentIn_760ms_220ms_var(--ease-sl)_both] sm:px-12">
            <div className={cn(doc.aside && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] lg:gap-12')}>
              <div className="min-w-0">
                <div className="max-w-[78ch] [&_p]:text-[18px] [&_p]:leading-[1.7]">{doc.intro}</div>
                <div className={cn('mt-10 grid gap-4 md:grid-cols-2', !doc.aside && 'xl:grid-cols-3')}>
                  {doc.sections.map((s) => (
                    <section
                      key={s.id}
                      className={cn(
                        'rounded-2xl border border-white/[0.06] bg-white/[0.03] p-6 transition-colors hover:border-white/[0.1]',
                        s.wide && (doc.aside ? 'md:col-span-2' : 'md:col-span-2 xl:col-span-3'),
                      )}
                    >
                      <h3 className="flex items-center gap-2.5 text-[18px] font-semibold leading-snug text-ink">
                        <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full bg-brand" />
                        {s.title}
                      </h3>
                      <div className="mt-3 [&_li]:text-[15.5px] [&_p]:text-[15.5px]">{s.body}</div>
                    </section>
                  ))}
                </div>
              </div>
              {/* The right-hand column on wide screens (About: the two of us),
                  holding still while the page beside it scrolls. */}
              {doc.aside && (
                <aside className="mt-10 lg:sticky lg:top-0 lg:mt-0 lg:self-start" aria-label={doc.aside.title}>
                  <p className="setcode mb-4 text-faint">{doc.aside.title}</p>
                  {doc.aside.body}
                </aside>
              )}
            </div>
          </div>
        </div>
      </section>
    </>,
    document.body,
  )
}
