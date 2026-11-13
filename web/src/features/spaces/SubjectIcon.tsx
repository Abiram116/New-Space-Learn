/**
 * A subject's mark: its icon (derived from the name, see `lib/subjectIcon`)
 * on a small tile in the subject's own tone.
 *
 * One component so the rail, Home, a topic header and the phone all draw a
 * subject the same way — the tone used to be a 4px bar on its own, which said
 * "this is a subject" but not which one.
 */

import type { Space } from '../../api/types'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { matchedSubjectIcon, subjectIcon, subjectMonogram } from '../../lib/subjectIcon'
import { toneSoft, toneText } from '../../lib/tone'

const SIZES = {
  xs: { box: 'h-5 w-5 rounded-[6px]', glyph: 12 },
  sm: { box: 'h-6 w-6 rounded-[7px]', glyph: 14 },
  md: { box: 'h-8 w-8 rounded-[9px]', glyph: 17 },
  lg: { box: 'h-10 w-10 rounded-[11px]', glyph: 20 },
} as const

export function SubjectIcon({
  space,
  size = 'sm',
  className,
}: {
  space: Pick<Space, 'name' | 'tone'>
  size?: keyof typeof SIZES
  className?: string
}) {
  const s = SIZES[size]
  // A name no rule knows gets its first letter, not a generic book that every
  // such subject would share.
  const known = matchedSubjectIcon(space.name)
  const letter = known ? '' : subjectMonogram(space.name)
  return (
    <span
      aria-hidden
      data-subject-icon={subjectIcon(space.name)}
      className={cn('grid shrink-0 place-items-center', s.box, toneSoft[space.tone], toneText[space.tone], className)}
    >
      {letter ? (
        <span className="font-bold leading-none" style={{ fontSize: s.glyph - 2 }}>
          {letter}
        </span>
      ) : (
        <Icon name={subjectIcon(space.name)} size={s.glyph} />
      )}
    </span>
  )
}
