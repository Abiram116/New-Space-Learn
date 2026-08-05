/**
 * OAuth (and email-confirm / password-reset) callback.
 *
 * Supabase attaches the tokens to the URL (hash or query). The client
 * consumes them via `detectSessionInUrl: true` — this component just waits
 * for the session, then bounces the user to `?next=`.
 */

import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { PageSpinner } from '../../components/ui/PageSpinner'

export function AuthCallback() {
  const { loading, session } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    if (loading) return
    const dest = params.get('next') || '/home'
    navigate(session ? dest : '/signin', { replace: true })
  }, [loading, session, navigate, params])

  return <PageSpinner label="Finishing sign-in…" />
}
