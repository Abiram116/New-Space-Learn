import { describe, expect, it } from 'vitest'
import type { HeatmapCell, Note, Quiz, Space } from '../../api/types'
import {
  chooseTodayAction,
  COMEBACK_CHUNK,
  daysSinceActive,
  estimateReviewMinutes,
  hasNoMaterial,
  lastSevenDays,
  phoneRoute,
  pickRecentNote,
  pickRetake,
  planReview,
  reviewHref,
  topicsByRecency,
} from './today'

const TODAY = new Date(2026, 8, 30, 10, 0) // 30 Sep 2026, local

function iso(daysAgo: number): string {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() - daysAgo)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cell(daysAgo: number, minutes: number): HeatmapCell {
  return { day: iso(daysAgo), minutes, intensity: minutes ? 1 : 0 }
}

function space(counts: Record<string, number> = {}, id = 'sp'): Space {
  return {
    id,
    name: 'Biology',
    tone: 'brand',
    pinned: false,
    subspaces: [
      { id: `${id}-t`, subject_id: id, name: 'Cells', last_activity_at: '2026-09-29T10:00:00Z', counts },
    ],
  }
}

describe('estimateReviewMinutes', () => {
  it('uses ~20s a card by default — 12 cards is about 4 minutes', () => {
    expect(estimateReviewMinutes(12)).toBe(4)
  })
  it('never promises zero minutes for a real review', () => {
    expect(estimateReviewMinutes(1)).toBe(1)
  })
  it('is zero with nothing to review', () => {
    expect(estimateReviewMinutes(0)).toBe(0)
  })
  it('uses the student’s own pace when it is plausible', () => {
    expect(estimateReviewMinutes(12, 10)).toBe(2)
  })
  it('ignores an implausible pace instead of promising nonsense', () => {
    expect(estimateReviewMinutes(12, 0)).toBe(4)
    expect(estimateReviewMinutes(12, Number.NaN)).toBe(4)
    expect(estimateReviewMinutes(12, 9999)).toBe(4)
  })
})

describe('daysSinceActive', () => {
  it('counts whole days since the last studied day', () => {
    expect(daysSinceActive([cell(20, 5), cell(9, 12), cell(3, 0)], TODAY)).toBe(9)
  })
  it('is zero when studied today', () => {
    expect(daysSinceActive([cell(0, 3)], TODAY)).toBe(0)
  })
  it('is null for an account with no history — new is not "away"', () => {
    expect(daysSinceActive([cell(1, 0)], TODAY)).toBeNull()
    expect(daysSinceActive(undefined, TODAY)).toBeNull()
  })
})

describe('planReview — overdue chunking', () => {
  it('asks for everything when it fits', () => {
    const p = planReview({ due: 12, daysAway: 1 })
    expect(p).toMatchObject({ count: 12, total: 12, capped: false, welcomeBack: false, minutes: 4 })
  })
  it('after a week away, starts with a small chunk and keeps the total', () => {
    const p = planReview({ due: 46, daysAway: 9 })
    expect(p).toMatchObject({ count: COMEBACK_CHUNK, total: 46, capped: true, welcomeBack: true })
  })
  it('does not cap a small backlog after a week away', () => {
    expect(planReview({ due: 6, daysAway: 14 })).toMatchObject({ count: 6, capped: false, welcomeBack: true })
  })
  it('keeps chunking for the rest of a comeback day, as a continuation', () => {
    const p = planReview({ due: 36, daysAway: 0, inComeback: true })
    expect(p).toMatchObject({ count: COMEBACK_CHUNK, total: 36, capped: true, welcomeBack: false, continuing: true })
  })
  it('caps to what fits a stated session length', () => {
    // 15 minutes at 20s a card = 45 cards.
    expect(planReview({ due: 90, daysAway: 0, sessionMinutes: 15 })).toMatchObject({ count: 45, capped: true })
  })
  it('handles a missing or broken due count', () => {
    expect(planReview({ due: Number.NaN, daysAway: null })).toMatchObject({ count: 0, total: 0, capped: false })
  })
})

describe('reviewHref', () => {
  it('carries the cap only when the plan is a slice', () => {
    expect(reviewHref('/s/a/b', { count: 10, capped: true })).toBe('/s/a/b/flashcards?review=due&limit=10')
    expect(reviewHref('/s/a/b', { count: 12, capped: false })).toBe('/s/a/b/flashcards?review=due')
  })
})

describe('chooseTodayAction', () => {
  const noPlan = planReview({ due: 0, daysAway: 0 })

  it('leads with due cards, with a time estimate', () => {
    const topics = topicsByRecency([space({ cards: 30 })])
    const plan = planReview({ due: 12, daysAway: 0 })
    const a = chooseTodayAction({ topics, stats: { cards_due: 12 }, suggestion: null, plan })
    expect(a).toMatchObject({ kind: 'review', label: 'Review 12 cards', detail: '~4 min' })
    expect(a?.href).toBe('/s/sp/sp-t/flashcards?review=due')
  })

  it('welcomes back with a manageable first chunk', () => {
    const topics = topicsByRecency([space({ cards: 60 })])
    const plan = planReview({ due: 46, daysAway: 12 })
    const a = chooseTodayAction({ topics, stats: { cards_due: 46 }, suggestion: null, plan })
    expect(a?.label).toBe('Start with 10 of your 46 cards')
    expect(a?.href).toContain('limit=10')
  })

  it('never sends a phone to chat: a chat-bound suggestion is re-routed', () => {
    const topics = topicsByRecency([space({ quizzes: 1 })])
    const a = chooseTodayAction({
      topics,
      stats: { cards_due: 0 },
      suggestion: { label: 'Firm up osmosis', route: '/s/sp/sp-t', action: 'weak_topic', reason: 'Scores are low.' },
      plan: noPlan,
    })
    expect(a).toMatchObject({ kind: 'suggestion', href: '/s/sp/sp-t/quizzes', detail: 'Scores are low.' })
  })

  it('skips a plain "continue" (that is the chat) and offers a quiz', () => {
    const topics = topicsByRecency([space({ quizzes: 2, notes: 1 })])
    const a = chooseTodayAction({
      topics,
      stats: { cards_due: 0 },
      suggestion: { label: 'Continue Cells', route: '/s/sp/sp-t', action: 'continue' },
      plan: noPlan,
    })
    expect(a).toMatchObject({ kind: 'quiz', label: 'Take a quick quiz', href: '/s/sp/sp-t/quizzes' })
  })

  it('falls back to notes, then to adding material', () => {
    expect(
      chooseTodayAction({ topics: topicsByRecency([space({ notes: 3 })]), stats: null, suggestion: null, plan: noPlan }),
    ).toMatchObject({ kind: 'notes', href: '/s/sp/sp-t/notes' })
    expect(
      chooseTodayAction({ topics: topicsByRecency([space({})]), stats: null, suggestion: null, plan: noPlan }),
    ).toMatchObject({ kind: 'material', label: 'Add material', href: '/s/sp/sp-t/docs?add=1' })
  })

  it('has nothing to offer without a topic', () => {
    expect(chooseTodayAction({ topics: [], stats: null, suggestion: null, plan: noPlan })).toBeNull()
  })
})

describe('phoneRoute (shared with the phone shell)', () => {
  it('leaves phone surfaces alone and re-routes chat', () => {
    expect(phoneRoute('/s/a/b/flashcards', 'due_cards')).toBe('/s/a/b/flashcards')
    expect(phoneRoute('/s/a/b', 'due_cards')).toBe('/s/a/b/flashcards')
    expect(phoneRoute('/s/a/b/skills')).toBe('/s/a/b')
    expect(phoneRoute('/home')).toBe('/home')
  })
})

describe('hasNoMaterial', () => {
  it('is true only when nothing at all has been added', () => {
    expect(hasNoMaterial(topicsByRecency([space({})]), { docs_indexed: 0 })).toBe(true)
    expect(hasNoMaterial(topicsByRecency([space({ docs: 1 })]), { docs_indexed: 0 })).toBe(false)
    expect(hasNoMaterial(topicsByRecency([space({})]), { docs_indexed: 2 })).toBe(false)
  })
})

describe('lastSevenDays', () => {
  it('returns seven days ending today, marking studied ones', () => {
    const week = lastSevenDays([cell(0, 10), cell(2, 4), cell(9, 30)], TODAY)
    expect(week).toHaveLength(7)
    expect(week[6]).toMatchObject({ today: true, active: true, day: iso(0) })
    expect(week[4].active).toBe(true)
    expect(week.filter((d) => d.active)).toHaveLength(2)
  })
})

describe('second-tier picks', () => {
  const quiz = (id: string, best: number | null, attempts = 1) =>
    ({ id, topic: id, questions: [], created_at: '', best_score: best, attempts }) as Quiz
  it('retake is the attempted quiz with the lowest best score', () => {
    expect(pickRetake([quiz('a', 90), quiz('b', 40), quiz('c', null, 0)])?.id).toBe('b')
    expect(pickRetake([quiz('c', null, 0)])).toBeNull()
  })
  it('recent note is the last edited', () => {
    const note = (id: string, updated_at: string) => ({ id, title: id, updated_at }) as Note
    expect(pickRecentNote([note('old', '2026-01-01T00:00:00Z'), note('new', '2026-09-01T00:00:00Z')])?.id).toBe('new')
    expect(pickRecentNote([])).toBeNull()
  })
})
