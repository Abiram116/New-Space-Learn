/**
 * Settings › Learning shows the first-run answers as the same choices they
 * were given as, not as the sentences stored for the AI. These turn one into
 * the other, both ways, without losing anything a student wrote by hand.
 */

import {
  LEARNING_STYLE_MAX,
  STEPS,
  TEACHING_PREFERENCE_MAX,
  type ChoiceStep,
} from '../onboarding/steps'

const step = (id: ChoiceStep['id']) => STEPS.find((s): s is ChoiceStep => s.id === id)!

export const STYLE = step('style')
export const DEPTH = step('depth')
export const SESSION = step('session')

/** The session lengths offered as one tap, in minutes. */
export const SESSION_MINUTES = SESSION.options.map((o) => Number(o.value))

/**
 * A stored learning style, split into the choices it contains and whatever
 * else is in it. Several choices are stored joined by "; " (see `buildPatch`),
 * so anything between semicolons that is not one of ours is the student's own.
 */
export function parseStyles(text: string | null | undefined): { picked: string[]; own: string } {
  const parts = (text ?? '').split(';').map((p) => p.trim()).filter(Boolean)
  const values = STYLE.options.map((o) => o.value)
  return {
    picked: values.filter((v) => parts.includes(v)),
    own: parts.filter((p) => !values.includes(p)).join('; '),
  }
}

/** The reverse: choices in the options' own order, then the student's words. */
export function composeStyles(picked: string[], own: string): string | null {
  const chosen = STYLE.options.map((o) => o.value).filter((v) => picked.includes(v))
  return [...chosen, own.trim()].filter(Boolean).join('; ').slice(0, LEARNING_STYLE_MAX) || null
}

/** Which depth choice a stored preference is, or null when it is their own words. */
export function depthChoice(text: string | null | undefined): string | null {
  const value = (text ?? '').trim()
  return DEPTH.options.find((o) => o.value === value)?.value ?? null
}

export const OWN_STYLE_MAX = 120
export { TEACHING_PREFERENCE_MAX }
