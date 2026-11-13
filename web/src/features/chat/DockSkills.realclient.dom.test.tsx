// @vitest-environment jsdom
/**
 * Through the REAL api client. The API client clears its caches after every
 * successful write, and a Skills list held in that cache emptied itself the
 * moment a toggle was confirmed. A test that mocks `api/skills` cannot see
 * that, so this one lets the real `apiFetch` run over a stubbed `fetch`.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ui/Toast'
import { clearCache } from '../../lib/asyncCache'
import { DockSkills } from './DockSkills'

const skill = (id: string, name: string) => ({
  id,
  name,
  icon: 'skill',
  tone: 'brand',
  description: null,
  instructions: 'x',
  capabilities: [],
  memory_scope: 'session',
  output_format: null,
  is_library: false,
})

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

let activeList = [skill('s1', 'Compare'), skill('s2', 'Feynman')]

beforeEach(() => {
  clearCache()
  activeList = [skill('s1', 'Compare'), skill('s2', 'Feynman')]
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'GET' && url.endsWith('/subspaces/sub-1/skills')) return json(activeList)
      if (method === 'GET' && url.endsWith('/skills')) return json([skill('s1', 'Compare'), skill('s2', 'Feynman'), skill('s3', 'Exam Cram'), skill('s4', 'Mistake Analyst')])
      if (method === 'POST') return json({ ok: true })
      if (method === 'DELETE') return json({ ok: true })
      return json([])
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DockSkills over the real api client', () => {
  it('keeps the picker open, with the rest of the list, after turning a skill on', async () => {
    activeList = [skill('s1', 'Compare')]
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ToastProvider>
          <DockSkills subspaceId="sub-1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Compare')
    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(await screen.findByRole('switch', { name: 'Feynman' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Feynman' })).toHaveAttribute('aria-checked', 'true'))

    // The write succeeded and cleared the client's caches. The list must still
    // be open, still listing the skills that are not on yet — until Done.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(screen.getByText('Exam Cram')).toBeInTheDocument()
    expect(screen.getByText('Mistake Analyst')).toBeInTheDocument()
    expect(screen.queryByText(/haven.t added any skills/)).not.toBeInTheDocument()
  })

  it('keeps the remaining skills on screen once the server confirms a change', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ToastProvider>
          <DockSkills subspaceId="sub-1" />
        </ToastProvider>
      </MemoryRouter>,
    )
    await screen.findByText('Compare')

    await user.click(screen.getByRole('button', { name: 'Change' }))
    await user.click(await screen.findByRole('switch', { name: 'Compare' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Compare' })).toHaveAttribute('aria-checked', 'false'))

    // The write succeeded and cleared the client's caches. The other skill must
    // still be on — not a skeleton, not "Normal".
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('switch', { name: 'Feynman' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText('Normal')).not.toBeInTheDocument()
  })
})
