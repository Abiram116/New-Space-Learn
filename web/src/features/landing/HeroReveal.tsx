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
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { useReducedMotion } from '../../components/ui/motion'
import { FoilText } from './motion'

gsap.registerPlugin(ScrollTrigger)

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
      const travel = () => window.innerHeight * 0.46

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
      tl.to(copy, { opacity: 0, ease: 'none', duration: 0.25 }, 0.75)
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
        className="absolute left-1/2 top-[11svh] aspect-video h-[80svh] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-[20px] border border-line bg-well shadow-[0_50px_140px_-50px_rgba(0,0,0,0.95)]"
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
      {/* Set as large as the block can go while still clearing the frame
          below it. `leading-[0.86]` matters as much as the size here: this
          face is condensed caps, and tight leading is what makes three
          lines read as one mass rather than three sentences. */}
      <h1 className="nameplate max-w-5xl text-[clamp(38px,7.2vw,104px)] leading-[0.86] text-ink">
        It remembers
        <br />
        <FoilText>what you forgot</FoilText>
        <br />
        and picks up right there.
      </h1>
      <p className="mt-5 max-w-lg text-[14.5px] leading-relaxed text-ink-3">
        Drop in your lecture PDFs. It reads them, remembers what you've
        actually covered, and tells you what to study next — with cards, notes
        and quizzes it writes for you, each one still pointing back at the page
        it came from.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link to="/signup">
          <Button size="lg">
            Open your first pack
            <Icon name="arrowRight" size={15} />
          </Button>
        </Link>
        <span className="setcode">Free while in preview</span>
      </div>
    </>
  )
}
