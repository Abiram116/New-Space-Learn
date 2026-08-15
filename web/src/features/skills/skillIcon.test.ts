/**
 * `resolveSkillIcon`'s job is to never silently render the wrong icon for a
 * skill that has a perfectly good one on file.
 *
 * One of the seeded library skills tripped exactly this: Paper Explainer
 * stored '📄', which had no entry in `EMOJI_TO_ICON` — it fell through to
 * the generic 'skill' fallback, the same icon Socratic Tutor uses, so two
 * library cards were visually indistinguishable. Fixed at the data layer
 * (the skills migration now stores a real `IconName`), but this pins the
 * resolver's own contract so a future skill added with an unmapped emoji
 * fails the same way, loudly, rather than silently rendering the wrong
 * glyph forever.
 */

import { describe, expect, it } from 'vitest'
import { resolveSkillIcon } from './skillIcon'

describe('resolveSkillIcon', () => {
  it('passes a known IconName straight through', () => {
    expect(resolveSkillIcon('target')).toBe('target')
    expect(resolveSkillIcon('quiz')).toBe('quiz')
  })

  it('maps a mapped legacy emoji to its icon', () => {
    expect(resolveSkillIcon('🧠')).toBe('skill')
    expect(resolveSkillIcon('🎯')).toBe('target')
  })

  it('falls back to skill for an empty or missing value', () => {
    expect(resolveSkillIcon(null)).toBe('skill')
    expect(resolveSkillIcon(undefined)).toBe('skill')
    expect(resolveSkillIcon('')).toBe('skill')
  })

  it('falls back to skill for an unrecognised emoji, rather than throwing', () => {
    expect(resolveSkillIcon('🦖')).toBe('skill')
  })

  it('recognises the icons the new library skills actually use', () => {
    // Regression for the KNOWN allow-list itself: 'thumbDown' and 'check' are
    // real, rendered IconNames (Mistake Analyst, Code Review Mentor) that
    // were previously excluded from KNOWN for no functional reason, which
    // would have made both fall back to the generic icon exactly like Cite
    // Everything and Paper Explainer did.
    expect(resolveSkillIcon('thumbDown')).toBe('thumbDown')
    expect(resolveSkillIcon('check')).toBe('check')
  })
})
