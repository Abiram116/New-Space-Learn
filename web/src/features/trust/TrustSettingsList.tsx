import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { SOURCE_URL } from './config'
import { TRUST_PAGES, TRUST_SLUGS, type TrustSlug } from './pages'
import { trustOverlayHref } from './TrustLayer'

const BLURB: Record<TrustSlug, string> = {
  about: 'What Space Learn is, and who makes it',
  privacy: 'What we store, who processes it, how to delete it',
  terms: 'The rules for using the service',
  contact: 'Write to the team',
  feedback: 'Tell us what to fix or build next',
}

/**
 * Settings › About & legal. Each row opens the same panel the landing page
 * uses, over Settings — one copy of the text, in both places.
 */
export function TrustSettingsList() {
  const location = useLocation()
  return (
    <div className="flex flex-col gap-3">
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {TRUST_SLUGS.map((slug) => (
          <li key={slug} className="border-b border-line last:border-b-0">
            <Link
              to={trustOverlayHref(location, slug)}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-line-soft"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-raised text-ink-3">
                <Icon name={TRUST_PAGES[slug].icon} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-ink">{TRUST_PAGES[slug].label}</span>
                <span className="block truncate text-[12.5px] text-muted">{BLURB[slug]}</span>
              </span>
              <Icon name="chevronRight" size={15} className="shrink-0 text-faint" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="setcode text-faint">
        Space Learn · MIT licensed ·{' '}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-ink">
          Source on GitHub
        </a>
      </p>
    </div>
  )
}
