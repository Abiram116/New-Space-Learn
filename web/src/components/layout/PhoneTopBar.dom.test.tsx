// @vitest-environment jsdom
/** The phone's top bar: a Search entry, and the subject's icon on the topic pill. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'
import { PhoneTopBar } from './PhoneTopBar'

const sub = { id: 'sub', subject_id: 'sp', name: 'Cells', last_activity_at: null, counts: {} }
const space: Space = { id: 'sp', name: 'Biology', tone: 'sky', pinned: false, subspaces: [sub] }

afterEach(cleanup)

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <PhoneTopBar space={space} subspace={sub} loading={false} onOpenSwitcher={() => {}} />
    </MemoryRouter>,
  )
}

describe('PhoneTopBar', () => {
  it('opens the search palette', () => {
    const heard = vi.fn()
    window.addEventListener('sl:open-search', heard)
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener('sl:open-search', heard)
  })

  it('marks the topic pill with its subject’s icon', () => {
    renderBar()
    const pill = screen.getByRole('button', { name: /Topic: Cells/ })
    expect(pill.querySelector('[data-subject-icon="leaf"]')).not.toBeNull()
  })
})
