import { describe, expect, it } from 'vitest'
import { nextStep, otherMakes, steps, type Progress } from './dockNext'
import type { SourcesState } from './DockSources'

const files = (kind: SourcesState['kind'], over: Partial<SourcesState> = {}): SourcesState => ({
  kind,
  ready: kind === 'ready' ? 1 : 0,
  reading: kind === 'reading' ? 1 : 0,
  failed: kind === 'failed' ? 1 : 0,
  title: '',
  hint: '',
  ...over,
})

const at = (kind: SourcesState['kind'], over: Partial<Progress> = {}): Progress => ({
  files: files(kind),
  asked: 0,
  notes: 0,
  quizzes: 0,
  decks: 0,
  due: 0,
  ...over,
})

describe('nextStep: one button, always the next thing to do', () => {
  it('leads a new topic to adding a file', () => {
    expect(nextStep(at('none'))).toMatchObject({ kind: 'add', label: 'Add a file' })
  })

  it('waits while a file is being read, and says so', () => {
    expect(nextStep(at('reading'))).toMatchObject({ kind: 'waiting', disabled: true })
  })

  it('offers to retry a file that could not be read', () => {
    expect(nextStep(at('failed'))).toMatchObject({ kind: 'retry' })
  })

  it('does not press anything while the first load is still running', () => {
    expect(nextStep(at('loading'))).toMatchObject({ disabled: true })
  })

  it('sends someone with a ready file and no questions to the chat', () => {
    expect(nextStep(at('ready'))).toMatchObject({ kind: 'ask', label: 'Ask a question' })
  })

  it('then suggests flashcards, then a quiz, then notes — whichever they have not made', () => {
    expect(nextStep(at('ready', { asked: 2 })).kind).toBe('flashcards')
    expect(nextStep(at('ready', { asked: 2, decks: 1 })).kind).toBe('quiz')
    expect(nextStep(at('ready', { asked: 2, decks: 1, quizzes: 1 })).kind).toBe('notes')
  })

  it('puts cards that are due for review ahead of making anything new', () => {
    expect(nextStep(at('ready', { asked: 5, decks: 1, due: 6 }))).toMatchObject({ kind: 'review', label: 'Review 6 cards' })
    expect(nextStep(at('ready', { asked: 5, decks: 1, due: 1 })).label).toBe('Review 1 card')
  })

  it('counts a topic with one ready and one failed file as ready', () => {
    expect(nextStep(at('ready', { files: files('ready', { failed: 1 }) })).kind).toBe('ask')
  })
})

describe('steps: what is done, what is next, what is wrong', () => {
  it('starts with the first step current and the rest waiting', () => {
    expect(steps(at('none'))).toEqual({ files: 'current', ask: 'todo', practice: 'todo', done: 0 })
  })

  it('marks a file that failed as a problem, not as progress', () => {
    expect(steps(at('failed')).files).toBe('problem')
  })

  it('moves on as each step is done', () => {
    expect(steps(at('ready'))).toMatchObject({ files: 'done', ask: 'current', practice: 'todo', done: 1 })
    expect(steps(at('ready', { asked: 1 }))).toMatchObject({ ask: 'done', practice: 'current', done: 2 })
    expect(steps(at('ready', { asked: 1, notes: 1 }))).toMatchObject({ practice: 'done', done: 3 })
  })
})

describe('otherMakes', () => {
  it('offers the two things the main button is not', () => {
    expect(otherMakes({ kind: 'flashcards', label: '' })).toEqual(['notes', 'quiz'])
    expect(otherMakes({ kind: 'review', label: '' })).toEqual(['notes', 'flashcards', 'quiz'])
  })
})

describe('novaSays: the guide talks, and her face shows the state', () => {
  it('follows a new topic through the three steps', async () => {
    const { novaSays } = await import('./dockNext')
    expect(novaSays(at('none'))).toMatchObject({ mood: 'wave', line: expect.stringContaining('Add your notes') })
    expect(novaSays(at('reading'))).toMatchObject({ mood: 'working' })
    expect(novaSays(at('failed'))).toMatchObject({ mood: 'curious' })
    expect(novaSays(at('ready'))).toMatchObject({ mood: 'happy', line: 'Got it! Ask me anything about it.' })
    expect(novaSays(at('ready', { asked: 2 }))).toMatchObject({ mood: 'proud' })
    expect(novaSays(at('ready', { asked: 9, notes: 2 }))).toMatchObject({ mood: 'celebrate' })
  })
})

describe('nextStep: a topic that is already in use is not sent back to the start', () => {
  it('reviews cards that are due even if nothing has been asked in this chat', () => {
    expect(nextStep(at('ready', { asked: 0, decks: 1, due: 2 })).kind).toBe('review')
  })
})
