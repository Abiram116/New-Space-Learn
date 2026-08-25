import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type Katex from 'katex'

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
 *
 * KaTeX itself is loaded lazily, not imported at module scope. It's the
 * single largest thing this editor pulls in, and the vast majority of notes
 * never contain a formula — every note paid for it anyway. `ensureKatex`
 * fires the dynamic import the first time `findMatches` actually finds a
 * `\( \)` or `\[ \]` span in a document, caches the resolved module so it
 * only ever loads once, and forces a decoration recompute (an empty
 * dispatched transaction) once it lands so the widget upgrades from raw
 * LaTeX text to the real rendered form without the user doing anything.
 */

let katexMod: typeof Katex | null = null
let katexLoading: Promise<void> | null = null

function ensureKatex(view: EditorView) {
  if (katexMod || katexLoading) return
  // The stylesheet is fire-and-forget, split from the JS module on purpose:
  // it only affects how the rendered output LOOKS, not whether
  // `renderToString` exists to call, so a failure loading it shouldn't be
  // able to leave `katexMod` permanently null the way an unhandled
  // rejection in a combined `Promise.all` silently did during testing.
  import('katex/dist/katex.min.css').catch(() => {})
  katexLoading = import('katex')
    .then((mod) => {
      katexMod = mod.default
      // Nothing in this transaction actually changes the document — it
      // exists purely to make ProseMirror re-run `decorations()`, which is
      // the only hook that calls `renderKatex` and had nothing to render
      // with until just now.
      view.dispatch(view.state.tr)
    })
    .catch(() => {
      // Leaves `katexMod` null, so `renderKatex` keeps falling back to raw
      // LaTeX text — the same degradation an unrecognised command already
      // produces via the `throwOnError: false` catch below, just from a
      // different cause. `katexLoading` is deliberately NOT cleared here:
      // retrying every keystroke after a real failure (a network blip, a
      // CDN outage) would hammer the same failing request repeatedly.
    })
}

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
  // Before the dynamic import resolves — or if it ever fails — the raw
  // source is exactly what the old synchronous catch path already fell
  // back to, so this isn't a new failure mode, just the same one with a
  // brief extra window at the start of a session.
  if (!katexMod) return latex
  try {
    return katexMod.renderToString(latex.trim(), { throwOnError: false, displayMode: display })
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
            const matches = findMatches(state.doc)
            for (const { from, to, latex, display } of matches) {
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
                    // `view` here is the one this widget factory is called
                    // with directly, not the plugin's closure-captured
                    // `editorView` — that one is set by the plugin's `view()`
                    // init hook, which runs AFTER the first `decorations()`
                    // pass, so it's still null on initial mount. This `view`
                    // is guaranteed live the moment a widget actually exists
                    // to render, which is exactly when the load needs to start.
                    ensureKatex(view)
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
                  // ProseMirror reuses a widget's existing DOM node across
                  // updates whenever its key is unchanged — it does NOT
                  // call `toDOM` again just because `decorations()` ran
                  // again. Before KaTeX loads, `renderKatex` renders the
                  // raw-text fallback into that DOM node; the empty
                  // transaction `ensureKatex` dispatches once the module
                  // arrives recomputes decorations, but every widget key
                  // would still match the stale one, and the raw fallback
                  // would sit there forever. Folding whether KaTeX is
                  // loaded into the key itself is what forces PM to treat
                  // it as a genuinely new widget once it's ready, so
                  // `toDOM` actually runs again and picks up the real
                  // rendered output.
                  { side: -1, key: `math-${from}-${to}-${katexMod ? 'k' : 'r'}` },
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
