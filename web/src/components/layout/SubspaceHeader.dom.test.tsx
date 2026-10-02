// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let active: { space: unknown; subspace: unknown; base: string } = { space: null, subspace: null, base: '/' }
vi.mock('../../lib/nav', () => ({ useActiveSubspace: () => active }))
vi.mock('../../lib/useIsMobile', () => ({ useIsMobile: () => false }))

import { SubspaceHeader } from './SubspaceHeader'

afterEach(cleanup)

describe('SubspaceHeader breadcrumb', () => {
  it('never shows a placeholder "Space › —" when no topic is open', () => {
    active = { space: null, subspace: null, base: '/' }
    render(<SubspaceHeader title="Review" />)
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument()
    expect(screen.queryByText(/Space/)).not.toBeInTheDocument()
  })

  it('shows Subject › Topic over the title when a topic is open', () => {
    active = { space: { name: 'Deep Learning' }, subspace: { name: 'CNNs' }, base: '/s/a/b' }
    render(<SubspaceHeader title="Docs" />)
    expect(screen.getByText('Deep Learning › CNNs')).toBeInTheDocument()
  })

  it('can be turned off for account-wide pages', () => {
    active = { space: { name: 'Deep Learning' }, subspace: { name: 'CNNs' }, base: '/s/a/b' }
    render(<SubspaceHeader title="Cards" breadcrumb={false} />)
    expect(screen.queryByText(/›/)).not.toBeInTheDocument()
  })

  it('falls back to the topic name as the title', () => {
    active = { space: { name: 'Deep Learning' }, subspace: { name: 'CNNs' }, base: '/s/a/b' }
    render(<SubspaceHeader />)
    expect(screen.getByRole('heading', { name: 'CNNs' })).toBeInTheDocument()
  })
})
