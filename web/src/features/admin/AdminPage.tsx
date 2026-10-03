/**
 * The two of us, reading and running the feedback form.
 *
 * Not part of the app and not part of any account: its own address
 * (`ADMIN_PATH`, linked from nowhere) behind one shared password. The password
 * is checked on the server, which keeps only a hash of it; every call below
 * carries the short-lived token that check hands back. Loaded on demand, so
 * none of this is in what a student downloads.
 */

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ADMIN_LOCKED_EVENT, isUnlocked, lock, unlock } from '../../api/admin'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { cn } from '../../lib/cn'
import { LIMITS } from '../../lib/limits'
import { Questions } from './Questions'
import { Responses } from './Responses'
import { Summary } from './Summary'
import { Welcome } from './Welcome'

const TABS = ['Summary', 'Responses', 'Questions'] as const
type Tab = (typeof TABS)[number]

export function AdminPage() {
  const [open, setOpen] = useState(isUnlocked)
  const [tab, setTab] = useState<Tab>('Summary')
  // Only right after the password — not when the tab is simply reloaded.
  const [greeting, setGreeting] = useState(false)
  const endGreeting = useCallback(() => setGreeting(false), [])

  useEffect(() => {
    // Keep it out of search results and out of the tab title.
    const title = document.title
    document.title = 'Space Learn'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    const onLocked = () => setOpen(false)
    window.addEventListener(ADMIN_LOCKED_EVENT, onLocked)
    return () => {
      document.title = title
      meta.remove()
      window.removeEventListener(ADMIN_LOCKED_EVENT, onLocked)
    }
  }, [])

  if (!open) {
    return (
      <Gate
        onOpen={() => {
          setGreeting(true)
          setOpen(true)
        }}
      />
    )
  }

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {greeting && <Welcome onDone={endGreeting} />}
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <h1 className="nameplate text-[20px] text-ink">Feedback desk</h1>
          <nav aria-label="Sections" className="order-3 flex w-full gap-1 rounded-lg bg-well p-1 sm:order-none sm:w-auto">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-current={tab === t ? 'page' : undefined}
                className={cn(
                  'flex-1 cursor-pointer rounded-md px-3.5 py-1.5 text-[13.5px] transition-colors sm:flex-none',
                  tab === t ? 'bg-raised font-semibold text-ink' : 'font-medium text-muted hover:text-ink',
                )}
              >
                {t}
              </button>
            ))}
          </nav>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={lock}>
            <Icon name="lock" size={14} /> Lock
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {tab === 'Summary' ? <Summary /> : tab === 'Responses' ? <Responses /> : <Questions />}
      </main>
    </div>
  )
}

function Gate({ onOpen }: { onOpen: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await unlock(password)
      onOpen()
    } catch (err) {
      setError(friendlyMessage(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 text-ink">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
        <span className="grid h-10 w-10 place-items-center self-center rounded-xl bg-raised text-ink-3">
          <Icon name="lock" size={17} />
        </span>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            maxLength={LIMITS.adminPassword}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-invalid={error !== null}
            className="w-full rounded-lg border border-line bg-well px-3 py-2.5 text-center text-[15px] text-ink outline-none placeholder:text-faint focus:border-brand/70"
          />
        </label>
        <Button type="submit" disabled={!password || busy}>
          {busy ? 'Checking…' : 'Open'}
        </Button>
        <p role="alert" className="min-h-5 text-center text-[13px] text-coral-deep">
          {error}
        </p>
      </form>
    </div>
  )
}
