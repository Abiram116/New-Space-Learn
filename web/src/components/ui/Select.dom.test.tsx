// @vitest-environment jsdom
/**
 * Replaces a native `<select>` wherever its open state needs to look like
 * the rest of the app — a native popup is OS/browser chrome no CSS reaches.
 * Used for the Notes/Cards/Quizzes subject filter.
 */

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Select } from './Select'

const OPTIONS = [
  { value: 'all', label: 'All subjects' },
  { value: 'fsd', label: 'FSD' },
  { value: 'dl', label: 'Deep Learning' },
]

afterEach(cleanup)

describe('Select', () => {
  it('shows the selected option label on the closed button', () => {
    render(<Select value="dl" onChange={vi.fn()} options={OPTIONS} ariaLabel="Filter by subject" />)
    expect(screen.getByRole('button', { name: 'Filter by subject' })).toHaveTextContent('Deep Learning')
  })

  it('opens a listbox on click and calls onChange when an option is picked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Select value="all" onChange={onChange} options={OPTIONS} ariaLabel="Filter by subject" />)

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: 'FSD' }))
    expect(onChange).toHaveBeenCalledWith('fsd')
    // Picking closes it, same as a native select.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes on Escape without calling onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Select value="all" onChange={onChange} options={OPTIONS} ariaLabel="Filter by subject" />)

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes on an outside click', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Select value="all" onChange={vi.fn()} options={OPTIONS} ariaLabel="Filter by subject" />
        <button type="button">Elsewhere</button>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks the current value as the selected option', async () => {
    const user = userEvent.setup()
    render(<Select value="dl" onChange={vi.fn()} options={OPTIONS} ariaLabel="Filter by subject" />)

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    expect(screen.getByRole('option', { name: 'Deep Learning' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'FSD' })).toHaveAttribute('aria-selected', 'false')
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    render(
      <Select value="all" onChange={vi.fn()} options={OPTIONS} ariaLabel="Filter by subject" disabled />,
    )

    const trigger = screen.getByRole('button', { name: 'Filter by subject' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowDown moves the keyboard highlight and Enter commits it', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Select value="all" onChange={onChange} options={OPTIONS} ariaLabel="Filter by subject" />)

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    // Opening starts the highlight on the current value ("all", index 0).
    await user.keyboard('{ArrowDown}')
    // Highlight is now on "fsd" (index 1) — Enter should commit that, not the
    // original value.
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('fsd')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowUp/Home/End move the highlight to the expected option', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Select value="all" onChange={onChange} options={OPTIONS} ariaLabel="Filter by subject" />)

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    await user.keyboard('{End}')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith('dl')

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Home}')
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith('all')
  })

  it('Space also commits the highlighted option', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Select value="all" onChange={onChange} options={OPTIONS} ariaLabel="Filter by subject" />)

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith('dl')
  })

  it('does not clip or truncate a long option label', async () => {
    const longLabel = 'A very long subject name that could plausibly overflow a narrow filter dropdown'
    const user = userEvent.setup()
    render(
      <Select
        value="all"
        onChange={vi.fn()}
        options={[...OPTIONS, { value: 'long', label: longLabel }]}
        ariaLabel="Filter by subject"
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Filter by subject' }))
    expect(screen.getByRole('option', { name: longLabel })).toHaveTextContent(longLabel)
  })
})
