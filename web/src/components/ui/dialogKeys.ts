/**
 * ← / → inside a dialog's action row.
 *
 * Every confirm dialog is a pair of buttons side by side, and Tab is the only
 * way across — fine for a screen reader, slow for someone who has just hit Esc
 * on a quiz and wants "Leave" rather than the pre-focused "Cancel". The arrows
 * move along the row the way they do on the review grades; the ends are ends
 * (no wrap), and nothing outside a dialog's action row is affected.
 *
 * Returns true when it moved focus, so the caller knows the key is spent.
 */
export function moveAcrossActions(e: KeyboardEvent): boolean {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return false
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
  const current = document.activeElement
  if (!(current instanceof HTMLElement)) return false
  const row = current.closest('[data-dialog-actions]')
  if (!row || !current.matches('button, a[href]')) return false

  const items = Array.from(row.querySelectorAll<HTMLElement>('button, a[href]')).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('tabindex') !== '-1',
  )
  const i = items.indexOf(current)
  if (i === -1 || items.length < 2) return false
  const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]
  e.preventDefault()
  if (next !== current) next.focus({ preventScroll: true })
  return true
}
