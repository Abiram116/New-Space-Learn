/**
 * A reworded retake: the same quiz in new words and a new order.
 *
 * The server never stores it (see `rewordQuiz`). The attempt is scored
 * against the stored quiz, so every answer is mapped back before it is sent,
 * and the server's per-question verdicts are mapped forward again for the
 * results screen. That keeps the quiz's best score, its attempt count and the
 * student model about the same questions, however they were worded.
 *
 * The variant is kept for this tab beside the answer draft (./draft.ts), so a
 * reload mid-attempt comes back to the same wording rather than a fresh one
 * the saved answers no longer fit.
 */

import type { Quiz, QuizReword, QuizVariantQuestion } from '../../api/types'
import { localSwitch } from '../../lib/localSwitch'

/** Ask "same or reworded?" before each retake. Off: just do the preferred one. */
export const retakeAskSwitch = localSwitch('sl:quiz-retake-ask:v1', true)
/** The preferred retake: reworded (on) or exactly as before (off). */
export const retakeRewordSwitch = localSwitch('sl:quiz-retake-reword:v1', false)

/** The draft key of a reworded attempt — never the same as the plain one, so
 *  answers given to one wording are never restored into the other. */
export const variantDraftKey = (quizId: string) => `${quizId}~r`

const storeKey = (quizId: string) => `sl:quiz-variant:v1:${quizId}`

const isPermutation = (xs: unknown, n: number): xs is number[] =>
  Array.isArray(xs) &&
  xs.length === n &&
  new Set(xs).size === n &&
  xs.every((x) => Number.isInteger(x) && x >= 0 && x < n)

/** Does this variant fit this quiz, question for question and choice for choice? */
export function fitsQuiz(quiz: Pick<Quiz, 'id' | 'questions'>, reword: QuizReword): boolean {
  const qs = reword.questions
  if (reword.quiz_id !== quiz.id || !Array.isArray(qs) || qs.length !== quiz.questions.length) return false
  if (!isPermutation(qs.map((q) => q.original_index), qs.length)) return false
  return qs.every((v) => {
    const stored = quiz.questions[v.original_index]
    return (
      stored &&
      v.choices.length === stored.choices.length &&
      isPermutation(v.choice_order, stored.choices.length) &&
      v.choice_order[v.answer_index] === stored.answer_index
    )
  })
}

/** The quiz as the runner should show it: same id, the variant's questions. */
export const variantQuiz = (quiz: Quiz, reword: QuizReword): Quiz => ({
  ...quiz,
  questions: reword.questions,
})

/** Answers given to the variant, in the stored quiz's order and choice indexes. */
export function toStoredAnswers(questions: QuizVariantQuestion[], answers: number[]): number[] {
  const out = Array<number>(questions.length).fill(-1)
  questions.forEach((v, i) => {
    const a = answers[i]
    out[v.original_index] = a >= 0 && a < v.choice_order.length ? v.choice_order[a] : -1
  })
  return out
}

/** The server's verdicts (stored order) in the variant's order. */
export const toVariantCorrect = (questions: QuizVariantQuestion[], correct: boolean[]): boolean[] =>
  questions.map((v) => Boolean(correct[v.original_index]))

export function saveVariant(reword: QuizReword): void {
  try {
    sessionStorage.setItem(storeKey(reword.quiz_id), JSON.stringify(reword))
  } catch {
    /* storage unavailable: a reload starts the retake over, nothing worse */
  }
}

export function clearVariant(quizId: string): void {
  try {
    sessionStorage.removeItem(storeKey(quizId))
  } catch {
    /* nothing to clear */
  }
}

/** The variant kept for this quiz in this tab, if it still fits the quiz. */
export function loadVariant(quiz: Pick<Quiz, 'id' | 'questions'>): QuizReword | null {
  try {
    const raw = sessionStorage.getItem(storeKey(quiz.id))
    if (!raw) return null
    const reword = JSON.parse(raw) as QuizReword
    if (reword && fitsQuiz(quiz, reword)) return reword
  } catch {
    /* unreadable: dropped below */
  }
  clearVariant(quiz.id)
  return null
}

const STOP = new Set('a an the of to in on for and or is are with about quiz on'.split(' '))
const words = (s: string) =>
  new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)))

/**
 * A quiz in this topic that already covers what was just typed as a focus —
 * the same words, give or take order and filler. Only a typed focus is
 * compared: a blank one asks for "everything", and the server deliberately
 * draws each such quiz from parts of the material earlier ones used least,
 * so a second one is not a duplicate.
 */
export function findSimilarQuiz(quizzes: Quiz[] | null, topicId: string, focus: string): Quiz | null {
  const want = words(focus)
  if (!quizzes || want.size === 0) return null
  let best: { quiz: Quiz; score: number } | null = null
  for (const q of quizzes) {
    if (q.subspace_id !== topicId || !q.topic || q.questions.length === 0) continue
    const have = words(q.topic)
    const shared = [...want].filter((w) => have.has(w)).length
    const score = shared / new Set([...want, ...have]).size
    if (score >= 0.6 && (!best || score > best.score)) best = { quiz: q, score }
  }
  return best?.quiz ?? null
}
