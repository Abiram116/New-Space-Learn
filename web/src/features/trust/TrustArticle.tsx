/**
 * One trust page, laid out to be read — shared by the landing page's card
 * (`variant="card"`, wide) and the in-app slide-over (`variant="panel"`,
 * narrow), so both read in the same order:
 *
 *   the short version → the key facts → the full text, one section at a time.
 *
 * The full text is a single column at a comfortable measure (~68 characters),
 * never tiles: tiles in columns read in an order nobody chose, which is what
 * made the old pages feel like "a bunch of info". Long pages (Privacy, Terms)
 * get an "On this page" list — a rail that follows you on wide screens, a
 * fold-out list everywhere else — and the rail marks where you are.
 */

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { Icon } from '../../components/ui/Icon'
import { Icon3D } from '../../components/ui/Icon3D'
import { useReducedMotion } from '../../components/ui/motion'
import { cn } from '../../lib/cn'
import { TOC_MIN_SECTIONS, TRUST_DOCS, type FactTone, type TrustDoc } from './TrustContent'
import type { TrustSlug } from './pages'

export type TrustVariant = 'card' | 'panel'

const TONE: Record<FactTone, string> = {
  sky: 'bg-sky-soft text-sky ring-sky/25',
  sun: 'bg-sun-soft text-sun ring-sun/25',
  brand: 'bg-brand-soft text-brand ring-brand/30',
  jade: 'bg-jade-soft text-jade ring-jade/25',
}

const num = (i: number) => String(i + 1).padStart(2, '0')

export function TrustArticle({
  slug,
  variant,
  scrollRef,
}: {
  slug: TrustSlug
  variant: TrustVariant
  /** The element that scrolls the page — the jump links move it, the rail watches it. */
  scrollRef: RefObject<HTMLElement | null>
}) {
  const doc = TRUST_DOCS[slug]
  const card = variant === 'card'
  const reduced = useReducedMotion()
  const withToc = doc.sections.length >= TOC_MIN_SECTIONS
  const sid = (id: string) => `trust-${slug}-${id}`
  const ids = doc.sections.map((s) => sid(s.id))
  const active = useActiveSection(scrollRef, ids, withToc)
  const foldRef = useRef<HTMLDetailsElement>(null)

  const jump = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    // Not a hash change: the address carries the page underneath (and, in the
    // app, `?info=`), and a fragment would re-route it. Scroll the card instead.
    e.preventDefault()
    const root = scrollRef.current
    const el = document.getElementById(id)
    if (!root || !el) return
    const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 12
    if (typeof root.scrollTo === 'function') root.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
    else root.scrollTop = top
    // Keyboard and screen-reader users land where they asked to go.
    el.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true })
    if (foldRef.current) foldRef.current.open = false
  }

  const toc = (rail: boolean) => (
    <ol className={cn('flex flex-col', rail ? 'mt-3 border-l border-white/[0.09]' : 'mt-2 gap-0.5')}>
      {doc.sections.map((s, i) => {
        const here = active === sid(s.id)
        return (
          <li key={s.id}>
            <a
              href={`#${sid(s.id)}`}
              onClick={(e) => jump(e, sid(s.id))}
              aria-current={rail && here ? 'location' : undefined}
              className={cn(
                'flex gap-2.5 rounded-r-md leading-snug transition-colors',
                rail
                  ? cn('-ml-px border-l-2 py-1.5 pl-3 pr-1 text-[13.5px]', here ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')
                  : 'min-h-10 items-center rounded-lg px-2 text-[14.5px] text-ink-2 hover:bg-white/[0.05] hover:text-ink',
              )}
            >
              <span aria-hidden className={cn('shrink-0 font-mono text-[11px] tabular-nums', rail ? 'pt-[3px]' : '', here && rail ? 'text-brand' : 'text-faint')}>
                {num(i)}
              </span>
              <span className="min-w-0">{s.title}</span>
            </a>
          </li>
        )
      })}
    </ol>
  )

  const fold = withToc && (
    <details
      ref={foldRef}
      className={cn(
        'group rounded-2xl border border-white/[0.08] bg-white/[0.025] [&_summary::-webkit-details-marker]:hidden',
        card && 'lg:hidden',
      )}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 text-[14.5px] font-medium text-ink">
        <Icon name="listOrdered" size={16} className="shrink-0 text-brand" />
        <span className="flex-1">On this page</span>
        <span className="setcode">{doc.sections.length} sections</span>
        <Icon name="chevronDown" size={15} className="shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <nav aria-label="On this page" className="px-2 pb-3">
        {toc(false)}
      </nav>
    </details>
  )

  const main = (
    <div className="min-w-0 max-w-[70ch]">
      <ShortVersion doc={doc} card={card} />
      {doc.intro && (
        <div className={cn('mt-5 text-ink-2', card ? 'text-[16.5px] leading-[1.75]' : 'text-[15px] leading-[1.7]')}>{doc.intro}</div>
      )}
      {doc.facts && <Facts slug={slug} doc={doc} card={card} />}
      {fold && <div className="mt-8">{fold}</div>}

      <div className={cn(card ? 'mt-10' : 'mt-8')}>
        {doc.sections.map((s, i) => (
          <section
            key={s.id}
            id={sid(s.id)}
            aria-labelledby={`${sid(s.id)}-h`}
            className={cn('border-t border-white/[0.07] first:border-t-0 first:pt-0', card ? 'py-8' : 'py-6')}
          >
            <h3
              id={`${sid(s.id)}-h`}
              tabIndex={-1}
              className={cn('flex items-baseline gap-3 font-semibold leading-snug text-ink outline-none', card ? 'text-[21px]' : 'text-[17px]')}
            >
              {withToc && (
                <span aria-hidden className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-brand">
                  {num(i)}
                </span>
              )}
              <span className="text-pretty">{s.title}</span>
            </h3>
            <div className={cn('mt-3 text-ink-2', card ? 'text-[16.5px] leading-[1.75]' : 'text-[15px] leading-[1.7]')}>{s.body}</div>
          </section>
        ))}
      </div>
    </div>
  )

  const aside = doc.aside && (
    <aside className={cn(card ? 'mt-4 lg:sticky lg:top-0 lg:mt-0 lg:self-start' : 'mt-2 border-t border-white/[0.07] pt-6')} aria-label={doc.aside.title}>
      <p className="setcode mb-4">{doc.aside.title}</p>
      {doc.aside.body}
    </aside>
  )

  if (!card) {
    return (
      <div>
        {main}
        {aside}
      </div>
    )
  }

  // Wide screens: the rail on the left, the text at a reading measure, the
  // aside (if any) on the right — centred as one block, so a very wide card
  // never stretches a line of text across the whole screen.
  return (
    <div
      className={cn(
        'mx-auto max-w-[1120px] lg:grid lg:gap-12',
        withToc && doc.aside && 'lg:grid-cols-[200px_minmax(0,1fr)_280px]',
        withToc && !doc.aside && 'lg:grid-cols-[210px_minmax(0,1fr)]',
        !withToc && doc.aside && 'lg:grid-cols-[minmax(0,1fr)_300px]',
      )}
    >
      {withToc && (
        <nav aria-label="On this page" className="hidden lg:sticky lg:top-0 lg:block lg:self-start">
          <p className="setcode">On this page</p>
          {toc(true)}
        </nav>
      )}
      {main}
      {aside}
    </div>
  )
}

/** "The short version" — the one thing to read if you read nothing else. */
function ShortVersion({ doc, card }: { doc: TrustDoc; card: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand/25 bg-brand/[0.07] py-4 pl-5 pr-5 sm:py-5 sm:pl-6">
      <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-brand" />
      <p className="setcode setcode-hot">The short version</p>
      <p className={cn('mt-2 text-pretty font-medium text-ink', card ? 'text-[18px] leading-[1.55] sm:text-[20px]' : 'text-[16px] leading-[1.55]')}>
        {doc.summary}
      </p>
    </div>
  )
}

/** The key facts, as tiles — what people come to a policy page to find. */
function Facts({ slug, doc, card }: { slug: TrustSlug; doc: TrustDoc; card: boolean }) {
  const id = `trust-${slug}-glance`
  return (
    <section aria-labelledby={id} className="mt-8">
      <h3 id={id} className="setcode">
        At a glance
      </h3>
      <ul className={cn('mt-3 grid gap-3', card && 'sm:grid-cols-2')}>
        {doc.facts!.map((f) => (
          <li key={f.label} className="flex gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-4">
            <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset', TONE[f.tone])}>
              <Icon3D name={f.icon} size={19} lifted />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug text-ink">{f.label}</p>
              <p className="mt-1 text-[14.5px] leading-[1.6] text-ink-2">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Which section is being read: the last one whose top has passed a line a
 * little below the top of the scroller (and the last one at the very bottom).
 * Reads only — measured at most once a frame, while the page scrolls.
 */
function useActiveSection(scrollRef: RefObject<HTMLElement | null>, ids: string[], enabled: boolean): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0])
  const key = ids.join('|')
  useEffect(() => {
    const list = key.split('|')
    setActive(list[0])
    if (!enabled) return
    const root = scrollRef.current
    if (!root) return
    let raf = 0
    const measure = () => {
      raf = 0
      const line = root.getBoundingClientRect().top + 120
      let current = list[0]
      for (const id of list) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      if (root.scrollHeight > root.clientHeight && root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        current = list[list.length - 1]
      }
      setActive(current)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [key, enabled, scrollRef])
  return active
}
