import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBJECT_ICON, subjectIcon } from './subjectIcon'

describe('subjectIcon', () => {
  it.each([
    ['Organic Chemistry', 'flask'],
    ['Biochemistry', 'flask'],
    ['Linear Algebra', 'sigma'],
    ['Reinforcement Learning', 'cpu'],
    ['Machine Learning', 'cpu'],
    ['CS 101', 'cpu'],
    ['Python programming', 'code'],
    ['Quantum Physics', 'atom'],
    ['Cell Biology', 'leaf'],
    ['Human Anatomy', 'pulse'],
    ['World History', 'landmark'],
    ['Constitutional Law', 'scale'],
    ['Physical Geography', 'atom'],
    ['Microeconomics', 'chart'],
    ['French', 'language'],
    ['English Literature', 'book'],
    ['Cognitive Psychology', 'brain'],
    ['Circuit Analysis', 'bolt'],
    ['Music Theory', 'music'],
    ['Art History', 'landmark'],
    ['Graphic design', 'palette'],
  ])('%s → %s', (name, icon) => {
    expect(subjectIcon(name)).toBe(icon)
  })

  it('does not read short abbreviations inside longer words', () => {
    expect(subjectIcon('Osmosis')).not.toBe('cpu')
    expect(subjectIcon('Aircraft systems')).not.toBe('cpu')
    expect(subjectIcon('Artificial Intelligence')).toBe('cpu')
  })

  it('falls back to a book for anything else, or nothing', () => {
    expect(subjectIcon('Zzyzx')).toBe(DEFAULT_SUBJECT_ICON)
    expect(subjectIcon('')).toBe(DEFAULT_SUBJECT_ICON)
    expect(subjectIcon(undefined)).toBe(DEFAULT_SUBJECT_ICON)
  })
})

describe('sharper icons', () => {
  it('tells NLP, Deep Learning and web development apart', async () => {
    const { subjectIcon, matchedSubjectIcon, subjectMonogram } = await import('./subjectIcon')
    expect(subjectIcon('NLP')).toBe('language')
    expect(subjectIcon('Deep Learning')).toBe('brain')
    expect(subjectIcon('fsd')).toBe('code')
    expect(subjectIcon('Java')).toBe('code')
    // Nothing knows this one: it gets a monogram, not a shared book.
    expect(matchedSubjectIcon('Quilting')).toBeNull()
    expect(subjectMonogram('Quilting')).toBe('Q')
  })
})
