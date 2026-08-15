/**
 * Real markdown persistence for the "Toggle section" block — `@tiptap/extension-
 * details` ships none for the markdown library this app actually uses.
 *
 * The extension DOES export a markdown spec (`createBlockMarkdownSpec`), but
 * that spec targets Tiptap's own official markdown integration — a
 * `{parseMarkdown, markdownTokenizer}` shape read by a different parser than
 * the one this app has (`tiptap-markdown`, a separate community package built
 * on `markdown-it`, which looks for `extension.storage.markdown = {serialize,
 * parse}` instead). The two don't speak to each other, so — confirmed by
 * mounting a real editor, building a toggle, and reading back what got
 * serialized — a toggle's markdown came out as the literal four-character
 * string `"[details]"`: `tiptap-markdown`'s own fallback for any node with no
 * spec IT recognizes. Reloading that string reproduced a paragraph containing
 * the literal text "[details]" — the toggle, its summary, and everything
 * inside it, gone. `Details.configure({ persist: true })` only ever
 * controlled in-memory open/closed state; it never touched storage.
 *
 * Fixed here with a real, symmetric parse/serialize pair, in the one syntax
 * markdown-it and this format can both actually round-trip:
 *
 *   :::details open Summary text on the fence line itself
 *   Nested markdown content — paragraphs, lists, headings, anything
 *   detailsContent's own `block+` schema already allows.
 *   :::
 *
 * `open` is a literal token, present only when the toggle was expanded at
 * save time; everything after it up to the line break is the summary
 * (detailsSummary's own schema is `text*` — plain text, one line, no nested
 * blocks, so there is nothing lost by keeping it on one line). Depth-tracked
 * so a toggle nested inside another toggle's content — a real thing
 * detailsContent's `block+` schema allows the slash menu to create — closes
 * on its OWN `:::`, not its parent's.
 */

import { Details } from '@tiptap/extension-details'
import type MarkdownIt from 'markdown-it'
import type StateBlock from 'markdown-it/lib/rules_block/state_block'
import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { MarkdownSerializerState } from 'prosemirror-markdown'

const OPEN_RE = /^:::details(?:\s+(open))?(?:\s+(.*))?$/
const CLOSE_LINE = ':::'

function detailsRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // Indented four spaces or more reads as a code block everywhere else in
  // this parser; a fence marker inside one is content, not a real fence.
  if (state.sCount[startLine] - state.blkIndent >= 4) return false

  const pos = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]
  const line = state.src.slice(pos, max)
  const match = OPEN_RE.exec(line)
  if (!match) return false

  // Find this fence's own closing `:::`, not an inner toggle's — a toggle
  // can contain another toggle, since detailsContent allows any block.
  let depth = 1
  let closeLine = -1
  for (let i = startLine + 1; i < endLine; i++) {
    const lineText = state.src
      .slice(state.bMarks[i] + state.tShift[i], state.eMarks[i])
      .trim()
    if (OPEN_RE.test(lineText)) depth++
    else if (lineText === CLOSE_LINE) {
      depth--
      if (depth === 0) {
        closeLine = i
        break
      }
    }
  }
  // No matching close — not a real fence (e.g. a stray "​:::details" a
  // student typed in prose). Leave it as ordinary text rather than
  // swallowing the rest of the note looking for a closer that isn't there.
  if (closeLine === -1) return false
  if (silent) return true

  const isOpen = Boolean(match[1])
  const summary = (match[2] ?? '').trim()

  const openToken = state.push('details_open', 'details', 1)
  openToken.attrSet('open', isOpen ? 'open' : '')
  openToken.map = [startLine, closeLine + 1]

  state.push('details_summary_open', 'summary', 1)
  const summaryInline = state.push('inline', '', 0)
  summaryInline.content = summary
  summaryInline.map = [startLine, startLine + 1]
  summaryInline.children = []
  state.push('details_summary_close', 'summary', -1)

  const contentOpen = state.push('details_content_open', 'div', 1)
  contentOpen.attrSet('data-type', 'detailsContent')

  // The nested lines are ordinary block markdown — headings, lists,
  // paragraphs, another toggle — tokenized the same way the top level is.
  const oldParent = state.parentType
  // @ts-expect-error — `parentType` is typed as a closed union upstream that
  // doesn't include custom container names; markdown-it itself only uses it
  // to decide when a lazy paragraph continuation should stop, so a made-up
  // value here is exactly as safe as the string literals it already uses.
  state.parentType = 'details'
  state.md.block.tokenize(state, startLine + 1, closeLine)
  state.parentType = oldParent

  state.push('details_content_close', 'div', -1)
  state.push('details_close', 'details', -1)

  state.line = closeLine + 1
  return true
}

export function detailsContainerPlugin(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'details', detailsRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
  // Renders to exactly the HTML `@tiptap/extension-details`'s own parseHTML
  // already expects (confirmed against its shipped node definitions) — the
  // DOM-to-ProseMirror half of the round trip is the extension's own,
  // already-correct code, not reimplemented here.
  md.renderer.rules.details_open = (tokens, idx) => {
    const open = tokens[idx].attrGet('open')
    return `<details${open ? ' open' : ''}>\n`
  }
  md.renderer.rules.details_summary_open = () => '<summary>'
  md.renderer.rules.details_summary_close = () => '</summary>\n'
  md.renderer.rules.details_content_open = () => '<div data-type="detailsContent">\n'
  md.renderer.rules.details_content_close = () => '</div>\n'
  md.renderer.rules.details_close = () => '</details>\n'
}

/**
 * The real `Details` node — extended, at module scope, with the serializer
 * half of the round trip (`detailsContainerPlugin` above is the parser
 * half). Module scope, not created inside a component: extensions are
 * meant to be stable identities across renders, the same reason
 * `NoteEditor.tsx`'s `lowlight` instance is a module constant too.
 */
export const DetailsWithMarkdown = Details.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const [summary, content] = [node.child(0), node.child(1)]
          const openFlag = node.attrs.open ? ' open' : ''
          const summaryText = summary.textContent.replace(/\r?\n/g, ' ').trim()
          state.write(`:::details${openFlag}${summaryText ? ` ${summaryText}` : ''}\n`)
          state.renderContent(content)
          state.ensureNewLine()
          state.write(':::')
          state.closeBlock(node)
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(detailsContainerPlugin)
          },
        },
      },
    }
  },
})
