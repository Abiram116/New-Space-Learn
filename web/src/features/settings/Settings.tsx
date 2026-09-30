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

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
import { Modal, ModalFooter } from '../../components/ui/Modal'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { useImmersive } from '../../components/layout/immersive'
import { PageSpinner } from '../../components/ui/PageSpinner'
import { SectionLabel } from '../../components/ui/Bits'
// The six labelled-row primitives used to be defined at the bottom of this
// file. Nothing in them knows what a preference is — they are the generic
// "row in a grouped list" pattern — so they live in `components/ui/` now and
// this file is ~150 lines shorter for it.
import { RowWithNumber, RowWithText, RowWithToggle, SavingDot } from '../../components/ui/Row'
import { useToast } from '../../components/ui/Toast'
import { Icon, type IconName } from '../../components/ui/Icon'
import { writeCache } from '../../lib/asyncCache'
import { cn } from '../../lib/cn'
import { useIsMobile } from '../../lib/useIsMobile'
import { STUDENT_MODEL_KEY } from '../onboarding/skippedStyle'
import { StyleIntakeCard } from '../onboarding/StyleIntakeCard'
import { setBotsEnabled, useBotsEnabled } from '../../lib/botPreference'

const SECTIONS = ['Account', 'Study', 'How you learn', 'AI & sources', 'Privacy'] as const
type Section = (typeof SECTIONS)[number]
const PANEL_ID = 'settings-panel'
const tabId = (name: string) => `settings-tab-${name.replace(/\W+/g, '-').toLowerCase()}`

/** Free-text fields debounce their PATCH instead of firing one per
 *  keystroke — typing "Amazon OA next week" used to be six or seven network
 *  requests, one per pause, none of which the student was waiting on. */
const TEXT_PATCH_DEBOUNCE_MS = 600

export function Settings() {
  const { user, signOut } = useAuth()
  const { show, showError } = useToast()
  const navigate = useNavigate()

  const phone = useIsMobile()
  const botsOn = useBotsEnabled()
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
      .then((m) => {
        setStudent(m)
        // Home reads this cache to decide whether to offer skipped questions.
        writeCache(STUDENT_MODEL_KEY, m)
      })
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

  const closeDelete = () => {
    setDeleteOpen(false)
    setDeleteConfirmText('')
  }

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

  /** One section's controls — the desktop panel and the phone detail screen
   *  render the same thing, so a setting can never exist on one and not the
   *  other. */
  const panel = (active: Section) => (
    <>
      {error && (
        <div className="rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-[14px] text-coral-deep">
          {error}
        </div>
      )}

      {!prefs && !error && <PageSpinner label="Loading preferences…" />}

      {prefs && active === 'Account' && (
        <>
          {!phone && <SectionLabel>ACCOUNT</SectionLabel>}
          <div className="rounded-xl border border-line bg-surface flex items-center gap-3 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-coral-soft text-[13px] font-semibold text-coral-deep">
              {initials}
            </span>
            <div className="min-w-0 text-[15px]">
              <b className="block truncate">{displayName}</b>
              <div className="truncate text-[13px] text-muted">{email}</div>
            </div>
          </div>

          <form
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4"
            onSubmit={(e) => {
              e.preventDefault()
              void changePassword()
            }}
          >
            <div className="text-[15px] font-semibold text-ink">Change password</div>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              aria-label="New password"
              hint="At least 8 characters."
            />
            {/* Directly under the field it submits. Same label while busy
                so the button does not change width. */}
            <Button
              type="submit"
              disabled={passwordBusy || newPassword.length === 0}
              className="w-full min-w-40 sm:w-auto sm:self-start"
            >
              {passwordBusy ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        </>
      )}

      {prefs && active === 'Study' && (
        <>
          {!phone && <SectionLabel>STUDY</SectionLabel>}
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
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
          <p className="text-[13px] leading-relaxed text-faint">
            Every control on this page does something the moment you change
            it — there is nothing here waiting on a feature that hasn't
            shipped.
          </p>
        </>
      )}

      {student && active === 'How you learn' && (
        <>
          {!phone && <SectionLabel>HOW YOU LEARN</SectionLabel>}
          {/* Signed up on a phone: the two questions it skipped. Desktop
              only — they shape the chat tutor, which a phone doesn't have. */}
          {!phone && <StyleIntakeCard model={student} onUpdated={setStudent} />}
          <p className="text-[13px] leading-relaxed text-faint">
            What the AI knows about how you study — the fields below feed
            every chat reply and generated card, quiz, and note. Profile
            shows how your quiz scores are actually trending; this page is
            only what you've set and what's been learned from feedback.
          </p>
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
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
          <div className="rounded-xl border border-line bg-surface p-4 text-[14px]">
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
              className="w-full resize-none rounded-[10px] border border-line bg-well px-3 py-2.5 text-[14px] text-ink outline-none transition-colors focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/25"
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
            <div className="rounded-xl border border-line bg-surface p-4 text-[14px]">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-ink-3">What I’ve learned about how you like to learn</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={resetLearned}
                  disabled={resetting}
                  className="ml-auto min-w-24 shrink-0"
                >
                  Reset
                </Button>
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
                    <span className="text-[12.5px] text-faint">{p.because}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12.5px] text-faint">
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
            <div className="rounded-xl border border-line bg-surface p-4 text-[14px]">
              <div className="mb-2 text-ink-3">What I’ve noticed</div>
              <ul className="flex flex-col gap-1.5 text-ink-2">
                {student.observed_habits.map((h) => (
                  <li key={h} className="leading-snug">
                    {h}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12.5px] text-faint">
                Observed from what you’ve done, not from anything you set.
              </p>
            </div>
          )}
        </>
      )}

      {prefs && active === 'AI & sources' && (
        <>
          {!phone && <SectionLabel>AI &amp; SOURCES</SectionLabel>}
          <div className="rounded-xl border border-line bg-surface overflow-hidden">
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
            />
            <RowWithToggle
              label="Show the agent bots"
              hint="Nova and the crew: little faces and messages while the AI works. Off gives a plain interface. Saved on this device."
              checked={botsOn}
              onChange={setBotsEnabled}
              last
            />
          </div>
          {phone && (
            <p className="flex items-start gap-2 px-1 text-[13.5px] leading-relaxed text-muted">
              <Icon name="skill" size={15} className="mt-0.5 shrink-0 text-mint" />
              Skills shape the chat tutor and are managed on desktop.
            </p>
          )}
        </>
      )}

      {prefs && active === 'Privacy' && (
        <>
          {!phone && <SectionLabel>PRIVACY</SectionLabel>}
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-[14px]">
            <p className="text-muted">
              Sign out on this device. Your data stays in your account.
            </p>
            {/* Signing out is reversible, so it is an ordinary secondary
                button — coral is reserved for things that cannot be undone. */}
            <Button onClick={doSignOut} variant="secondary" className="w-full sm:w-auto sm:self-start">
              Sign out
            </Button>
          </div>

          <SectionLabel className="mt-4">DANGER ZONE</SectionLabel>
          <div className="flex flex-col gap-3 rounded-xl border border-coral/30 bg-surface p-4 text-[14px]">
            <p className="text-muted">
              Permanently delete your account and everything in it — every
              subject, document, chat, note, deck, and quiz. This can't be
              undone.
            </p>
            <Button onClick={() => setDeleteOpen(true)} variant="danger" className="w-full sm:w-auto sm:self-start">
              Delete account
            </Button>
          </div>
        </>
      )}
    </>
  )

  const deleteDialog = (
    <Modal
      open={deleteOpen}
      onClose={closeDelete}
      title="Delete your account?"
      width="sm"
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={closeDelete} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="delete-account-form"
            disabled={deleteBusy || deleteConfirmText.trim().toLowerCase() !== 'delete'}
            variant="danger"
            className="min-w-40"
          >
            {deleteBusy ? 'Deleting…' : 'Delete my account'}
          </Button>
        </ModalFooter>
      }
    >
      <form
        id="delete-account-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (deleteConfirmText.trim().toLowerCase() === 'delete') void doDeleteAccount()
        }}
      >
        <p className="text-[14px] leading-relaxed text-muted">
          This permanently deletes your account and every subject, document,
          chat, note, deck, and quiz in it. There is no undo. Type{' '}
          <b className="text-ink">delete</b> to confirm.
        </p>
        <Input
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
          placeholder="delete"
          aria-label="Type delete to confirm"
          autoFocus
        />
      </form>
    </Modal>
  )

  if (phone) {
    return (
      <PhoneSettings
        panel={panel}
        displayName={displayName}
        initials={initials}
        email={email}
        summary={{
          Account: email || displayName,
          Study: prefs ? `${prefs.daily_goal} cards a day` : '',
          'How you learn': student?.session_length_minutes ? `${student.session_length_minutes}-minute sessions` : '',
          'AI & sources': prefs ? (prefs.answer_only_from_docs ? 'Only from your docs' : 'Docs and general knowledge') : '',
          Privacy: 'Sign out, delete account',
        }}
        deleteDialog={
          /* Phones confirm in a sheet from the bottom edge, where the thumb
             already is; the destructive button sits last, full width, apart
             from Cancel. Same form and the same typed confirmation. */
          <BottomSheet
            open={deleteOpen}
            onClose={closeDelete}
            title="Delete account?"
            footer={
              <div className="flex flex-col gap-2">
                <Button
                  type="submit"
                  form="delete-account-form-phone"
                  size="xl"
                  disabled={deleteBusy || deleteConfirmText.trim().toLowerCase() !== 'delete'}
                  variant="danger"
                  className="w-full"
                >
                  {deleteBusy ? 'Deleting…' : 'Delete my account'}
                </Button>
                <Button variant="secondary" size="xl" onClick={closeDelete} disabled={deleteBusy} className="w-full">
                  Cancel
                </Button>
              </div>
            }
          >
            <form
              id="delete-account-form-phone"
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (deleteConfirmText.trim().toLowerCase() === 'delete') void doDeleteAccount()
              }}
            >
              <p className="text-[15px] leading-relaxed text-muted">
                This permanently deletes your account and every subject, document,
                chat, note, deck, and quiz in it. There is no undo. Type{' '}
                <b className="text-ink">delete</b> to confirm.
              </p>
              <Input
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="delete"
                aria-label="Type delete to confirm"
                autoCapitalize="none"
                autoCorrect="off"
                className="min-h-12 text-[16px]"
              />
            </form>
          </BottomSheet>
        }
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Desktop: a left rail. It appears at `lg`, not `sm` — beside the app's
          own 264px sidebar a tablet has no room for a third column. */}
      <nav
        aria-label="Settings sections"
        className="hidden w-[208px] shrink-0 flex-col gap-1 border-r border-line bg-surface p-3 lg:flex"
      >
        <h1 className="mb-2 px-2.5 pt-1 font-display text-[18px] font-semibold text-ink">Settings</h1>
        {SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setActive(name)}
            aria-current={active === name ? 'page' : undefined}
            className={cn(
              'min-h-10 rounded-[10px] px-3 py-2 text-left text-[14px] transition-colors cursor-pointer',
              active === name
                ? 'bg-brand-soft font-bold text-brand-deep'
                : 'text-ink-3 hover:bg-line-soft hover:text-ink',
            )}
          >
            {name}
          </button>
        ))}
      </nav>

      {/* Below `lg`: the same sections as a pinned, scrollable tab strip. It
          sits outside the scrolling pane, so it stays put while the page moves. */}
      <div className="shrink-0 border-b border-line bg-surface lg:hidden">
        <h1 className="px-4 pt-3 font-display text-[18px] font-semibold text-ink sm:px-6">Settings</h1>
        <SectionTabs active={active} onSelect={setActive} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          role="tabpanel"
          id={PANEL_ID}
          aria-label={active}
          className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-7"
        >
          {panel(active)}
        </div>
      </div>

      {deleteDialog}
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

/**
 * The phone/tablet section switcher.
 *
 * A real tablist: one tab in the tab order at a time, arrow keys move between
 * them, and the active chip is scrolled into view so it is never hiding off the
 * edge. Edge fades appear only on the side that still has more chips, which is
 * what tells a thumb "swipe me" — a strip that just stops at the screen edge
 * reads as five items of which the rest do not exist.
 */
function SectionTabs({ active, onSelect }: { active: Section; onSelect: (s: Section) => void }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: true })

  const measure = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    setEdges({
      start: el.scrollLeft > 4,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    })
  }, [])

  // Keep the current chip on screen whenever the section changes, however it
  // changed (tap, arrow key, or the initial render).
  useEffect(() => {
    const chip = stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    chip?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' })
    measure()
  }, [active, measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SECTIONS.indexOf(active)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % SECTIONS.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + SECTIONS.length) % SECTIONS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = SECTIONS.length - 1
    else return
    e.preventDefault()
    onSelect(SECTIONS[next])
    stripRef.current
      ?.querySelector<HTMLElement>(`#${tabId(SECTIONS[next])}`)
      ?.focus()
  }

  return (
    <div className="relative">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Settings sections"
        onScroll={measure}
        onKeyDown={onKeyDown}
        className="flex snap-x snap-proximity gap-2 overflow-x-auto scroll-px-4 px-4 py-2.5 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {SECTIONS.map((name) => {
          const selected = active === name
          return (
            <button
              key={name}
              id={tabId(name)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(name)}
              className={cn(
                'min-h-11 shrink-0 snap-start whitespace-nowrap rounded-full border px-4 text-[14px] transition-colors cursor-pointer',
                selected
                  ? 'border-brand/40 bg-brand-soft font-bold text-brand-deep'
                  : 'border-line bg-raised font-medium text-ink-3 hover:border-line-dash hover:text-ink',
              )}
            >
              {name}
            </button>
          )
        })}
      </div>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent t-move duration-150',
          edges.start ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent t-move duration-150',
          edges.end ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  )
}

// ── Phones: a grouped list, then one section at a time ─────────────────

const SECTION_ICON: Record<Section, IconName> = {
  Account: 'user',
  Study: 'deck',
  'How you learn': 'sparkle',
  'AI & sources': 'doc',
  Privacy: 'lock',
}

/** URL-safe name for a section, so the phone's back gesture leaves a detail. */
export function sectionSlug(name: Section): string {
  return name.replace(/\W+/g, '-').replace(/-+$/, '').toLowerCase()
}

function sectionFromSlug(slug: string | null): Section | null {
  if (!slug) return null
  return SECTIONS.find((n) => sectionSlug(n) === slug) ?? null
}

/**
 * Settings on a phone: an iOS-style grouped list, each row opening its
 * section as its own screen with a slim back bar.
 *
 * The open section lives in the URL (`?section=study`) and is *pushed*, so the
 * system back gesture — the thing a thumb actually does — returns to the list
 * instead of leaving Settings. The on-screen back button does the same.
 */
function PhoneSettings({
  panel,
  displayName,
  initials,
  email,
  summary,
  deleteDialog,
}: {
  panel: (s: Section) => React.ReactNode
  displayName: string
  initials: string
  email: string
  summary: Record<Section, string>
  deleteDialog: React.ReactNode
}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const open = sectionFromSlug(params.get('section'))
  // A section is a pushed screen: its own slim bar with Back replaces the
  // shell's, so there is exactly one way back and it goes to the list.
  useImmersive(open !== null)

  const show = (name: Section) => setParams({ section: sectionSlug(name) }, { state: { fromList: true } })
  const back = () => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) navigate(-1)
    else setParams({}, { replace: true })
  }

  if (open) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="relative z-10 flex h-12 shrink-0 items-center gap-1 border-b border-line bg-canvas px-1.5">
          <button
            type="button"
            onClick={back}
            className="flex min-h-11 min-w-11 cursor-pointer items-center gap-0.5 rounded-[10px] px-2 text-[15px] font-semibold text-brand active:bg-line-soft"
          >
            <Icon name="arrowLeft" size={16} />
            Settings
          </button>
          <h1 className="pointer-events-none absolute inset-x-0 text-center text-[16px] font-semibold text-ink">{open}</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div
            role="region"
            aria-label={open}
            className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-10 pt-4 [&_input]:text-[16px] [&_textarea]:text-[16px]"
          >
            {panel(open)}
          </div>
        </div>
        {deleteDialog}
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pb-10 pt-5">
        {/* The shell's top bar already titles this screen "Settings". */}
        <button
          type="button"
          onClick={() => show('Account')}
          className="flex min-h-[72px] cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-left active:bg-line-soft"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-coral-soft text-[14px] font-semibold text-coral-deep">
            {initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-semibold text-ink">{displayName}</span>
            <span className="block truncate text-[14px] text-muted">{email}</span>
          </span>
          <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
        </button>

        <nav aria-label="Settings sections" className="overflow-hidden rounded-xl border border-line bg-surface">
          <ul>
            {SECTIONS.filter((n) => n !== 'Account').map((name) => (
              <li key={name} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => show(name)}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left active:bg-line-soft"
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-[9px]',
                      name === 'Privacy' ? 'bg-coral-soft text-coral-deep' : 'bg-raised text-ink-3',
                    )}
                  >
                    <Icon name={SECTION_ICON[name]} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-medium text-ink">{name}</span>
                    {summary[name] && (
                      <span className="block truncate text-[13px] text-muted">{summary[name]}</span>
                    )}
                  </span>
                  <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}
