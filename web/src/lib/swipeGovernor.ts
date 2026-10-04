/**
 * How far one swipe may carry the page.
 *
 * A Mac trackpad does not send one scroll event per notch: a flick sends
 * hundreds, for a second or more after the fingers have lifted ("momentum").
 * A normal flick adds up to ~2,000px. The landing page is a handful of
 * scroll-driven scenes in about 2,500px of scrolling in all, so one flick used
 * to fly through most of it — the scenes were skipped, and because it carried
 * on after the fingers left, it looked like the page scrolling by itself.
 *
 * The governor admits wheel events until a sliding window has carried the page
 * one cap's worth (about a screen), and refuses the rest of that burst. The
 * smooth scroller eases to wherever the last admitted event left it, so the
 * page glides to a stop instead of cutting off. A slow, deliberate scroll stays
 * under the cap and is never touched; a mouse wheel (100px a notch) rarely
 * reaches it.
 */

export type Admit = (distance: number, now?: number) => boolean

export function createSwipeGovernor(cap: () => number, windowMs = 900): Admit {
  const admitted: Array<[at: number, distance: number]> = []
  return (distance, now = performance.now()) => {
    while (admitted.length && now - admitted[0][0] > windowMs) admitted.shift()
    const used = admitted.reduce((sum, [, d]) => sum + d, 0)
    // The first event of a burst always counts, however large, or a single big
    // notch could never move the page at all.
    if (used > 0 && used + distance > cap()) return false
    admitted.push([now, distance])
    return true
  }
}

/** Macs, and iPads that call themselves Macs: whatever has Apple's trackpad momentum. */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Macintosh|Mac OS X|iPhone|iPad|iPod/.test(navigator.userAgent)
}
