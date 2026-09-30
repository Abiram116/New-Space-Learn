import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { LogoMark } from '../ui/Logo'

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
    <header className="flex shrink-0 items-center gap-3 border-b-[1.5px] border-line bg-surface px-3 py-2 md:hidden">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-ink-2 transition-colors hover:bg-line-soft active:bg-line"
      >
        {/* Three rules that echo the sidebar's stacked nav rows. */}
        <span className="flex w-5 flex-col gap-[4.5px]" aria-hidden>
          <span className="h-[2px] w-full rounded-full bg-current" />
          <span className="h-[2px] w-full rounded-full bg-current" />
          <span className="h-[2px] w-3/4 rounded-full bg-current" />
        </span>
      </button>

      <Link to="/home" className="flex min-h-11 min-w-0 items-center gap-2.5">
        <LogoMark size={24} />
        <span className="nameplate truncate text-[17px]">Space Learn</span>
      </Link>

      <Link
        to="/profile"
        aria-label={`${name} — profile`}
        className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-coral-soft text-[13px] font-bold text-coral-deep"
      >
        {name.slice(0, 2).toUpperCase()}
      </Link>
    </header>
  )
}
