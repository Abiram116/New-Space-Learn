// @vitest-environment jsdom
/** "Study this note": a quiz or a deck from one note, from the Notes page. */

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Note } from '../../api/types'

const generateQuiz = vi.fn()
const generateCards = vi.fn()
vi.mock('../../api/quizzes', () => ({ generateQuiz: (...a: unknown[]) => generateQuiz(...a) }))
vi.mock('../../api/flashcards', () => ({ generateCards: (...a: unknown[]) => generateCards(...a) }))

import { MakeFromNote, noteHasMaterial } from './MakeFromNote'

const note = (body_md: string): Note =>
  ({ id: 'n1', title: 'Attention', body_md, origin: 'user', source_ids: null, updated_at: '2026-10-01T00:00:00Z' }) as Note

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}
const renderWith = (n: Note) =>
  render(
    <MemoryRouter initialEntries={['/notes']}>
      <ToastProvider>
        <Routes>
          <Route path="/notes" element={<MakeFromNote note={n} topicId="sub" base="/fsd/attention" />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const BODY = 'Attention weighs every token by how well its key matches the query, $softmax(QK^T)$.'

describe('Study this note', () => {
  it('is off for an empty or image-only note', () => {
    expect(noteHasMaterial('![x](data:image/png;base64,AAAA)')).toBe(false)
    renderWith(note('   '))
    expect(screen.getByRole('button', { name: /Study this note/ })).toBeDisabled()
  })

  it('makes a quiz from just this note and opens it', async () => {
    const user = userEvent.setup()
    generateQuiz.mockResolvedValue({ id: 'q9' })
    renderWith(note(BODY))
    await user.click(screen.getByRole('button', { name: /Study this note/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Quiz me on it/ }))
    expect(generateQuiz).toHaveBeenCalledWith('sub', { count: 5, source: 'notes', note_id: 'n1' })
    expect(await screen.findByTestId('where')).toHaveTextContent('/fsd/attention/quizzes?q=q9')
  })

  it('makes cards named after the note, once however fast it is clicked', async () => {
    const user = userEvent.setup()
    let done: (v: unknown) => void = () => {}
    generateCards.mockReturnValue(new Promise((r) => (done = r)))
    renderWith(note(BODY))
    await user.click(screen.getByRole('button', { name: /Study this note/ }))
    const dialog = await screen.findByRole('dialog')
    const make = within(dialog).getByRole('button', { name: /Make cards/ })
    await user.click(make)
    await user.click(make)
    expect(generateCards).toHaveBeenCalledTimes(1)
    expect(generateCards).toHaveBeenCalledWith('sub', { count: 8, source: 'notes', note_id: 'n1', deck_name: 'Attention' })
    done([{ deck_id: 'd7' }])
    expect(await screen.findByTestId('where')).toHaveTextContent('/fsd/attention/flashcards?deck=d7')
  })
})
