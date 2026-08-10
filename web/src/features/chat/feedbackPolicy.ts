/**
 * When to ask for feedback, and what to offer.
 *
 * The thing that makes a feedback control get ignored forever is asking too
 * often and asking the wrong question. So this is deliberately conservative,
 * and the rule that matters most is the last one: **the system stops asking
 * once it already knows.** A cooldown alone would still pester a student whose
 * preferences are settled; gating on confidence means the asking naturally
 * fades out as the model gets sure, which is the "expected value of the
 * feedback" test made concrete.
 *
 * Pure functions with no React and no I/O, so the policy is testable on its
 * own — which matters, because a bug here is invisible (the chips simply never
 * appear, or appear constantly) rather than loud.
 */

import type { FeedbackKind } from '../../api/feedback'
import type { Preference } from '../../api/feedback'

/** Below this many characters an answer has no length opinion worth having. */
export const LONG_ANSWER_CHARS = 400

/** Assistant turns between offers. */
export const TURN_GAP = 5

/** Turns of quiet after the student actually gives feedback. */
export const AFTER_FEEDBACK_GAP = 10

/** Past this confidence, more evidence on that key changes nothing. */
export const CONFIDENT_ENOUGH = 0.75

/** And past this much evidence, likewise — a settled preference stops asking. */
export const ENOUGH_EVIDENCE = 6

export type AskInput = {
  /** Length of the answer being shown. */
  chars: number
  /** Assistant turns rendered in this session so far, including this one. */
  assistantTurns: number
  /** Assistant turn index when chips were last shown, or null. */
  lastOfferedAt: number | null
  /** Assistant turn index when feedback was last given, or null. */
  lastGivenAt: number | null
  /** Resolved preferences, used for the expected-value gate. */
  preferences: Preference[]
  /** False while tokens are still arriving — never interrupt a stream. */
  complete: boolean
}

/**
 * The chips to offer, or an empty array for "don't ask".
 *
 * Contextual rather than fixed: offering "too long" under a two-line answer is
 * how a feedback UI teaches people it isn't paying attention. A long answer can
 * be too long or too complicated; a short one can only really be too thin.
 */
export function chipsFor(input: AskInput): FeedbackKind[] {
  if (!shouldAsk(input)) return []
  const long = input.chars >= LONG_ANSWER_CHARS
  const offered: FeedbackKind[] = long
    ? ['too_long', 'too_complex', 'need_example']
    : ['want_detail', 'need_example']
  // Anything already settled is dropped from the row rather than the whole row
  // being suppressed — one useful chip is still worth showing.
  const useful = offered.filter((kind) => !isSettled(kind, input.preferences))
  return useful.length > 0 ? [...useful, 'useful'] : []
}

export function shouldAsk(input: AskInput): boolean {
  // Never mid-stream: chips under a growing answer move as it grows, and a
  // control that moves under the cursor is a control that gets mis-tapped.
  if (!input.complete) return false
  // Not on the very first answer — there is no sense yet of what "normal"
  // looks like here, so the opinion would be uncalibrated.
  if (input.assistantTurns < 2) return false
  if (input.lastGivenAt !== null && input.assistantTurns - input.lastGivenAt < AFTER_FEEDBACK_GAP) {
    return false
  }
  if (input.lastOfferedAt !== null && input.assistantTurns - input.lastOfferedAt < TURN_GAP) {
    return false
  }
  return true
}

/** The key a chip is evidence for — mirrors the backend taxonomy. */
const KIND_KEY: Partial<Record<FeedbackKind, string>> = {
  too_long: 'explanation.length',
  want_detail: 'explanation.length',
  too_complex: 'explanation.depth',
  too_simple: 'explanation.depth',
  need_example: 'explanation.opens_with',
  want_theory: 'explanation.opens_with',
  want_direct: 'interaction.answer_mode',
}

/**
 * True when we already know this dimension well enough that another tap would
 * not move it. This is the whole anti-nag mechanism.
 */
export function isSettled(kind: FeedbackKind, preferences: Preference[]): boolean {
  const key = KIND_KEY[kind]
  if (!key) return false
  const pref = preferences.find((p) => p.key === key)
  if (!pref) return false
  return pref.confidence >= CONFIDENT_ENOUGH || pref.evidence_count >= ENOUGH_EVIDENCE
}

/** Chip labels — phrased as what the student wants, not as a complaint. */
export const CHIP_LABEL: Record<FeedbackKind, string> = {
  too_long: 'Too long',
  want_detail: 'More detail',
  too_complex: 'Too complicated',
  too_simple: 'Too basic',
  need_example: 'Need an example',
  want_theory: 'Theory first',
  want_direct: 'Just the answer',
  useful: 'This helped',
  regenerate: 'Regenerate',
}
