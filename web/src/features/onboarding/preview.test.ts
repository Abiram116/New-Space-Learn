import { describe, expect, it } from 'vitest'
import { composeSample, sessionShape } from './preview'
import { STEPS } from './steps'

/**
 * The preview's whole job is to be *faithful* — it claims "this is what your
 * choice did". A lookup that silently misses would show the student a sample
 * unrelated to what they picked, which is worse than showing nothing: it is a
 * quiet lie about the product's behaviour.
 *
 * So these tests pin the keys against the option values the intake actually
 * stores. If someone edits a `value` in STEPS without editing the map here,
 * that is the failure this catches.
 */

/**
 * Read from the intake itself, never copied.
 *
 * An earlier version of this file hardcoded the option strings, which meant it
 * would keep passing after someone reworded a step — leaving the preview
 * silently falling back to a default that no longer matched the choice the
 * student had just made. Sourcing them here is the whole point of the test.
 */
const valuesOf = (id: string) =>
  STEPS.find((s) => s.id === id)!.options.map((o) => o.value)

const STYLE_VALUES = valuesOf('style')
const DEPTH_VALUES = valuesOf('depth')

describe('composeSample', () => {
  it('has a distinct opening for every learning style the intake offers', () => {
    const openings = STYLE_VALUES.map((v) => composeSample(v, undefined).paragraphs[0])
    expect(new Set(openings).size).toBe(STYLE_VALUES.length)
    for (const o of openings) expect(o.length).toBeGreaterThan(20)
  })

  it('joins a multi-select into one sample rather than dropping all but one', () => {
    const both = composeSample(`${STYLE_VALUES[0]}; ${STYLE_VALUES[3]}`, undefined)
    // Multi-select is the first question's whole point; showing only the first
    // pick would quietly contradict "pick as many as fit".
    expect(both.paragraphs).toHaveLength(2)
  })

  it('never renders empty, even before anything is chosen', () => {
    const { paragraphs } = composeSample(undefined, undefined)
    expect(paragraphs.length).toBeGreaterThan(0)
    expect(paragraphs[0]).toBeTruthy()
  })

  it('ignores an unknown style instead of rendering a blank paragraph', () => {
    const { paragraphs } = composeSample('something nobody stores', undefined)
    expect(paragraphs.every((p) => p.length > 0)).toBe(true)
  })

  it('adds a tail for the depths that have one, and none for "keep it short"', () => {
    expect(composeSample(STYLE_VALUES[1], DEPTH_VALUES[0]).paragraphs).toHaveLength(1)
    expect(composeSample(STYLE_VALUES[1], DEPTH_VALUES[1]).paragraphs).toHaveLength(2)
    expect(composeSample(STYLE_VALUES[1], DEPTH_VALUES[2]).paragraphs).toHaveLength(2)
  })
})

describe('sessionShape', () => {
  it('describes every session length the intake offers', () => {
    for (const m of valuesOf('session')) {
      expect(sessionShape(m)).toBeTruthy()
    }
  })

  it('says nothing rather than guessing when unanswered', () => {
    expect(sessionShape(undefined)).toBeNull()
    expect(sessionShape('45')).toBeNull()
  })
})
