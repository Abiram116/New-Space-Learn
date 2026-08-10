/**
 * The ask policy.
 *
 * Worth testing precisely because its failures are silent: get it wrong in one
 * direction and the chips never appear, in the other and they appear under
 * every answer until the student stops seeing them. Neither throws, neither
 * shows up in a typecheck, and both destroy the feature.
 */

import { describe, expect, it } from 'vitest'
import type { Preference } from '../../api/feedback'
import {
  AFTER_FEEDBACK_GAP,
  CONFIDENT_ENOUGH,
  ENOUGH_EVIDENCE,
  LONG_ANSWER_CHARS,
  TURN_GAP,
  chipsFor,
  isSettled,
  shouldAsk,
} from './feedbackPolicy'

const base = {
  chars: LONG_ANSWER_CHARS + 100,
  assistantTurns: 10,
  lastOfferedAt: null,
  lastGivenAt: null,
  preferences: [] as Preference[],
  complete: true,
}

const pref = (over: Partial<Preference>): Preference => ({
  key: 'explanation.length',
  value: 'concise',
  source: 'feedback',
  confidence: 0.4,
  evidence_count: 2,
  because: 'x',
  actionable: true,
  ...over,
})

describe('shouldAsk', () => {
  it('never interrupts a stream', () => {
    // Chips under a growing answer move as it grows, and a control that moves
    // under the cursor is one that gets mis-tapped.
    expect(shouldAsk({ ...base, complete: false })).toBe(false)
  })

  it('stays quiet on the first answer', () => {
    // Nothing to compare against yet, so the opinion would be uncalibrated.
    expect(shouldAsk({ ...base, assistantTurns: 1 })).toBe(false)
  })

  it('leaves a gap between offers', () => {
    expect(shouldAsk({ ...base, lastOfferedAt: base.assistantTurns - 1 })).toBe(false)
    expect(shouldAsk({ ...base, lastOfferedAt: base.assistantTurns - TURN_GAP })).toBe(true)
  })

  it('goes quiet for longer after feedback is actually given', () => {
    // Evidence was just collected; asking again immediately spends attention
    // for something already known.
    expect(shouldAsk({ ...base, lastGivenAt: base.assistantTurns - 1 })).toBe(false)
    expect(
      shouldAsk({ ...base, assistantTurns: 30, lastGivenAt: 30 - AFTER_FEEDBACK_GAP }),
    ).toBe(true)
  })
})

describe('chipsFor', () => {
  it('offers length complaints only when there is length to complain about', () => {
    const long = chipsFor({ ...base, chars: LONG_ANSWER_CHARS + 1 })
    const short = chipsFor({ ...base, chars: 80 })
    expect(long).toContain('too_long')
    // Offering "too long" under a two-line answer is how a feedback UI teaches
    // people it isn't paying attention.
    expect(short).not.toContain('too_long')
    expect(short).toContain('want_detail')
  })

  it('always includes the positive option', () => {
    // A row of complaints with no way to say "that was good" collects a biased
    // sample and reads as an invitation to gripe.
    expect(chipsFor(base)).toContain('useful')
  })

  it('drops dimensions that are already settled', () => {
    const chips = chipsFor({
      ...base,
      preferences: [pref({ confidence: CONFIDENT_ENOUGH })],
    })
    expect(chips).not.toContain('too_long')
    // The rest of the row survives — one useful chip is still worth showing.
    expect(chips).toContain('too_complex')
  })

  it('stops asking entirely once every offered dimension is known', () => {
    // The anti-nag mechanism, and the reason a cooldown alone isn't enough:
    // this is what makes the asking fade out permanently rather than cycle.
    const chips = chipsFor({
      ...base,
      preferences: [
        pref({ key: 'explanation.length', confidence: 0.9 }),
        pref({ key: 'explanation.depth', confidence: 0.9 }),
        pref({ key: 'explanation.opens_with', confidence: 0.9 }),
      ],
    })
    expect(chips).toEqual([])
  })

  it('returns nothing when the policy says do not ask', () => {
    expect(chipsFor({ ...base, complete: false })).toEqual([])
  })
})

describe('isSettled', () => {
  it('counts either confidence or accumulated evidence', () => {
    expect(isSettled('too_long', [pref({ confidence: CONFIDENT_ENOUGH })])).toBe(true)
    expect(
      isSettled('too_long', [pref({ confidence: 0.1, evidence_count: ENOUGH_EVIDENCE })]),
    ).toBe(true)
    expect(isSettled('too_long', [pref({ confidence: 0.1, evidence_count: 1 })])).toBe(false)
  })

  it('treats an unknown dimension as unsettled', () => {
    // `useful` carries no dimension, so it can never be "already known".
    expect(isSettled('useful', [pref({ confidence: 0.99 })])).toBe(false)
  })
})
