// @vitest-environment jsdom
/**
 * `?q=`, `?n=` and `?deck=` read as names, not ids: a name resolves once the
 * list is there, an id still works and is rewritten to the name, and a name is
 * never dropped while the list may still be a stale copy.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { isUuid, useSlugParam } from './useSlugParam'

type Item = { id: string; title: string }
const ID_A = '6c114e4a-d302-4cfa-9353-743bfcbb2125'
const ID_B = '11111111-2222-4333-8444-555555555555'
const nameOf = (i: Item) => i.title

const LIST: Item[] = [
  { id: ID_A, title: 'Variables basics' },
  { id: ID_B, title: 'Loops' },
]

let search = ''
function Probe() {
  search = useLocation().search
  return null
}

function setup(url: string, initial: Item[] | null, settled = true) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>
      <Probe />
      {children}
    </MemoryRouter>
  )
  return renderHook(
    (p: { items: Item[] | null; settled: boolean }) => useSlugParam('q', p.items, nameOf, 'quiz', p.settled),
    { wrapper, initialProps: { items: initial, settled } },
  )
}

afterEach(() => {
  cleanup()
  search = ''
})

describe('useSlugParam', () => {
  it('tells an id from a name', () => {
    expect(isUuid(ID_A)).toBe(true)
    expect(isUuid('variables-basics')).toBe(false)
  })

  it('waits for the list before a name means anything, then resolves it', () => {
    const { result, rerender } = setup('/?q=loops', null)
    expect(result.current.id).toBeNull()
    expect(result.current.pending).toBe(true)

    rerender({ items: LIST, settled: true })
    expect(result.current.id).toBe(ID_B)
    expect(result.current.pending).toBe(false)
    expect(search).toBe('?q=loops')
  })

  it('uses an id straight away and rewrites it to the readable name once it can', () => {
    const { result, rerender } = setup(`/?q=${ID_A}`, null)
    expect(result.current.id).toBe(ID_A)
    expect(result.current.pending).toBe(false)
    expect(search).toBe(`?q=${ID_A}`)

    rerender({ items: LIST, settled: true })
    expect(result.current.id).toBe(ID_A)
    expect(search).toBe('?q=variables-basics')
  })

  it('keeps an id that is not in the list (deleted, or past its window) for the page to explain', () => {
    const { result } = setup(`/?q=${ID_A}`, [LIST[1]])
    expect(result.current.id).toBe(ID_A)
    expect(search).toBe(`?q=${ID_A}`)
  })

  it('drops a name that matches nothing', () => {
    const { result } = setup('/?q=nope', LIST)
    // `missing` is true for the one render that notices, then the dead name is
    // removed from the URL and there is nothing left to be missing.
    expect(result.current.id).toBeNull()
    expect(search).toBe('')
  })

  it('does not drop a name while the list may be a stale copy', () => {
    const { result, rerender } = setup('/?q=loops', [LIST[0]], false)
    expect(result.current.pending).toBe(true)
    expect(result.current.missing).toBe(false)
    expect(search).toBe('?q=loops')

    rerender({ items: LIST, settled: true })
    expect(result.current.id).toBe(ID_B)
    expect(result.current.pending).toBe(false)
  })

  it('keeps what it resolved while the list is briefly gone, as after a write clears the cache', () => {
    const { result, rerender } = setup('/?q=loops', LIST)
    expect(result.current.id).toBe(ID_B)

    rerender({ items: null, settled: true })
    expect(result.current.id).toBe(ID_B)
    expect(result.current.pending).toBe(false)
    expect(search).toBe('?q=loops')

    rerender({ items: LIST, settled: true })
    expect(result.current.id).toBe(ID_B)
  })

  it('keeps other parameters when it rewrites an id', () => {
    setup(`/?review=due&q=${ID_B}&limit=5`, LIST)
    const p = new URLSearchParams(search)
    expect(p.get('q')).toBe('loops')
    expect(p.get('review')).toBe('due')
    expect(p.get('limit')).toBe('5')
  })

  it('follows an item that is renamed while it is open', () => {
    const { result, rerender } = setup('/?q=loops', LIST)
    expect(result.current.id).toBe(ID_B)

    act(() => rerender({ items: [LIST[0], { id: ID_B, title: 'For loops' }], settled: true }))
    expect(result.current.id).toBe(ID_B)
    expect(search).toBe('?q=for-loops')
  })

  it('gives the readable value to write for an id, and the id itself when unknown', () => {
    const { result } = setup('/', LIST)
    expect(result.current.slugFor(ID_A)).toBe('variables-basics')
    expect(result.current.slugFor('brand-new')).toBe('brand-new')
  })

  it('gives same-titled items different names', () => {
    const dupes: Item[] = [
      { id: ID_A, title: 'Quiz' },
      { id: ID_B, title: 'Quiz' },
    ]
    const { result } = setup('/', dupes)
    expect(result.current.slugFor(ID_A)).not.toBe(result.current.slugFor(ID_B))
  })
})
