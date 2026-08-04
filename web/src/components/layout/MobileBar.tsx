import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'

/**
 * Phone-only top bar. Carries the three things you always need at hand — get
 * back to your spaces, get home, get to your account — and nothing else. The
 * page's own header (breadcrumb, tabs) still renders below it.
 */
export function MobileBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { user } = useAuth()
  const name =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'

  return (
    <header className="flex shrink-0 items-center gap-3 border-b-[1.5px] border-line bg-surface px-4 py-2.5 md:hidden">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="-ml-1 flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-line-soft active:bg-line"
      >
        {/* Three rules that echo the sidebar's stacked nav rows. */}
        <span className="flex w-[18px] flex-col gap-[3.5px]" aria-hidden>
          <span className="h-[1.5px] w-full rounded-full bg-current" />
          <span className="h-[1.5px] w-full rounded-full bg-current" />
          <span className="h-[1.5px] w-3/4 rounded-full bg-current" />
        </span>
      </button>

      <Link to="/" className="flex min-w-0 items-center gap-2">
        <span className="h-[22px] w-[22px] shrink-0 rounded-md bg-brand" />
        <span className="truncate font-display text-[15px] font-semibold">Space Learn</span>
      </Link>

      <Link
        to="/profile"
        aria-label={`${name} — profile`}
        className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-coral-soft text-[11px] font-semibold text-coral-deep"
      >
        {name.slice(0, 2).toUpperCase()}
      </Link>
    </header>
  )
}
