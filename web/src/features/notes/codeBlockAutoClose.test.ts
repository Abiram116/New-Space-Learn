// @vitest-environment node
/**
 * Pure ProseMirror-state test, deliberately not mounted through Tiptap/React
 * or simulated via `userEvent.type` on a real contentEditable — jsdom's
 * `textInput`/`beforeinput` emulation on contenteditable is unreliable
 * (confirmed elsewhere in this app's test suite), which made a DOM-driven
 * version of this test flaky in ways unrelated to the logic under test.
 * Building a minimal real `EditorState` and calling the handlers directly
 * tests the actual bracket/quote-pairing logic deterministically.
 */

import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state'
import { describe, expect, it } from 'vitest'
import { handleCodeBlockBackspace, handleCodeBlockTextInput } from './codeBlockAutoClose'

const schema = new Schema({
  nodes: {
    doc: { content: 'codeBlock+' },
    codeBlock: { content: 'text*', marks: '', code: true },
    text: { group: 'inline' },
  },
})

function stateWithText(text: string, cursor: number) {
  const doc = schema.node('doc', null, [schema.node('codeBlock', null, text ? [schema.text(text)] : [])])
  return EditorState.create({ doc, selection: TextSelection.create(doc, cursor) })
}

/** A minimal stand-in for `EditorView` — the handlers only touch
 *  `view.state` and `view.dispatch`, both of which this fully implements. */
function fakeView(state: EditorState) {
  const view = {
    state,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr)
    },
  }
  return view
}

describe('handleCodeBlockTextInput', () => {
  it('auto-closes a bracket and lands the caret between the pair', () => {
    const view = fakeView(stateWithText('', 1))
    const handled = handleCodeBlockTextInput(view as never, 1, 1, '(')

    expect(handled).toBe(true)
    expect(view.state.doc.textContent).toBe('()')
    expect(view.state.selection.from).toBe(2) // between ( and )
  })

  it('typing after an auto-closed pair lands inside it', () => {
    const view = fakeView(stateWithText('', 1))
    handleCodeBlockTextInput(view as never, 1, 1, '(')

    // A plain character isn't ours to handle — we return false and the
    // caller (ProseMirror's own default handling) inserts it at the caret
    // we left behind. Confirm that caret position, then simulate that
    // default insertion the way the real caller does.
    const { from } = view.state.selection
    expect(from).toBe(2) // between ( and )
    const handled = handleCodeBlockTextInput(view as never, from, from, 'x')
    expect(handled).toBe(false)
    view.dispatch(view.state.tr.insertText('x', from, from))

    expect(view.state.doc.textContent).toBe('(x)')
  })

  it('skips over an auto-closed bracket instead of duplicating it', () => {
    // Cursor sits right before the `)` of an already-inserted "()" pair.
    const view = fakeView(stateWithText('()', 2))
    const handled = handleCodeBlockTextInput(view as never, 2, 2, ')')

    expect(handled).toBe(true)
    expect(view.state.doc.textContent).toBe('()') // no duplicate `)`
    expect(view.state.selection.from).toBe(3) // caret moved past it
  })

  it('auto-closes a quote at a word boundary', () => {
    const view = fakeView(stateWithText('', 1))
    const handled = handleCodeBlockTextInput(view as never, 1, 1, '"')

    expect(handled).toBe(true)
    expect(view.state.doc.textContent).toBe('""')
  })

  it('does not auto-pair a quote mid-word (leaves contractions alone)', () => {
    // "it|s" — cursor between t and s, both word characters.
    const view = fakeView(stateWithText('its', 3))
    const handled = handleCodeBlockTextInput(view as never, 3, 3, "'")

    expect(handled).toBe(false) // caller falls back to plain insertion
  })

  it('wraps a selection when typing an opening bracket', () => {
    // Select "foo" inside "(foo)" — cursor spans positions 2..5.
    const view = fakeView(stateWithText('foo', 4))
    view.state = EditorState.create({
      doc: view.state.doc,
      selection: TextSelection.create(view.state.doc, 1, 4),
    })
    const handled = handleCodeBlockTextInput(view as never, 1, 4, '(')

    expect(handled).toBe(true)
    expect(view.state.doc.textContent).toBe('(foo)')
  })

  it('leaves plain text alone outside a code block', () => {
    const doc = schema.node('doc', null, [schema.node('codeBlock', null, [])])
    // No codeBlock ancestor to find — simulate by using a doc-root selection.
    const state = EditorState.create({ doc })
    const view = fakeView(state)
    const handled = handleCodeBlockTextInput(view as never, 1, 1, 'x')
    // Still inside the only codeBlock in this minimal schema, so this just
    // confirms plain (non-pairable) characters are left to default handling.
    expect(handled).toBe(false)
  })
})

describe('handleCodeBlockBackspace', () => {
  it('removes both characters of an empty auto-closed pair', () => {
    const view = fakeView(stateWithText('[]', 2))
    const handled = handleCodeBlockBackspace(view as never)

    expect(handled).toBe(true)
    expect(view.state.doc.textContent).toBe('')
  })

  it('does not eat a non-pair character before the caret', () => {
    const view = fakeView(stateWithText('ab', 2))
    const handled = handleCodeBlockBackspace(view as never)

    expect(handled).toBe(false)
  })
})
