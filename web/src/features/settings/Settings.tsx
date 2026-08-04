/**
 * Settings — real preferences persisted via `/me/settings`.
 *
 * Sections match the plan's cut list:
 *   - Account (identity from Supabase, read-only in v1)
 *   - Study (daily goal, reminder, streak-freeze, SM-2 pace)
 *   - AI & sources (RAG toggles)
 *   - Skills → link to /skills (no duplication)
 *   - Privacy → sign out
 *
 * Space Learn Plus is intentionally removed (per user's answer).
 * Reminders are honestly labelled: they persist, but firing needs a worker
 * we haven't shipped yet.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getSettings, updateSettings } from '../../api/me'
import type { Settings as Prefs } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { useAuth } from '../../auth/AuthProvider'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { SectionLabel, Toggle } from '../../components/ui/Bits'
import { useToast } from '../../components/ui/Toast'
import { useFallbackSubspace } from '../../lib/nav'
import { cn } from '../../lib/cn'

const SECTIONS = ['Account', 'Study', 'AI & sources', 'Skills', 'Privacy'] as const
type Section = (typeof SECTIONS)[number]

const PACE_LABEL: Record<Prefs['spaced_pace'], string> = {
  relaxed: 'Relaxed',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
}

export function Settings() {
  const { user, signOut } = useAuth()
  const { showError } = useToast()
  const navigate = useNavigate()
  const { base, hasAny } = useFallbackSubspace()

  const [active, setActive] = useState<Section>('Account')
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    getSettings()
      .then(setPrefs)
      .catch((err) => setError(friendlyMessage(err)))
  }, [])

  const patch = useCallback(
    async (fieldKey: string, updates: Partial<Prefs>) => {
      if (!prefs) return
      const optimistic = { ...prefs, ...updates }
      setPrefs(optimistic)
      setSavingKey(fieldKey)
      try {
        const updated = await updateSettings(updates)
        setPrefs(updated)
      } catch (err) {
        setPrefs(prefs)
        showError(err)
      } finally {
        setSavingKey(null)
      }
    },
    [prefs, showError],
  )

  const doSignOut = async () => {
    try {
      await signOut()
      navigate('/signin', { replace: true })
    } catch (err) {
      showError(err)
    }
  }

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const email = user?.email ?? ''

  return (
    <div className="flex min-h-0 flex-1">
      <nav className="flex w-[170px] shrink-0 flex-col gap-1 border-r-[1.5px] border-line bg-surface p-4 text-[13px] text-ink-3">
        <h1 className="mb-2 font-display text-[15px] font-semibold text-ink">Settings</h1>
        {SECTIONS.map((name) => (
          <button
            key={name}
            onClick={() => setActive(name)}
            className={cn(
              'rounded-[10px] px-2.5 py-2 text-left transition-colors cursor-pointer',
              active === name ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-line-soft',
            )}
          >
            {name}
          </button>
        ))}
        <button
          onClick={doSignOut}
          className="mt-auto rounded-[10px] px-2.5 py-2 text-left text-coral-deep cursor-pointer hover:bg-coral-soft"
        >
          Sign out
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-lg flex-col gap-4 p-5">
          {error && (
            <div className="rounded-xl bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {error}
            </div>
          )}

          {!prefs && !error && <PageSpinner label="Loading preferences…" />}

          {prefs && active === 'Account' && (
            <>
              <SectionLabel>ACCOUNT</SectionLabel>
              <Card className="flex items-center gap-3 rounded-[14px] p-3.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-coral-soft text-xs font-semibold text-coral-deep">
                  {initials}
                </span>
                <div className="min-w-0 text-[13px]">
                  <b className="truncate block">{displayName}</b>
                  <div className="truncate text-xs text-muted">{email}</div>
                </div>
              </Card>
              <p className="text-xs text-faint">
                Change your email or password from your Supabase-hosted account
                page — we don't proxy those flows to avoid stashing your
                credentials.
              </p>
            </>
          )}

          {prefs && active === 'Study' && (
            <>
              <SectionLabel>STUDY</SectionLabel>
              <Card className="overflow-hidden rounded-[14px] text-[13px]">
                <RowWithNumber
                  label="Daily goal"
                  suffix="cards"
                  value={prefs.daily_goal}
                  onChange={(n) => patch('daily_goal', { daily_goal: n })}
                  saving={savingKey === 'daily_goal'}
                  min={1}
                  max={500}
                />
                <RowWithTime
                  label="Reminder time"
                  value={prefs.reminder_time}
                  onChange={(t) => patch('reminder_time', { reminder_time: t })}
                  saving={savingKey === 'reminder_time'}
                />
                <RowWithToggle
                  label="Streak freeze"
                  hint="Miss one day without breaking your streak."
                  checked={prefs.streak_freeze_enabled}
                  onChange={(v) =>
                    patch('streak_freeze_enabled', { streak_freeze_enabled: v })
                  }
                />
                <RowWithSelect
                  label="Spaced-repetition pace"
                  value={prefs.spaced_pace}
                  options={(['relaxed', 'balanced', 'aggressive'] as const).map((v) => ({
                    value: v,
                    label: PACE_LABEL[v],
                  }))}
                  onChange={(v) => patch('spaced_pace', { spaced_pace: v })}
                  saving={savingKey === 'spaced_pace'}
                  last
                />
              </Card>
              <p className="text-xs text-faint">
                Reminders will resume when the notifier is live — your time is
                saved either way.
              </p>
            </>
          )}

          {prefs && active === 'AI & sources' && (
            <>
              <SectionLabel>AI &amp; SOURCES</SectionLabel>
              <Card className="overflow-hidden rounded-[14px] text-[13px]">
                <RowWithToggle
                  label="Answer only from my docs"
                  hint="Refuses to guess when the sources don't cover a question."
                  checked={prefs.answer_only_from_docs}
                  onChange={(v) =>
                    patch('answer_only_from_docs', { answer_only_from_docs: v })
                  }
                />
                <RowWithToggle
                  label="Always show citations"
                  hint="Inserts [[n]] markers when the AI cites a source."
                  checked={prefs.always_show_citations}
                  onChange={(v) =>
                    patch('always_show_citations', { always_show_citations: v })
                  }
                  last
                />
              </Card>
            </>
          )}

          {prefs && active === 'Skills' && (
            <>
              <SectionLabel>SKILLS</SectionLabel>
              <Card className="flex flex-col gap-2 p-4">
                <p className="text-sm text-muted">
                  Manage custom AI personas from any space's Skills tab. The
                  ones you turn on there are what the chat here will use.
                </p>
                {hasAny ? (
                  <Link
                    to={`${base}/skills`}
                    className="mt-1 self-start rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
                  >
                    Open Skills →
                  </Link>
                ) : (
                  <p className="text-xs text-faint">
                    Create a space and a topic first — Skills lives inside a
                    subspace.
                  </p>
                )}
              </Card>
            </>
          )}

          {prefs && active === 'Privacy' && (
            <>
              <SectionLabel>PRIVACY</SectionLabel>
              <Card className="flex flex-col gap-2 p-4 text-sm">
                <p className="text-muted">
                  Sign out on this device. Your data stays in your account.
                </p>
                <Button
                  onClick={doSignOut}
                  className="self-start bg-coral-deep hover:bg-coral-deep/90"
                >
                  Sign out
                </Button>
              </Card>
              <p className="text-xs text-faint">
                Account deletion isn't wired into the backend yet. Reach us to
                remove everything permanently.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Reusable rows ──────────────────────────────────────────────────────

function RowShell({
  label,
  hint,
  children,
  last,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3.5 py-3',
        !last && 'border-b border-line-soft',
      )}
    >
      <div className="min-w-0">
        <div>{label}</div>
        {hint && <div className="text-[11px] text-faint">{hint}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  )
}

function RowWithToggle({
  label,
  hint,
  checked,
  onChange,
  last,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  last?: boolean
}) {
  return (
    <RowShell label={label} hint={hint} last={last}>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </RowShell>
  )
}

function RowWithNumber({
  label,
  value,
  suffix,
  onChange,
  saving,
  min,
  max,
  last,
}: {
  label: string
  value: number
  suffix?: string
  onChange: (next: number) => void
  saving?: boolean
  min?: number
  max?: number
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        className="w-16 rounded-md border-[1.5px] border-line bg-surface px-2 py-1 text-right text-sm outline-none focus:border-brand"
      />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
      {saving && <span className="text-[10px] text-faint">saving…</span>}
    </RowShell>
  )
}

function RowWithTime({
  label,
  value,
  onChange,
  saving,
  last,
}: {
  label: string
  value: string | null
  onChange: (next: string | null) => void
  saving?: boolean
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last} hint="Off when empty.">
      <input
        type="time"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border-[1.5px] border-line bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
      />
      {saving && <span className="text-[10px] text-faint">saving…</span>}
    </RowShell>
  )
}

function RowWithSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  saving,
  last,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (next: T) => void
  saving?: boolean
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-md border-[1.5px] border-line bg-surface px-2 py-1 text-sm outline-none focus:border-brand"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {saving && <span className="text-[10px] text-faint">saving…</span>}
    </RowShell>
  )
}
