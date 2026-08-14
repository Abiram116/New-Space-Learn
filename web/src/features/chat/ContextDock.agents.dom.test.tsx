// @vitest-environment jsdom
/**
 * `ActiveAgentsStrip` — the mobile/tablet equivalent of the dock's "Do
 * something with this" section, added because the dock itself is `lg:`-only.
 * Before this, a composer comment claimed "agents are already one tap away
 * on the composer's slash pills at every width" while the pills it referred
 * to had actually been removed — below `lg:` there was no way to trigger
 * Notes/Quiz/Flashcard generation from chat at all.
 *
 * This proves the strip renders the same three `AgentKey`s the dock and the
 * composer's typed `/notes` `/quiz` `/flashcards` shortcuts already use, that
 * each button calls `onRunAgent` with the right key, and that the container
 * carries `lg:hidden` — the same mechanism `ActiveSkillStrip` already relies
 * on to appear only below the breakpoint where the dock isn't rendered.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActiveAgentsStrip } from './ContextDock'
import type { AgentKey } from './agents'

describe('ActiveAgentsStrip', () => {
  afterEach(cleanup)

  it('renders a button for every agent, in the order the dock uses', () => {
    render(<ActiveAgentsStrip onRunAgent={() => {}} />)
    // Mirrors ContextDock's own `AGENTS` order (notes, flashcards, quiz) —
    // this is deliberately reading the real labels, not synthetic ones, so a
    // future rename in agents.ts is caught here too.
    expect(screen.getByRole('button', { name: /save a note/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /make cards/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /make a quiz/i })).toBeInTheDocument()
  })

  it('calls onRunAgent with the matching key for each button', async () => {
    const user = userEvent.setup()
    const onRunAgent = vi.fn<(agent: AgentKey) => void>()
    render(<ActiveAgentsStrip onRunAgent={onRunAgent} />)

    await user.click(screen.getByRole('button', { name: /save a note/i }))
    expect(onRunAgent).toHaveBeenLastCalledWith('notes')

    await user.click(screen.getByRole('button', { name: /make cards/i }))
    expect(onRunAgent).toHaveBeenLastCalledWith('flashcards')

    await user.click(screen.getByRole('button', { name: /make a quiz/i }))
    expect(onRunAgent).toHaveBeenLastCalledWith('quiz')

    expect(onRunAgent).toHaveBeenCalledTimes(3)
  })

  it('only shows below the dock breakpoint (`lg:hidden`)', () => {
    const { container } = render(<ActiveAgentsStrip onRunAgent={() => {}} />)
    const root = container.firstElementChild
    expect(root?.className).toMatch(/\blg:hidden\b/)
  })
})
