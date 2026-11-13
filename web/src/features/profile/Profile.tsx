/**
 * Profile — the student's own record, and what to do about it.
 *
 * The page is laid out to be read in one pass: who you are and what you have
 * built across the top, three figures each measured against something beside
 * them, then two columns — what to work on next (the part worth acting on, so
 * it leads and every row carries one action) and the record itself (activity
 * and badges).
 *
 * Every number comes from `/me/stats` or `/me/student-model`; nothing here is
 * estimated in the browser. Delete-account and sign-out live in Settings.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getStudentModel } from '../../api/me'
import { listAllDecks } from '../../api/flashcards'
import { listAllQuizzes } from '../../api/quizzes'
import type { Badge, Deck, Quiz, Space, Stats, StudentModel, Subspace, TopicSignal } from '../../api/types'
import { useAuth } from '../../auth/AuthProvider'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { useToast } from '../../components/ui/Toast'
import { Icon3D } from '../../components/ui/Icon3D'
import { Icon, type IconName } from '../../components/ui/Icon'

import { Skeleton } from '../../components/ui/Skeleton'
import { Ledger } from '../../components/ui/Surface'
import { getCachedStats } from '../../lib/briefCache'
import { useAsync, type AsyncResult } from '../../lib/useAsync'
import { SlowCaption, StaleNotice } from '../../lib/AsyncState'
import { useSlowState, type SlowPhase } from '../../lib/useSlowState'
import { cn } from '../../lib/cn'
import { subspacePath } from '../../lib/nav'
import { useReducedMotion } from '../../components/ui/motion'
import { useIsMobile } from '../../lib/useIsMobile'
import { NAME_MAX } from '../onboarding/steps'
import { useSpaces } from '../spaces/SpacesProvider'
import { toneBar, toneSoft, toneText } from '../../lib/tone'

/** Heatmap steps, warm→hot, so a dense week reads at a glance. */
const INTENSITY = ['bg-line-soft', 'bg-brand/25', 'bg-brand/55', 'bg-brand']

/** How many weak topics get a row. More than this stops being a plan. */
const FOCUS_LIMIT = 3

export function Profile() {
  const phone = useIsMobile()
  const { user, setDisplayName } = useAuth()
  const navigate = useNavigate()
  const { showError } = useToast()
  const { spaces } = useSpaces()
  // Weak topics arrive as a topic id; the address is built from the subject
  // and topic the rail already holds, the same way every other screen does.
  // The quizzes and decks themselves, so a row opens the exact quiz or deck
  // to work on rather than a topic's list. Same cache keys as the Quizzes and
  // Flashcards pages, so neither is fetched twice.
  const quizzes = useAsync(() => listAllQuizzes(), [], 'quizzes:all')
  const decks = useAsync(() => listAllDecks(), [], 'decks:all')
  const topics = useMemo(
    () => indexTopics(spaces, quizzes.data ?? [], decks.data ?? []),
    [spaces, quizzes.data, decks.data],
  )
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Shared cache with Home — Profile was refetching the same payload on
  // every visit, which is the exact back-navigation cost fixed elsewhere.
  const stats = useAsync(() => getCachedStats(), [])
  // The 2026-08 UX audit found this data computed and already exposed via
  // `/me/student-model` — real quiz-derived weak topics, not a guess — but
  // rendered only in Settings, nowhere on the page that's actually meant to
  // be the student's own record. A second read of the same endpoint, not a
  // new one; Settings fetches it separately with a plain effect, so this
  // doesn't touch that page at all.
  const student = useAsync(() => getStudentModel(), [], 'student-model')
  // Cold-start awareness — see `useSlowState`'s own doc comment. Both loads
  // run in parallel against the same possibly-cold backend.
  const statsPhase = useSlowState(stats.loading)
  const studentPhase = useSlowState(student.loading)

  const displayName =
    (user?.user_metadata?.display_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'You'
  const initials = displayName.slice(0, 2).toUpperCase()
  const email = user?.email ?? ''
  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      })
    : ''

  // Closing the field unmounts it, and a browser blurs a focused input as it
  // is removed — which runs `commitName` again. So Escape saved the name it
  // was meant to throw away, and Enter saved twice. The field only commits
  // while it is live: from the pencil until the first Enter, blur or Escape.
  const nameFieldLive = useRef(false)

  const commitName = async () => {
    if (!nameFieldLive.current) return
    nameFieldLive.current = false
    const name = draft.trim()
    setEditing(false)
    if (!name || name === displayName) return
    try {
      await setDisplayName(name)
    } catch (err) {
      showError(err)
    }
  }

  const d = stats.data
  const earnedCount = d ? d.badges.filter((b) => b.earned).length : 0
  // Nothing made yet: the page says what it will become rather than showing
  // a wall of zeroes with no explanation.
  const brandNew = Boolean(d && d.spaces_count === 0 && d.docs_indexed === 0)
  const statsFailed = !d && !stats.loading && Boolean(stats.error)
  const showRecord = stats.loading || Boolean(d)
  const hasStyle = (student.data?.style_summaries?.length ?? 0) > 0

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* A reading width, not the whole monitor. At full width every figure
          sat a screen away from its label. `@container` because the page lives
          beside a rail that opens and closes: the two-column split has to
          follow the room the page actually has, not the window. */}
      <div className="@container mx-auto w-full max-w-[72rem] px-4 py-7 sm:px-8">
      <div className="flex flex-col gap-6">
        {/* Identity */}
        <header className="flex flex-wrap items-start gap-4">
          {/* A seal, not a coloured square.
              The flat brand tile read as a placeholder avatar waiting for a
              photo upload that this app does not have. A foil seal is a thing
              this product already means something by — it is what a badge is
              — so the identity mark belongs to the same world as the record
              underneath it. The ring and inner glow give it depth without a
              drop shadow, which `Ledger` surfaces never use. */}
          {/* It behaves like foil, because that is what it is.
              A static disc is a placeholder avatar whether or not it is
              drawn well. This one has a highlight that travels slowly across
              it — the same tilt-sheen a real foil card throws, at room speed
              rather than animation speed — and an orbiting ring that marks it
              as the one earned object on the page you did not have to unlock.
              Transform and opacity only, so it composites off the main
              thread; both stop dead under reduced motion, leaving the drawn
              seal exactly as it was. */}
          <span className="group relative grid h-16 w-16 shrink-0 place-items-center">
            <span
              aria-hidden
              className="absolute -inset-1 rounded-full border border-brand/25 opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-safe:animate-[sealOrbit_9s_linear_infinite]"
            />
            <span
              aria-hidden
              className="absolute inset-0 overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_25%,var(--color-brand-300),var(--color-brand)_55%,var(--color-brand-deep))] ring-1 ring-brand/40 transition-transform duration-500 group-hover:scale-[1.04]"
            >
              <span
                aria-hidden
                className="absolute inset-0 motion-safe:animate-[sealSheen_7s_ease-in-out_infinite]"
                style={{
                  background:
                    'linear-gradient(115deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%)',
                  backgroundSize: '260% 260%',
                }}
              />
            </span>
            <span
              aria-hidden
              className="absolute inset-[3px] rounded-full ring-1 ring-[rgba(255,237,220,0.25)]"
            />
            <span className="relative nameplate text-[21px] leading-none text-[#1a120f]">
              {initials}
            </span>
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName()
                  if (e.key === 'Escape') {
                    nameFieldLive.current = false
                    setEditing(false)
                  }
                }}
                aria-label="Your name"
                maxLength={NAME_MAX}
                className="nameplate w-full max-w-md rounded-[10px] border border-brand/50 bg-well px-2.5 py-1 text-[clamp(24px,3.6vw,34px)] leading-tight text-ink outline-none"
              />
            ) : (
              <h1 className="group flex min-w-0 items-center gap-2">
                {/* A phone has the width to itself here — wrap rather than cut
                    the name to "ABIR…". */}
                <span
                  className={cn(
                    'nameplate text-[clamp(26px,4vw,38px)] leading-none text-ink',
                    phone ? 'min-w-0 break-words leading-[1.05]' : 'truncate',
                  )}
                >
                  {displayName}
                </span>
                {/* Edit lives on the name itself rather than in a settings
                    round-trip — this is the one field on the page that is
                    yours to change, so it should be changeable where you
                    read it. */}
                <button
                  type="button"
                  onClick={() => {
                    nameFieldLive.current = true
                    setDraft(displayName)
                    setEditing(true)
                  }}
                  aria-label="Rename yourself"
                  title="Rename yourself"
                  className="grid h-10 w-10 max-md:h-11 max-md:w-11 shrink-0 place-items-center rounded-[10px] text-muted transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
                >
                  <Icon name="pencil" size={16} />
                </button>
              </h1>
            )}
            <p className="mt-1 truncate text-[13px] text-muted">
              {email}
              {joined ? ` · studying since ${joined}` : ''}
            </p>
            {/* What exists because you made it. Counts of things you own have
                no target to be measured against, so they stay plain figures
                beside the name rather than taking a band of their own. */}
            {d && !brandNew && (
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                <Built value={d.spaces_count} one="subject" many="subjects" />
                <Built value={d.docs_indexed} one="source" many="sources" />
                <Built value={earnedCount} one="badge" many="badges" />
              </p>
            )}
          </div>
          {/* Only one action here. Profile is where you read your record;
              signing out lives with the account it belongs to, in Settings. */}
          {!phone && (
            <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>
              <Icon name="settings" size={14} /> Settings
            </Button>
          )}
        </header>

        {/* On a phone this page is the "You" tab, and Settings is a row in it —
            a full-width target under the thumb rather than a small chip beside
            the name. */}
        {phone && (
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left active:bg-line-soft"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-raised text-ink-3">
              <Icon name="settings" size={15} />
            </span>
            <span className="min-w-0 flex-1 text-[16px] font-medium text-ink">Settings</span>
            <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
          </button>
        )}

        {stats.loading && <SlowCaption phase={statsPhase} onRetry={stats.refresh} />}
        {/* A refresh failed but the last figures are still here: keep them and
            say so, rather than replacing a page of real numbers with an error. */}
        {d && stats.error && <StaleNotice onRetry={stats.refresh} />}

        {statsFailed && (
          <Problem
            title="Your record didn't load"
            message={stats.error ?? ''}
            onRetry={stats.refresh}
          />
        )}

        {brandNew && (
          <EmptyState
            className="py-9!"
            icon="seal"
            title="Nothing recorded yet"
            description="This is where your streak, badges and study history collect. Make a subject, add a topic, and the page starts filling itself in."
            action={<Button onClick={() => navigate('/home')}>Go to Home</Button>}
          />
        )}

        {/* ── Standing ─────────────────────────────────────────────────
            Three figures, each printed next to the thing it is measured
            against. A streak of 3 against a best of 3 is a different sentence
            from 3 against a best of 12, so the reference is named in words and
            sits in the same tile as the number — not at the far end of a bar
            the width of the page, which is where it used to be. */}
        {showRecord && (
          <section aria-labelledby="profile-standing" className="flex flex-col gap-3">
            <SectionHead id="profile-standing" title="Standing" note="against your own best" />
            <div className="grid grid-cols-3 gap-2.5 @2xl:gap-4">
              {!d ? (
                [0, 1, 2].map((i) => <Skeleton key={i} className="h-[7.25rem] rounded-xl" />)
              ) : (
                <>
                  <Measure
                    icon="flame"
                    label="Current streak"
                    short="Streak"
                    value={d.streak_days}
                    against={Math.max(d.max_streak, 1)}
                    unit={d.streak_days === 1 ? 'day' : 'days'}
                    reference={d.max_streak > 0 ? `best ${d.max_streak}` : 'no record yet'}
                    tone="sun"
                  />
                  <Measure
                    icon="deck"
                    label="Reviewed this week"
                    short="This week"
                    value={d.composition?.cards_reviewed ?? 0}
                    /* `daily_goal` is cards per day (see Settings), so the only
                       honest weekly reference is cards reviewed against it.
                       Minutes show plainly, with no invented goal, under
                       Activity. */
                    against={Math.max(d.daily_goal * 7, 1)}
                    unit="cards"
                    reference={`goal ${d.daily_goal * 7}`}
                    tone="sky"
                  />
                  <Measure
                    icon="target"
                    label="Quiz average"
                    short="Quiz avg"
                    value={d.quiz_average ?? 0}
                    against={100}
                    unit={d.quiz_average != null ? '%' : ''}
                    reference={d.quiz_average != null ? 'of 100' : 'none taken yet'}
                    empty={d.quiz_average == null}
                    tone="mint"
                  />
                </>
              )}
            </div>
          </section>
        )}

        <div
          className={cn(
            'grid gap-6 @4xl:items-start',
            (showRecord || hasStyle) && '@4xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]',
          )}
        >
          <div className="flex min-w-0 flex-col gap-6">
            <Focus
              student={student}
              phase={studentPhase}
              topics={topics}
              brandNew={brandNew}
            />

            {/* Activity is a Ledger: six months of your own days is a thing
                you are measured against. Badges below are a Card, because a
                badge is a thing you own. `border-b-0`: the ledger's closing
                rule would underline nothing here. */}
            {showRecord && (
                <Ledger className="flex flex-col gap-3 border-b-0">
                  <SectionHead
                    title="Activity"
                    note={d ? `${d.study_minutes_this_week} min this week` : 'last 26 weeks'}
                  />
                  {!d ? (
                    <Skeleton className="h-28 rounded-lg" />
                  ) : d.heatmap.length === 0 ? (
                    /* No days at all is an answer, not a load in progress — this
                       used to render a skeleton that never resolved. */
                    <p className="rounded-xl border border-dashed border-line-dash bg-well/40 px-4 py-5 text-[13.5px] leading-relaxed text-muted">
                      No study days recorded yet. Each day you review cards, take a quiz or
                      chat with a topic fills in a square here.
                    </p>
                  ) : (
                    <>
                      <div className="max-w-[40rem]">
                        <Heatmap cells={d.heatmap} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="setcode">Less</span>
                        <div className="flex gap-1">
                          {INTENSITY.map((c) => (
                            <span key={c} className={cn('h-2.5 w-2.5 rounded-[3px]', c)} />
                          ))}
                        </div>
                        <span className="setcode">More</span>
                        {/* The scale is relative to your OWN busiest day in this
                            window, not a fixed number of minutes. */}
                        <span className="text-[12.5px] text-faint">relative to your busiest day here</span>
                      </div>
                    </>
                  )}
                  {d && <WeekMix composition={d.composition} />}
                </Ledger>
            )}

          </div>

          {(showRecord || hasStyle) && (
            <div className="flex min-w-0 flex-col gap-6">
              {showRecord && (
                <Card className="@container flex flex-col gap-3.5 p-4 sm:p-5">
                  <SectionHead
                    title="Badges"
                    note={d ? `${earnedCount} of ${d.badges.length} earned` : undefined}
                  />
                  {!d ? (
                    <div className="flex flex-col gap-2.5">
                      {[0, 1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-12 rounded-lg" />
                      ))}
                    </div>
                  ) : d.badges.length === 0 ? (
                    <p className="text-[13.5px] leading-relaxed text-muted">No badges to show yet.</p>
                  ) : (
                    <ul className="grid gap-x-6 @xl:grid-cols-2">
                      {d.badges.map((b) => (
                        <BadgeRow key={b.id} badge={b} />
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {/* The teaching-strategy bandit's own read-only summary — only once
                  a subject has cleared the evidence floor server-side. An empty
                  list means nothing has enough evidence yet, so the section is
                  absent rather than padded with a guess. */}
              {hasStyle && (
                <section aria-labelledby="profile-style" className="flex flex-col gap-3">
                  <SectionHead id="profile-style" title="How you learn best" note="by subject" />
                  <ul className="flex flex-col">
                    {student.data?.style_summaries?.map((s, i) => (
                      <li
                        key={i}
                        className="flex flex-col gap-0.5 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0"
                      >
                        <span className="text-[14px] font-bold text-ink">{s.subject}</span>
                        <span className="text-[13.5px] leading-snug text-muted">{s.strategy_summary}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

/** A section's title with its small print beside it — never across the page. */
function SectionHead({ id, title, note }: { id?: string; title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className="nameplate text-[19px] text-ink">
        {title}
      </h2>
      {note && <span className="setcode">{note}</span>}
    </div>
  )
}

/** A load that failed with nothing to fall back on: what, why, and a way out. */
function Problem({
  title,
  message,
  onRetry,
  className,
}: {
  title: string
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-coral/30 bg-coral-soft px-4 py-3.5',
        className,
      )}
    >
      <Icon name="alert" size={17} className="shrink-0 text-coral-deep" />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[14px] font-bold text-coral-deep">{title}</p>
        {message && <p className="mt-0.5 text-[13px] leading-snug text-coral-deep/85">{message}</p>}
      </div>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        <Icon name="refresh" size={13} /> Retry
      </Button>
    </div>
  )
}

type TopicEntry = { link: string; subspace: Subspace; quiz: Quiz | null; deck: Deck | null }

/**
 * Topic id → where it lives, plus the one quiz and the one deck in it worth
 * opening. The quiz is the attempted one with the lowest best score (the one
 * to retake), else the newest; the deck is the one with the most cards due.
 */
function indexTopics(spaces: Space[], quizzes: Quiz[], decks: Deck[]): Map<string, TopicEntry> {
  const map = new Map<string, TopicEntry>()
  for (const space of spaces) {
    for (const subspace of space.subspaces) {
      const own = quizzes.filter((q) => q.subspace_id === subspace.id)
      const taken = own.filter((q) => q.best_score != null)
      const quiz = taken.length
        ? taken.reduce((a, b) => ((b.best_score ?? 0) < (a.best_score ?? 0) ? b : a))
        : (own.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null)
      const ownDecks = decks.filter((d) => d.subspace_id === subspace.id && d.total > 0)
      const deck = ownDecks.length ? ownDecks.reduce((a, b) => (b.due > a.due ? b : a)) : null
      map.set(subspace.id, { link: subspacePath(space, subspace), subspace, quiz, deck })
    }
  }
  return map
}

/** A topic found by its name, for signals that carry only a label. */
function topicByName(topics: Map<string, TopicEntry>, label: string): TopicEntry | undefined {
  const want = label.trim().toLowerCase()
  for (const t of topics.values()) if (t.subspace.name.trim().toLowerCase() === want) return t
  return undefined
}

/** The exact quiz, or the topic's quiz list when it has none yet. */
const quizTo = (entry: TopicEntry) =>
  entry.quiz ? `${entry.link}/quizzes?q=${encodeURIComponent(entry.quiz.id)}` : `${entry.link}/quizzes`
const deckTo = (entry: TopicEntry) =>
  entry.deck ? `${entry.link}/flashcards?deck=${encodeURIComponent(entry.deck.id)}` : `${entry.link}/flashcards`

type TopicAction = { label: string; to: string }

/**
 * The one thing to do about a weak topic.
 *
 * Cards train recall and a quiz tests applying it, so the split decides: when
 * recall is the weaker half and the topic has cards, review them; otherwise
 * take a quiz. No action at all when the topic is no longer in the rail — a
 * button that lands on "not found" is worse than no button.
 */
function actionFor(area: TopicSignal, entry: TopicEntry | undefined): TopicAction | null {
  if (!entry) return null
  const recall = area.recall_mastery
  const apply = area.application_mastery
  const recallWeaker = recall != null && (apply == null || recall < apply)
  if (recallWeaker && (entry.deck || (entry.subspace.counts?.cards ?? 0) > 0)) {
    return { label: 'Review cards', to: deckTo(entry) }
  }
  return { label: entry.quiz?.best_score != null ? 'Retake quiz' : 'Take a quiz', to: quizTo(entry) }
}

/** Somewhere to start when nothing is weak yet: a topic that already has a
 *  quiz, else the first topic there is. */
function firstPractice(topics: Map<string, TopicEntry>): TopicAction | null {
  const all = [...topics.values()]
  const withQuiz = all.find((t) => t.quiz) ?? all.find((t) => (t.subspace.counts?.quizzes ?? 0) > 0)
  const pick = withQuiz ?? all[0]
  return pick ? { label: 'Take a quiz', to: quizTo(pick) } : null
}

/**
 * Where to focus — the part of the page you can act on, so it leads.
 *
 * Real quiz-derived signal from `/me/student-model`: recurring mix-ups, the
 * weakest topics with their recall/apply split, root causes and topics going
 * quiet. Each list appears only when it has something in it. The first weak
 * topic carries the page's single primary action; the rest are quiet.
 */
function Focus({
  student,
  phase,
  topics,
  brandNew,
}: {
  student: AsyncResult<StudentModel>
  phase: SlowPhase
  topics: Map<string, TopicEntry>
  brandNew: boolean
}) {
  const sm = student.data
  const weak = sm ? sm.weak_areas.slice(0, FOCUS_LIMIT) : []
  const mixups = sm?.top_misconceptions ?? []
  const causes = sm?.root_causes ?? []
  const slipping = sm?.slipping ?? []
  const actions = weak.map((a) => actionFor(a, topics.get(a.subspace_id)))
  const primaryAt = actions.findIndex(Boolean)
  const start = brandNew ? null : firstPractice(topics)

  let body: ReactNode
  if (student.loading) {
    body = (
      <>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
        <SlowCaption phase={phase} onRetry={student.refresh} />
      </>
    )
  } else if (!sm && student.error) {
    body = (
      <Problem
        title="Couldn't work out where to focus"
        message={student.error}
        onRetry={student.refresh}
      />
    )
  } else if (!sm || !hasFocusSignal(sm)) {
    body = (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-[15px] font-bold text-ink">Nothing to flag yet</p>
          <p className="mt-1 max-w-[52ch] text-[13.5px] leading-relaxed text-muted">
            After a few quizzes, your lowest-scoring topics show up here with their score,
            how recall compares with applying it, and one thing to do about each.
          </p>
        </div>
        {start && (
          <Link to={start.to}>
            <Button size="sm" tabIndex={-1}>
              {start.label} <Icon name="arrowRight" size={14} />
            </Button>
          </Link>
        )}
      </div>
    )
  } else {
    body = (
      <>
        {mixups.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg bg-well/60 px-3.5 py-3">
            <span className="setcode-strong">
              {mixups.length === 1 ? 'A mix-up that keeps coming back' : 'Mix-ups that keep coming back'}
            </span>
            {mixups.map((m, i) => (
              <p key={i} className="text-[14.5px] leading-snug text-ink">
                {sentence(m.text)}
                {m.last_seen && relativeDays(m.last_seen) && (
                  <span className="text-[12.5px] text-muted"> Last seen {relativeDays(m.last_seen)}.</span>
                )}
              </p>
            ))}
          </div>
        )}

        {weak.length > 0 && (
          <ul className="flex flex-col">
            {weak.map((a, i) => {
              const action = actions[i]
              return (
                <li
                  key={a.subspace_id}
                  className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line-soft py-3.5 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                      <span className="min-w-0 break-words text-[15.5px] font-bold text-ink">{a.topic}</span>
                      <span className="shrink-0 text-[13.5px] font-bold tabular-nums text-coral-deep">
                        {a.average}% avg
                      </span>
                    </p>
                    {a.subject && <p className="mt-0.5 text-[12.5px] text-muted">{a.subject}</p>}
                    {(a.recall_mastery != null || a.application_mastery != null) && (
                      <MasterySplit recall={a.recall_mastery} application={a.application_mastery} />
                    )}
                  </div>
                  {action && (
                    <Link to={action.to} aria-label={`${action.label}: ${a.topic}`} className="shrink-0">
                      <Button size="sm" variant={i === primaryAt ? 'primary' : 'secondary'} tabIndex={-1}>
                        {action.label} <Icon name="arrowRight" size={14} />
                      </Button>
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {(causes.length > 0 || slipping.length > 0) && (
          <div className="flex flex-col gap-1.5 border-t border-line-soft pt-3.5 text-[13.5px] leading-snug text-ink-2">
            {causes.map((r, i) => (
              <p key={`c${i}`}>
                Struggles with {r.because_of.join(', ')} — likely because of {r.concept}.
              </p>
            ))}
            {slipping.map((s, i) => {
              // A fading topic opens its own deck or quiz; a concept has no page.
              const entry = s.kind === 'topic' ? topicByName(topics, s.label) : undefined
              const to = entry ? (entry.deck ? deckTo(entry) : quizTo(entry)) : null
              return (
                <p key={`s${i}`}>
                  Fading: {s.label}
                  {s.days_since_activity != null &&
                    `, last practised ${s.days_since_activity} day${s.days_since_activity === 1 ? '' : 's'} ago`}
                  {to && (
                    <>
                      {' · '}
                      <Link to={to} className="font-bold text-ink underline-offset-2 hover:underline">
                        {entry?.deck ? 'Review its cards' : 'Practise it'}
                      </Link>
                    </>
                  )}
                </p>
              )
            })}
          </div>
        )}

        {student.error && <StaleNotice onRetry={student.refresh} />}
      </>
    )
  }

  return (
    <section aria-labelledby="profile-focus">
      <Card className="flex flex-col gap-4 p-4 sm:p-5">
        <SectionHead id="profile-focus" title="Where to focus" note="from your quizzes" />
        {body}
      </Card>
    </section>
  )
}

/**
 * One figure, and the thing it is measured against, in one tile.
 *
 * The label, the number, its unit and the reference in words all sit within a
 * few centimetres of each other; the rail underneath is as wide as the tile,
 * not the page. It fills from zero once, on mount.
 */
function Measure({
  icon,
  label,
  short,
  value,
  against,
  unit,
  reference,
  tone,
  empty = false,
}: {
  icon: IconName
  label: string
  /** The label on a tile too narrow for the full one (three across a phone). */
  short: string
  value: number
  /** The denominator — a personal best, a goal, a ceiling. Never zero. */
  against: number
  unit: string
  /** The reference in words, so it is never inferred from bar width alone. */
  reference: string
  tone: 'sky' | 'sun' | 'mint'
  /** No data yet. Shows a dash rather than implying a score of zero. */
  empty?: boolean
}) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced)
  useEffect(() => {
    if (reduced) return
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [reduced])

  const pct = Math.min(100, Math.round((value / against) * 100))
  const lit = !empty && value > 0

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-line bg-surface p-3 @2xl:gap-3 @2xl:p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'hidden h-7 w-7 shrink-0 place-items-center rounded-md @2xl:grid',
            toneSoft[tone],
            lit ? toneText[tone] : 'text-faint',
          )}
        >
          <Icon3D name={icon} size={14} lifted={lit} />
        </span>
        <span className="setcode-strong min-w-0">
          <span className="@2xl:hidden">{short}</span>
          <span className="hidden @2xl:inline">{label}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span
          className={cn(
            'nameplate text-[28px] leading-none tabular-nums @2xl:text-[34px]',
            lit ? 'text-ink' : 'text-ink-3',
          )}
        >
          {empty ? '—' : value}
        </span>
        {unit && <span className="text-[13px] text-ink-3">{unit}</span>}
        <span className="hidden text-[13px] text-muted @2xl:inline">· {reference}</span>
      </div>

      {/* The track rounds and clips; the fill scales. Animating `width` would
          lay the tile out on every frame of a 900ms transition. */}
      <span className="relative h-[6px] overflow-hidden rounded-full bg-line">
        <span
          className={cn('absolute inset-0 origin-left', toneBar[tone])}
          style={{
            transform: `scaleX(${shown ? pct / 100 : 0})`,
            transition: reduced ? undefined : 'transform 900ms var(--ease-sl)',
          }}
        />
      </span>
      <span className="text-[12.5px] text-muted @2xl:hidden">{reference}</span>
    </div>
  )
}

/** A count of something that exists because you made it. */
function Built({ value, one, many }: { value: number; one: string; many: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-bold tabular-nums text-ink">{value}</span> {value === 1 ? one : many}
    </span>
  )
}

/** What the last seven days were made of — the same window as the minutes. */
function WeekMix({ composition }: { composition: Stats['composition'] | undefined }) {
  if (!composition) return null
  const parts: [number, string, string][] = [
    [composition.cards_reviewed, 'card reviewed', 'cards reviewed'],
    [composition.quizzes_taken, 'quiz taken', 'quizzes taken'],
    [composition.chat_messages, 'chat message', 'chat messages'],
  ]
  if (parts.every(([n]) => n === 0)) return null
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[13px] text-muted">
      <span className="setcode-strong self-center">Last 7 days</span>
      {parts.map(([n, one, many]) => (
        <span key={many} className="whitespace-nowrap">
          <span className="font-bold tabular-nums text-ink">{n}</span> {n === 1 ? one : many}
        </span>
      ))}
    </p>
  )
}

/**
 * A badge, as a row: the seal, its name, and one line under it.
 *
 * A locked badge prints the rule that earns it and how far along you are —
 * "7 of 10" is a target you are close to; the rule alone is a wall. That line
 * used to live in a tooltip, which a phone cannot open. An earned badge says
 * so; the API carries no earned date, so none is shown.
 */
function BadgeRow({ badge }: { badge: Badge }) {
  const counted = !badge.earned && badge.target > 1
  return (
    <li className="flex items-start gap-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0 last:pb-0 @xl:[&:nth-child(2)]:border-t-0 @xl:[&:nth-child(2)]:pt-0 @xl:[&:nth-last-child(2):nth-child(odd)]:pb-0">
      <span
        className={cn(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1',
          badge.earned
            ? cn(toneSoft[badge.tone], toneText[badge.tone], TIER_RING[badge.tier])
            : 'bg-well text-faint ring-line',
        )}
      >
        <Icon name={badge.earned ? ((badge.icon as IconName) ?? 'seal') : 'lock'} size={16} filled={badge.earned} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn('text-[14px] font-bold', badge.earned ? 'text-ink' : 'text-ink-3')}>
            {badge.label}
          </span>
          {badge.tier !== 'common' && <span className="setcode">{badge.tier}</span>}
        </p>
        {badge.earned ? (
          <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted">
            <Icon name="check" size={12} className="shrink-0" /> Earned
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{badge.hint}</p>
            {counted && (
              <div className="mt-1.5 flex items-center gap-2">
                {/* The track clips, the fill scales — same as every meter. */}
                <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-line">
                  <span
                    className="absolute inset-0 origin-left bg-ink-3"
                    style={{ transform: `scaleX(${Math.min(1, badge.progress / badge.target)})` }}
                  />
                </span>
                <span className="text-[12.5px] tabular-nums text-ink-3">
                  {badge.progress} of {badge.target}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  )
}

const TIER_RING: Record<Badge['tier'], string> = {
  common: 'ring-line',
  rare: 'ring-sky/40',
  elite: 'ring-sun/50',
}

function Heatmap({ cells }: { cells: Stats['heatmap'] }) {
  // Drawn once per mount, staggered across the columns. `useState` + rAF
  // rather than a CSS-only animation because the stagger has to be indexed by
  // column, and 26 keyframe rules would be worse than one delay expression.
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])


  // Weeks as columns, weekdays as rows — the layout everyone already reads.
  const weeks: (typeof cells)[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // Month ticks, placed on the first week that enters a new month.
  //
  // `day` is a date-ONLY string ("2026-03-01") — `new Date(str)` parses that
  // as UTC midnight, and plain `.getMonth()`/`toLocaleDateString()` then read
  // it back in the *browser's local* timezone. For anyone west of UTC that
  // rolls back to 11pm the previous day, so the 1st of a month reads as still
  // being the last day of the one before it — a tick lands a week late (or a
  // week's worth of cells get mis-labelled), which is exactly the "days
  // don't match the months" symptom. Read every field back out in UTC so the
  // calendar day never moves.
  const months: { label: string; col: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, i) => {
    const d = new Date(week[0]?.day ?? '')
    if (Number.isNaN(d.getTime())) return
    if (d.getUTCMonth() !== lastMonth) {
      lastMonth = d.getUTCMonth()
      months.push({
        label: d.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
        col: i,
      })
    }
  })

  /* Both label tracks share the cell grid's geometry instead of guessing at
     it, which is what was wrong before.

     The weekday column used `justify-between` over three labels — so Mon sat
     at 0%, Wed at 50% and Fri at 100% of the height, while their actual rows
     are the 1st, 3rd and 5th of seven. Nothing lined up with anything. It is
     the same 7-row grid as the cells now, with each label placed in its own
     row, so alignment is structural rather than approximated.

     The month row had every week rendering a `<span>` in a ~6px column, which
     clipped a three-letter month to about one letter. Ticks are now grid
     items placed at their starting column and allowed to overflow to the
     right, the way a real axis tick behaves. */
  const cols = { gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }

  return (
    <div className="flex w-full gap-2">
      {/* Weekday axis, on the cells' own row grid. */}
      <div className="grid shrink-0 grid-rows-7 gap-[3px] pt-[calc(0.75rem+4px)]">
        {['Mon', '', 'Wed', '', 'Fri', '', ''].map((d, i) => (
          <span
            key={i}
            className="setcode flex items-center leading-none"
          >
            {d}
          </span>
        ))}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 grid h-3 gap-[3px]" style={cols}>
          {months.map((m) => (
            <span
              key={m.label + m.col}
              // `col + 1` because CSS grid lines are 1-indexed. Overflow is
              // deliberate: a tick labels the column it starts at and is
              // allowed to run past it.
              // A month that starts in the last columns has no room to run
              // right, so it ends at the grid's edge instead of past it.
              style={
                m.col > weeks.length - 4
                  ? { gridRow: 1, gridColumn: '1 / -1', justifySelf: 'end' }
                  : { gridRow: 1, gridColumnStart: m.col + 1 }
              }
              className="setcode overflow-visible whitespace-nowrap leading-none"
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className="grid gap-[3px]" style={cols}>
          {weeks.map((week, w) => (
            <div key={w} className="grid grid-rows-7 gap-[3px]">
              {week.map((cell, d) => (
                <span
                  key={cell.day}
                  title={`${cell.day}${cell.minutes ? ` — about ${cell.minutes} min` : ''}`}
                  className={cn(
                    'aspect-square w-full rounded-[2px]',
                    'transition-[opacity,transform,background-color] duration-300 ease-out',
                    INTENSITY[Math.min(3, cell.intensity)],
                  )}
                  style={{
                    opacity: drawn ? 1 : 0,
                    // Scale from the cell's own centre so the wave reads as
                    // the map developing rather than sliding in from an edge.
                    transform: drawn ? 'scale(1)' : 'scale(0.4)',
                    // Column-dominant delay with a small per-row offset, so it
                    // sweeps left to right with a slight diagonal rather than
                    // marching in rigid vertical bars. Capped so the last
                    // column is never more than ~half a second behind.
                    transitionDelay: drawn ? `${Math.min(w * 14 + d * 4, 520)}ms` : '0ms',
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
/** Whether "Where to focus" has anything real to say. */
function hasFocusSignal(sm: StudentModel): boolean {
  return (
    (sm.top_misconceptions?.length ?? 0) > 0 ||
    (sm.root_causes?.length ?? 0) > 0 ||
    (sm.slipping?.length ?? 0) > 0 ||
    sm.weak_areas.length > 0
  )
}

/** A mix-up arrives as a clause ("confuses Q-learning with SARSA"); print it
 *  as a sentence. */
function sentence(text: string): string {
  const t = text.trim()
  if (!t) return t
  const capped = t[0].toUpperCase() + t.slice(1)
  return /[.!?]$/.test(capped) ? capped : `${capped}.`
}

/** "3d ago" / "today" for a mix-up's `last_seen`. */
function relativeDays(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff)) return ''
  const days = Math.floor(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

/**
 * Recall vs application mastery — two short meters with their figures, so
 * "good at recall, shaky on applying it" reads at a glance under the topic it
 * belongs to. Each side only appears once it has cleared the evidence floor
 * (`null` until then).
 */
function MasterySplit({
  recall,
  application,
}: {
  recall?: number | null
  application?: number | null
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
      {recall != null && <MasteryBar label="Recall" value={recall} />}
      {application != null && <MasteryBar label="Apply" value={application} />}
    </div>
  )
}

function MasteryBar({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="setcode">{label}</span>
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-line">
        <span
          className="absolute inset-0 origin-left bg-ink-3"
          style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }}
        />
      </span>
      <span className="text-[12.5px] font-bold tabular-nums text-ink-2">{value}%</span>
    </span>
  )
}
