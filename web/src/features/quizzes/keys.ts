/**
 * Keyboard for the study stage — the full-page quiz, and (via the shared
 * guard) card review.
 *
 * The mapping from a key to an intent is a pure function of the key and a
 * small snapshot of state, so it can be tested without a DOM and so the
 * component's listener stays a thin "read state, act, preventDefault" loop.
 *
 * The rules the listener enforces around it (see `stageKeyGate`):
 *   - never while typing (input, textarea, select, contenteditable)
 *   - never with a modifier held (leave browser/OS shortcuts alone)
 *   - never under an open modal (the modal owns the keyboard)
 *   - never on a held key (`e.repeat`): holding Enter must not run the quiz
 */

/* ── Quiz ─────────────────────────────────────────────────────────────── */

export type QuizKeyState = {
  /** The current question has been answered and its verdict shown. */
  revealed: boolean
  /** Keyboard-highlighted option, or -1 before the first arrow key. */
  highlight: number
  /** How many options this question has. */
  count: number
  /** The option that actually holds DOM focus, if any (Tab, or a click). */
  focused?: number | null
}

export type QuizKeyAction =
  | { type: 'highlight'; index: number }
  | { type: 'choose'; index: number }
  | { type: 'advance' }
  | { type: 'leave' }

const NEXT_KEYS = new Set(['ArrowDown', 'ArrowRight', 'j', 'J'])
const ADVANCE_KEYS = new Set(['ArrowRight', 'n', 'N'])
const PREV_KEYS = new Set(['ArrowUp', 'ArrowLeft', 'k', 'K'])

export function isConfirmKey(key: string): boolean {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}

/**
 * What a key means on the quiz stage right now, or null for "not ours".
 *
 * - ↑/↓, ←/→, j/k move the highlight (wrapping). The first press from
 *   nothing lands on the first option, whichever direction it was.
 * - Enter/Space picks the highlighted (or focused) option; with nothing
 *   highlighted it highlights the first one instead of guessing.
 * - 1–4 and A–D pick directly.
 * - Once answered, Enter/Space/→/n goes on (next question, or the results).
 * - Esc asks before leaving.
 */
export function quizKeyAction(key: string, s: QuizKeyState): QuizKeyAction | null {
  if (key === 'Escape' || key === 'Esc') return { type: 'leave' }

  if (s.revealed) {
    // Enter/Space, but also → and n: "next" in every other reader. Down/j/k stay
    // unbound here so a stray press can't skip the explanation.
    return isConfirmKey(key) || ADVANCE_KEYS.has(key) ? { type: 'advance' } : null
  }

  const n = s.count
  if (n <= 0) return null
  const current = s.focused ?? s.highlight

  if (NEXT_KEYS.has(key)) {
    return { type: 'highlight', index: current < 0 ? 0 : (current + 1) % n }
  }
  if (PREV_KEYS.has(key)) {
    return { type: 'highlight', index: current < 0 ? 0 : (current - 1 + n) % n }
  }
  if (isConfirmKey(key)) {
    return current < 0 ? { type: 'highlight', index: 0 } : { type: 'choose', index: current }
  }

  const direct = directChoice(key)
  if (direct !== null && direct < n) return { type: 'choose', index: direct }
  return null
}

/** 1–9 or a–i → a zero-based option index; anything else → null. */
export function directChoice(key: string): number | null {
  if (key.length !== 1) return null
  if (key >= '1' && key <= '9') return key.charCodeAt(0) - 49
  const lower = key.toLowerCase()
  if (lower >= 'a' && lower <= 'i') return lower.charCodeAt(0) - 97
  return null
}

/* ── The gate every stage listener passes through ────────────────────── */

const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const CONTROL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], summary'

export function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false
  const el = t as HTMLElement
  return el.isContentEditable === true || el.closest(TYPING) !== null
}

export type KeyGate =
  /** Not ours at all — leave the event alone. */
  | 'ignore'
  /** A held key we would otherwise handle — swallow it (no scroll, no act). */
  | 'swallow'
  /** Ours to handle. */
  | 'handle'

/**
 * Whether the stage should act on this keydown.
 *
 * `ownAttr` marks the stage's own controls (option buttons, the card, the
 * grade buttons): Enter/Space on those is routed through the stage's key
 * logic. Enter/Space on ANY OTHER control — Leave, Next, a sidebar link — is
 * left to the browser so it clicks what is focused, exactly once.
 */
export function stageKeyGate(
  e: Pick<KeyboardEvent, 'key' | 'repeat' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target' | 'defaultPrevented'>,
  opts: { ownAttr: string; modalOpen?: boolean; wouldHandle: boolean },
): KeyGate {
  if (e.defaultPrevented) return 'ignore'
  if (e.metaKey || e.ctrlKey || e.altKey) return 'ignore'
  if (opts.modalOpen) return 'ignore'
  if (isTypingTarget(e.target)) return 'ignore'
  if (!opts.wouldHandle) return 'ignore'
  if (isConfirmKey(e.key) && isForeignControl(e.target, opts.ownAttr)) return 'ignore'
  return e.repeat ? 'swallow' : 'handle'
}

function isForeignControl(t: EventTarget | null, ownAttr: string): boolean {
  if (!t || typeof (t as Element).closest !== 'function') return false
  const control = (t as Element).closest(CONTROL)
  return control !== null && !control.hasAttribute(ownAttr)
}

/** True while any modal dialog is on screen — it owns the keyboard then. */
export function anyModalOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null
}
