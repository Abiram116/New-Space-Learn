import { Link } from 'react-router-dom'

export function NotFound() {
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
      <div className="flex gap-2">
        <Link
          to="/"
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white"
        >
          Go home
        </Link>
        <Link
          to="/profile"
          className="rounded-xl border-[1.5px] border-line bg-surface px-4 py-2.5 text-sm font-semibold"
        >
          Your profile
        </Link>
      </div>
    </div>
  )
}
