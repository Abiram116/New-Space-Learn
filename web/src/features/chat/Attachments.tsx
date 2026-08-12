/**
 * Screenshots attached to a question: the strip above the composer, and the
 * viewer you get when you click one.
 *
 * **Why `data:` URLs and not uploads.** A pasted screenshot has no filename,
 * no permanence, and no reason to become a `document` — it is part of one
 * question, not material to be chunked, embedded and cited for months. Sending
 * it inline keeps the whole thing in one request and leaves nothing behind to
 * clean up. The cost is wire size, which is why the caps live server-side in
 * `guardrails.validate_images` as well as here: the client is the convenient
 * place to check and the wrong place to trust.
 *
 * **Downscaled before it is ever attached.** A modern phone screenshot is
 * several megabytes, and base64 adds a third on top. Resizing to a long edge
 * of 1400px keeps a formula or a code snippet legible while turning a 6MB
 * paste into a few hundred KB — the difference between a request that works on
 * a free-tier worker and one that does not.
 */

import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'

/** Long edge, in pixels. Above this, detail is lost to JPEG before it is lost
 *  to scaling — a 1400px screenshot still reads at a glance. */
const MAX_EDGE = 1400

/** Mirrors the server allow-list. SVG is excluded there and here. */
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

export type Attachment = { id: string; url: string; name: string }

/**
 * Turn a pasted or picked file into a capped `data:` URL.
 *
 * Returns null for anything that is not an image we accept, so callers can
 * ignore the paste rather than surface an error — someone pasting text that
 * happens to carry a file handle has not made a mistake worth interrupting.
 *
 * GIFs are passed through untouched: drawing one to a canvas keeps the first
 * frame and silently destroys the animation, which for a screen recording is
 * the entire content.
 */
export async function fileToAttachment(file: File): Promise<Attachment | null> {
  if (!ACCEPTED.includes(file.type)) return null
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const raw = await readAsDataUrl(file)
  if (file.type === 'image/gif') return { id, url: raw, name: file.name || 'image' }
  const url = await downscale(raw).catch(() => raw)
  return { id, url, name: file.name || 'screenshot' }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function downscale(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      // Already small enough — re-encoding would only lose quality.
      if (scale === 1) return resolve(dataUrl)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return resolve(dataUrl)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // JPEG at 0.85: screenshots of text survive it, and PNG of a photographic
      // screenshot is several times larger for no visible gain.
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('not decodable'))
    img.src = dataUrl
  })
}

/* ── The strip ────────────────────────────────────────────────────────── */

export function AttachmentStrip({
  items,
  onRemove,
  onOpen,
}: {
  items: Attachment[]
  onRemove: (id: string) => void
  onOpen: (item: Attachment) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {items.map((item) => (
        <div key={item.id} className="group relative">
          <button
            type="button"
            onClick={() => onOpen(item)}
            aria-label={`Open ${item.name}`}
            className={cn(
              'block h-16 w-16 overflow-hidden rounded-[10px] border border-line',
              'cursor-zoom-in t-control duration-200 hover:border-brand/50',
            )}
          >
            <img src={item.url} alt="" className="h-full w-full object-cover" />
          </button>
          {/* Visible on hover on a pointer device, and *always* on touch —
              `opacity-0` alone would make removing an attachment impossible on
              a phone, which is the same mistake the sidebar's delete button
              shipped twice. `focus-visible` covers the keyboard path. */}
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.name}`}
            className={cn(
              'absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full',
              'border border-line bg-surface text-muted shadow-sm cursor-pointer',
              't-control duration-150 hover:border-coral/50 hover:text-coral-deep',
              'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100',
            )}
          >
            <Icon name="close" size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── The viewer ───────────────────────────────────────────────────────── */

/**
 * A click-to-open viewer, deliberately not a full lightbox.
 *
 * The point of opening a thumbnail is to check that the right thing was
 * attached and that the text in it is legible — so it opens large enough to
 * read and closes on anything: Escape, the backdrop, the button. A gallery
 * with arrows would be a feature for browsing, and nobody browses their own
 * three-second-old paste.
 */
export function AttachmentViewer({
  item,
  onClose,
}: {
  item: Attachment | null
  onClose: () => void
}) {
  useEffect(() => {
    if (!item) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, onClose])

  if (!item) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={onClose}
      className={cn(
        'fixed inset-0 z-[90] grid place-items-center bg-well/85 p-6 backdrop-blur-sm',
        'motion-safe:animate-[dockSwap_180ms_var(--ease-sl)_both]',
      )}
    >
      <img
        src={item.url}
        alt={item.name}
        // Stops a click on the image itself from closing — the backdrop is the
        // dismiss target, and clicking the thing you opened to look at should
        // not put it away.
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-xl border border-line object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-3 cursor-pointer t-control duration-200 hover:text-ink"
      >
        <Icon name="close" size={15} />
      </button>
    </div>
  )
}

/** Shared state for the strip and the viewer, so the composer stays readable. */
export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([])
  const [viewing, setViewing] = useState<Attachment | null>(null)

  const add = async (files: File[], limit = LIMITS.chatImages) => {
    const room = limit - items.length
    if (room <= 0) return
    const next = (await Promise.all(files.slice(0, room).map(fileToAttachment))).filter(
      (a): a is Attachment => a !== null,
    )
    if (next.length) setItems((prev) => [...prev, ...next])
  }

  return {
    items,
    viewing,
    add,
    remove: (id: string) => setItems((prev) => prev.filter((i) => i.id !== id)),
    clear: () => setItems([]),
    open: setViewing,
    closeViewer: () => setViewing(null),
  }
}
