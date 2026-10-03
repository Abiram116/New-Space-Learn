/**
 * Pausing the landing page from elsewhere, without importing it: a card that
 * covers the page (the trust pages) asks it to hold still, and releases it
 * when it goes.
 *
 *   - the smooth scroller listens for the event (`detail` true = lock);
 *   - the per-frame animation loops (lamp, dust, parallax) check
 *     `isPageLocked()` and skip their work. Under a card those frames paint
 *     pixels nobody sees — and each one makes the browser redo the backdrop's
 *     blur — so skipping them is most of what keeps the card smooth on a
 *     cheap laptop or phone.
 */
export const SCROLL_LOCK_EVENT = 'sl:scroll-lock'

let locked = false

export function setPageScrollLocked(next: boolean): void {
  locked = next
  window.dispatchEvent(new CustomEvent<boolean>(SCROLL_LOCK_EVENT, { detail: next }))
}

/** True while something covers the page. Cheap enough to call every frame. */
export function isPageLocked(): boolean {
  return locked
}
