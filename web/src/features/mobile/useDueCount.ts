/**
 * Cards due, for the tab bar's badge — read from what Home already fetched.
 *
 * Deliberately never asks the server. Home loads `/me/stats` on every visit
 * and mirrors it into the `HOME_STATS_KEY` cache; this only listens to that
 * mirror. Before Home has loaded once there is simply no badge, which beats
 * adding a stats request to every screen just to decorate an icon.
 */

import { useSyncExternalStore } from 'react'
import type { Stats } from '../../api/types'
import { readCache, subscribe } from '../../lib/asyncCache'
import { HOME_STATS_KEY } from '../../lib/homeKeys'

const sub = (fn: () => void) => subscribe(HOME_STATS_KEY, fn)
const read = () => readCache<Stats>(HOME_STATS_KEY)?.data?.cards_due ?? null

export function useDueCount(): number | null {
  return useSyncExternalStore(sub, read, () => null)
}
