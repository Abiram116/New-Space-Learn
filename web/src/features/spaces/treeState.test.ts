import { describe, expect, it } from 'vitest'
import { isOpenIn, toggleIn, type TreeSpace } from './treeState'

/**
 * The rail needed two clicks to open a subject, and the reason is worth
 * stating precisely: the function that decided what to *draw* and the function
 * that decided what a click *does* each carried their own idea of the default,
 * and those ideas disagreed.
 *
 * A type checker cannot see that. Neither can a screenshot — the first click
 * genuinely changed state, it just changed it to what it already looked like.
 * So the property under test is the one a person actually experiences: **one
 * click flips what is on screen**, whatever the starting point.
 */

const SPACES: TreeSpace[] = [
  { id: 'with-topics', subspaces: [{}, {}] },
  { id: 'empty', subspaces: [] },
  { id: 'active', subspaces: [{}] },
]

describe('isOpenIn', () => {
  it('starts an untouched subject with topics closed', () => {
    // Otherwise the rail is every topic of every subject, all at once.
    expect(isOpenIn({}, 'with-topics', SPACES, null)).toBe(false)
  })

  it('starts an empty subject open', () => {
    // Its only useful state is "here is how to add a topic". A closed row
    // gives no hint anything is missing.
    expect(isOpenIn({}, 'empty', SPACES, null)).toBe(true)
  })

  it('starts the subject you are inside open', () => {
    expect(isOpenIn({}, 'active', SPACES, 'active')).toBe(true)
  })

  it('lets an explicit choice beat every default', () => {
    expect(isOpenIn({ empty: true }, 'empty', SPACES, null)).toBe(false)
    expect(isOpenIn({ active: true }, 'active', SPACES, 'active')).toBe(false)
    expect(isOpenIn({ 'with-topics': false }, 'with-topics', SPACES, null)).toBe(true)
  })
})

describe('toggleIn', () => {
  /** The regression, stated as the thing a person does. */
  it('opens an untouched subject in ONE click', () => {
    const after = toggleIn({}, 'with-topics', SPACES, null)
    expect(isOpenIn(after, 'with-topics', SPACES, null)).toBe(true)
  })

  it('closes an open subject in one click', () => {
    const after = toggleIn({}, 'empty', SPACES, null)
    expect(isOpenIn(after, 'empty', SPACES, null)).toBe(false)
  })

  it('closes the active subject in one click', () => {
    const after = toggleIn({}, 'active', SPACES, 'active')
    expect(isOpenIn(after, 'active', SPACES, 'active')).toBe(false)
  })

  it('flips on every click, from any starting point', () => {
    for (const id of ['with-topics', 'empty', 'active']) {
      let map = {}
      let expected = isOpenIn(map, id, SPACES, 'active')
      for (let click = 0; click < 5; click += 1) {
        map = toggleIn(map, id, SPACES, 'active')
        expected = !expected
        expect(isOpenIn(map, id, SPACES, 'active'), `${id} after ${click + 1} click(s)`).toBe(
          expected,
        )
      }
    }
  })

  it('leaves other subjects alone', () => {
    const after = toggleIn({ empty: true }, 'with-topics', SPACES, null)
    expect(after.empty).toBe(true)
  })
})
