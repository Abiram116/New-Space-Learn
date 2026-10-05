/**
 * Landing spot for a password-reset email link.
 *
 * `sendPasswordReset` (api/auth.ts) points the email at
 * `/auth/callback?reset=1`; `AuthCallback` waits for Supabase to turn that
 * link into a session, then routes here instead of `/home`. There's no
 * dedicated wrapper in `api/auth.ts` for finishing the reset, so this calls
 * `updateUser({ password })` directly — the same call Settings makes for an
 * ordinary password change.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSupabase } from '../../api/supabase'
import { friendlyMessage } from '../../api/errors'
import { useAuth } from '../../auth/AuthProvider'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { useToast } from '../../components/ui/Toast'
import { useHandoff } from '../transitions/Handoff'
import { AuthShell } from './AuthShell'

export function ResetPassword() {
  const { loading, session } = useAuth()
  const navigate = useNavigate()
  const { show } = useToast()
  const { play } = useHandoff()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)

  // The reset link is the only way here; arriving without a session means the
  // link expired or was opened twice. Same bounce AuthCallback uses.
  useEffect(() => {
    if (!loading && !session) navigate('/signin', { replace: true })
  }, [loading, session, navigate])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (password.length < 8) next.password = 'Use at least 8 characters.'
    if (confirm !== password) next.confirm = "Passwords don't match."
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const { error } = await getSupabase().auth.updateUser({ password })
      if (error) throw error
      void play('threshold', () => {
        navigate('/home', { replace: true })
      })
      show('Password changed.', 'success')
    } catch (err) {
      setErrors({ form: friendlyMessage(err) })
      setBusy(false)
    }
  }

  if (loading || !session) return <PageSpinner label="Signing you in…" />

  return (
    <AuthShell
      title={
        <>
          Set a new password.
          <br />
          Pick one only you know.
        </>
      }
      subtitle="You're signed in. Pick a new password to finish."
      footer={
        <>
          Changed your mind?{' '}
          <Link to="/home" className="font-semibold text-brand">
            Back to Space Learn
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Input
          name="password"
          type="password"
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="At least 8 characters"
        />
        <Input
          name="confirm"
          type="password"
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          placeholder="••••••••"
        />
        {errors.form && (
          <div className="rounded-xl border-[1.5px] border-coral-deep/40 bg-coral-soft px-3 py-2 text-sm text-coral-deep">
            {errors.form}
          </div>
        )}
        <Button type="submit" variant="solid3d" size="xl" disabled={busy} className="mt-1 w-full">
          {busy ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </AuthShell>
  )
}
