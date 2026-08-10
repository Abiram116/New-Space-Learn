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
import { listPreferences, resetFeedback, type Preference } from '../../api/feedback'
import { getSupabase } from '../../api/supabase'
import type { Settings as Prefs, StudentModel, TopicSignal } from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { useAuth } from '../../auth/AuthProvider'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { SectionLabel } from '../../components/ui/Bits'
// The six labelled-row primitives used to be defined at the bottom of this
// file. Nothing in them knows what a preference is — they are the generic
// "row in a grouped list" pattern — so they live in `components/ui/` now and
// this file is ~150 lines shorter for it.
import {
  RowWithNumber,
  RowWithSelect,
  RowWithText,
  RowWithTime,
  RowWithToggle,
  SavingDot,
} from '../../components/ui/Row'
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
  // `learned`, not `prefs` — `prefs` is already this file's word for the
  // settings object. These are the inferred preferences, a different thing.
  const [learned, setLearned] = useState<Preference[]>([])
  const [resetting, setResetting] = useState(false)

  const resetLearned = async () => {
    setResetting(true)
    try {
      await resetFeedback()
      // Refetch rather than clearing locally: explicit and observed
      // preferences survive a reset, so the correct post-reset list is
      // whatever the server resolves — not an empty array.
      setLearned(await listPreferences())
      show('Cleared what I learned from your feedback.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setResetting(false)
    }
  }

  useEffect(() => {
    getSettings()
      .then(setPrefs)
      .catch((err) => setError(friendlyMessage(err)))
    getStudentModel()
      .then(setStudent)
      .catch((err) => setError(friendlyMessage(err)))
    // Failure here is deliberately quiet: the preference panel is additive,
    // and a settings page that refuses to render because one inspection list
    // didn't load is worse than one missing a panel.
    listPreferences()
      .then(setLearned)
      .catch(() => undefined)
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
              <div className="rounded-xl border border-line bg-surface flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-[13px] bg-coral-soft text-xs font-semibold text-coral-deep">
                  {initials}
                </span>
                <div className="min-w-0 text-[13px]">
                  <b className="truncate block">{displayName}</b>
                  <div className="truncate text-xs text-muted">{email}</div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface flex flex-col gap-3 p-4">
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
              </div>
            </>
          )}

          {prefs && active === 'Study' && (
            <>
              <SectionLabel>STUDY</SectionLabel>
              <div className="rounded-xl border border-line bg-surface overflow-hidden text-[13px]">
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
              </div>
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
              <div className="rounded-xl border border-line bg-surface overflow-hidden text-[13px]">
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
              </div>
              <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
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
              </div>

              {(student.weak_areas.length > 0 || student.strong_areas.length > 0) && (
                <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
                  <div className="mb-2 text-ink-3">From your quiz history</div>
                  <div className="flex flex-col gap-1.5">
                    {student.weak_areas.map((a) => (
                      <TopicRow key={a.subspace_id} signal={a} tone="coral" />
                    ))}
                    {student.strong_areas.map((a) => (
                      <TopicRow key={a.subspace_id} signal={a} tone="mint" />
                    ))}
                  </div>
                </div>
              )}

              {/* Deliberately its own panel, below the averages rather than
                  mixed into them. A falling score is a different KIND of fact
                  from a low one — a topic sliding from 85% to 70% never
                  appears in "weak areas" at all, which is exactly why it used
                  to go unnoticed. */}
              {student.falling_areas.length > 0 && (
                <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
                  <div className="mb-2 text-ink-3">Going the wrong way</div>
                  <div className="flex flex-col gap-1.5">
                    {student.falling_areas.map((a) => (
                      <div key={a.subspace_id} className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-ink">{a.topic}</span>
                        <span className="shrink-0 text-coral-deep">
                          down {Math.abs(a.trend ?? 0)} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* What the personalization layer currently believes, with its
                  source and how sure it is.

                  Inspectable by requirement rather than as a nicety: anything
                  that changes how you are taught should be something you can
                  read, question and delete. Confidence is shown as a plain
                  word, not a percentage — "fairly sure" is honest about the
                  precision, where "0.62" implies a measurement. */}
              {learned.length > 0 && (
                <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
                  <div className="mb-2 flex items-baseline gap-2">
                    <span className="text-ink-3">What I’ve learned about how you like to learn</span>
                    <button
                      type="button"
                      onClick={resetLearned}
                      disabled={resetting}
                      className="ml-auto shrink-0 text-[11.5px] text-muted transition-colors cursor-pointer hover:text-coral-deep disabled:cursor-default disabled:opacity-50"
                    >
                      {resetting ? 'Resetting…' : 'Reset'}
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {learned.map((p) => (
                      <div key={p.key} className="flex flex-col gap-0.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className={cn('min-w-0', p.actionable ? 'text-ink' : 'text-muted')}>
                            {PREF_LABEL[p.key] ?? p.key}: <b>{PREF_VALUE[p.value] ?? p.value}</b>
                          </span>
                          <span className="setcode shrink-0">{confidenceWord(p)}</span>
                        </div>
                        <span className="text-[11.5px] text-faint">{p.because}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2.5 text-[11.5px] text-faint">
                    Reset clears what I learned from your feedback. It doesn’t touch
                    anything you set yourself above.
                  </p>
                </div>
              )}

              {/* Observations, shown to the student because they feed every
                  prompt and anything feeding a prompt should be inspectable.
                  Read-only on purpose: these are things the app noticed, not
                  things you told it, and the editable fields above are where
                  your own words go. Conflating the two would show you a
                  sentence you never wrote in a box that implies you did. */}
              {student.observed_habits.length > 0 && (
                <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
                  <div className="mb-2 text-ink-3">What I’ve noticed</div>
                  <ul className="flex flex-col gap-1.5 text-ink-2">
                    {student.observed_habits.map((h) => (
                      <li key={h} className="leading-snug">
                        {h}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-[11.5px] text-faint">
                    Observed from what you’ve done, not from anything you set.
                  </p>
                </div>
              )}
            </>
          )}

          {prefs && active === 'AI & sources' && (
            <>
              <SectionLabel>AI &amp; SOURCES</SectionLabel>
              <div className="rounded-xl border border-line bg-surface overflow-hidden text-[13px]">
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
              </div>
            </>
          )}

          {prefs && active === 'Skills' && (
            <>
              <SectionLabel>SKILLS</SectionLabel>
              <div className="rounded-xl border border-line bg-surface flex flex-col gap-2 p-4">
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
              </div>
            </>
          )}

          {prefs && active === 'Privacy' && (
            <>
              <SectionLabel>PRIVACY</SectionLabel>
              <div className="rounded-xl border border-line bg-surface flex flex-col gap-2 p-4 text-sm">
                <p className="text-muted">
                  Sign out on this device. Your data stays in your account.
                </p>
                <Button
                  onClick={doSignOut}
                  className="self-start bg-coral-deep hover:bg-coral-deep/90"
                >
                  Sign out
                </Button>
              </div>

              <SectionLabel className="mt-1">DANGER ZONE</SectionLabel>
              <div className="rounded-xl border border-line bg-surface flex flex-col gap-2 p-4 text-sm">
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
              </div>
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

/**
 * One topic and its quiz average.
 *
 * Carries the subject name when the API sends one: now that the student model
 * reads across every subject rather than one, "Attention" alone stops being
 * unique the moment two subjects both have a topic by that name — and this
 * list is precisely where they'd sit next to each other.
 */
function TopicRow({ signal, tone }: { signal: TopicSignal; tone: 'coral' | 'mint' }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-ink">
        {signal.topic}
        {signal.subject && <span className="text-faint"> · {signal.subject}</span>}
      </span>
      <span className={cn('shrink-0', tone === 'coral' ? 'text-coral-deep' : 'text-mint-deep')}>
        {signal.average}% avg
      </span>
    </div>
  )
}

/** Preference keys read as sentences, not dotted paths. */
const PREF_LABEL: Record<string, string> = {
  'explanation.length': 'Explanation length',
  'explanation.depth': 'Level',
  'explanation.opens_with': 'Starts with',
  'explanation.note': 'In your words',
  'interaction.mode': 'How you study',
  'interaction.answer_mode': 'Answers',
  'session.length_minutes': 'Session length',
  'study.goal': 'Studying for',
}

const PREF_VALUE: Record<string, string> = {
  concise: 'short and direct',
  detailed: 'thorough',
  simpler: 'plainer language',
  deeper: 'more advanced',
  example_first: 'an example',
  theory_first: 'the principle',
  direct: 'straight to the point',
  hints_first: 'hints before answers',
  discussion: 'by asking questions',
  drilling: 'by drilling cards',
  testing: 'by testing yourself',
}

/**
 * Confidence as a word.
 *
 * A percentage implies a measurement this isn't — 0.62 looks like it was
 * measured to two digits when it is the output of a hand-tuned update rule.
 * A word is honest about the precision and is what the student actually needs
 * to decide whether to correct it.
 */
function confidenceWord(p: Preference): string {
  if (p.source === 'explicit') return 'you set this'
  if (!p.actionable) return 'still guessing'
  if (p.confidence >= 0.75) return 'confident'
  if (p.confidence >= 0.5) return 'fairly sure'
  return 'leaning that way'
}
