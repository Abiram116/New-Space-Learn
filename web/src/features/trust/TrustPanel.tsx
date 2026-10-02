/**
 * The trust pages opened over the app or the sign-in screens (`?info=privacy`):
 * a quiet sheet from the right, with the page you were on still in view behind
 * it. From the landing page the same words rise as full-screen pages instead
 * (TrustSheet).
 *
 * Loaded on demand (see TrustLayer): nobody who never opens it downloads it.
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { TRUST_DOCS } from './TrustContent'
import { TRUST_PAGES, TRUST_SLUGS, type TrustSlug } from './pages'
import { useTrustDialog } from './useTrustDialog'

export function TrustPanel({
  slug,
  onSelect,
  onClose,
}: {
  slug: TrustSlug
  onSelect: (slug: TrustSlug) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  useTrustDialog(panelRef, slug, onSelect, onClose)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [slug])
  const doc = TRUST_DOCS[slug]

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-[#0d0806]/55 backdrop-blur-[3px] motion-safe:animate-[trustFade_260ms_ease-out_both]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trust-title"
        className="relative flex h-full w-full flex-col border-l border-white/10 bg-raised/90 shadow-[-28px_0_60px_-24px_rgba(0,0,0,0.85)] backdrop-blur-xl motion-safe:animate-[trustIn_320ms_var(--ease-sl)_both] sm:w-[min(560px,92vw)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-4 pt-3 sm:px-6">
          <nav
            aria-label="Space Learn information"
            className="-mb-px flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {TRUST_SLUGS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSelect(s)}
                aria-current={s === slug ? 'page' : undefined}
                className={cn(
                  'shrink-0 cursor-pointer border-b-2 px-2.5 pb-2.5 pt-1.5 text-[13.5px] transition-colors',
                  s === slug ? 'border-brand font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink',
                )}
              >
                {TRUST_PAGES[s].label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="mb-2 grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-[10px] text-muted transition-colors hover:bg-white/10 hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-10 pt-6 sm:px-8">
          <div key={slug} className="motion-safe:animate-[dockIn_220ms_var(--ease-sl)_both]">
            <h2 id="trust-title" className="nameplate text-[26px] leading-tight text-ink">
              {TRUST_PAGES[slug].title}
            </h2>
            {doc.meta && <p className="setcode mt-2 text-faint">{doc.meta}</p>}
            <div className="mt-4">{doc.intro}</div>
            {doc.sections.map((s) => (
              <section key={s.id} className="mt-6">
                <h3 className="mb-1 text-[15px] font-semibold text-ink">{s.title}</h3>
                {s.body}
              </section>
            ))}
            {doc.aside && (
              <section className="mt-6">
                <h3 className="mb-3 text-[15px] font-semibold text-ink">{doc.aside.title}</h3>
                {doc.aside.body}
              </section>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
