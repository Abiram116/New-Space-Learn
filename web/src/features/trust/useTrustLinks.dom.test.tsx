// @vitest-environment jsdom
/**
 * Moving between trust pages from the landing page, then closing: one Close
 * must go back to the landing page, not through every card opened on the way.
 * Mirrors App: the landing page stays rendered under the card via
 * `<Routes location={background}>`, which is exactly where the links used to
 * read the wrong address.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { RealLocationContext } from '../../lib/realLocation'
import { TrustLayer, type TrustState } from './TrustLayer'
import { TRUST_PAGES, TRUST_SLUGS } from './pages'
import { useTrustLinks } from './useTrustLinks'

afterEach(cleanup)

function Landing() {
  const { linkProps } = useTrustLinks()
  return (
    <nav aria-label="corner">
      <span data-testid="landing">landing</span>
      {TRUST_SLUGS.map((s) => (
        <Link key={s} {...linkProps(s)}>
          {TRUST_PAGES[s].label}
        </Link>
      ))}
    </nav>
  )
}

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname}</span>
}

function Shell() {
  const location = useLocation()
  const background = (location.state as TrustState | null)?.background
  return (
    <RealLocationContext.Provider value={location}>
      <Routes location={background ?? location}>
        <Route path="*" element={<Landing />} />
      </Routes>
      <TrustLayer />
      <Where />
    </RealLocationContext.Provider>
  )
}

const corner = () => within(screen.getByRole('navigation', { name: 'corner' }))

describe('trust links on the landing page', () => {
  // KNOWN FLAKE: passes alone, and fails now and then only in the full parallel run
  // (a timing race between the router and the slide-over). Retried twice rather than
  // ignored; if it fails three times in a row, that is real.
  it('About → Privacy → Terms, then one Close returns to the landing page', { retry: 2 }, async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Shell />
      </MemoryRouter>,
    )
    fireEvent.click(corner().getByRole('link', { name: 'About' }))
    await screen.findByRole('dialog')
    fireEvent.click(corner().getByRole('link', { name: 'Privacy' }))
    fireEvent.click(corner().getByRole('link', { name: 'Terms' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/terms')
    expect(corner().getByRole('link', { name: 'Terms' })).toHaveAttribute('aria-current', 'page')

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    // The landing page never went away underneath.
    expect(screen.getByTestId('landing')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
