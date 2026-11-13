// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { DockHelp } from './DockHelp'

afterEach(cleanup)

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

const show = () =>
  render(
    <MemoryRouter initialEntries={['/s/a/b']}>
      <Routes>
        <Route path="/s/a/b" element={<DockHelp />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )

describe('Help in the dock', () => {
  // Help only exists in the sidebar, and the page has no tabs while the
  // sidebar is on screen: "a tab at the top of the page" pointed at nothing.
  it('points at the sidebar for notes, cards and quizzes, not at tabs that are not there', () => {
    show()
    expect(screen.queryByText(/tab at the top/)).not.toBeInTheDocument()
    expect(screen.getByText(/Saved in this topic/)).toBeInTheDocument()
  })

  it('sends "Tell us what went wrong" to the feedback section of Settings', async () => {
    show()
    await userEvent.setup().click(screen.getByRole('button', { name: /Tell us what went wrong/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?section=feedback')
  })
})
