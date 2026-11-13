// @vitest-environment jsdom
/**
 * A reworded retake is scored against the stored quiz: every answer maps back
 * to the stored question and choice, and a variant that doesn't fit the quiz
 * is never used. Also: the "you already have this quiz" match, and drafts
 * surviving a quiz that grew.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Quiz, QuizReword } from '../../api/types'
import { growQuizDraft, clearQuizDraft, hasQuizDraft, loadQuizDraft, saveQuizDraft } from './draft'
import {
  findSimilarQuiz,
  fitsQuiz,
  loadVariant,
  saveVariant,
  toStoredAnswers,
  toVariantCorrect,
  variantDraftKey,
} from './variant'

const quiz: Quiz = {
  id: 'q1',
  topic: 'Self-attention',
  created_at: '2026-10-01T00:00:00Z',
  subspace_id: 'sub-a',
  questions: [
    { q: 'What is Q?', choices: ['qa', 'qb', 'qc', 'qd'], answer_index: 0 },
    { q: 'What is K?', choices: ['ka', 'kb', 'kc', 'kd'], answer_index: 2 },
  ],
}

// Question order swapped; choices reshuffled with their order recorded.
const reword: QuizReword = {
  quiz_id: 'q1',
  reworded: 2,
  questions: [
    { q: 'K means?', choices: ['kc', 'ka', 'kd', 'kb'], answer_index: 0, original_index: 1, choice_order: [2, 0, 3, 1] },
    { q: 'Q means?', choices: ['qb', 'qa', 'qc', 'qd'], answer_index: 1, original_index: 0, choice_order: [1, 0, 2, 3] },
  ],
}

afterEach(() => sessionStorage.clear())

describe('a reworded retake', () => {
  it('maps answers back to the stored quiz, and verdicts forward', () => {
    // Right on the first shown (stored Q2, choice 2), wrong on the second (picked "qb").
    expect(toStoredAnswers(reword.questions, [0, 0])).toEqual([1, 2])
    expect(toStoredAnswers(reword.questions, [-1, 1])).toEqual([0, -1])
    expect(toVariantCorrect(reword.questions, [false, true])).toEqual([true, false])
  })

  it('only fits the quiz it was made for', () => {
    expect(fitsQuiz(quiz, reword)).toBe(true)
    expect(fitsQuiz({ ...quiz, id: 'other' }, reword)).toBe(false)
    expect(fitsQuiz({ ...quiz, questions: [...quiz.questions, quiz.questions[0]] }, reword)).toBe(false)
    const wrongAnswer = { ...reword, questions: [{ ...reword.questions[0], answer_index: 1 }, reword.questions[1]] }
    expect(fitsQuiz(quiz, wrongAnswer)).toBe(false)
  })

  it('is kept for the tab, and dropped when the quiz no longer matches it', () => {
    saveVariant(reword)
    expect(loadVariant(quiz)).toEqual(reword)
    expect(loadVariant({ ...quiz, questions: quiz.questions.slice(0, 1) })).toBeNull()
    expect(loadVariant(quiz)).toBeNull() // and it was cleared
  })
})

describe('drafts of the two kinds of attempt', () => {
  it('never restores plain answers into a reworded attempt', () => {
    saveQuizDraft('q1', { index: 1, answers: [2, -1], seconds: 5 })
    expect(loadQuizDraft(quiz, variantDraftKey('q1'))).toBeNull()
    expect(loadQuizDraft(quiz)?.answers).toEqual([2, -1])
  })

  it('leaving a quiz drops both attempts and the wording', () => {
    saveQuizDraft('q1', { index: 0, answers: [1, -1], seconds: 1 })
    saveQuizDraft(variantDraftKey('q1'), { index: 0, answers: [1, -1], seconds: 1 })
    saveVariant(reword)
    clearQuizDraft('q1')
    expect(hasQuizDraft('q1') || hasQuizDraft(variantDraftKey('q1'))).toBe(false)
    expect(loadVariant(quiz)).toBeNull()
  })

  it('an attempt in progress survives questions being added', () => {
    saveQuizDraft('q1', { index: 1, answers: [1, 3], seconds: 9 })
    saveQuizDraft(variantDraftKey('q1'), { index: 0, answers: [1, -1], seconds: 1 })
    growQuizDraft('q1', 4)
    const grown = { ...quiz, questions: [...quiz.questions, ...quiz.questions] }
    expect(loadQuizDraft(grown)?.answers).toEqual([1, 3, -1, -1])
    expect(hasQuizDraft(variantDraftKey('q1'))).toBe(false)
  })
})

describe('the "you already have this quiz" match', () => {
  const list = [quiz, { ...quiz, id: 'q2', topic: 'Positional encoding', subspace_id: 'sub-b' }]
  it('matches the same focus in the same topic, give or take filler', () => {
    expect(findSimilarQuiz(list, 'sub-a', 'self attention')?.id).toBe('q1')
    expect(findSimilarQuiz(list, 'sub-a', 'Quiz on the self-attention')?.id).toBe('q1')
  })
  it("doesn't match another topic, another focus, or a blank one", () => {
    expect(findSimilarQuiz(list, 'sub-b', 'self attention')).toBeNull()
    expect(findSimilarQuiz(list, 'sub-a', 'multi-head attention masks')).toBeNull()
    expect(findSimilarQuiz(list, 'sub-a', '')).toBeNull()
    expect(findSimilarQuiz(null, 'sub-a', 'self attention')).toBeNull()
  })
})
