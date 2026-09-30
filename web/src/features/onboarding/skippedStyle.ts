/**
 * The two intake questions a phone leaves out, and when to offer them back.
 *
 * Learning style and depth only shape the chat tutor, which lives on desktop,
 * so the phone intake skips them and records that it did
 * (`intake_skipped_style`). Desktop then offers exactly the questions that are
 * still unanswered — never one already answered on another device — and the
 * marker is cleared the moment they are answered or the offer is dismissed.
 */

import type { StudentModel, StudentModelPatch } from '../../api/types'
import { buildPatch, EMPTY_ANSWERS, type Answers } from './steps'

export type SkippedQuestion = 'style' | 'depth'

/** Which of the two questions are still open. Empty when there's nothing to ask. */
export function pendingStyleQuestions(model: StudentModel | null | undefined): SkippedQuestion[] {
  if (!model?.intake_skipped_style) return []
  const out: SkippedQuestion[] = []
  if (!model.learning_style?.trim()) out.push('style')
  if (!model.teaching_preference?.trim()) out.push('depth')
  return out
}

/** Show the "Tell me how you like to learn" offer? */
export function shouldOfferStyle(model: StudentModel | null | undefined): boolean {
  return pendingStyleQuestions(model).length > 0
}

/**
 * The phone intake's patch: the three phone answers, plus the marker. Built on
 * `buildPatch` so the limits and joining rules are the desktop intake's own.
 */
export function buildPhonePatch(a: Pick<Answers, 'name' | 'session' | 'goal'>): StudentModelPatch {
  return {
    ...buildPatch({ ...EMPTY_ANSWERS, name: a.name, session: a.session, goal: a.goal }),
    intake_skipped_style: true,
  }
}

/**
 * The desktop follow-up's patch. Always clears the marker — answering is the
 * point of it, and a partial answer still means the offer has been seen.
 */
export function buildStylePatch(a: Pick<Answers, 'styles' | 'depth'>): StudentModelPatch {
  return {
    ...buildPatch({ ...EMPTY_ANSWERS, styles: a.styles, depth: a.depth }),
    intake_skipped_style: false,
  }
}

/** Dismissing the offer: stop asking, on every device. */
export const DISMISS_STYLE_PATCH: StudentModelPatch = { intake_skipped_style: false }

/** Cache key the student model is mirrored under (shared with Profile). */
export const STUDENT_MODEL_KEY = 'student-model'
