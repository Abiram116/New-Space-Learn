// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AssessmentProvider, useUnsavedWork } from '../../lib/assessment'
import { UnsavedQuizGuard } from './UnsavedQuizGuard'

afterEach(cleanup)

function Quiz({ unsaved }: { unsaved: boolean }) {
  useUnsavedWork(unsaved)
  return null
}
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

const setup = (unsaved: boolean) =>
  render(
    <MemoryRouter initialEntries={['/quizzes']}>
      <AssessmentProvider>
        <Quiz unsaved={unsaved} />
        <UnsavedQuizGuard />
        <a href="/flashcards">Cards</a>
        <a href="https://elsewhere.example/x" target="_blank">
          external
        </a>
        <Where />
      </AssessmentProvider>
    </MemoryRouter>,
  )

describe('UnsavedQuizGuard', () => {
  it('asks before a link takes you away from unsaved answers, and Cancel keeps you here', () => {
    setup(true)
    expect(fireEvent.click(screen.getByText('Cards'))).toBe(false) // default prevented
    expect(screen.getByRole('dialog', { name: 'Leave this quiz?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/quizzes')
  })

  it('goes where the link pointed once confirmed', () => {
    setup(true)
    fireEvent.click(screen.getByText('Cards'))
    fireEvent.click(screen.getByRole('button', { name: 'Leave quiz' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/flashcards')
  })

  it('stays out of the way when nothing is unsaved', () => {
    setup(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    // not intercepted: the click is not default-prevented by the guard
    expect(fireEvent.click(screen.getByText('Cards'))).toBe(true)
  })

  it('leaves new-tab and off-site links alone', () => {
    setup(true)
    expect(fireEvent.click(screen.getByText('external'))).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
