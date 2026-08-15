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
  'check', 'thumbDown', 'quote', 'alert', 'thumbUp', 'pencil',
  'lock', 'pin', 'send', 'refresh', 'home',
])

export function resolveSkillIcon(raw: string | null | undefined): IconName {
  if (!raw) return 'skill'
  const trimmed = raw.trim()
  if (KNOWN.has(trimmed)) return trimmed as IconName
  return EMOJI_TO_ICON[trimmed] ?? 'skill'
}

/**
 * The picker's options — icon name plus the foil tone it pairs with.
 *
 * One tone each, covering the full seven-tone system. This used to repeat
 * `brand` on both `skill` and `chat` — two different personas rendered as
 * the exact same colour everywhere a skill's identity shows (the "Active in
 * this space" grid, the icon picker itself) — while `azure` and `jade` sat
 * completely unreachable through this screen despite already existing in
 * the palette. No new colour needed, only the two that were already there.
 */
export const SKILL_ICON_CHOICES: { icon: IconName; tone: Tone; label: string }[] = [
  { icon: 'skill', tone: 'brand', label: 'Tutor' },
  { icon: 'target', tone: 'mint', label: 'Drill' },
  { icon: 'doc', tone: 'sky', label: 'Source-bound' },
  { icon: 'note', tone: 'coral', label: 'Summariser' },
  { icon: 'search', tone: 'sun', label: 'Examiner' },
  { icon: 'chat', tone: 'azure', label: 'Conversational' },
  { icon: 'flame', tone: 'jade', label: 'Coach' },
]

/**
 * Every icon offered under "Custom icon" — a broader set than the seven
 * quick-pick personas above, for when none of them fits. Deliberately not
 * the entire `IconName` union: editor-chrome and text-formatting glyphs
 * (alignLeft, wrapNone, listBullet, table, close, trash…) mean nothing as a
 * persona's identity, so they're left out rather than padding the grid with
 * choices nobody would pick. Tone is chosen separately from icon here — the
 * quick picks fix both together, this doesn't need to.
 */
export const SKILL_ICON_LIBRARY: IconName[] = [
  'skill', 'target', 'doc', 'note', 'search', 'chat', 'sparkle', 'agent',
  'deck', 'quiz', 'flame', 'seal', 'clock', 'user', 'check', 'thumbUp',
  'thumbDown', 'quote', 'alert', 'pencil', 'lock', 'pin', 'send', 'refresh',
  'home',
]

/**
 * Which shelf a *library* skill sits on — a lightweight, purely client-side
 * grouping for the "FROM THE LIBRARY" grid, matched by name. There is no
 * `category` column and this deliberately doesn't add one: the ten library
 * rows are fixed, known content, not something a schema migration is worth
 * for a display grouping. A custom skill (cloned or hand-written) simply
 * isn't in this map and renders without a shelf, same as today.
 */
export const LIBRARY_CATEGORY: Record<string, string> = {
  'Socratic Tutor': 'Learning',
  'Concept Simplifier': 'Learning',
  'Feynman Tutor': 'Learning',
  'Mistake Analyst': 'Learning',
  'Compare & Contrast': 'Learning',
  'Exam Cram': 'Exam',
  'Exam Examiner': 'Exam',
  'Debugging Mentor': 'Technical',
  'Code Review Mentor': 'Technical',
  'Paper Explainer': 'Research',
}

/** Render order for the shelves above — otherwise they'd follow whatever
 *  order the API happens to return rows in, which isn't guaranteed stable. */
export const LIBRARY_CATEGORY_ORDER = ['Learning', 'Exam', 'Technical', 'Research'] as const
