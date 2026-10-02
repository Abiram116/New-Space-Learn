/**
 * The trust pages — About, Privacy, Terms, Contact, Feedback.
 *
 * One registry, read by everything that links to them (the landing page's
 * corner, Settings, the sign-in screens) and by the panel that shows them, so
 * a page is added or renamed in exactly one place.
 *
 * Each page has two forms:
 *   - `/privacy` — a card over the landing page (TrustCard): shareable, in
 *     the sitemap, and what Google's sign-in consent screen asks for. The
 *     landing page links here.
 *   - `?info=privacy` on whatever page you are on — a slide-over (TrustPanel),
 *     how the app and the sign-in screens open it, so the page underneath stays put.
 */

import type { IconName } from '../../components/ui/Icon'

export const TRUST_SLUGS = ['about', 'privacy', 'terms', 'contact', 'feedback'] as const
export type TrustSlug = (typeof TRUST_SLUGS)[number]

export const TRUST_PAGES: Record<TrustSlug, { label: string; title: string; icon: IconName }> = {
  about: { label: 'About', title: 'About Space Learn', icon: 'user' },
  privacy: { label: 'Privacy', title: 'Privacy', icon: 'lock' },
  terms: { label: 'Terms', title: 'Terms of use', icon: 'seal' },
  contact: { label: 'Contact', title: 'Contact', icon: 'send' },
  feedback: { label: 'Feedback', title: 'Feedback', icon: 'thumbUp' },
}

/** Shown on Privacy and Terms. Change both whenever either page's substance does. */
export const TRUST_UPDATED = '2 October 2026'
export const TRUST_VERSION = '1.0'

/** The query parameter that opens a page over the current one. */
export const TRUST_PARAM = 'info'

export function isTrustSlug(value: string | null | undefined): value is TrustSlug {
  return (TRUST_SLUGS as readonly string[]).includes(value ?? '')
}

/** `/privacy` → `privacy`; anything else → null. */
export function slugFromPath(pathname: string): TrustSlug | null {
  const m = /^\/([a-z]+)\/?$/.exec(pathname)
  return m && isTrustSlug(m[1]) ? m[1] : null
}

