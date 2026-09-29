/**
 * First run — five questions that draw a picture of you.
 *
 * A new account has nothing: no subjects, no cards, no history, and a
 * dashboard of zeroes teaches someone the product is empty at the moment they
 * are deciding whether it is worth their time. The app genuinely needs one
 * thing before it is useful — a sense of how this person wants to be taught —
 * so it asks, briefly.
 *
 * **The problem with asking** is that answers to a product you have not used
 * feel like they vanish into a form. So every answer visibly *does* something:
 * it flows out of the card you pressed and into a learning fingerprint that
 * assembles beside the questions, one layer per answer (`fingerprint.ts` says
 * which answer draws which mark). By the end the student is holding an object
 * made of what they said — nothing on it is invented, and the ending says so.
 *
 * **It is directed like a title sequence** — an opening, cuts between
 * questions, a finale — because this is the first minute of the product and
 * it should feel made. But nothing waits on the choreography: every sequence
 * fast-forwards on input, clicks never queue behind an animation, and under
 * reduced motion the whole thing is a plain, instant form.
 *
 * **Nothing here is a model call.** The questions and the drawing are fixed
 * functions of the answers.
 */

import { gsap } from 'gsap'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { updateStudentModel } from '../../api/me'
import { useAuth } from '../../auth/AuthProvider'
import { DraftingCursor } from '../../components/ui/DraftingCursor'
import { Icon } from '../../components/ui/Icon'
import { Logo } from '../../components/ui/Logo'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'
import { LAMP_BASE_WARMTH, lampGradient, MOTES, TABLE_IMAGE, TABLE_MASK, TABLE_SIZE, VIGNETTE } from '../../lib/room'
import { useHandoff, useHandoffReveal } from '../transitions/Handoff'
import { Flow, type FlowHandle } from './Flow'
import { Fingerprint, seedPoint, type Beat } from './Fingerprint'
import { legend, type LegendKey } from './fingerprint'
import { Letters, NameCondense, Opening, Words } from './Kinetic'
import { DUR, EASE, EASE_IN, EASE_IN_OUT } from './motion'
import { markOnboarded } from './state'
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

/** Which fingerprint layer each step draws. */
const LAYER: Record<Step['id'], LegendKey> = {
  name: 'seed',
  style: 'core',
  depth: 'rings',
  session: 'orbit',
  goal: 'star',
}

/** The colour an answer travels in — the colour of the mark it becomes. */
const TONE: Record<LegendKey, string> = {
  seed: 'text-ink',
  core: 'text-brand-300',
  rings: 'text-ink-2',
  orbit: 'text-sky',
  star: 'text-sun',
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
const CUT_GUARD_MS = 320

type Phase = 'opening' | 'live' | 'exit'

export function Onboarding() {
  const navigate = useNavigate()
  const { show, showError } = useToast()
  const { user, setDisplayName } = useAuth()
  const reduced = useReducedMotion()
  const reveal = useHandoffReveal()
  const { play } = useHandoff()

  const initialName = ((user?.user_metadata?.display_name as string | undefined) ?? '').trim()

  /* The truth, and what the drawing shows. `drawn` trails `answers` by the
     flight of the particles carrying a choice, so the fingerprint changes
     the instant they land rather than before they have left. */
  const [answers, setAnswers] = useState<Answers>(() => ({ ...EMPTY_ANSWERS, name: initialName }))
  const answersRef = useRef(answers)
  const [drawn, setDrawn] = useState(answers)
  const [beat, setBeat] = useState<Beat>({ n: 0, key: 'seed' })

  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState<{ index: number; key: number } | null>(null)
  const [phase, setPhase] = useState<Phase>(reduced ? 'live' : 'opening')
  const [opening, setOpening] = useState(!reduced)
  const [seeded, setSeeded] = useState(reduced)
  const [burst, setBurst] = useState<string | null>(null)

  const dir = useRef(1)
  const inDelay = useRef(0)
  const cutAt = useRef(0)
  const advance = useRef<number | null>(null)
  const inRef = useRef<HTMLDivElement>(null)
  const outRef = useRef<HTMLDivElement>(null)
  const ruleRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const fpWrap = useRef<HTMLDivElement>(null)
  const flow = useRef<FlowHandle>(null)
  const lastSave = useRef<{ key: string; done: Promise<void> } | null>(null)

  const step: Step | undefined = STEPS[index]
  const opened = phase !== 'opening'
  const first = firstName(answers.name)
  const target = useCallback(() => seedPoint(fpWrap.current), [])

  /* ── Answers ───────────────────────────────────────────────────────── */

  const update = useCallback((patch: Partial<Answers>, live = false) => {
    const next = { ...answersRef.current, ...patch }
    answersRef.current = next
    setAnswers(next)
    if (live) setDrawn(next)
  }, [])

  /** An answer has reached the drawing. */
  const land = useCallback((key: LegendKey) => {
    setDrawn(answersRef.current)
    setBeat((b) => ({ n: b.n + 1, key }))
  }, [])

  /** Send an answer from the element that gave it into the seed. */
  const feed = useCallback(
    (key: LegendKey, from: Element | null, origin?: { x: number; y: number } | null) => {
      const to = target()
      if (reduced || !from || !to || !flow.current) return land(key)
      flow.current.emit({ from: from.getBoundingClientRect(), origin, to, tone: TONE[key], onArrive: () => land(key) })
    },
    [land, reduced, target],
  )

  /* ── Cuts between questions ────────────────────────────────────────── */

  const go = useCallback(
    (next: number, delay = 0) => {
      if (advance.current) window.clearTimeout(advance.current)
      advance.current = null
      if (next === index || next < 0 || next > DONE) return
      dir.current = next > index ? 1 : -1
      inDelay.current = delay
      cutAt.current = performance.now()
      setLeaving(reduced ? null : { index, key: cutAt.current })
      setIndex(next)
    },
    [index, reduced],
  )

  /** True when a click should be ignored — see CUT_GUARD_MS. */
  const tooSoon = (e?: { detail?: number }) =>
    phase !== 'live' || (e?.detail ?? 1) > 1 || performance.now() - cutAt.current < CUT_GUARD_MS

  /**
   * One shot: the outgoing question leaves with momentum in the direction of
   * travel while the next is already on its way in — overlapping, never a
   * blank frame — and a hairline wipes across between them.
   */
  useLayoutEffect(() => {
    const inn = inRef.current
    if (!inn) return
    const words = inn.querySelectorAll('[data-word], [data-letter]')
    const beats = inn.querySelectorAll('[data-beat]')
    if (!opened) {
      gsap.set(words, { yPercent: 115 })
      gsap.set(beats, { opacity: 0 })
      return
    }
    focusStep(inn)
    // On a phone the options run below the fold; each new question starts
    // back at the top, where the fingerprint can be seen answering.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    if (reduced) {
      gsap.set([words, beats], { clearProps: 'all' })
      return
    }
    const d = dir.current
    const out = outRef.current
    const tl = gsap.timeline({ onComplete: () => setLeaving(null) })
    if (out) {
      tl.to(out.querySelectorAll('[data-word], [data-letter]'), { yPercent: -115 * d, duration: DUR * 0.7, ease: EASE_IN, stagger: 0.018 }, 0)
        .to(out.querySelectorAll('[data-beat]'), { x: -80 * d, opacity: 0, duration: DUR * 0.6, ease: EASE_IN, stagger: 0.03 }, 0)
        .fromTo(
          ruleRef.current,
          { scaleX: 0, opacity: 1, transformOrigin: d > 0 ? '0% 50%' : '100% 50%' },
          { scaleX: 1, duration: DUR * 0.55, ease: EASE_IN_OUT },
          0,
        )
        .to(ruleRef.current, { scaleX: 0, transformOrigin: d > 0 ? '100% 50%' : '0% 50%', duration: DUR * 0.7, ease: EASE_IN_OUT })
    }
    const at = (out ? 0.22 : 0) + inDelay.current
    tl.fromTo(words, { yPercent: 115 * d, rotation: 4 * d }, { yPercent: 0, rotation: 0, duration: DUR * 1.4, ease: EASE, stagger: 0.035 }, at)
      .fromTo(beats, { x: 90 * d, opacity: 0 }, { x: 0, opacity: 1, duration: DUR * 1.3, ease: EASE, stagger: 0.055, clearProps: 'transform,opacity' }, at + 0.12)
    return () => {
      tl.kill()
    }
    // `leaving` is deliberately not a dependency: clearing it when the cut
    // finishes must not replay the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, opened, reduced])

  /* The chrome — header and progress — arrives with the first question. */
  useLayoutEffect(() => {
    if (reduced) return
    const chrome = [headerRef.current, progressRef.current]
    if (!opened) gsap.set(chrome, { opacity: 0, y: -12 })
    else gsap.to(chrome, { opacity: 1, y: 0, duration: DUR * 1.4, ease: EASE, stagger: 0.1, clearProps: 'transform' })
  }, [opened, reduced])

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

  const leave = useCallback(async () => {
    if (phase === 'exit') return
    setPhase('exit')
    const saving = save(answersRef.current)
    if (!reduced) await flyIntoLogo(fpWrap.current, headerRef.current, [inRef.current, progressRef.current])
    void play('desk', async () => {
      await saving
      navigate('/home', { replace: true })
    })
  }, [navigate, phase, play, reduced, save])

  const skipAll = useCallback(() => {
    // Say where it went: leaving without being told the questions still exist
    // makes it look like a one-time door you just closed.
    show('You can set these any time — Settings → How you learn.', 'info')
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
      update({ [s.field]: value } as Partial<Answers>, true)
      if (s.field === 'name' && value && !reduced) {
        setBurst(value)
        go(index + 1, 0.95)
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
      update(cleared, true)
      go(index + 1)
    },
    [go, index, update],
  )

  /* Keys: 1–9 pick an option, Enter continues where a button would. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'live' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea')) return
      // Enter on a focused control is that control's own click.
      if (e.key === 'Enter' && t?.closest('button, a')) return
      if (index === DONE && e.key === 'Enter') return void leave()
      if (!step || step.kind !== 'choice') return
      if (e.key === 'Enter' && step.multi && answersRef.current.styles.length) return void go(index + 1)
      const n = Number(e.key)
      const o = step.options[n - 1]
      if (!o || tooSoon()) return
      const card = inRef.current?.querySelector(`[data-option="${n - 1}"]`) ?? null
      const r = card?.getBoundingClientRect()
      pick(step, o, card, r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const rows = legend(answers)
  const caption = rows.find((r) => r.key === beat.key) ?? rows[0]

  const view = (i: number) => (
    <StepView
      index={i}
      answers={answers}
      first={first}
      reduced={reduced}
      onType={(field, value) => update({ [field]: value } as Partial<Answers>, true)}
      onPick={(s, o, card, point, e) => !tooSoon(e) && pick(s, o, card, point)}
      onSubmit={(s) => !tooSoon() && submitText(s)}
      onContinue={() => !tooSoon() && go(index + 1)}
      onSkip={(s) => !tooSoon() && skipStep(s)}
      onBack={() => phase === 'live' && go(i - 1)}
      onFinish={() => void leave()}
    />
  )

  return (
    // `lg:cursor-none` scoped here, matching the landing page: first run is a
    // surface you are being *shown*, so it keeps the reticle.
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-canvas lg:cursor-none">
      <DraftingCursor />
      <Backdrop reduced={reduced} lit={Math.min(index, DONE)} />

      {opening && (
        <Opening
          run={reveal}
          target={target}
          onCue={() => setPhase('live')}
          onSeed={() => setSeeded(true)}
          onEnd={() => {
            setPhase((p) => (p === 'opening' ? 'live' : p))
            setSeeded(true)
            setOpening(false)
          }}
        />
      )}
      {burst && <NameCondense name={burst} target={target} onLand={() => land('seed')} onEnd={() => setBurst(null)} />}
      <Flow ref={flow} />

      <header ref={headerRef} className="relative z-10 flex items-center justify-between px-4 py-5 sm:px-10">
        <Logo />
        {index < DONE && (
          <button
            type="button"
            onClick={skipAll}
            disabled={phase === 'exit'}
            className="rounded-full px-3 py-1.5 text-[13.5px] text-muted transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
          >
            Skip for now
          </button>
        )}
      </header>

      <main
        className={cn(
          'relative z-10 mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 content-start gap-5 px-4 pb-12 sm:px-6',
          // Top-aligned, with the drawing pinned: re-centring on each
          // question's height would make the fingerprint jump between steps.
          'lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-start lg:gap-16 lg:px-10 lg:pt-[3vh]',
        )}
      >
        {/* ── The fingerprint ─────────────────────────────────────────── */}
        <div className="flex flex-col items-center lg:sticky lg:top-6 lg:order-2">
          <div ref={fpWrap} className="w-[min(62vw,15rem)] sm:w-[19rem] lg:w-full lg:max-w-[30rem]">
            <Fingerprint answers={drawn} reduced={reduced} ready={seeded} beat={beat} finale={index === DONE} />
          </div>
          <p
            className={cn('mt-2 hidden min-h-[2.5rem] max-w-sm text-center lg:block', (index === DONE || !caption) && 'invisible')}
            aria-live="polite"
          >
            {caption && (
              <span key={`${caption.key}-${beat.n}`} className="block" style={reduced ? undefined : { animation: 'lineUp 600ms var(--ease-sl) both' }}>
                <span className="setcode text-ink-3">{caption.label}</span>
                <span className="ml-2 text-[13px] leading-snug text-muted">{caption.text}</span>
              </span>
            )}
          </p>
        </div>

        {/* ── The question ────────────────────────────────────────────── */}
        <section className="relative min-w-0 lg:order-1 lg:min-h-[32rem]">
          <div ref={progressRef}>
            <Progress index={index} reduced={reduced} />
          </div>
          <div className="relative mt-7">
            <div ref={ruleRef} aria-hidden className="absolute -top-3.5 left-0 right-0 h-px bg-brand/70" style={{ opacity: 0 }} />
            {leaving && (
              <div key={leaving.key} ref={outRef} className="pointer-events-none absolute inset-x-0 top-0" aria-hidden inert>
                {view(leaving.index)}
              </div>
            )}
            <div key={index} ref={inRef}>
              {view(index)}
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
 * The fingerprint shrinks and flies into the logo, where the app's own mark
 * will be when the curtain lifts — the thing you just made is carried in.
 */
function flyIntoLogo(fp: HTMLElement | null, header: HTMLElement | null, [content, progress]: (HTMLElement | null)[]): Promise<void> {
  const mark = header?.querySelector('.logo-mark')
  if (!fp || !mark) return Promise.resolve()
  const a = fp.getBoundingClientRect()
  const b = mark.getBoundingClientRect()
  return new Promise((resolve) => {
    gsap
      .timeline({ onComplete: resolve })
      .to(content?.querySelectorAll('[data-word], [data-letter]') ?? [], { yPercent: -115, duration: DUR * 0.7, ease: EASE_IN, stagger: 0.012 }, 0)
      .to([...(content?.querySelectorAll('[data-beat]') ?? []), progress], { y: -24, opacity: 0, duration: DUR * 0.6, ease: EASE_IN, stagger: 0.03 }, 0)
      .to(fp, { scale: 1.06, duration: 0.2, ease: EASE_IN_OUT }, 0.1)
      .to(
        fp,
        {
          x: b.left + b.width / 2 - (a.left + a.width / 2),
          y: b.top + b.height / 2 - (a.top + a.height / 2),
          scale: (b.width / a.width) * 1.4,
          rotation: -200,
          duration: DUR * 1.5,
          ease: EASE_IN_OUT,
        },
        0.3,
      )
      .to(fp, { opacity: 0, duration: 0.2 }, 0.3 + DUR * 1.5 - 0.15)
      .fromTo(mark, { scale: 1 }, { scale: 1.35, duration: 0.16, ease: EASE, yoyo: true, repeat: 1 }, 0.3 + DUR * 1.5 - 0.1)
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

function StepView(p: StepViewProps) {
  const s = STEPS[p.index]
  if (!s) return <Ending {...p} />

  // Greets them once there is a name to greet them by.
  const eyebrow = s.id === 'style' && p.first ? `Good to meet you, ${p.first}.` : s.id === 'goal' ? (p.first ? `Last one, ${p.first}.` : 'Last one.') : null

  return (
    <div className="flex flex-col">
      {eyebrow && (
        <p data-beat className="setcode setcode-hot mb-3">
          {eyebrow}
        </p>
      )}
      <h1 tabIndex={-1} id={`ask-${s.id}`} className="nameplate break-words text-[clamp(28px,3.6vw,50px)] leading-[1.02] text-ink outline-none">
        <Words text={s.ask} />
      </h1>
      <p data-beat className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-3">
        {s.aside}
      </p>

      <div className="mt-7">{s.kind === 'text' ? <TextAnswer step={s} {...p} /> : <ChoiceAnswer step={s} {...p} />}</div>

      <div data-beat className="mt-6 flex items-center gap-5">
        {p.index > 0 && (
          <button type="button" onClick={p.onBack} className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors cursor-pointer hover:text-ink">
            <Icon name="arrowLeft" size={12} /> Back
          </button>
        )}
        {s.kind === 'choice' && (
          <button type="button" onClick={() => p.onSkip(s)} className="text-[13px] text-faint transition-colors cursor-pointer hover:text-ink">
            Skip this one
          </button>
        )}
        {s.kind === 'choice' && (
          <span className="setcode ml-auto hidden lg:inline">Keys 1–{s.options.length}</span>
        )}
      </div>
    </div>
  )
}

function TextAnswer({ step, answers, onType, onSubmit }: StepViewProps & { step: TextStep }) {
  const value = answers[step.field]
  const empty = !value.trim()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(step)
      }}
      className="flex flex-col gap-5"
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
          className="w-full border-0 border-b border-line bg-transparent pb-2.5 text-[clamp(20px,2.2vw,28px)] font-semibold text-ink outline-none transition-colors placeholder:font-normal placeholder:text-faint focus:border-brand/70"
        />
      </div>
      <div data-beat className="flex items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-[14.5px] font-semibold text-[#1a120f] t-control duration-200 cursor-pointer hover:brightness-110 active:scale-[0.98]"
        >
          {step.id === 'goal' ? 'Finish' : 'Continue'}
          <Icon name="arrowRight" size={14} />
        </button>
        {empty && <span className="text-[13px] text-faint">{step.id === 'goal' ? 'or leave it blank' : 'or skip it'}</span>}
      </div>
    </form>
  )
}

function ChoiceAnswer({ step, answers, reduced, onPick, onContinue }: StepViewProps & { step: ChoiceStep }) {
  const chosen = (o: Option) => (step.multi ? answers.styles.includes(o.value) : answers[step.field] === o.value)
  const count = step.multi ? answers.styles.length : 0
  return (
    <>
      <div className="flex flex-col gap-2">
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
              'mt-5 inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14.5px] font-semibold t-control duration-200',
              count > 0 ? 'bg-brand text-[#1a120f] cursor-pointer hover:brightness-110 active:scale-[0.98]' : 'cursor-default bg-line-soft text-faint',
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
 * stream into the fingerprint starts.
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
    if (live) gsap.to(ref.current, { scale: 0.965, duration: 0.12, ease: EASE_IN_OUT, overwrite: 'auto' })
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
        'group relative flex w-full items-center gap-3.5 overflow-hidden rounded-[14px] border px-4 py-3 text-left',
        'transition-[border-color,background-color] duration-200 cursor-pointer',
        on ? 'border-brand/70 bg-brand-soft' : 'border-line bg-raised/70 hover:border-brand/40 hover:bg-raised',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'relative grid h-6 w-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] transition-colors',
          on ? 'border-brand bg-brand text-[#1a120f]' : 'border-line text-faint group-hover:border-brand/50 group-hover:text-ink-3',
        )}
      >
        {on ? <Icon name="check" size={12} /> : index + 1}
      </span>
      <span className="relative min-w-0">
        <span className={cn('block text-[15.5px] font-semibold', on ? 'text-brand-deep' : 'text-ink')}>{option.label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{option.hint}</span>
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
      <p data-beat className="setcode setcode-hot mb-3">
        Your learning fingerprint
      </p>
      <h1 tabIndex={-1} className="nameplate break-words text-[clamp(30px,4.2vw,58px)] leading-[0.98] text-ink outline-none">
        <Words text="This is you," />{' '}
        {first ? <Letters text={`${first}.`} className="text-brand-300" /> : <Words text="so far." />}
      </h1>
      <p data-beat className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-3">
        As you've told us — every mark on it comes from an answer you just gave, and nothing else. The rest, the app learns as you study. All of
        it can be changed in Settings.
      </p>

      {rows.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2.5">
          {rows.map((r) => (
            <li data-beat key={r.key} className="flex items-baseline gap-3">
              <span aria-hidden className={cn('h-2 w-2 shrink-0 translate-y-[-1px] rounded-full', DOT[r.key])} />
              <span className="setcode w-[5.5rem] shrink-0 text-ink-3">{r.label}</span>
              <span className={cn('min-w-0 text-[14px] leading-snug', r.key === 'star' ? 'font-semibold text-sun-deep' : 'text-ink-2')}>{r.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div data-beat className="mt-8 flex items-center gap-5">
        <button
          type="button"
          onClick={onFinish}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-[15px] font-semibold text-[#1a120f] t-control duration-200 cursor-pointer hover:brightness-110 active:scale-[0.98]"
        >
          Start studying
          <Icon name="arrowRight" size={14} />
        </button>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors cursor-pointer hover:text-ink">
          <Icon name="arrowLeft" size={12} /> Change an answer
        </button>
      </div>
    </div>
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
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
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

