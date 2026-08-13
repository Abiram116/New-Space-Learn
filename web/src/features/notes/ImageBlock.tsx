/**
 * An image you can actually work with: resize it, align it, caption it.
 *
 * Tiptap's stock `Image` renders a bare `<img>` with no handles and no
 * caption, which is why a note full of screenshots read as a scrapbook.
 *
 * **The hard part is persistence, not the handles.** A note is stored as
 * markdown (`notes.body_md`), so anything this node knows has to survive
 * being serialised to markdown and parsed back. Inventing an HTML-ish syntax
 * would mean the stored note is no longer really markdown — it would render
 * as noise anywhere else, and `html: false` on the markdown extension would
 * escape it into visible text on the way back in.
 *
 * So both extras ride inside standard markdown image syntax:
 *
 *     ![caption](data:image/png;base64,… "w=62;a=center")
 *
 * `alt` carries the caption, which is what alt text is *for* — it round-trips
 * for free and makes the note accessible as a side effect. `title` carries
 * width and alignment as a tiny key=value string. Any other markdown renderer
 * shows a correctly captioned image and ignores the title; nothing breaks.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from '@tiptap/extension-image'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'

type Align = 'left' | 'center' | 'right'

/** Smallest useful size — below this the image is a thumbnail, not content. */
export const MIN_WIDTH = 20
export const MAX_WIDTH = 100

/** Exported for `ImageBlock.test.ts` — the round-trip through markdown's
 * `title` string is the one place a bug here would be silent: nothing
 * throws, an image just quietly forgets its width or alignment on reload. */
export function parseTitle(title: string | null): { width: number | null; align: Align } {
  let width: number | null = null
  let align: Align = 'center'
  for (const part of (title ?? '').split(';')) {
    const [k, v] = part.split('=')
    if (k === 'w') {
      const n = Number(v)
      if (Number.isFinite(n)) width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n))
    }
    if (k === 'a' && (v === 'left' || v === 'center' || v === 'right')) align = v
  }
  return { width, align }
}

export function buildTitle(width: number | null, align: Align): string | null {
  const parts: string[] = []
  if (width != null) parts.push(`w=${Math.round(width)}`)
  // Centre is the default, so it isn't worth a character in the file.
  if (align !== 'center') parts.push(`a=${align}`)
  return parts.length ? parts.join(';') : null
}

/** What each placement actually does, said plainly. */
const WRAP_LABEL: Record<Align, string> = {
  left: 'Wrap text on the right',
  center: 'Break the text — image on its own line',
  right: 'Wrap text on the left',
}

function ImageBlockView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const src = node.attrs.src as string
  const caption = (node.attrs.alt as string) ?? ''
  const width = node.attrs.width as number | null
  const align = (node.attrs.align as Align) ?? 'center'
  const editable = editor.isEditable

  const wrapRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  // Live width during a drag. Committing to the document on every mousemove
  // would push one undo entry per pixel and re-serialise the whole note each
  // time; this keeps the drag local and writes once on release.
  const [draft, setDraft] = useState<number | null>(null)

  const startResize = useCallback(
    (event: React.PointerEvent, edge: 'left' | 'right') => {
      if (!editable) return
      event.preventDefault()
      event.stopPropagation()
      const container = wrapRef.current?.parentElement
      if (!container) return
      const full = container.getBoundingClientRect().width
      const startX = event.clientX
      const startW = width ?? 100
      setDragging(true)

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - startX
        // Dragging the left handle outward grows the image, so its delta is
        // inverted relative to the right handle.
        const delta = ((edge === 'right' ? dx : -dx) / full) * 100
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + delta))
        setDraft(next)
      }
      const onUp = () => {
        setDragging(false)
        setDraft((v) => {
          if (v != null) updateAttributes({ width: Math.round(v) })
          return null
        })
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [editable, width, updateAttributes],
  )

  useEffect(() => {
    if (!dragging) return
    // A drag that leaves the window still has to end somewhere.
    const cancel = () => setDragging(false)
    window.addEventListener('blur', cancel)
    return () => window.removeEventListener('blur', cancel)
  }, [dragging])

  const shown = draft ?? width ?? 100
  const active = selected || dragging

  return (
    <NodeViewWrapper
      className={cn(
        'notes-image group relative flex flex-col',
        // `float`, not flex alignment. Aligning a block-level image left still
        // reserves the whole line for it, so text sits above and below and
        // never beside — which is not what "put it on the left" means to
        // anyone who has used a word processor. Floating lets the paragraph
        // wrap around it, which is the behaviour being asked for.
        align === 'left' && 'float-left mr-5 mb-3 mt-1 max-w-[60%]',
        align === 'right' && 'float-right ml-5 mb-3 mt-1 max-w-[60%]',
        // Centre stays in the flow and clears any float above it, so a
        // full-width image after a wrapped one starts on a clean line.
        align === 'center' && 'clear-both my-4 items-center',
      )}
      data-drag-handle
    >
      <div
        ref={wrapRef}
        className="relative max-w-full"
        style={{ width: `${shown}%` }}
      >
        <img
          src={src}
          alt={caption}
          draggable={false}
          className={cn(
            'block h-auto w-full rounded-[10px] transition-shadow select-none',
            active
              ? 'ring-2 ring-brand shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)]'
              : 'ring-1 ring-line',
          )}
        />

        {editable && (
          <>
            {/* Grab either edge. Two handles rather than one because an image
                aligned right grows the wrong way from a right-only handle. */}
            {(['left', 'right'] as const).map((edge) => (
              <span
                key={edge}
                role="presentation"
                onPointerDown={(e) => startResize(e, edge)}
                className={cn(
                  'absolute top-1/2 z-10 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full',
                  'bg-brand opacity-0 transition-opacity group-hover:opacity-100',
                  active && 'opacity-100',
                  edge === 'left' ? '-left-1' : '-right-1',
                )}
              />
            ))}

            {/* Controls appear on hover or selection, never permanently —
                a toolbar bolted to every image turns a page of screenshots
                into a page of chrome. */}
            <div
              className={cn(
                'absolute -top-3 right-2 z-20 flex items-center gap-0.5 rounded-[9px]',
                'border border-line bg-raised p-0.5 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.9)]',
                'opacity-0 transition-opacity group-hover:opacity-100',
                active && 'opacity-100',
              )}
            >
              {(
                [
                  ['left', 'wrapLeft'],
                  ['center', 'wrapNone'],
                  ['right', 'wrapRight'],
                ] as const
              ).map(([value, icon]) => (
                <button
                  key={value}
                  type="button"
                  title={WRAP_LABEL[value]}
                  aria-label={WRAP_LABEL[value]}
                  aria-pressed={align === value}
                  onClick={() => updateAttributes({ align: value })}
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-md transition-colors cursor-pointer',
                    align === value
                      ? 'bg-brand-soft text-brand-deep'
                      : 'text-ink-3 hover:bg-line-soft',
                  )}
                >
                  <Icon name={icon} size={12} />
                </button>
              ))}
              <span className="mx-0.5 h-4 w-px bg-line" />
              <span className="px-1 text-[10.5px] tabular-nums text-muted">
                {Math.round(shown)}%
              </span>
              <button
                type="button"
                title="Reset to full width"
                aria-label="Reset to full width"
                onClick={() => updateAttributes({ width: null })}
                className="grid h-6 w-6 place-items-center rounded-md text-ink-3 transition-colors cursor-pointer hover:bg-line-soft"
              >
                <Icon name="refresh" size={12} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* The caption doubles as alt text, so writing one makes the note more
          accessible rather than just prettier. Hidden entirely when empty and
          not editable, so a read-only note has no dangling blank line. */}
      {(editable || caption) && (
        <input
          value={caption}
          onChange={(e) => updateAttributes({ alt: e.target.value })}
          placeholder={editable ? 'Add a caption…' : ''}
          readOnly={!editable}
          // Typing here must not reach ProseMirror as document input.
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            // `mt-1`, not `mt-2`: the caption belongs to the image, and a gap
            // as large as the paragraph spacing made it read as a separate
            // line of prose that happened to follow.
            'mt-1 max-w-full border-0 bg-transparent p-0 text-center text-[12px] leading-snug text-muted',
            'outline-none placeholder:text-faint focus:text-ink-3',
            align === 'left' && 'text-left',
            align === 'right' && 'text-right',
          )}
          style={{ width: `${shown}%` }}
        />
      )}
    </NodeViewWrapper>
  )
}

export const ImageBlock = Image.extend({
  // Images sit on their own line and can be selected as a unit.
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      /**
       * Percentage of the writing column, or null for full width.
       *
       * Read back out of the markdown `title` on parse — see the file header
       * for why the extras live there rather than in bespoke syntax.
       */
      width: {
        default: null as number | null,
        parseHTML: (el) => {
          const explicit = el.getAttribute('data-width')
          if (explicit) return Number(explicit)
          return parseTitle(el.getAttribute('title')).width
        },
        renderHTML: (attrs) =>
          attrs.width ? { 'data-width': String(attrs.width) } : {},
      },
      align: {
        default: 'center' as Align,
        parseHTML: (el) =>
          (el.getAttribute('data-align') as Align | null) ??
          parseTitle(el.getAttribute('title')).align,
        renderHTML: (attrs) =>
          attrs.align && attrs.align !== 'center'
            ? { 'data-align': attrs.align }
            : {},
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView)
  },

  addStorage() {
    return {
      ...this.parent?.(),
      markdown: {
        /**
         * `![caption](src "w=..;a=..")` — standard markdown image syntax, so
         * the stored note stays a real markdown document.
         */
        serialize(
          state: { write: (s: string) => void; esc: (s: string) => string; closeBlock: (n: unknown) => void },
          node: { attrs: Record<string, unknown> },
        ) {
          const alt = state.esc(String(node.attrs.alt ?? ''))
          const src = String(node.attrs.src ?? '')
          const title = buildTitle(
            (node.attrs.width as number | null) ?? null,
            ((node.attrs.align as Align) ?? 'center'),
          )
          // The src is a data URL and must not be escaped or line-wrapped.
          state.write(`![${alt}](${src}${title ? ` "${title}"` : ''})`)
          state.closeBlock(node)
        },
        parse: {
          // markdown-it already turns `![a](b "c")` into an <img> carrying
          // alt/src/title; the attribute parsers above pick the extras out.
        },
      },
    }
  },
})
