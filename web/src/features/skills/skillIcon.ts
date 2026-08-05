import type { IconName } from '../../components/ui/Icon'
import type { Tone } from '../../api/types'

/**
 * Skills store their icon as free text, and the seeded library rows (plus any
 * skill made before this change) hold an emoji. Emoji-as-icon is exactly the
 * look we're replacing, so nothing may render `skill.icon` directly.
 *
 * This resolves either form to a drawn icon: new skills save an `IconName`,
 * legacy rows fall through the emoji map, and anything unrecognised lands on
 * a sensible default rather than showing raw text.
 */

const EMOJI_TO_ICON: Record<string, IconName> = {
  '🧠': 'skill',
  '🎯': 'target',
  '📘': 'doc',
  '📝': 'note',
  '🔬': 'search',
  '💬': 'chat',
  '✦': 'sparkle',
  '⚡': 'agent',
  '🗂': 'deck',
  '❓': 'quiz',
  '🔥': 'flame',
}

const KNOWN: ReadonlySet<string> = new Set<IconName>([
  'skill', 'target', 'doc', 'note', 'search', 'chat', 'sparkle',
  'agent', 'deck', 'quiz', 'flame', 'seal', 'clock', 'user',
])

export function resolveSkillIcon(raw: string | null | undefined): IconName {
  if (!raw) return 'skill'
  const trimmed = raw.trim()
  if (KNOWN.has(trimmed)) return trimmed as IconName
  return EMOJI_TO_ICON[trimmed] ?? 'skill'
}

/** The picker's options — icon name plus the foil tone it pairs with. */
export const SKILL_ICON_CHOICES: { icon: IconName; tone: Tone; label: string }[] = [
  { icon: 'skill', tone: 'brand', label: 'Tutor' },
  { icon: 'target', tone: 'mint', label: 'Drill' },
  { icon: 'doc', tone: 'sky', label: 'Source-bound' },
  { icon: 'note', tone: 'coral', label: 'Summariser' },
  { icon: 'search', tone: 'sun', label: 'Examiner' },
  { icon: 'chat', tone: 'brand', label: 'Conversational' },
]
