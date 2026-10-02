/**
 * The intake: five questions, what each one stores, and the one patch they
 * become.
 *
 * Kept apart from the component so the fingerprint (`fingerprint.ts`) and the
 * save path are both checked against the *real* option values rather than a
 * copy of them — a test that hardcoded the strings would keep passing after
 * someone reworded a step, which is the failure it exists to catch.
 */

import type { StudentModelPatch } from '../../api/types'

export type Option = {
  /** What the student sees, and what is echoed back in the legend. */
  label: string
  /** What is stored. */
  value: string
  /** One line on what choosing this actually does. Shown under the option and,
   *  once chosen, beside the part of the fingerprint it drew. */
  hint: string
}

/** Everything the intake collects, as it is being collected. */
export type Answers = {
  name: string
  /** `learning_style` option values — several can be true at once. */
  styles: string[]
  depth: string | null
  session: string | null
  goal: string
}

export const EMPTY_ANSWERS: Answers = { name: '', styles: [], depth: null, session: null, goal: '' }

type Base = {
  id: 'name' | 'style' | 'depth' | 'session' | 'goal'
  /** The question, asked plainly. */
  ask: string
  /** A sentence lowering the stakes. Every one of these is recoverable. */
  aside: string
}

export type TextStep = Base & {
  kind: 'text'
  field: 'name' | 'goal'
  max: number
  placeholder: string
  autoComplete: string
}

export type ChoiceStep = Base & {
  kind: 'choice'
  field: 'styles' | 'depth' | 'session'
  options: Option[]
  /**
   * "What makes it click" is genuinely not one thing — an example *and* a
   * comparison is the honest answer for most people. Single-select stays the
   * default because most questions really do have one answer.
   */
  multi?: boolean
}

export type Step = TextStep | ChoiceStep

/**
 * Server-side limits, mirrored so the client can never send a rejected patch.
 *
 * These match `StudentModelIn` in `api/app/schemas/__init__.py`. The intake
 * sends every answer as ONE patch, so a single over-length field discards all
 * of them. `api/tests/test_intake_contract.py` pins the same numbers from the
 * other side. The name cap matches Profile's.
 */
export const LEARNING_STYLE_MAX = 240
export const TEACHING_PREFERENCE_MAX = 400
export const EXAM_CONTEXT_MAX = 140
export const NAME_MAX = 60

export const STEPS: Step[] = [
  {
    id: 'name',
    kind: 'text',
    field: 'name',
    ask: 'What should we call you?',
    aside: 'It’s how the app will greet you — and where your drawing starts.',
    max: NAME_MAX,
    placeholder: 'Your name',
    autoComplete: 'given-name',
  },
  {
    id: 'style',
    kind: 'choice',
    field: 'styles',
    ask: 'When something is new to you, what makes it click?',
    aside: 'Pick as many as fit — most people need more than one.',
    multi: true,
    options: [
      {
        label: 'A concrete example',
        value: 'examples first, then the general rule',
        hint: 'Answers start with a worked example',
      },
      {
        label: 'The idea behind it',
        value: 'the intuition first, then the detail',
        hint: 'Answers start with why it works',
      },
      {
        label: 'The exact definition',
        value: 'the precise definition first, then examples',
        hint: 'Answers start with the precise definition',
      },
      {
        label: 'Seeing it compared',
        value: 'comparisons against things I already know',
        hint: 'Answers compare it to something you already know',
      },
    ],
  },
  {
    id: 'depth',
    kind: 'choice',
    field: 'depth',
    ask: 'How deep should answers go?',
    aside: 'The one people change most. It’s a slider, not a vow.',
    options: [
      {
        label: 'Keep it short',
        value: 'Keep explanations short and direct.',
        hint: 'Just the answer, straight to the point',
      },
      {
        label: 'Go deep',
        value: 'Go into real depth; I would rather have too much than too little.',
        hint: 'The full explanation, step by step',
      },
      {
        label: 'Read the room',
        value: 'Match the depth to the question rather than a fixed length.',
        hint: 'Short for easy questions, detailed for hard ones',
      },
    ],
  },
  {
    id: 'session',
    kind: 'choice',
    field: 'session',
    ask: 'How long do you usually study in one go?',
    aside: 'So we suggest the right amount — never to nag you.',
    options: [
      { label: '15 minutes', value: '15', hint: 'Between other things' },
      { label: '30 minutes', value: '30', hint: 'A focused block' },
      { label: 'An hour', value: '60', hint: 'A proper sitting' },
      { label: 'Longer', value: '120', hint: 'You settle in' },
    ],
  },
  {
    /* Goals change on a fortnightly cycle where preferences do not, which is
       why this is last, optional, and one line — and why Settings keeps the
       same field. It earns its place because "GATE 2027" and "passing Calc II"
       should not be taught the same way, and it is the one answer the student
       can see steering the whole thing: the north star on the drawing. */
    id: 'goal',
    kind: 'text',
    field: 'goal',
    ask: 'What are you working towards?',
    aside: 'An exam, a course or a job. Optional, and easy to change later.',
    max: EXAM_CONTEXT_MAX,
    placeholder: 'e.g. GATE 2027, an AI internship, passing Calculus II',
    autoComplete: 'off',
  },
]

/** The first word of a name, for greetings. Empty when there is no name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/**
 * The answers as one `PATCH /me/student-model` body.
 *
 * Only answered fields are sent — a skipped question must not overwrite
 * anything. Several style values are joined into one sentence rather than
 * stored as a list: every consumer interpolates this into a prompt, and a JSON
 * array mid-sentence would read as a bug to the model. Joined in the options'
 * own order so the same picks always produce the same string.
 */
export function buildPatch(a: Answers): StudentModelPatch {
  const patch: StudentModelPatch = {}
  const style = STEPS.find((s): s is ChoiceStep => s.id === 'style')!
  const styles = style.options.filter((o) => a.styles.includes(o.value)).map((o) => o.value)
  if (styles.length) patch.learning_style = styles.join('; ').slice(0, LEARNING_STYLE_MAX)
  if (a.depth) patch.teaching_preference = a.depth.slice(0, TEACHING_PREFERENCE_MAX)
  if (a.session) patch.session_length_minutes = Number(a.session)
  const goal = a.goal.trim()
  if (goal) patch.exam_context = goal.slice(0, EXAM_CONTEXT_MAX)
  return patch
}
