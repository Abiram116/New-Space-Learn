// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNavReset } from './useNavReset'

afterEach(cleanup)

function Page({ onReset }: { onReset: () => void }) {
  useNavReset(onReset)
  const navigate = useNavigate()
  return (
    <>
      <Link to="/cards" state={{ nav: true }}>
        sidebar
      </Link>
      <Link to="/cards">plain link</Link>
      <button onClick={() => navigate('/cards?deck=x', { replace: true })}>page navigates itself</button>
    </>
  )
}

const setup = () => {
  const onReset = vi.fn()
  render(
    <MemoryRouter initialEntries={['/cards']}>
      <Page onReset={onReset} />
    </MemoryRouter>,
  )
  return onReset
}

describe('useNavReset', () => {
  it('fires when the sidebar link for the page you are already on is clicked, every time', () => {
    const onReset = setup()
    fireEvent.click(screen.getByText('sidebar'))
    fireEvent.click(screen.getByText('sidebar'))
    expect(onReset).toHaveBeenCalledTimes(2)
  })

  it('does not fire for navigation the page makes itself, or for a plain link', () => {
    const onReset = setup()
    fireEvent.click(screen.getByText('page navigates itself'))
    fireEvent.click(screen.getByText('plain link'))
    expect(onReset).not.toHaveBeenCalled()
  })

  it('does not fire on first render', () => {
    expect(setup()).not.toHaveBeenCalled()
  })
})
