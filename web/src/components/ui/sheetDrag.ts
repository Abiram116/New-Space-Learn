/**
 * The arithmetic behind a bottom sheet's swipe-to-dismiss, kept pure so it
 * can be tested without a pointer, a layout engine or a clock.
 */

/** Past this share of the sheet's height, letting go dismisses it. */
export const DISMISS_FRACTION = 0.3
/** ...or past this many pixels, whichever is smaller (tall sheets). */
export const DISMISS_MAX_PX = 160
/** A flick this fast (px/ms, downward) dismisses regardless of distance. */
export const FLICK_VELOCITY = 0.5
/** A flick still has to travel a little, so a tap on the handle is not a flick. */
export const FLICK_MIN_PX = 24

/**
 * Where the sheet sits for a finger `dy` pixels below where it started.
 * Down follows the finger 1:1. Up is resisted and capped: the sheet is
 * already as tall as it gets, so pulling up should feel like pulling on
 * something anchored, not open a gap below it.
 */
export function sheetDragOffset(dy: number): number {
  if (dy >= 0) return dy
  return Math.max(-24, dy / 4)
}

/** Does letting go here close the sheet? */
export function shouldDismissSheet({
  dy,
  velocity,
  height,
}: {
  /** Downward travel since the drag began, px. */
  dy: number
  /** Downward speed at release, px/ms (negative = moving up). */
  velocity: number
  /** The sheet's rendered height, px. */
  height: number
}): boolean {
  if (dy <= 0) return false
  if (velocity >= FLICK_VELOCITY && dy >= FLICK_MIN_PX) return true
  const threshold = Math.min(Math.max(height, 1) * DISMISS_FRACTION, DISMISS_MAX_PX)
  return dy >= threshold
}

/** Backdrop opacity while dragging: fades as the sheet leaves. */
export function backdropOpacity(offset: number, height: number): number {
  if (offset <= 0 || height <= 0) return 1
  return Math.max(0, 1 - offset / height)
}
