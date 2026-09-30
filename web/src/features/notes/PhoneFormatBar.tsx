/**
 * The formatting bar a phone keyboard would have, if keyboards had one.
 *
 * It sits directly on top of the on-screen keyboard (tracked through
 * `visualViewport`, which is the only thing that knows where the keyboard
 * is — the layout viewport doesn't shrink for it on most phones) and only
 * exists while the editor has focus. It replaces the floating selection
 * bubble, which fights the native selection handles on touch.
 *
 * Buttons swallow the pointer-down so tapping one never blurs the editor —
 * blur would drop the keyboard mid-format.
 */

import { useEffect, useReducer, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { ActionSheet } from '../quizzes/phoneKit'
import { BLOCKS, BLOCK_ICON, MARKS, SELECTION_ACTIONS } from './toolbar'

/** How far the on-screen keyboard (or any overlay) covers the layout viewport's bottom. */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setInset(0)
    }
  }, [active])
  return inset
}

const KEEP_FOCUS = {
  onPointerDown: (e: React.PointerEvent) => e.preventDefault(),
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
}

export function PhoneFormatBar({
  editor,
  visible,
  onAi,
}: {
  editor: Editor
  /** Shown while the editor has focus. The bar stays mounted when hidden so
   *  its AI sheet (which steals focus by opening) doesn't unmount itself. */
  visible: boolean
  onAi: (prompt: string, from: number, to: number) => void
}) {
  const inset = useKeyboardInset(visible)
  const [aiOpen, setAiOpen] = useState(false)
  // Re-render as the caret moves so active states and the AI gate stay true.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    editor.on('transaction', tick)
    return () => void editor.off('transaction', tick)
  }, [editor])

  const { from, to, empty } = editor.state.selection
  const marks = MARKS.filter((m) => m.key !== 'strike')
  const blocks = BLOCKS.filter((b) => b.key !== 'toggle')

  const btn = (active: boolean) =>
    cn(
      'grid size-11 shrink-0 place-items-center rounded-xl text-[16px] transition-colors',
      active ? 'bg-brand-soft text-brand-deep' : 'text-ink-3 active:bg-line-soft',
    )

  return (
    <>
      <div
        role="toolbar"
        aria-label="Formatting"
        data-testid="phone-format-bar"
        style={{ bottom: inset }}
        hidden={!visible}
        className="fixed inset-x-0 z-30 flex items-center border-t border-line bg-raised pl-1 [&[hidden]]:hidden"
      >
        <div className="notes-formatbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1">
          {marks.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-label={m.title}
              aria-pressed={m.active(editor)}
              {...KEEP_FOCUS}
              onClick={() => m.run(editor)}
              className={cn(
                btn(m.active(editor)),
                m.key === 'bold' && 'font-bold',
                m.key === 'italic' && 'font-serif italic',
                m.key === 'underline' && 'underline',
              )}
            >
              {m.icon ? <Icon name={m.icon} size={17} /> : m.label}
            </button>
          ))}

          <button
            type="button"
            aria-label="Heading"
            aria-pressed={editor.isActive('heading')}
            {...KEEP_FOCUS}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={cn(btn(editor.isActive('heading')), 'font-bold')}
          >
            H
          </button>

          <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

          {blocks.map((b) => (
            <button
              key={b.key}
              type="button"
              aria-label={b.title}
              aria-pressed={b.active(editor)}
              {...KEEP_FOCUS}
              onClick={() => b.run(editor)}
              className={btn(b.active(editor))}
            >
              {BLOCK_ICON[b.key] ? <Icon name={BLOCK_ICON[b.key]} size={18} /> : b.label}
            </button>
          ))}

          <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

          <button
            type="button"
            aria-label="Improve selection with AI"
            aria-disabled={empty}
            disabled={empty}
            {...KEEP_FOCUS}
            onClick={() => setAiOpen(true)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold text-sky-deep active:bg-sky-soft',
              empty && 'opacity-40',
            )}
          >
            <Icon name="sparkle" size={15} /> AI
          </button>
        </div>

        <button
          type="button"
          {...KEEP_FOCUS}
          onClick={() => editor.commands.blur()}
          className="h-11 shrink-0 px-4 text-[15px] font-bold text-brand-deep active:bg-line-soft"
        >
          Done
        </button>
      </div>

      <ActionSheet
        open={aiOpen}
        title="Improve the selection"
        onClose={() => setAiOpen(false)}
        actions={SELECTION_ACTIONS.map((action) => ({
          label: action.label,
          icon: 'sparkle' as const,
          onSelect: () => {
            const sel = editor.state.doc.textBetween(from, to, '\n')
            if (!sel.trim()) return
            onAi(action.prompt(sel), action.replaces ? from : to, to)
          },
        }))}
      />
    </>
  )
}
