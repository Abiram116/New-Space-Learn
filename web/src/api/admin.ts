/**
 * The admin page's lock, on the browser's side.
 *
 * The shared password is exchanged for a short-lived token, kept for this tab
 * only (sessionStorage: closing the tab locks the page again). The password
 * itself is never stored. Admin calls carry that token and no account — the
 * admin side belongs to nobody's sign-in.
 */

import { apiFetch } from './client'
import { ApiError } from './errors'

const KEY = 'sl:desk'
/** Fired when the server stops accepting the token, so the page can lock. */
export const ADMIN_LOCKED_EVENT = 'sl:desk-locked'

type Stored = { token: string; expires_at: number }

function read(): Stored | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Stored | null
    return stored && stored.expires_at * 1000 > Date.now() ? stored : null
  } catch {
    return null
  }
}

export const isUnlocked = () => read() !== null

export function lock(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* nothing was stored */
  }
  window.dispatchEvent(new Event(ADMIN_LOCKED_EVENT))
}

export async function unlock(password: string): Promise<void> {
  const stored = await apiFetch<Stored>('/admin/unlock', { method: 'POST', body: { password }, anonymous: true })
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored))
  } catch {
    throw new ApiError('unknown', "This browser won't keep the page unlocked. Turn off private mode and try again.")
  }
}

type Init = { method?: string; body?: unknown }

export async function adminFetch<T>(path: string, init?: Init): Promise<T> {
  const stored = read()
  if (!stored) {
    lock()
    throw new ApiError('forbidden', 'The page is locked.', 403)
  }
  try {
    return await apiFetch<T>(path, { ...init, anonymous: true, headers: { 'X-Admin-Token': stored.token } })
  } catch (err) {
    // The token ran out, or the password was changed: back to the lock.
    if (err instanceof ApiError && err.code === 'forbidden') lock()
    throw err
  }
}
