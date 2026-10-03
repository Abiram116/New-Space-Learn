// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TrustLayer, trustOverlayHref } from './TrustLayer'
import { TrustSettingsList } from './TrustSettingsList'
import { TEAM } from './config'

// The Feedback card holds the real form, which asks who is signed in and loads
// its questions. Here: a signed-out visitor and an empty question list.
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ session: null }) }))
vi.mock('../../api/productFeedback', () => ({ getFeedbackForm: () => Promise.resolve([]) }))

afterEach(cleanup)

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname + l.search}</span>
}

function renderAt(entries: InitialEntry[], page: React.ReactNode = <Where />) {
  return render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route path="*" element={page} />
      </Routes>
      <TrustLayer />
    </MemoryRouter>,
  )
}

const panel = () => screen.findByRole('dialog', { name: /./ })

describe('trust slide-over (inside the app)', () => {
  it('nothing opens on an ordinary page', () => {
    renderAt(['/home'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('?info= opens the page over the current one', async () => {
    renderAt(['/settings?info=privacy'])
    const dialog = await panel()
    expect(within(dialog).getByRole('heading', { name: 'Privacy' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/we never sell it/i)
    await waitFor(() => expect(document.title).toBe('Privacy · Space Learn'))
  })

  it('tabs switch pages in place, without adding history', async () => {
    renderAt(['/settings', '/settings?info=about'])
    const dialog = await panel()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terms' }))
    expect(within(dialog).getByRole('heading', { name: 'Terms of use' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Terms' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/settings')
    expect(screen.getByTestId('where')).not.toHaveTextContent('info=')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('← / → step through the pages', async () => {
    renderAt(['/settings?info=about'])
    const dialog = await panel()
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(within(dialog).getByRole('heading', { name: 'Privacy' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(within(dialog).getByRole('heading', { name: 'About Space Learn' })).toBeInTheDocument()
  })

  it('Esc puts you back on the page it opened over', async () => {
    renderAt(['/signup', '/signup?info=privacy'])
    await panel()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/signup$/)
  })

  it('arriving on a link that already has ?info=, Close just drops it', async () => {
    renderAt(['/signin?info=terms'])
    const dialog = await panel()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/signin$/)
  })


  it('in the app it offers only the pages you read — About, Privacy, Terms', async () => {
    renderAt(['/settings?info=about'])
    const dialog = await panel()
    const tabs = within(dialog).getByRole('navigation')
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['About', 'Privacy', 'Terms'])
  })

  it('Contact and Feedback do not open as a slide-over in the app (they live in Settings)', () => {
    renderAt(['/settings?info=contact'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ignores an unknown ?info= value', () => {
    renderAt(['/home?info=nope'])
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('trustOverlayHref', () => {
  it('keeps the page and its other parameters', () => {
    expect(trustOverlayHref({ pathname: '/settings', search: '?section=study' }, 'privacy')).toBe(
      '/settings?section=study&info=privacy',
    )
  })
})

describe('Settings › About & legal', () => {
  it('lists the three reading pages and both of us to contact', () => {
    renderAt(['/settings'], <TrustSettingsList />)
    expect(screen.getAllByRole('link', { name: /About Space Learn|Privacy|Terms of use/ })).toHaveLength(3)
    expect(screen.getAllByText(/Effective .*2026/, { selector: 'span' })).toHaveLength(2)
    for (const p of TEAM) expect(screen.getByText(p.email)).toBeInTheDocument()
  })

  it('each row opens the page over Settings', async () => {
    renderAt(
      ['/settings'],
      <>
        <TrustSettingsList />
        <Link to="/elsewhere">elsewhere</Link>
      </>,
    )
    fireEvent.click(screen.getByRole('link', { name: /Privacy/ }))
    const dialog = await panel()
    expect(within(dialog).getByRole('heading', { name: 'Privacy' })).toBeInTheDocument()
  })
})

describe('trust card (from the landing page)', () => {
  const bg = { pathname: '/', search: '', hash: '', state: null, key: 'landing' }

  it('/about slides in the About card', async () => {
    renderAt(['/about'])
    const card = await panel()
    expect(within(card).getByRole('heading', { name: 'About Space Learn' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('About Space Learn · Space Learn'))
  })

  it('holds the landing page still by locking <html>, never <body> (which snapped it to the top)', async () => {
    renderAt(['/about'])
    await panel()
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.body.style.overflow).toBe('')
    cleanup()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('has no tabs of its own — the corner links are its navigation', async () => {
    renderAt(['/privacy'])
    const card = await panel()
    expect(within(card).queryByRole('navigation')).toBeNull()
    expect(within(card).getAllByRole('button')).toHaveLength(1) // Close
  })

  it('another page slides the current card out, then the next one in', async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/about', state: { background: bg } }]}>
        <Routes>
          <Route path="*" element={<Link to="/terms" state={{ background: bg }} replace>to terms</Link>} />
        </Routes>
        <TrustLayer />
      </MemoryRouter>,
    )
    await panel()
    fireEvent.click(screen.getByText('to terms'))
    // The About card is still up while it slides out…
    expect(screen.getByRole('heading', { name: 'About Space Learn' })).toBeInTheDocument()
    // …then Terms arrives.
    expect(await screen.findByRole('heading', { name: 'Terms of use' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'About Space Learn' })).toBeNull()
  })

  it('Close goes back to the landing page it was opened from, and the card slides away', async () => {
    renderAt(['/', { pathname: '/contact', state: { background: bg } }])
    const card = await panel()
    fireEvent.click(within(card).getByRole('button', { name: 'Close' }))
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('clicking the dimmed page behind the card closes it', async () => {
    renderAt(['/', { pathname: '/privacy', state: { background: bg } }])
    await panel()
    const backdrop = document.querySelector('body > div[aria-hidden].fixed.inset-0') as HTMLElement
    fireEvent.click(backdrop)
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('keeps the corner links on top while the card is open, with the open page marked', async () => {
    renderAt(['/terms'])
    await panel()
    const corner = screen.getByRole('navigation', { name: 'About Space Learn' })
    expect(within(corner).getByRole('link', { name: 'Terms' })).toHaveAttribute('aria-current', 'page')
    expect(within(corner).queryByRole('link', { name: 'Feedback' })).toBeNull()
    expect(within(corner).getAllByRole('link')).toHaveLength(4)
  })

  it('a shared link straight to /terms closes to home', async () => {
    renderAt(['/terms'])
    await panel()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByTestId('where')).toHaveTextContent(/^\/$/)
  })
})

