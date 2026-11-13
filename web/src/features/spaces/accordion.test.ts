import { describe, expect, it } from 'vitest'
import { accordionIn, isOpenIn } from './treeState'

const spaces = [
  { id: 'a', subspaces: [1] },
  { id: 'b', subspaces: [1, 2] },
  { id: 'empty', subspaces: [] },
]

describe('accordionIn', () => {
  it('opening a subject closes the others that have topics', () => {
    const map = accordionIn({}, 'b', spaces, 'a')
    expect(isOpenIn(map, 'b', spaces, 'a')).toBe(true)
    expect(isOpenIn(map, 'a', spaces, 'a')).toBe(false)
  })

  it('leaves a subject with no topics showing its Add topic row', () => {
    expect(isOpenIn(accordionIn({}, 'b', spaces, 'a'), 'empty', spaces, 'a')).toBe(true)
  })

  it('clicking an open subject closes it', () => {
    const map = accordionIn({}, 'a', spaces, 'a')
    expect(isOpenIn(map, 'a', spaces, 'a')).toBe(false)
  })
})
