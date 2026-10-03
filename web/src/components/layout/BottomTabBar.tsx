import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { cn } from '../../lib/cn'
import { badgeText, phoneTabFor, type PhoneTab } from '../../features/mobile/phoneNav'
import { Icon, type IconName } from '../ui/Icon'

/**
 * The phone's primary navigation: the five things you do on a phone.
 *
 * Today, Cards, Quizzes, Notes, You — revision, not research. There is no
 * Chat tab on purpose (chat lives on the big screen, see ChatOnDesktop).
 * Sits in the shell's flex column rather than `position: fixed`, so content
 * above it can never scroll underneath and nothing needs to guess its height.
 */
export function BottomTabBar({
  dueCount,
}: {
  /** Cards due, for the badge. Null when unknown — no badge rather than a guess. */
  dueCount: number | null
}) {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const active = phoneTabFor(pathname)
  const name =
    (user?.user_metadata?.display_name as string | undefined) || user?.email?.split('@')[0] || 'You'

  const tabs: { key: PhoneTab; to: string; label: string; icon: IconName | 'avatar'; badge?: string | null }[] = [
    { key: 'today', to: '/home', label: 'Today', icon: 'home' },
    { key: 'cards', to: '/flashcards', label: 'Cards', icon: 'deck', badge: badgeText(dueCount) },
    { key: 'quizzes', to: '/quizzes', label: 'Quizzes', icon: 'quiz' },
    { key: 'notes', to: '/notes', label: 'Notes', icon: 'note' },
    { key: 'you', to: '/profile', label: 'You', icon: 'avatar' },
  ]

  return (
    <nav
      aria-label="Main"
      data-phone-tabbar=""
      className="relative z-20 shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {tabs.map((tab) => {
          const isActive = active === tab.key
          return (
            <li key={tab.key} className="min-w-0">
              <Link
                to={tab.to}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.badge ? `${tab.label}, ${tab.badge} due` : tab.label}
                data-tab={tab.key}
                className={cn(
                  'group flex min-h-[60px] flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2 outline-offset-[-3px]',
                  '[-webkit-tap-highlight-color:transparent]',
                )}
              >
                <span
                  className={cn(
                    't-control relative grid h-8 w-14 place-items-center rounded-full',
                    isActive ? 'bg-brand-soft text-brand' : 'text-faint group-active:bg-line-soft',
                  )}
                >
                  {tab.icon === 'avatar' ? (
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-[26px] w-[26px] place-items-center rounded-full bg-coral-soft text-[12px] font-bold text-coral-deep',
                        isActive && 'ring-2 ring-brand',
                      )}
                    >
                      {name.slice(0, 2).toUpperCase()}
                    </span>
                  ) : (
                    <Icon name={tab.icon} size={22} strokeWidth={isActive ? 2 : 1.7} />
                  )}
                  {tab.badge && (
                    <span
                      aria-hidden
                      className="absolute -top-1 left-[calc(50%+6px)] min-w-[19px] rounded-full bg-sun px-1 text-center font-mono text-[12px] font-bold leading-[19px] text-[#1a120f] ring-2 ring-surface"
                    >
                      {tab.badge}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'max-w-full truncate text-[12px] leading-none tracking-[0.01em]',
                    isActive ? 'font-bold text-ink' : 'font-semibold text-muted',
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
