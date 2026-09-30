// @vitest-environment jsdom

/**
 * An empty list's agent says its line and the action sits right under it;
 * the heading stays in the outline either way. With the bots off it is the
 * classic slot — icon, visible title, same button.
 */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { setBotsEnabled } from '../../lib/botPreference'
import { LINES } from '../../lib/botVoice'
import { EmptyState } from './EmptyState'

const bot = () => document.querySelector<SVGSVGElement>('svg.bot')

afterEach(() => {
  cleanup()
  act(() => setBotsEnabled(true))
})

function renderEmpty(surface?: 'phone') {
  return render(
    <EmptyState
      icon="deck"
      title="No decks yet"
      description="Write cards yourself, or have them drafted."
      bot={{ agent: 'cards', say: 'emptyCards', surface }}
      action={<button type="button">Generate a deck</button>}
    />,
  )
}

describe('EmptyState with a bot', () => {
  it('lets the list’s agent say the empty line, keeping the heading and the action', () => {
    renderEmpty()
    expect(bot()?.dataset.agent).toBe('cards')
    const bubble = document.querySelector('.bot-bubble')!.textContent ?? ''
    expect([...LINES.emptyCards.cards!, ...LINES.emptyCards.any!]).toContain(bubble)
    expect(screen.getByRole('heading', { name: 'No decks yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate a deck' })).toBeInTheDocument()
    // The button comes after the bot in reading order: the action is last.
    const order = [bot()!, screen.getByRole('button')]
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never promises a chat on a phone', () => {
    renderEmpty('phone')
    expect(document.querySelector('.bot-bubble')!.textContent).not.toMatch(/chat/i)
  })

  it('is the classic slot with the bots off', () => {
    act(() => setBotsEnabled(false))
    renderEmpty()
    expect(bot()).toBeNull()
    expect(document.querySelector('.bot-bubble')).toBeNull()
    const title = screen.getByRole('heading', { name: 'No decks yet' })
    expect(title).not.toHaveClass('sr-only')
    expect(screen.getByText('Write cards yourself, or have them drafted.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate a deck' })).toBeInTheDocument()
  })
})
