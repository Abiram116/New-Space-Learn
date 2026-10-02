import { useEffect, useRef, type RefObject } from 'react'
import { TRUST_PAGES, TRUST_SLUGS, type TrustSlug } from './pages'

const FOCUSABLE = 'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])'

/**
 * What every trust surface does while open, whichever way it looks: lock the
 * page behind it, take focus and give it back, Esc closes, ← / → step through
 * the pages (not while typing), Tab stays inside, and the browser tab is named
 * after the page.
 */
export function useTrustDialog(
  panelRef: RefObject<HTMLElement | null>,
  slug: TrustSlug,
  onSelect: (slug: TrustSlug) => void,
  onClose: () => void,
): void {
  const latest = useRef({ slug, onSelect, onClose })
  useEffect(() => {
    latest.current = { slug, onSelect, onClose }
  })

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      if (e.key === 'Escape') {
        e.preventDefault()
        latest.current.onClose()
        return
      }
      const typing = (e.target as Element | null)?.closest?.('input, textarea, [contenteditable]')
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const next = TRUST_SLUGS[TRUST_SLUGS.indexOf(latest.current.slug) + (e.key === 'ArrowRight' ? 1 : -1)]
        if (next) {
          e.preventDefault()
          latest.current.onSelect(next)
        }
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [panelRef])

  useEffect(() => {
    const before = document.title
    document.title = `${TRUST_PAGES[slug].title} · Space Learn`
    return () => {
      document.title = before
    }
  }, [slug])
}
