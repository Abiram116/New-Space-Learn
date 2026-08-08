/**
 * ONE motion language for the whole landing page.
 *
 * Every duration and every curve on this page comes from here. Nothing is
 * allowed to invent its own. That is the entire point: a page where the hero
 * eases differently from the close reads as assembled by different people,
 * however good each piece is on its own.
 *
 * The curve is `cubic-bezier(0.22, 1, 0.36, 1)` — a hard start, a long glide,
 * a settle with no bounce. It is the same shape whether it is a headline
 * wiping in, a button filling, or a card lifting under the cursor, so the page
 * feels like one physical system rather than a set of effects.
 *
 * CSS and GSAP have to agree, or the language breaks at exactly the moments
 * both are running: `EASE_CSS` is the literal curve, and `EASE` is a
 * CustomEase built from the SAME four numbers so a GSAP tween and a CSS
 * transition on adjacent elements move identically.
 */

import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(CustomEase)

/** The one curve. Four numbers, used by both engines. */
export const EASE_POINTS = '0.22, 1, 0.36, 1'
export const EASE_CSS = `cubic-bezier(${EASE_POINTS})`
export const EASE = CustomEase.create('sl', EASE_POINTS)

/**
 * The one duration, in seconds. Anything that needs to feel heavier is a
 * MULTIPLE of it rather than an arbitrary new number — `DUR * 1.5` reads as
 * the same system moving a bigger object, where `1.05` reads as a guess.
 */
export const DUR = 0.7
export const DUR_MS = DUR * 1000

/** Stagger between members of a set, so groups always break up at one rate. */
export const STAGGER = 0.075

/**
 * Motion grammar — what a movement MEANS.
 *
 * Reading is always left → right, because that is the direction the eye
 * already travels over prose. Thinking pulses. Knowledge connects along a
 * thread. Cards flip. A quiz drops in. Completion collapses inward.
 *
 * Keeping these named rather than inline is what stops the page drifting back
 * into "some things fade, some things slide": if a new element does not fit
 * one of these verbs, either it is the wrong animation or the grammar is
 * missing a word — and both are worth noticing before writing the tween.
 */
export const GRAMMAR = {
  /** Prose, citations, anything you read. Wipes along the reading direction. */
  read: { clipFrom: 'inset(0 100% -18% 0)', clipTo: 'inset(0 0% -18% 0)' },
  /** Retrieval and processing. Breathes rather than travels. */
  think: { scaleFrom: 0.985, scaleTo: 1 },
  /** A thing you own arriving. Lifts off the surface it came from. */
  card: { yFrom: 26, rotateFrom: -2 },
  /** Being tested. Drops in from above and settles. */
  quiz: { yFrom: -22 },
  /** Done. Collapses toward its own centre. */
  done: { scaleFrom: 1.04, scaleTo: 1 },
} as const
