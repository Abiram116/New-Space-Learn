import { Link, useLocation } from 'react-router-dom'
import type { Space, Subspace } from '../../api/types'
import { cn } from '../../lib/cn'
import { toneDot } from '../../lib/tone'
import { phoneBackFor, phoneTitle, showsTopicSwitcher } from '../../features/mobile/phoneNav'
import { Icon } from '../ui/Icon'

/**
 * The phone's slim top app bar: where you are, and which topic you're in.
 *
 * Left: Back (only on drill-in pages — tabs are roots) and the page title in
 * the display face. Right: the topic switcher, which replaces the desktop
 * rail and its drawer. On You, a Settings button takes that slot instead,
 * because a topic means nothing there.
 */
export function PhoneTopBar({
  space,
  subspace,
  loading,
  onOpenSwitcher,
}: {
  space: Space | null
  subspace: Subspace | null
  loading: boolean
  onOpenSwitcher: () => void
}) {
  const { pathname } = useLocation()
  const title = phoneTitle(pathname)
  const back = phoneBackFor(pathname)

  return (
    <header className="relative z-20 shrink-0 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-2 px-2">
        {back ? (
          <Link
            to={back}
            aria-label="Back"
            className="t-control grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 active:bg-line-soft"
          >
            <Icon name="arrowLeft" size={21} />
          </Link>
        ) : (
          <span className="w-2 shrink-0" aria-hidden />
        )}

        <h1 className="nameplate min-w-0 flex-1 truncate pt-[3px] text-[21px] text-ink">{title}</h1>

        {pathname.replace(/\/+$/, '') === '/profile' ? (
          <Link
            to="/settings"
            aria-label="Settings"
            className="t-control grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 active:bg-line-soft"
          >
            <Icon name="settings" size={20} />
          </Link>
        ) : showsTopicSwitcher(pathname) ? (
          <button
            type="button"
            onClick={onOpenSwitcher}
            aria-haspopup="dialog"
            aria-label={subspace ? `Topic: ${subspace.name}. Change topic` : 'Choose a topic'}
            className={cn(
              't-control flex h-10 min-w-0 max-w-[58%] shrink items-center gap-2 rounded-full border border-line bg-raised pl-3 pr-2.5',
              'shadow-[inset_0_1px_0_rgba(255,237,220,0.06)] active:translate-y-px active:bg-line-soft',
            )}
          >
            {subspace && space ? (
              <>
                <span className={cn('h-2 w-2 shrink-0 rounded-full', toneDot[space.tone])} aria-hidden />
                <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{subspace.name}</span>
              </>
            ) : (
              <span className="min-w-0 truncate text-[14px] font-semibold text-muted">
                {loading ? 'Loading…' : 'Pick a topic'}
              </span>
            )}
            <Icon name="chevronDown" size={15} className="shrink-0 text-faint" />
          </button>
        ) : null}
      </div>
    </header>
  )
}
