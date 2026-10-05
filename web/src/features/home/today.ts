/**
 * The decisions behind the phone's Today screen, as pure functions.
 *
 * Kept out of the component so each rule can be tested on its own and read in
 * one place: how long a review will take, how a pile of overdue cards is cut
 * into something a person will actually start, which single action leads the
 * screen, and where a suggestion that points at chat goes on a phone (which
 * has no chat).
 */

import type { BriefSuggestion, HeatmapCell, Note, Quiz, Space, Stats, Subspace } from '../../api/types'
import { subspacePath } from '../../lib/nav'
// Workstream A's mapping — the one place a chat-bound route is rewritten for
// a phone. Re-exported so Today's callers and tests use the same rule.
import { phoneRoute } from '../mobile/phoneRoute'

export { phoneRoute }

// ── Time ───────────────────────────────────────────────────────────────

/** A card graded at a normal pace: read, recall, flip, grade. */
export const DEFAULT_SECONDS_PER_CARD = 20

/**
 * Minutes a review of `count` cards will take, rounded, never under one.
 *
 * `secondsPerCard` is the student's own pace when one is known; anything
 * non-finite or implausible (a stale cache, a divide-by-zero upstream) falls
 * back to the default rather than promising "~0 min" or "~400 min".
 */
export function estimateReviewMinutes(count: number, secondsPerCard?: number | null): number {
  if (!Number.isFinite(count) || count <= 0) return 0
  const pace =
    secondsPerCard != null && Number.isFinite(secondsPerCard) && secondsPerCard >= 3 && secondsPerCard <= 180
      ? secondsPerCard
      : DEFAULT_SECONDS_PER_CARD
  return Math.max(1, Math.round((count * pace) / 60))
}

// ── Coming back ────────────────────────────────────────────────────────

/** Away this long and Today opens with a welcome-back rather than a backlog. */
export const WELCOME_BACK_DAYS = 7
/** The first bite of a backlog: small enough to say yes to without thinking. */
export const COMEBACK_CHUNK = 10

/**
 * Whole days since the last day with any study logged, from the heatmap
 * `/me/stats` already returns. `null` when there is no history at all — a
 * brand-new account has not been "away".
 */
export function daysSinceActive(heatmap: HeatmapCell[] | undefined, today: Date = new Date()): number | null {
  if (!Array.isArray(heatmap)) return null
  let last: string | null = null
  for (const cell of heatmap) {
    if ((cell.minutes > 0 || cell.intensity > 0) && (!last || cell.day > last)) last = cell.day
  }
  if (!last) return null
  const then = new Date(`${last}T00:00:00`)
  if (Number.isNaN(then.getTime())) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((start.getTime() - then.getTime()) / 86_400_000))
}

export type ReviewPlan = {
  /** Cards this session asks for. */
  count: number
  /** Everything due, overdue included. */
  total: number
  /** True when `count` is a slice of `total` — the screen offers the rest. */
  capped: boolean
  minutes: number
  /** Away long enough that the copy should welcome, not tally. */
  welcomeBack: boolean
  /** Later chunks of the same day's comeback — "keep going", not "welcome". */
  continuing: boolean
}

/**
 * How much of what is due to ask for right now.
 *
 * Coming back after a week or more to "46 cards due" is the moment people
 * close the app: a number that size reads as a debt. So a comeback asks for a
 * small first chunk and offers the rest, and keeps chunking for the rest of
 * that day (`inComeback`) so finishing ten does not land on a wall of 36.
 *
 * Otherwise the only cap is the student's own session length — a 15-minute
 * session is not offered 90 cards — and anything that fits is offered whole.
 */
export function planReview({
  due,
  daysAway,
  sessionMinutes,
  secondsPerCard,
  inComeback = false,
}: {
  due: number
  daysAway: number | null
  sessionMinutes?: number | null
  secondsPerCard?: number | null
  inComeback?: boolean
}): ReviewPlan {
  const total = Math.max(0, Math.floor(Number.isFinite(due) ? due : 0))
  const welcomeBack = daysAway != null && daysAway >= WELCOME_BACK_DAYS
  let cap = Infinity
  if (welcomeBack || inComeback) cap = COMEBACK_CHUNK
  else if (sessionMinutes && sessionMinutes > 0) {
    const pace = secondsPerCard && secondsPerCard > 0 ? secondsPerCard : DEFAULT_SECONDS_PER_CARD
    cap = Math.max(COMEBACK_CHUNK, Math.floor((sessionMinutes * 60) / pace))
  }
  const count = Math.min(total, cap)
  return {
    count,
    total,
    capped: count < total,
    minutes: estimateReviewMinutes(count, secondsPerCard),
    welcomeBack,
    continuing: !welcomeBack && inComeback && count < total,
  }
}

/** Remembers, for today only, that a comeback run is in progress. */
const COMEBACK_KEY = 'sl:comeback-day'

function todayStamp(now: Date = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

export function markComebackToday(now?: Date): void {
  try {
    localStorage.setItem(COMEBACK_KEY, todayStamp(now))
  } catch {
    /* private mode — the next visit just offers the whole remainder */
  }
}

export function isComebackToday(now?: Date): boolean {
  try {
    return localStorage.getItem(COMEBACK_KEY) === todayStamp(now)
  } catch {
    return false
  }
}

/** The review link, capped when the plan is a slice. */
export function reviewHref(base: string, plan: Pick<ReviewPlan, 'count' | 'capped'>): string {
  const path = `${base}/flashcards`
  return plan.capped ? `${path}?review=due&limit=${plan.count}` : `${path}?review=due`
}

// ── The one thing to do ────────────────────────────────────────────────

export type TopicEntry = { space: Space; subspace: Subspace; link: string; sortKey: number }

/** Every topic, most recently touched first. */
export function topicsByRecency(spaces: Space[]): TopicEntry[] {
  const out: TopicEntry[] = []
  for (const s of spaces) {
    for (const sub of s.subspaces) {
      out.push({
        space: s,
        subspace: sub,
        link: subspacePath(s, sub),
        sortKey: sub.last_activity_at ? Date.parse(sub.last_activity_at) : 0,
      })
    }
  }
  return out.sort((a, b) => b.sortKey - a.sortKey)
}

export type TodayAction =
  | { kind: 'review'; label: string; detail: string; href: string; plan: ReviewPlan }
  | { kind: 'suggestion'; label: string; detail: string | null; href: string }
  | { kind: 'quiz'; label: string; detail: string; href: string }
  | { kind: 'notes'; label: string; detail: string; href: string }
  | { kind: 'material'; label: string; detail: string; href: string }

/**
 * The single primary action on Today, in order of what revision needs most:
 * cards that are due, then the decision engine's pick (routed for a phone),
 * then a quiz, then notes, then — with nothing to revise — adding material.
 */
export function chooseTodayAction({
  topics,
  stats,
  suggestion,
  plan,
}: {
  topics: TopicEntry[]
  stats: Pick<Stats, 'cards_due'> | null
  suggestion: BriefSuggestion | null | undefined
  plan: ReviewPlan
}): TodayAction | null {
  const first = topics[0]
  if (!first) return null
  const count = (k: 'cards' | 'quizzes' | 'notes' | 'docs') => (t: TopicEntry) => (t.subspace.counts?.[k] ?? 0) > 0

  if ((stats?.cards_due ?? 0) > 0 && plan.count > 0) {
    const cardsTopic = topics.find(count('cards')) ?? first
    const label = !plan.capped
      ? `Review ${plan.count} card${plan.count === 1 ? '' : 's'}`
      : plan.welcomeBack
        ? `Start with ${plan.count} of your ${plan.total} cards`
        : plan.continuing
          ? `Keep going: ${plan.count} more of ${plan.total}`
          : `Review ${plan.count} of ${plan.total} cards`
    return {
      kind: 'review',
      label,
      detail: `~${plan.minutes} min`,
      href: reviewHref(cardsTopic.link, plan),
      plan,
    }
  }

  if (suggestion && suggestion.action && suggestion.action !== 'continue' && suggestion.action !== 'due_cards') {
    return {
      kind: 'suggestion',
      label: suggestion.label,
      detail: suggestion.reason ?? null,
      href: phoneRoute(suggestion.route, suggestion.action),
    }
  }

  const quizTopic = topics.find(count('quizzes'))
  if (quizTopic) {
    return {
      kind: 'quiz',
      label: 'Take a quick quiz',
      detail: quizTopic.subspace.name,
      href: `${quizTopic.link}/quizzes`,
    }
  }
  const notesTopic = topics.find(count('notes'))
  if (notesTopic) {
    return {
      kind: 'notes',
      label: 'Read your notes',
      detail: notesTopic.subspace.name,
      href: `${notesTopic.link}/notes`,
    }
  }
  return {
    kind: 'material',
    label: 'Add a file',
    detail: first.subspace.name,
    href: `${first.link}/docs?add=1`,
  }
}

/** True when nothing has been added anywhere yet. */
export function hasNoMaterial(topics: TopicEntry[], stats: Pick<Stats, 'docs_indexed'> | null): boolean {
  if ((stats?.docs_indexed ?? 0) > 0) return false
  return !topics.some((t) => {
    const c = t.subspace.counts ?? {}
    return (c.docs ?? 0) + (c.cards ?? 0) + (c.quizzes ?? 0) + (c.notes ?? 0) > 0
  })
}

// ── The week, lightly ──────────────────────────────────────────────────

export type WeekDay = { day: string; label: string; active: boolean; today: boolean }

/** The last seven days (today last), each marked studied or not. */
export function lastSevenDays(heatmap: HeatmapCell[] | undefined, today: Date = new Date()): WeekDay[] {
  const byDay = new Map<string, HeatmapCell>()
  for (const c of Array.isArray(heatmap) ? heatmap : []) byDay.set(c.day, c)
  const out: WeekDay[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const cell = byDay.get(iso)
    out.push({
      day: iso,
      label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()],
      active: Boolean(cell && (cell.minutes > 0 || cell.intensity > 0)),
      today: i === 0,
    })
  }
  return out
}

/** "Good morning" by the student's own clock. */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Up late'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** First word of a display name; empty when there is nothing usable. */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? ''
  return first.length > 24 ? first.slice(0, 24) : first
}

// ── The second tier ────────────────────────────────────────────────────

/** The attempted quiz with the lowest best score — the one most worth retaking. */
export function pickRetake(quizzes: Quiz[] | null | undefined): Quiz | null {
  const tried = (quizzes ?? []).filter((q) => q.best_score != null && (q.attempts ?? 0) > 0)
  if (!tried.length) return null
  return [...tried].sort((a, b) => (a.best_score ?? 0) - (b.best_score ?? 0))[0]
}

/** The most recently edited note. */
export function pickRecentNote(notes: Note[] | null | undefined): Note | null {
  const list = notes ?? []
  if (!list.length) return null
  return [...list].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
}

