import { describe, expect, it } from 'vitest'
import { buildPatch, EMPTY_ANSWERS } from '../onboarding/steps'
import { composeStyles, DEPTH, depthChoice, parseStyles, SESSION_MINUTES, STYLE } from './learning'

const [example, idea, , compared] = STYLE.options.map((o) => o.value)

describe('learning choices ⇄ what is stored', () => {
  it('reads back exactly what onboarding saved', () => {
    const saved = buildPatch({ ...EMPTY_ANSWERS, styles: [compared, example], depth: DEPTH.options[1].value })
    expect(parseStyles(saved.learning_style)).toEqual({ picked: [example, compared], own: '' })
    expect(depthChoice(saved.teaching_preference)).toBe(DEPTH.options[1].value)
  })

  it('keeps words the student wrote themselves, beside the choices', () => {
    expect(parseStyles(`${idea}; lots of diagrams; slowly`)).toEqual({ picked: [idea], own: 'lots of diagrams; slowly' })
    expect(parseStyles('visual, worked examples')).toEqual({ picked: [], own: 'visual, worked examples' })
    expect(parseStyles(null)).toEqual({ picked: [], own: '' })
  })

  it('writes choices in a fixed order, then their words, and null when empty', () => {
    expect(composeStyles([compared, example], '  diagrams ')).toBe(`${example}; ${compared}; diagrams`)
    expect(composeStyles([], '   ')).toBeNull()
    const { picked, own } = parseStyles(composeStyles([idea], 'diagrams'))
    expect([picked, own]).toEqual([[idea], 'diagrams'])
  })

  it('treats a depth nobody offered as their own words', () => {
    expect(depthChoice('Explain like I am five.')).toBeNull()
    expect(depthChoice('')).toBeNull()
  })

  it('offers the same session lengths as onboarding', () => {
    expect(SESSION_MINUTES).toEqual([15, 30, 60, 120])
  })
})
