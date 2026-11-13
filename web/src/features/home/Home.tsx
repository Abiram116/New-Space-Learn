/**
 * Home — the re-entry surface.
 *
 * The old version opened with "Good evening, Abiram", which tells a student
 * nothing they didn't already know. This opens with where they actually stand,
 * written from their own material, and puts the one thing worth doing next
 * directly under it.
 *
 * Read top to bottom in one pass (desktop):
 *
 *   1. Where you stand — Nova and the brief, Help in the corner.
 *   2. Up next — what to do now: the decision engine's pick, cards due, the
 *      quiz most worth retaking, files not ready yet, the topic you were last
 *      in. A new account sees its setup checklist here instead.
 *   3. This week — streak, quiz average and study time over the fortnight,
 *      then what is coming due and what is fading. (What you did this week is on Profile.)
 *   4. Your subjects — grouped by subject, each with its icon and topics.
 *      A reference shelf, so it sits last, in an even grid.
 *
 * Everything shown is real: the brief comes from `/me/brief` (with honest
 * deterministic copy behind it), counts come from `/me/stats`, the topics
 * from the spaces list, and the recap from the quiz/deck lists and student
 * model other screens already share. Nothing here is invented for decoration.
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type {
  Brief,
  BriefSuggestion,
  ForecastDay,
  Space,
  Stats,
  StudentModel,
  Subspace,
  Tone,
} from '../../api/types'
import { friendlyMessage } from '../../api/errors'
import { Button } from '../../components/ui/Button'
import { Card, DashedCard } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { Input } from '../../components/ui/Input'
import { FirstRun } from './FirstRun'
import { Tip } from '../../components/ui/Tip'
import { Icon, type IconName } from '../../components/ui/Icon'
import { CountUp, Rise } from '../../components/ui/motion'
import { Skeleton } from '../../components/ui/Skeleton'
import { Ledger } from '../../components/ui/Surface'
import { cn } from '../../lib/cn'
import { getCachedBrief, getCachedStats } from '../../lib/briefCache'
import { HOME_BRIEF_KEY, HOME_STATS_KEY } from '../../lib/homeKeys'
import { LIMITS } from '../../lib/limits'
import { nameHint } from '../../lib/nameHint'
import { subspacePath } from '../../lib/nav'
import { useAsync, type AsyncResult } from '../../lib/useAsync'
import { useIsMobile } from '../../lib/useIsMobile'
import { SlowCaption, StaleNotice } from '../../lib/AsyncState'
import { useSlowState, type SlowPhase } from '../../lib/useSlowState'
import { toneSoft, toneText } from '../../lib/tone'
import { useOptionalAuth } from '../../auth/AuthProvider'
import { NewSpaceModal } from '../spaces/NewSpaceModal'
import { SubjectIcon } from '../spaces/SubjectIcon'
import { useSpaces } from '../spaces/SpacesProvider'
import { StyleIntakeCard, useCachedStudentModel } from '../onboarding/StyleIntakeCard'
import { deriveChecklist, hideChecklist, isChecklistHidden } from './checklist'
import { FirstSteps, type StepTarget } from './FirstSteps'
import { examPlan, readiness, type ExamPlan, type Readiness } from './exam'
import { FocusDialog } from './FocusDialog'
import { ModeCard } from './ModeCard'
import { modeInfo } from '../../lib/studyMode'
import { Fortnight } from './Fortnight'
import { HelpButton, useHomeHelp } from './HomeHelp'
import { NovaBeside, NovaHello, briefIsGreeting } from './Greeting'
import { Today, WaitingNova } from './Today'
import {
  estimateReviewMinutes,
  filesNotReady,
  firstNameOf,
  subjectsForHome,
  topicsByRecency,
  topicsOf,
  type TopicEntry,
} from './today'
import { useHomeData, type HomeData } from './useHomeData'
import { busiestDeck, comingDue, fadingTopics, type Fading } from './week'

/**
 * Home, by device. Both shapes read the same brief and stats caches, so moving
 * between a phone and a laptop shows the same facts — only the shape differs:
 * Today on a phone, the dashboard everywhere else.
 */
export function Home() {
  const phone = useIsMobile()
  const stats = useAsync(() => getCachedStats(), [], HOME_STATS_KEY)
  const brief = useAsync(() => getCachedBrief(), [], HOME_BRIEF_KEY)
  return phone ? <Today stats={stats} brief={brief} /> : <DesktopHome stats={stats} brief={brief} />
}

function DesktopHome({ stats, brief }: { stats: AsyncResult<Stats>; brief: AsyncResult<Brief> }) {
  const { spaces, loading: spacesLoading, error: spacesError, refresh: refreshSpaces } = useSpaces()
  const studentModel = useCachedStudentModel()
  // Keyed by one of the account's own subject ids rather than the user id, so
  // this page needs nothing from auth (and two accounts on one machine still
  // don't share the choice).
  const accountKey = spaces.map((s) => s.id).sort()[0] ?? null
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const checklistHidden = hiddenFor === accountKey || isChecklistHidden(accountKey)
  // Cold-start awareness for the one blocking gate on this page (below) and
  // for the two sections that keep loading behind it — see `useSlowState`'s
  // own doc comment for why this is a hook rather than a fixed threshold.
  const spacesPhase = useSlowState(spacesLoading)
  const briefPhase = useSlowState(brief.loading)
  const statsPhase = useSlowState(stats.loading)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)
  const navigate = useNavigate()
  // A subject made from here opens on its first topic: it was made to be used.
  const newSpaceModal = (
    <NewSpaceModal
      open={newSpaceOpen}
      onClose={() => setNewSpaceOpen(false)}
      onTopicCreated={({ space, subspace }) => navigate(subspacePath(space, subspace))}
    />
  )
  const user = useOptionalAuth()?.user
  const name = firstNameOf(
    (user?.user_metadata?.display_name as string | undefined) || user?.email?.split('@')[0],
  )

  const briefGreets = !brief.loading && briefIsGreeting(brief.data?.headline, name)

  const anySpaces = spaces.length > 0
  const topics = useMemo(() => topicsByRecency(spaces), [spaces])
  const anySubspaces = topics.length > 0
  const help = useHomeHelp({ hasTopics: anySubspaces, keyboard: true })
  const extra = useHomeData(spaces)

  // The first-run checklist, from counts already on hand. Step 1's target
  // depends on what exists: no subject yet opens the new-subject dialog; a
  // subject with no topic is pointed at the field under "Your subjects".
  const checklist = deriveChecklist(topics, stats.loading ? null : stats.data)
  const materialTopic = topics.find((t) => (t.subspace.counts?.docs ?? 0) > 0) ?? topics[0]
  const stepTargets: Record<'material' | 'practice' | 'tutor', StepTarget> = {
    material: !anySpaces
      ? { kind: 'button', label: 'Create a subject', onClick: () => setNewSpaceOpen(true) }
      : materialTopic
        ? { kind: 'link', to: `${materialTopic.link}/docs`, label: 'Add material' }
        : { kind: 'hint', text: 'Name your first topic below, then drop a PDF into it.' },
    practice: materialTopic
      ? {
          kind: 'link',
          to: `${materialTopic.link}/flashcards`,
          label: 'Make cards',
          alt: { to: `${materialTopic.link}/quizzes`, label: 'or a quiz' },
        }
      : { kind: 'hint', text: 'Add a file first.' },
    tutor: materialTopic
      ? { kind: 'link', to: materialTopic.link, label: 'Ask the tutor' }
      : { kind: 'hint', text: 'Add a file first.' },
  }
  const showChecklist = !checklist.complete && !checklistHidden && !stats.loading
  const hideTheChecklist = () => {
    hideChecklist(accountKey)
    setHiddenFor(accountKey)
  }

  /**
   * Decide nothing until the subjects are in.
   *
   * Home has two entirely different shapes — the introduction for an empty
   * account, the dashboard for a working one — and which applies is not known
   * until `/spaces` answers. Rendering the dashboard while that was in flight
   * flashed standing figures at a brand-new account before replacing them
   * with the introduction (worse with a half-hour-old cached brief). A brief
   * skeleton beats showing someone a dashboard that is about to be taken away.
   *
   * A failed load is handled here too, rather than falling through to
   * `!anySpaces` below — an empty `spaces` array from a request that never
   * came back would otherwise read as "you have nothing yet," which is a
   * different sentence from "we couldn't reach the server," and only one of
   * them is true.
   */
  if (spacesError && !spacesLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        <EmptyState
          icon="offline"
          title="We couldn't open your home page"
          bot={{ agent: 'tutor', say: 'error', mood: 'oops' }}
          description={spacesError}
          action={
            <Button onClick={() => void refreshSpaces()}>
              <Icon name="refresh" size={14} /> Retry
            </Button>
          }
        />
      </div>
    )
  }
  if (spacesLoading) return <HomeSkeleton phase={spacesPhase} onRetry={() => void refreshSpaces()} />

  /* A brand-new account gets the introduction *instead of* the dashboard, not
     threaded through it. Until there is a subject there is nothing to brief,
     nothing to measure and nothing to resume. Home returns the moment there
     is anything real to put on it. */
  if (!anySpaces) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-7 sm:px-7 sm:py-9">
          <HelpButton onOpen={help.open} hint className="-mt-3 mb-1 self-end" />
          <FirstRun
            name={name}
            onCreate={() => setNewSpaceOpen(true)}
            steps={<FirstSteps checklist={checklist} targets={stepTargets} />}
          />
        </div>
        {newSpaceModal}
        {help.dialog}
      </div>
    )
  }

  // Until any file has been added, the checklist IS what to do now; after
  // that (even while the file is still being read) it trails the real "up
  // next" items until it is done or put away.
  const anyFiles = topics.some((t) => (t.subspace.counts?.docs ?? 0) > 0)
  const leadWithChecklist = showChecklist && !anyFiles && !brief.data?.suggestion

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-7 sm:px-7 sm:py-9">
        {/* ── 1. Where you stand ──
            Nova and the brief, with Help in the corner. The brief's own
            suggestion is no longer a button up here: it leads "Up next",
            beside the other things worth doing, so there is one place to look
            for what to do. Each band rises in just behind the one above it;
            reduced-motion users get all of it at once (inside Rise). */}
        <header className="flex flex-col gap-2">
          <div className="flex items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {/* Nova says hello above the brief — or, when the headline
                  already greets, just waves beside it. Never two hellos. */}
              {!briefGreets && (
                <NovaHello name={name} phase={brief.loading ? briefPhase : undefined} size={44} className="mb-1" />
              )}
              {brief.loading ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-11 w-2/3 rounded-lg" />
                  <Skeleton className="h-4 w-1/2 rounded" />
                  <SlowCaption phase={briefPhase} onRetry={brief.refresh} />
                </div>
              ) : (
                <>
                  {briefGreets ? (
                    <NovaBeside size={64}>
                      <h1 className="nameplate max-w-3xl text-[clamp(30px,5.5vw,52px)] text-ink">{brief.data?.headline}</h1>
                    </NovaBeside>
                  ) : (
                    <h1 className="nameplate max-w-3xl text-[clamp(30px,5.5vw,52px)] text-ink">
                      {brief.data?.headline ?? 'Ready when you are'}
                    </h1>
                  )}
                  <p className="max-w-xl text-[14.5px] leading-relaxed text-ink-3">
                    {brief.data?.body ?? 'Add a topic to your subject and start asking questions about your own material.'}
                  </p>
                  {/* A failed background refresh keeps the headline already
                      showing — this footnote says so instead of leaving stale
                      copy looking current. */}
                  {brief.error && <StaleNotice onRetry={brief.refresh} className="mt-0.5" />}
                </>
              )}
            </div>
            <HelpButton onOpen={help.open} hint className="-mt-1 shrink-0" />
          </div>
        </header>

        {/* An exam date turns Home into a plan: days left, what today is for. */}
        <ExamStrip
          plan={examPlan({
            examDate: (studentModel ?? extra.model)?.exam_date,
            goal: (studentModel ?? extra.model)?.exam_context,
            event: modeInfo((studentModel ?? extra.model)?.study_mode)?.event,
            due: stats.data?.cards_due ?? 0,
            fading: fadingTopics(extra.model, extra.index, { exclude: extra.retake?.quiz.subspace_id ?? null }),
          })}
          model={studentModel ?? extra.model}
          ready={readiness(extra.index)}
          hasGoalNoDate={
            Boolean((studentModel ?? extra.model)?.exam_context || (studentModel ?? extra.model)?.study_mode) &&
            !(studentModel ?? extra.model)?.exam_date &&
            (studentModel ?? extra.model)?.study_mode !== 'curious'
          }
        />

        {/* The one answer that changes the most: what they are studying for. */}
        <ModeCard model={studentModel ?? extra.model} />

        {/* Signed up on a phone: the two questions it skipped, offered once. */}
        <StyleIntakeCard model={studentModel} className="-mt-4" />

        {/* ── 2. Up next: what to do now ── */}
        <Rise delay={40}>
          <section aria-labelledby="up-next-title" className="flex flex-col gap-4">
            <div className="flex items-baseline gap-3">
              <h2 id="up-next-title" className="nameplate text-[22px] text-ink">
                Up next
              </h2>
              {!stats.loading && stats.data && anySubspaces && (
                <span className="setcode">
                  {(stats.data.cards_due ?? 0) > 0
                    ? `${stats.data.cards_due} card${stats.data.cards_due === 1 ? '' : 's'} due`
                    : 'no cards due'}
                </span>
              )}
            </div>
            {leadWithChecklist ? (
              <FirstSteps checklist={checklist} targets={stepTargets} onHide={hideTheChecklist} />
            ) : (
              <>
                <UpNext
                  topics={topics}
                  stats={stats}
                  statsPhase={statsPhase}
                  suggestion={brief.data?.suggestion ?? null}
                  extra={extra}
                />
                {showChecklist && (
                  <FirstSteps checklist={checklist} targets={stepTargets} onHide={hideTheChecklist} className="mt-2" />
                )}
              </>
            )}
          </section>
        </Rise>

        {/* ── 3. Your subjects ──
            Grouped by subject, each with its own icon and its topics, so
            "where is my RL stuff" is answered by its subject rather than by a
            flat list of the six most recent topics. A subject with no topic
            yet is an empty slot with the field that fills it. */}

        {/* ── 4. This week: how it is going ──
            Figures and evidence last: they are what you check, not what you
            act on. Nothing here can have happened before there is a topic. */}
        {anySubspaces && (
          <Rise delay={90}>
            <WeekSection stats={stats} statsPhase={statsPhase} topics={topics} extra={extra} />
          </Rise>
        )}

        <Rise delay={140}>
          <SubjectsSection spaces={spaces} anySubspaces={anySubspaces} onNewSubject={() => setNewSpaceOpen(true)} />
        </Rise>
      </div>

      {newSpaceModal}
      {help.dialog}
    </div>
  )
}

// ── Exam countdown ─────────────────────────────────────────────────────

/**
 * The days left and what today is for, from the date the student gave. Nothing
 * renders without a date, and a goal with no date gets one quiet line asking
 * for it, so the feature is findable without nagging anyone who has no exam.
 */
function ExamStrip({
  plan,
  hasGoalNoDate,
  model,
  ready,
}: {
  plan: ExamPlan | null
  hasGoalNoDate: boolean
  model?: StudentModel | null
  ready?: Readiness | null
}) {
  const [editing, setEditing] = useState(false)
  if (!plan) {
    return hasGoalNoDate ? (
      <p className="-mt-3 text-[13px] text-muted">
        Working towards something?{' '}
        <Link to="/settings" className="font-semibold text-brand-deep hover:underline">
          Add the date
        </Link>{' '}
        and Home will plan each day up to it.
      </p>
    ) : null
  }
  return (
    <Rise>
      <section
        aria-label="Exam countdown"
        className={cn(
          'relative flex flex-col gap-3 rounded-xl border p-5 sm:flex-row sm:items-center sm:gap-8',
          plan.urgent ? 'border-brand/45 bg-brand-tint' : 'cardstock border-line',
        )}
      >
        {model && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="setcode absolute right-4 top-3.5 cursor-pointer font-bold text-brand-deep hover:underline"
          >
            Change
          </button>
        )}
        <div className="min-w-0 shrink-0 sm:w-56">
          <div className="setcode truncate" title={plan.title}>
            {plan.title}
          </div>
          <div className="nameplate mt-1 text-[40px] leading-none text-ink">{plan.when}</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:pr-16">
          <p className="text-[15px] leading-snug text-ink-2">{plan.line}</p>
          {ready && <ReadyBar ready={ready} />}
        </div>
      </section>
      {editing && model && <FocusDialog key={`${model.study_mode}|${model.exam_context}|${model.exam_date}`} model={model} open onClose={() => setEditing(false)} />}
    </Rise>
  )
}

/**
 * The honest answer to "am I ready?": one number from the student's own quiz
 * scores and card reviews, the weakest topic as a way in, and how much of their
 * material that number is based on. Hover for how it is worked out.
 */
function ReadyBar({ ready }: { ready: Readiness }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2" title="The average of your lowest quiz score and the share of cards you know, per topic. Topics with neither are left out.">
        <span className="setcode">Readiness</span>
        <span className="nameplate text-[20px] leading-none text-ink">{ready.pct}%</span>
        <span className="text-[12px] text-muted">
          from {ready.known} of {ready.total} topic{ready.total === 1 ? '' : 's'}
        </span>
      </div>
      <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-line" role="img" aria-label={`Readiness ${ready.pct} percent`}>
        <div className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${ready.pct}%` }} />
      </div>
    </div>
  )
}

// ── Up next ────────────────────────────────────────────────────────────

/**
 * What to do now, as a short row of tiles: the decision engine's pick (when
 * it made one), cards due, the quiz most worth retaking, files that are not
 * ready yet, and the topic you were last in. Each is real and each is shown
 * only when it applies; two tiles never point at the same thing.
 */
const MAX_NEXT_TILES = 3

function UpNext({
  topics,
  stats,
  statsPhase,
  suggestion,
  extra,
}: {
  topics: TopicEntry[]
  stats: AsyncResult<Stats>
  statsPhase: SlowPhase
  suggestion: BriefSuggestion | null
  extra: HomeData
}) {
  const first = topics[0]
  if (!first) return null
  const s = stats.data
  const due = s?.cards_due ?? 0
  // /flashcards is an account-wide library whichever topic's URL gets you
  // there, but the topic in the link still becomes the active context — so
  // prefer a topic that holds cards over one that is merely recent.
  const cardsEntry = topics.find((e) => (e.subspace.counts?.cards ?? 0) > 0) ?? first
  const notReady = filesNotReady(topics, stats.loading ? null : s)
  const docsEntry = topics.find((e) => (e.subspace.counts?.docs ?? 0) > 0) ?? first
  const sameRoute = (href: string) => Boolean(suggestion && suggestion.route.split('?')[0] === href.split('?')[0])

  const tiles: ReactNode[] = []
  if (suggestion) {
    tiles.push(
      <NextTile
        key="suggestion"
        featured
        to={suggestion.route}
        icon="target"
        eyebrow="Suggested for you"
        title={suggestion.label}
        meta={suggestion.reason ?? null}
      />,
    )
  }
  if (stats.loading && !s) {
    tiles.push(<TileSkeleton key="due-loading" />)
  } else if (due > 0 && suggestion?.action !== 'due_cards') {
    tiles.push(
      <NextTile
        key="due"
        to={`${cardsEntry.link}/flashcards?review=due`}
        icon="deck"
        tone="sun"
        eyebrow="Cards due"
        title={`Review ${due} card${due === 1 ? '' : 's'}`}
        meta={`~${estimateReviewMinutes(due)} min`}
      />,
    )
  }
  if (extra.retakeLoading) {
    tiles.push(<TileSkeleton key="retake-loading" />)
  } else if (extra.retake && !sameRoute(extra.retake.href)) {
    const q = extra.retake.quiz
    tiles.push(
      <NextTile
        key="retake"
        to={extra.retake.href}
        icon="quiz"
        tone="coral"
        eyebrow="Worth a retake"
        title={q.topic || q.subspace_name || 'Quiz'}
        meta={`Best ${q.best_score}%${q.attempts && q.attempts > 1 ? ` · ${q.attempts} tries` : ''}`}
      />,
    )
  }
  if (notReady && notReady > 0) {
    tiles.push(
      <NextTile
        key="files"
        to={`${docsEntry.link}/docs`}
        icon="doc"
        tone="sky"
        eyebrow="Files"
        title={`${notReady} file${notReady === 1 ? ' isn’t' : 's aren’t'} ready yet`}
        meta="Still being read, or need another try"
      />,
    )
  }
  // "Pick up where you left off" only fills a short row; it is a convenience,
  // not a third and fourth thing competing with the real next step.
  if (tiles.length < 2 && suggestion?.action !== 'continue' && !sameRoute(first.link)) {
    tiles.push(
      <NextTile
        key="continue"
        to={first.link}
        space={first.space}
        eyebrow={first.subspace.last_activity_at ? 'Pick up where you left off' : 'Start here'}
        title={first.subspace.name}
        meta={`${first.space.name} · ${relativeShort(first.subspace.last_activity_at)}`}
      />,
    )
  }

  // Three at most: the pick, the cards, and one more. More than that is a menu,
  // and a menu is what this row exists to save you from.
  tiles.splice(MAX_NEXT_TILES)
  const cols = tiles.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'
  return (
    <div className="flex flex-col gap-2">
      <div className={cn('grid gap-3 sm:grid-cols-2', cols)}>{tiles}</div>
      {stats.loading ? (
        <SlowCaption phase={statsPhase} onRetry={stats.refresh} />
      ) : (
        stats.error && <StaleNotice onRetry={stats.refresh} />
      )}
    </div>
  )
}

function NextTile({
  to,
  icon,
  space,
  tone = 'brand',
  eyebrow,
  title,
  meta,
  featured = false,
}: {
  to: string
  icon?: IconName
  space?: Space
  tone?: Tone
  eyebrow: string
  title: string
  meta: string | null
  featured?: boolean
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group flex min-h-[124px] min-w-0 flex-col gap-3 rounded-xl border p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        featured ? 'border-brand/45 bg-brand-tint hover:border-brand/70' : 'cardstock border-line hover:border-brand/30',
      )}
    >
      <span className="flex items-center gap-2">
        {space ? (
          <SubjectIcon space={space} size="sm" />
        ) : (
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-[7px]', toneSoft[tone], toneText[tone])} aria-hidden>
            <Icon name={icon ?? 'arrowRight'} size={14} />
          </span>
        )}
        <span className={cn('setcode truncate', featured && 'text-brand-deep')}>{eyebrow}</span>
      </span>
      <span className="nameplate break-words text-[19px] leading-tight text-ink">{title}</span>
      <span className="mt-auto flex items-end justify-between gap-2">
        {meta ? <span className="min-w-0 text-[12.5px] leading-snug text-muted">{meta}</span> : <span />}
        <Icon
          name="arrowRight"
          size={15}
          className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand motion-reduce:transition-none"
        />
      </span>
    </Link>
  )
}

function TileSkeleton() {
  return (
    <div className="flex min-h-[124px] flex-col gap-3 rounded-xl border border-line p-4" aria-hidden>
      <Skeleton className="h-4 w-24 rounded" />
      <Skeleton className="h-6 w-3/4 rounded" />
      <Skeleton className="mt-auto h-3 w-1/3 rounded" />
    </div>
  )
}

// ── Your subjects ──────────────────────────────────────────────────────

/** Subjects shown before "Show all" — a page, not an index. */
const SUBJECTS_SHOWN = 6
/** Topics listed per subject card before "+N more". */
const TOPICS_SHOWN = 2

function SubjectsSection({
  spaces,
  anySubspaces,
  onNewSubject,
}: {
  spaces: Space[]
  anySubspaces: boolean
  onNewSubject: () => void
}) {
  const ordered = useMemo(() => subjectsForHome(spaces), [spaces])
  const [all, setAll] = useState(false)
  const shown = all ? ordered : ordered.slice(0, SUBJECTS_SHOWN)
  const topicCount = spaces.reduce((n, s) => n + s.subspaces.length, 0)
  return (
    <section aria-labelledby="subjects-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="subjects-title" className="nameplate text-[22px] text-ink">
          {anySubspaces ? 'Your subjects' : 'Name your first topic'}
        </h2>
        {anySubspaces && (
          <span className="setcode">
            {spaces.length} subject{spaces.length === 1 ? '' : 's'} · {topicCount} topic{topicCount === 1 ? '' : 's'}
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto self-center" onClick={onNewSubject}>
          <Icon name="plus" size={14} /> New subject
        </Button>
      </div>
      {!anySubspaces && (
        <p className="-mt-2 text-[14px] leading-snug text-muted">
          A topic is one part of a subject. It is where your documents, chat and cards live.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((space) =>
          space.subspaces.length === 0 ? (
            <DashedCard key={space.id} className="flex h-full min-h-[172px] min-w-0 flex-col justify-between gap-3 p-4">
              <SubjectHead space={space} />
              <FirstTopicField space={space} />
            </DashedCard>
          ) : (
            <SubjectCard key={space.id} space={space} />
          ),
        )}
      </div>
      {ordered.length > SUBJECTS_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="min-h-10 cursor-pointer self-start rounded-[9px] px-2.5 text-[13.5px] font-semibold text-ink-3 transition-colors hover:bg-line-soft hover:text-ink"
        >
          {all ? 'Show fewer' : `Show all ${ordered.length} subjects`}
        </button>
      )}
    </section>
  )
}

function SubjectHead({ space, count }: { space: Space; count?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <SubjectIcon space={space} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[16px] font-bold text-ink">{space.name}</div>
        {count != null && (
          <div className="setcode">
            {count} topic{count === 1 ? '' : 's'}
          </div>
        )}
      </div>
      {space.pinned && <Icon name="pin" size={13} filled className="shrink-0 text-faint" aria-label="Pinned" />}
    </div>
  )
}

/** One subject and its topics, most recent first. */
function SubjectCard({ space }: { space: Space }) {
  const [open, setOpen] = useState(false)
  const topics = topicsOf(space)
  // Topics with something in them lead; empty ones ("Nothing added yet") fold
  // into "+N more" instead of padding the card. All-empty: show the first two.
  const filled = topics.filter((t) => countsLine(t) !== EMPTY_TOPIC)
  const collapsed = filled.length > 0 ? filled.slice(0, TOPICS_SHOWN) : topics.slice(0, 2)
  const shown = open ? topics : collapsed
  const hidden = topics.length - shown.length
  return (
    <Card className="flex h-full min-h-[172px] min-w-0 flex-col gap-3 p-4">
      <SubjectHead space={space} count={topics.length} />
      <ul className="-mx-1.5 flex flex-col">
        {shown.map((sub) => (
          <li key={sub.id}>
            <Link
              to={subspacePath(space, sub)}
              className="group flex min-h-11 min-w-0 items-center gap-2 rounded-[9px] px-1.5 py-1.5 transition-colors hover:bg-line-soft"
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[14.5px] font-semibold leading-snug text-ink">{sub.name}</span>
                <span className="block truncate text-[12px] text-muted">{countsLine(sub)}</span>
              </span>
              <span className="setcode shrink-0">{relativeShort(sub.last_activity_at)}</span>
            </Link>
          </li>
        ))}
      </ul>
      {(hidden > 0 || open) && topics.length > collapsed.length && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-auto min-h-9 cursor-pointer self-start rounded-[8px] px-1.5 text-[13px] font-semibold text-ink-3 transition-colors hover:bg-line-soft hover:text-ink"
        >
          {open ? 'Show fewer' : `+${hidden} more`}
        </button>
      )}
    </Card>
  )
}

const EMPTY_TOPIC = 'Nothing added yet'

function countsLine(sub: Subspace): string {
  const c = sub.counts ?? {}
  const bits: string[] = []
  if (c.docs) bits.push(`${c.docs} file${c.docs === 1 ? '' : 's'}`)
  if (c.cards) bits.push(`${c.cards} card${c.cards === 1 ? '' : 's'}`)
  if (c.quizzes) bits.push(`${c.quizzes} quiz${c.quizzes === 1 ? '' : 'zes'}`)
  if (c.notes) bits.push(`${c.notes} note${c.notes === 1 ? '' : 's'}`)
  return bits.length ? bits.join(' · ') : EMPTY_TOPIC
}

// ── This week ──────────────────────────────────────────────────────────

/**
 * The recap: three standing figures with the fortnight under them as
 * evidence, then what is coming due and what is fading — each
 * part shown only when it has something real in it, each with one link to
 * the exact deck, quiz or page. "Cards due now" lives in Up next, so it is
 * not repeated here; a fading topic that is already Up next's retake is
 * left out.
 */
function WeekSection({
  stats,
  statsPhase,
  topics,
  extra,
}: {
  stats: AsyncResult<Stats>
  statsPhase: SlowPhase
  topics: TopicEntry[]
  extra: HomeData
}) {
  const s = stats.loading ? null : stats.data
  const coming = comingDue(s)
  const fading = fadingTopics(extra.model, extra.index, { exclude: extra.retake?.quiz.subspace_id ?? null })
  const deck = busiestDeck(extra.index)
  const quizzesEntry = topics.find((e) => (e.subspace.counts?.quizzes ?? 0) > 0)
  const cardsEntry = topics.find((e) => (e.subspace.counts?.cards ?? 0) > 0) ?? topics[0]
  const parts = [coming, fading.length || extra.modelLoading ? 1 : null].filter(Boolean).length

  return (
    <section aria-labelledby="week-title" className="flex flex-col gap-6">
      <div className="flex items-baseline gap-3">
        <h2 id="week-title" className="nameplate text-[22px] text-ink">
          This week
        </h2>
        <Link to="/profile" className="setcode ml-auto transition-colors hover:text-ink">
          Your full record →
        </Link>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Figure
            icon="flame"
            label="Current streak"
            value={stats.loading ? null : `${stats.data?.streak_days ?? 0}`}
            unit={stats.data?.streak_days === 1 ? 'day' : 'days'}
            tone="brand"
            lit={(stats.data?.streak_days ?? 0) > 0}
            detail={
              (stats.data?.streak_days ?? 0) > 0
                ? 'Consecutive days with something logged.'
                : 'Log anything today to start one.'
            }
            countUp
          />
          <Figure
            icon="target"
            label="Quiz average"
            value={stats.loading ? null : stats.data?.quiz_average != null ? `${stats.data.quiz_average}` : '—'}
            unit={stats.data?.quiz_average != null ? '%' : ''}
            tone="sky"
            lit={(stats.data?.quiz_average ?? 0) >= 80}
            detail={stats.data?.quiz_average != null ? 'Across your last five.' : 'Take one to find out.'}
            to={quizzesEntry ? `${quizzesEntry.link}/quizzes` : undefined}
          />
          <Figure
            icon="clock"
            label="Study time"
            value={stats.loading ? null : `~${stats.data?.study_minutes_this_week ?? 0}`}
            unit="min"
            tone="mint"
            lit={(stats.data?.study_minutes_this_week ?? 0) > 0}
            detail="This week, estimated from what you completed."
          />
        </div>
        {stats.loading && <SlowCaption phase={statsPhase} onRetry={stats.refresh} />}
        {/* An all-stub chart says nothing. Appear once there is a day to show. */}
        {(stats.loading || (stats.data?.heatmap ?? []).slice(-14).some((c) => c.minutes > 0 || c.intensity > 0)) && (
          <Fortnight stats={stats.data} loading={stats.loading} />
        )}
      </div>

      {s && parts > 0 && (
        <div className={cn('grid gap-x-10 gap-y-7', parts >= 3 ? 'lg:grid-cols-3' : parts === 2 ? 'lg:grid-cols-2' : '')}>
          {coming && (
            <DueForecast
              days={s.due_forecast}
              action={
                deck
                  ? { label: `Open ${deck.name} (${deck.due} due)`, to: deck.href }
                  : { label: 'Open your cards', to: `${cardsEntry.link}/flashcards` }
              }
            />
          )}
          {(fading.length > 0 || extra.modelLoading) && <FadingList items={fading} loading={extra.modelLoading} />}
        </div>
      )}
    </section>
  )
}

/** Topics slipping, low or gone quiet — from the student model, each with its one fix. */
function FadingList({ items, loading }: { items: Fading[]; loading: boolean }) {
  return (
    <Ledger className="flex flex-col gap-3 pb-5">
      <div className="flex items-baseline justify-between">
        <span className="setcode-strong">Fading</span>
        <span className="setcode">from your quizzes</span>
      </div>
      {loading && items.length === 0 ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-10 rounded" />
          <Skeleton className="h-10 rounded" />
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((f) => (
            <li key={f.subspaceId} className="flex min-w-0 items-center gap-3 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-ink">{f.topic}</span>
                <span className="block truncate text-[12px] text-muted">
                  {f.subject} · {f.why}
                </span>
              </span>
              <Link
                to={f.action.to}
                className="flex min-h-10 shrink-0 items-center gap-1 rounded-[9px] border border-line px-2.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
              >
                {f.action.label}
                <Icon name="chevronRight" size={12} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Ledger>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────

/**
 * One measured figure on the standing rule.
 *
 * LEDGER, not cardstock — and deliberately not `foil`. The old `StandingCard`
 * gave a quiz average the sheen of a collectible, which is exactly the wrong
 * read: an average is not something you won, it is something you are measured
 * against. `.ruled` gives it a rule to sit on and tabular digits so the four
 * figures line up as a row rather than four boxes that happen to be adjacent.
 */
function Figure({
  icon,
  label,
  value,
  unit,
  tone,
  lit,
  detail,
  to,
  countUp = false,
}: {
  icon: IconName
  label: string
  value: string | null
  unit: string
  tone: Tone
  lit: boolean
  detail: string
  to?: string
  countUp?: boolean
}) {
  const numeric = countUp && value !== null ? Number(value) : NaN
  const body = (
    <div
      className={cn(
        'ruled group flex h-full flex-col gap-1.5 pb-3',
        to && 'cursor-pointer transition-colors hover:border-b-brand/50',
      )}
    >
      <span className="flex items-center gap-1.5">
        <Icon
          name={icon}
          size={13}
          filled={lit}
          className={lit ? toneText[tone] : 'text-faint'}
        />
        <span className="setcode">{label}</span>
      </span>

      {value === null ? (
        <Skeleton className="h-8 w-16 rounded" />
      ) : (
        <span className="flex items-baseline gap-1.5">
          {/* Only the streak counts up. Everything else snaps — a page of
              animating numbers reads as a slot machine, not a study app. */}
          {countUp && Number.isFinite(numeric) ? (
            <CountUp
              value={numeric}
              className={cn(
                'nameplate text-[38px] leading-none tabular-nums',
                lit ? toneText[tone] : 'text-ink-3',
              )}
            />
          ) : (
            <span
              className={cn(
                'nameplate text-[38px] leading-none tabular-nums',
                lit ? toneText[tone] : 'text-ink-3',
              )}
            >
              {value}
            </span>
          )}
          {unit && <span className="setcode">{unit}</span>}
        </span>
      )}

      <p className="mt-auto text-[12.5px] leading-snug text-muted">{detail}</p>
    </div>
  )
  return to ? <Link to={to} className="contents">{body}</Link> : body
}

/** Names the first topic of a subject that has none, then opens it. */
function FirstTopicField({ space }: { space: Space }) {
  const { addSubspace } = useSpaces()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const topic = name.trim()
    if (!topic) return setErr('Give the topic a short name.')
    setErr(null)
    setBusy(true)
    try {
      const sub = await addSubspace(space.id, topic)
      navigate(subspacePath(space, sub))
    } catch (e2) {
      setErr(friendlyMessage(e2))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex items-start gap-2" noValidate>
      <Input
        id={`first-topic-${space.id}`}
        aria-label={`First topic in ${space.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name your first topic"
        maxLength={LIMITS.subspaceName}
        autoComplete="off"
        error={err}
        hint={nameHint(name) ?? undefined}
        containerClassName="min-w-0 flex-1"
        className="py-2"
      />
      {/* Same label while busy so the button does not change width. */}
      <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy} className="shrink-0">
        Add
      </Button>
    </form>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────

function relativeShort(iso: string | null): string {
  if (!iso) return 'Not opened yet'
  const diff = Date.now() - Date.parse(iso)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'Just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}

/**
 * Cards falling due over the next seven days.
 *
 * This is the single strongest piece of evidence that the spaced repetition is
 * real rather than a label: the schedule is visible, and today's column is the
 * work in front of you. The data has always existed on every card as `due_at`
 * — it was simply never asked for beyond "how many are due right now".
 */
function DueForecast({ days, action }: { days?: ForecastDay[]; action?: { label: string; to: string } }) {
  // Defensive by design, not by superstition. This renders from a cached API
  // payload, and a cache written by an older deploy will not have this field —
  // that exact case took the whole of Home down behind the error boundary.
  // A dashboard panel with missing data should show nothing; it should never
  // be able to destroy the page around it.
  const safe = Array.isArray(days) ? days : []
  const peak = Math.max(1, ...safe.map((d) => d.count))
  const total = safe.reduce((n, d) => n + d.count, 0)

  /* Columns grow from the axis on first paint, left to right — the same beat
     the fortnight chart already uses, so the two charts on this page behave
     like one instrument rather than two widgets. */
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <Ledger className="flex flex-col gap-4 pb-5">
      <div className="flex items-baseline justify-between">
        <span className="setcode-strong">Coming up</span>
        <span className="setcode">next 7 days · {total} in all</span>
      </div>

      {total === 0 ? (
        <p className="text-[13.5px] text-muted">
          Nothing coming up yet. Review a card and it will show up here.
        </p>
      ) : (
        <div className="flex h-[104px] items-end gap-2">
          {safe.map((d, i) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'text-[12.5px] font-bold tabular-nums',
                  i === 0 ? 'text-brand' : 'text-faint',
                )}
              >
                {d.count || ''}
              </span>
              <span
                className={cn(
                  'w-full rounded-[3px] transition-[height] duration-300 ease-out motion-reduce:transition-none',
                  i === 0 ? 'bg-brand' : 'bg-line-dash',
                )}
                style={{
                  height: drawn
                    ? `${Math.max(d.count ? 6 : 2, (d.count / peak) * 72)}px`
                    : '2px',
                  transitionDelay: drawn ? `${i * 40}ms` : '0ms',
                }}
              />
              <span className={cn('setcode', i === 0 && 'text-brand')}>
                {i === 0 ? 'today' : dayLabel(d.day)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* The mechanic behind the chart, once. Dismissible by id, and placed
          under the bars rather than above them so it explains something the
          reader has already seen. */}
      {action && total > 0 && <LedgerAction {...action} />}
      <Tip id="home-forecast-v1" icon="clock">
        Cards don't all come back at once. Today's bar is what's waiting now.
        The rest is coming up, so you can see a busy day early.
      </Tip>
    </Ledger>
  )
}

/** Weekday initial for a forecast column. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? ''
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
}

/** The one link at the foot of a recap ledger. */
function LedgerAction({ label, to }: { label: string; to: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-10 items-center gap-1 self-start rounded-[9px] border border-line px-2.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
    >
      <span className="truncate">{label}</span>
      <Icon name="chevronRight" size={12} className="shrink-0" />
    </Link>
  )
}

// `Stats` is referenced by the async hook's generic inference above.
export type { Stats }

/**
 * Home while `/spaces` is in flight.
 *
 * Deliberately shaped like neither outcome. It carries a heading block and a
 * row of figures because *most* accounts land on the dashboard, but nothing in
 * it commits to content — showing a real headline here is what produced the
 * flash this replaces.
 *
 * `phase` (from `useSlowState`) is what keeps this honest past the first
 * couple of seconds: Render's free tier cold-starts in ~30-60s, and a
 * skeleton that never changes across that whole span reads as broken, not
 * slow — see that hook's own doc comment.
 */
function HomeSkeleton({ phase, onRetry }: { phase: SlowPhase; onRetry: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-busy="true">
      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 py-7 sm:px-7 sm:py-9">
        <div className="flex flex-col gap-3 pb-8">
          <Skeleton className="h-11 w-2/3 max-w-md rounded-lg" />
          <Skeleton className="h-4 w-1/2 max-w-sm rounded" />
          <WaitingNova phase={phase} onRetry={onRetry} className="mt-1" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32 rounded" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[124px] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
