/**
 * "Send myself the link" — for someone on a phone who wants to carry on at a
 * desk. The share-or-copy mechanics are the shell's (`mobile/shareLink`); this
 * adds what the screens say afterwards and which address they send.
 */

import { shareOrCopy, type ShareOutcome } from '../mobile/shareLink'

export type { ShareOutcome }

export function sendLink({ title, url }: { title: string; url: string }): Promise<ShareOutcome> {
  return shareOrCopy({ title, url })
}

/** The toast for an outcome, or null when nothing should be said. */
export function shareMessage(
  outcome: ShareOutcome,
  url: string,
): { text: string; kind: 'success' | 'info' | 'error' } | null {
  switch (outcome) {
    case 'copied':
      return { text: 'Link copied — paste it wherever you’ll open it on your computer.', kind: 'success' }
    case 'failed':
      return { text: `Couldn’t share from this browser. The address is ${url}`, kind: 'info' }
    default:
      return null
  }
}

/** The app's own address, without whatever screen this happens to be. */
export function appUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/`
}
