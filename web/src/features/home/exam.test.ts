import { describe, expect, it } from 'vitest'
import { daysUntil, examPlan, SHOW_WITHIN_DAYS } from './exam'

const today = new Date(2026, 10, 7, 23, 30) // late evening: must still count from the calendar day
const fading = [{ subspaceId: 'a', topic: 'CNNs', subject: 'DL', why: 'quiet', action: { label: 'Review cards', to: '/x' } }]

describe('daysUntil', () => {
  it('counts calendar days, not hours', () => {
    expect(daysUntil('2026-11-07', today)).toBe(0)
    expect(daysUntil('2026-11-08', today)).toBe(1)
    expect(daysUntil('2026-11-16', today)).toBe(9)
  })
  it('rejects anything that is not a real date', () => {
    for (const bad of [null, undefined, '', 'soon', '2026-02-31', '2026-13-01']) expect(daysUntil(bad, today)).toBeNull()
  })
})

describe('examPlan', () => {
  const base = { goal: 'GATE 2027', due: 24, fading, today }
  it('spreads the due cards over the days left', () => {
    const p = examPlan({ ...base, examDate: '2026-11-13' })!
    expect(p.when).toBe('6 days')
    expect(p.line).toContain('about 4 a day')
    expect(p.urgent).toBe(false)
  })
  it('turns urgent in the last three days and says tomorrow plainly', () => {
    const p = examPlan({ ...base, examDate: '2026-11-08' })!
    expect(p.when).toBe('Tomorrow')
    expect(p.urgent).toBe(true)
  })
  it('shows nothing for a past exam, a far one or no date', () => {
    expect(examPlan({ ...base, examDate: '2026-11-06' })).toBeNull()
    const far = new Date(today.getTime() + (SHOW_WITHIN_DAYS + 5) * 86_400_000)
    const iso = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, '0')}-${String(far.getDate()).padStart(2, '0')}`
    expect(examPlan({ ...base, examDate: iso })).toBeNull()
    expect(examPlan({ ...base, examDate: null })).toBeNull()
  })
  it('never claims work that is not there', () => {
    const p = examPlan({ ...base, due: 0, fading: [], examDate: '2026-11-10' })!
    expect(p.line).toMatch(/Nothing is due or slipping/)
  })
})

describe('examPlan by study mode', () => {
  it('names an interview as an interview', () => {
    const p = examPlan({ examDate: '2026-11-10', goal: '', due: 0, fading: [], event: 'interview', today })!
    expect(p.title).toBe('Your interview')
  })
})

import { readiness } from './exam'
import type { TopicIndex } from './week'

const topic = (name: string, quiz: number | null, deck: { total: number; known_pct: number } | null) =>
  ({
    link: `/s/${name}`,
    subspace: { name, counts: { cards: 1 } },
    quiz: quiz === null ? null : { best_score: quiz },
    deck: deck ? { ...deck, due: 0 } : null,
  }) as never

describe('readiness', () => {
  it('averages what is measured, and says how much of the topic list that is', () => {
    const index: TopicIndex = new Map([
      ['a', topic('CNNs', 40, { total: 8, known_pct: 60 })], // 50
      ['b', topic('Autoencoders', 90, null)], // 90
      ['c', { ...(topic('Unmeasured', null, null) as object), subspace: { name: 'Unmeasured', counts: { docs: 1 } } } as never], // has a file, no quiz or cards: unmeasured, not zero
      ['d', { ...(topic('Empty', null, null) as object), subspace: { name: 'Empty', counts: {} } } as never], // nothing in it: not counted at all
    ])
    const r = readiness(index)!
    expect(r.pct).toBe(70)
    expect(r.known).toBe(2)
    expect(r.total).toBe(3) // the empty topic is not part of the denominator
    expect(r.weakest).toEqual({ name: 'CNNs', pct: 50, to: '/s/CNNs' })
  })
  it('claims nothing when nothing is measured', () => {
    expect(readiness(new Map([['x', topic('Empty', null, { total: 0, known_pct: 0 })]]))).toBeNull()
    expect(readiness(new Map())).toBeNull()
  })
})
