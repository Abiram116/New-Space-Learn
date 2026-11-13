// @vitest-environment jsdom
/**
 * A tap on a tab always lands on that tab's list — including the tab you are
 * already on, where the address does not change (a review summary on Cards).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNavReset } from '../../lib/useNavReset'

vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { email: 'ada@example.test', user_metadata: {} } }),
}))

import { BottomTabBar } from './BottomTabBar'

afterEach(cleanup)

function Page({ onReset }: { onReset: () => void }) {
  useNavReset(onReset)
  const { pathname, search } = useLocation()
  return <p data-testid="at">{pathname + search}</p>
}

function renderAt(path: string) {
  const onReset = vi.fn()
  render(
    <MemoryRouter initialEntries={[path]}>
      <Page onReset={onReset} />
      <BottomTabBar dueCount={3} />
    </MemoryRouter>,
  )
  return onReset
}

describe('BottomTabBar', () => {
  it('tapping Cards while on Cards tells the page to go back to its list', () => {
    const onReset = renderAt('/flashcards')
    fireEvent.click(screen.getByRole('link', { name: 'Cards, 3 due' }))
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('at')).toHaveTextContent('/flashcards')
  })

  it('drops a deck from the address on the way', () => {
    const onReset = renderAt('/flashcards?deck=biology')
    fireEvent.click(screen.getByRole('link', { name: 'Cards, 3 due' }))
    expect(onReset).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('at').textContent).toBe('/flashcards')
  })

  it('marks every tab as a deliberate pick, and the current one as current', () => {
    renderAt('/notes')
    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Today' })).not.toHaveAttribute('aria-current')
  })
})
