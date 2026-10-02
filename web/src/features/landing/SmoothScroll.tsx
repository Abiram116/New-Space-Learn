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
import { SCROLL_LOCK_EVENT } from '../../lib/scrollLock'

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
      // 1.1s → 0.8s → 0.5s → 0.35s. Still not the whole story on its own —
      // `easing` below is an expo-out curve, which decelerates hardest
      // right at the END of its own duration. That's the right shape for
      // scroll in general (real momentum scrolling decelerates into a
      // stop), but it means the very last sliver of distance — exactly the
      // sliver between "close to the bottom" and "actually at the
      // bottom" — is where the curve is slowest, however short `duration`
      // itself is. Cutting `duration` further is still worth doing (less
      // time overall spent in that slow tail), paired below with loosening
      // how much of the curve `landed` has to wait through.
      duration: 0.35,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      // Touch devices already have momentum scrolling; adding ours on top
      // fights the platform and feels broken.
      smoothWheel: true,
      syncTouch: false,
    })

    lenis.on('scroll', ScrollTrigger.update)
    lenisRef.current = lenis
    // Hold still while something covers the page (a trust page's card).
    const onLock = (e: Event) => ((e as CustomEvent<boolean>).detail ? lenis.stop() : lenis.start())
    window.addEventListener(SCROLL_LOCK_EVENT, onLock)

    const raf = (time: number) => {
      // GSAP's ticker is in seconds, Lenis expects milliseconds.
      lenis.raf(time * 1000)
    }
    gsap.ticker.add(raf)
    // Smoothing the ticker on top of Lenis's own easing double-smooths and
    // makes the scrub feel mushy.
    gsap.ticker.lagSmoothing(0)

    // THE OTHER DIRECTION. `lenis.on('scroll', ScrollTrigger.update)` above
    // is Lenis telling ScrollTrigger about scroll changes; nothing was
    // telling LENIS about DOCUMENT changes. `HeroReveal`'s pinned
    // ScrollTrigger inserts a pin-spacer that makes the real page taller
    // than it was at mount — Lenis measures scrollable height once when it
    // initializes (before that pin has necessarily finished setting up)
    // and has no way to know on its own that the page grew afterward. Its
    // internal notion of "how far can this page scroll" stays anchored to
    // the shorter, pre-pin height, so once real scroll passes that stale
    // limit, Lenis's own math has nowhere further to smooth toward and it
    // stops doing anything — reported as "smooth exactly until the hero,
    // then default" past that point. `ScrollTrigger`'s own `refresh` event
    // fires whenever it recalculates layout (including right after a pin
    // sets up), so re-measuring Lenis there keeps the two in agreement
    // about how tall the page actually is.
    const onRefresh = () => lenis.resize()
    ScrollTrigger.addEventListener('refresh', onRefresh)

    // FONT SWAP, THE OTHER LAYOUT-SHIFT SOURCE. `index.html` loads Archivo
    // behind a render-blocking Google Fonts `<link>` with `display: swap`, so
    // the page can paint its first frame in the Manrope fallback and swap to
    // Archivo a beat later. Every ScrollTrigger on the page (the hero pin,
    // the two `useScrollProgress` measurements) was set up against whatever
    // that fallback's line heights and widths were; if the swap lands after
    // that, every one of those measurements is now stale by however much the
    // real display font differs, and scroll positions jump. `fonts.ready`
    // resolves once the swap has actually happened (or immediately if there
    // was nothing to swap), so refreshing there re-measures against the font
    // that's actually on screen. Guarded for the API's absence rather than
    // assumed — the App still works, just without this correction, on
    // whatever ancient engine doesn't have it.
    document.fonts?.ready?.then(() => ScrollTrigger.refresh())

    return () => {
      window.removeEventListener(SCROLL_LOCK_EVENT, onLock)
      lenisRef.current = null
      gsap.ticker.remove(raf)
      ScrollTrigger.removeEventListener('refresh', onRefresh)
      lenis.destroy()
      gsap.ticker.lagSmoothing(500, 33)
    }
  }, [])

  return <>{children}</>
}
