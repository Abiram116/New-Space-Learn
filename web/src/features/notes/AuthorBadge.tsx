/**
 * Who wrote a note — one mark, drawn the same everywhere it appears.
 *
 * This used to be three different improvisations: the list drew a 9px page
 * with a 5px sparkle pinned to it (too small to read as anything), plus a
 * separate person-with-pencil glyph when you had edited it; the phone list
 * drew a lone sparkle; the editor header a chip that only appeared for AI
 * notes and said "Notes agent". A note you wrote yourself had no mark at all,
 * so "no icon" had to be read as "you" — and none of them looked alike.
 *
 * Now each party has a disc in its own tone, the one the rest of the app
 * already uses for it: **you** are a person on the brand tone, **AI** the
 * sparkle on sky (the colour of every AI command in the editor), and a note
 * both have written shows both discs overlapping, the way shared work is
 * drawn anywhere. A document is a page on a neutral disc. The exact story —
 * "Created by AI · Edited by you" — is the tooltip and the accessible name.
 */

import type { Note } from '../../api/types'
import { Icon, type IconName } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { AUTHORSHIP_LABEL, noteAuthorship, provenanceLabel, type Authorship } from './format'

const DISC: Record<'you' | 'ai' | 'doc', { icon: IconName; tone: string; filled?: boolean }> = {
  you: { icon: 'user', tone: 'bg-brand-soft text-brand-deep' },
  ai: { icon: 'sparkle', tone: 'bg-sky-soft text-sky-deep', filled: true },
  doc: { icon: 'doc', tone: 'bg-well text-ink-3' },
}

function Disc({ who, size, ring }: { who: 'you' | 'ai' | 'doc'; size: number; ring?: boolean }) {
  const { icon, tone, filled } = DISC[who]
  return (
    <span
      data-author={who}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full',
        tone,
        // Separates the overlapping pair: the front disc cuts a thin gap into
        // the one behind it, in the colour of whatever the badge sits on.
        ring && 'ring-2 ring-[var(--badge-ring,var(--color-canvas))]',
      )}
      style={{ width: size, height: size }}
    >
      <Icon name={icon} size={Math.round(size * 0.62)} filled={filled} />
    </span>
  )
}

/** Just the discs — for places that already say who in words. */
export function AuthorIcon({ who, size = 16 }: { who: Authorship; size?: number }) {
  if (who === 'both') {
    return (
      <span className="inline-flex shrink-0 items-center">
        <Disc who="you" size={size} />
        <span className="inline-flex" style={{ marginLeft: -Math.round(size * 0.35) }}>
          <Disc who="ai" size={size} ring />
        </span>
      </span>
    )
  }
  return <Disc who={who} size={size} />
}

export function AuthorBadge({
  note,
  size = 16,
  showLabel = false,
  className,
}: {
  note: Pick<Note, 'origin' | 'touched_by_user' | 'touched_by_agent'>
  size?: number
  /** Adds the short word ("You", "AI", "You + AI") beside the icon. */
  showLabel?: boolean
  className?: string
}) {
  const who = noteAuthorship(note)
  const full = provenanceLabel(note)
  return (
    <span
      role="img"
      aria-label={full}
      title={full}
      data-authorship={who}
      className={cn('inline-flex shrink-0 items-center gap-1.5', className)}
    >
      <AuthorIcon who={who} size={size} />
      {showLabel && (
        <span aria-hidden className="text-[12px] font-semibold text-ink-3">
          {AUTHORSHIP_LABEL[who]}
        </span>
      )}
    </span>
  )
}
