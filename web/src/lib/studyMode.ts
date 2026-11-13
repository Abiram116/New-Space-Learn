/**
 * What the student is studying for. The server holds the real instructions
 * (`api/app/services/study_mode.py`); this is only how each is named and
 * offered. The `value`s are the closed set the API accepts.
 */
import type { IconName } from '../components/ui/Icon'

export type StudyMode = 'college' | 'competitive' | 'interview' | 'curious'

export const STUDY_MODES: {
  value: StudyMode
  label: string
  hint: string
  icon: IconName
  /** Placeholder for the "working towards" field. */
  goal: string
  /** What the date on the calendar is, in this mode. */
  event: string
}[] = [
  { value: 'college', label: 'College exam', hint: 'Marks, definitions, likely questions.', icon: 'book', goal: 'e.g. Semester 5 end-sem', event: 'exam' },
  { value: 'competitive', label: 'GATE or similar', hint: 'Speed, shortcuts, the traps in MCQs.', icon: 'bolt', goal: 'e.g. GATE CSE 2027', event: 'exam' },
  { value: 'interview', label: 'Interview prep', hint: 'Answers you can say aloud, plus follow-ups.', icon: 'target', goal: 'e.g. Backend role at a fintech', event: 'interview' },
  { value: 'curious', label: 'Just learning', hint: 'Intuition and why, no exam angle.', icon: 'sparkle', goal: 'e.g. Understand how transformers work', event: 'goal' },
]

export const modeInfo = (m: string | null | undefined) => STUDY_MODES.find((x) => x.value === m)

/** The first thing worth saying in each mode — the one a general chatbot never offers. */
export function modeStarter(mode: string | null | undefined): string | null {
  switch (mode) {
    case 'interview':
      return 'Interview me on this, one question at a time'
    case 'competitive':
      return 'Give me one exam-style question on this'
    case 'college':
      return 'What is most likely to be asked on this?'
    default:
      return null
  }
}

/**
 * A best guess at the mode from the goal they typed at sign-up ("GATE CSE 2027",
 * "Backend interview at Razorpay"), so asking again is one tap on a suggestion
 * instead of a fresh question. Only ever a suggestion: the student confirms.
 */
export function guessMode(goal: string | null | undefined): StudyMode | null {
  const g = (goal ?? '').toLowerCase()
  if (!g.trim()) return null
  if (/\b(interview|placement|hiring|job|recruit|onsite|screening)\b/.test(g)) return 'interview'
  if (/\b(gate|jee|neet|cat|gre|gmat|upsc|ies|net|nta|cuet|ssc|ielts|toefl)\b/.test(g)) return 'competitive'
  if (/\b(sem|semester|end-?sem|mid-?sem|exam|finals?|university|college|viva|internals?)\b/.test(g)) return 'college'
  if (/\b(curious|for fun|interest|hobby|project)\b/.test(g)) return 'curious'
  return null
}
