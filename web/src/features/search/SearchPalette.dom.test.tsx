// @vitest-environment jsdom
/**
 * The search palette: how it opens, what it shows while it waits, how the
 * keyboard moves through it, and where a pick takes you.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '../../api/search'
import type { Space } from '../../api/types'

const SPACES: Space[] = [
  {
    id: 'sp1',
    name: 'Operating Systems',
    slug: 'operating-systems',
    tone: 'sky',
    pinned: false,
    subspaces: [{ id: 't1', subject_id: 'sp1', name: 'Deadlock', slug: 'deadlock', last_activity_at: null, counts: {} }],
  },
]

vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: SPACES }) }))

const searchEverything = vi.fn()
vi.mock('../../api/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/search')>()),
  searchEverything: (...args: unknown[]) => searchEverything(...args),
}))

import { SearchPalette } from './SearchPalette'

const base = {
  snippet: null,
  subject_id: 'sp1',
  subject_name: 'Operating Systems',
  subspace_id: 't1',
  subspace_name: 'Deadlock',
  deck_id: null,
  deck_name: null,
  document_id: null,
  locator: null,
  status: null,
}

const RESULT: SearchResult = {
  query: 'mutual',
  partial: false,
  groups: [
    {
      kind: 'note',
      label: 'Notes',
      hits: [{ ...base, kind: 'note', id: 'n1', title: 'Mutual exclusion', snippet: 'one at a time, mutual' }],
    },
    {
      kind: 'card',
      label: 'Cards',
      hits: [{ ...base, kind: 'card', id: 'c1', title: 'What is mutual exclusion?', deck_id: 'd1', deck_name: 'Basics' }],
    },
  ],
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname + l.search}</div>
}

function renderPalette() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <button>before</button>
      <SearchPalette />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const input = () => screen.getByRole('combobox')

async function type(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  await act(async () => {
    vi.advanceTimersByTime(200)
  })
  // Let the resolved fetch settle.
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  searchEverything.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('SearchPalette', () => {
  it('opens on Ctrl+K and on the sl:open-search event, and Esc returns focus', () => {
    renderPalette()
    const before = screen.getByText('before')
    before.focus()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Search everything' })).toBeInTheDocument()
    expect(input()).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(before).toHaveFocus()

    act(() => {
      window.dispatchEvent(new Event('sl:open-search'))
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // ⌘K toggles it shut again.
    fireEvent.keyDown(window, { key: 'K', metaKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not search below two characters', async () => {
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await type('m')
    expect(searchEverything).not.toHaveBeenCalled()
    expect(screen.getByText(/at least two letters/)).toBeInTheDocument()
  })

  it('debounces and cancels the stale request when typing fast', async () => {
    const signals: AbortSignal[] = []
    searchEverything.mockImplementation((_q: string, opts: { signal: AbortSignal }) => {
      signals.push(opts.signal)
      return Promise.resolve(RESULT)
    })
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(input(), { target: { value: 'mu' } })
    fireEvent.change(input(), { target: { value: 'mut' } })
    fireEvent.change(input(), { target: { value: 'mutual' } })
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await act(async () => {})
    // Only the last keystroke reached the server.
    expect(searchEverything).toHaveBeenCalledTimes(1)
    expect(searchEverything.mock.calls[0][0]).toBe('mutual')

    // A newer query aborts the one in flight.
    let resolveSlow: (r: SearchResult) => void = () => {}
    searchEverything.mockImplementation((_q: string, opts: { signal: AbortSignal }) => {
      signals.push(opts.signal)
      return new Promise((r) => (resolveSlow = r))
    })
    await type('mutex')
    await type('mutexes')
    expect(signals[1].aborted).toBe(true)
    expect(signals[2].aborted).toBe(false)
    await act(async () => resolveSlow({ query: 'mutexes', groups: [], partial: false }))
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
  })

  it('shows grouped results with the match marked, moves with arrows and opens the exact thing', async () => {
    searchEverything.mockResolvedValue(RESULT)
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await type('mutual')

    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Cards')).toBeInTheDocument()
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(options[0].querySelector('mark')?.textContent).toBe('Mutual')
    expect(input()).toHaveAttribute('aria-activedescendant', options[0].id)

    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowDown' }) // wraps
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'Enter' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe('/operating-systems/deadlock/flashcards?deck=d1')
    // Remembered for next time.
    expect(JSON.parse(localStorage.getItem('sl:recent-searches') ?? '[]')).toEqual(['mutual'])
  })

  it('clicking a note opens it on the notes page', async () => {
    searchEverything.mockResolvedValue(RESULT)
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await type('mutual')
    fireEvent.click(screen.getAllByRole('option')[0])
    expect(screen.getByTestId('where').textContent).toBe('/operating-systems/deadlock/notes?n=n1')
  })

  it('offers recent searches when the box is empty', async () => {
    localStorage.setItem('sl:recent-searches', JSON.stringify(['paging', 'deadlock']))
    searchEverything.mockResolvedValue({ query: 'deadlock', groups: [], partial: false })
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByText('Recent searches')).toBeInTheDocument()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(input()).toHaveValue('deadlock')

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(localStorage.getItem('sl:recent-searches')).toBeNull()
    expect(screen.queryByText('Recent searches')).toBeNull()
  })

  it('says when the server is slow, and offers a retry on error', async () => {
    searchEverything.mockReturnValue(new Promise(() => {}))
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await type('mutual')
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(4000)
    })
    expect(screen.getByText(/server may be waking up/)).toBeInTheDocument()

    searchEverything.mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(RESULT)
    await type('mutually')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    await act(async () => {})
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('reports a partial search', async () => {
    searchEverything.mockResolvedValue({ ...RESULT, partial: true })
    renderPalette()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await type('mutual')
    expect(screen.getByText(/couldn’t be searched just now/)).toBeInTheDocument()
  })
})
