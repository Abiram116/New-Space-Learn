// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatSections } from './ChatSections'

afterEach(cleanup)

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

const setup = (path = '/fsd/transformer') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ChatSections base="/fsd/transformer" />
      <Where />
    </MemoryRouter>,
  )

describe('ChatSections (below lg, where there is no sidebar)', () => {
  it('offers Chat, Files, Notes, Quizzes and Cards as links', () => {
    setup()
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Chat', 'Files', 'Notes', 'Quizzes', 'Cards'])
  })

  it('each one goes to the topic page', () => {
    setup()
    fireEvent.click(screen.getByRole('link', { name: 'Quizzes' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/transformer/quizzes')
  })

  it('marks the page you are on', () => {
    setup('/fsd/transformer/notes')
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Chat' })).not.toHaveAttribute('aria-current')
  })
})
