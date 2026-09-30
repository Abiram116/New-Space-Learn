/**
 * "Send myself the link": the native share sheet where there is one (so the
 * student can drop it in their notes app, a message to themselves, AirDrop),
 * the clipboard where there isn't. Pure over an injected `navigator`-shaped
 * object so every branch is testable.
 */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

type NavLike = {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>
  canShare?: (data: { title?: string; text?: string; url?: string }) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
}

export async function shareOrCopy(
  data: { title: string; url: string },
  nav: NavLike | undefined = typeof navigator !== 'undefined' ? (navigator as NavLike) : undefined,
): Promise<ShareOutcome> {
  if (nav?.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data)
      return 'shared'
    } catch (err) {
      // Closing the share sheet is a choice, not a failure — say nothing.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Anything else (no permission, not a user gesture) falls through to copy.
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(data.url)
      return 'copied'
    } catch {
      /* fall through */
    }
  }
  return 'failed'
}
