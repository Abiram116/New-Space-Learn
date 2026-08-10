// @vitest-environment jsdom

/**
 * The double-parse regression.
 *
 * For three rounds this bug was reported as "AI answers come out as
 * `&lt;p&gt;…&lt;/p&gt;`" and three times it was chased into the backend, which
 * was innocent every time — the server's markdown was verified clean against
 * the live endpoint.
 *
 * The real cause is local: `tiptap-markdown` overrides `insertContentAt` so it
 * markdown-parses whatever it receives. Pre-parsing the markdown ourselves and
 * handing over the resulting HTML meant it got parsed a second time, and
 * because the extension is configured `html: false`, markdown-it escaped the
 * `<p>` tags it found into literal visible text.
 *
 * So this test asserts on the *seam that broke*: markdown in, readable prose
 * out, no escaped tags. It drives a real editor with the real extension list
 * rather than a stub, because a stub is exactly what let three "fixes" pass
 * while the bug survived.
 */

import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { describe, expect, it } from 'vitest'

/** The AI-insert path's config, reduced to the parts that decide escaping. */
function makeEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Markdown.configure({ html: false, transformPastedText: true })],
    content: '',
  })
}

describe('inserting AI markdown into a note', () => {
  it('renders markdown as prose rather than escaped HTML tags', () => {
    const editor = makeEditor()
    const markdown =
      'consider a matrix that represents a scaling transformation, it stretches or squashes input vectors'

    editor.chain().insertContentAt(0, markdown).run()

    const text = editor.getText()
    expect(text).toContain('consider a matrix that represents a scaling transformation')
    // The exact string the student kept seeing in their notes.
    expect(text).not.toContain('&lt;p&gt;')
    expect(text).not.toContain('<p>')
    editor.destroy()
  })

  it('keeps block structure — headings and bullets survive as real nodes', () => {
    const editor = makeEditor()

    editor.chain().insertContentAt(0, '# Eigenvectors\n\n- stretched\n- never rotated').run()

    const html = editor.getHTML()
    expect(html).toContain('<h1>')
    expect(html).toContain('<li>')
    expect(editor.getText()).not.toContain('&lt;')
    editor.destroy()
  })

  it('does not escape a fenced code block containing real HTML', () => {
    const editor = makeEditor()

    editor.chain().insertContentAt(0, '```\n<div>kept verbatim</div>\n```').run()

    // Inside a fence the angle brackets are content, and must read as typed.
    expect(editor.getText()).toContain('<div>kept verbatim</div>')
    expect(editor.getText()).not.toContain('&lt;div&gt;')
    editor.destroy()
  })

  it('round-trips: what is inserted is what gets saved', () => {
    const editor = makeEditor()
    const markdown = 'an **eigenvector** keeps its direction'

    editor.chain().insertContentAt(0, markdown).run()
    // @ts-expect-error — the Markdown extension's storage isn't in the base Storage type
    const saved: string = editor.storage.markdown.getMarkdown()

    // The saved note is what a later session re-opens. If escaping crept in
    // here, every save would compound it — which is how notes ended up with
    // `&amp;lt;p&amp;gt;` stacked several layers deep.
    expect(saved).toContain('**eigenvector**')
    expect(saved).not.toContain('&lt;')
    expect(saved).not.toContain('&amp;')
    editor.destroy()
  })
})
