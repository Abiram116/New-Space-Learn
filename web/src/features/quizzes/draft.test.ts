// @vitest-environment jsdom
/**
 * An unfinished quiz is kept for the tab, and only ever handed back to the
 * quiz it was written for.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { clearQuizDraft, loadQuizDraft, saveQuizDraft } from './draft'

const quiz = (id: string, questions = 3, choices = 4) => ({
  id,
  questions: Array.from({ length: questions }, (_, i) => ({
    q: `Q${i}`,
    choices: Array.from({ length: choices }, (_, c) => `c${c}`),
    answer_index: 0,
  })),
})

afterEach(() => sessionStorage.clear())

describe('quiz draft', () => {
  it('gives back what was saved for the same quiz', () => {
    saveQuizDraft('a', { index: 1, answers: [2, 0, -1], seconds: 41 })
    expect(loadQuizDraft(quiz('a'))).toEqual({ index: 1, answers: [2, 0, -1], seconds: 41 })
  })

  it('never restores into a different quiz', () => {
    saveQuizDraft('a', { index: 1, answers: [2, 0, -1], seconds: 41 })
    expect(loadQuizDraft(quiz('b'))).toBeNull()
    // Even if another quiz's draft ends up under this quiz's key.
    sessionStorage.setItem(
      'sl:quiz-draft:v1:b',
      JSON.stringify({ quizId: 'a', index: 0, answers: [1, 1, 1], seconds: 3 }),
    )
    expect(loadQuizDraft(quiz('b'))).toBeNull()
    expect(sessionStorage.getItem('sl:quiz-draft:v1:b')).toBeNull()
  })

  it('drops a draft that does not fit the quiz as it is now', () => {
    saveQuizDraft('a', { index: 0, answers: [1, 1], seconds: 0 }) // wrong length
    expect(loadQuizDraft(quiz('a'))).toBeNull()
    saveQuizDraft('a', { index: 0, answers: [9, -1, -1], seconds: 0 }) // no such option
    expect(loadQuizDraft(quiz('a'))).toBeNull()
    saveQuizDraft('a', { index: 0, answers: [-1, -1, -1], seconds: 9 }) // nothing answered
    expect(loadQuizDraft(quiz('a'))).toBeNull()
    sessionStorage.setItem('sl:quiz-draft:v1:a', '{not json')
    expect(loadQuizDraft(quiz('a'))).toBeNull()
  })

  it('keeps the position and the clock inside sane bounds', () => {
    saveQuizDraft('a', { index: 99, answers: [1, -1, -1], seconds: -5 })
    expect(loadQuizDraft(quiz('a'))).toEqual({ index: 2, answers: [1, -1, -1], seconds: 0 })
  })

  it('is gone once cleared', () => {
    saveQuizDraft('a', { index: 0, answers: [1, -1, -1], seconds: 2 })
    clearQuizDraft('a')
    expect(loadQuizDraft(quiz('a'))).toBeNull()
  })
})
