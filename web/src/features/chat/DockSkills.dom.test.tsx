// @vitest-environment jsdom
/**
 * The dock's Skills section: turn skills on and off without leaving the chat,
 * and only pay for the skill library when someone opens the picker.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '../../api/types'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'

const api = vi.hoisted(() => ({
  listActiveSkills: vi.fn(),
  listSkills: vi.fn(),
  listLibrarySkills: vi.fn(),
  activateSkill: vi.fn(),
  deactivateSkill: vi.fn(),
}))
vi.mock('../../api/skills', () => api)

import { DockSkills } from './DockSkills'

const skill = (id: string, name: string, extra: Partial<Skill> = {}): Skill => ({
  id,
  name,
  icon: 'skill',
  tone: 'brand',
  description: `${name} description`,
  instructions: 'x',
  capabilities: [],
  memory_scope: 'session',
  output_format: null,
  is_library: false,
  ...extra,
})

const COMPARE = skill('s1', 'Compare & Contrast')
// Skills you have added to your own collection (library skills become these when added).
const FEYNMAN = skill('s2', 'Feynman Tutor')
const EXAM = skill('s3', 'Exam Cram')

function renderDock() {
  return render(
    <MemoryRouter initialEntries={['/fsd/transformer']}>
      <ToastProvider>
        <DockSkills subspaceId="sub-1" />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearCache()
  api.listActiveSkills.mockResolvedValue([COMPARE])
  api.listSkills.mockResolvedValue([COMPARE, FEYNMAN, EXAM])
  api.listLibrarySkills.mockResolvedValue([])
  api.activateSkill.mockResolvedValue({ ok: true })
  api.deactivateSkill.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DockSkills', () => {
  it('names the section in plain words and links to the full page', async () => {
    renderDock()
    expect(await screen.findByText('Compare & Contrast')).toBeInTheDocument()
    expect(screen.getByText('How the AI answers')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add more/ })).toHaveAttribute('href', '/skills')
  })

  it('fetches your skills only when the picker is opened, and never the library', async () => {
    const user = userEvent.setup()
    renderDock()
    await screen.findByText('Compare & Contrast')
    expect(api.listSkills).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /Turn on a skill/ }))
    await screen.findByText('Feynman Tutor')
    expect(api.listSkills).toHaveBeenCalledTimes(1)
    expect(api.listLibrarySkills).not.toHaveBeenCalled()
    // Already-on skills are not offered again.
    expect(screen.queryAllByText('Compare & Contrast')).toHaveLength(1)
  })

  it('points to the library when you have added no skills yet', async () => {
    api.listActiveSkills.mockResolvedValue([])
    api.listSkills.mockResolvedValue([])
    const user = userEvent.setup()
    renderDock()
    await screen.findByText(/No skill on/)
    await user.click(screen.getByRole('button', { name: /Turn on a skill/ }))
    expect(await screen.findByRole('link', { name: /Browse the library/ })).toHaveAttribute('href', '/skills')
  })

  it('turns a skill on from the picker, straight away', async () => {
    const user = userEvent.setup()
    renderDock()
    await screen.findByText('Compare & Contrast')
    await user.click(screen.getByRole('button', { name: /Turn on a skill/ }))
    await screen.findByText('Feynman Tutor')

    await user.click(screen.getAllByRole('button', { name: 'Turn on' })[0])
    expect(api.activateSkill).toHaveBeenCalledWith('sub-1', 's2')
    // It moves from the picker into the active list at once.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn off Feynman Tutor' })).toBeInTheDocument())
  })

  it('turns a skill off, and puts it back if the server refuses', async () => {
    const user = userEvent.setup()
    api.deactivateSkill.mockRejectedValueOnce(new Error('nope'))
    renderDock()
    await screen.findByText('Compare & Contrast')

    await user.click(screen.getByRole('button', { name: 'Turn off Compare & Contrast' }))
    expect(api.deactivateSkill).toHaveBeenCalledWith('sub-1', 's1')
    await waitFor(() => expect(screen.getByText('Compare & Contrast')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Turn off Compare & Contrast' })).toBeEnabled()
  })

  it('says so when nothing is on', async () => {
    api.listActiveSkills.mockResolvedValue([])
    renderDock()
    expect(await screen.findByText(/No skill on/)).toBeInTheDocument()
  })
})
