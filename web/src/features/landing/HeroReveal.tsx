/**
 * The hero, and the reveal that follows it.
 *
 * Opens with the headline holding the screen and only the top edge of the
 * scene showing along the bottom — a room you are about to walk into. As you
 * scroll, the frame rises: it pushes the headline up and out, and grows to
 * fill the viewport without ever touching its edges. The inset is the point.
 * A full-bleed video reads as a background; a framed one reads as a window,
 * and a window is the thing worth looking through.
 *
 * The clip itself has no camera move in it at all. Everything that moves is
 * inside the room — someone typing, clouds crossing the window, leaves
 * shifting. That is what makes it survive being on screen for a long time:
 * there is no gesture to notice, get used to, and then find repetitive.
 *
 * The clip is a ping-pong: five seconds forward followed by the same five
 * reversed, so the end frame always matches the start and the loop has no
 * seam. That is baked into the file rather than done in JavaScript on
 * purpose — driving playback backwards by writing `currentTime` forces a
 * seek per frame, which stutters in every browser. Concatenated, it is just
 * a normal looping video the decoder handles perfectly for free.
 *
 * Scroll drives the reveal through GSAP ScrollTrigger, fed by Lenis (see
 * SmoothScroll) so the geometry interpolates on a smooth signal rather than
 * on raw, steppy wheel deltas.
 */

import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { DUR, EASE, STAGGER } from './language'
import { useReducedMotion } from '../../components/ui/motion'
import { CTA } from './wow'
import { lenisRef } from './SmoothScroll'

gsap.registerPlugin(ScrollTrigger, SplitText)

/**
 * The frame's settled push distance, shared by both the mount entrance
 * animation (below) and the scroll-linked hand-off tween — they have to
 * agree, or the frame jumps the instant the user's first scroll hands off
 * from one to the other. Capped rather than a flat ratio of viewport height:
 * an uncapped ratio grows the gap between the copy block and the frame
 * without bound on tall viewports, since the copy's own height doesn't
 * scale with viewport height at all.
 */
const frameTravel = () => Math.min(window.innerHeight * 0.45, 400)

export function HeroReveal({
  src,
  fallbackSrc,
  poster,
}: {
  src: string
  fallbackSrc: string
  poster: string
}) {
  const reduced = useReducedMotion()
  const sectionRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)

  // Fetch only as the hero is actually reached.
  useEffect(() => {
    if (reduced) return
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShouldLoad(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  // The welcome. Runs once, on load, and ONLY if the visitor is actually at
  // the top — a reload halfway down the page restores scroll position, and
  // playing an intro for a hero that is 3000px above the fold means the whole
  // thing happens where nobody can see it, then leaves them looking at
  // something that already finished.
  //
  // It is also a genuine page-load sequence rather than scroll-triggered
  // decoration: the sheet edge draws, the frame settles, then the headline
  // arrives a line at a time. Everything is transform/opacity, so it composites
  // on the GPU and never blocks the first scroll.
  useEffect(() => {
    if (reduced) return
    if (window.scrollY > 40) return
    const copy = copyRef.current
    const frame = frameRef.current
    if (!copy || !frame) return

    const heading = copy.querySelector('h1')
    const tail = copy.querySelectorAll('[data-hero-tail]')
    if (!heading) return

    // Per WORD, not per line. A whole line revealing at once is a curtain;
    // words arriving with their own timing is someone speaking. The words
    // overlap heavily (stagger is a fraction of the duration) so the phrase
    // still lands as one gesture rather than a typewriter.
    const split = new SplitText(heading, {
      type: 'lines,words',
      linesClass: 'sl-line',
      wordsClass: 'sl-word',
    })

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: EASE } })

      tl.fromTo(
        frame,
        { opacity: 0, scale: 0.965, y: () => frameTravel() + 26 },
        { opacity: 1, scale: 1, y: frameTravel, duration: DUR * 1.6 },
        0,
      )
      // Words rise out of their own line box and scale down INTO place, so the
      // type settles rather than simply appearing at final size.
      tl.fromTo(
        split.words,
        { yPercent: 108, scale: 1.14, opacity: 0 },
        {
          yPercent: 0,
          scale: 1,
          opacity: 1,
          duration: DUR * 1.25,
          stagger: STAGGER * 0.8,
        },
        0.12,
      )
      tl.fromTo(
        tail,
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: DUR, stagger: STAGGER },
        0.55,
      )
    }, sectionRef)

    return () => {
      ctx.revert()
      split.revert()
    }
  }, [reduced])

  // The reveal itself.
  useEffect(() => {
    if (reduced) return
    const section = sectionRef.current
    const frame = frameRef.current
    const copy = copyRef.current
    if (!section || !frame || !copy) return

    // Once the visitor has committed to scrolling into this hand-off — a
    // small nudge past the start — the rest of it completes on its own
    // rather than asking for the full 35% of scroll by hand. Fires once per
    // downward pass (re-arms once they've scrolled back near the top).
    let hasSnapped = false

    // Walks up from any stage button to the sticky FeatureType frame, then
    // to ITS OWN outer wrapper — shared by the forward snap below and the
    // backward listener further down, so both agree on exactly where
    // FeatureType starts and ends without duplicating the DOM walk.
    const findFeatureTypeFrame = () => {
      const anyBtn = document.querySelector('button[aria-expanded]')
      let sticky: HTMLElement | null = anyBtn as HTMLElement | null
      while (sticky && getComputedStyle(sticky).position !== 'sticky') {
        sticky = sticky.parentElement
      }
      return sticky
    }

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          // Was `+=110%` — over a full extra viewport-height of scroll spent
          // just on the hero's own hand-off before FeatureType was visible
          // at all. Cut sharply: a small scroll now clears the hero and
          // lands you on the fully-visible five-stage frame, rather than
          // trickling it into view a sliver at a time.
          end: '+=35%',
          pin: true,
          // `travel` is read off the viewport, so the tween has to be
          // rebuilt when that changes or the push desyncs after a resize.
          invalidateOnRefresh: true,
          // A number here is the seconds of catch-up, which is what makes
          // the geometry trail the scroll slightly instead of locking to
          // it rigidly. This is most of the "expensive" feel.
          scrub: 1,
          onUpdate: (self) => {
            // Forward only — a small nudge down completes the rest of the
            // way to FeatureType's own sticky frame fully pinned, not just
            // to where the hero's pin releases (those aren't the same
            // point, and landing short of the second one is exactly the
            // "only a sliver of it visible" complaint this exists to fix).
            //
            // The mirror (scrolling back UP) can't live here: `self.progress`
            // is clamped to 1 for the entire time scroll sits past this
            // trigger's own short `end` (35% of one viewport), which is true
            // for virtually the whole time FeatureType is on screen — so a
            // backward check gated on `self.progress` never sees anything
            // but 1 and never fires. See the plain scroll listener below,
            // which tracks real scroll position instead.
            if (self.direction === 1 && !hasSnapped && self.progress > 0.012 && self.progress < 0.97) {
              hasSnapped = true
              const stickyFrame = findFeatureTypeFrame()
              const target = stickyFrame
                ? window.scrollY +
                  stickyFrame.getBoundingClientRect().top -
                  parseFloat(getComputedStyle(stickyFrame).top || '0')
                : self.end
              lenisRef.current?.scrollTo(target, {
                duration: 0.85,
                easing: (t: number) => 1 - Math.pow(1 - t, 3),
                // Without this, real trackpad/wheel input arriving WHILE
                // this animates fights it — Lenis keeps folding that input
                // into its own virtual position, so the auto-scroll stalls
                // partway rather than landing cleanly on the target. `lock`
                // holds the scroll to the animation until it completes.
                lock: true,
              })
            } else if (self.progress < 0.03) {
              hasSnapped = false
            }
          },
        },
      })

      // A push only reads as a push if both things travel the same distance
      // at the same rate. Giving them different easings (which is what was
      // here before) makes the copy flee and the frame chase, and the gap
      // between them visibly stretches — which is exactly what it looked
      // like. So: identical distance, identical linear ease, moved as one.
      //
      // Measured in pixels off the live viewport rather than in percent,
      // because the two elements have different heights and `yPercent` is
      // relative to each element's own box — the one thing that guarantees
      // they *won't* stay in lockstep.
      // Also sets the standing gap between copy and frame: the gap at rest is
      // `6svh + frameTravel()`. This MUST be the same function the mount
      // entrance animation above uses, or the frame jumps position the
      // instant the user's first scroll input hands off from that animation
      // to this ScrollTrigger tween.
      const travel = frameTravel

      tl.fromTo(
        frame,
        { y: travel },
        { y: 0, ease: 'none', duration: 1 },
        0,
      )
      tl.fromTo(
        copy,
        { y: 0 },
        { y: () => -travel(), ease: 'none', duration: 1 },
        0,
      )
      // Only fades at the very end, once it is nearly off screen anyway.
      // Fading earlier would read as the copy dissolving on its own rather
      // than being shoved out of frame.
      tl.to(copy, { opacity: 0, ease: 'none', duration: 0.28 }, 0.58)
    }, section)

    // The backward mirror of the forward snap above, as a plain scroll
    // listener rather than something hung off the hero's own ScrollTrigger
    // — see the comment on that trigger's `onUpdate` for why its `progress`
    // can't drive this. Scoped to "somewhere between the true top and
    // FeatureType's own release point": scrolling up from anywhere in that
    // band (which, in practice, is either still inside the hero or sitting
    // in FeatureType's own few-svh margin — there's nothing else in between)
    // completes the return to the top rather than leaving the hero
    // half-revealed.
    let hasSnappedBack = false
    let lastY = window.scrollY
    const onRawScroll = () => {
      const y = window.scrollY
      const direction = y > lastY ? 1 : y < lastY ? -1 : 0
      lastY = y

      const stickyFrame = findFeatureTypeFrame()
      const outerWrapper = stickyFrame?.parentElement ?? null
      if (!outerWrapper) return
      const wrapperRect = outerWrapper.getBoundingClientRect()
      // Where FeatureType's own pin lets go — this listener only cares about
      // scroll positions at or before that point; past it, the close-spacer
      // in Landing.tsx owns the equivalent backward snap for its own zone.
      const featureTypeReleaseY = y + wrapperRect.bottom - window.innerHeight

      if (direction === -1 && !hasSnappedBack && y > 40 && y < featureTypeReleaseY + 10) {
        hasSnappedBack = true
        lenisRef.current?.scrollTo(0, {
          duration: 0.85,
          easing: (t: number) => 1 - Math.pow(1 - t, 3),
          lock: true,
        })
      }
      if (y < 40) hasSnappedBack = false
      if (y > featureTypeReleaseY) hasSnappedBack = false
    }
    window.addEventListener('scroll', onRawScroll, { passive: true })

    return () => {
      ctx.revert()
      window.removeEventListener('scroll', onRawScroll)
    }
  }, [reduced])

  if (reduced) {
    return (
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 pb-16 pt-28">
        <HeroCopy />
        <img src={poster} alt="" className="w-full rounded-2xl border border-line" />
      </section>
    )
  }

  return (
    <div ref={sectionRef} className="relative h-[100svh] overflow-hidden">
      {/* Sits above the frame in z-order so that during the hand-off the
          type stays readable rather than being clipped by it. */}
      <div ref={copyRef} className="absolute inset-x-0 top-0 z-10 px-5 pt-[8svh] sm:px-8">
        <div className="mx-auto w-full max-w-[1680px]">
          <HeroCopy />
        </div>
      </div>

      {/* The frame's own box is `92vw` wide (capped so it doesn't run off
          the edges on ultra-wide monitors), `80svh` tall — not locked to
          the video's native 16:9 any more. A matte version of this (video
          kept at true 16:9, centered, with the frame's own background
          showing on either side) read as dead space just moved a layer in
          rather than removed, so back to `object-cover` filling the whole
          box: the video scales up and the sides/top/bottom outside the
          16:9 crop are sliced off rather than left visible as bars. That
          re-crops a slice off the top of the room on wide screens — the
          exact trade `aspect-video` was originally added to avoid — but
          asked for directly in preference to any empty matte at the
          frame's edges. */}
      <div
        ref={frameRef}
        // The drop shadow is kept tight on purpose. At `0 50px 140px -50px` it
        // reached past the bottom of this `h-[100svh] overflow-hidden` section
        // and got sliced off dead flat at the fold — a hard horizontal line
        // right under the video, which read as a slide boundary. Pulling the
        // blur in keeps the whole shadow inside the section.
        className="absolute left-1/2 top-[6svh] h-[80svh] w-[92vw] max-w-[1760px] -translate-x-1/2 overflow-hidden rounded-[20px] border border-line bg-well shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]"
      >
        <video
          poster={poster}
          muted
          loop
          autoPlay
          playsInline
          preload={shouldLoad ? 'auto' : 'none'}
          className="h-full w-full object-cover"
        >
          {/* WebM first: VP9 encodes this flat, grainy illustration far
              smaller than H.264 at the same quality. The MP4 is only here
              for browsers that still refuse VP9. */}
          {shouldLoad && <source src={src} type="video/webm" />}
          {shouldLoad && <source src={fallbackSrc} type="video/mp4" />}
        </video>
      </div>
    </div>
  )
}

function HeroCopy() {
  return (
    <>
      {/* Three SHORT lines, and that is load-bearing rather than a style
          preference. The whole block has to clear the video frame, whose top
          edge starts around 57svh — so the headline's line COUNT is a layout
          constraint, not just a reading one. The previous copy ran to four
          lines in this face and pushed the button down onto the frame.

          `leading-[0.86]`: tight leading is what makes the lines read as one
          mass rather than three separate sentences. */}
      {/* SplitText re-splits this into lines and words at runtime, so the
          markup stays plain prose. `.sl-line { overflow: hidden }` is what
          lets each word rise out of its own line box rather than sliding over
          the one above. */}
      {/* Plain prose — no FoilText here. FoilText renders a DUPLICATE copy of
          its children for the gradient sweep plus an inline <style> block, and
          SplitText walks all of it: the heading split into 38 "words" and read
          "IT CITES THE PAGE THE PAGE EVERY TIME". The foil belongs on static
          type; animated type gets its emphasis from colour and motion. */}
      <h1 className="nameplate max-w-4xl text-[clamp(36px,6.2vw,80px)] leading-[0.92] text-ink [&_.sl-line]:overflow-hidden">
        Your material in. <span className="text-brand">Mastery</span> out.
      </h1>
      <p data-hero-tail className="mt-5 max-w-md text-[14.5px] leading-relaxed text-ink-3">
        A grounded chat turns into the note, the deck and the quiz about it —
        then what you get right or miss shapes what it teaches you next.
      </p>
      {/* Same CTA component as the close. The hero used to use the app's
          bevelled Button while the close used a glowing hand-rolled link —
          one page, two button languages. */}
      <div data-hero-tail className="mt-6 flex flex-wrap items-center gap-4">
        <CTA to="/signup">Start free</CTA>
      </div>
    </>
  )
}
