import { Link } from 'react-router-dom'
import { useOptionalAuth } from '../auth/AuthProvider'

export function NotFound() {
  // Signed out, "Go home" and "Your profile" both just led to the sign-in
  // page. Offer what a visitor can actually open instead.
  const signedIn = Boolean(useOptionalAuth()?.session)
  const primary = 'rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-[#1a120f]'
  const secondary = 'rounded-xl border-[1.5px] border-line bg-surface px-4 py-2.5 text-sm font-semibold'
  return (
    <div className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span
        aria-hidden
        className="font-display text-6xl font-semibold text-brand-200 tracking-tight"
      >
        404
      </span>
      <h1 className="font-display text-2xl font-semibold">Nothing at this address</h1>
      <p className="text-sm text-muted">
        The link may be old, or the space it belonged to has been renamed.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {signedIn ? (
          <>
            <Link to="/home" className={primary}>
              Go home
            </Link>
            <Link to="/profile" className={secondary}>
              Your profile
            </Link>
          </>
        ) : (
          <>
            <Link to="/welcome" className={primary}>
              Back to Space Learn
            </Link>
            <Link to="/signin" className={secondary}>
              Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
