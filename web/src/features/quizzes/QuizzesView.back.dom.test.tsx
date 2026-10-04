// @vitest-environment jsdom
/**
 * Where "Back" goes from a quiz depends on where it was opened.
 *
 * From the chat sidebar (`?from=chat`) it goes to that topic's chat, with the
 * sidebar panel the person left open. From the global list, or a link opened
 * directly, it goes back to the list. Two different places, so two tests.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { AssessmentProvider } from '../../lib/assessment'
import type { Quiz, Space, Subspace } from '../../api/types'

const SUB: Subspace = { id: 'sub-a', subject_id: 'space-a', name: 'Attention', last_activity_at: null, counts: {} }
const SPACE: Space = { id: 'space-a', name: 'FSD', tone: 'brand', pinned: false, subspaces: [SUB] }
const BASE = '/fsd/attention'

vi.mock('../../lib/useTopicScope', () => ({ useTopicScope: () => ({ space: SPACE, subspace: SUB, base: BASE, isGlobal: false }) }))
vi.mock('../spaces/SpacesProvider', () => ({ useSpaces: () => ({ spaces: [SPACE] }) }))

const quiz: Quiz = {
  id: '6c114e4a-d302-4a1c-9a3e-1b5f6a7c8d90',
  topic: 'Self-attention',
  questions: [{ q: 'What is Q?', choices: ['a', 'b', 'c', 'd'], answer_index: 0 }],
  created_at: new Date().toISOString(),
  subspace_id: SUB.id,
  subspace_name: SUB.name,
  subject_name: SPACE.name,
}

vi.mock('../../api/quizzes', () => ({
  listAllQuizzes: () => Promise.resolve([quiz]),
  listQuizzes: vi.fn(),
  getQuiz: () => Promise.resolve(quiz),
  generateQuiz: vi.fn(),
  submitQuiz: vi.fn(),
}))

import { QuizzesView } from './QuizzesView'

function Where() {
  const l = useLocation()
  return (
    <>
      <span data-testid="where">{l.pathname + l.search}</span>
      <span data-testid="state">{JSON.stringify(l.state)}</span>
    </>
  )
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <AssessmentProvider>
          <QuizzesView />
          <Where />
        </AssessmentProvider>
      </ToastProvider>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe('Back from a quiz', () => {
  it('opened from the chat sidebar: says "Back to chat" and returns to that chat with the Quizzes panel open', async () => {
    renderAt(`${BASE}/quizzes?q=${quiz.id}&from=chat`)
    const back = await screen.findByRole('button', { name: /Back to chat/ })
    await userEvent.setup().click(back)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`${BASE}`))
    expect(screen.getByTestId('where').textContent).toBe(BASE)
    expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ dockPanel: 'quizzes' })
  })

  it('opened from the list: says "All quizzes" and goes back to the list', async () => {
    renderAt(`${BASE}/quizzes?q=${quiz.id}`)
    const back = await screen.findByRole('button', { name: /All quizzes/ })
    expect(screen.queryByRole('button', { name: /Back to chat/ })).not.toBeInTheDocument()
    await userEvent.setup().click(back)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`${BASE}/quizzes`))
  })
})
