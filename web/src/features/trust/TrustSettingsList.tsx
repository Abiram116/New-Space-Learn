import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../../components/ui/Icon'
import { SOURCE_URL, TEAM } from './config'
import { PersonContact } from './PersonContact'
import { PANEL_SLUGS, TRUST_PAGES, TRUST_UPDATED, type PanelSlug } from './pages'
import { trustOverlayHref } from './TrustLayer'

const SUBTITLE: Record<PanelSlug, string> = {
  about: 'What Space Learn is, and the two of us behind it',
  privacy: `What we store and who processes it · Effective ${TRUST_UPDATED}`,
  terms: `The rules for using the service · Effective ${TRUST_UPDATED}`,
}

/**
 * Settings › About & legal.
 *
 * What you READ opens the same slide-over the sign-in screens use (one copy of
 * the words). What you DO sits right here: both of us, to write to or copy.
 */
export function TrustSettingsList() {
  const location = useLocation()
  return (
    <div className="flex flex-col gap-6">
      <ul className="overflow-hidden rounded-xl border border-line bg-surface">
        {PANEL_SLUGS.map((slug) => (
          <li key={slug} className="border-b border-line last:border-b-0">
            <Link
              to={trustOverlayHref(location, slug)}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-line-soft"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-raised text-ink-3">
                <Icon name={TRUST_PAGES[slug].icon} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-medium text-ink">{TRUST_PAGES[slug].title}</span>
                <span className="block truncate text-[12.5px] text-muted">{SUBTITLE[slug]}</span>
              </span>
              <Icon name="chevronRight" size={15} className="shrink-0 text-faint" />
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="settings-contact" className="flex flex-col gap-3">
        <div>
          <h3 id="settings-contact" className="text-[14.5px] font-semibold text-ink">
            Contact
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">Two people build Space Learn. Write to either of us.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEAM.map((person, i) => (
            <PersonContact key={`${person.email}-${i}`} person={person} />
          ))}
        </div>
      </section>

      <p className="setcode text-faint">
        Space Learn · MIT licensed ·{' '}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-ink">
          Source
        </a>
      </p>
    </div>
  )
}
