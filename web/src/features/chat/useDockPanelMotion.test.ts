/**
 * Which animation each dock change gets.
 *
 * The dock has three transitions that mean three different things, and for a
 * while it played one animation for all of them. That is the kind of mistake a
 * type checker cannot see and a screenshot cannot show: every variant looks
 * plausible on its own, and the symptom is only that switching tabs *feels*
 * heavier than it is.
 *
 * So the semantics are asserted directly. The specific properties worth
 * holding: a switch must not disturb the shell, an exit must keep rendering
 * the panel that is leaving, and every animation must carry a backwards fill —
 * the missing `both` on enter and swap is what produced the reported blink.
 */

import { describe, expect, it } from 'vitest'
import { transitionFor } from './useDockPanelMotion'

describe('transitionFor', () => {
  it('does nothing when the panel has not changed', () => {
    expect(transitionFor(null, null)).toBeNull()
    expect(transitionFor('notes', 'notes')).toBeNull()
  })

  it('treats opening from the overview as going deeper', () => {
    const t = transitionFor(null, 'notes')!
    expect(t.kind).toBe('enter')
    expect(t.panel).toBe('notes')
    // The whole panel arrives, so the shell is what moves.
    expect(t.shellAnimation).toContain('dockIn')
    expect(t.bodyAnimation).toBe('')
  })

  it('treats sibling → sibling as lateral, leaving the shell alone', () => {
    const t = transitionFor('notes', 'quizzes')!
    expect(t.kind).toBe('switch')
    expect(t.panel).toBe('quizzes')
    // The header and scroll container are identical between siblings. Moving
    // them says "you went deeper again", which is the bug this encodes against.
    expect(t.shellAnimation).toBe('')
    expect(t.bodyAnimation).toContain('dockSwap')
  })

  it('keeps rendering the OUTGOING panel while it leaves', () => {
    const t = transitionFor('quizzes', null)!
    expect(t.kind).toBe('exit')
    // The panel being closed, not the one being opened — React would otherwise
    // remove the element on the same frame the state changed, and going back
    // would read as a dropped frame rather than a retreat.
    expect(t.panel).toBe('quizzes')
    expect(t.shellAnimation).toContain('dockOut')
  })

  it('gives every animation a backwards fill', () => {
    // Without one, the element paints at its natural state for a frame, then
    // snaps to `from { opacity: 0 }` and fades up — a visible blink on every
    // change. This is the regression that was reported.
    const animations = [
      transitionFor(null, 'notes')!.shellAnimation,
      transitionFor('notes', 'quizzes')!.bodyAnimation,
      transitionFor('quizzes', null)!.shellAnimation,
    ]
    for (const a of animations) expect(a).toContain('both')
  })

  it('uses the shared easing token, never a longhand curve', () => {
    const animations = [
      transitionFor(null, 'notes')!.shellAnimation,
      transitionFor('notes', 'quizzes')!.bodyAnimation,
      transitionFor('quizzes', null)!.shellAnimation,
    ]
    for (const a of animations) {
      expect(a).toContain('var(--ease-sl)')
      expect(a).not.toContain('cubic-bezier')
    }
  })

  it('writes class names as literals Tailwind can actually see', () => {
    // Tailwind emits utilities by scanning source for literal strings, so an
    // interpolated class produces one that never exists and an animation that
    // silently does nothing.
    const a = transitionFor(null, 'notes')!.shellAnimation
    expect(a).not.toContain('${')
    expect(a).toMatch(/animate-\[[a-zA-Z]+_\d+ms_/)
  })
})
