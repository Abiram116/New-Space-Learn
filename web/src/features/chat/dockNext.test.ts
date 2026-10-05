import { describe, expect, it } from 'vitest'
import { nextStep, type Progress } from './dockNext'
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

describe('nextStep: a topic that is already in use is not sent back to the start', () => {
  it('reviews cards that are due even if nothing has been asked in this chat', () => {
    expect(nextStep(at('ready', { asked: 0, decks: 1, due: 2 })).kind).toBe('review')
  })
})
