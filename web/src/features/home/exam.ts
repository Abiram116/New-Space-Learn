/**
 * The exam countdown on Home — what a student with a date actually needs.
 *
 * Someone with an exam in nine days does not want a dashboard, they want to be
 * told what today is for. This turns the date they gave (Settings › Learning)
 * plus what the app already knows — cards due, topics fading — into a plan of
 * a sentence on what today is for. The actions themselves live in "Up next", one section below, so
 * this says the plan and does not repeat the buttons. Pure arithmetic over data already on the page: no model
 * call, so it costs nothing and never invents a number.
 */

import type { Fading, TopicIndex } from './week'

/** A countdown further out than this is just noise on the page. */
export const SHOW_WITHIN_DAYS = 60

export type ExamPlan = {
  days: number
  /** Big text: "9 days", "Tomorrow", "Today". */
  when: string
  /** What the exam is, in the student's words, else "Your exam". */
  title: string
  /** One sentence on what today is for. */
  line: string
  /** Close enough that the page should read as urgent. */
  urgent: boolean
}

/** Whole days from `today` to a `YYYY-MM-DD` date, in the student's own calendar. */
export function daysUntil(examDate: string | null | undefined, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(examDate ?? '')
  if (!m) return null
  const exam = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(exam.getTime()) || exam.getMonth() !== Number(m[2]) - 1) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((exam.getTime() - start.getTime()) / 86_400_000)
}

export function examPlan(input: {
  examDate: string | null | undefined
  goal: string | null | undefined
  due: number
  fading: Fading[]
  /** The student's study mode, so "Your exam" can be "Your interview". */
  event?: string
  today?: Date
}): ExamPlan | null {
  const days = daysUntil(input.examDate, input.today)
  if (days === null || days < 0 || days > SHOW_WITHIN_DAYS) return null

  const due = Math.max(0, input.due)
  const perDay = Math.ceil(due / Math.max(days, 1))
  const noun = input.event === 'interview' ? 'interview' : input.event === 'goal' ? 'goal' : 'exam'
  let line: string
  if (days === 0) line = due > 0 ? `${due} card${due === 1 ? ' is' : 's are'} due. Do them first, then the weakest topic.` : 'Nothing is due. Skim your weakest topic once and rest.'
  else if (due > 0 && days > 1) line = `${due} cards are due: about ${perDay} a day gets them done before the ${noun}.`
  else if (due > 0) line = `${due} card${due === 1 ? ' is' : 's are'} due. Clear them today.`
  else if (input.fading.length > 0) line = 'Cards are clear. Spend today on what is slipping.'
  else line = 'Nothing is due or slipping. Keep a short daily review going.'

  return {
    days,
    when: days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`,
    title: (input.goal ?? '').trim() || (input.event === 'interview' ? 'Your interview' : input.event === 'goal' ? 'Your goal' : 'Your exam'),
    line,
    urgent: days <= 3,
  }
}

// ── Readiness ──────────────────────────────────────────────────────────

export type Readiness = {
  /** 0–100, the mean over the topics that have anything measured. */
  pct: number
  /** Topics with at least one signal, of all topics. Said out loud next to the number. */
  known: number
  total: number
  /** The measured topic with the lowest score, with where to go to work on it. */
  weakest: { name: string; pct: number; to: string } | null
}

/**
 * "How ready am I?" as one number, from what the student has actually done.
 *
 * Per topic it is the mean of what is measured: the lowest best quiz score
 * (pessimistic on purpose: the quiz you have not mastered is the one that
 * matters) and the share of its cards marked known. A topic with neither is
 * left out and counted as unmeasured, never scored zero, so the number can
 * only be as confident as the data under it. Pure arithmetic on data already
 * on the page; no model call, nothing invented.
 */
export function readiness(index: TopicIndex): Readiness | null {
  const scored: { name: string; pct: number; to: string }[] = []
  for (const t of index.values()) {
    const parts: number[] = []
    if (t.quiz?.best_score != null) parts.push(t.quiz.best_score)
    if (t.deck && t.deck.total > 0) parts.push(t.deck.known_pct)
    if (parts.length === 0) continue
    const pct = parts.reduce((a, b) => a + b, 0) / parts.length
    scored.push({ name: t.subspace.name, pct: Math.round(pct), to: t.link })
  }
  if (scored.length === 0) return null
  const pct = Math.round(scored.reduce((a, b) => a + b.pct, 0) / scored.length)
  const weakest = scored.reduce((a, b) => (b.pct < a.pct ? b : a))
  // "of N" counts topics that have something in them. An empty topic cannot be
  // measured and is not the student's fault, so it should not make the number
  // look under-evidenced ("3 of 10" when 7 of the 10 are empty shells).
  const withMaterial = [...index.values()].filter((t) => {
    const c = t.subspace.counts ?? {}
    return (c.docs ?? 0) + (c.cards ?? 0) + (c.quizzes ?? 0) > 0
  }).length
  return { pct: Math.max(0, Math.min(100, pct)), known: scored.length, total: Math.max(scored.length, withMaterial), weakest }
}
