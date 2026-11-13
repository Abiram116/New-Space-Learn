import { describe, expect, it } from 'vitest'
import { guessMode, modeStarter } from './studyMode'

describe('guessMode', () => {
  it.each([
    ['GATE CSE 2027', 'competitive'],
    ['Backend interview at a fintech', 'interview'],
    ['campus placement prep', 'interview'],
    ['Semester 5 end-sem', 'college'],
    ['understand transformers, just curious', 'curious'],
  ])('%s -> %s', (goal, mode) => expect(guessMode(goal)).toBe(mode))

  it('says nothing rather than guess', () => {
    for (const g of [null, undefined, '', '   ', 'stuff']) expect(guessMode(g)).toBeNull()
  })
  it('has an opening move for the exam-like modes only', () => {
    expect(modeStarter('interview')).toMatch(/Interview me/)
    expect(modeStarter('curious')).toBeNull()
  })
})
