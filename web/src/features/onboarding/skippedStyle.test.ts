import { describe, expect, it } from 'vitest'
import type { StudentModel } from '../../api/types'
import {
  buildPhonePatch,
  buildStylePatch,
  DISMISS_STYLE_PATCH,
  pendingStyleQuestions,
  shouldOfferStyle,
} from './skippedStyle'
import { STEPS, type ChoiceStep } from './steps'

function model(over: Partial<StudentModel> = {}): StudentModel {
  return {
    learning_style: null,
    session_length_minutes: 15,
    exam_context: null,
    teaching_preference: null,
    weak_areas: [],
    strong_areas: [],
    streak_days: 0,
    falling_areas: [],
    cold_areas: [],
    observed_habits: [],
    ...over,
  }
}

const style = STEPS.find((s): s is ChoiceStep => s.id === 'style')!
const depth = STEPS.find((s): s is ChoiceStep => s.id === 'depth')!

describe('the phone intake patch', () => {
  it('records the skip alongside the three phone answers', () => {
    expect(buildPhonePatch({ name: 'Asha', session: '15', goal: '  Biology finals ' })).toEqual({
      session_length_minutes: 15,
      exam_context: 'Biology finals',
      intake_skipped_style: true,
    })
  })

  it('never sends style or depth, and leaves a blank goal out', () => {
    const p = buildPhonePatch({ name: '', session: '30', goal: '' })
    expect(p).not.toHaveProperty('learning_style')
    expect(p).not.toHaveProperty('teaching_preference')
    expect(p).not.toHaveProperty('exam_context')
    expect(p.session_length_minutes).toBe(30)
  })
})

describe('offering the skipped questions on desktop', () => {
  it('offers both when the phone skipped them and nothing is answered', () => {
    expect(pendingStyleQuestions(model({ intake_skipped_style: true }))).toEqual(['style', 'depth'])
  })

  it('never re-asks what was answered on another device', () => {
    expect(
      pendingStyleQuestions(model({ intake_skipped_style: true, learning_style: 'examples first, then the general rule' })),
    ).toEqual(['depth'])
    expect(
      shouldOfferStyle(
        model({ intake_skipped_style: true, learning_style: 'x', teaching_preference: 'y' }),
      ),
    ).toBe(false)
  })

  it('offers nothing to someone who did the full intake, or to an old payload', () => {
    expect(shouldOfferStyle(model())).toBe(false)
    expect(shouldOfferStyle(model({ intake_skipped_style: false }))).toBe(false)
    expect(shouldOfferStyle(null)).toBe(false)
  })
})

describe('answering or dismissing', () => {
  it('answering stores the intake’s own strings and clears the marker', () => {
    const p = buildStylePatch({ styles: [style.options[1].value, style.options[0].value], depth: depth.options[0].value })
    // Joined in the options' order, exactly like the desktop intake.
    expect(p.learning_style).toBe(`${style.options[0].value}; ${style.options[1].value}`)
    expect(p.teaching_preference).toBe(depth.options[0].value)
    expect(p.intake_skipped_style).toBe(false)
  })

  it('a partial answer still clears the marker', () => {
    expect(buildStylePatch({ styles: [], depth: depth.options[2].value })).toEqual({
      teaching_preference: depth.options[2].value,
      intake_skipped_style: false,
    })
  })

  it('dismissing only clears the marker', () => {
    expect(DISMISS_STYLE_PATCH).toEqual({ intake_skipped_style: false })
  })
})
