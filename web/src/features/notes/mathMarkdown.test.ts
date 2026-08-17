import { describe, expect, it } from 'vitest'
import { preserveLatexBackslashes } from './mathMarkdown'

/**
 * The claim under test: doubling a backslash before markdown-it's own
 * CommonMark escape parser runs reproduces the original single backslash on
 * the other side, for any character — because `\\` is CommonMark's own
 * unambiguous "escaped backslash" token. Simulated here with the same
 * escape rule CommonMark uses (backslash + ASCII punctuation is consumed;
 * backslash + anything else is left alone) rather than pulling in the real
 * parser, so this stays a fast, dependency-free unit test.
 */
function simulateCommonMarkEscaping(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1').replace(/\\\\/g, '\\')
}

describe('preserveLatexBackslashes', () => {
  it('survives the round trip for LaTeX display-math delimiters', () => {
    const original = String.raw`\[ \sin(x) \]`
    const protectedText = preserveLatexBackslashes(original)
    expect(simulateCommonMarkEscaping(protectedText)).toBe(original)
  })

  it('survives the round trip for inline math and \\! spacing commands', () => {
    const original = String.raw`\(\sin\!\left(\frac{pos}{d}\right)\)`
    const protectedText = preserveLatexBackslashes(original)
    expect(simulateCommonMarkEscaping(protectedText)).toBe(original)
  })

  it('leaves fenced code blocks completely untouched', () => {
    const withCode = '```python\nprint("a\\nb")\n```'
    expect(preserveLatexBackslashes(withCode)).toBe(withCode)
  })

  it('protects math outside a fence while leaving a fence in the same note alone', () => {
    const body = '```python\nprint("a\\nb")\n```\n\n\\[ x \\]'
    const result = preserveLatexBackslashes(body)
    expect(result).toContain('```python\nprint("a\\nb")\n```')
    expect(result).toContain(String.raw`\\[ x \\]`)
  })

  it('is a no-op on text with no backslashes', () => {
    expect(preserveLatexBackslashes('Plain note text.')).toBe('Plain note text.')
  })
})
