import { describe, expect, it } from 'vitest'
import {
  buildPatch,
  EMPTY_ANSWERS,
  EXAM_CONTEXT_MAX,
  firstName,
  LEARNING_STYLE_MAX,
  STEPS,
  TEACHING_PREFERENCE_MAX,
  type ChoiceStep,
} from './steps'

/**
 * The intake sends every answer as ONE patch, so a single over-length field
 * makes the server reject all of them. These pin the patch against the limits
 * mirrored from `StudentModelIn` using the real option values.
 */

const opts = (id: string) => (STEPS.find((s) => s.id === id) as ChoiceStep).options

describe('buildPatch', () => {
  it('sends nothing for a skipped intake', () => {
    expect(buildPatch(EMPTY_ANSWERS)).toEqual({})
    expect(buildPatch({ ...EMPTY_ANSWERS, goal: '   ' })).toEqual({})
  })

  it('fits every style picked at once under the server cap', () => {
    const all = opts('style').map((o) => o.value)
    const patch = buildPatch({ ...EMPTY_ANSWERS, styles: all })
    expect(patch.learning_style!.length).toBeLessThanOrEqual(LEARNING_STYLE_MAX)
    // Nothing lost to the cap.
    for (const v of all) expect(patch.learning_style).toContain(v)
  })

  it('joins styles in the options’ order, not the tapping order', () => {
    const [a, b] = opts('style').map((o) => o.value)
    expect(buildPatch({ ...EMPTY_ANSWERS, styles: [b, a] }).learning_style).toBe(`${a}; ${b}`)
  })

  it('fits every depth answer under the teaching-preference cap', () => {
    for (const o of opts('depth')) {
      expect(buildPatch({ ...EMPTY_ANSWERS, depth: o.value }).teaching_preference!.length).toBeLessThanOrEqual(
        TEACHING_PREFERENCE_MAX,
      )
    }
  })

  it('sends session length as a number inside the server range', () => {
    for (const o of opts('session')) {
      const m = buildPatch({ ...EMPTY_ANSWERS, session: o.value }).session_length_minutes!
      expect(typeof m).toBe('number')
      expect(m).toBeGreaterThanOrEqual(5)
      expect(m).toBeLessThanOrEqual(180)
    }
  })

  it('saves the goal as exam_context, trimmed and capped', () => {
    expect(buildPatch({ ...EMPTY_ANSWERS, goal: '  GATE 2027 ' }).exam_context).toBe('GATE 2027')
    expect(buildPatch({ ...EMPTY_ANSWERS, goal: 'x'.repeat(500) }).exam_context!.length).toBe(EXAM_CONTEXT_MAX)
  })

  it('never sends the name — that is the auth profile, not the student model', () => {
    expect(buildPatch({ ...EMPTY_ANSWERS, name: 'Abiram' })).toEqual({})
  })
})

describe('firstName', () => {
  it('greets by the first word, and by nothing when there is no name', () => {
    expect(firstName('  Sree Abiram ')).toBe('Sree')
    expect(firstName('')).toBe('')
  })
})
