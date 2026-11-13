import { describe, expect, it } from 'vitest'
import { NAME_HINT, nameHint, SHORT_NAME_HINT } from './nameHint'

describe('nameHint', () => {
  it.each(['blah', 'Test', 'asdfjkl', 'untitled', 'New topic', 'aaaa', '123', 'qwerty', 'bcdfgh', '???'])(
    'asks for a real name instead of "%s"',
    (n) => expect(nameHint(n)).toBe(NAME_HINT),
  )

  it.each(['dk', 'C', 'R'])('says very short names are ambiguous: "%s"', (n) => expect(nameHint(n)).toBe(SHORT_NAME_HINT))

  it.each(['Binary Trees', 'Deep Reinforcement Learning', 'CNNs', 'Lisp', 'Integration', 'Python', 'NLP', 'DBMS', 'C programming', 'Épistémologie'])(
    'leaves a real name alone: "%s"',
    (n) => expect(nameHint(n)).toBeNull(),
  )

  it('says nothing about an empty field', () => {
    expect(nameHint('')).toBeNull()
    expect(nameHint('   ')).toBeNull()
  })
})
