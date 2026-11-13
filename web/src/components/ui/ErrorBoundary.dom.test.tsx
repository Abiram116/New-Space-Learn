// @vitest-environment jsdom
/**
 * What a student sees when a page throws while drawing: a calm card in place
 * of that page, a way out, and — when the cause is a screen whose code is no
 * longer on the server — the one action that actually fixes it.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

let broken: Error | null = null
function Page({ name }: { name: string }) {
  if (broken) throw broken
  return <p>{name} page</p>
}

beforeEach(() => {
  // React logs every caught render error; the boundary logs it again.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  broken = null
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows the card instead of the page, and Try again draws the page once it can', () => {
    broken = new Error('boom')
    render(
      <ErrorBoundary>
        <Page name="Notes" />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Something went sideways' })).toBeInTheDocument()
    broken = null
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Notes page')).toBeInTheDocument()
  })

  it('clears when the student goes to another page', () => {
    broken = new Error('boom')
    const { rerender } = render(
      <ErrorBoundary resetKey="/notes">
        <Page name="Notes" />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Something went sideways' })).toBeInTheDocument()
    broken = null
    rerender(
      <ErrorBoundary resetKey="/quizzes">
        <Page name="Quizzes" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Quizzes page')).toBeInTheDocument()
  })

  it('offers only a reload when the page’s code could not be fetched', () => {
    broken = new TypeError('Failed to fetch dynamically imported module: https://x.test/assets/NotesView-abc.js')
    render(
      <ErrorBoundary>
        <Page name="Notes" />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'This page needs a reload' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it.each([
    ['error loading dynamically imported module', true],
    ['Importing a module script failed.', true],
    ['Unable to preload CSS for /assets/x.css', true],
    ["Cannot read properties of undefined (reading 'map')", false],
  ])('%s → reload only: %s', (message, stale) => {
    broken = new TypeError(message)
    render(
      <ErrorBoundary>
        <Page name="Notes" />
      </ErrorBoundary>,
    )
    expect(screen.queryByRole('button', { name: 'Try again' }) === null).toBe(stale)
  })
})
