import { describe, expect, it } from 'vitest'
import { openFence, prepareStreamingDisplay as prep } from './streamingDisplay'

describe('prepareStreamingDisplay', () => {
  it('leaves complete markdown alone', () => {
    const t = '## Title\n\nSome **bold** and `code` text [[1]].\n\n- a\n- b'
    expect(prep(t)).toBe(t)
  })

  it('closes an unclosed code fence so the block does not swallow the page', () => {
    expect(prep('Intro\n\n```python\nprint(1)')).toBe('Intro\n\n```python\nprint(1)\n```')
    expect(prep('```js\nx\n')).toBe('```js\nx\n```')
  })

  it('does not double-close an already closed fence, and reopens for a second one', () => {
    const closed = '```py\nx\n```\n\nafter'
    expect(prep(closed)).toBe(closed)
    expect(prep(closed + '\n\n```sh\nls')).toBe(closed + '\n\n```sh\nls\n```')
  })

  it('does not treat a fence marker still being typed as a fence', () => {
    expect(prep('Intro\n\n``')).not.toContain('```')
  })

  it('respects a longer fence marker and tilde fences', () => {
    expect(openFence('````md\n```\nx')).toBe('````')
    expect(openFence('~~~\nx')).toBe('~~~')
    expect(openFence('```\nx\n```')).toBeNull()
  })

  it('closes an unclosed bold, drops a dangling opener', () => {
    expect(prep('A **key ter')).toBe('A **key ter**')
    expect(prep('A **')).toBe('A ')
    expect(prep('A *')).toBe('A ')
  })

  it('closes an unclosed inline code span', () => {
    expect(prep('use `foo')).toBe('use `foo`')
    expect(prep('use `')).toBe('use ')
    expect(prep('use `foo` and `bar`')).toBe('use `foo` and `bar`')
  })

  it('does not count emphasis markers inside inline code', () => {
    expect(prep('the `**` operator')).toBe('the `**` operator')
  })

  it('holds back a partial citation marker', () => {
    expect(prep('Attention weighs tokens [[')).toBe('Attention weighs tokens ')
    expect(prep('Attention weighs tokens [[1')).toBe('Attention weighs tokens ')
    expect(prep('Attention weighs tokens [[1]')).toBe('Attention weighs tokens ')
    expect(prep('Attention weighs tokens [[1]]')).toBe('Attention weighs tokens [[1]]')
  })

  it('holds back a bare heading marker', () => {
    expect(prep('Intro\n\n##')).toBe('Intro\n\n')
    expect(prep('Intro\n\n## Heading')).toBe('Intro\n\n## Heading')
  })

  it('hides a table until its delimiter row exists', () => {
    expect(prep('Compare:\n\n| a | b |').trimEnd()).toBe('Compare:')
    expect(prep('Compare:\n\n| a | b |\n| --- | --- |')).toBe('Compare:\n\n| a | b |\n| --- | --- |')
    // A row still being typed is held back; completed rows show.
    expect(prep('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3')).toBe(
      '| a | b |\n| --- | --- |\n| 1 | 2 |',
    )
  })

  it('hides unclosed inline math', () => {
    expect(prep('Energy is \\(E = m')).toBe('Energy is ')
    expect(prep('Energy is \\(E = mc^2\\) here')).toBe('Energy is \\(E = mc^2\\) here')
  })

  it('never changes text that has nothing pending', () => {
    expect(prep('')).toBe('')
    expect(prep('plain words')).toBe('plain words')
  })
})
