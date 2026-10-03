/**
 * The page frame around Settings: the header with its profile card, the
 * section navigation, and the cross-fade between sections.
 *
 * The navigation is ONE tablist. At `lg` it is a rail down the left with an
 * active pill that slides between tabs; below `lg` the same buttons lay out as
 * a scrollable chip strip. One set of buttons means one set of ids, one roving
 * tabindex and one arrow-key handler for both.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Rise, useReducedMotion } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { SPRING } from './parts'

export const PANEL_ID = 'settings-panel'
export const tabId = (name: string) => `settings-tab-${name.replace(/\W+/g, '-').toLowerCase()}`

export type NavItem<T extends string> = { name: T; icon: IconName; summary: string }

export function SettingsNav<T extends string>({
  items,
  active,
  onSelect,
}: {
  items: NavItem<T>[]
  active: T
  onSelect: (name: T) => void
}) {
  const reduced = useReducedMotion()
  const listRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: true })
  const [y, setY] = useState(0)
  const [ready, setReady] = useState(false)
  const [peek, setPeek] = useState<T | null>(null)
  const index = items.findIndex((i) => i.name === active)

  const measure = useCallback(() => {
    const el = listRef.current
    if (!el) return
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    const tab = el.querySelector<HTMLElement>('[aria-selected="true"]')
    if (tab) setY(tab.offsetTop)
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [active, measure])

  // No slide-in from the top on first paint: enable the transition afterwards.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const chip = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    chip?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [active])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = items.length
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else return
    e.preventDefault()
    onSelect(items[next].name)
    listRef.current?.querySelector<HTMLElement>(`#${tabId(items[next].name)}`)?.focus()
  }

  const shown = items.find((i) => i.name === (peek ?? active))

  return (
    <div>
      <div className="relative">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Settings sections"
          onScroll={measure}
          onKeyDown={onKeyDown}
          className="relative flex snap-x snap-proximity gap-2 overflow-x-auto scroll-px-4 px-4 py-2.5 [scrollbar-width:none] sm:px-6 lg:snap-none lg:flex-col lg:gap-1 lg:overflow-visible lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-1.5 [&::-webkit-scrollbar]:hidden"
        >
          <span
            aria-hidden
            data-testid="nav-indicator"
            data-index={index}
            className={cn(
              'pointer-events-none absolute inset-x-1.5 top-0 hidden h-12 rounded-[12px] bg-brand-soft ring-1 ring-brand/40 lg:block',
              ready && !reduced && 't-move duration-[380ms]',
            )}
            style={{ transform: `translateY(${y}px)`, transitionTimingFunction: SPRING }}
          >
            <span className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-brand" />
          </span>
          {items.map((item) => {
            const selected = item.name === active
            return (
              <button
                key={item.name}
                id={tabId(item.name)}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={PANEL_ID}
                tabIndex={selected ? 0 : -1}
                onClick={() => onSelect(item.name)}
                onMouseEnter={() => setPeek(item.name)}
                onMouseLeave={() => setPeek(null)}
                onFocus={() => setPeek(item.name)}
                onBlur={() => setPeek(null)}
                className={cn(
                  'group t-control relative z-10 flex h-11 shrink-0 cursor-pointer snap-start items-center gap-2.5 whitespace-nowrap rounded-full border px-4 text-[14px] lg:h-12 lg:w-full lg:rounded-[12px] lg:border-transparent lg:px-3.5',
                  selected
                    ? 'border-brand/40 bg-brand-soft font-bold text-brand-deep lg:bg-transparent'
                    : 'border-line bg-raised font-medium text-ink-3 hover:border-line-dash hover:text-ink lg:bg-transparent lg:hover:bg-line-soft',
                )}
              >
                <Icon
                  name={item.icon}
                  size={16}
                  className="shrink-0 t-move group-hover:scale-110 max-lg:hidden"
                />
                {item.name}
              </button>
            )
          })}
        </div>
        <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-canvas to-transparent t-move duration-150 lg:hidden', edges.start ? 'opacity-100' : 'opacity-0')} />
        <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-canvas to-transparent t-move duration-150 lg:hidden', edges.end ? 'opacity-100' : 'opacity-0')} />
      </div>
      {shown && (
        <Rise key={shown.name} distance={4} className="mt-3 hidden px-3 lg:block">
          <p className="text-[12.5px] leading-snug text-faint">{shown.summary}</p>
        </Rise>
      )}
    </div>
  )
}

/** Remounts per section and eases in from the side the new tab sits on. */
export function TabSwap({ id, dir, children }: { id: string; dir: number; children: ReactNode }) {
  return (
    <SwapInner key={id} dir={dir}>
      {children}
    </SwapInner>
  )
}

function SwapInner({ dir, children }: { dir: number; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [on, setOn] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,400px),1fr))] items-stretch gap-4 t-move duration-300 ease-out xl:gap-5"
      style={{ opacity: on ? 1 : 0, transform: on ? 'none' : `translateX(${dir * 14}px)` }}
    >
      {children}
    </div>
  )
}

/** Big title, a friendly line, and who you are signed in as. */
export function SettingsHeader({
  name,
  initials,
  email,
  streak,
  goal,
}: {
  name: string
  initials: string
  email: string
  streak: number | null
  goal: number | null
}) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <Rise>
        <h1 className="font-display text-[36px] font-semibold leading-none tracking-tight text-ink sm:text-[44px]">Settings</h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
          Make Space Learn yours. Everything here saves the moment you change it.
        </p>
      </Rise>
      <Rise delay={80}>
        <div className="flex items-center gap-4 rounded-2xl border border-line bg-surface py-3 pl-3 pr-5">
          <span
            aria-hidden
            className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-brand-soft font-display text-[20px] font-semibold text-brand-deep ring-1 ring-brand/30"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[16px] font-semibold text-ink">{name}</div>
            <div className="truncate text-[13px] text-muted">{email}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {streak !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sun-soft px-2 py-0.5 text-[11.5px] font-medium text-sun-deep">
                  <Icon name="flame" size={11} />
                  {streak === 1 ? '1-day streak' : `${streak}-day streak`}
                </span>
              )}
              {goal !== null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-soft px-2 py-0.5 text-[11.5px] font-medium text-sky-deep">
                  <Icon name="target" size={11} />
                  {goal} cards a day
                </span>
              )}
            </div>
          </div>
        </div>
      </Rise>
    </header>
  )
}
