import type { KatexOptions } from 'katex'
import { describe, expect, it } from 'vitest'
import { escapeHtml, renderKatex } from './mathPreview'

/**
 * `renderKatex` feeds `innerHTML`. Whatever it returns is parsed as markup, so a
 * formula that is really an HTML tag must never come back as one — in any path.
 */
const HOSTILE = '<img src=x onerror="alert(1)"><script>alert(2)</script>'

describe('renderKatex', () => {
  it('shows a formula as plain text, not markup, before KaTeX has loaded', () => {
    const html = renderKatex(HOSTILE, false, null)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;img')
  })

  it('does the same when KaTeX throws', () => {
    const throwing = {
      renderToString: () => {
        throw new Error('boom')
      },
    }
    const html = renderKatex(HOSTILE, false, throwing)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script')
  })

  it('passes KaTeX\'s own output through untouched, with trust switched off', () => {
    let seen: KatexOptions = {}
    const fake = {
      renderToString: (_: string, opts?: KatexOptions) => {
        seen = opts ?? {}
        return '<span class="katex">ok</span>'
      },
    }
    expect(renderKatex('x^2', true, fake)).toBe('<span class="katex">ok</span>')
    expect(seen.trust).toBe(false)
    expect(seen.displayMode).toBe(true)
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter in markup', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
})
