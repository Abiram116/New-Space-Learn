/**
 * The week in review, as pure functions: what you did, what is coming due,
 * and what is fading — each read from data Home already has or shares a cache
 * key with (`/me/stats`, `/me/student-model`, the account-wide quiz and deck
 * lists). Every function returns `null`/empty when there is nothing real to
 * say, so the recap hides a part rather than padding it.
 */

import type { Deck, Quiz, Space, Stats, StudentModel, Subspace } from '../../api/types'
import { subspacePath } from '../../lib/nav'

// ── What you did ───────────────────────────────────────────────────────

export type WeekDid = { asked: number; reviewed: number; tested: number; minutes: number; streak: number }

export function weekDid(stats: Stats | null | undefined): WeekDid | null {
  if (!stats) return null
  const c = stats.composition
  const did: WeekDid = {
    asked: c?.chat_messages ?? 0,
    reviewed: c?.cards_reviewed ?? 0,
    tested: c?.quizzes_taken ?? 0,
    minutes: stats.study_minutes_this_week ?? 0,
    streak: stats.streak_days ?? 0,
  }
  return did.asked + did.reviewed + did.tested + did.minutes > 0 ? did : null
}

/** "12 questions · 40 cards · 2 quizzes" — only the parts that happened. */
export function didSummary(d: WeekDid): string {
  const parts: string[] = []
  if (d.asked) parts.push(`${d.asked} question${d.asked === 1 ? '' : 's'} asked`)
  if (d.reviewed) parts.push(`${d.reviewed} card${d.reviewed === 1 ? '' : 's'} reviewed`)
  if (d.tested) parts.push(`${d.tested} quiz${d.tested === 1 ? '' : 'zes'} taken`)
  return parts.join(' · ')
}

// ── Coming due ─────────────────────────────────────────────────────────

export type ComingDue = { total: number; today: number; later: number; busiest: { day: string; count: number } | null }

export function comingDue(stats: Stats | null | undefined): ComingDue | null {
  const days = Array.isArray(stats?.due_forecast) ? stats!.due_forecast : []
  const total = days.reduce((n, d) => n + (d.count || 0), 0)
  if (total === 0) return null
  const today = days[0]?.count ?? 0
  const rest = days.slice(1).filter((d) => d.count > 0)
  const busiest = rest.length ? rest.reduce((a, b) => (b.count > a.count ? b : a)) : null
  return { total, today, later: total - today, busiest }
}

// ── Exact destinations ─────────────────────────────────────────────────

export type TopicIndex = Map<string, { link: string; subspace: Subspace; space: Space; quiz: Quiz | null; deck: Deck | null }>

/**
 * Per topic: its link, the quiz to open (lowest best score, else newest) and
 * the deck to open (most due). Same rule as Profile's, so a topic's "open the
 * quiz" goes to the same quiz from either page.
 */
export function indexTopics(spaces: Space[], quizzes: Quiz[] | null | undefined, decks: Deck[] | null | undefined): TopicIndex {
  const map: TopicIndex = new Map()
  for (const space of spaces) {
    for (const subspace of space.subspaces) {
      const own = (quizzes ?? []).filter((q) => q.subspace_id === subspace.id)
      const taken = own.filter((q) => q.best_score != null)
      const quiz = taken.length
        ? taken.reduce((a, b) => ((b.best_score ?? 0) < (a.best_score ?? 0) ? b : a))
        : (own.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null)
      const ownDecks = (decks ?? []).filter((d) => d.subspace_id === subspace.id && d.total > 0)
      const deck = ownDecks.length ? ownDecks.reduce((a, b) => (b.due > a.due ? b : a)) : null
      map.set(subspace.id, { link: subspacePath(space, subspace), subspace, space, quiz, deck })
    }
  }
  return map
}

export const quizHref = (link: string, quiz: Quiz | null) =>
  quiz ? `${link}/quizzes?q=${encodeURIComponent(quiz.id)}` : `${link}/quizzes`
export const deckHref = (link: string, deck: Deck | null) =>
  deck ? `${link}/flashcards?deck=${encodeURIComponent(deck.id)}` : `${link}/flashcards`

/** The deck with the most cards due across the account, for "coming due". */
export function busiestDeck(index: TopicIndex): { href: string; name: string; due: number } | null {
  let best: { href: string; name: string; due: number } | null = null
  for (const t of index.values()) {
    if (t.deck && t.deck.due > 0 && (!best || t.deck.due > best.due)) {
      best = { href: deckHref(t.link, t.deck), name: t.deck.name, due: t.deck.due }
    }
  }
  return best
}

// ── Fading ─────────────────────────────────────────────────────────────

export type Fading = {
  subspaceId: string
  topic: string
  subject: string
  why: string
  action: { label: string; to: string }
}

/**
 * Topics that need attention, strongest signal first: scores going down,
 * then low averages, then topics gone quiet. One entry per topic, only for
 * topics that still exist (a button to "not found" is worse than none), and
 * never the topic `exclude` names — that one is already the "do now" retake.
 */
export function fadingTopics(
  model: StudentModel | null | undefined,
  index: TopicIndex,
  { exclude, limit = 3 }: { exclude?: string | null; limit?: number } = {},
): Fading[] {
  if (!model) return []
  const out: Fading[] = []
  const seen = new Set<string>()
  if (exclude) seen.add(exclude)

  const push = (subspaceId: string | undefined, why: string, recallWeaker: boolean) => {
    if (!subspaceId || seen.has(subspaceId) || out.length >= limit) return
    const t = index.get(subspaceId)
    if (!t) return
    seen.add(subspaceId)
    const useCards = recallWeaker && (t.deck || (t.subspace.counts?.cards ?? 0) > 0)
    const hasQuiz = t.quiz || (t.subspace.counts?.quizzes ?? 0) > 0
    const action = useCards
      ? { label: 'Review cards', to: deckHref(t.link, t.deck) }
      : hasQuiz
        ? { label: t.quiz?.best_score != null ? 'Retake quiz' : 'Take a quiz', to: quizHref(t.link, t.quiz) }
        : t.deck
          ? { label: 'Review cards', to: deckHref(t.link, t.deck) }
          : { label: 'Open topic', to: t.link }
    out.push({ subspaceId, topic: t.subspace.name, subject: t.space.name, why, action })
  }
  const recallWeaker = (a: { recall_mastery?: number | null; application_mastery?: number | null }) =>
    a.recall_mastery != null && (a.application_mastery == null || a.recall_mastery < a.application_mastery)

  for (const a of model.falling_areas ?? []) {
    if (a.trend != null && a.trend < 0) push(a.subspace_id, `Quiz scores down ${Math.round(-a.trend)} points`, recallWeaker(a))
  }
  for (const a of model.weak_areas ?? []) push(a.subspace_id, `Quiz average ${Math.round(a.average)}%`, recallWeaker(a))
  for (const s of model.slipping ?? []) {
    if (s.kind !== 'topic') continue
    const want = s.label.trim().toLowerCase()
    const hit = [...index.entries()].find(([, t]) => t.subspace.name.trim().toLowerCase() === want)
    const days = s.days_since_activity
    push(hit?.[0], days ? `Was solid, untouched for ${days} days` : 'Was solid, now slipping', true)
  }
  for (const a of model.cold_areas ?? []) {
    const days = a.days_since_activity
    push(a.subspace_id, days ? `Quiet for ${days} days` : 'Gone quiet', true)
  }
  return out
}
