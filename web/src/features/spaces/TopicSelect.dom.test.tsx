// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Space } from '../../api/types'

const sub = (id: string, subject_id: string, name: string) => ({ id, subject_id, name, last_activity_at: null, counts: {} })
let spaces: Space[] = []
vi.mock('./SpacesProvider', () => ({ useSpaces: () => ({ spaces }) }))

import { TopicSelect, useTopicName } from './TopicSelect'

afterEach(cleanup)

const two: Space[] = [
  { id: 's1', name: 'Deep Learning', tone: 'sky', pinned: false, subspaces: [sub('t1', 's1', 'CNNs'), sub('t2', 's1', 'RNNs')] },
  { id: 's2', name: 'Java', tone: 'mint', pinned: false, subspaces: [sub('t3', 's2', 'Classes')] },
]

describe('TopicSelect', () => {
  it('lists every topic as "Subject › Topic" and reports the pick', () => {
    spaces = two
    const onChange = vi.fn()
    render(<TopicSelect value="t1" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Topic/ }))
    expect(screen.getByText('Deep Learning › RNNs')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Java › Classes'))
    expect(onChange).toHaveBeenCalledWith('t3')
  })

  it('renders nothing when there is only one topic to choose', () => {
    spaces = [{ ...two[1] }]
    const { container } = render(<TopicSelect value="t3" onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('useTopicName finds a topic by id', () => {
    spaces = two
    function Name() {
      return <span>{useTopicName('t2') || 'none'}</span>
    }
    render(<Name />)
    expect(screen.getByText('RNNs')).toBeInTheDocument()
  })
})
