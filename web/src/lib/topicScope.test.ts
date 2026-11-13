// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { setTopicScope, topicScopeNow } from './topicScope'

afterEach(() => window.localStorage.clear())

describe('topic scope', () => {
  it('is unset until chosen, then remembered per topic', () => {
    expect(topicScopeNow('a')).toBeNull()
    setTopicScope('a', 'subject')
    expect(topicScopeNow('a')).toBe('subject')
    expect(topicScopeNow('b')).toBeNull()
    setTopicScope('a', null)
    expect(topicScopeNow('a')).toBeNull()
  })
  it('ignores a stored value it does not know', () => {
    window.localStorage.setItem('sl:scope:a', 'anything')
    expect(topicScopeNow('a')).toBeNull()
  })
})
