/**
 * The subjects and topics this tab last saw, kept just long enough to guess where a
 * URL leads before the server has said.
 *
 * A topic's address is made of names (`/linear-algebra/eigenvalues`), and only the
 * `/spaces` answer says which topic id that is, so everything a topic page needs
 * (its messages, its files) used to wait one full round trip for it. Remembering the
 * last list lets `lib/prefetch` start those reads at the same moment as `/spaces`
 * on a reload or a deep link, and answer a hover on a sidebar link without waiting.
 *
 * Only ids and names, in `sessionStorage` (this tab, this visit), and dropped at
 * sign-out (`onCleared`). A wrong guess costs one wasted read, never a wrong screen:
 * the page still resolves its own topic from the live list.
 */

import type { Space } from '../api/types'
import { onCleared } from './asyncCache'

const KEY = 'sl:topics:v1'

let memory: Space[] | null = null

export function rememberSpaces(list: Space[]): void {
  memory = list
  try {
    const compact = list.map((s) => ({
      id: s.id,
      name: s.name,
      tone: s.tone,
      pinned: s.pinned,
      subspaces: s.subspaces.map((t) => ({ id: t.id, subject_id: t.subject_id, name: t.name })),
    }))
    sessionStorage.setItem(KEY, JSON.stringify(compact))
  } catch {
    /* private mode / quota — the in-memory copy still serves this page */
  }
}

export function knownSpaces(): Space[] {
  if (memory) return memory
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    memory = parsed.map((s) => ({
      ...(s as Space),
      subspaces: ((s as Space).subspaces ?? []).map((t) => ({
        ...t,
        last_activity_at: null,
        counts: {},
      })),
    }))
    return memory
  } catch {
    return []
  }
}

onCleared(() => {
  memory = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
})
