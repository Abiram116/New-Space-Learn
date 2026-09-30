import { describe, expect, it } from 'vitest'
import { extractMath } from './MarkdownMessage'

describe('extractMath', () => {
  it('swaps inline and display spans for placeholder links', () => {
    const { text, math } = extractMath('A \\(x^2\\) and\n\n\\[ y = 1 \\]\n')
    expect(math).toEqual([
      { latex: 'x^2', display: false },
      { latex: 'y = 1', display: true },
    ])
    expect(text).toContain('[math](#math-0)')
    expect(text).toContain('[math](#math-1)')
  })

  it('leaves code alone', () => {
    const src = 'Use `\\(x\\)` or\n\n```\n\\[y\\]\n```\n'
    expect(extractMath(src)).toEqual({ text: src, math: [] })
  })

  it('is a no-op without backslashes', () => {
    expect(extractMath('plain')).toEqual({ text: 'plain', math: [] })
  })
})
