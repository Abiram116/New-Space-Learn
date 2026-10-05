/**
 * The page frame around Settings: the header with its profile card, the
 * section navigation, and the cross-fade between sections.
 *
 * The navigation is ONE tablist. When the page is wide enough (a container
 * query on the page itself, not the screen, so a collapsed or open sidebar
 * both work) it is a rail down the left with an active pill that slides
 * between tabs; narrower, the same buttons lay out as a scrollable chip strip. One set of buttons means one set of ids, one roving
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
          className="relative flex snap-x snap-proximity gap-2 overflow-x-auto scroll-px-[var(--pad)] px-[var(--pad)] py-2.5 [scrollbar-width:none] @4xl/page:snap-none @4xl/page:flex-col @4xl/page:gap-1 @4xl/page:overflow-visible @4xl/page:rounded-2xl @4xl/page:border @4xl/page:border-line @4xl/page:bg-surface @4xl/page:p-1.5 @4xl/page:px-1.5 [&::-webkit-scrollbar]:hidden"
        >
          <span
            aria-hidden
            data-testid="nav-indicator"
            data-index={index}
            className={cn(
              'pointer-events-none absolute inset-x-1.5 top-0 hidden h-12 rounded-[12px] bg-brand-soft ring-1 ring-brand/40 @4xl/page:block',
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
                  'group t-control relative z-10 flex h-11 shrink-0 cursor-pointer snap-start items-center gap-2.5 whitespace-nowrap rounded-full border px-4 text-[14px] @4xl/page:h-12 @4xl/page:w-full @4xl/page:rounded-[12px] @4xl/page:border-transparent @4xl/page:px-3.5',
                  selected
                    ? 'border-brand/40 bg-brand-soft font-bold text-brand-deep @4xl/page:bg-transparent'
                    : 'border-line bg-raised font-medium text-ink-3 hover:border-line-dash hover:text-ink @4xl/page:bg-transparent @4xl/page:hover:bg-line-soft',
                )}
              >
                <Icon
                  name={item.icon}
                  size={16}
                  className="shrink-0 t-move group-hover:scale-110 @max-4xl/page:hidden"
                />
                {item.name}
              </button>
            )
          })}
        </div>
        <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-canvas to-transparent t-move duration-150 @4xl/page:hidden', edges.start ? 'opacity-100' : 'opacity-0')} />
        <span aria-hidden className={cn('pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-canvas to-transparent t-move duration-150 @4xl/page:hidden', edges.end ? 'opacity-100' : 'opacity-0')} />
      </div>
      {shown && (
        <Rise key={shown.name} distance={4} className="mt-3 hidden px-3 @4xl/page:block">
          <p className="text-[12.5px] leading-snug text-faint">{shown.summary}</p>
        </Rise>
      )}
    </div>
  )
}

/** Remounts per section and eases in from the side the new tab sits on. */
export function TabSwap({ id, dir, grid, children }: { id: string; dir: number; grid: string; children: ReactNode }) {
  return (
    <SwapInner key={id} dir={dir} grid={grid}>
      {children}
    </SwapInner>
  )
}

function SwapInner({ dir, grid, children }: { dir: number; grid: string; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [on, setOn] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])
  return (
    <div
      className={cn('grid items-stretch gap-[clamp(1rem,0.6rem+1.2cqi,1.5rem)] t-move duration-300 ease-out', grid)}
      style={{ opacity: on ? 1 : 0, transform: on ? 'none' : `translateX(${dir * 14}px)` }}
    >
      {children}
    </div>
  )
}

/**
 * Big title, a friendly line, and who you are signed in as. Sizes follow the
 * page's own width (container units), so the header grows with the page and
 * stops growing where a line would get too long.
 */
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
    <header className="flex flex-col gap-5 @2xl/page:flex-row @2xl/page:items-end @2xl/page:justify-between @2xl/page:gap-8">
      <Rise>
        <h1 className="font-display text-[clamp(2rem,1.3rem+1.5cqi,3.25rem)] font-semibold leading-none tracking-tight text-ink">Settings</h1>
        <p className="mt-3 max-w-[40ch] text-[clamp(0.9375rem,0.9rem+0.15cqi,1.0625rem)] leading-relaxed text-muted">
          Make Space Learn yours. Every change saves as soon as you make it.
        </p>
      </Rise>
      <Rise delay={80} className="min-w-0 max-w-full self-start @2xl/page:max-w-[26rem] @2xl/page:shrink-0">
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
