/**
 * Lenis smooth scrolling, wired into GSAP's ScrollTrigger.
 *
 * Native wheel scrolling arrives in coarse, uneven jumps — fine for reading,
 * bad for anything driven *by* scroll position, where those jumps show up
 * directly as stutter. Lenis interpolates the scroll position frame by frame,
 * so everything downstream of it gets a smooth signal instead of a stepped
 * one.
 *
 * The two must share a clock. Left alone, Lenis runs its own rAF loop and
 * ScrollTrigger runs another, so they update on different frames and the
 * pinned scene lags the page by a frame or two. Driving Lenis from GSAP's
 * ticker and telling ScrollTrigger to update on Lenis events keeps them on
 * one heartbeat.
 *
 * Scoped to the landing page on purpose: hijacking scroll is a real cost
 * (it breaks find-in-page ergonomics and feels wrong on a settings screen),
 * and it earns that cost only where scroll is the storytelling device.
 * Disabled entirely under `prefers-reduced-motion`.
 */

import { useEffect, type ReactNode } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

/**
 * The live Lenis instance, for anyone downstream who needs to drive a
 * programmatic scroll (a magnetic snap, a "jump to section" link) through
 * the SAME smoothing engine the page's own scrolling uses. A raw
 * `window.scrollTo` would fight Lenis's virtual scroll position rather than
 * animating it, producing a stutter or a snap-back.
 *
 * A mutable singleton rather than context, matching `attractor` in
 * `wow.tsx` — the instance is owned by one `useEffect` here and only ever
 * read elsewhere, so a full context provider would be ceremony around a
 * value that already has exactly one writer.
 */
export const lenisRef: { current: Lenis | null } = { current: null }

export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({
      // Long enough to glide, short enough that the page still feels like
      // it obeys you. Past ~1.4s smooth scrolling starts to read as lag.
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      // Touch devices already have momentum scrolling; adding ours on top
      // fights the platform and feels broken.
      smoothWheel: true,
      syncTouch: false,
    })

    lenis.on('scroll', ScrollTrigger.update)
    lenisRef.current = lenis

    const raf = (time: number) => {
      // GSAP's ticker is in seconds, Lenis expects milliseconds.
      lenis.raf(time * 1000)
    }
    gsap.ticker.add(raf)
    // Smoothing the ticker on top of Lenis's own easing double-smooths and
    // makes the scrub feel mushy.
    gsap.ticker.lagSmoothing(0)

    return () => {
      lenisRef.current = null
      gsap.ticker.remove(raf)
      lenis.destroy()
      gsap.ticker.lagSmoothing(500, 33)
    }
  }, [])

  return <>{children}</>
}
