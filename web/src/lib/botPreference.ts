/**
 * "Show the agent bots" — one switch every bot respects.
 *
 * The check lives INSIDE `Bot`, `BotSays` and `BotProgress`, so a screen that
 * shows a bot never has to remember to ask: turn it off in Settings and the
 * characters disappear everywhere at once, leaving the plain text (a line, a
 * progress message) that carried the information.
 *
 * Per device, in localStorage: it is a display taste (a shared laptop, a
 * quiet phone), not part of the student's model. Storage can be blocked
 * (private windows), so every access is guarded and the default is ON.
 * Other tabs update live through the `storage` event.
 */

import { useSyncExternalStore } from 'react'
import { useIsMobile } from './useIsMobile'

const KEY = 'sl:bots:v1'
const listeners = new Set<() => void>()

export function botsEnabledNow(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setBotsEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, 'off')
  } catch {
    /* blocked storage: the switch simply doesn't persist */
  }
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function useBotsEnabled(): boolean {
  return useSyncExternalStore(subscribe, botsEnabledNow, () => true)
}

/**
 * Whether bots actually draw: the student's preference AND not on a phone.
 * Phones are a quiet revision companion — no characters there (product
 * decision), whatever the preference says. Components use THIS; the Settings
 * switch uses `useBotsEnabled` (the preference alone) and is hidden on phones.
 */
export function useBotsShown(): boolean {
  const pref = useBotsEnabled()
  const phone = useIsMobile()
  return pref && !phone
}
