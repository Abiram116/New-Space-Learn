/**
 * Settings — real preferences persisted via `/me/settings`.
 *
 * Five sections, ordered by how often they are opened:
 *   - Learning (how the AI should teach you — the first-run answers, editable)
 *   - Study (daily goal, streak freeze, how answers use your documents)
 *   - Account (name, password, sign out, and — last, apart — delete)
 *   - Feedback
 *   - About & legal
 *
 * Placement follows one rule throughout: what is changed most comes first,
 * what cannot be undone comes last and stands apart.
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
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
import { TrustSettingsList } from '../trust/TrustSettingsList'
import { trustOverlayHref } from '../trust/TrustLayer'
import { FeedbackTab } from '../feedback/FeedbackTab'
// The six labelled-row primitives used to be defined at the bottom of this
// file. Nothing in them knows what a preference is — they are the generic
// "row in a grouped list" pattern — so they live in `components/ui/` now and
// this file is ~150 lines shorter for it.
import { Rise } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { Icon, type IconName } from '../../components/ui/Icon'
import { writeCache } from '../../lib/asyncCache'
import { useIsMobile } from '../../lib/useIsMobile'
import { STUDENT_MODEL_KEY } from '../onboarding/skippedStyle'
import { NAME_MAX } from '../onboarding/steps'
import { LearningPanel } from './LearningPanel'
import { Shortcuts } from './Shortcuts'
import { Pill, SaveTell, SettingRow, SettingsCard, SpringSwitch, StreakDots, GoalRing, Stepper } from './parts'
import { PANEL_ID, SettingsHeader, SettingsNav, TabSwap } from './SettingsChrome'
import { setBotsEnabled, useBotsEnabled } from '../../lib/botPreference'

const SECTIONS = ['Learning', 'Study', 'Account', 'Feedback', 'About & legal'] as const
type Section = (typeof SECTIONS)[number]
const GOAL_PRESETS = [10, 20, 40, 80]

/** Free-text fields debounce their PATCH instead of firing one per
 *  keystroke — typing "Amazon OA next week" used to be six or seven network
 *  requests, one per pause, none of which the student was waiting on. */
const TEXT_PATCH_DEBOUNCE_MS = 600
/** How long "saved" stays beside a setting after its save lands. */
const SAVED_SHOWN_MS = 1800

export function Settings() {
  const { user, signOut, setDisplayName } = useAuth()
  const location = useLocation()
  const { show, showError } = useToast()
  const navigate = useNavigate()

  const phone = useIsMobile()
  const botsOn = useBotsEnabled()
  const [active, setActive] = useState<Section>('Learning')
  const [dir, setDir] = useState(0)
  const select = (next: Section) => {
    setDir(Math.sign(SECTIONS.indexOf(next) - SECTIONS.indexOf(active)))
    setActive(next)
  }
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [student, setStudent] = useState<StudentModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Say "saved" beside the setting that just landed, briefly. */
  const flashSaved = useCallback((key: string) => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setSavedKey(key)
    savedTimer.current = setTimeout(() => setSavedKey(null), SAVED_SHOWN_MS)
  }, [])
  useEffect(() => () => void (savedTimer.current && clearTimeout(savedTimer.current)), [])
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
        flashSaved(fieldKey)
      } catch (err) {
        setPrefs(prefs)
        showError(err)
      } finally {
        setSavingKey(null)
      }
    },
    [prefs, showError, flashSaved],
  )

  // One timer per field, keyed the same way `savingKey` is, so typing in
  // "working towards" doesn't reset a pending "learning style" save.
  const textTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const patchStudent = useCallback(
    async (fieldKey: string, updates: Partial<StudentModel>) => {
      if (!student) return
      // A choice made while typed words for the same field are still waiting
      // to save replaces them: the older, queued value must not land on top.
      if (textTimers.current[fieldKey]) clearTimeout(textTimers.current[fieldKey])
      const optimistic = { ...student, ...updates }
      setStudent(optimistic)
      setSavingKey(fieldKey)
      try {
        const updated = await updateStudentModel(updates)
        setStudent(updated)
        writeCache(STUDENT_MODEL_KEY, updated)
        flashSaved(fieldKey)
      } catch (err) {
        setStudent(student)
        showError(err)
      } finally {
        setSavingKey(null)
      }
    },
    [student, showError, flashSaved],
  )

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
          // Not `setStudent(updated)`: they may have typed more since this
          // was sent, and the reply would put the field back a few letters.
          writeCache(STUDENT_MODEL_KEY, updated)
          flashSaved(fieldKey)
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
    [student, showError, flashSaved],
  )

  const doSignOut = async () => {
    try {
      await signOut()
      navigate('/signin', { replace: true })
    } catch (err) {
      showError(err)
    }
  }

  const [othersBusy, setOthersBusy] = useState(false)
  const signOutOthers = async () => {
    setOthersBusy(true)
    try {
      const { error } = await getSupabase().auth.signOut({ scope: 'others' })
      if (error) throw error
      show('Signed out everywhere else.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setOthersBusy(false)
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
  // Someone who only ever signed in with Google has no password to change.
  const providers = user?.app_metadata?.providers as string[] | undefined
  const hasPassword = !providers || providers.includes('email')

  const savedName = ((user?.user_metadata?.display_name as string | undefined) ?? '').trim()
  const [name, setName] = useState(savedName)
  const [nameBusy, setNameBusy] = useState(false)
  const saveName = async () => {
    const next = name.trim()
    if (!next || next === savedName) return
    setNameBusy(true)
    try {
      await setDisplayName(next)
      show('Name updated.', 'success')
    } catch (err) {
      showError(err)
    } finally {
      setNameBusy(false)
    }
  }

  /** One section's controls — the desktop panel and the phone detail screen
   *  render the same thing, so a setting can never exist on one and not the
   *  other. */
  const panel = (active: Section) => (
    <>
      {error && (
        <div className="col-span-full rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-[14px] text-coral-deep">
          {error}
        </div>
      )}

      {!prefs && !error && (
        <div className="col-span-full">
          <PageSpinner label="Loading preferences…" />
        </div>
      )}

      {student && active === 'Learning' && (
        <LearningPanel
          student={student}
          savingKey={savingKey}
          savedKey={savedKey}
          save={(key, updates) => void patchStudent(key, updates)}
          saveText={patchStudentText}
          learned={learned}
          resetting={resetting}
          onResetLearned={() => void resetLearned()}
        />
      )}

      {prefs && active === 'Study' && (
        <>
          <Rise>
            <SettingsCard
              icon="target"
              title="Daily goal"
              hint="How many cards you aim to review each day."
              tell={<SaveTell saving={savingKey === 'daily_goal'} saved={savedKey === 'daily_goal'} />}
            >
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
                <GoalRing goal={prefs.daily_goal} />
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <Stepper
                    value={prefs.daily_goal}
                    min={1}
                    max={500}
                    step={5}
                    unit="cards"
                    label="Cards per day"
                    onCommit={(n) => patch('daily_goal', { daily_goal: n })}
                  />
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Quick goals">
                    {GOAL_PRESETS.map((n) => (
                      <Pill key={n} on={prefs.daily_goal === n} onClick={() => patch('daily_goal', { daily_goal: n })}>
                        {n}
                      </Pill>
                    ))}
                  </div>
                </div>
              </div>
            </SettingsCard>
          </Rise>

          <Rise delay={50}>
            <SettingsCard icon="flame" title="Streak" hint="Keep it going, even when life gets in the way.">
              <div className="mb-3 flex items-center gap-4 rounded-xl bg-well px-4 py-4">
                <div className="leading-none">
                  <span className="font-display text-[40px] font-semibold tabular-nums text-ink">{student?.streak_days ?? 0}</span>
                  <span className="ml-1.5 text-[13px] text-muted">{student?.streak_days === 1 ? 'day' : 'days'}</span>
                </div>
                <div className="ml-auto">
                  <StreakDots days={student?.streak_days ?? 0} freeze={prefs.streak_freeze_enabled} />
                </div>
              </div>
              <SettingRow
                label="Streak freeze"
                hint="Miss one day without breaking your streak."
                saved={savedKey === 'streak_freeze_enabled'}
                last
              >
                <SpringSwitch
                  label="Streak freeze"
                  checked={prefs.streak_freeze_enabled}
                  onChange={(v) => patch('streak_freeze_enabled', { streak_freeze_enabled: v })}
                />
              </SettingRow>
            </SettingsCard>
          </Rise>

          <Rise delay={100}>
            <SettingsCard icon="doc" title="Your documents" hint="How answers lean on what you have uploaded.">
              <SettingRow
                label="Answer only from my docs"
                hint="If your documents don’t cover it, the tutor says so instead of guessing."
                saved={savedKey === 'answer_only_from_docs'}
              >
                <SpringSwitch
                  label="Answer only from my docs"
                  checked={prefs.answer_only_from_docs}
                  onChange={(v) => patch('answer_only_from_docs', { answer_only_from_docs: v })}
                />
              </SettingRow>
              <SettingRow
                label="Always show citations"
                hint="Marks which part of your documents each answer came from."
                saved={savedKey === 'always_show_citations'}
                last={phone}
              >
                <SpringSwitch
                  label="Always show citations"
                  checked={prefs.always_show_citations}
                  onChange={(v) => patch('always_show_citations', { always_show_citations: v })}
                />
              </SettingRow>
              {!phone && (
                <SettingRow label="Show the agent bots" hint="Nova and the crew, while the AI works. Saved on this device." last>
                  <SpringSwitch label="Show the agent bots" checked={botsOn} onChange={setBotsEnabled} />
                </SettingRow>
              )}
            </SettingsCard>
          </Rise>
          {phone ? (
            <p className="col-span-full flex items-start gap-2 px-1 text-[13.5px] leading-relaxed text-muted">
              <Icon name="skill" size={15} className="mt-0.5 shrink-0 text-mint" />
              Skills shape the chat tutor and are managed on desktop.
            </p>
          ) : (
            <div className="col-span-full">
              <Shortcuts />
            </div>
          )}
        </>
      )}

      {active === 'Account' && (
        <>
          <Rise className="col-span-full">
            <SettingsCard tone="hero" icon="user" title="Profile" hint={email}>
              <form
                className="flex items-center gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveName()
                }}
              >
                <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-brand-soft text-[13px] font-semibold text-brand-deep">
                  {initials}
                </span>
                <div className="min-w-0 flex-1">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={NAME_MAX}
                    placeholder="Your name"
                    autoComplete="name"
                    aria-label="Your name"
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={nameBusy || !name.trim() || name.trim() === savedName}
                  className="min-w-20 shrink-0"
                >
                  {nameBusy ? 'Saving…' : 'Save'}
                </Button>
              </form>
            </SettingsCard>
          </Rise>

          <Rise delay={50}>
            {hasPassword ? (
              <SettingsCard icon="lock" title="Change password" hint="At least 8 characters.">
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void changePassword()
                  }}
                >
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                    autoComplete="new-password"
                    aria-label="New password"
                  />
                  {/* Same label while busy so the button does not change width. */}
                  <Button
                    type="submit"
                    disabled={passwordBusy || newPassword.length === 0}
                    className="w-full min-w-40 sm:w-auto sm:self-start"
                  >
                    {passwordBusy ? 'Updating…' : 'Update password'}
                  </Button>
                </form>
              </SettingsCard>
            ) : (
              <SettingsCard icon="lock" title="Password">
                <p className="text-[14px] text-muted">You sign in with Google, so there is no password to change here.</p>
              </SettingsCard>
            )}
          </Rise>

          <Rise delay={100}>
            <SettingsCard icon="settings" title="Sessions">
              <div className="flex flex-col gap-3 text-[14px]">
                <p className="text-muted">
                  Signing out keeps everything in your account.{' '}
                  <Link to={trustOverlayHref(location, 'privacy')} className="text-brand-deep hover:underline">
                    What we keep and why
                  </Link>
                </p>
                {/* Signing out is reversible, so both are ordinary secondary
                    buttons — coral is reserved for things that cannot be undone. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button onClick={doSignOut} variant="secondary" className="w-full sm:w-auto">
                    Sign out
                  </Button>
                  <Button
                    onClick={() => void signOutOthers()}
                    variant="secondary"
                    disabled={othersBusy}
                    title="Other devices are asked to sign in again within the hour"
                    className="w-full min-w-52 sm:w-auto"
                  >
                    {othersBusy ? 'Signing out…' : 'Sign out of other devices'}
                  </Button>
                </div>
              </div>
            </SettingsCard>
          </Rise>

          <Rise delay={150} className="col-span-full mt-4 border-t border-dashed border-coral/30 pt-7">
            <SettingsCard icon="alert" title="Danger zone" tone="danger">
              <div className="flex flex-col gap-4 text-[14px] sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-xl text-muted">
                  Permanently delete your account and everything in it — every
                  subject, document, chat, note, deck, and quiz. This can't be
                  undone.
                </p>
                <Button onClick={() => setDeleteOpen(true)} variant="danger" className="w-full sm:w-auto sm:shrink-0">
                  Delete account
                </Button>
              </div>
            </SettingsCard>
          </Rise>
        </>
      )}

      {active === 'Feedback' && (
        <>
          <div className="col-span-full max-w-4xl">
            <FeedbackTab />
          </div>
        </>
      )}

      {active === 'About & legal' && (
        <>
          <div className="col-span-full max-w-4xl">
            <TrustSettingsList />
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

  const summary: Record<Section, string> = {
    Learning: student?.session_length_minutes ? `How you’re taught · ${student.session_length_minutes}-minute sessions` : 'How you’re taught',
    Study: prefs ? `${prefs.daily_goal} cards a day` : '',
    Account: 'Name, password, sign out',
    Feedback: 'Tell us what to fix or build',
    'About & legal': 'Policies, contact us',
  }
  const navItems = SECTIONS.map((name) => ({ name, icon: SECTION_ICON[name], summary: summary[name] }))

  if (phone) {
    return (
      <PhoneSettings
        panel={panel}
        displayName={displayName}
        initials={initials}
        email={email}
        summary={summary}
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-[1920px] px-4 pb-16 pt-6 sm:px-7 lg:px-8 lg:pt-9">
        <SettingsHeader
          name={displayName}
          initials={initials}
          email={email}
          streak={student ? student.streak_days : null}
          goal={prefs ? prefs.daily_goal : null}
        />
        <div className="mt-6 flex flex-col gap-4 lg:mt-9 lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-8">
          {/* Pinned: the chip strip below `lg`, the rail beside the content above it. */}
          <div className="sticky top-0 z-20 bg-canvas max-lg:-mx-4 sm:max-lg:-mx-7 lg:top-6 lg:bg-transparent">
            <SettingsNav items={navItems} active={active} onSelect={select} />
          </div>
          <div role="tabpanel" id={PANEL_ID} aria-label={active} className="min-w-0">
            <TabSwap id={active} dir={dir}>
              {panel(active)}
            </TabSwap>
          </div>
        </div>
      </div>
      {deleteDialog}
    </div>
  )
}

// ── Phones: a grouped list, then one section at a time ─────────────────

const SECTION_ICON: Record<Section, IconName> = {
  Learning: 'sparkle',
  Study: 'deck',
  Account: 'user',
  Feedback: 'thumbUp',
  'About & legal': 'seal',
}

/** URL-safe name for a section, so the phone's back gesture leaves a detail. */
export function sectionSlug(name: Section): string {
  return name.replace(/\W+/g, '-').replace(/-+$/, '').toLowerCase()
}

/** Where the sections that were merged away went, so an old link still lands. */
const OLD_SLUGS: Record<string, Section> = {
  'how-you-learn': 'Learning',
  'ai-sources': 'Study',
  privacy: 'Account',
}

function sectionFromSlug(slug: string | null): Section | null {
  if (!slug) return null
  return SECTIONS.find((n) => sectionSlug(n) === slug) ?? OLD_SLUGS[slug] ?? null
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
            aria-label="Settings"
            className="t-control grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-2 active:bg-line-soft"
          >
            <Icon name="arrowLeft" size={21} />
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
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-brand-soft text-brand-deep"
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
