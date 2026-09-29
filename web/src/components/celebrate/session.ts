/**
 * The study moments that depend on more than the screen in front of you:
 * the daily card goal, the streak, a personal best.
 *
 * Today's count starts from the server's `cards_reviewed_today` (reviews on
 * any device) when the session opens, then ticks locally per grade (the same
 * thing the server counts: every grade, re-queued "Again" passes included). The goal is celebrated on the grade that crosses it, once per
 * day. The streak is compared against its value when the session opened and
 * celebrated only if it rose to a milestone, once per day.
 */

import { useEffect } from 'react'
import { getCachedStats } from '../../lib/briefCache'
import { celebrate, preloadCelebrations, type CelebrateOptions } from './celebrate'
import {
  crossedGoal,
  dayKey,
  isPersonalBest,
  localKV,
  onceToday,
  readJSON,
  scoreTier,
  streakMilestone,
  writeJSON,
} from './logic'

type Where = Omit<CelebrateOptions, 'facts'>

const CARDS_TODAY = 'sl:cards-today:v1'
const QUIZ_BEST = 'sl:quiz-best:v1'

let baseline: { streak: number; goal: number } | null = null
let streakPending = false

/** Call when a review or quiz opens: warms the effects chunk and reads where
 *  the streak and goal stood before this session touched them. */
export function useStudySession(): void {
  useEffect(() => {
    streakPending = false
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 400))
    idle(() => void preloadCelebrations().catch(() => {}))
    getCachedStats()
      .then((s) => {
        baseline = { streak: s.streak_days, goal: s.daily_goal }
        // Reviews from another device count too; never lower a local count.
        const day = dayKey()
        const server = s.cards_reviewed_today ?? 0
        if (server > cardsToday(day)) writeJSON(localKV(), CARDS_TODAY, { day, n: server })
      })
      .catch(() => {
        /* no stats, no goal/streak moments — the session itself is unaffected */
      })
  }, [])
}

/** Cards graded today on this device. */
export function cardsToday(day = dayKey()): number {
  const rec = readJSON<{ day: string; n: number }>(localKV(), CARDS_TODAY, { day, n: 0 })
  return rec.day === day ? rec.n : 0
}

/**
 * One grade. `saved` is the PATCH — the streak can only have moved once the
 * server has recorded the grade, so the first grade of a session checks the
 * streak after it lands.
 */
export function noteCardGraded(saved: Promise<unknown>, where: Where): void {
  const kv = localKV()
  const day = dayKey()
  const before = cardsToday(day)
  const after = before + 1
  writeJSON(kv, CARDS_TODAY, { day, n: after })

  if (baseline && crossedGoal(before, after, baseline.goal) && onceToday(kv, 'goal', day)) {
    celebrate('goal', { ...where, facts: { goal: baseline.goal, count: after } })
  }

  if (!streakPending) {
    streakPending = true
    saved.then(
      () => void checkStreak(where),
      () => {
        streakPending = false
      },
    )
  }
}

export async function checkStreak(where: Where): Promise<void> {
  const before = baseline
  if (!before) return
  const s = await getCachedStats().catch(() => null)
  if (!s) return
  baseline = { streak: s.streak_days, goal: s.daily_goal }
  const milestone = streakMilestone(before.streak, s.streak_days)
  if (milestone && onceToday(localKV(), 'streak')) {
    celebrate('streak', { ...where, facts: { streak: milestone } })
  }
}

/** Record a score; returns the best that stood before it (null on a first try). */
export function recordQuizScore(quizId: string, score: number): number | null {
  const kv = localKV()
  const bests = readJSON<Record<string, number>>(kv, QUIZ_BEST, {})
  const previous = typeof bests[quizId] === 'number' ? bests[quizId] : null
  if (previous == null || score > previous) {
    bests[quizId] = score
    // Bounded: the oldest entries go first (insertion order).
    const keys = Object.keys(bests)
    for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete bests[k]
    writeJSON(kv, QUIZ_BEST, bests)
  }
  return previous
}

/** The finish of a quiz: the tiered moment, then a personal best if it was one. */
export function celebrateQuiz(
  q: { quizId: string; score: number; right: number; total: number },
  where: Where,
): void {
  const previous = recordQuizScore(q.quizId, q.score)
  const best = isPersonalBest(previous, q.score)
  // A low score that still beat the last one is the better story to tell —
  // "you improved" rather than "keep going" — so it replaces the quiet line.
  if (!(best && scoreTier(q.score) === 'none')) {
    celebrate('quiz', { ...where, facts: { score: q.score, right: q.right, total: q.total } })
  }
  if (best) celebrate('best', { ...where, facts: { score: q.score, previous: previous ?? 0 } })
  void checkStreak(where)
}
