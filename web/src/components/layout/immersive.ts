/**
 * Immersive mode for the phone shell.
 *
 * A screen that needs the whole height of a phone — card review, quiz taking,
 * the note editor — calls `useImmersive(true)` while it is up. The shell then
 * steps its top app bar and bottom tab bar aside, and brings them back the
 * moment the last immersive screen unmounts (or passes `false`).
 *
 *     useImmersive(isMobile && mode.kind === 'review')
 *
 * It is a counter, not a flag, so two immersive pieces overlapping during a
 * transition cannot leave the bars hidden when the first one clears its
 * claim. A module-level store rather than a context: it works from any screen
 * with no provider in the tree (tests, lazy chunks), and on desktop nothing
 * reads it, so calling it there is a harmless no-op.
 */

import { useEffect, useSyncExternalStore } from 'react'

let claims = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const snapshot = () => claims > 0

/** Claim immersive mode while `active` is true. Released on unmount. */
export function useImmersive(active: boolean = true): void {
  useEffect(() => {
    if (!active) return
    claims += 1
    emit()
    return () => {
      claims = Math.max(0, claims - 1)
      emit()
    }
  }, [active])
}

/** True while any screen holds an immersive claim. */
export function useIsImmersive(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

/** Test-only: drop every claim. */
export function resetImmersiveForTests(): void {
  claims = 0
  emit()
}
