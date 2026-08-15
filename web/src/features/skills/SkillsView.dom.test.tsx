// @vitest-environment jsdom
/**
 * The Skills screen, mounted for real, driving the two flows the backend
 * audit flagged as untested at the contract level (not just "the UI's own
 * state changed"):
 *
 *  - Toggling a skill's switch calls the real activate/deactivate endpoint
 *    for THIS subspace, and — because the toggle is optimistic — rolls the
 *    switch back to its previous position when that call fails, rather than
 *    leaving the UI showing a state the server never actually reached.
 *  - "Add" on a library skill clones it into the user's own skills via a
 *    real `createSkill` call carrying the library row's fields, and the
 *    clone then shows up in "own" — the library card itself is never
 *    mutated (it has no activate/toggle control of its own).
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Skill, Space, Subspace } from '../../api/types'

// jsdom has no layout engine and doesn't implement matchMedia — SkillsView's
// `useIsWide` (which branches the editor between a side panel and a modal)
// calls it on every render. Not needed for what these tests exercise, but
// required for the component to mount at all under jsdom.
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

const SUBSPACE: Subspace = {
  id: 'subspace-1',
  subject_id: 'space-1',
  name: 'Attention',
  last_activity_at: null,
  counts: {},
}
const SPACE: Space = { id: 'space-1', name: 'CS', tone: 'brand', pinned: false, subspaces: [] }

vi.mock('../../lib/nav', () => ({
  useActiveSubspace: () => ({ space: SPACE, subspace: SUBSPACE, base: '/spaces/space-1/subspace-1' }),
}))

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    name: 'Socratic Tutor',
    icon: 'skill',
    tone: 'brand',
    description: 'Asks guiding questions.',
    instructions: 'Ask one guiding question at a time.',
    capabilities: [],
    memory_scope: 'session',
    output_format: null,
    is_library: false,
    ...overrides,
  }
}

const OWN = skill()
const LIBRARY = skill({
  id: 'lib-1',
  name: 'Exam Cram',
  description: 'Rapid-fire recall.',
  instructions: 'Run a rapid-fire practice loop.',
  is_library: true,
})

const listSkills = vi.fn()
const listLibrarySkills = vi.fn()
const listActiveSkills = vi.fn()
const activateSkill = vi.fn()
const deactivateSkill = vi.fn()
const createSkill = vi.fn()
const updateSkill = vi.fn()
const deleteSkill = vi.fn()

vi.mock('../../api/skills', () => ({
  listSkills: (...args: unknown[]) => listSkills(...args),
  listLibrarySkills: (...args: unknown[]) => listLibrarySkills(...args),
  listActiveSkills: (...args: unknown[]) => listActiveSkills(...args),
  activateSkill: (...args: unknown[]) => activateSkill(...args),
  deactivateSkill: (...args: unknown[]) => deactivateSkill(...args),
  createSkill: (...args: unknown[]) => createSkill(...args),
  updateSkill: (...args: unknown[]) => updateSkill(...args),
  deleteSkill: (...args: unknown[]) => deleteSkill(...args),
}))

import { SkillsView } from './SkillsView'

function renderView() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SkillsView />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listSkills.mockResolvedValue([OWN])
  listLibrarySkills.mockResolvedValue([LIBRARY])
  listActiveSkills.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
})

describe('activating a skill', () => {
  it('calls activateSkill for this subspace and shows the switch on', async () => {
    const user = userEvent.setup()
    renderView()
    const toggle = await screen.findByRole('switch', { name: 'Enable Socratic Tutor' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await user.click(toggle)

    await waitFor(() => expect(activateSkill).toHaveBeenCalledWith('subspace-1', 'skill-1'))
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  it('rolls the switch back off when the server call fails', async () => {
    // The toggle flips immediately (optimistic) before the request resolves.
    // A rejected request must not leave the switch showing "on" for a skill
    // that was never actually activated on the server.
    activateSkill.mockRejectedValue(new Error('network error'))
    const user = userEvent.setup()
    renderView()
    const toggle = await screen.findByRole('switch', { name: 'Enable Socratic Tutor' })

    await user.click(toggle)

    await waitFor(() => expect(activateSkill).toHaveBeenCalled())
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
  })

  it('calls deactivateSkill when switching an already-active skill off', async () => {
    listActiveSkills.mockResolvedValue([OWN])
    const user = userEvent.setup()
    renderView()
    const toggle = await screen.findByRole('switch', { name: 'Enable Socratic Tutor' })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))

    await user.click(toggle)

    await waitFor(() => expect(deactivateSkill).toHaveBeenCalledWith('subspace-1', 'skill-1'))
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })
})

describe('adding a library skill', () => {
  it('clones the library skill into the user\'s own skills via createSkill', async () => {
    const clone = skill({ id: 'skill-2', name: 'Exam Cram' })
    createSkill.mockResolvedValue(clone)
    const user = userEvent.setup()
    renderView()
    await screen.findByText('Exam Cram')

    await user.click(screen.getByRole('button', { name: 'Add →' }))

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Exam Cram',
          instructions: 'Run a rapid-fire practice loop.',
        }),
      ),
    )
    // The clone lands in "own" as its own editable skill — a second
    // "Enable Exam Cram" switch, distinct from the library card (which has
    // no switch of its own).
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Enable Exam Cram' })).toBeInTheDocument(),
    )
  })
})
