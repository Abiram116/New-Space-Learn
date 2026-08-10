/**
 * Escaped-HTML repair.
 *
 * This is here because the bug shipped: a student's note rendered a literal
 * `&lt;p&gt;to expand on the PPT structure...&lt;/p&gt;`. The damage compounds
 * — markdown-it decodes `&lt;` to `<` on the way in and the serializer
 * escapes it again on the way out, so each save adds a layer.
 *
 * The two properties that matter are opposites, which is why both are tested
 * hard: it must repair damaged input, and it must not touch anything else.
 * A repair function that mangles correct notes is worse than no repair.
 */

import { describe, expect, it } from 'vitest'
import { healEscapedHtml } from './healHtml'

describe('healEscapedHtml — repairs damage', () => {
  it('heals the exact string that was reported', () => {
    const out = healEscapedHtml(
      '&amp;lt;p&amp;gt;to continue with the note, the key components of a ' +
        'Markov Decision Process&amp;lt;/p&amp;gt;',
    )
    expect(out).not.toContain('&lt;')
    expect(out).not.toContain('<p')
    expect(out).toContain('Markov Decision Process')
  })

  it('heals a single escaping layer', () => {
    expect(healEscapedHtml('&lt;p&gt;hello&lt;/p&gt;')).toBe('hello')
  })

  it('heals raw tags', () => {
    expect(healEscapedHtml('<p>hello</p>')).toBe('hello')
  })

  it('converts block tags to their markdown equivalent', () => {
    const out = healEscapedHtml(
      '&amp;lt;h2&amp;gt;Key parts&amp;lt;/h2&amp;gt;&amp;lt;li&amp;gt;States&amp;lt;/li&amp;gt;',
    )
    expect(out).toContain('## Key parts')
    expect(out).toContain('- States')
  })

  it('handles mixed raw and entity-escaped tags in one document', () => {
    const out = healEscapedHtml('&lt;p&gt;one&lt;/p&gt;<p>two</p>')
    expect(out).not.toMatch(/&lt;|<p/)
    expect(out).toContain('one')
    expect(out).toContain('two')
  })
})

describe('healEscapedHtml — leaves healthy notes alone', () => {
  it('does not touch clean markdown', () => {
    const md = '# Title\n\n- a\n- b\n\n**bold** and *em*'
    expect(healEscapedHtml(md)).toBe(md)
  })

  it('preserves fenced code, where a tag is the content', () => {
    const md = 'Try:\n\n```html\n<div class="x">hi</div>\n```\n\nend'
    expect(healEscapedHtml(md)).toContain('<div class="x">hi</div>')
  })

  it('preserves inline code', () => {
    expect(healEscapedHtml('The `<br>` tag breaks lines.')).toContain('`<br>`')
  })

  it('leaves entities inside a fence literal', () => {
    expect(healEscapedHtml('```\n&lt;p&gt;literal\n```')).toContain('&lt;p&gt;')
  })

  it('is a no-op on empty and whitespace input', () => {
    expect(healEscapedHtml('')).toBe('')
    expect(healEscapedHtml('   ')).toBe('   ')
  })

  it('terminates on deeply nested escaping rather than looping', () => {
    // Four layers is past the documented ceiling; the point is that it
    // returns at all.
    const deep = '&amp;amp;amp;lt;p&amp;amp;amp;gt;x'
    expect(() => healEscapedHtml(deep)).not.toThrow()
  })
})
