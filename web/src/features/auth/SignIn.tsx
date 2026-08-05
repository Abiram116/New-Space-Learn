import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  resendConfirmation,
  sendPasswordReset,
  signInWithGoogle,
  signInWithPassword,
} from '../../api/auth'
import { ApiError } from '../../api/errors'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { AuthShell } from './AuthShell'
import { GoogleGlyph } from './GoogleGlyph'

export function SignIn() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { show } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [resendBusy, setResendBusy] = useState(false)

  const next = params.get('next') || '/home'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!isEmail(email)) nextErrors.email = 'Enter a valid email.'
    if (password.length < 6) nextErrors.password = 'At least 6 characters.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    setUnconfirmed(false)
    try {
      await signInWithPassword(email, password)
      navigate(next, { replace: true })
    } catch (err) {
      setErrors({ form: friendlyMessage(err) })
      // "Confirm your email" is dead-end advice without a way to re-send —
      // most people who reach it already lost or never saw the first email.
      if (err instanceof ApiError && err.message.toLowerCase().includes('confirm your email')) {
        setUnconfirmed(true)
      }
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (!isEmail(email)) {
      setErrors({ email: 'Enter your email above first.' })
      return
    }
    setResendBusy(true)
    try {
      await resendConfirmation(email)
      show('Sent — check your inbox.', 'success')
    } catch (err) {
      show(friendlyMessage(err), 'error')
    } finally {
      setResendBusy(false)
    }
  }

  const signInGoogle = async () => {
    setGoogleBusy(true)
    try {
      await signInWithGoogle()
      // supabase-js redirects the browser; nothing else to do.
    } catch (err) {
      show(friendlyMessage(err), 'error')
      setGoogleBusy(false)
    }
  }

  const forgot = async () => {
    if (!isEmail(email)) {
      setErrors({ email: 'Enter your email above first.' })
      return
    }
    try {
      await sendPasswordReset(email)
      show('Check your inbox for a reset link.', 'success')
    } catch (err) {
      show(friendlyMessage(err), 'error')
    }
  }

  return (
    <AuthShell
      title={
        <>
          Welcome back.
          <br />
          Pick up where you left off.
        </>
      }
      subtitle="Sign in to keep learning."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-semibold text-brand">
            Create an account
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Input
          name="email"
          type="email"
          label="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          placeholder="you@studies.edu"
        />
        <Input
          name="password"
          type="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="••••••••"
        />
        <div className="-mt-2 text-right">
          <button
            type="button"
            onClick={forgot}
            className="text-xs font-semibold text-brand cursor-pointer"
          >
            Forgot password?
          </button>
        </div>
        {errors.form && (
          <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-coral-deep/40 bg-coral-soft px-3 py-2 text-sm text-coral-deep">
            <span>{errors.form}</span>
            {unconfirmed && (
              <button
                type="button"
                onClick={resend}
                disabled={resendBusy}
                className="self-start text-xs font-semibold underline underline-offset-2 cursor-pointer"
              >
                {resendBusy ? 'Sending…' : 'Resend confirmation email'}
              </button>
            )}
          </div>
        )}
        <Button type="submit" variant="solid3d" size="xl" disabled={busy} className="mt-1 w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="flex items-center gap-2.5 text-xs text-faint">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <Button
          type="button"
          variant="outline3d"
          size="xl"
          onClick={signInGoogle}
          disabled={googleBusy}
          className="w-full"
        >
          <GoogleGlyph />
          {googleBusy ? 'Redirecting…' : 'Continue with Google'}
        </Button>
      </form>
    </AuthShell>
  )
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
