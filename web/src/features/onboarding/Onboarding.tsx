/**
 * First run — five questions that grow a picture of you.
 *
 * A new account has nothing: no subjects, no cards, no history, and a
 * dashboard of zeroes teaches someone the product is empty at the moment they
 * are deciding whether it is worth their time. The app genuinely needs one
 * thing before it is useful — a sense of how this person wants to be taught —
 * so it asks, briefly.
 *
 * **The problem with asking** is that answers to a product you have not used
 * feel like they vanish into a form. So every answer visibly *does* something:
 * it streams out of the card you pressed into a living organism beside the
 * questions, and the organism changes — its flow, its layers, its tempo, its
 * colour — because of what you said (`fingerprint.ts` says which answer moves
 * which parameter). By the end the student is looking at something alive that
 * is made of their answers, and nothing on it is invented.
 *
 * **It is directed like a title sequence** — an opening, cuts between
 * questions, a finale that flies into the logo and opens onto the app — because
 * this is the first minute of the product and it should feel made. But nothing
 * waits on the choreography: every sequence fast-forwards on input, clicks
 * never queue behind an animation, and under reduced motion the whole thing is
 * a plain, instant form beside a still picture.
 *
 * **Nothing here is a model call.** The questions and the organism are fixed
 * functions of the answers.
 */

import { gsap } from 'gsap'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateStudentModel } from '../../api/me'
import { useAuth } from '../../auth/AuthProvider'
import { getCachedBrief, getCachedStats } from '../../lib/briefCache'
import { BotSays } from '../../components/mascot/BotSays'
import { loadBotFace } from '../../components/mascot/Bot'
import { useBotLine } from '../../components/mascot/useBotLine'
import { useArrivalMood } from '../../components/mascot/useBotMood'
import { DraftingCursor } from '../../components/ui/DraftingCursor'
import { Icon } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { LAMP_BASE_WARMTH, lampGradient, MOTES, TABLE_IMAGE, TABLE_MASK, TABLE_SIZE, VIGNETTE } from '../../lib/room'
import { useHandoff, useHandoffReveal } from '../transitions/Handoff'
import type { OrganismEngine } from './engine'
import { legend, type LegendKey, type Slot } from './fingerprint'
import { Letters, NameBurst, Opening, Words } from './Kinetic'
import { DUR, EASE, EASE_IN } from './motion'
import { Organism } from './Organism'
import { PhoneOnboarding } from './PhoneOnboarding'
import { markOnboarded } from './state'
import { useIsMobile } from '../../lib/useIsMobile'
import {
  buildPatch,
  EMPTY_ANSWERS,
  firstName,
  STEPS,
  type Answers,
  type ChoiceStep,
  type Option,
  type Step,
  type TextStep,
} from './steps'

const DONE = STEPS.length

/** Which part of the organism each step moves. */
const LAYER: Record<Step['id'], LegendKey> = {
  name: 'seed',
  style: 'core',
  depth: 'rings',
  session: 'orbit',
  goal: 'star',
}

/** The colour an answer travels in on its way into the organism. */
const TONE: Record<LegendKey, Slot> = {
  seed: 'ink',
  core: 'brand-300',
  rings: 'ink',
  orbit: 'sky',
  star: 'sun',
}
const DOT: Record<LegendKey, string> = {
  seed: 'bg-ink',
  core: 'bg-brand-300',
  rings: 'bg-ink-3',
  orbit: 'bg-sky',
  star: 'bg-sun',
}

/** A click this soon after a cut landed on content that just arrived under
 *  the pointer — almost always the second half of a double-click. */
const CUT_GUARD_MS = 260

/** The logo is colourless until the galaxy flies into it. */
const LOGO_DIM = 'grayscale(1) brightness(0.72)'
/** The lit copy is revealed by a soft circle growing from the impact point. */
const IGNITE_MASK = 'radial-gradient(circle at var(--ix) var(--iy), #000 var(--ir), transparent calc(var(--ir) + 34px))'

type Phase = 'opening' | 'live' | 'exit'
/** One question on screen. `id` is stable for the life of that DOM node —
 *  entering and later leaving — which is the whole fix for the glitchy cut. */
type Layer = { id: number; index: number }
export type Beat = { n: number; key: LegendKey }

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
const TEXT = '[data-word], [data-letter]'
const BEATS = '[data-beat]'

/**
 * First run, by device. A phone gets three light questions and a small CSS
 * brand moment (`PhoneOnboarding`); everything else gets the full sequence
 * below, unchanged. Decided once per mount by the app's one phone rule.
 */
export function Onboarding() {
  const phone = useIsMobile()
  return phone ? <PhoneOnboarding /> : <DesktopOnboarding />
}

function DesktopOnboarding() {
  const navigate = useNavigate()
  const { show, showError } = useToast()
  const { user, setDisplayName } = useAuth()
  const reduced = useReducedMotion()
  const reveal = useHandoffReveal()
  const { play } = useHandoff()
  // Nova's face is needed on the last screen; fetch it while the questions run.
  useEffect(() => void loadBotFace().catch(() => {}), [])

  const initialName = ((user?.user_metadata?.display_name as string | undefined) ?? '').trim()

  /* The truth, and what the organism shows. The organism trails the answers
     by the flight of the particles carrying a choice, so it changes the
     instant they land rather than before they have left. It is born without
     the name even when one is prefilled: the name is *given* to it. */
  const [answers, setAnswers] = useState<Answers>(() => ({ ...EMPTY_ANSWERS, name: initialName }))
  const answersRef = useRef(answers)
  const [born] = useState<Answers>(() => ({ ...EMPTY_ANSWERS }))
  const [beat, setBeat] = useState<Beat>({ n: 0, key: 'seed' })

  const [layers, setLayers] = useState<Layer[]>([{ id: 0, index: 0 }])
  const layersRef = useRef(layers)
  layersRef.current = layers
  const index = layers[layers.length - 1].index
  const [phase, setPhase] = useState<Phase>(reduced ? 'live' : 'opening')
  const [opening, setOpening] = useState(!reduced)
  const [burst, setBurst] = useState<string | null>(null)

  const engine = useRef<OrganismEngine | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const veilRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<HTMLSpanElement>(null)
  const logoDimRef = useRef<HTMLSpanElement>(null)
  const logoLitRef = useRef<HTMLSpanElement>(null)
  const skipRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const captionRef = useRef<HTMLParagraphElement>(null)

  const seq = useRef(0)
  const dir = useRef(1)
  const inDelay = useRef(0)
  const cutAt = useRef(0)
  const advance = useRef<number | null>(null)
  const nodes = useRef(new Map<number, HTMLDivElement>())
  const tls = useRef(new Map<number, gsap.core.Timeline>())
  const entered = useRef(new Set<number>())
  const exiting = useRef(new Set<number>())
  const lastSave = useRef<{ key: string; done: Promise<void> } | null>(null)

  const opened = phase !== 'opening'
  const first = firstName(answers.name)

  /* ── Answers ───────────────────────────────────────────────────────── */

  const update = useCallback((patch: Partial<Answers>) => {
    const next = { ...answersRef.current, ...patch }
    answersRef.current = next
    setAnswers(next)
  }, [])

  /** An answer has reached the organism. */
  const land = useCallback((key: LegendKey) => {
    engine.current?.setAnswers(answersRef.current)
    setBeat((b) => ({ n: b.n + 1, key }))
  }, [])

  /** Send an answer from the element that gave it into the organism. */
  const feed = useCallback(
    (key: LegendKey, from: Element | null, origin?: { x: number; y: number } | null) => {
      const eng = engine.current
      if (reduced || !from || !eng) return land(key)
      eng.emit({ from: from.getBoundingClientRect(), origin, slot: TONE[key], onArrive: () => land(key) })
    },
    [land, reduced],
  )

  /* ── Cuts between questions ────────────────────────────────────────── */

  const go = useCallback(
    (next: number, delay = 0) => {
      if (advance.current) window.clearTimeout(advance.current)
      advance.current = null
      const current = layersRef.current[layersRef.current.length - 1].index
      if (next === current || next < 0 || next > DONE) return
      dir.current = next > current ? 1 : -1
      inDelay.current = delay
      cutAt.current = performance.now()
      const layer = { id: ++seq.current, index: next }
      setLayers((ls) => (reduced ? [layer] : [...ls, layer]))
    },
    [reduced],
  )

  /** True when a click should be ignored — see CUT_GUARD_MS. */
  const tooSoon = (e?: { detail?: number }) =>
    phase !== 'live' || (e?.detail ?? 1) > 1 || performance.now() - cutAt.current < CUT_GUARD_MS

  /**
   * The cut director — the single owner of every question's motion.
   *
   * The old cut glitched because a question's DOM was *remounted* halfway
   * through its entrance: the incoming view was keyed on the step index and
   * the outgoing copy was a separate, freshly rendered tree, so a quick
   * Continue/Back swapped a half-risen heading for a brand-new one sitting at
   * rest — which then jumped and animated out — while the previous exit was
   * killed mid-flight and left wherever it stopped. Two timelines, two copies
   * of the same text, no single owner.
   *
   * Now each question is a layer whose node lives from its entrance to the
   * end of its exit. A cut only appends a layer; the previous one keeps its
   * node, its entrance is killed, and its exit starts *from wherever it is*
   * (`gsap.to`, `overwrite: true`), so there is nothing to jump. At most one
   * layer is ever leaving: a third cut completes the oldest exit first. All
   * layers share one grid cell, so a leaving question never shifts the
   * arriving one. Nothing measures text, so there is no font race.
   */
  useLayoutEffect(() => {
    const last = layers[layers.length - 1]
    const lastEl = nodes.current.get(last.id)
    if (!opened) {
      if (lastEl) {
        gsap.set(lastEl.querySelectorAll(TEXT), { yPercent: 105 })
        gsap.set(lastEl.querySelectorAll(BEATS), { opacity: 0 })
      }
      return
    }
    if (reduced) {
      if (lastEl && !entered.current.has(last.id)) {
        entered.current.add(last.id)
        gsap.set([...lastEl.querySelectorAll(TEXT), ...lastEl.querySelectorAll(BEATS)], { clearProps: 'all' })
        focusStep(lastEl)
      }
      return
    }
    const d = dir.current
    const leaving = layers.slice(0, -1)

    for (const l of leaving) {
      if (exiting.current.has(l.id)) continue
      exiting.current.add(l.id)
      tls.current.get(l.id)?.kill()
      const el = nodes.current.get(l.id)
      const done = () => {
        tls.current.delete(l.id)
        setLayers((ls) => ls.filter((x) => x.id !== l.id))
      }
      if (!el) {
        done()
        continue
      }
      const tl = gsap.timeline({ onComplete: done })
      // Lifts out through its masks and fades as it goes, so the two
      // questions never read as one garbled heading while they cross.
      tl.to(el.querySelectorAll(TEXT), { yPercent: -105 * d, opacity: 0, duration: DUR * 0.55, ease: EASE_IN, stagger: 0.01, overwrite: true }, 0).to(
        el.querySelectorAll(BEATS),
        { y: -28 * d, opacity: 0, duration: DUR * 0.52, ease: EASE_IN, stagger: 0.022, overwrite: true },
        0,
      )
      tls.current.set(l.id, tl)
    }
    // Never more than one question leaving: finish the older exits now.
    for (const l of leaving.slice(0, -1)) tls.current.get(l.id)?.progress(1)

    if (lastEl && !entered.current.has(last.id)) {
      entered.current.add(last.id)
      focusStep(lastEl)
      // On a phone the options run below the fold; each new question starts
      // back at the top, where the organism can be seen answering.
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' })
      const at = (leaving.length ? 0.26 : 0.05) + inDelay.current
      inDelay.current = 0
      const tl = gsap.timeline()
      tl.fromTo(
        lastEl.querySelectorAll(TEXT),
        { yPercent: 105 * d, opacity: 1 },
        { yPercent: 0, duration: DUR * 1.3, ease: EASE, stagger: 0.028, immediateRender: true },
        at,
      ).fromTo(
        lastEl.querySelectorAll(BEATS),
        { y: 34 * d, opacity: 0 },
        { y: 0, opacity: 1, duration: DUR * 1.2, ease: EASE, stagger: 0.05, immediateRender: true, clearProps: 'transform,opacity' },
        at + 0.1,
      )
      tls.current.set(last.id, tl)
    }
  }, [layers, opened, reduced])

  // Unmount (and StrictMode's rehearsal of it): let every timeline go and
  // forget what was animated, so a remount starts clean.
  useEffect(() => {
    const timelines = tls.current
    const ent = entered.current
    const ex = exiting.current
    return () => {
      for (const tl of timelines.values()) tl.kill()
      timelines.clear()
      ent.clear()
      ex.clear()
    }
  }, [])

  /* The chrome — header controls and progress — arrives with the stage. */
  useLayoutEffect(() => {
    if (reduced) return
    const chrome = [logoRef.current, skipRef.current, progressRef.current]
    if (!opened) gsap.set(chrome, { opacity: 0, y: -10 })
    else if (phase === 'live') gsap.to(chrome, { opacity: 1, y: 0, duration: DUR * 1.4, ease: EASE, stagger: 0.08 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, reduced])

  // The last cut lands on the finale: the organism takes a breath.
  useEffect(() => {
    if (index === DONE) engine.current?.perturb(1)
  }, [index])

  /* ── Leaving ───────────────────────────────────────────────────────── */

  /** Save, once per distinct set of answers. Never rejects. */
  const save = useCallback(
    (a: Answers) => {
      const patch = buildPatch(a)
      const name = a.name.trim()
      const key = JSON.stringify([patch, name])
      if (lastSave.current?.key === key) return lastSave.current.done
      const done = (async () => {
        const jobs: Promise<unknown>[] = []
        if (Object.keys(patch).length) jobs.push(updateStudentModel(patch))
        if (name && name !== initialName) jobs.push(setDisplayName(name))
        const failed = (await Promise.allSettled(jobs)).find((r) => r.status === 'rejected')
        // A failed save must not trap anyone here — every field is in Settings.
        if (failed) showError(failed.reason)
        // With the user id, or the gate never reads the flag back.
        markOnboarded(user?.id ?? null)
      })()
      lastSave.current = { key, done }
      return done
    },
    [initialName, setDisplayName, showError, user],
  )

  // Reaching the end saves straight away, so closing the tab on the finale
  // does not lose the answers. Leaving saves again only if something changed.
  useEffect(() => {
    if (index === DONE) void save(answersRef.current)
  }, [index, save])

  /**
   * The finale — paced to be watched, and not skippable.
   *
   *   0.0s  the stage clears; the galaxy gathers into one bright star
   *   1.0s  it holds a beat, gathering light
   *   1.45s it travels to the colourless logo on a slow curve, trailing dust
   *   2.9s  impact: a flash and sparks at the mark
   *   2.9s  the logo ignites, colour radiating outward from the impact point
   *   3.85s a held beat on the lit logo, so it registers
   *   4.3s  the app opens out of the logo (the `iris` handoff)
   *
   * Home's data is warmed while all of this plays, and the handoff waits for
   * Home to finish loading under its cover, so the reveal never lands on a
   * skeleton. Input is ignored throughout (`phase === 'exit'` makes the stage
   * inert); a skip here would only ever land on a half-lit logo.
   */
  const leave = useCallback(async () => {
    if (phase === 'exit') return
    setPhase('exit')
    const saving = save(answersRef.current)
    // Warm Home's first requests through the same caches Home reads, once the
    // answers they depend on are saved. Errors are Home's to show, not ours.
    void saving.then(() => {
      getCachedStats().catch(() => {})
      getCachedBrief().catch(() => {})
    })
    const logo = logoRef.current
    const mark = logo?.querySelector('.logo-mark') ?? logo
    const centreOf = () => {
      const r = mark?.getBoundingClientRect()
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
    }
    const eng = engine.current
    if (!reduced && eng && logo) {
      // The stage wrapper, not the question layers: the cut director owns
      // those, and a second owner is exactly what made cuts glitch.
      gsap.to([stageRef.current, skipRef.current, captionRef.current], { opacity: 0, y: -12, duration: 0.6, ease: EASE_IN, stagger: 0.06 })
      let lit: Promise<void> = Promise.resolve()
      await eng.condense(centreOf, (at) => {
        eng.flash(at.x, at.y)
        lit = ignite(logo, logoDimRef.current, logoLitRef.current, at)
      })
      await lit
      await wait(450)
      // Nothing left to draw: stop the loop now, so the cover wave has the
      // frame budget to itself.
      eng.stop()
    } else {
      gsap.set(logoLitRef.current, { '--ir': '600px' })
    }
    const lr = logo?.getBoundingClientRect()
    void play(
      'iris',
      async () => {
        // Fully covered: let the canvas go before Home mounts, so it costs
        // nothing during the reveal.
        engine.current?.release()
        await saving
        navigate('/home', { replace: true })
      },
      { origin: centreOf() ?? undefined, lockup: lr ? { left: lr.left, top: lr.top, height: lr.height } : undefined },
    )
  }, [navigate, phase, play, reduced, save])

  const skipAll = useCallback(() => {
    // Say where it went: leaving without being told the questions still exist
    // makes it look like a one-time door you just closed.
    show('You can answer these later in Settings.', 'info')
    void leave()
  }, [leave, show])

  /* ── Answering ─────────────────────────────────────────────────────── */

  const pick = useCallback(
    (s: ChoiceStep, o: Option, card: Element | null, point: { x: number; y: number } | null) => {
      const key = LAYER[s.id]
      if (s.multi) {
        const on = answersRef.current.styles.includes(o.value)
        update({ styles: on ? answersRef.current.styles.filter((v) => v !== o.value) : [...answersRef.current.styles, o.value] })
        feed(key, card, point)
        return
      }
      update({ [s.field]: o.value } as Partial<Answers>)
      feed(key, card, point)
      // A beat for the press to register on the card before the cut.
      if (advance.current) window.clearTimeout(advance.current)
      advance.current = window.setTimeout(() => go(index + 1), reduced ? 0 : 170)
    },
    [feed, go, index, reduced, update],
  )

  const submitText = useCallback(
    (s: TextStep) => {
      const value = answersRef.current[s.field].trim()
      update({ [s.field]: value } as Partial<Answers>)
      if (s.field === 'name' && value && !reduced && engine.current) {
        // The name is set huge and dissolves into the organism; the next
        // question arrives as the letters stream away.
        setBurst(value)
        go(index + 1, 1.45)
        return
      }
      land(LAYER[s.id])
      go(index + 1)
    },
    [go, index, land, reduced, update],
  )

  const skipStep = useCallback(
    (s: Step) => {
      const cleared: Partial<Answers> =
        s.field === 'styles' ? { styles: [] } : s.kind === 'choice' ? { [s.field]: null } : { [s.field]: '' }
      update(cleared)
      land(LAYER[s.id])
      go(index + 1)
    },
    [go, index, land, update],
  )

  /* Keys: 1–9 pick an option, Enter continues where a button would. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'live' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea')) return
      // Enter on a focused control is that control's own click.
      if (e.key === 'Enter' && t?.closest('button, a')) return
      const step = STEPS[index]
      if (index === DONE && e.key === 'Enter') return void leave()
      if (!step || step.kind !== 'choice') return
      if (e.key === 'Enter' && step.multi && answersRef.current.styles.length) return void go(index + 1)
      const n = Number(e.key)
      const o = step.options[n - 1]
      if (!o || tooSoon()) return
      const live = nodes.current.get(layersRef.current[layersRef.current.length - 1].id)
      const card = live?.querySelector(`[data-option="${n - 1}"]`) ?? null
      const r = card?.getBoundingClientRect()
      pick(step, o, card, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const rows = legend(answers)
  const caption = beat.n > 0 ? rows.find((r) => r.key === beat.key) : undefined

  const view = (i: number) => (
    <StepView
      index={i}
      answers={answers}
      first={first}
      reduced={reduced}
      onType={(field, value) => {
        update({ [field]: value } as Partial<Answers>)
        // Every keystroke disturbs the organism — it is listening.
        engine.current?.perturb(0.32)
      }}
      onPick={(s, o, card, point, e) => !tooSoon(e) && pick(s, o, card, point)}
      onSubmit={(s) => !tooSoon() && submitText(s)}
      onContinue={() => !tooSoon() && go(index + 1)}
      onSkip={(s) => !tooSoon() && skipStep(s)}
      onBack={() => phase === 'live' && go(i - 1)}
      onFinish={() => void leave()}
    />
  )

  const current = layers[layers.length - 1].id

  return (
    // `lg:cursor-none` scoped here, matching the landing page: first run is a
    // surface you are being *shown*, so it keeps the reticle.
    <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-canvas lg:h-dvh lg:overflow-hidden lg:cursor-none">
      <DraftingCursor />
      <Backdrop reduced={reduced} lit={Math.min(index, DONE)} />
      {/* The dark the opening starts in. Below the canvas, so the particles
          are the first light. */}
      <div ref={veilRef} aria-hidden className="pointer-events-none fixed inset-0 z-[4] bg-[#0c0a09]" style={{ opacity: reduced ? 0 : 1 }} />
      <Organism anchor={anchorRef} engine={engine} reduced={reduced} intro={!reduced} answers={born} />

      {opening && (
        <Opening
          run={reveal}
          engine={engine}
          veil={veilRef}
          onStage={() => setPhase((p) => (p === 'opening' ? 'live' : p))}
          onEnd={() => {
            setPhase((p) => (p === 'opening' ? 'live' : p))
            setOpening(false)
          }}
        />
      )}
      {burst && <NameBurst name={burst} engine={engine} onLand={() => land('seed')} onEnd={() => setBurst(null)} />}

      <header className="relative z-20 flex shrink-0 items-center justify-between px-[clamp(16px,3.2vw,64px)] pb-2 pt-[clamp(14px,2.6vh,36px)]">
        {/* Colourless until the galaxy flies into it and lights it: a dim
            copy, and a lit copy on top revealed from the point of impact. */}
        <span ref={logoRef} className="relative inline-flex origin-left">
          <span ref={logoDimRef} className="inline-flex" style={{ filter: LOGO_DIM, opacity: 0.75 }}>
            <Logo />
          </span>
          <span
            ref={logoLitRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 inline-flex"
            style={{ '--ix': '14px', '--iy': '50%', '--ir': '-40px', maskImage: IGNITE_MASK, WebkitMaskImage: IGNITE_MASK } as CSSProperties}
          >
            <Logo />
          </span>
        </span>
        <div ref={skipRef}>
          {index < DONE && (
            <button
              type="button"
              onClick={skipAll}
              disabled={phase === 'exit'}
              className="rounded-full px-3 py-1.5 text-[clamp(13px,0.8vw,15px)] text-muted transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
            >
              Skip for now
            </button>
          )}
        </div>
      </header>

      <main
        inert={phase === 'exit'}
        className="relative z-10 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]"
      >
        {/* ── Where the organism lives. An ordinary box in the layout; the
            canvas reads its geometry. ───────────────────────────────── */}
        <div ref={anchorRef} className="relative h-[min(44svh,96vw)] lg:order-2 lg:h-auto">
          <p
            ref={captionRef}
            aria-live="polite"
            className={cn(
              'absolute inset-x-6 bottom-[3.5vh] mx-auto hidden max-w-md text-center lg:block',
              (index === DONE || !caption) && 'invisible',
            )}
          >
            {caption && (
              <span key={`${caption.key}-${beat.n}`} className="block" style={reduced ? undefined : { animation: 'lineUp 700ms var(--ease-sl) both' }}>
                <span className="setcode text-ink-3">{caption.label}</span>
                <span className="ml-2 text-[clamp(13px,0.78vw,15px)] leading-snug text-muted">{caption.text}</span>
              </span>
            )}
          </p>
        </div>

        {/* ── The question ────────────────────────────────────────────── */}
        <section className="relative flex min-w-0 flex-col px-4 pb-12 sm:px-8 lg:order-1 lg:h-full lg:min-h-0 lg:pb-[5vh] lg:pl-[clamp(40px,7.2vw,176px)] lg:pr-[clamp(16px,2vw,48px)]">
          <div ref={stageRef} className="flex w-full min-w-0 max-w-[clamp(20rem,38vw,50rem)] flex-1 flex-col lg:min-h-0">
            <div ref={progressRef} className="pt-2 lg:pt-[3.5vh]">
              <Progress index={index} reduced={reduced} />
            </div>
            <div className="mt-7 grid flex-1 lg:mt-0 lg:min-h-0">
              {layers.map((l) => {
                const leaving = l.id !== current
                return (
                  <div
                    key={l.id}
                    ref={(el) => {
                      if (el) nodes.current.set(l.id, el)
                      else nodes.current.delete(l.id)
                    }}
                    className={cn('min-w-0 self-start [grid-area:1/1] lg:self-center', leaving && 'pointer-events-none')}
                    aria-hidden={leaving || undefined}
                    inert={leaving}
                  >
                    {view(l.index)}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

/** Focus where the next action is, without scrolling the stage. */
function focusStep(el: HTMLElement) {
  const input = el.querySelector<HTMLInputElement>('input')
  const target = input ?? el.querySelector<HTMLElement>('h1')
  target?.focus({ preventScroll: true })
}

/**
 * The star has struck: the logo ignites. Colour radiates outward from the
 * point of impact across the mark and then the wordmark — slowly enough to
 * watch it travel — with a kick on impact and the dim copy giving way
 * beneath. Resolves when it is fully lit.
 */
function ignite(logo: HTMLElement, dim: HTMLElement | null, lit: HTMLElement | null, at: { x: number; y: number }): Promise<void> {
  const box = logo.getBoundingClientRect()
  if (lit) {
    lit.style.setProperty('--ix', `${at.x - box.left}px`)
    lit.style.setProperty('--iy', `${at.y - box.top}px`)
  }
  gsap.fromTo(logo, { scale: 1 }, { scale: 1.1, duration: 0.14, ease: 'power2.out', yoyo: true, repeat: 1 })
  return new Promise((resolve) => {
    gsap
      .timeline({ onComplete: resolve })
      .fromTo(lit, { '--ir': '-30px' }, { '--ir': `${Math.ceil(box.width + 40)}px`, duration: 0.95, ease: 'power2.inOut' }, 0)
      .to(dim, { opacity: 0.25, duration: 0.9, ease: 'power1.inOut' }, 0.1)
  })
}

/* ── One question ─────────────────────────────────────────────────────── */

type StepViewProps = {
  index: number
  answers: Answers
  first: string
  reduced: boolean
  onType: (field: 'name' | 'goal', value: string) => void
  onPick: (s: ChoiceStep, o: Option, card: Element, point: { x: number; y: number } | null, e: { detail: number }) => void
  onSubmit: (s: TextStep) => void
  onContinue: () => void
  onSkip: (s: Step) => void
  onBack: () => void
  onFinish: () => void
}

/* Fluid type: composed at 1280, 1920 and 2560 wide and on a phone, and it
   gives way on short screens before anything scrolls. */
const ASK = 'text-[clamp(28px,min(2.85vw,5.5vh),76px)]'
const ASIDE = 'text-[clamp(14.5px,calc(0.32vw+0.5vh+5px),19px)]'
const SMALL = 'text-[clamp(13px,calc(0.2vw+0.4vh+5px),15.5px)]'

function StepView(p: StepViewProps) {
  const s = STEPS[p.index]
  if (!s) return <Ending {...p} />

  // Greets them once there is a name to greet them by.
  const eyebrow = s.id === 'style' && p.first ? `Nice to meet you, ${p.first}.` : s.id === 'goal' ? (p.first ? `Last one, ${p.first}.` : 'Last one.') : null

  return (
    <div className="flex flex-col">
      {eyebrow && (
        <p data-beat className="setcode setcode-hot mb-[clamp(10px,1.4vh,18px)]">
          {eyebrow}
        </p>
      )}
      <h1 tabIndex={-1} id={`ask-${s.id}`} className={cn('nameplate break-words leading-[1.02] text-ink outline-none', ASK)}>
        <Words text={s.ask} />
      </h1>
      <p data-beat className={cn('mt-[clamp(10px,1.5vh,20px)] max-w-[34em] leading-relaxed text-ink-3', ASIDE)}>
        {s.aside}
      </p>

      <div className="mt-[clamp(18px,3vh,40px)]">{s.kind === 'text' ? <TextAnswer step={s} {...p} /> : <ChoiceAnswer step={s} {...p} />}</div>

      <div data-beat className="mt-[clamp(14px,2.4vh,30px)] flex items-center gap-5">
        {p.index > 0 && (
          <button type="button" onClick={p.onBack} className={cn('inline-flex items-center gap-1.5 text-muted transition-colors cursor-pointer hover:text-ink', SMALL)}>
            <Icon name="arrowLeft" size={12} /> Back
          </button>
        )}
        {s.kind === 'choice' && (
          <button type="button" onClick={() => p.onSkip(s)} className={cn('text-faint transition-colors cursor-pointer hover:text-ink', SMALL)}>
            Skip this one
          </button>
        )}
        {s.kind === 'choice' && <span className="setcode ml-auto hidden lg:inline">Press 1–{s.options.length}</span>}
      </div>
    </div>
  )
}

const PRIMARY =
  'inline-flex items-center gap-2 rounded-full bg-brand px-[clamp(18px,1.4vw,28px)] py-[clamp(10px,1.3vh,15px)] text-[clamp(14.5px,calc(0.3vw+0.4vh+5px),17.5px)] font-semibold text-[#1a120f] t-control duration-200 cursor-pointer hover:brightness-110 active:scale-[0.98]'

function TextAnswer({ step, answers, onType, onSubmit }: StepViewProps & { step: TextStep }) {
  const value = answers[step.field]
  const empty = !value.trim()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(step)
      }}
      className="flex flex-col gap-[clamp(16px,2.6vh,32px)]"
    >
      <div data-beat>
        <input
          value={value}
          onChange={(e) => onType(step.field, e.target.value)}
          maxLength={step.max}
          placeholder={step.placeholder}
          autoComplete={step.autoComplete}
          aria-labelledby={`ask-${step.id}`}
          spellCheck={false}
          className="w-full border-0 border-b border-line bg-transparent pb-2.5 text-[clamp(20px,min(2.1vw,3.6vh),40px)] font-semibold text-ink outline-none transition-colors placeholder:font-normal placeholder:text-faint focus:border-brand/70"
        />
      </div>
      <div data-beat className="flex items-center gap-3">
        <button type="submit" className={PRIMARY}>
          {step.id === 'goal' ? 'Finish' : 'Continue'}
          <Icon name="arrowRight" size={14} />
        </button>
        {empty && <span className={cn('text-faint', SMALL)}>{step.id === 'goal' ? 'or leave it empty' : 'or skip it'}</span>}
      </div>
    </form>
  )
}

function ChoiceAnswer({ step, answers, reduced, onPick, onContinue }: StepViewProps & { step: ChoiceStep }) {
  const chosen = (o: Option) => (step.multi ? answers.styles.includes(o.value) : answers[step.field] === o.value)
  const count = step.multi ? answers.styles.length : 0
  return (
    <>
      <div className="flex flex-col gap-[clamp(6px,0.9vh,12px)]">
        {step.options.map((o, i) => (
          <div data-beat key={o.value}>
            <OptionCard
              index={i}
              option={o}
              on={chosen(o)}
              multi={!!step.multi}
              reduced={reduced}
              onPick={(card, point, e) => onPick(step, o, card, point, e)}
            />
          </div>
        ))}
      </div>
      {step.multi && (
        <div data-beat>
          <button
            type="button"
            onClick={onContinue}
            disabled={count === 0}
            className={cn(
              PRIMARY,
              'mt-[clamp(14px,2.2vh,28px)]',
              count === 0 && 'cursor-default bg-line-soft text-faint hover:brightness-100 active:scale-100',
            )}
          >
            {count === 0 ? 'Pick what fits' : 'Continue'}
            {count > 0 && <Icon name="arrowRight" size={14} />}
          </button>
        </div>
      )}
    </>
  )
}

/**
 * An option you can feel: it leans toward the cursor, gives under a press and
 * springs back, and a ripple leaves the point you touched — which is where the
 * stream into the organism starts.
 */
function OptionCard({
  index,
  option,
  on,
  multi,
  reduced,
  onPick,
}: {
  index: number
  option: Option
  on: boolean
  multi: boolean
  reduced: boolean
  onPick: (card: Element, point: { x: number; y: number } | null, e: { detail: number }) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const lean = useRef<{ x: gsap.QuickToFunc; y: gsap.QuickToFunc } | null>(null)
  const live = !reduced

  const onMove = (e: React.PointerEvent) => {
    if (!live || e.pointerType !== 'mouse' || !ref.current) return
    lean.current ??= {
      x: gsap.quickTo(ref.current, 'x', { duration: 0.5, ease: 'power3.out' }),
      y: gsap.quickTo(ref.current, 'y', { duration: 0.5, ease: 'power3.out' }),
    }
    const r = ref.current.getBoundingClientRect()
    lean.current.x(((e.clientX - r.left) / r.width - 0.5) * 10)
    lean.current.y(((e.clientY - r.top) / r.height - 0.5) * 6)
  }
  const release = () => {
    if (!live || !ref.current) return
    gsap.to(ref.current, { x: 0, y: 0, scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.4)', overwrite: 'auto' })
  }
  const press = () => {
    if (live) gsap.to(ref.current, { scale: 0.965, duration: 0.12, ease: 'power2.inOut', overwrite: 'auto' })
  }
  const unpress = () => {
    if (live) gsap.to(ref.current, { scale: 1, duration: 0.8, ease: 'elastic.out(1.1, 0.35)', overwrite: 'auto' })
  }

  const click = (e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget
    // Keyboard activation reports (0, 0) — start from the middle instead.
    const point = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : null
    if (live) ripple(card, point)
    onPick(card, point, e)
  }

  return (
    <button
      ref={ref}
      type="button"
      data-option={index}
      aria-pressed={multi ? on : undefined}
      onClick={click}
      onPointerMove={onMove}
      onPointerLeave={release}
      onPointerDown={press}
      onPointerUp={unpress}
      className={cn(
        'group relative flex w-full items-center gap-[clamp(12px,1vw,18px)] overflow-hidden rounded-[clamp(12px,0.9vw,18px)] border px-[clamp(14px,1.1vw,22px)] py-[clamp(10px,1.35vh,18px)] text-left backdrop-blur-[2px]',
        'transition-[border-color,background-color] duration-200 cursor-pointer',
        on ? 'border-brand/70 bg-brand-soft/90' : 'border-line bg-raised/60 hover:border-brand/40 hover:bg-raised/85',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative grid h-[clamp(24px,1.6vw,30px)] w-[clamp(24px,1.6vw,30px)] shrink-0 place-items-center rounded-full border font-mono text-[clamp(11px,0.7vw,13px)] transition-colors',
          on ? 'border-brand bg-brand text-[#1a120f]' : 'border-line text-faint group-hover:border-brand/50 group-hover:text-ink-3',
        )}
      >
        {on ? <Icon name="check" size={12} /> : index + 1}
      </span>
      <span className="relative min-w-0">
        <span className={cn('block text-[clamp(15px,calc(0.42vw+0.5vh+5px),20px)] font-semibold', on ? 'text-brand-deep' : 'text-ink')}>{option.label}</span>
        <span className={cn('mt-0.5 block leading-snug text-muted', SMALL)}>{option.hint}</span>
      </span>
    </button>
  )
}

function ripple(card: HTMLElement, point: { x: number; y: number } | null) {
  const r = card.getBoundingClientRect()
  const x = point ? point.x - r.left : r.width / 2
  const y = point ? point.y - r.top : r.height / 2
  const size = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) * 2
  const dot = document.createElement('span')
  dot.setAttribute('aria-hidden', 'true')
  dot.className = 'pointer-events-none absolute rounded-full bg-brand/35'
  Object.assign(dot.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` })
  card.prepend(dot)
  gsap.fromTo(dot, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: DUR * 1.1, ease: EASE, onComplete: () => dot.remove() })
}

/* ── The finale ───────────────────────────────────────────────────────── */

function Ending({ answers, first, onBack, onFinish }: StepViewProps) {
  const rows = legend(answers)
  return (
    <div className="flex flex-col">
      <p data-beat className="setcode setcode-hot mb-[clamp(10px,1.4vh,18px)]">
        How you learn
      </p>
      <h1 tabIndex={-1} className="nameplate break-words text-[clamp(32px,min(3.9vw,7vh),96px)] leading-[0.98] text-ink outline-none">
        <Words text="This is you," />{' '}
        {first ? <Letters text={`${first}.`} className="text-brand-300" /> : <Words text="so far." />}
      </h1>
      <p data-beat className={cn('mt-[clamp(12px,1.8vh,22px)] max-w-[34em] leading-relaxed text-ink-3', ASIDE)}>
        This comes only from your answers. We'll learn more as you study, and you can change anything in Settings.
      </p>

      {rows.length > 0 && (
        <ul className="mt-[clamp(16px,2.6vh,32px)] flex flex-col gap-[clamp(8px,1.2vh,14px)]">
          {rows.map((r) => (
            <li data-beat key={r.key} className="flex items-baseline gap-3">
              <span aria-hidden className={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', DOT[r.key])} />
              <span className="setcode w-[6.5rem] shrink-0 text-ink-3">{r.label}</span>
              <span className={cn('min-w-0 leading-snug', SMALL, r.key === 'star' ? 'font-semibold text-sun-deep' : 'text-ink-2')}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Nova's hello, last thing before the door: one line, then the button. */}
      <div data-beat className="mt-[clamp(18px,3vh,36px)]">
        <EndingHello first={first} />
      </div>

      <div data-beat className="mt-[clamp(14px,2.4vh,28px)] flex items-center gap-5">
        <button type="button" onClick={onFinish} className={PRIMARY}>
          Start studying
          <Icon name="arrowRight" size={14} />
        </button>
        <button type="button" onClick={onBack} className={cn('inline-flex items-center gap-1.5 text-muted transition-colors cursor-pointer hover:text-ink', SMALL)}>
          <Icon name="arrowLeft" size={12} /> Change an answer
        </button>
      </div>
    </div>
  )
}

function EndingHello({ first }: { first: string }) {
  const line = useBotLine('firstRun', 'tutor', { name: first })
  const mood = useArrivalMood('wave', 3200)
  return (
    <BotSays agent="tutor" mood={mood} size={56}>
      {line}
    </BotSays>
  )
}

/* ── Progress ─────────────────────────────────────────────────────────── */

/**
 * Five segments on a rule — a measurement of how much is left, so it sits on
 * a rule like every other measurement in the app. Each fills by `scaleX`.
 */
function Progress({ index, reduced }: { index: number; reduced: boolean }) {
  const total = STEPS.length
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" role="presentation">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-line">
            <span
              className={cn('absolute inset-0 origin-left rounded-full', i < index ? 'bg-brand/55' : 'bg-brand')}
              style={{
                transform: `scaleX(${i <= index ? 1 : 0})`,
                transition: reduced ? undefined : 'transform 900ms var(--ease-sl)',
              }}
            />
          </span>
        ))}
      </div>
      <span className="setcode tabular-nums">{index < total ? `${index + 1} / ${total}` : 'Done'}</span>
    </div>
  )
}

/* ── Backdrop ─────────────────────────────────────────────────────────── */

/**
 * A quiet study space, after hours: a lamp, a table, dust, the room falling
 * away. The same values as the sign-up handoff (`lib/room`), so the curtain
 * lifts onto exactly this frame.
 *
 * `lit` rises with the step and the lamp warms very slightly — meant to be
 * felt rather than noticed. The extra warmth is its own layer faded by
 * opacity; transitioning the gradient itself repainted the whole viewport on
 * every frame.
 */
function Backdrop({ reduced, lit }: { reduced: boolean; lit: number }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: lampGradient(LAMP_BASE_WARMTH) }} />
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(80rem 52rem at 50% -18%, rgba(255,176,116,0.09), transparent 66%)',
          opacity: lit / DONE,
          transition: reduced ? undefined : 'opacity 1200ms var(--ease-sl)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundImage: TABLE_IMAGE, backgroundSize: TABLE_SIZE, maskImage: TABLE_MASK, WebkitMaskImage: TABLE_MASK }}
      />
      {!reduced &&
        MOTES.map((m) => (
          <div
            key={`${m.x}-${m.y}`}
            className="absolute rounded-full bg-[rgb(255,232,206)]"
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: m.s,
              height: m.s,
              opacity: m.o,
              animation: `mote ${m.dur}s ${m.d}s ease-in-out infinite`,
            }}
          />
        ))}
      <div className="absolute inset-0" style={{ background: VIGNETTE }} />
    </div>
  )
}
