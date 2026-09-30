import { describe, expect, it } from 'vitest'
import { AGENT_IDS } from '../components/mascot/agents'
import {
  ALLOWED_FACTS,
  LINES,
  candidates,
  createVoice,
  daypart,
  fill,
  mulberry32,
  pickLine,
  placeholders,
  quizSituation,
  type VoiceSituation,
} from './botVoice'

const SITUATIONS = Object.keys(ALLOWED_FACTS) as VoiceSituation[]
const situationOf = (key: string) => key.split('.')[0] as VoiceSituation
const allLines = () =>
  Object.entries(LINES).flatMap(([key, pool]) => Object.values(pool).flatMap((lines) => lines!.map((line) => ({ key, line }))))

const FULL = { name: 'Asha', count: 3, score: 72, streak: 5, hour: 9 }

describe('botVoice honesty', () => {
  it('every pool belongs to a known situation', () => {
    for (const key of Object.keys(LINES)) expect(SITUATIONS).toContain(situationOf(key))
  })

  it("every line's placeholders are a subset of its situation's allowed facts", () => {
    for (const { key, line } of allLines()) {
      const allowed = new Set<string>([...ALLOWED_FACTS[situationOf(key)], 'bot'])
      for (const p of placeholders(line)) expect(allowed.has(p), `${key}: "${line}" uses {${p}}`).toBe(true)
    }
  })

  it('never prints a number that was not passed in', () => {
    for (const situation of SITUATIONS)
      for (const agent of AGENT_IDS)
        for (const line of candidates(situation, agent, {})) {
          const out = fill(line, agent, {})
          expect(out, `${situation}/${agent}: "${out}"`).not.toMatch(/\d/)
        }
  })

  it('every situation × agent has a fact-free line, so empty facts still speak', () => {
    for (const situation of SITUATIONS)
      for (const agent of AGENT_IDS) expect(pickLine(situation, agent, {}), `${situation}/${agent}`).not.toBe('')
  })

  it('skips lines whose facts are missing', () => {
    for (let i = 0; i < 40; i++) {
      const line = pickLine('nudge', 'cards', {}, mulberry32(i))
      expect(line).not.toMatch(/\{|\}|undefined|NaN/)
    }
  })

  it('rejects bogus fact values', () => {
    const bad = { name: '   ', count: Number.NaN, score: -4, streak: Infinity }
    for (const situation of SITUATIONS)
      for (const line of candidates(situation, 'tutor', bad)) expect(placeholders(line).filter((p) => p !== 'bot')).toEqual([])
  })
})

describe('botVoice fill', () => {
  it('fills every placeholder with the real value', () => {
    for (const situation of SITUATIONS)
      for (const agent of AGENT_IDS)
        for (const line of candidates(situation, agent, FULL)) {
          const out = fill(line, agent, FULL)
          expect(out).not.toMatch(/[{}]/)
          for (const p of placeholders(line)) {
            if (p === 'name') expect(out).toContain('Asha')
            if (p === 'score') expect(out).toContain('72')
          }
        }
  })

  it('pluralises', () => {
    expect(fill('{count:card:cards} due', 'cards', { count: 1 })).toBe('1 card due')
    expect(fill('{count:card:cards} due', 'cards', { count: 4 })).toBe('4 cards due')
    expect(fill('{count:card is:cards are} due', 'cards', { count: 1 })).toBe('1 card is due')
  })

  it('uses the speaker name for {bot}', () => {
    expect(fill('I’m {bot}.', 'quiz', {})).toBe('I’m Pop.')
  })
})

describe('botVoice style limits', () => {
  it('keeps lines short: ≤ 110 chars, at most two sentences', () => {
    for (const { key, line } of allLines()) {
      expect(line.length, `${key}: ${line}`).toBeLessThanOrEqual(110)
      const sentences = line.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length
      expect(sentences, `${key}: ${line}`).toBeLessThanOrEqual(2)
    }
  })

  it('never guilt-trips or manufactures urgency', () => {
    const banned = /\b(missed you|disappointed|you forgot|you failed|hurry|last chance|don't lose|before it's too late|only \d)/i
    for (const { line } of allLines()) expect(line).not.toMatch(banned)
  })
})

describe('botVoice rotation', () => {
  it('never repeats the previous line back to back', () => {
    const pick = createVoice()
    const rng = mulberry32(7)
    let last = ''
    for (let i = 0; i < 200; i++) {
      const line = pick('error', 'tutor', {}, rng)
      expect(line).not.toBe(last)
      last = line
    }
  })

  it('remembers the last few lines per situation', () => {
    const pick = createVoice(3)
    const rng = mulberry32(1)
    const seen: string[] = []
    for (let i = 0; i < 60; i++) {
      const line = pick('waking', 'tutor', {}, rng) // 4 lines → none of the last 3 repeat
      expect(seen.slice(-3)).not.toContain(line)
      seen.push(line)
    }
  })

  it('is deterministic with a seeded rng', () => {
    const a = createVoice()
    const b = createVoice()
    const ra = mulberry32(42)
    const rb = mulberry32(42)
    for (let i = 0; i < 10; i++) expect(a('slow', 'notes', {}, ra)).toBe(b('slow', 'notes', {}, rb))
  })

  it('still answers from a single-line pool', () => {
    const pick = createVoice()
    expect(pick('emptyNotes', 'tutor')).toBe(pick('emptyNotes', 'tutor'))
  })
})

describe('botVoice helpers', () => {
  it('maps hours to dayparts', () => {
    expect([daypart(6), daypart(13), daypart(19), daypart(23), daypart(3)]).toEqual(['morning', 'afternoon', 'evening', 'late', 'late'])
  })

  it('greets by time of day', () => {
    const morning = candidates('greeting', 'tutor', { name: 'Asha', hour: 8 })
    expect(morning.some((l) => l.startsWith('Morning') || l.startsWith('Good morning'))).toBe(true)
    expect(morning.some((l) => /evening|midnight/i.test(l))).toBe(false)
  })

  it('buckets quiz scores', () => {
    expect([quizSituation(95), quizSituation(60), quizSituation(20)]).toEqual(['quizGreat', 'quizOk', 'quizRough'])
  })
})
