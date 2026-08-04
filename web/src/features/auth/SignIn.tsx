import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  sendPasswordReset,
  signInWithGoogle,
  signInWithPassword,
} from '../../api/auth'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { AuthShell } from './AuthShell'

export function SignIn() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { show } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  const next = params.get('next') || '/'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: typeof errors = {}
    if (!isEmail(email)) nextErrors.email = 'Enter a valid email.'
    if (password.length < 6) nextErrors.password = 'At least 6 characters.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    try {
      await signInWithPassword(email, password)
      navigate(next, { replace: true })
    } catch (err) {
      setErrors({ form: friendlyMessage(err) })
    } finally {
      setBusy(false)
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
          <div className="rounded-xl border-[1.5px] border-coral-deep/40 bg-coral-soft px-3 py-2 text-sm text-coral-deep">
            {errors.form}
          </div>
        )}
        <Button type="submit" disabled={busy} className="py-3.5">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="flex items-center gap-2.5 text-xs text-faint">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={signInGoogle}
          disabled={googleBusy}
          className="py-3"
        >
          {googleBusy ? 'Redirecting…' : 'Continue with Google'}
        </Button>
      </form>
    </AuthShell>
  )
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
