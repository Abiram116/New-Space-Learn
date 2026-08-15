// @vitest-environment jsdom
/**
 * The Copy control added beside the thumbs — copies the answer's own text,
 * not a feedback signal, so it must never touch `sendFeedback` and must
 * survive a thumbs-up/down being given right after.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeedbackChips } from './FeedbackChips'

vi.mock('../../api/feedback', () => ({
  sendFeedback: vi.fn().mockResolvedValue(undefined),
}))

// jsdom doesn't implement the Clipboard API at all, and Node 22's own
// built-in `navigator` (this project's default, non-jsdom test environment —
// see vite.config.ts) exposes `.clipboard` as a getter with no setter, so
// neither `Object.assign` nor a fresh `Object.defineProperty` per test
// reliably stuck. Defining it once, at module scope, sidesteps whatever
// per-test environment churn was undoing it.
const writeText = vi.fn().mockResolvedValue(undefined)
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText },
  configurable: true,
})

function renderChips(content = 'The answer text.') {
  return render(
    <FeedbackChips
      chips={['useful', 'too_long', 'want_detail']}
      reason={null}
      messageId="m1"
      subspaceId="s1"
      content={content}
      onRecorded={vi.fn()}
      onRegenerate={vi.fn()}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
})

describe('copying an answer', () => {
  it('copies the answer text, not a feedback event', async () => {
    renderChips('Photosynthesis converts light energy in plants.')

    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('Photosynthesis converts light energy in plants.'),
    )
    const { sendFeedback } = await import('../../api/feedback')
    expect(sendFeedback).not.toHaveBeenCalled()
  })

  it('confirms with a checkmark after copying', async () => {
    renderChips()

    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument())
  })

  it('stays available after a thumbs-up is given', () => {
    renderChips()

    fireEvent.click(screen.getByRole('button', { name: 'This helped' }))
    expect(screen.getByText('Glad it helped.')).toBeInTheDocument()
  })
})
