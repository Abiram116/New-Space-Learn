import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { resendConfirmation, signInWithGoogle, signUpWithPassword } from '../../api/auth'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useToast } from '../../components/ui/Toast'
import { useHandoff } from '../transitions/Handoff'
import { AuthShell } from './AuthShell'
import { GoogleGlyph } from './GoogleGlyph'

export function SignUp() {
  const navigate = useNavigate()
  const { show } = useToast()
  const { play } = useHandoff()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{
    name?: string
    email?: string
    password?: string
    form?: string
  }>({})
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  // A toast disappears in a few seconds and is easy to miss entirely if the
  // tab isn't focused. Signup succeeding-but-needing-confirmation is a state
  // the user must see, so it gets its own screen instead.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resendBusy, setResendBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    if (name.trim().length < 2) next.name = 'Add your name so agents can greet you.'
    if (!isEmail(email)) next.email = 'Enter a valid email.'
    if (password.length < 8)
      next.password = 'Use at least 8 characters — this protects your notes.'
    setErrors(next)
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      const result = await signUpWithPassword(email, password, name)
      if (result.requiresConfirmation) {
        setPendingEmail(email)
      } else {
        /**
         * Straight to the intake, not through `/home`.
         *
         * Going to `/home` meant `OnboardingGate` mounted, fetched the student
         * model, showed a full-page spinner while it waited, and then
         * redirected here anyway — a round trip and a spinner to establish
         * something already known for certain: an account created two seconds
         * ago has no preferences. Skipping it removes a request and the one
         * loading screen a new student would otherwise hit first.
         *
         * The curtain covers the Onboarding chunk loading, so the intake is
         * mounted and painted before it lifts.
         */
        void play('threshold', () => {
          navigate('/welcome-aboard', { replace: true })
        })
      }
    } catch (err) {
      setErrors({ form: friendlyMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (!pendingEmail) return
    setResendBusy(true)
    try {
      await resendConfirmation(pendingEmail)
      show('Sent — check your inbox again.', 'success')
    } catch (err) {
      show(friendlyMessage(err), 'error')
    } finally {
      setResendBusy(false)
    }
  }

  const signUpGoogle = async () => {
    setGoogleBusy(true)
    try {
      await signInWithGoogle()
    } catch (err) {
      show(friendlyMessage(err), 'error')
      setGoogleBusy(false)
    }
  }

  if (pendingEmail) {
    return (
      <AuthShell
        title={
          <>
            Check your inbox.
            <br />
            One more step.
          </>
        }
        subtitle={`We sent a confirmation link to ${pendingEmail}.`}
        footer={
          <>
            Wrong email?{' '}
            <button
              type="button"
              onClick={() => setPendingEmail(null)}
              className="font-semibold text-brand cursor-pointer"
            >
              Start over
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border-[1.5px] border-brand-200 bg-brand-tint px-4 py-3.5 text-sm text-ink-2">
            Open the email from Space Learn and follow the link — it'll bring
            you straight back here, signed in.
          </div>
          <Button type="button" variant="outline3d" size="lg" disabled={resendBusy} onClick={resend}>
            {resendBusy ? 'Sending…' : "Didn't get it? Resend"}
          </Button>
          <Link
            to="/signin"
            className="text-center text-sm font-semibold text-brand"
          >
            Already confirmed — sign in
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={
        <>
          Give learning a home.
          <br />
          Start with one subject.
        </>
      }
      subtitle="Create an account. It's free while we're in preview."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/signin" className="font-semibold text-brand">
            Sign in
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Input
          name="name"
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
          placeholder="Maya Raghavan"
          autoComplete="name"
        />
        <Input
          name="email"
          type="email"
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          placeholder="you@studies.edu"
          autoComplete="email"
        />
        <Input
          name="password"
          type="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="At least 8 characters"
          autoComplete="new-password"
        />
        {errors.form && (
          <div className="rounded-xl border-[1.5px] border-coral-deep/40 bg-coral-soft px-3 py-2 text-sm text-coral-deep">
            {errors.form}
          </div>
        )}
        <Button type="submit" variant="solid3d" size="xl" disabled={busy} className="mt-1 w-full">
          {busy ? 'Creating account…' : 'Create account'}
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
          onClick={signUpGoogle}
          disabled={googleBusy}
          className="w-full"
        >
          <GoogleGlyph />
          {googleBusy ? 'Redirecting…' : 'Continue with Google'}
        </Button>

        <p className="text-xs text-faint">
          By signing up you agree that we'll store your uploads to answer your
          questions. You can delete them anytime from Settings.
        </p>
      </form>
    </AuthShell>
  )
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}
