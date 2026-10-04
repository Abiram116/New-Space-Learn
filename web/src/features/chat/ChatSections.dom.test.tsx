// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatSections } from './ChatSections'

afterEach(cleanup)

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>
}

const setup = (hasDock: boolean, active: 'chat' | 'notes' = 'chat') => {
  const onSelect = vi.fn()
  render(
    <MemoryRouter initialEntries={['/fsd/transformer']}>
      <ChatSections base="/fsd/transformer" active={active} hasDock={hasDock} onSelect={onSelect} />
      <Where />
    </MemoryRouter>,
  )
  return onSelect
}

describe('ChatSections', () => {
  it('offers Chat, Files, Notes, Quizzes and Cards', () => {
    setup(true)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Chat', 'Files', 'Notes', 'Quizzes', 'Cards'])
  })

  it('with the dock on screen, a section opens beside the chat instead of leaving it', () => {
    const onSelect = setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }))
    expect(onSelect).toHaveBeenCalledWith('flashcards')
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Files' }))
    expect(onSelect).toHaveBeenLastCalledWith('docs')
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/transformer')
  })

  it('marks the open section', () => {
    setup(true, 'notes')
    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('without the dock, sections are plain links to the topic pages', () => {
    const onSelect = setup(false)
    fireEvent.click(screen.getByRole('link', { name: 'Quizzes' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/transformer/quizzes')
  })
})
