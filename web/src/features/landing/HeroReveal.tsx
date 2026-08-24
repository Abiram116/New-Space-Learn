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

gsap.registerPlugin(ScrollTrigger, SplitText)

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
        { opacity: 0, scale: 0.965, y: () => window.innerHeight * 0.56 + 26 },
        { opacity: 1, scale: 1, y: () => window.innerHeight * 0.56, duration: DUR * 1.6 },
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

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=110%',
          pin: true,
          // `travel` is read off the viewport, so the tween has to be
          // rebuilt when that changes or the push desyncs after a resize.
          invalidateOnRefresh: true,
          // A number here is the seconds of catch-up, which is what makes
          // the geometry trail the scroll slightly instead of locking to
          // it rigidly. This is most of the "expensive" feel.
          scrub: 1,
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
      // Also sets the standing gap between copy and frame. Because both move
      // the same distance, the gap at rest is `11svh + travel` — so this number
      // is what decides whether the copy block clears the video, and 0.46 did
      // not: the block measures ~450px against a ~397px gap on a 1447×811
      // screen, which is exactly the overlap that showed up on the button row.
      const travel = () => window.innerHeight * 0.56

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

    return () => ctx.revert()
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
      <div ref={copyRef} className="absolute inset-x-0 top-0 z-10 px-5 pt-[8svh]">
        <div className="mx-auto w-full max-w-6xl">
          <HeroCopy />
        </div>
      </div>

      {/* `aspect-video` is load-bearing, not decoration: the clip is exactly
          16:9, so the frame has to be too. It used to be a ~92vw × 70svh box
          — around 2.45:1 — and `object-cover` filled that by scaling the
          video up and slicing the top and bottom off, which is why the top
          of the room was never visible however far you scrolled. Matching
          the ratio means the whole frame is the whole picture.

          Height-driven with a max-width so it stays inside the viewport on
          short-and-wide screens, where 16:9 at 80svh would run off the
          sides. */}
      <div
        ref={frameRef}
        // The drop shadow is kept tight on purpose. At `0 50px 140px -50px` it
        // reached past the bottom of this `h-[100svh] overflow-hidden` section
        // and got sliced off dead flat at the fold — a hard horizontal line
        // right under the video, which read as a slide boundary. Pulling the
        // blur in keeps the whole shadow inside the section.
        className="absolute left-1/2 top-[11svh] aspect-video h-[80svh] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-[20px] border border-line bg-well shadow-[0_24px_70px_-40px_rgba(0,0,0,0.9)]"
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
      <h1 className="nameplate max-w-4xl text-[clamp(38px,7.6vw,100px)] leading-[0.86] text-ink [&_.sl-line]:overflow-hidden">
        One page in. <span className="text-brand">Notes, cards, and a test</span> out.
      </h1>
      <p data-hero-tail className="mt-5 max-w-md text-[14.5px] leading-relaxed text-ink-3">
        Upload what you're studying. Every answer cites the exact page it came
        from, then turns into the note, the deck, or the quiz you actually
        need — without leaving the conversation.
      </p>
      {/* Same CTA component as the close. The hero used to use the app's
          bevelled Button while the close used a glowing hand-rolled link —
          one page, two button languages. */}
      <div data-hero-tail className="mt-6 flex flex-wrap items-center gap-4">
        <CTA to="/signup">Start free</CTA>
        <span className="setcode">No card needed</span>
      </div>
    </>
  )
}
