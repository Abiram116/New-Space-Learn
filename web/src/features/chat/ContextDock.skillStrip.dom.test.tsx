// @vitest-environment jsdom
/**
 * Below `lg:` there is no dock, so the strip above the composer is where a
 * skill gets turned on or off — it opens the same section in a dialog.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
vi.mock('../../api/documents', () => ({ listDocuments: vi.fn(), uploadDocument: vi.fn() }))

import { ActiveSkillStrip } from './ContextDock'

const skill = (id: string, name: string) => ({
  id,
  name,
  icon: 'skill',
  tone: 'brand' as const,
  description: null,
  instructions: 'x',
  capabilities: [],
  memory_scope: 'session' as const,
  output_format: null,
  is_library: false,
})

function renderStrip() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ActiveSkillStrip subspaceId="sub-1" />
      </ToastProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearCache()
  api.listSkills.mockResolvedValue([skill('s1', 'Compare')])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ActiveSkillStrip', () => {
  it('shows what is on and lets you change it in a dialog', async () => {
    api.listActiveSkills.mockResolvedValue([skill('s1', 'Compare')])
    const user = userEvent.setup()
    renderStrip()
    expect(await screen.findByText('Skills on')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Answer style')
  })

  it('offers to turn one on when nothing is, and re-reads the list when the dialog closes', async () => {
    api.listActiveSkills.mockResolvedValue([])
    const user = userEvent.setup()
    renderStrip()
    await user.click(await screen.findByRole('button', { name: 'Turn one on' }))
    await screen.findByRole('dialog')
    await vi.waitFor(() => expect(api.listActiveSkills).toHaveBeenCalledTimes(2)) // strip + the dialog's own list

    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(api.listActiveSkills).toHaveBeenCalledTimes(3)) // the strip reads again
  })
})
