/**
 * What marks AI-written text inside a note — drawn, never stored.
 *
 * Two things, both pure decorations so the markdown a note saves is exactly
 * what it was before:
 *
 * **The placeholder while the AI writes.** `runInlineAi` drops the literal
 * text "Thinking…" where the answer will land (see `aiPlaceholder.ts` for
 * why it is real text). On its own that read as something the student had
 * typed — same font, same colour, no sign of who was writing. The range is
 * handed to this plugin, which draws it as the AI's: the sparkle badge used
 * for AI everywhere in the notes UI, in the AI's sky tone, gently pulsing.
 * The range is mapped through every edit, so typing above it never strands
 * the mark on the wrong words, and it is dropped the moment the answer lands
 * or the request fails.
 *
 * **The source line under an AI passage.** Every AI insert ends with an
 * italic `Source: …` line (`sourceLine` in `format.ts`). This tags that
 * paragraph so it carries the same AI badge — the one stored, visible trace
 * of "the AI wrote the passage above", made recognisable at a glance.
 */

import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const aiPendingKey = new PluginKey<{ from: number; to: number } | null>('aiPending')

/** Marks `[from, to)` as the AI's placeholder; `null` clears it. */
export function setAiPending(tr: Transaction, range: { from: number; to: number } | null): Transaction {
  return tr.setMeta(aiPendingKey, range ?? 'clear')
}

/** The placeholder range currently marked, if any. */
export function aiPendingRange(state: EditorState): { from: number; to: number } | null {
  return aiPendingKey.getState(state) ?? null
}

/** A paragraph that is the italic `Source:` line an AI insert ends with. */
export function isAiSourceLine(node: PMNode): boolean {
  if (node.type.name !== 'paragraph' || node.childCount === 0) return false
  if (!/^Sources?:\s/.test(node.textContent)) return false
  let allItalic = true
  node.forEach((child) => {
    if (child.isText && !child.marks.some((m) => m.type.name === 'italic')) allItalic = false
  })
  return allItalic
}

/** The same four-point sparkle `Icon` draws, as a DOM node for a widget. */
function sparkleBadge(): HTMLElement {
  const badge = document.createElement('span')
  badge.className = 'note-ai-badge'
  badge.setAttribute('contenteditable', 'false')
  badge.setAttribute('role', 'img')
  badge.setAttribute('aria-label', 'AI is writing')
  badge.title = 'AI is writing'
  badge.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5c.9 4.4 2.2 5.7 6.5 6.5-4.3.8-5.6 2.1-6.5 6.5-.9-4.4-2.2-5.7-6.5-6.5 4.3-.8 5.6-2.1 6.5-6.5Z"/></svg>'
  return badge
}

export const AiMarks = Extension.create({
  name: 'aiMarks',
  addProseMirrorPlugins() {
    return [
      new Plugin<{ from: number; to: number } | null>({
        key: aiPendingKey,
        state: {
          init: () => null,
          apply(tr, range) {
            const meta = tr.getMeta(aiPendingKey) as { from: number; to: number } | 'clear' | undefined
            if (meta === 'clear') return null
            if (meta) return meta
            if (!range || !tr.docChanged) return range
            const from = tr.mapping.map(range.from, 1)
            const to = tr.mapping.map(range.to, -1)
            // The placeholder itself was deleted — nothing left to mark.
            return to > from ? { from, to } : null
          },
        },
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const range = aiPendingKey.getState(state)
            if (range && range.to <= state.doc.content.size) {
              decorations.push(
                Decoration.widget(range.from, sparkleBadge, { side: -1, key: 'ai-pending-badge' }),
                Decoration.inline(range.from, range.to, { class: 'note-ai-pending' }),
              )
            }
            state.doc.descendants((node, pos) => {
              if (isAiSourceLine(node)) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: 'note-ai-source',
                    title: 'Written by AI, from these sources',
                  }),
                )
              }
              // Paragraphs can't hold paragraphs; only descend through containers.
              return !node.isTextblock
            })
            return decorations.length ? DecorationSet.create(state.doc, decorations) : DecorationSet.empty
          },
        },
      }),
    ]
  },
})
