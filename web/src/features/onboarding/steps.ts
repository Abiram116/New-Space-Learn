/**
 * The intake questions.
 *
 * Split out of the component so the sample-answer preview can be checked
 * against the *real* option values rather than a copy of them. `preview.ts`
 * keys its variants on these exact strings, and a test that hardcoded them
 * would keep passing after someone reworded a step — the failure it is
 * supposed to catch.
 */

export type Option = {
  /** What the student sees, and what is echoed back in the summary. */
  label: string
  /** What is stored, and what the sample answer is keyed on. */
  value: string
  /** One line on what choosing this actually does. Not decoration — it is the
   *  difference between picking a word and making a decision. */
  hint: string
}

export type Step = {
  id: string
  /** The question, asked plainly. */
  ask: string
  /** A sentence lowering the stakes. Every one of these is recoverable. */
  aside: string
  options: Option[]
  field: 'learning_style' | 'teaching_preference' | 'session_length_minutes'
  freeform?: boolean
  /**
   * Several answers can be true at once.
   *
   * "What makes it click" is genuinely not one thing — an example *and* a
   * comparison is the honest answer for most people, and forcing a single pick
   * throws away half of what they would have told us. Single-select stays the
   * default because most questions really do have one answer, and a
   * multi-select that only ever takes one tap is a worse single-select.
   */
  multi?: boolean
}

export const STEPS: Step[] = [
  {
    id: 'style',
    ask: 'When something is new to you, what makes it click?',
    aside: 'Pick as many as fit — most people need more than one.',
    field: 'learning_style',
    multi: true,
    options: [
      {
        label: 'A concrete example',
        value: 'examples first, then the general rule',
        hint: 'Answers open with a worked case, then generalise',
      },
      {
        label: 'The idea behind it',
        value: 'the intuition first, then the detail',
        hint: 'Answers lead with why it works before the mechanics',
      },
      {
        label: 'The formal definition',
        value: 'the precise definition first, then examples',
        hint: 'Answers state it precisely first, then illustrate',
      },
      {
        label: 'Seeing it compared',
        value: 'comparisons against things I already know',
        hint: 'Answers anchor to something you already understand',
      },
    ],
  },
  {
    id: 'depth',
    ask: 'And how much do you want at once?',
    aside: 'This is the one people change most often. It is a slider, not a vow.',
    field: 'teaching_preference',
    options: [
      {
        label: 'Keep it short',
        value: 'Keep explanations short and direct.',
        hint: 'Straight to the point, no follow-on',
      },
      {
        label: 'Go deep',
        value: 'Go into real depth; I would rather have too much than too little.',
        hint: 'The full picture, including where it leads next',
      },
      {
        label: 'Read the room',
        value: 'Match the depth to the question rather than a fixed length.',
        hint: 'Short for a quick check, long for something hard',
      },
    ],
  },
  {
    id: 'session',
    ask: 'How long is one of your study sessions?',
    aside: 'Used to size what gets suggested — never to nag you about it.',
    field: 'session_length_minutes',
    options: [
      { label: '15 minutes', value: '15', hint: 'Between other things' },
      { label: '30 minutes', value: '30', hint: 'A focused block' },
      { label: 'An hour', value: '60', hint: 'A proper sitting' },
      { label: 'Longer', value: '120', hint: 'You settle in' },
    ],
  },
  {
    id: 'anything',
    ask: 'Anything else about how you like to be taught?',
    aside: 'Skip it if nothing comes to mind — most people do, and that is fine.',
    field: 'teaching_preference',
    freeform: true,
    options: [],
  },
]

/**
 * Server-side limits, mirrored so the client can never send a rejected patch.
 *
 * These match `StudentModelIn` in `api/app/schemas/__init__.py`. The intake
 * sends every answer as ONE patch, so a single over-length field discards all
 * of them — which is exactly what happened when the multi-select was added
 * against a 60-character `learning_style` cap. `api/tests/test_intake_contract.py`
 * pins the same numbers from the other side.
 */
export const LEARNING_STYLE_MAX = 240
const TEACHING_PREFERENCE_MAX = 400

/** Room left for free text after the depth answer is prefixed to it. */
export const FREE_TEXT_MAX =
  TEACHING_PREFERENCE_MAX -
  Math.max(...(STEPS.find((s) => s.id === 'depth')?.options ?? []).map((o) => o.value.length)) -
  1
