/**
 * OAuth (and email-confirm / password-reset) callback.
 *
 * Supabase attaches the tokens to the URL (hash or query). The client consumes
 * them via `detectSessionInUrl: true` — this component just waits for the
 * session, then bounces the user on.
 *
 * **This is the Google door.** Signing up with email got a handoff transition
 * and this did not, which meant the whole OAuth path — the one most people
 * actually use — still ended on a bare redirect out of a spinner. The curtain
 * covers the bounce, so what a new account sees is the transition rather than
 * a loading label giving way to a hard cut.
 */

import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useHandoff } from '../transitions/Handoff'

export function AuthCallback() {
  const { loading, session } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { play } = useHandoff()
  // This effect re-runs whenever a dependency's identity changes, and asking
  // for a second handoff mid-transition would restart the choreography on top
  // of itself. `play` guards internally as well; this stops it being asked.
  const went = useRef(false)

  useEffect(() => {
    if (loading || went.current) return
    went.current = true
    if (!session) {
      navigate('/signin', { replace: true })
      return
    }
    const dest = params.get('next') || '/home'
    void play('threshold', () => {
      navigate(dest, { replace: true })
    })
  }, [loading, session, navigate, params, play])

  // Only visible while Supabase is still parsing the URL, before the curtain
  // goes up. Once the handoff starts, it covers this.
  return <PageSpinner label="Finishing sign-in…" />
}
