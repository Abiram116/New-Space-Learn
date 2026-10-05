// @vitest-environment jsdom

/** With no material in the topic, an empty list leads with Add material. */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhoneDecks } from '../flashcards/PhoneDecks'
import { PhoneQuizzes } from './PhoneQuizzes'

afterEach(cleanup)

const noop = () => {}

function decks(addMaterialHref: string | null) {
  render(
    <MemoryRouter>
      <PhoneDecks
        decks={[]}
        loading={false}
        error={null}
        onRetry={noop}
        subjects={[]}
        subjectFilter="all"
        onSubjectFilter={noop}
        toneOf={() => undefined}
        totalDue={0}
        subspaceName="Chem"
        addMaterialHref={addMaterialHref}
        onOpen={noop}
        onReview={noop}
        onReviewDue={noop}
        onDelete={noop}
        onNew={noop}
        onGenerate={vi.fn()}
      />
    </MemoryRouter>,
  )
}

function quizzes(addMaterialHref: string | null) {
  render(
    <MemoryRouter>
      <PhoneQuizzes
        quizzes={[]}
        loading={false}
        error={null}
        onRetry={noop}
        subjects={[]}
        subjectFilter="all"
        onSubjectFilter={noop}
        toneOf={() => undefined}
        generating={false}
        addMaterialHref={addMaterialHref}
        onOpen={noop}
        onGenerate={noop}
      />
    </MemoryRouter>,
  )
}

describe('empty lists on a topic without sources', () => {
  it('cards: Add material leads, Start a deck stays, no Generate', () => {
    decks('/s/a/b/docs?add=1')
    expect(screen.getByRole('button', { name: /add a file/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /start a deck/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /make a deck/i })).toBeNull()
    expect(screen.queryByText(/you've indexed/i)).toBeNull()
  })

  it('cards: with sources it still leads with Generate', () => {
    decks(null)
    expect(screen.getByRole('button', { name: /make a deck/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add a file/i })).toBeNull()
  })

  it('quizzes: Add material replaces Generate when there is nothing to draw from', () => {
    quizzes('/s/a/b/docs?add=1')
    expect(screen.getByRole('button', { name: /add a file/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /make a quiz/i })).toBeNull()
  })
})
