/**
 * Wake the backend before the user needs it.
 *
 * Render's free tier spins the API down after 15 minutes idle, and the next
 * request pays ~30 seconds. That cost is unavoidable — but *who* pays it is a
 * choice. Firing a `/health` ping from a page the user will sit on for a
 * while means the wake-up overlaps with reading or typing instead of with a
 * spinner.
 *
 * Where this helps, and where it doesn't:
 *   - Landing: a visitor reads the pitch for 10–30s before clicking through.
 *     The single highest-value place to warm, and it costs one fetch.
 *   - Sign-in / sign-up: typing credentials is another ~10–20s of cover, and
 *     the data fetch right after login is what would otherwise hit cold.
 *   - AppShell: deliberately NOT here. `OfflineBanner` already pings on mount,
 *     and by then the page's real data requests are in flight against the same
 *     cold server — a ping racing them warms nothing. A student who bookmarks
 *     the app directly still pays the cold start; no client-side trick fixes
 *     that, only a paid instance does.
 *
 * Fire-and-forget by design: this is an optimisation, never a gate. Failures
 * are swallowed — `OfflineBanner` owns telling the user the server is down.
 */

import { ping } from '../api/client'

let warmed = false

export function warmApi(): void {
  // Once per page load is enough — the server stays awake for 15 minutes,
  // far longer than any single visit to these pages.
  if (warmed) return
  warmed = true
  void ping().catch(() => {
    /* an optimisation that failed is not an error worth surfacing */
  })
}
