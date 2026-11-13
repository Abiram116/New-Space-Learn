// @vitest-environment jsdom
/**
 * Adding material on a phone: a sheet with "Take a photo" (rear camera) and
 * "Choose from files", multi-shot capture, clear per-row ingestion states, and
 * a friendly empty state.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Space, Subspace } from '../../api/types'
import { mockPhone } from '../quizzes/phoneTestUtils'

const base = {
  mime_type: 'application/pdf',
  size_bytes: 1024,
  error: null,
  created_at: new Date().toISOString(),
  ready_at: null,
}
const listDocuments = vi.fn()
const uploadDocument = vi.fn()
vi.mock('../../api/documents', () => ({
  listDocuments: (...a: unknown[]) => listDocuments(...a),
  deleteDocument: vi.fn(),
  reprocessDocument: vi.fn(),
  uploadDocument: (...a: unknown[]) => uploadDocument(...a),
}))
vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({
    space: { id: 'sp', name: 'CS', tone: 'brand' } as Space,
    subspace: { id: 'sub', subject_id: 'sp', name: 'Attention' } as Subspace,
    base: '/spaces/sp/sub',
  }),
}))
vi.mock('../spaces/RelatedTopics', () => ({ RelatedTopics: () => null }))

import { DocsView } from './DocsView'

let restore: () => void
beforeEach(() => {
  restore = mockPhone()
})
afterEach(() => {
  cleanup()
  restore()
  vi.clearAllMocks()
})

const renderView = (entry = '/') =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={[entry]}>
        <DocsView />
      </MemoryRouter>
    </ToastProvider>,
  )

describe('phone Add a file', () => {
  it('the empty state speaks to the student and offers photo + files up front', async () => {
    listDocuments.mockResolvedValue([])
    renderView()
    await waitFor(() =>
      expect(screen.getByText(/Snap your notes or add a PDF, and I’ll turn them into cards and quizzes\./)).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Take a photo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choose from files/ })).toBeInTheDocument()
  })

  it('the camera input asks for the rear camera and images only', async () => {
    listDocuments.mockResolvedValue([])
    renderView()
    await waitFor(() => expect(screen.getByTestId('camera-input')).toBeInTheDocument())
    const cam = screen.getByTestId('camera-input')
    expect(cam).toHaveAttribute('accept', 'image/*')
    expect(cam).toHaveAttribute('capture', 'environment')
    const files = screen.getByTestId('file-input')
    expect(files).toHaveAttribute('multiple')
    expect(files.getAttribute('accept')).toMatch(/pdf/)
  })

  it('photos upload as they are taken and the sheet stays open for the next one', async () => {
    const user = userEvent.setup()
    listDocuments.mockResolvedValue([{ ...base, id: 'd1', name: 'chapter.pdf', status: 'ready' }])
    uploadDocument.mockResolvedValue({ ...base, id: 'd2', name: 'Photo', status: 'processing', mime_type: 'image/jpeg' })
    renderView()
    await waitFor(() => expect(screen.getByText('chapter.pdf')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Add a file/ }))
    const sheet = await screen.findByRole('dialog', { name: 'Add a file' })
    expect(within(sheet).getByRole('button', { name: /Take a photo/ })).toBeInTheDocument()

    const shot = new File(['x'], 'image.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByTestId('camera-input'), { target: { files: [shot] } })
    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1))
    expect(uploadDocument.mock.calls[0][1].name).toMatch(/^Photo /)
    // Ready for the next page without reopening anything.
    expect(await within(sheet).findByRole('button', { name: /Take another photo/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('status')).toHaveTextContent('1 photo added')
  })

  it('shows one clear state per row: reading a photo, ready, failed with a retry', async () => {
    listDocuments.mockResolvedValue([
      { ...base, id: 'a', name: 'page.jpg', mime_type: 'image/jpeg', status: 'processing', progress: 0.5 },
      { ...base, id: 'b', name: 'notes.pdf', status: 'ready' },
      { ...base, id: 'c', name: 'bad.pdf', status: 'failed', error: 'Could not read that file.' },
    ])
    renderView()
    await waitFor(() => expect(screen.getByText('page.jpg')).toBeInTheDocument())
    expect(screen.getByText('Reading your photo · 50%')).toBeInTheDocument()
    expect(screen.getByText('Ready for questions')).toBeInTheDocument()
    expect(screen.getByText('Could not read that file.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('?add=1 opens the Add a file sheet straight away', async () => {
    listDocuments.mockResolvedValue([{ ...base, id: 'd1', name: 'chapter.pdf', status: 'ready' }])
    renderView('/?add=1')
    const sheet = await screen.findByRole('dialog', { name: 'Add a file' })
    expect(within(sheet).getByRole('button', { name: /Take a photo/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /Choose from files/ })).toBeInTheDocument()
  })

  it('without ?add=1 the sheet stays closed', async () => {
    listDocuments.mockResolvedValue([{ ...base, id: 'd1', name: 'chapter.pdf', status: 'ready' }])
    renderView()
    await waitFor(() => expect(screen.getByText('chapter.pdf')).toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Add a file' })).not.toBeInTheDocument()
  })
})
