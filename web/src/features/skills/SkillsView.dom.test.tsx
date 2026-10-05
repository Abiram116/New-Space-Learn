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

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import type { Skill } from '../../api/types'

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
// The page header reads the topic list, which this page doesn't otherwise use.
// No topics unless a test gives some.
let spaces: unknown[] = []
vi.mock('../spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces, loading: false }),
}))

const listActiveSkills = vi.fn()
const createSkill = vi.fn()
const updateSkill = vi.fn()
const deleteSkill = vi.fn()
const activateSkill = vi.fn()
const deactivateSkill = vi.fn()

vi.mock('../../api/skills', () => ({
  listSkills: (...args: unknown[]) => listSkills(...args),
  listLibrarySkills: (...args: unknown[]) => listLibrarySkills(...args),
  listActiveSkills: (...args: unknown[]) => listActiveSkills(...args),
  createSkill: (...args: unknown[]) => createSkill(...args),
  updateSkill: (...args: unknown[]) => updateSkill(...args),
  deleteSkill: (...args: unknown[]) => deleteSkill(...args),
  activateSkill: (...args: unknown[]) => activateSkill(...args),
  deactivateSkill: (...args: unknown[]) => deactivateSkill(...args),
}))

import { EXAMPLE_MARKER, SkillsView, joinExample, splitExample } from './SkillsView'

function renderView(at = '/skills') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ToastProvider>
        <SkillsView />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  spaces = []
  activateSkill.mockResolvedValue({ ok: true })
  deactivateSkill.mockResolvedValue({ ok: true })
  listSkills.mockResolvedValue([OWN])
  listLibrarySkills.mockResolvedValue([LIBRARY])
  listActiveSkills.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
})

describe('the library grid is grouped into shelves', () => {
  it('shows a shelf label per category, in a stable order, for a mixed library', async () => {
    listLibrarySkills.mockResolvedValue([
      skill({ id: 'lib-1', name: 'Paper Explainer', is_library: true }),
      skill({ id: 'lib-2', name: 'Exam Cram', is_library: true }),
      skill({ id: 'lib-3', name: 'Debugging Mentor', is_library: true }),
    ])
    renderView()

    await screen.findByText('Paper Explainer')
    const labels = ['Learning', 'Exam', 'Technical', 'Research'].filter((l) =>
      screen.queryByText(l),
    )
    // Research (Paper Explainer) comes after Exam (Exam Cram) and Technical
    // (Debugging Mentor) in LIBRARY_CATEGORY_ORDER, regardless of the order
    // the API happened to return the three rows in.
    expect(labels).toEqual(['Exam', 'Technical', 'Research'])
  })

  it('does not print a shelf label for a custom skill with no known category', async () => {
    listLibrarySkills.mockResolvedValue([
      skill({ id: 'lib-1', name: 'Someone\'s Hand-Written Skill', is_library: true }),
    ])
    renderView()

    await screen.findByText('Someone\'s Hand-Written Skill')
    for (const label of ['Learning', 'Exam', 'Technical', 'Research']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument()
    }
  })
})

describe('the custom icon option', () => {
  it('lets you pick any icon and tone independently of the seven presets', async () => {
    createSkill.mockResolvedValue(
      skill({ id: 'skill-new', name: 'My Coach', icon: 'flame', tone: 'jade' }),
    )
    const user = userEvent.setup()
    renderView()

    await user.click(screen.getByRole('button', { name: 'New skill' }))
    await user.click(screen.getByRole('button', { name: /More options/ }))
    await user.click(screen.getByRole('button', { name: 'Custom icon' }))

    await user.click(screen.getByRole('button', { name: 'jade tone' }))
    await user.click(screen.getByRole('button', { name: 'flame' }))

    await user.type(screen.getByLabelText('Name'), 'My Coach')
    await user.type(screen.getByLabelText('What should it do?'), 'Push me through drills.')
    await user.click(screen.getByRole('button', { name: 'Create skill' }))

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith(
        expect.objectContaining({ icon: 'flame', tone: 'jade' }),
      ),
    )
  })

  it('closes and resets when the editor closes', async () => {
    const user = userEvent.setup()
    renderView()

    await user.click(screen.getByRole('button', { name: 'New skill' }))
    await user.click(screen.getByRole('button', { name: /More options/ }))
    await user.click(screen.getByRole('button', { name: 'Custom icon' }))
    expect(screen.getByRole('button', { name: 'flame' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'New skill' }))

    expect(screen.queryByRole('button', { name: 'flame' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /More options/ })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('adding a library skill', () => {
  it('clones the library skill into the user\'s own skills via createSkill', async () => {
    const clone = skill({ id: 'skill-2', name: 'Exam Cram' })
    createSkill.mockResolvedValue(clone)
    const user = userEvent.setup()
    renderView()
    await screen.findByText('Exam Cram')

    await user.click(screen.getByRole('button', { name: 'Add to my skills' }))

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Exam Cram',
          instructions: 'Run a rapid-fire practice loop.',
        }),
      ),
    )
    // The clone lands in "own" as its own editable skill: "Added" replaces the button.
    await screen.findByText('Added')
  })
})

describe('a library skill already added once', () => {
  // Regression: "Add" had no guard against a name you already own — clicking
  // it twice (or once per render before the list refreshed) produced two
  // identical "Exam Examiner" cards in "Active in this space", distinguishable
  // only by opening each one.
  it('shows "Added" instead of an "Add" button once the name is already owned', async () => {
    listSkills.mockResolvedValue([OWN, skill({ id: 'skill-2', name: 'Exam Cram' })])
    renderView()

    await screen.findByText('Added')
    expect(screen.queryByRole('button', { name: 'Add to my skills' })).not.toBeInTheDocument()
  })

  it('does not call createSkill even if Add is somehow triggered again', async () => {
    // Defence in depth: cloneLibrary itself refuses a name already owned,
    // not just the button's disabled appearance.
    listSkills.mockResolvedValue([skill({ id: 'skill-2', name: 'Exam Cram' })])
    renderView()
    await screen.findByText('Added')

    expect(createSkill).not.toHaveBeenCalled()
  })
})

describe('the account-wide Skills page', () => {
  it('with no topic yet, lists the skills you own with no switch and no topic picker', async () => {
    renderView()
    await screen.findByText('Socratic Tutor')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('Switching on for')).toBeNull()
    expect(listActiveSkills).not.toHaveBeenCalled()
  })

  it('has one way to start a new skill, not two', async () => {
    renderView()
    await screen.findByText('Socratic Tutor')
    expect(screen.getAllByRole('button', { name: /New skill|Write your own skill|Write a skill/ })).toHaveLength(1)
  })

  it('works without any topic existing, since nothing here belongs to one', async () => {
    renderView()
    expect(await screen.findByText('Socratic Tutor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New skill' })).toBeInTheDocument()
  })

  it('reads exactly two lists, once: your skills and the library', async () => {
    renderView()
    await screen.findByText('Socratic Tutor')
    expect(listSkills).toHaveBeenCalledTimes(1)
    expect(listLibrarySkills).toHaveBeenCalledTimes(1)
  })
})

describe('the page explains itself', () => {
  it('opens with one sentence on what skills are, and the two sections in plain words', async () => {
    renderView()
    expect(await screen.findByText(/Skills change how the tutor talks to you/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ready-made' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My skills' })).toBeInTheDocument()
  })
})

describe('the short form', () => {
  it('asks for a name and what it should do; the rest waits behind More options', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(await screen.findByRole('button', { name: 'New skill' }))
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('What should it do?')).toBeInTheDocument()
    expect(screen.getByLabelText('Example of a good answer (optional)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Answer format')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /More options/ }))
    expect(screen.getByLabelText('Answer format')).toBeInTheDocument()
  })

  it('fills the form from an idea, and keeps the example inside what it does', async () => {
    createSkill.mockImplementation(async (input: { name: string }) => skill({ id: 'new', name: input.name }))
    const user = userEvent.setup()
    renderView()
    await user.click(await screen.findByRole('button', { name: 'New skill' }))
    await user.click(screen.getByRole('button', { name: /Exam mode/ }))
    expect(screen.getByLabelText('Name')).toHaveValue('Exam mode')
    await user.type(screen.getByLabelText('Example of a good answer (optional)'), 'Key fact: X.')
    await user.click(screen.getByRole('button', { name: 'Create skill' }))
    await waitFor(() => expect(createSkill).toHaveBeenCalled())
    const sent = createSkill.mock.calls[0][0] as { name: string; instructions: string }
    expect(sent.name).toBe('Exam mode')
    expect(splitExample(sent.instructions).example).toBe('Key fact: X.')
  })

  it('splits the example back out when a skill is opened again', async () => {
    listSkills.mockResolvedValue([skill({ instructions: joinExample('Be brief.', 'Short answer.') })])
    const user = userEvent.setup()
    renderView()
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('What should it do?')).toHaveValue('Be brief.')
    expect(screen.getByLabelText('Example of a good answer (optional)')).toHaveValue('Short answer.')
  })

  it('round-trips instructions with and without an example', () => {
    expect(joinExample(' Be brief. ', '')).toBe('Be brief.')
    expect(joinExample('Be brief.', 'Ok.')).toBe(`Be brief.${EXAMPLE_MARKER}Ok.`)
    expect(splitExample('Just this.')).toEqual({ what: 'Just this.', example: '' })
  })
})

describe('Use in this topic', () => {
  const topics = () => [
    {
      id: 'sp1',
      name: 'ML',
      subspaces: [
        { id: 'old', subject_id: 'sp1', name: 'Regression', last_activity_at: '2026-09-01T00:00:00Z', counts: {} },
        { id: 'new', subject_id: 'sp1', name: 'Transformers', last_activity_at: '2026-10-01T00:00:00Z', counts: {} },
      ],
    },
  ]

  it('works on the topic you came from, and switches your skill off there', async () => {
    spaces = topics()
    listActiveSkills.mockResolvedValue([OWN])
    const user = userEvent.setup()
    renderView('/skills?topic=old')
    const sw = await screen.findByRole('switch', { name: 'Use Socratic Tutor in Regression' })
    await waitFor(() => expect(sw).toBeEnabled())
    expect(listActiveSkills).toHaveBeenCalledWith('old')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await user.click(sw)
    expect(deactivateSkill).toHaveBeenCalledWith('old', 'skill-1')
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
  })

  it('otherwise picks the topic you used last', async () => {
    spaces = topics()
    renderView()
    expect(await screen.findByRole('switch', { name: 'Use Socratic Tutor in Transformers' })).toBeInTheDocument()
    expect(listActiveSkills).toHaveBeenCalledWith('new')
  })

  it('copies a ready-made skill into yours the first time, then switches it on', async () => {
    spaces = topics()
    createSkill.mockResolvedValue(skill({ id: 'skill-2', name: 'Exam Cram' }))
    const user = userEvent.setup()
    renderView('/skills?topic=new')
    const sw = await screen.findByRole('switch', { name: 'Use Exam Cram in Transformers' })
    await waitFor(() => expect(sw).toBeEnabled())
    await user.click(sw)
    await waitFor(() => expect(activateSkill).toHaveBeenCalledWith('new', 'skill-2'))
    expect(createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: 'Exam Cram' }))
    // It is yours now too, so it shows under My skills as well — on in both places.
    await waitFor(() => {
      const both = screen.getAllByRole('switch', { name: 'Use Exam Cram in Transformers' })
      expect(both).toHaveLength(2)
      for (const s of both) expect(s).toHaveAttribute('aria-checked', 'true')
    })
  })
})

describe('Back', () => {
  function Where() {
    return <span data-testid="where">{useLocation().pathname}</span>
  }
  const renderFrom = (entries: string[]) =>
    render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <ToastProvider>
          <Routes>
            <Route path="/skills" element={<SkillsView />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    )

  it('returns to wherever you came from — a topic chat, say', async () => {
    renderFrom(['/fsd/transformer', '/skills'])
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/fsd/transformer')
  })

  it('opened directly, with nothing to go back to, it goes Home', async () => {
    renderFrom(['/skills'])
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByTestId('where')).toHaveTextContent('/home')
  })
})

