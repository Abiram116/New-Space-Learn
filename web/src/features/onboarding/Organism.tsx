/**
 * The canvas the organism lives on, and the plumbing that keeps it placed.
 *
 * One full-viewport canvas behind the page's text. It covers the viewport
 * rather than the organism's box because the organism is not the only thing it
 * draws: the opening's converging particles, the streams from a pressed card,
 * the dissolving name and the finale's flight to the logo all cross the whole
 * screen — and doing all of it on one canvas is one layer to composite, not
 * five.
 *
 * Where the organism sits is decided by layout, not by the engine: `anchor` is
 * an ordinary element in the page grid, and its box is pushed into the engine
 * whenever it can have changed (resize, scroll, a layout shift) — never read
 * per frame.
 */

import { useLayoutEffect, useRef, type RefObject } from 'react'
import { OrganismEngine } from './engine'
import type { Answers } from './steps'

export function Organism({
  anchor,
  engine,
  reduced,
  intro,
  answers,
}: {
  anchor: RefObject<HTMLElement | null>
  engine: RefObject<OrganismEngine | null>
  reduced: boolean
  intro: boolean
  /** The answers to be born with. Later changes go through the engine. */
  answers: Answers
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const born = useRef({ intro, answers })

  useLayoutEffect(() => {
    const el = canvas.current
    if (!el) return
    const eng = new OrganismEngine(el, { reduced, intro: born.current.intro && !reduced, answers: born.current.answers })
    engine.current = eng

    let queued = 0
    const place = () => {
      queued = 0
      const a = anchor.current
      if (!a) return
      const r = a.getBoundingClientRect()
      // Leave room for the orbit and the star, which sit just outside.
      const radius = (Math.min(r.width, r.height) / 2) * 0.84
      eng.setAnchor(r.left + r.width / 2, r.top + r.height / 2, Math.max(60, radius))
    }
    const schedule = () => {
      if (!queued) queued = requestAnimationFrame(place)
    }
    place()
    eng.start()

    const ro = new ResizeObserver(schedule)
    if (anchor.current) ro.observe(anchor.current)
    ro.observe(document.documentElement)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(queued)
      ro.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      eng.destroy()
      if (engine.current === eng) engine.current = null
    }
  }, [anchor, engine, reduced])

  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[5] h-full w-full" />
}
