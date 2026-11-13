/**
 * A quiz in progress, kept for this tab.
 *
 * Answers are only sent on "See results", so a reload mid-quiz (a refresh, a
 * phone browser dropping the page) used to throw every answer away. The
 * attempt is mirrored into `sessionStorage` as it goes and picked up again
 * when the same quiz is opened in the same tab. It is removed when the quiz
 * is submitted or left on purpose.
 *
 * A draft is only ever restored into the quiz it was written for: the key
 * carries the quiz id, the payload repeats it, and every answer is checked
 * against that quiz's own questions before any of it is used.
 */

import type { Quiz } from '../../api/types'

export type QuizDraft = {
  /** The question on screen. */
  index: number
  /** One per question: the chosen option, or -1 for not answered yet. */
  answers: number[]
  /** Seconds on the clock so far. */
  seconds: number
}

type Stored = QuizDraft & { quizId: string }

const key = (quizId: string) => `sl:quiz-draft:v1:${quizId}`

export function saveQuizDraft(quizId: string, draft: QuizDraft): void {
  try {
    const stored: Stored = { quizId, ...draft }
    sessionStorage.setItem(key(quizId), JSON.stringify(stored))
  } catch {
    /* storage full or unavailable: the quiz still works, it just won't survive a reload */
  }
}

/**
 * Drop a draft. Given a quiz id, both of its attempts go — the plain one and
 * a reworded one (`<id>~r`, see ./variant.ts) with its wording — since this
 * is what leaving or deleting a quiz calls. Given a `~r` key, only that one.
 */
export function clearQuizDraft(draftKey: string): void {
  const reworded = draftKey.endsWith('~r')
  const quizId = reworded ? draftKey.slice(0, -2) : draftKey
  try {
    sessionStorage.removeItem(key(draftKey))
    if (!reworded) sessionStorage.removeItem(key(`${quizId}~r`))
    sessionStorage.removeItem(`sl:quiz-variant:v1:${quizId}`)
  } catch {
    /* nothing to clear */
  }
}

/** Is there an attempt in progress under this key? */
export function hasQuizDraft(draftKey: string): boolean {
  try {
    return sessionStorage.getItem(key(draftKey)) !== null
  } catch {
    return false
  }
}

/**
 * The quiz just grew ("Add more questions" appends at the end): keep the
 * plain attempt in progress, with the new questions unanswered. A reworded
 * attempt can't grow — its wording was made for the old questions — so it
 * goes.
 */
export function growQuizDraft(quizId: string, total: number): void {
  try {
    sessionStorage.removeItem(key(`${quizId}~r`))
    sessionStorage.removeItem(`sl:quiz-variant:v1:${quizId}`)
    const raw = sessionStorage.getItem(key(quizId))
    if (!raw) return
    const stored = JSON.parse(raw) as Partial<Stored> | null
    if (!stored || !Array.isArray(stored.answers) || stored.answers.length >= total) return
    const answers = [...stored.answers, ...Array<number>(total - stored.answers.length).fill(-1)]
    sessionStorage.setItem(key(quizId), JSON.stringify({ ...stored, answers }))
  } catch {
    /* the attempt simply won't survive */
  }
}

/** The draft for this exact quiz, or null. Anything that does not fit is dropped.
 *  `draftKey` names which attempt: the quiz id, or a reworded attempt's key. */
export function loadQuizDraft(quiz: Pick<Quiz, 'id' | 'questions'>, draftKey: string = quiz.id): QuizDraft | null {
  let stored: Partial<Stored> | null = null
  try {
    const raw = sessionStorage.getItem(key(draftKey))
    if (!raw) return null
    stored = JSON.parse(raw) as Partial<Stored> | null
  } catch {
    return null
  }
  const total = quiz.questions.length
  const answers = stored?.answers
  const fits =
    stored?.quizId === draftKey &&
    Array.isArray(answers) &&
    answers.length === total &&
    answers.every(
      (a, i) => Number.isInteger(a) && a >= -1 && a < quiz.questions[i].choices.length,
    ) &&
    // Nothing answered is nothing to restore.
    answers.some((a) => a >= 0)
  if (!fits || !answers) {
    try {
      sessionStorage.removeItem(key(draftKey))
    } catch {
      /* nothing to clear */
    }
    return null
  }
  const index = Number.isInteger(stored?.index) ? (stored!.index as number) : 0
  const seconds = Number.isFinite(stored?.seconds) ? Math.floor(stored!.seconds as number) : 0
  return {
    answers,
    index: Math.min(Math.max(index, 0), total - 1),
    seconds: Math.min(Math.max(seconds, 0), 24 * 3600),
  }
}
