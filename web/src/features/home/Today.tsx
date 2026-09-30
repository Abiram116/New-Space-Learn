/**
 * Today — Home on a phone.
 *
 * A phone is where people revise: on a bus, between lectures, five minutes
 * before bed. So this is not the desktop dashboard squeezed; it answers one
 * question — "what should I do right now?" — with one big action a thumb can
 * reach, and keeps everything else small:
 *
 *   - a greeting and the personalised brief (same cache as desktop)
 *   - ONE primary action: due cards, else the decision engine's pick routed
 *     for a phone, else a quiz, notes, or adding material
 *   - two quiet rows: a quiz worth retaking, the note touched last
 *   - streak, today's goal and the week, as marks rather than charts
 *
 * Coming back after a week or more is its own state: a warm line and a small
 * first chunk of the backlog ("Start with 10 of your 46 cards") with the rest
 * one tap away, instead of a number that reads as a debt.
 *
 * With nothing added yet it leads with adding material, and is honest that
 * the tutor and deep note-writing live on a bigger screen.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { listAllNotes } from '../../api/notes'
import { listAllQuizzes } from '../../api/quizzes'
import type { Brief, Space, Stats } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon, type IconName } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { useReducedMotion } from '../../components/ui/motion'
import { useToast } from '../../components/ui/Toast'
import { SlowCaption, StaleNotice } from '../../lib/AsyncState'
import { cn } from '../../lib/cn'
import { subspacePath } from '../../lib/nav'
import { useAsync, type AsyncResult } from '../../lib/useAsync'
import { useSlowState, type SlowPhase } from '../../lib/useSlowState'
import { Bot } from '../../components/mascot/Bot'
import { useCachedStudentModel } from '../onboarding/StyleIntakeCard'
import { useSpaces } from '../spaces/SpacesProvider'
import { NovaBeside, NovaHello, briefIsGreeting } from './Greeting'
import { appUrl, sendLink, shareMessage } from './share'
import {
  chooseTodayAction,
  daysSinceActive,
  firstNameOf,
  greeting,
  hasNoMaterial,
  isComebackToday,
  lastSevenDays,
  markComebackToday,
  pickRecentNote,
  pickRetake,
  planReview,
  topicsByRecency,
  type TodayAction,
  type TopicEntry,
} from './today'

export function Today({
  stats,
  brief,
}: {
  stats: AsyncResult<Stats>
  brief: AsyncResult<Brief>
}) {
  const { spaces, loading, error, refresh } = useSpaces()
  const { user } = useAuth()
  const model = useCachedStudentModel()
  const spacesPhase = useSlowState(loading)
  const briefPhase = useSlowState(brief.loading)

  const topics = useMemo(() => topicsByRecency(spaces), [spaces])
  const s = stats.data
  const daysAway = daysSinceActive(s?.heatmap)
  const [comeback] = useState(() => isComebackToday())
  const plan = planReview({
    due: s?.cards_due ?? 0,
    daysAway,
    sessionMinutes: model?.session_length_minutes,
    inComeback: comeback,
  })
  // Once a comeback has started, the rest of the day keeps chunking — ten
  // done should land on "ten more", not on the remaining 36 in one lump.
  useEffect(() => {
    if (plan.welcomeBack && plan.capped) markComebackToday()
  }, [plan.welcomeBack, plan.capped])

  const name = firstNameOf(
    (user?.user_metadata?.display_name as string | undefined) || user?.email?.split('@')[0],
  )
  const hello = `${greeting()}${name ? `, ${name}` : ''}.`

  if (error && !loading) {
    return (
      <Page>
        <EmptyState
          icon="offline"
          title="Couldn't load Today"
          bot={{ agent: 'tutor', say: 'error', mood: 'oops' }}
          description={error}
          action={
            <Button size="lg" onClick={() => void refresh()}>
              <Icon name="refresh" size={14} /> Retry
            </Button>
          }
        />
      </Page>
    )
  }
  if (loading) return <TodaySkeleton phase={spacesPhase} onRetry={() => void refresh()} />

  if (spaces.length === 0 || topics.length === 0) {
    return (
      <Page>
        <NovaBeside size={52}>
          <h1 className="nameplate text-[clamp(24px,min(7.2vw,9vh),32px)] leading-[1.04] text-ink">{hello}</h1>
        </NovaBeside>
        <FirstTopic spaces={spaces} />
        <DesktopNote />
      </Page>
    )
  }

  const action = chooseTodayAction({ topics, stats: s ?? null, suggestion: brief.data?.suggestion, plan })
  const welcome = plan.welcomeBack && (s?.cards_due ?? 0) > 0
  const briefGreets = !welcome && briefIsGreeting(brief.data?.headline, name)
  const empty = !stats.loading && hasNoMaterial(topics, s ?? null)

  return (
    <Page>
      <header className="flex flex-col gap-2">
        {/* The brief is usually a greeting already ("Good evening, Abiram");
            when it is, it is the heading and Nova just waves beside it.
            Otherwise Nova says hello and the brief's headline sits under it —
            never both saying hello. */}
        {!briefGreets && <NovaHello name={name} phase={brief.loading ? briefPhase : undefined} size={44} />}
        {brief.loading ? (
          <div className="flex flex-col gap-2 pt-1">
            <Skeleton className="h-8 w-4/5 rounded-lg" />
            <Skeleton className="h-4 w-3/5 rounded" />
            <SlowCaption phase={briefPhase} onRetry={brief.refresh} />
          </div>
        ) : (
          <>
            {briefGreets ? (
              <NovaBeside size={52}>
                <h1 className="nameplate text-[clamp(24px,min(7.2vw,9vh),32px)] leading-[1.04] text-ink">
                  {brief.data?.headline}
                </h1>
              </NovaBeside>
            ) : (
              <h1 className="nameplate text-[clamp(24px,min(7.2vw,9vh),32px)] leading-[1.04] text-ink">
                {welcome ? 'Welcome back' : (brief.data?.headline ?? 'Ready when you are')}
              </h1>
            )}
            <p className="text-[16px] leading-relaxed text-ink-3">
              {welcome
                ? 'Good to see you. No need to clear everything at once — a few minutes today is plenty to get going again.'
                : brief.data?.body}
            </p>
          </>
        )}
        {brief.error && <StaleNotice onRetry={brief.refresh} />}
      </header>

      {empty ? (
        <>
          <PrimaryAction
            label="Add material"
            detail={`Photos or files, into ${topics[0].subspace.name}`}
            href={`${topics[0].link}/docs?add=1`}
            icon="upload"
          />
          <DesktopNote />
        </>
      ) : stats.loading && !s ? (
        <Skeleton className="h-[116px] rounded-[20px]" />
      ) : action ? (
        <div className="flex flex-col gap-2">
          <PrimaryAction
            label={action.label}
            detail={actionDetail(action)}
            href={action.href}
            icon={ACTION_ICON[action.kind]}
          />
          {action.kind === 'review' && action.plan.capped && (
            <Link
              to={`${action.href.split('?')[0]}?review=due`}
              className="flex min-h-11 items-center justify-center gap-1.5 text-[15px] font-semibold text-ink-3"
            >
              Review all {action.plan.total} instead
              <Icon name="chevronRight" size={14} />
            </Link>
          )}
          {action.kind === 'suggestion' && action.detail && (
            <p className="px-1 text-[14px] leading-snug text-muted">{action.detail}</p>
          )}
        </div>
      ) : null}

      {!empty && <Rhythm stats={s ?? null} loading={stats.loading} />}
      {stats.error && !stats.loading && <StaleNotice onRetry={stats.refresh} />}

      {!empty && <MoreRows topics={topics} spaces={spaces} />}
    </Page>
  )
}

const ACTION_ICON: Record<TodayAction['kind'], IconName> = {
  review: 'deck',
  suggestion: 'target',
  quiz: 'quiz',
  notes: 'note',
  material: 'upload',
}

function actionDetail(a: TodayAction): string {
  if (a.kind === 'review') return a.detail
  if (a.kind === 'suggestion') return 'Picked from how your quizzes are going'
  return a.detail
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-10 pt-5">{children}</div>
    </div>
  )
}

/**
 * The one thing to do. A slab of the brand colour, full width, tall enough to
 * hit without looking — the only filled surface on the screen, so there is no
 * question which one it is.
 */
function PrimaryAction({
  label,
  detail,
  href,
  icon,
}: {
  label: string
  detail: string
  href: string
  icon: IconName
}) {
  return (
    <Link
      to={href}
      className="group relative flex min-h-[116px] flex-col justify-between gap-3 overflow-hidden rounded-[20px] bg-brand px-5 py-4 text-[#1a120f] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_0_#a8331d,0_14px_30px_-14px_rgba(255,90,60,0.7)] transition-transform duration-150 active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_1px_0_#a8331d]"
    >
      <Icon name={icon} size={20} className="opacity-80" />
      <span className="flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="nameplate block text-[clamp(20px,5.8vw,24px)] leading-[1.08]">{label}</span>
          <span className="mt-1 block text-[14.5px] font-semibold leading-snug text-[#1a120f]/75">{detail}</span>
        </span>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#1a120f]/12 transition-transform duration-150 group-active:translate-x-0.5">
          <Icon name="arrowRight" size={18} />
        </span>
      </span>
    </Link>
  )
}

/**
 * Streak, today's goal and the week — marks, not charts. The ring is the one
 * shape here because "8 of 20" is a proportion, and a proportion is read
 * fastest as a filled arc.
 */
function Rhythm({ stats, loading }: { stats: Stats | null; loading: boolean }) {
  const reduced = useReducedMotion()
  const [drawn, setDrawn] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  if (loading && !stats) {
    return <Skeleton className="h-[92px] rounded-xl" />
  }
  const streak = stats?.streak_days ?? 0
  const goal = Math.max(1, stats?.daily_goal ?? 20)
  const doneToday = stats?.cards_reviewed_today ?? 0
  const pct = Math.min(1, doneToday / goal)
  const week = lastSevenDays(stats?.heatmap)
  const R = 17
  const C = 2 * Math.PI * R

  return (
    <section aria-label="Your rhythm" className="ruled flex flex-col gap-4 pb-4">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Icon name="flame" size={20} filled={streak > 0} className={streak > 0 ? 'text-brand' : 'text-faint'} />
          <span className="min-w-0">
            <span className="block text-[17px] font-semibold tabular-nums text-ink">
              {streak} day{streak === 1 ? '' : 's'}
            </span>
            <span className="block text-[13px] text-muted">{streak > 0 ? 'streak' : 'study today to start one'}</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden className="-rotate-90">
            <circle cx="22" cy="22" r={R} fill="none" strokeWidth="5" className="stroke-line" />
            <circle
              cx="22"
              cy="22"
              r={R}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className={pct >= 1 ? 'stroke-mint' : 'stroke-sun'}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - (drawn ? pct : 0))}
              style={{ transition: reduced ? undefined : 'stroke-dashoffset 700ms var(--ease-sl)' }}
            />
          </svg>
          <span>
            <span className="block text-[17px] font-semibold tabular-nums text-ink">
              {doneToday}/{goal}
            </span>
            <span className="block text-[13px] text-muted">cards today</span>
          </span>
        </div>
      </div>
      <ol className="flex justify-between gap-1" aria-label="Last seven days">
        {week.map((d) => (
          <li key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={cn(
                'h-2.5 w-2.5 rounded-full',
                d.active ? 'bg-brand' : 'bg-line',
                d.today && !d.active && 'ring-1 ring-brand/60 ring-offset-2 ring-offset-canvas',
              )}
            />
            <span className={cn('text-[12px] font-semibold', d.today ? 'text-brand' : 'text-faint')}>
              {d.label}
              <span className="sr-only">{d.active ? ' — studied' : ' — no study'}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * The quiet second tier: a quiz worth another go and the note touched last.
 * Each row loads only when the topic counts say there is something to find —
 * an account with no quizzes never asks for the quiz list.
 */
function MoreRows({ topics, spaces }: { topics: TopicEntry[]; spaces: Space[] }) {
  const anyQuizzes = topics.some((t) => (t.subspace.counts?.quizzes ?? 0) > 0)
  const anyNotes = topics.some((t) => (t.subspace.counts?.notes ?? 0) > 0)
  if (!anyQuizzes && !anyNotes) return null
  return (
    <section aria-label="Also worth a look" className="flex flex-col">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {anyQuizzes && <RetakeRow spaces={spaces} />}
        {anyNotes && <NoteRow spaces={spaces} />}
      </div>
    </section>
  )
}

function baseFor(spaces: Space[], subspaceId: string | null | undefined): string | null {
  if (!subspaceId) return null
  for (const s of spaces) {
    const sub = s.subspaces.find((x) => x.id === subspaceId)
    if (sub) return subspacePath(s, sub)
  }
  return null
}

function RetakeRow({ spaces }: { spaces: Space[] }) {
  const quizzes = useAsync(() => listAllQuizzes(), [], 'quizzes:all')
  const quiz = pickRetake(quizzes.data)
  if (quizzes.loading && !quizzes.data) return <RowSkeleton />
  if (!quiz) return null
  const base = baseFor(spaces, quiz.subspace_id)
  if (!base) return null
  return (
    <Row
      to={`${base}/quizzes?q=${quiz.id}`}
      icon="quiz"
      tone="text-coral"
      title={`Retake: ${quiz.topic || quiz.subspace_name || 'quiz'}`}
      meta={`Best ${quiz.best_score}%${quiz.attempts && quiz.attempts > 1 ? ` · ${quiz.attempts} tries` : ''}`}
    />
  )
}

function NoteRow({ spaces }: { spaces: Space[] }) {
  const notes = useAsync(() => listAllNotes(), [], 'notes:all')
  const note = pickRecentNote(notes.data)
  if (notes.loading && !notes.data) return <RowSkeleton />
  if (!note) return null
  const base = baseFor(spaces, note.subspace_id)
  if (!base) return null
  return (
    <Row
      to={`${base}/notes?n=${note.id}`}
      icon="note"
      tone="text-ink-3"
      title={note.title || 'Untitled note'}
      meta={`Edited ${relative(note.updated_at)}${note.subspace_name ? ` · ${note.subspace_name}` : ''}`}
    />
  )
}

function Row({
  to,
  icon,
  tone,
  title,
  meta,
}: {
  to: string
  icon: IconName
  tone: string
  title: string
  meta: string
}) {
  return (
    <Link
      to={to}
      className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 active:bg-line-soft"
    >
      <Icon name={icon} size={18} className={cn('shrink-0', tone)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold text-ink">{title}</span>
        <span className="block truncate text-[13.5px] text-muted">{meta}</span>
      </span>
      <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
    </Link>
  )
}

function RowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Skeleton className="h-5 w-5 rounded" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-2/3 rounded" />
        <Skeleton className="h-3 w-1/3 rounded" />
      </div>
    </div>
  )
}

function relative(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff)) return 'recently'
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return day === 1 ? 'yesterday' : `${day}d ago`
}

/**
 * No topic yet: name one right here, then straight to adding material.
 *
 * A brand-new account names a subject and, optionally, the first topic in it
 * (the topic defaults to the subject's name — material has to live in a topic,
 * and asking someone on a phone to understand that distinction before they've
 * added anything is the wrong order). An account with a subject but no topic
 * is only asked for the topic.
 */
function FirstTopic({ spaces }: { spaces: Space[] }) {
  const { createSpace, addSubspace } = useSpaces()
  const navigate = useNavigate()
  const { showError } = useToast()
  const existing = spaces[0] ?? null
  const [subject, setSubject] = useState('')
  const [topic, setTopic] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const subj = subject.trim()
    const top = topic.trim()
    if (!existing && !subj) return setErr('Give it a short name — you can rename it later.')
    if (existing && !top) return setErr('Give the topic a short name.')
    setBusy(true)
    try {
      const space = existing ?? (await createSpace({ name: subj, tone: 'brand' }))
      const sub = await addSubspace(space.id, top || subj)
      navigate(`${subspacePath(space, sub)}/docs?add=1`)
    } catch (e2) {
      showError(e2)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-[16px] leading-relaxed text-ink-3">
        {existing
          ? `Add a first topic to ${existing.name}, then bring in your material — a photo of your notes works.`
          : 'Name what you’re studying, then bring in your material — a photo of your notes works.'}
      </p>
      {!existing && (
        <label className="flex flex-col gap-1.5">
          <span className="setcode">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Biology"
            maxLength={80}
            enterKeyHint="next"
            autoComplete="off"
            className="min-h-12 rounded-[12px] border border-line bg-well px-3.5 text-[16px] text-ink outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
          />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="setcode">{existing ? 'Topic' : 'First topic (optional)'}</span>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Cell respiration"
          maxLength={80}
          enterKeyHint="go"
          autoComplete="off"
          className="min-h-12 rounded-[12px] border border-line bg-well px-3.5 text-[16px] text-ink outline-none placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
      </label>
      {err && <p className="text-[14px] font-semibold text-coral-deep">{err}</p>}
      <Button type="submit" size="xl" disabled={busy} aria-busy={busy} className="w-full">
        {busy ? 'Creating…' : 'Next: add material'}
        {!busy && <Icon name="arrowRight" size={16} />}
      </Button>
    </form>
  )
}

/**
 * The honest line about what a phone is for, and a way to take the rest to a
 * desk. Not an upsell: the tutor genuinely needs a keyboard and room to read.
 */
export function DesktopNote() {
  const { show } = useToast()
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    const url = appUrl()
    const outcome = await sendLink({ title: 'Space Learn', url })
    const msg = shareMessage(outcome, url)
    if (msg) show(msg.text, msg.kind)
    setBusy(false)
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <Icon name="chat" size={18} className="mt-0.5 shrink-0 text-sky" />
        <p className="text-[15px] leading-relaxed text-ink-3">
          On your phone, Space Learn is for revising: cards, quizzes and reading your notes.
          The chat tutor and deep note-writing are on a computer, where there’s room for them.
        </p>
      </div>
      <Button variant="secondary" size="lg" onClick={() => void send()} disabled={busy} className="min-h-12 w-full">
        <Icon name="send" size={15} /> Send myself the link
      </Button>
    </section>
  )
}

function TodaySkeleton({ phase, onRetry }: { phase: SlowPhase; onRetry: () => void }) {
  return (
    <Page>
      <div aria-busy="true" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-9 w-3/4 rounded-lg" />
          <Skeleton className="h-4 w-5/6 rounded" />
          <WaitingNova phase={phase} onRetry={onRetry} />
        </div>
        <Skeleton className="h-[116px] rounded-[20px]" />
        <Skeleton className="h-[92px] rounded-xl" />
      </div>
    </Page>
  )
}

/**
 * The skeleton's wait, once it is worth naming: Nova thinking (then asleep,
 * once it has stalled) beside the same caption every screen uses. Nothing
 * for an ordinary sub-3s load — a character flashing past is noise.
 */
export function WaitingNova({ phase, onRetry, className }: { phase: SlowPhase; onRetry: () => void; className?: string }) {
  if (phase !== 'slow' && phase !== 'stalled') return null
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <Bot agent="tutor" mood={phase === 'stalled' ? 'sleepy' : 'thinking'} size={40} />
      <SlowCaption phase={phase} onRetry={onRetry} />
    </div>
  )
}
