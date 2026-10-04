// @vitest-environment jsdom
/**
 * Take and Review open the full page — they don't run inside the narrow
 * sidebar — and carry the mark that lets that page's Back return here.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../../components/ui/Toast'
import { clearCache } from '../../../lib/asyncCache'

const api = vi.hoisted(() => ({ listQuizzes: vi.fn(), generateQuiz: vi.fn(), listDecks: vi.fn(), generateCards: vi.fn() }))
vi.mock('../../../api/quizzes', () => api)
vi.mock('../../../api/flashcards', () => api)

import { CardsPanel } from './CardsPanel'
import { QuizzesPanel } from './QuizzesPanel'

const BASE = '/fsd/t'
const quiz = (id: string, topic: string, best: number | null) => ({
  id, topic, questions: [{}, {}, {}], created_at: '2026-10-01T00:00:00Z', best_score: best,
})

function Where() {
  const l = useLocation()
  return <span data-testid="where">{l.pathname + l.search}</span>
}

const renderPanel = (ui: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[BASE]}>
      <ToastProvider>
        {ui}
        <Where />
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  clearCache()
  vi.clearAllMocks()
})

describe('QuizzesPanel', () => {
  it('opens a quiz as a full page, marked as coming from the chat', async () => {
    api.listQuizzes.mockResolvedValue([quiz('q1', 'Attention basics', null)])
    renderPanel(<QuizzesPanel subspaceId="sub" base={BASE} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /Attention basics/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/t/quizzes?q=q1&from=chat')
  })

  it('says Take for one never taken, Retake for one that was, and lists the weakest first', async () => {
    api.listQuizzes.mockResolvedValue([quiz('a', 'Strong one', 90), quiz('b', 'Weak one', 20), quiz('c', 'Fresh one', null)])
    renderPanel(<QuizzesPanel subspaceId="sub" base={BASE} />)
    const rows = (await screen.findAllByRole('button', { name: /one/ })).map((b) => b.textContent ?? '')
    expect(rows[0]).toContain('Fresh one')
    expect(rows[0]).toContain('Take')
    expect(rows[1]).toContain('Weak one')
    expect(rows[1]).toContain('Retake')
    expect(rows[2]).toContain('Strong one')
  })

  it('opens the quiz it has just made on the full page', async () => {
    api.listQuizzes.mockResolvedValue([])
    api.generateQuiz.mockResolvedValue(quiz('new', 'Fresh', null))
    renderPanel(<QuizzesPanel subspaceId="sub" base={BASE} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /Make a quiz/ }))
    await vi.waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/fsd/t/quizzes?q=new&from=chat'))
  })
})

describe('CardsPanel', () => {
  it('reviews a deck on the full page, and opens a deck from its name', async () => {
    api.listDecks.mockResolvedValue([{ id: 'k1', name: 'Terms', total: 10, due: 4, known_pct: 0 }])
    renderPanel(<CardsPanel subspaceId="sub" base={BASE} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Review 4' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/fsd/t/flashcards?deck=k1&review=deck&from=chat')
  })
})
