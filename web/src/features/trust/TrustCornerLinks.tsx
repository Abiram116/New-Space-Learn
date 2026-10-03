import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { TRUST_PAGES, type TrustSlug } from './pages'
import { useTrustLinks } from './useTrustLinks'

/** Two short lines, like the licence credit opposite: the everyday pages, then the formal ones. */
const ROWS: TrustSlug[][] = [
  ['about', 'contact'],
  ['privacy', 'terms'],
]

/**
 * The landing page's links to the trust pages, top-right above the figure.
 *
 * Drawn in two places from this one component: in the hero, and — while a
 * card is open — again by the card, in the same spot but above its dimmed
 * backdrop, so the links stay bright and clickable as the card's tabs.
 * `className` positions it; the open page is the orange one.
 */
export function TrustCornerLinks({ className }: { className?: string }) {
  const { open, linkProps } = useTrustLinks()
  return (
    <nav aria-label="About Space Learn" className={cn('pointer-events-none text-right', className)}>
      {ROWS.map((row, r) => (
        <div key={r} className="setcode text-[13.5px]">
          {row.map((slug, i) => (
            <span key={slug}>
              {i > 0 && <span aria-hidden className="px-1.5 text-faint">·</span>}
              <Link
                {...linkProps(slug)}
                className={cn(
                  'pointer-events-auto transition-colors hover:text-ink',
                  open === slug && 'text-brand',
                )}
              >
                {TRUST_PAGES[slug].label}
              </Link>
            </span>
          ))}
        </div>
      ))}
    </nav>
  )
}
