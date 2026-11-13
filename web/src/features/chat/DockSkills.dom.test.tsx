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
  it('names the section in plain words and shows what is on as a chip', async () => {
    renderDock()
    expect(await screen.findByText('Compare & Contrast')).toBeInTheDocument()
    expect(screen.getByText('How I answer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('fetches your skills only when Change is pressed, and never the library', async () => {
    const user = userEvent.setup()
    renderDock()
    await screen.findByText('Compare & Contrast')
    expect(api.listSkills).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await screen.findByText('Feynman Tutor')
    expect(api.listSkills).toHaveBeenCalledTimes(1)
    expect(api.listLibrarySkills).not.toHaveBeenCalled()
    // Each of your skills has one switch, and the one that's on says so.
    expect(screen.getByRole('switch', { name: 'Compare & Contrast' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Feynman Tutor' })).toHaveAttribute('aria-checked', 'false')
  })

  it('points to the Skills page, for this topic, when you have no skills yet', async () => {
    api.listActiveSkills.mockResolvedValue([])
    api.listSkills.mockResolvedValue([])
    const user = userEvent.setup()
    renderDock()
    await screen.findByText('Normal')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByRole('link', { name: /Pick a ready-made one/ })).toHaveAttribute('href', '/skills?topic=sub-1')
  })

  it('turns a skill on from the list, straight away', async () => {
    const user = userEvent.setup()
    renderDock()
    await screen.findByText('Compare & Contrast')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(await screen.findByRole('switch', { name: 'Feynman Tutor' }))
    expect(api.activateSkill).toHaveBeenCalledWith('sub-1', 's2')
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Feynman Tutor' })).toHaveAttribute('aria-checked', 'true'))
    // And the chip shows it at once.
    expect(screen.getAllByText('Feynman Tutor')).toHaveLength(2)
  })

  it('turns a skill off, and puts it back if the server refuses', async () => {
    const user = userEvent.setup()
    api.deactivateSkill.mockRejectedValueOnce(new Error('nope'))
    renderDock()
    await screen.findByText('Compare & Contrast')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(await screen.findByRole('switch', { name: 'Compare & Contrast' }))
    expect(api.deactivateSkill).toHaveBeenCalledWith('sub-1', 's1')
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Compare & Contrast' })).toHaveAttribute('aria-checked', 'true'),
    )
    expect(screen.getByRole('switch', { name: 'Compare & Contrast' })).toBeEnabled()
  })

  it('says Normal, and what that means, when nothing is on', async () => {
    api.listActiveSkills.mockResolvedValue([])
    renderDock()
    expect(await screen.findByText('Normal')).toBeInTheDocument()
    expect(screen.getByText(/Plain, direct answers/)).toBeInTheDocument()
  })

  it('links to more skills with this topic picked', async () => {
    const user = userEvent.setup()
    renderDock()
    await screen.findByText('Compare & Contrast')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByRole('link', { name: /Find more skills/ })).toHaveAttribute('href', '/skills?topic=sub-1')
  })
})
