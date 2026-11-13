import { describe, expect, it } from 'vitest'
import { extractMath, splitMath } from './MarkdownMessage'

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

describe('extractMath, dollar and environment forms', () => {
  const latex = (src: string) => extractMath(src).math

  it('reads $$ … $$ as display and $ … $ as inline', () => {
    expect(latex('So $E = mc^2$ and\n\n$$\n\\frac{a}{b}\n$$')).toEqual([
      { latex: 'E = mc^2', display: false },
      { latex: '\\frac{a}{b}', display: true },
    ])
    expect(latex('Let $x$ be $a_1 + a_2$.')).toEqual([
      { latex: 'x', display: false },
      { latex: 'a_1 + a_2', display: false },
    ])
  })

  it('keeps an equation environment whole', () => {
    const env = '\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}'
    expect(latex(`Then:\n\n${env}\n`)).toEqual([{ latex: env, display: true }])
    expect(latex('\\begin{equation}x=1\\end{equation}')).toEqual([
      { latex: '\\begin{equation}x=1\\end{equation}', display: true },
    ])
  })

  it('leaves prices and plain dollars alone', () => {
    for (const src of [
      'It costs $5 and $10.',
      'Between $5/$10 a month',
      'Pay $5$ now',
      'I had $5 and he paid 10$ back',
      'US$7 or A$9$',
      'Escaped \\$x\\$ stays',
      'One $ sign',
      'spaced $ x $ out',
      'Shell `$HOME and $PATH$` here',
    ]) {
      expect(extractMath(src)).toEqual({ text: src, math: [] })
    }
  })
})

describe('splitMath', () => {
  it('cuts text and formulas in order', () => {
    expect(splitMath('Is $x^2$ right?')).toEqual([
      'Is ',
      { latex: 'x^2', display: false },
      ' right?',
    ])
    expect(splitMath('no maths')).toEqual(['no maths'])
  })
})
