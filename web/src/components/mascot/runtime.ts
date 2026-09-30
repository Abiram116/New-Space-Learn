import { FOLLOW_MOODS } from './moods'

/**
 * One IntersectionObserver and one pointer listener shared by every bot on the
 * page. Nothing here touches React state: offscreen bots get `data-bot-off`
 * (mascot.css pauses their loops), and eye-follow writes two CSS variables.
 */

const hasWindow = typeof window !== 'undefined'

export function prefersReducedMotion(): boolean {
  return hasWindow && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

let io: IntersectionObserver | null = null

export function watchVisibility(el: Element): () => void {
  if (!hasWindow || typeof IntersectionObserver === 'undefined') return () => {}
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) e.target.toggleAttribute('data-bot-off', !e.isIntersecting)
  })
  io.observe(el)
  return () => io?.unobserve(el)
}

const lookers = new Set<SVGSVGElement>()
let px = 0
let py = 0
let frame = 0

function tick() {
  frame = 0
  const reads: [SVGSVGElement, number, number][] = []
  for (const el of lookers) {
    const follow = !el.hasAttribute('data-bot-off') && FOLLOW_MOODS.has(el.dataset.mood ?? '')
    if (!follow) {
      reads.push([el, 0, 0])
      continue
    }
    const r = el.getBoundingClientRect()
    const dx = px - (r.left + r.width / 2)
    const dy = py - (r.top + r.height * 0.45)
    const clamp = (v: number) => Math.max(-1, Math.min(1, v / 260))
    reads.push([el, clamp(dx) * 3.4, clamp(dy) * 2.6])
  }
  for (const [el, x, y] of reads) {
    el.style.setProperty('--lx', `${x.toFixed(2)}px`)
    el.style.setProperty('--ly', `${y.toFixed(2)}px`)
  }
}

function onMove(e: PointerEvent) {
  px = e.clientX
  py = e.clientY
  if (!frame) frame = requestAnimationFrame(tick)
}

export function followPointer(el: SVGSVGElement): () => void {
  if (!hasWindow || prefersReducedMotion()) return () => {}
  if (lookers.size === 0) {
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onMove, { passive: true })
  }
  lookers.add(el)
  return () => {
    lookers.delete(el)
    if (lookers.size === 0) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onMove)
      if (frame) cancelAnimationFrame(frame)
      frame = 0
    }
  }
}

/** Stable per-instance phase so a family on one screen never blinks in unison. */
export function phaseFrom(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h % 4000)
}
