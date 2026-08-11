/**
 * The sample answer that rewrites itself as the student chooses.
 *
 * **Why this exists.** Onboarding asks four questions, and being asked
 * questions by a product you have not used yet is unpleasant in a specific
 * way: you cannot tell what any answer will do, so you start guessing at the
 * response the form wants. That is evaluation, and people rush or skip it.
 *
 * Showing the consequence removes the guessing entirely. Pick "a concrete
 * example" and the sample answer opens with a speedometer; pick "the formal
 * definition" and it opens with the limit. There is no hidden correct choice
 * because every choice is visible, which turns the question from a test into a
 * control you are operating — and, incidentally, demonstrates the product
 * before the student has uploaded anything.
 *
 * **Nothing here is generated.** These are fixed strings composed by lookup.
 * A real model call would cost quota on a scripted screen, take a second per
 * keystroke-equivalent, and could contradict the preference it is supposed to
 * be illustrating. The variants are faithful to what the preferences actually
 * do — they are interpolated into the system prompt — so this illustrates
 * behaviour rather than promising it.
 */

/** One fixed question, so the only thing changing is what the choices did. */
export const SAMPLE_QUESTION = 'What is a derivative?'

/**
 * Keyed by the stored `value` of each learning-style option, so the mapping
 * cannot drift from the answers actually saved to the student model.
 */
const OPENERS: Record<string, string> = {
  'examples first, then the general rule':
    'Think of a speedometer. At any instant it reads how fast your position is changing — that reading is the derivative.',
  'the intuition first, then the detail':
    'A derivative answers one question: if I nudge the input a little, how much does the output move?',
  'the precise definition first, then examples':
    'The derivative of f at a is the limit of (f(a+h) − f(a)) / h as h approaches 0, whenever that limit exists.',
  'comparisons against things I already know':
    'Average speed is total distance over total time. A derivative is that same ratio, shrunk until the interval is a single instant.',
}

/** Keyed by the stored `value` of each depth option. */
const TAILS: Record<string, string> = {
  'Keep explanations short and direct.': '',
  'Go into real depth; I would rather have too much than too little.':
    'Every differentiation rule you will meet — power, product, chain — falls out of that same limit, which is why they compose so cleanly instead of needing to be memorised separately.',
  'Match the depth to the question rather than a fixed length.':
    'If that lands, the differentiation rules are the natural next step. If it does not, we can stay with the picture a while longer.',
}

/**
 * Compose the sample from whatever has been answered so far.
 *
 * Partial state is the normal case — this renders on step one, when only the
 * style is known. Falls back to the intuition opener so the panel is never
 * empty, because an empty preview on the first screen would read as broken
 * rather than as pending.
 */
export function composeSample(styleValue: string | undefined, depthValue: string | undefined): {
  paragraphs: string[]
} {
  const openers = (styleValue ?? '')
    .split('; ')
    .map((v) => OPENERS[v.trim()])
    .filter(Boolean)

  const lead = openers.length > 0 ? openers : [OPENERS['the intuition first, then the detail']]
  const tail = depthValue ? TAILS[depthValue] : undefined

  return { paragraphs: tail ? [...lead, tail] : lead }
}

/**
 * How a sitting is described back to the student.
 *
 * Concrete rather than a number echo: "30 minutes" tells them what they just
 * said, "about six cards or a short quiz" tells them what it buys.
 */
export function sessionShape(minutes: string | undefined): string | null {
  switch (minutes) {
    case '15':
      return 'A short sitting — a handful of cards, or one concept properly.'
    case '30':
      return 'Half an hour — a topic explained, then cards made from it.'
    case '60':
      return 'An hour — enough to read, ask, and be quizzed on it after.'
    case '120':
      return 'A long session — several topics, with breaks built into the pacing.'
    default:
      return null
  }
}
