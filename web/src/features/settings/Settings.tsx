/**
 * Settings — real preferences persisted via `/me/settings`.
 *
 * Sections:
 *   - Account (identity from Supabase, read-only in v1)
 *   - Study (daily goal, streak-freeze)
 *   - How you learn (explicit + observed personalization signals)
 *   - AI & sources (RAG toggles)
 *   - Privacy → sign out
 *
 * Space Learn Plus is intentionally removed (per user's answer).
 *
 * **Every control here is live.** The reminder-time picker used to sit in the
 * Study group storing a value nothing ever read, on the reasoning that it was
 * "honestly labelled" — but a setting that cannot take effect is a promise the
 * app is not keeping, and a caption admitting it does not fix that, it just
 * documents it. Firing a reminder needs a scheduled worker the free tier will
 * not run, so the control is gone rather than decorative. The column survives
 * in the database, so nothing is lost if a notifier ever ships. The
 * spaced-repetition pace selector went for the identical reason: it
 * persisted a value grading never read, since cards always ran the same
 * fixed schedule regardless of what it said. Skills moved out of here too —
 * they're reachable from the sidebar and from chat, so a link to them here
 * was a second path to the same place, not a setting.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  deleteAccount,
  getSettings,
  getStudentModel,
  updateSettings,
  updateStudentModel,
} from '../../api/me'
import { signOutLocally } from '../../api/auth'
import { listPreferences, resetFeedback, type Preference } from '../../api/feedback'
import { getSupabase } from '../../api/supabase'
import type { Settings as Prefs, StudentModel } from '../../api/types'
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
import { RowWithNumber, RowWithText, RowWithToggle, SavingDot } from '../../components/ui/Row'
import { useToast } from '../../components/ui/Toast'
import { cn } from '../../lib/cn'

const SECTIONS = ['Account', 'Study', 'How you learn', 'AI & sources', 'Privacy'] as const
type Section = (typeof SECTIONS)[number]

/** Free-text fields debounce their PATCH instead of firing one per
 *  keystroke — typing "Amazon OA next week" used to be six or seven network
 *  requests, one per pause, none of which the student was waiting on. */
const TEXT_PATCH_DEBOUNCE_MS = 600

export function Settings() {
  const { user, signOut } = useAuth()
  const { show, showError } = useToast()
  const navigate = useNavigate()

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

  // One timer per field, keyed the same way `savingKey` is, so typing in
  // "studying for" doesn't reset a pending "learning style" save.
  const textTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const patchStudentText = useCallback(
    (fieldKey: string, updates: Partial<StudentModel>) => {
      if (!student) return
      // The field itself updates instantly — only the request that makes it
      // durable waits. Without this, every keystroke fired its own PATCH.
      setStudent((prev) => (prev ? { ...prev, ...updates } : prev))
      const timers = textTimers.current
      if (timers[fieldKey]) clearTimeout(timers[fieldKey])
      timers[fieldKey] = setTimeout(async () => {
        setSavingKey(fieldKey)
        try {
          const updated = await updateStudentModel(updates)
          setStudent(updated)
        } catch (err) {
          // Unlike `patchStudent`, this doesn't roll back to the
          // pre-edit value on failure — by the time a debounced request
          // fails, the student has likely kept typing, and snapping the
          // field back to what it read half a second ago would eat that.
          // The error toast is enough; the next successful save still wins.
          showError(err)
        } finally {
          setSavingKey(null)
        }
      }, TEXT_PATCH_DEBOUNCE_MS)
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
      /**
       * Drop the local session before navigating — without this, deleting your
       * account left you trapped in a dead app.
       *
       * Supabase JWTs are stateless: deleting the user server-side does not
       * invalidate the copy sitting in this browser. So `navigate('/signin')`
       * hit `RedirectIfAuthed`, which saw a session and bounced straight back
       * to `/home`, where every request 401'd into "account not found" toasts
       * over a UI with nothing left to load. The account was gone and the app
       * was the only thing that hadn't been told.
       */
      await signOutLocally()
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
                <RowWithToggle
                  label="Streak freeze"
                  hint="Miss one day without breaking your streak."
                  checked={prefs.streak_freeze_enabled}
                  onChange={(v) =>
                    patch('streak_freeze_enabled', { streak_freeze_enabled: v })
                  }
                  last
                />
              </div>
              <p className="text-xs text-faint">
                Every control on this page does something the moment you change
                it — there is nothing here waiting on a feature that hasn't
                shipped.
              </p>
            </>
          )}

          {student && active === 'How you learn' && (
            <>
              <SectionLabel>HOW YOU LEARN</SectionLabel>
              <p className="text-xs text-faint">
                What the AI knows about how you study — the fields below feed
                every chat reply and generated card, quiz, and note. Profile
                shows how your quiz scores are actually trending; this page is
                only what you've set and what's been learned from feedback.
              </p>
              <div className="rounded-xl border border-line bg-surface overflow-hidden text-[13px]">
                <RowWithText
                  label="Learning style"
                  placeholder="e.g. visual, worked examples, analogies"
                  value={student.learning_style}
                  onChange={(v) => patchStudentText('learning_style', { learning_style: v })}
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
                  onChange={(v) => patchStudentText('exam_context', { exam_context: v })}
                  saving={savingKey === 'exam_context'}
                  last
                />
              </div>
              <div className="rounded-xl border border-line bg-surface p-3.5 text-[13px]">
                <div className="mb-1.5 text-ink-3">Explain things to me like this</div>
                <textarea
                  value={student.teaching_preference ?? ''}
                  onChange={(e) =>
                    patchStudentText('teaching_preference', {
                      teaching_preference: e.target.value || null,
                    })
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

          {prefs && active === 'Privacy' && (
            <>
              <SectionLabel>PRIVACY</SectionLabel>
              <div className="rounded-xl border border-line bg-surface flex flex-col gap-2 p-4 text-sm">
                <p className="text-muted">
                  Sign out on this device. Your data stays in your account.
                </p>
                <Button onClick={doSignOut} variant="danger" className="self-start">
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
                <Button onClick={() => setDeleteOpen(true)} variant="danger" className="self-start">
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
              variant="danger"
            >
              {deleteBusy ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        </div>
      </Modal>
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
