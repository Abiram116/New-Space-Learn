import { describe, expect, it } from 'vitest'
import { AGENT_IDS } from '../components/mascot/agents'
import { candidates, LINES, pickLine } from './botVoice'

describe('botVoice surfaces', () => {
  it('never promises a chat on a phone', () => {
    for (const s of ['emptyCards', 'emptyQuizzes', 'emptyNotes'] as const)
      for (const agent of AGENT_IDS) {
        const lines = candidates(s, agent, { surface: 'phone' })
        expect(lines.length, `${s}/${agent}`).toBeGreaterThan(0)
        for (const l of lines) expect(l, `${s}/${agent}`).not.toMatch(/chat/i)
      }
  })

  it('greets Home without pretending to be inside a topic', () => {
    for (let i = 0; i < 30; i++) {
      const line = pickLine('greeting', 'tutor', { name: 'Asha', surface: 'home' })
      expect(line).not.toMatch(/this topic|chat/i)
    }
  })

  it('a personal greeting always uses the name when there is one, and still speaks without', () => {
    for (let i = 0; i < 30; i++)
      expect(pickLine('greeting', 'tutor', { name: 'Asha', surface: 'home', personal: true })).toContain('Asha')
    expect(pickLine('greeting', 'tutor', { surface: 'home', personal: true })).not.toBe('')
  })

  it('falls back to the base pool where a surface has no wording of its own', () => {
    expect(candidates('waking', 'tutor', { surface: 'phone' })).toEqual(candidates('waking', 'tutor', {}))
  })

  it('makes no cause-of-failure claims it cannot know', () => {
    for (const l of LINES.error.any!) expect(l).not.toMatch(/cable/i)
    for (const l of LINES.waking.any!) expect(l).not.toMatch(/few seconds/i)
  })
})
