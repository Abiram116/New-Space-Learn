import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Renders `\[ ... \]` (display) and `\( ... \)` (inline) spans as live KaTeX,
 * without touching the document or the markdown it round-trips to — the
 * LaTeX source is exactly what gets saved (see `mathMarkdown.ts` for why
 * that source now actually survives a save/load).
 *
 * Pure decoration, not a node type: the raw source stays real editable text
 * the whole time. The plugin just hides it (`display: none`) and lays a
 * rendered KaTeX widget over the top — except for whichever span the caret
 * is currently inside, which is left showing its raw source so it's still
 * ordinary text to type in. Click the rendered form and the caret moves
 * into the source, which un-hides it on the next state update.
 */

type MathMatch = { from: number; to: number; latex: string; display: boolean }

const BLOCK = /\\\[([\s\S]+?)\\\]/g
const INLINE = /\\\(([\s\S]+?)\\\)/g

function findMatches(doc: import('@tiptap/pm/model').Node): MathMatch[] {
  // Flatten the doc to plain text once, remembering each character's real
  // ProseMirror position, so the regexes can run against ordinary text
  // (including across inline marks) instead of walking nodes by hand. Code
  // blocks are skipped outright — backslashes in code are code, never math.
  let text = ''
  const pos: number[] = []
  doc.descendants((node, nodePos) => {
    if (node.type.name === 'codeBlock') {
      pos[text.length] = nodePos
      text += '\n'
      return false
    }
    if (node.isText) {
      const t = node.text ?? ''
      for (let i = 0; i < t.length; i++) pos[text.length + i] = nodePos + i
      text += t
    } else if (!node.isInline) {
      pos[text.length] = nodePos
      text += '\n'
    }
    return true
  })

  const matches: MathMatch[] = []
  for (const { re, display } of [
    { re: BLOCK, display: true },
    { re: INLINE, display: false },
  ]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const from = pos[m.index]
      const to = pos[m.index + m[0].length - 1] + 1
      if (from == null || to == null) continue
      matches.push({ from, to, latex: m[1], display })
    }
  }
  return matches
}

function renderKatex(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex.trim(), { throwOnError: false, displayMode: display })
  } catch {
    return latex
  }
}

export const MathPreview = Extension.create({
  name: 'mathPreview',
  addProseMirrorPlugins() {
    // A doc's selection always exists, even before the editor is ever
    // focused — ProseMirror defaults it to the start of the document. A
    // note whose very first content is a formula therefore has that
    // default selection sitting right inside the match on first render,
    // which used to suppress it before the user had done anything at all.
    // Gating on real focus (captured via the plugin's own `view` hook)
    // means the caret-is-inside check only matters once someone has
    // actually clicked into the editor.
    let editorView: EditorView | null = null
    return [
      new Plugin({
        key: new PluginKey('mathPreview'),
        view(view) {
          editorView = view
          return {}
        },
        props: {
          decorations(state) {
            const { selection } = state
            const focused = editorView?.hasFocus() ?? false
            const decorations: Decoration[] = []
            for (const { from, to, latex, display } of findMatches(state.doc)) {
              // Caret inside this span — leave the raw source visible and
              // editable, don't paper over the exact text being typed.
              if (focused && selection.from <= to && selection.to >= from) continue
              decorations.push(Decoration.inline(from, to, { class: 'math-source-hidden' }))
              decorations.push(
                Decoration.widget(
                  from,
                  (view: EditorView, getPos: () => number | undefined) => {
                    // A block-mode widget is `div`-shaped (KaTeX's own
                    // display output is a block-level `.katex-display` div);
                    // an inline one stays a `span` so it flows with text.
                    const span = document.createElement(display ? 'div' : 'span')
                    span.className = display ? 'math-rendered math-rendered-block' : 'math-rendered'
                    span.innerHTML = renderKatex(latex, display)
                    span.addEventListener('click', () => {
                      const at = getPos()
                      if (at == null) return
                      const tr = view.state.tr.setSelection(
                        TextSelection.near(view.state.doc.resolve(at)),
                      )
                      view.dispatch(tr)
                      view.focus()
                    })
                    return span
                  },
                  { side: -1, key: `math-${from}-${to}` },
                ),
              )
            }
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})
