/**
 * Shows a slim banner when the backend hasn't answered a health check for
 * three tries in a row. Hides itself on the next success.
 */

import { useEffect, useState } from 'react'
import { ping } from '../../api/client'
import { cn } from '../../lib/cn'

const POLL_MS = 15_000
const REQUIRED_FAILURES = 3

export function OfflineBanner() {
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let mounted = true
    let failures = 0

    const check = async () => {
      const ok = await ping()
      if (!mounted) return
      if (ok) {
        failures = 0
        setOffline(false)
      } else {
        failures += 1
        if (failures >= REQUIRED_FAILURES) setOffline(true)
      }
    }

    void check()
    const id = window.setInterval(check, POLL_MS)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  if (!offline) return null
  return (
    <div className={cn('bg-sun-soft px-4 py-2 text-center text-xs text-sun-deep')}>
      We can't reach the server right now — your changes will retry
      automatically.
    </div>
  )
}
