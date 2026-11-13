/**
 * A yes/no preference kept on this device, readable from any component.
 *
 * The same shape as `botPreference`, made reusable: localStorage can be
 * blocked (private windows), so every access is guarded and the default wins;
 * other tabs and other components update live.
 */

import { useSyncExternalStore } from 'react'

export type LocalSwitch = {
  get: () => boolean
  set: (on: boolean) => void
  use: () => boolean
}

export function localSwitch(key: string, fallback: boolean): LocalSwitch {
  const listeners = new Set<() => void>()
  const get = () => {
    try {
      const v = window.localStorage.getItem(key)
      return v === null ? fallback : v === 'on'
    } catch {
      return fallback
    }
  }
  const set = (on: boolean) => {
    try {
      if (on === fallback) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, on ? 'on' : 'off')
    } catch {
      /* blocked storage: the switch simply doesn't persist */
    }
    listeners.forEach((l) => l())
  }
  const subscribe = (onChange: () => void) => {
    listeners.add(onChange)
    const onStorage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) onChange()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(onChange)
      window.removeEventListener('storage', onStorage)
    }
  }
  return { get, set, use: () => useSyncExternalStore(subscribe, get, () => fallback) }
}

/** "Suggest what to ask" — the question offered above the chat box, and the starters. */
export const suggestSwitch = localSwitch('sl:suggest:v1', true)
