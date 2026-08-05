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
import {
  deleteAccount,
  getSettings,
  getStudentModel,
  updateSettings,
  updateStudentModel,
} from '../../api/me'
import { getSupabase } from '../../api/supabase'
import type { Settings as Prefs, StudentModel } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { useAuth } from '../../auth/AuthProvider'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { SectionLabel, Toggle } from '../../components/ui/Bits'
import { useToast } from '../../components/ui/Toast'
import { useFallbackSubspace } from '../../lib/nav'
import { cn } from '../../lib/cn'

const SECTIONS = ['Account', 'Study', 'Student model', 'AI & sources', 'Skills', 'Privacy'] as const
type Section = (typeof SECTIONS)[number]

const PACE_LABEL: Record<Prefs['spaced_pace'], string> = {
  relaxed: 'Relaxed',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
}

export function Settings() {
  const { user, signOut } = useAuth()
  const { show, showError } = useToast()
  const navigate = useNavigate()
  const { base, hasAny } = useFallbackSubspace()

  const [active, setActive] = useState<Section>('Account')
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [student, setStudent] = useState<StudentModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    getSettings()
      .then(setPrefs)
      .catch((err) => setError(friendlyMessage(err)))
    getStudentModel()
      .then(setStudent)
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

  const patchStudent = useCallback(
    async (fieldKey: string, updates: Partial<StudentModel>) => {
      if (!student) return
      const optimistic = { ...student, ...updates }
      setStudent(optimistic)
      setSavingKey(fieldKey)
      try {
        const updated = await updateStudentModel(updates)
        setStudent(updated)
      } catch (err) {
        setStudent(student)
        showError(err)
      } finally {
        setSavingKey(null)
      }
    },
    [student, showError],
  )

  const doSignOut = async () => {
    try {
      await signOut()
      navigate('/signin', { replace: true })
    } catch (err) {
      showError(err)
    }
  }

  const [newPassword, setNewPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)

  const changePassword = async () => {
    if (newPassword.length < 8) {
      show('Use at least 8 characters.', 'error')
      return
    }
    setPasswordBusy(true)
    try {
      const { error } = await getSupabase().auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      show('Password updated.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setPasswordBusy(false)
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)

  const doDeleteAccount = async () => {
    setDeleteBusy(true)
    try {
      await deleteAccount()
      navigate('/signin', { replace: true })
    } catch (err) {
      showError(err)
      setDeleteBusy(false)
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
      <nav className="hidden w-[180px] shrink-0 flex-col gap-1 border-r border-line bg-surface p-3 sm:flex">
        <h1 className="mb-2 font-display text-[15px] font-semibold text-ink">Settings</h1>
        {SECTIONS.map((name) => (
          <button
            key={name}
            onClick={() => setActive(name)}
            className={cn(
              'rounded-[9px] px-2.5 py-2 text-left text-[13px] transition-colors cursor-pointer',
              active === name
                ? 'bg-brand-soft font-bold text-brand-deep'
                : 'text-ink-3 hover:bg-line-soft hover:text-ink',
            )}
          >
            {name}
          </button>
        ))}
        <button
          onClick={doSignOut}
          className="mt-auto rounded-[9px] px-2.5 py-2 text-left text-[13px] font-bold text-coral-deep transition-colors cursor-pointer hover:bg-coral-soft"
        >
          Sign out
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-7">
          {error && (
            <div className="rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-deep">
              {error}
            </div>
          )}

          {!prefs && !error && <PageSpinner label="Loading preferences…" />}

          {prefs && active === 'Account' && (
            <>
              <SectionLabel>ACCOUNT</SectionLabel>
              <Card className="flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-coral-soft text-xs font-semibold text-coral-deep">
                  {initials}
                </span>
                <div className="min-w-0 text-[13px]">
                  <b className="truncate block">{displayName}</b>
                  <div className="truncate text-xs text-muted">{email}</div>
                </div>
              </Card>

              <Card className="flex flex-col gap-3 p-4">
                <div className="text-[13px] font-semibold text-ink">Change password</div>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password"
                  hint="At least 8 characters."
                />
                <Button
                  onClick={changePassword}
                  disabled={passwordBusy || newPassword.length === 0}
                  className="self-start"
                >
                  {passwordBusy ? 'Updating…' : 'Update password'}
                </Button>
              </Card>
            </>
          )}

          {prefs && active === 'Study' && (
            <>
              <SectionLabel>STUDY</SectionLabel>
              <Card className="overflow-hidden text-[13px]">
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

          {student && active === 'Student model' && (
            <>
              <SectionLabel>STUDENT MODEL</SectionLabel>
              <p className="text-xs text-faint">
                What the AI knows about how you study — the fields below feed
                every chat reply and generated card, quiz, and note. Weak and
                strong areas are computed from your real quiz scores, not
                something you set.
              </p>
              <Card className="overflow-hidden text-[13px]">
                <RowWithText
                  label="Learning style"
                  placeholder="e.g. visual, worked examples, analogies"
                  value={student.learning_style}
                  onChange={(v) => patchStudent('learning_style', { learning_style: v })}
                  saving={savingKey === 'learning_style'}
                />
                <RowWithNumber
                  label="Session length"
                  suffix="min"
                  value={student.session_length_minutes ?? 20}
                  onChange={(n) =>
                    patchStudent('session_length_minutes', { session_length_minutes: n })
                  }
                  saving={savingKey === 'session_length_minutes'}
                  min={5}
                  max={180}
                />
                <RowWithText
                  label="Studying for"
                  placeholder="e.g. Amazon OA next week"
                  value={student.exam_context}
                  onChange={(v) => patchStudent('exam_context', { exam_context: v })}
                  saving={savingKey === 'exam_context'}
                  last
                />
              </Card>
              <Card className="p-3.5 text-[13px]">
                <div className="mb-1.5 text-ink-3">Explain things to me like this</div>
                <textarea
                  value={student.teaching_preference ?? ''}
                  onChange={(e) =>
                    patchStudent('teaching_preference', { teaching_preference: e.target.value || null })
                  }
                  placeholder="Optional — free text the AI reads before every reply."
                  rows={3}
                  className="w-full resize-none rounded-md border border-line bg-well px-2.5 py-2 text-sm text-ink outline-none transition-colors focus:border-brand"
                />
                {savingKey === 'teaching_preference' && (
                  <div className="mt-1.5">
                    <SavingDot />
                  </div>
                )}
              </Card>

              {(student.weak_areas.length > 0 || student.strong_areas.length > 0) && (
                <Card className="p-3.5 text-[13px]">
                  <div className="mb-2 text-ink-3">From your quiz history</div>
                  <div className="flex flex-col gap-1.5">
                    {student.weak_areas.map((a) => (
                      <div key={a.subspace_id} className="flex items-center justify-between">
                        <span className="text-ink">{a.topic}</span>
                        <span className="text-coral-deep">{a.average}% avg</span>
                      </div>
                    ))}
                    {student.strong_areas.map((a) => (
                      <div key={a.subspace_id} className="flex items-center justify-between">
                        <span className="text-ink">{a.topic}</span>
                        <span className="text-mint-deep">{a.average}% avg</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}

          {prefs && active === 'AI & sources' && (
            <>
              <SectionLabel>AI &amp; SOURCES</SectionLabel>
              <Card className="overflow-hidden text-[13px]">
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

              <SectionLabel className="mt-1">DANGER ZONE</SectionLabel>
              <Card className="flex flex-col gap-2 p-4 text-sm">
                <p className="text-muted">
                  Permanently delete your account and everything in it — every
                  subject, document, chat, note, deck, and quiz. This can't be
                  undone.
                </p>
                <Button
                  onClick={() => setDeleteOpen(true)}
                  className="self-start bg-coral-deep hover:bg-coral-deep/90"
                >
                  Delete account
                </Button>
              </Card>
            </>
          )}
        </div>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
          setDeleteConfirmText('')
        }}
        title="Delete your account?"
        width="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            This permanently deletes your account and every subject, document,
            chat, note, deck, and quiz in it. There is no undo. Type{' '}
            <b className="text-ink">delete</b> to confirm.
          </p>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="delete"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteOpen(false)
                setDeleteConfirmText('')
              }}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={doDeleteAccount}
              disabled={deleteBusy || deleteConfirmText.trim().toLowerCase() !== 'delete'}
              className="bg-coral-deep hover:bg-coral-deep/90"
            >
              {deleteBusy ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        </div>
      </Modal>
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

function SavingDot() {
  return (
    <span className="flex items-center gap-1 text-[10px] text-sun-deep">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sun" />
      saving…
    </span>
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
        className="w-16 rounded-md border border-line bg-well px-2 py-1 text-right text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
      {saving && <SavingDot />}
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
        className="rounded-md border border-line bg-well px-2 py-1 text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      {saving && <SavingDot />}
    </RowShell>
  )
}

function RowWithText({
  label,
  value,
  placeholder,
  onChange,
  saving,
  last,
}: {
  label: string
  value: string | null
  placeholder?: string
  onChange: (next: string | null) => void
  saving?: boolean
  last?: boolean
}) {
  return (
    <RowShell label={label} last={last}>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-52 rounded-md border border-line bg-well px-2 py-1 text-right text-sm text-ink outline-none transition-colors focus:border-brand"
      />
      {saving && <SavingDot />}
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
        className="rounded-md border border-line bg-well px-2 py-1 text-sm text-ink outline-none transition-colors focus:border-brand"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {saving && <SavingDot />}
    </RowShell>
  )
}
