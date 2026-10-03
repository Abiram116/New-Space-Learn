import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { trustOverlayHref } from './TrustLayer'

/**
 * "By continuing you agree to the Terms and Privacy" — on the sign-in screens.
 * The links open the pages over the form, so nothing typed is lost.
 */
export function TrustAgreement({ lead, children }: { lead: string; children?: ReactNode }) {
  const location = useLocation()
  const link = 'font-medium text-muted underline underline-offset-2 transition-colors hover:text-ink'
  return (
    <p className="text-xs leading-relaxed text-faint">
      {lead} you agree to the{' '}
      <Link to={trustOverlayHref(location, 'terms')} className={link}>
        Terms
      </Link>{' '}
      and{' '}
      <Link to={trustOverlayHref(location, 'privacy')} className={link}>
        Privacy policy
      </Link>
      .{children ? <> {children}</> : null}
    </p>
  )
}
