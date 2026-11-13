// @vitest-environment jsdom
/**
 * "New subject" makes a subject and, optionally, its first topic — two
 * requests. When the second failed the dialog stayed open with the error, and
 * pressing Create again made the SUBJECT again: two "Biology" rows in the rail
 * for one attempt.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIMITS } from '../../lib/limits'

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const createSpace = vi.fn()
const addSubspace = vi.fn()
vi.mock('./SpacesProvider', () => ({
  useSpaces: () => ({ createSpace, addSubspace }),
}))

import { NewSpaceModal } from './NewSpaceModal'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const BIOLOGY = { id: 'space-9', name: 'Biology', tone: 'brand', pinned: false, subspaces: [] }

describe('New subject', () => {
  it('does not make the subject twice when only the first topic failed', async () => {
    createSpace.mockResolvedValue(BIOLOGY)
    addSubspace.mockRejectedValueOnce(new Error('offline'))
    addSubspace.mockResolvedValue({ id: 'sub-9', subject_id: 'space-9', name: 'Cells', last_activity_at: null, counts: {} })
    const onClose = vi.fn()
    const onCreated = vi.fn()
    const user = userEvent.setup()
    render(<NewSpaceModal open onClose={onClose} onCreated={onCreated} />)

    await user.type(screen.getByLabelText('Subject'), 'Biology')
    await user.type(screen.getByLabelText('First topic (optional)'), 'Cells')
    await user.click(screen.getByRole('button', { name: 'Create subject' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Create subject' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(createSpace).toHaveBeenCalledTimes(1)
    expect(addSubspace).toHaveBeenCalledTimes(2)
    expect(addSubspace).toHaveBeenLastCalledWith('space-9', 'Cells')
    expect(onCreated).toHaveBeenCalledWith('space-9')
  })

  it('makes a new subject if the name was changed before retrying', async () => {
    createSpace.mockResolvedValueOnce(BIOLOGY).mockResolvedValueOnce({ ...BIOLOGY, id: 'space-10', name: 'Biology 2' })
    addSubspace.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'sub-9' })
    const user = userEvent.setup()
    render(<NewSpaceModal open onClose={vi.fn()} />)

    await user.type(screen.getByLabelText('Subject'), 'Biology')
    await user.type(screen.getByLabelText('First topic (optional)'), 'Cells')
    await user.click(screen.getByRole('button', { name: 'Create subject' }))
    await screen.findByRole('alert')

    await user.type(screen.getByLabelText('Subject'), ' 2')
    await user.click(screen.getByRole('button', { name: 'Create subject' }))

    await waitFor(() => expect(createSpace).toHaveBeenCalledTimes(2))
    expect(addSubspace).toHaveBeenLastCalledWith('space-10', 'Cells')
  })

  it('names the first topic after the subject when none is given, and hands both back', async () => {
    const cells = { id: 'sub-9', name: 'Biology', last_activity_at: null, counts: {} }
    createSpace.mockResolvedValue(BIOLOGY)
    addSubspace.mockResolvedValue(cells)
    const onTopicCreated = vi.fn()
    const user = userEvent.setup()
    render(<NewSpaceModal open onClose={vi.fn()} onTopicCreated={onTopicCreated} />)

    expect(screen.getByText(/A subject is a course/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Subject'), 'Biology')
    await user.click(screen.getByRole('button', { name: 'Create subject' }))

    await waitFor(() => expect(onTopicCreated).toHaveBeenCalledWith({ space: BIOLOGY, subspace: cells }))
    expect(addSubspace).toHaveBeenCalledWith('space-9', 'Biology')
  })

  it('stops both names at the length the server accepts', () => {
    render(<NewSpaceModal open onClose={vi.fn()} />)

    expect(screen.getByLabelText('Subject')).toHaveAttribute('maxlength', String(LIMITS.spaceName))
    expect(screen.getByLabelText('First topic (optional)')).toHaveAttribute('maxlength', String(LIMITS.subspaceName))
  })
})
