/**
 * The ask policy.
 *
 * Worth testing precisely because its failures are silent: get it wrong in one
 * direction and the chips never appear, in the other and they appear under
 * every answer until the student stops seeing them. Neither throws, neither
 * shows up in a typecheck, and both destroy the feature.
 *
 * What these pin is a product rule rather than an implementation detail:
 * **asking must be caused by an event, never by a clock.** The first version
 * offered chips every fifth assistant turn, which interrupts a student who has
 * given the system nothing new to learn. The suite is written so that
 * reintroducing a turn-count trigger fails loudly.
 */

import { describe, expect, it } from 'vitest'
import type { Preference } from '../../api/feedback'
import {
  AFTER_FEEDBACK_GAP,
  CONTESTED_BELOW,
  LONG_ANSWER_CHARS,
  MIN_TURNS_BETWEEN_OFFERS,
  askReason,
  chipsFor,
  consecutiveConfusion,
  isContested,
  isSettled,
  readSignal,
  type AskInput,
} from './feedbackPolicy'

const pref = (over: Partial<Preference> = {}): Preference => ({
  key: 'explanation.length',
  value: 'concise',
  source: 'feedback',
  confidence: 0.9,
  evidence_count: 8,
  because: 'you said so',
  actionable: true,
  ...over,
})

/** A turn where nothing notable happened and nothing blocks an ask.
 * `consecutiveConfusion: 1` is "first occurrence" — the value every existing
 * `signal: 'confusion'` test below is implicitly relying on. */
const base = (over: Partial<AskInput> = {}): AskInput => ({
  chars: 200,
  signal: 'none',
  regenerations: 0,
  turnsSinceOffered: null,
  turnsSinceGiven: null,
  assistantTurns: 5,
  preferences: [],
  complete: true,
  consecutiveConfusion: 1,
  ...over,
})

describe('time alone never triggers an ask', () => {
  it('stays silent on an ordinary turn, however many have passed', () => {
    for (const assistantTurns of [2, 5, 10, 25, 100]) {
      expect(askReason(base({ assistantTurns }))).toBeNull()
    }
  })

  it('stays silent even long after the last offer', () => {
    expect(askReason(base({ turnsSinceOffered: 50 }))).toBeNull()
  })

  it('is the regression guard — no counter may become a trigger', () => {
    // If someone reintroduces "every N turns", this is the test that fails.
    const quiet = Array.from({ length: 40 }, (_, i) =>
      askReason(base({ assistantTurns: i + 2, turnsSinceOffered: i })),
    )
    expect(quiet.every((r) => r === null)).toBe(true)
  })
})

describe('events trigger an ask', () => {
  it('asks when the student is confused and gave no direction', () => {
    expect(askReason(base({ signal: 'confusion' }))).toBe('confusion')
  })

  it('does not ask a second time about the same unresolved confusion', () => {
    // First time: ask. Second time in a row, nothing else in between: the
    // first question already didn't get an answer — asking again gets the
    // same result. The backend still reads the repeat as evidence on its own.
    expect(askReason(base({ signal: 'confusion', consecutiveConfusion: 1 }))).toBe('confusion')
    expect(askReason(base({ signal: 'confusion', consecutiveConfusion: 2 }))).toBeNull()
    expect(askReason(base({ signal: 'confusion', consecutiveConfusion: 5 }))).toBeNull()
  })

  it('asks after a second consecutive regeneration, not the first', () => {
    expect(askReason(base({ signal: 'regenerated', regenerations: 1 }))).toBeNull()
    expect(askReason(base({ signal: 'regenerated', regenerations: 2 }))).toBe(
      'repeated_regenerate',
    )
  })

  it('asks when a dimension that matters here is contested', () => {
    const contested = pref({ confidence: 0.2, evidence_count: 3 })
    expect(askReason(base({ preferences: [contested] }))).toBe('contested')
  })
})

describe('a directed request is answered, not re-asked', () => {
  it('never asks after the student said which way to move', () => {
    // The strongest rule in the policy: "explain simpler" IS the feedback.
    expect(askReason(base({ signal: 'directed' }))).toBeNull()
  })

  it('outranks every trigger, including a contested dimension', () => {
    const contested = pref({ confidence: 0.1, evidence_count: 4 })
    expect(
      askReason(base({ signal: 'directed', preferences: [contested], regenerations: 5 })),
    ).toBeNull()
  })
})

describe('floors gate the triggers', () => {
  it('will not ask twice inside the offer gap, even on confusion', () => {
    expect(
      askReason(base({ signal: 'confusion', turnsSinceOffered: MIN_TURNS_BETWEEN_OFFERS - 1 })),
    ).toBeNull()
    expect(
      askReason(base({ signal: 'confusion', turnsSinceOffered: MIN_TURNS_BETWEEN_OFFERS })),
    ).toBe('confusion')
  })

  it('stays quiet for longer after the student actually gave feedback', () => {
    expect(
      askReason(base({ signal: 'confusion', turnsSinceGiven: AFTER_FEEDBACK_GAP - 1 })),
    ).toBeNull()
    expect(askReason(base({ signal: 'confusion', turnsSinceGiven: AFTER_FEEDBACK_GAP }))).toBe(
      'confusion',
    )
  })

  it('never interrupts a stream', () => {
    // Chips under a growing answer move as it grows, and a control that moves
    // under the cursor is one that gets mis-tapped.
    expect(askReason(base({ signal: 'confusion', complete: false }))).toBeNull()
  })

  it('never asks about the very first answer', () => {
    expect(askReason(base({ signal: 'confusion', assistantTurns: 1 }))).toBeNull()
  })
})

describe('readSignal', () => {
  it('reads a direction as directed, so nothing is asked', () => {
    for (const m of [
      'can you explain simpler',
      'give me more detail',
      'too long, be concise',
      'show me an example',
      'go deeper on that',
    ]) {
      expect(readSignal(m), m).toBe('directed')
    }
  })

  it('reads being stuck as confusion, which does warrant asking', () => {
    for (const m of ["i don't get it", 'I am lost', 'this makes no sense', "i'm confused"]) {
      expect(readSignal(m), m).toBe('confusion')
    }
  })

  it('treats an ordinary follow-up as nothing to act on', () => {
    expect(readSignal('what about the discount factor?')).toBe('none')
  })

  it('prefers direction over confusion when a message has both', () => {
    // "I don't get it, can you simplify" states the fix — no need to ask.
    expect(readSignal("i don't get it, can you simplify")).toBe('directed')
  })
})

describe('consecutiveConfusion', () => {
  it('is zero with no messages, or none of them confused', () => {
    expect(consecutiveConfusion([])).toBe(0)
    expect(consecutiveConfusion(['what about the discount factor?'])).toBe(0)
  })

  it('is one on a single confusion message', () => {
    expect(consecutiveConfusion(["i don't get it"])).toBe(1)
  })

  it('counts a genuine back-to-back run', () => {
    expect(consecutiveConfusion(["i don't get it", 'I am lost', 'this makes no sense'])).toBe(3)
  })

  it('resets on a directed message — they specified a fix', () => {
    expect(
      consecutiveConfusion(["i don't get it", 'can you simplify', "i don't get it"]),
    ).toBe(1)
  })

  it('resets on an ordinary turn — a ordinary follow-up moved on', () => {
    expect(
      consecutiveConfusion(['what about the discount factor?', "i don't get it"]),
    ).toBe(1)
  })

  it('only counts the run ending at the LAST message, not confusion anywhere', () => {
    // Confused twice, then asked an ordinary question — the run is over, even
    // though two confusion messages exist earlier in the conversation.
    expect(
      consecutiveConfusion(["i don't get it", 'I am lost', 'what about Bellman?']),
    ).toBe(0)
  })
})

describe('chipsFor — what gets offered', () => {
  it('offers nothing when there is no reason to ask', () => {
    expect(chipsFor(base())).toEqual([])
  })

  it('offers length and depth options under a long answer', () => {
    const chips = chipsFor(base({ signal: 'confusion', chars: LONG_ANSWER_CHARS }))
    expect(chips).toContain('too_long')
    expect(chips).toContain('too_complex')
  })

  it('does not offer "too long" under a short answer', () => {
    const chips = chipsFor(base({ signal: 'confusion', chars: 50 }))
    expect(chips).not.toContain('too_long')
    expect(chips).toContain('want_detail')
  })

  it('always ends with the positive option when it offers anything', () => {
    expect(chipsFor(base({ signal: 'confusion' })).at(-1)).toBe('useful')
  })

  it('drops settled dimensions but keeps the rest of the row', () => {
    const settled = pref({ key: 'explanation.length', confidence: 0.95 })
    const chips = chipsFor(base({ signal: 'confusion', chars: 50, preferences: [settled] }))
    expect(chips).not.toContain('want_detail')
    expect(chips).toContain('need_example')
  })

  it('offers nothing at all once every candidate is settled', () => {
    const all = [
      pref({ key: 'explanation.length', confidence: 0.9 }),
      pref({ key: 'explanation.opens_with', confidence: 0.9 }),
    ]
    expect(chipsFor(base({ signal: 'confusion', chars: 50, preferences: all }))).toEqual([])
  })
})

describe('isSettled and isContested are different questions', () => {
  it('unknown is neither settled nor contested', () => {
    expect(isSettled('too_long', [])).toBe(false)
    expect(isContested('too_long', [])).toBe(false)
  })

  it('confident is settled, not contested', () => {
    const p = [pref({ confidence: 0.9, evidence_count: 2 })]
    expect(isSettled('too_long', p)).toBe(true)
    expect(isContested('too_long', p)).toBe(false)
  })

  it('low confidence with evidence on both sides is contested', () => {
    const p = [pref({ confidence: CONTESTED_BELOW - 0.05, evidence_count: 3 })]
    expect(isContested('too_long', p)).toBe(true)
    expect(isSettled('too_long', p)).toBe(false)
  })

  it('low confidence with a single data point is early, not contested', () => {
    expect(isContested('too_long', [pref({ confidence: 0.1, evidence_count: 1 })])).toBe(false)
  })

  it('treats a chip with no dimension as never settled', () => {
    // `useful` carries no key; it must not be filtered out as "known".
    expect(isSettled('useful', [pref()])).toBe(false)
  })
})
