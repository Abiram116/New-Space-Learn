/**
 * When asking for feedback is worth the interruption.
 *
 * That question — not "how long since we last asked" — is the whole policy.
 * The first version counted assistant turns and offered chips every fifth one,
 * which is a survey on a timer: it asks because the clock said so rather than
 * because there is something to learn, and a student who has told the system
 * nothing new still gets interrupted. Turn counts are now a **floor**, never a
 * trigger.
 *
 * ## What actually triggers an ask
 *
 * Something happened that the system cannot interpret on its own:
 *
 * - **Confusion with no direction** — "I don't get it", "I'm lost". They are
 *   stuck and haven't said *how*, so which dimension is wrong is genuinely
 *   unknown. The strongest case for asking.
 * - **Repeated regeneration** — asking again for the same thing says the
 *   current settings are not working, without saying what to change. One
 *   regenerate is noise; two in a row is a signal.
 * - **A contested dimension** — evidence exists on something that matters for
 *   *this* answer and it disagrees with itself, so one tap would settle it.
 *
 * ## What explicitly does NOT trigger one
 *
 * - **A directed request** — "explain simpler", "more detail", "shorter". The
 *   student already said what they want and `_resolve_implicit` in
 *   `api/app/services/preferences.py` records it. Asking afterwards is asking
 *   a question that was just answered, which is how a feature teaches people
 *   it is not listening.
 * - **A new chat, topic or subject.** A new chat is not a new student and a
 *   new topic is not a new preference. The Student Model is global and
 *   persists; topic-specific evidence overrides it where it exists, but
 *   nothing resets and nothing re-asks. Nothing in this module observes any of
 *   those events, which is the point — they cannot accidentally become
 *   triggers later.
 * - **Time passing.** Stated explicitly because it was the old rule.
 *
 * ## And it stops once it knows
 *
 * `isSettled` drops any dimension already answered well enough that another
 * tap would not move it, so the asking fades out as the model gets sure rather
 * than continuing forever at a fixed cadence.
 *
 * Pure functions, no React, no I/O — a bug here is invisible (chips never
 * appear, or appear constantly) rather than loud, so it has to be testable on
 * its own. See `feedbackPolicy.test.ts`.
 */

import type { FeedbackKind, Preference } from '../../api/feedback'

/** Below this many characters an answer has no length opinion worth having. */
export const LONG_ANSWER_CHARS = 400

/**
 * Minimum quiet between offers. A floor under the event triggers, not a
 * trigger itself — two confusing answers back to back should not produce two
 * chip rows.
 */
export const MIN_TURNS_BETWEEN_OFFERS = 3

/** Longer quiet after the student actually gives feedback. They have spoken. */
export const AFTER_FEEDBACK_GAP = 10

/** Past this confidence, more evidence on that key changes nothing. */
export const CONFIDENT_ENOUGH = 0.75

/** And past this much evidence, likewise — a settled preference stops asking. */
export const ENOUGH_EVIDENCE = 6

/**
 * Below this confidence *with* evidence already recorded, a dimension is
 * contested rather than unknown: taps have landed on both sides and cancelled
 * out. That is the one case where asking outright beats waiting for more
 * implicit signal, because more of the same signal keeps cancelling.
 */
export const CONTESTED_BELOW = 0.35

/**
 * What the student's last turn told us, if anything.
 *
 * Derived from their message rather than from a counter — see `readSignal`.
 */
export type TurnSignal =
  /** "I don't understand" — stuck, but hasn't said which way to move. */
  | 'confusion'
  /** "explain simpler", "more detail" — direction given; already recorded. */
  | 'directed'
  /** They asked for the same answer again. */
  | 'regenerated'
  /** An ordinary follow-up question. */
  | 'none'

export type AskInput = {
  /** Length of the answer being shown. */
  chars: number
  /** What the student's last turn signalled. */
  signal: TurnSignal
  /** Consecutive regenerations of this answer, including the current one. */
  regenerations: number
  /** Assistant turns since chips were last shown, or null if never. */
  turnsSinceOffered: number | null
  /** Assistant turns since feedback was last given, or null if never. */
  turnsSinceGiven: number | null
  /** Assistant turns in this conversation so far, including this one. */
  assistantTurns: number
  /** Resolved preferences, used for the expected-value gate. */
  preferences: Preference[]
  /** False while tokens are still arriving — never interrupt a stream. */
  complete: boolean
}

/** Why the chips are being shown. Returned so the UI can word the row. */
export type AskReason = 'confusion' | 'repeated_regenerate' | 'contested' | null

/**
 * The reason to ask, or `null` for "don't".
 *
 * Split out from `chipsFor` so the *decision* is inspectable on its own — in
 * tests, and in a log line if it ever matters why a student was interrupted.
 */
export function askReason(input: AskInput): AskReason {
  // Never mid-stream: chips under a growing answer move as it grows, and a
  // control that moves under the cursor is a control that gets mis-tapped.
  if (!input.complete) return null

  // Not on the very first answer — there is no sense yet of what "normal"
  // looks like here, so any opinion would be uncalibrated.
  if (input.assistantTurns < 2) return null

  // They already told us what they wanted, in words, and it is recorded.
  // Asking now would be asking a question the student just answered.
  if (input.signal === 'directed') return null

  // Floors. These gate the triggers below; they never fire an ask themselves.
  if (input.turnsSinceGiven !== null && input.turnsSinceGiven < AFTER_FEEDBACK_GAP) {
    return null
  }
  if (input.turnsSinceOffered !== null && input.turnsSinceOffered < MIN_TURNS_BETWEEN_OFFERS) {
    return null
  }

  // ── Triggers, strongest first ──
  if (input.signal === 'confusion') return 'confusion'
  if (input.signal === 'regenerated' && input.regenerations >= 2) {
    return 'repeated_regenerate'
  }
  if (candidateKinds(input.chars).some((k) => isContested(k, input.preferences))) {
    return 'contested'
  }
  return null
}

/**
 * The chips to offer, or an empty array for "don't ask".
 *
 * Contextual rather than fixed: offering "too long" under a two-line answer is
 * how a feedback UI teaches people it isn't paying attention. A long answer can
 * be too long or too complicated; a short one can only really be too thin.
 */
export function chipsFor(input: AskInput): FeedbackKind[] {
  if (askReason(input) === null) return []
  // Anything already settled is dropped from the row rather than the whole row
  // being suppressed — one useful chip is still worth showing.
  const useful = candidateKinds(input.chars).filter(
    (kind) => !isSettled(kind, input.preferences),
  )
  return useful.length > 0 ? [...useful, 'useful'] : []
}

/** What could plausibly be wrong with an answer of this length. */
function candidateKinds(chars: number): FeedbackKind[] {
  return chars >= LONG_ANSWER_CHARS
    ? ['too_long', 'too_complex', 'need_example']
    : ['want_detail', 'need_example']
}

/**
 * Classify the student's message.
 *
 * Deliberately narrow. A phrase only counts as `directed` when it names the
 * direction to move, because that is what makes asking redundant — vague
 * dissatisfaction ("this isn't helping") is confusion, not direction, and
 * should still produce an offer.
 *
 * These patterns mirror `_IMPLICIT_PATTERNS` in
 * `api/app/services/preferences.py`, which is what actually *records* the
 * preference. This copy only decides whether to stay quiet, so a miss here
 * costs one unnecessary offer rather than a lost signal — the asymmetry is
 * why duplicating the patterns is acceptable.
 */
export function readSignal(message: string): TurnSignal {
  const t = message.toLowerCase()

  // Direction given → already learned → say nothing.
  if (
    /\b(simpler|simplify|dumb(?:ed)? down|less detail|shorter|too long|be brief|concise)\b/.test(t) ||
    /\b(more detail|elaborate|go deeper|expand on|longer|in depth)\b/.test(t) ||
    /\b(example|for instance|show me how)\b/.test(t)
  ) {
    return 'directed'
  }

  // Stuck, with no direction → the one case worth interrupting for.
  if (
    /\b(i (?:don'?t|do not) (?:get|understand|follow)|(?:i'?m|i am) lost|makes no sense|confus(?:ed|ing)|no idea|still (?:don'?t|do not))\b/.test(t)
  ) {
    return 'confusion'
  }

  return 'none'
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
 * not move it. This is the anti-nag mechanism.
 */
export function isSettled(kind: FeedbackKind, preferences: Preference[]): boolean {
  const pref = prefFor(kind, preferences)
  if (!pref) return false
  return pref.confidence >= CONFIDENT_ENOUGH || pref.evidence_count >= ENOUGH_EVIDENCE
}

/**
 * True when the evidence on this dimension exists but disagrees with itself.
 *
 * Distinct from "unknown": an absent preference gets filled in by ordinary
 * implicit signal soon enough, so asking adds little. A *contested* one will
 * not resolve on its own, because the signal arriving is what keeps cancelling
 * out. That is where a direct question earns the interruption.
 */
export function isContested(kind: FeedbackKind, preferences: Preference[]): boolean {
  const pref = prefFor(kind, preferences)
  if (!pref) return false
  return pref.evidence_count >= 2 && pref.confidence < CONTESTED_BELOW
}

function prefFor(kind: FeedbackKind, preferences: Preference[]): Preference | undefined {
  const key = KIND_KEY[kind]
  if (!key) return undefined
  return preferences.find((p) => p.key === key)
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

/**
 * How the row introduces itself, per reason.
 *
 * Naming what it saw makes the ask read as a response to something rather than
 * as a survey that fired.
 */
export const REASON_PROMPT: Record<NonNullable<AskReason>, string> = {
  confusion: 'What would help?',
  repeated_regenerate: 'What should change?',
  contested: 'Which suits you better?',
}
