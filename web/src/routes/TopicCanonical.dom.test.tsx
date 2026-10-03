// @vitest-environment jsdom
/**
 * A topic's address is rewritten to its readable form whatever it was reached
 * by — an id, a server-built route, or a name the student has since changed —
 * and an address that names nothing is left alone for the page to explain.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../api/types'
import { withSlugs } from '../lib/slug'

let SPACES: Space[] = []

vi.mock('../features/spaces/SpacesProvider', () => ({
  useSpaces: () => ({ spaces: SPACES, loading: false, error: null, refresh: async () => {} }),
}))

import { TopicCanonical } from './TopicCanonical'

const base: Space[] = [
  {
    id: 'sp1',
    name: 'Reinforcement Learning',
    tone: 'sky',
    pinned: false,
    subspaces: [
      { id: 'tp1', subject_id: 'sp1', name: 'Markov Decision Processes', last_activity_at: null, counts: {} },
    ],
  },
]

function Where() {
  const { pathname, search, hash } = useLocation()
  return <div data-testid="where">{pathname + search + hash}</div>
}

function tree() {
  return (
    <Routes>
      <Route path="/:spaceId/:subspaceId" element={<TopicCanonical />}>
        <Route index element={<Where />} />
        <Route path="notes" element={<Where />} />
      </Route>
      <Route path="/s/:spaceId/:subspaceId" element={<TopicCanonical />}>
        <Route index element={<Where />} />
        <Route path="notes" element={<Where />} />
      </Route>
    </Routes>
  )
}

afterEach(() => {
  cleanup()
})

describe('TopicCanonical', () => {
  it('rewrites an old /s/<id>/<id> address to the readable one, keeping the section and query', () => {
    SPACES = withSlugs(base)
    render(<MemoryRouter initialEntries={['/s/sp1/tp1/notes?note=7#top']}>{tree()}</MemoryRouter>)
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/reinforcement-learning/markov-decision-processes/notes?note=7#top',
    )
  })

  it('rewrites an id address without the prefix too', () => {
    SPACES = withSlugs(base)
    render(<MemoryRouter initialEntries={['/sp1/tp1/notes']}>{tree()}</MemoryRouter>)
    expect(screen.getByTestId('where')).toHaveTextContent('/reinforcement-learning/markov-decision-processes/notes')
  })

  it('leaves an already-readable address alone', () => {
    SPACES = withSlugs(base)
    render(
      <MemoryRouter initialEntries={['/reinforcement-learning/markov-decision-processes']}>
        {tree()}
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/reinforcement-learning/markov-decision-processes',
    )
  })

  it('does not redirect an address that names nothing', () => {
    SPACES = withSlugs(base)
    render(<MemoryRouter initialEntries={['/nope/nothing/notes']}>{tree()}</MemoryRouter>)
    expect(screen.getByTestId('where')).toHaveTextContent('/nope/nothing/notes')
  })

  it('follows the topic you are on when it is renamed', () => {
    SPACES = withSlugs(base)
    const { rerender } = render(
      <MemoryRouter initialEntries={['/reinforcement-learning/markov-decision-processes/notes']}>
        {tree()}
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where')).toHaveTextContent('/markov-decision-processes/notes')

    const renamed = structuredClone(base)
    renamed[0].subspaces[0].name = 'MDPs'
    SPACES = withSlugs(renamed)
    rerender(
      <MemoryRouter initialEntries={['/reinforcement-learning/markov-decision-processes/notes']}>
        {tree()}
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where')).toHaveTextContent('/reinforcement-learning/mdps/notes')
  })
})
