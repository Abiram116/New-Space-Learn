/**
 * Profile — the collector's page.
 *
 * Previously this was a 512px column floating in the middle of a wide screen,
 * which made a page about accumulation feel like a receipt. It now uses the
 * full width: identity across the top, standing beneath it, then the activity
 * ledger and the badge case side by side.
 *
 * Every number comes from `/me/stats`. Delete-account lives in Settings, next
 * to the rest of the account controls, not here — this page is the record,
 * not where you act on it.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStudentModel } from '../../api/me'
import type { Badge, Stats, StudentModel } from '../../api/types'
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
import { useAsync } from '../../lib/useAsync'
import { SlowCaption, StaleNotice } from '../../lib/AsyncState'
import { useSlowState } from '../../lib/useSlowState'
import { cn } from '../../lib/cn'
import { useReducedMotion } from '../../components/ui/motion'
import { useIsMobile } from '../../lib/useIsMobile'
import { toneBar, toneSoft, toneText } from '../../lib/tone'

/** Heatmap steps, warm→hot, so a dense week reads at a glance. */
const INTENSITY = ['bg-line-soft', 'bg-brand/25', 'bg-brand/55', 'bg-brand']

export function Profile() {
  const phone = useIsMobile()
  const { user, setDisplayName } = useAuth()
  const navigate = useNavigate()
  const { showError } = useToast()
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

  const commitName = async () => {
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Fills the height instead of stacking into the top third.
          `max-w-5xl` on a 1900px monitor put every element in a centred column
          with a blank lower half — the page read as a receipt printed in the
          middle of a desk. Wider cap, and `min-h-full` with the ledger row
          allowed to grow means the activity map and badge case take the space
          that was empty rather than the page ending early. */}
      <div className="mx-auto flex min-h-full w-full max-w-[92rem] flex-col gap-6 px-4 py-7 sm:px-8">
        {/* Identity */}
        <header className="flex flex-wrap items-center gap-4">
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
                  if (e.key === 'Escape') setEditing(false)
                }}
                aria-label="Your name"
                maxLength={60}
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
                    setDraft(displayName)
                    setEditing(true)
                  }}
                  aria-label="Rename yourself"
                  title="Rename yourself"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-muted transition-colors cursor-pointer hover:bg-line-soft hover:text-ink"
                >
                  <Icon name="pencil" size={16} />
                </button>
              </h1>
            )}
            <p className="mt-1 truncate text-[13px] text-muted">
              {email}
              {joined ? ` · collecting since ${joined}` : ''}
            </p>
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
            className="-mt-2 flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 text-left active:bg-line-soft"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-raised text-ink-3">
              <Icon name="settings" size={15} />
            </span>
            <span className="min-w-0 flex-1 text-[16px] font-medium text-ink">Settings</span>
            <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
          </button>
        )}

        {stats.error && !stats.loading && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-coral/30 bg-coral-soft px-4 py-3 text-sm text-coral-deep">
            {stats.error}
            <Button size="sm" variant="secondary" onClick={stats.refresh}>
              <Icon name="refresh" size={13} /> Retry
            </Button>
          </div>
        )}
        {stats.loading && <SlowCaption phase={statsPhase} onRetry={stats.refresh} />}

        {/* A brand-new account used to land on a wall of zeroes and empty
            charts with nothing explaining them. Say what this page will
            become instead of rendering a blank ledger. */}
        {d && !stats.loading && d.spaces_count === 0 && d.docs_indexed === 0 && (
          <EmptyState
            icon="seal"
            title="Nothing on the record yet"
            description="This is where your streak, badges and study history collect. Make a subject, add a topic, and the ledger starts filling itself in."
            action={<Button onClick={() => navigate('/home')}>Go to Home</Button>}
          />
        )}

        {/* ── Standing ─────────────────────────────────────────────────
            Figures measured against something, not four flat numbers.

            This was a 2×4 grid of tiles each printing one value in large type.
            A streak of 3 tells you nothing on its own: 3 against a personal
            best of 3 is a different sentence from 3 against a best of 12, and
            only one of those belongs on a page about your record.

            It is also the first use of `ruled-datum`, which the material system
            defines as the thing that makes a figure mean anything — "without a
            reference, a bar chart is decoration" — and which nothing had
            adopted. The rail is where you stand; the reference is named in
            words so it never has to be inferred from the geometry. */}
        <section className="flex flex-col">
          <div className="flex items-baseline gap-2 pb-1">
            <h2 className="nameplate text-[20px] text-ink">Standing</h2>
            <span className="setcode ml-auto">against your own best</span>
          </div>

          {stats.loading ? (
            <div className="flex flex-col gap-3 pt-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : d ? (
            <div className={phone ? 'flex flex-col gap-2.5 pt-2' : 'contents'}>
              <Measure
                stacked={phone}
                icon="flame"
                label="Current streak"
                value={d.streak_days}
                against={Math.max(d.max_streak, 1)}
                unit={d.streak_days === 1 ? 'day' : 'days'}
                reference={d.max_streak > 0 ? `best ${d.max_streak}` : 'no record yet'}
                tone="brand"
              />
              <Measure
                stacked={phone}
                icon="deck"
                label="Reviewed this week"
                value={d.composition?.cards_reviewed ?? 0}
                /* `daily_goal` is cards per day (see Settings), so the only
                   honest weekly reference is cards reviewed against it —
                   comparing it to study *minutes* was mixing two different
                   units into one bar. Minutes still show plainly, with no
                   invented goal, in the Activity panel below. */
                against={Math.max(d.daily_goal * 7, 1)}
                unit="cards"
                reference={`goal ${d.daily_goal * 7}`}
                tone="sun"
              />
              <Measure
                icon="target"
                label="Quiz average"
                value={d.quiz_average ?? 0}
                against={100}
                unit={d.quiz_average != null ? '%' : ''}
                reference={d.quiz_average != null ? 'of 100' : 'none taken yet'}
                empty={d.quiz_average == null}
                tone="mint"
                stacked={phone}
              />
            </div>
          ) : null}
        </section>

        {/* ── What exists because you did it ────────────────────────────
            The other half of a record. These are counts of things you own, so
            they stay plain figures rather than bars: there is no target a note
            is measured against, and inventing one would be exactly the
            "reference that means nothing" the material system warns about. */}
        {d && (
          <section className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-t border-line pt-4">
            <span className="setcode-strong">Built so far</span>
            <Built value={d.spaces_count} one="subject" many="subjects" />
            <Built value={d.docs_indexed} one="source" many="sources" />
            <Built
              value={d.badges.filter((b) => b.earned).length}
              one="badge"
              many="badges"
            />
          </section>
        )}

        {/* Real quiz-derived signal from `/me/student-model` — misconceptions,
            root causes, slipping topics, weak areas with their recall/
            application split where there's enough evidence for one. Silent
            when there's nothing yet: a few quiz attempts, never a guess from
            account age, and each row only appears when its own list is
            non-empty — no invented facts, no padded-out placeholders. */}
        {student.data && hasFocusSignal(student.data) && (
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <span className="setcode-strong">Where to focus</span>

            {student.data.top_misconceptions && student.data.top_misconceptions.length > 0 && (
              <div className="flex flex-col gap-1.5 text-[13px]">
                {student.data.top_misconceptions.map((m, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-ink-2">Mix-up: {m.text}</span>
                    {m.last_seen && (
                      <span className="shrink-0 text-faint">{relativeDays(m.last_seen)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {student.data.root_causes && student.data.root_causes.length > 0 && (
              <div className="flex flex-col gap-1.5 text-[13px]">
                {student.data.root_causes.map((r, i) => (
                  <p key={i} className="text-ink-2">
                    Struggles with {r.because_of.join(', ')} — likely because of {r.concept}.
                  </p>
                ))}
              </div>
            )}

            {student.data.slipping && student.data.slipping.length > 0 && (
              <div className="flex flex-col gap-1.5 text-[13px]">
                {student.data.slipping.map((s, i) => (
                  <p key={i} className="text-ink-2">
                    Fading: {s.label}
                    {s.days_since_activity != null &&
                      `, last practised ${s.days_since_activity} day${s.days_since_activity === 1 ? '' : 's'} ago`}
                  </p>
                ))}
              </div>
            )}

            {student.data.weak_areas.length > 0 && (
              <div className="flex flex-col gap-2 text-[13px]">
                {student.data.weak_areas.slice(0, 3).map((a) => (
                  <div key={a.subspace_id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-ink-2">
                        {a.topic}
                        {a.subject && <span className="text-faint"> · {a.subject}</span>}
                      </span>
                      <span className="shrink-0 text-coral-deep">{a.average}% avg</span>
                    </div>
                    {(a.recall_mastery != null || a.application_mastery != null) && (
                      <MasterySplit recall={a.recall_mastery} application={a.application_mastery} />
                    )}
                  </div>
                ))}
              </div>
            )}

            {student.error && <StaleNotice onRetry={student.refresh} />}
          </section>
        )}
        {student.loading && <SlowCaption phase={studentPhase} onRetry={student.refresh} />}

        {/* The teaching-strategy bandit's own read-only summary — "you learn
            best through examples" — only once a subject has cleared the
            evidence floor `style_bandit.strategy_summary` enforces server-
            side. Never a guess dressed as a fact: an empty list here just
            means nothing has enough evidence yet, so the section is absent
            rather than showing a placeholder. */}
        {student.data && student.data.style_summaries && student.data.style_summaries.length > 0 && (
          <section className="flex flex-col gap-2 border-t border-line pt-4">
            <span className="setcode-strong">How you learn best</span>
            <div className="flex flex-col gap-1.5 text-[13px]">
              {student.data.style_summaries.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-ink-2">{s.subject}</span>
                  <span className="shrink-0 text-muted">{s.strategy_summary}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* `flex-1` on the row, not just the page: this is the part with
            content that scales, so it is the part that should absorb the
            leftover height. */}
        <div className="grid flex-1 gap-5 lg:grid-cols-[1.35fr_1fr]">
          {/* Activity ledger — and now actually a Ledger. This was already
              named one in the markup while rendering as cardstock. Six months
              of your own activity is the thing you are measured against; the
              badge case beside it stays a Card because badges are things you
              own. Those two being the same material was the confusion. */}
          {/* `border-b-0`: a ledger rule underlines figures so the eye can
              read them against it. Here it lands at the bottom of a panel with
              nothing beneath it, so it divides nothing and just draws a line
              across the page — the same "rule with nothing to divide" that was
              removed from the note canvas. The material stays; its trailing
              stroke does not. */}
          <Ledger className="flex h-full flex-col gap-3 border-b-0 p-5 pt-0">
            <div className="flex items-baseline gap-2">
              <h2 className="nameplate text-[20px] text-ink">Activity</h2>
              <span className="setcode ml-auto">
                {d ? `${d.study_minutes_this_week} min this week` : 'last 26 weeks'}
              </span>
            </div>
            {stats.loading ? (
              <Skeleton className="h-28 rounded-lg" />
            ) : d ? (
              <Heatmap cells={d.heatmap} />
            ) : null}
            <div className="mt-1 flex items-center gap-2">
              <span className="setcode">Less</span>
              <div className="flex gap-1">
                {INTENSITY.map((c) => (
                  <span key={c} className={cn('h-2.5 w-2.5 rounded-[3px]', c)} />
                ))}
              </div>
              <span className="setcode">More</span>
              {/* The scale is relative to your OWN busiest day in this
                  window, not a fixed number of minutes — without this, the
                  darkest cell reads as "a lot" with no way to know if that
                  means 20 minutes or 3 hours short of hovering every cell. */}
              <span className="text-[12.5px] text-faint">— relative to your busiest day here</span>
            </div>
          </Ledger>

          {/* Badge case — stays a Card. Badges are earned objects you keep. */}
          {/* `self-start`, not `h-full`. Stretching the badge case to match
              the activity panel left a tall empty box under a 3-row grid of
              seals — the card was sized by its neighbour rather than by what
              was in it. It hugs its contents now; the two panels top-align,
              which is what a pair of unrelated-height panels should do. */}
          <Card className="flex flex-col gap-3 self-start p-5">
            <div className="flex items-baseline gap-2">
              <h2 className="nameplate text-[20px] text-ink">Badges</h2>
              {d && (
                <span className="setcode ml-auto">
                  {d.badges.filter((b) => b.earned).length} of {d.badges.length}
                </span>
              )}
            </div>
            {stats.loading ? (
              <div className="grid grid-cols-3 gap-2.5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-lg" />
                ))}
              </div>
            ) : d ? (
              <div className="grid grid-cols-3 gap-2.5">
                {d.badges.map((b) => (
                  <BadgeSeal key={b.id} badge={b} />
                ))}
              </div>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * One figure, and the thing it is measured against.
 *
 * LEDGER — a streak count or a quiz average is a figure about you, not an
 * object you hold, so it takes no foil: foil is the collectible cue, and
 * spending it on a statistic is what made every number look like loot.
 *
 * The rail fills from zero once, on mount. It is the *only* thing that moves
 * in this band, deliberately: the heatmap below is this page's animated
 * element, and two things competing for the eye is what made everything except
 * the heatmap read as inert.
 */
function Measure({
  icon,
  label,
  value,
  against,
  unit,
  reference,
  tone,
  empty = false,
  stacked = false,
}: {
  icon: IconName
  label: string
  value: number
  /** The denominator — a personal best, a goal, a ceiling. Never zero. */
  against: number
  unit: string
  /** The reference in words, so it is never inferred from bar width alone. */
  reference: string
  tone: 'brand' | 'sky' | 'sun' | 'mint'
  /** No data yet. Shows a dash rather than implying a score of zero. */
  empty?: boolean
  /** Phones: a card per figure — label and value over a full-width rail, the
   *  reference in words beneath, instead of one squeezed row. */
  stacked?: boolean
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

  if (stacked) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
              toneSoft[tone],
              lit ? toneText[tone] : 'text-faint',
            )}
          >
            <Icon3D name={icon} size={15} lifted={lit} />
          </span>
          <span className="min-w-0 flex-1 text-[15px] text-ink-3">{label}</span>
          <span className="flex shrink-0 items-baseline gap-1">
            <span className={cn('nameplate text-[26px] leading-none tabular-nums', lit ? toneText[tone] : 'text-ink-3')}>
              {empty ? '—' : value}
            </span>
            {unit && <span className="setcode">{unit}</span>}
          </span>
        </div>
        <span className="relative h-[6px] overflow-hidden rounded-full bg-line-soft">
          <span
            className={cn('absolute inset-0 origin-left', toneBar[tone])}
            style={{
              transform: `scaleX(${shown ? pct / 100 : 0})`,
              transition: reduced ? undefined : 'transform 900ms var(--ease-sl)',
            }}
          />
        </span>
        <span className="text-[13px] text-muted">{reference}</span>
      </div>
    )
  }

  return (
    <div className="ruled ruled-datum flex items-center gap-3 py-3">
      <span
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-md',
          toneSoft[tone],
          lit ? toneText[tone] : 'text-faint',
        )}
      >
        <Icon3D name={icon} size={14} lifted={lit} />
      </span>

      <span className="w-[7.5rem] shrink-0 text-[12.5px] text-ink-3">{label}</span>

      {/* The track rounds and clips; the fill scales. Animating the fill's
          `width` would lay out the row on every frame of a 900ms transition —
          the same thing `.t-meter` exists to avoid — and the clip is what lets
          the fill stay a plain rectangle whose corners cannot squash. */}
      <span className="relative h-[6px] min-w-0 flex-1 overflow-hidden rounded-full bg-line-soft">
        <span
          className={cn('absolute inset-0 origin-left', toneBar[tone])}
          style={{
            transform: `scaleX(${shown ? pct / 100 : 0})`,
            transition: reduced ? undefined : 'transform 900ms var(--ease-sl)',
          }}
        />
      </span>

      <span className="flex shrink-0 items-baseline gap-1">
        <span
          className={cn(
            'nameplate text-[22px] leading-none tabular-nums',
            lit ? toneText[tone] : 'text-ink-3',
          )}
        >
          {empty ? '—' : value}
        </span>
        {unit && <span className="setcode">{unit}</span>}
      </span>

      <span className="setcode hidden w-[7rem] shrink-0 text-right sm:block">
        {reference}
      </span>
    </div>
  )
}

/** A count of something that exists because you made it. */
function Built({ value, one, many }: { value: number; one: string; many: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="nameplate text-[20px] leading-none tabular-nums text-ink">
        {value}
      </span>
      <span className="text-[12.5px] text-muted">{value === 1 ? one : many}</span>
    </span>
  )
}

/**
 * A badge is a foil seal. Tier drives how precious it looks; an unearned one
 * shows how close you are, so it reads as a target rather than a locked door.
 *
 * **Uniform height, deliberately.** These tiles used to print the full hint
 * ("Get fifty cards to a known state.") under the label. Grid rows size to
 * their tallest item, so one three-line hint stretched every tile beside it and
 * the whole case turned into a column of tall, mostly-empty boxes. The standing
 * is a progress rail now — one fixed-height row that says the same thing
 * faster — and the hint moved to the tooltip, where a sentence belongs. Labels
 * clamp to two lines with a reserved minimum so every tile matches whatever its
 * neighbours do.
 */
function BadgeSeal({ badge }: { badge: Badge }) {
  const tierRing = {
    common: 'ring-line',
    rare: 'ring-sky/40',
    elite: 'ring-sun/50',
  }[badge.tier]

  return (
    <div
      /* The hint lives here now rather than in the tile: a sentence is a
         tooltip's job, and printing it was what made every row tall. */
      title={badge.earned ? badge.label : `${badge.hint} (${badge.progress} of ${badge.target})`}
      className={cn(
        'group relative flex flex-col items-center gap-1.5 rounded-lg p-2.5 text-center ring-1 t-control duration-200',
        badge.earned && badge.tier !== 'common' && 'foil hover:-translate-y-0.5',
        badge.earned ? cn('bg-raised', tierRing) : 'bg-well/60 ring-line/60',
      )}
    >
      <span
        className={cn(
          'grid h-9 w-9 place-items-center rounded-full',
          badge.earned
            ? cn(toneSoft[badge.tone], toneText[badge.tone])
            : 'bg-line-soft text-faint',
        )}
      >
        <Icon
          name={(badge.icon as IconName) ?? 'seal'}
          size={17}
          filled={badge.earned}
        />
      </span>
      {/* Two lines maximum, with the space for two always reserved, so a
          one-word label and a wrapping one produce the same tile. */}
      <span
        className={cn(
          'line-clamp-2 min-h-[2.1em] text-[12px] leading-tight',
          badge.earned ? 'font-bold text-ink' : 'text-faint',
        )}
      >
        {badge.label}
      </span>

      {/* One fixed-height slot for the footer, whatever goes in it — this is
          what actually keeps the row uniform. */}
      <div className="flex h-3 w-full items-center justify-center">
        {badge.earned ? (
          badge.tier !== 'common' && <span className="setcode text-[11px]">{badge.tier}</span>
        ) : badge.target > 1 ? (
          /* Standing, not the rule. "7 of 10" is a target you are close to;
             the rule alone is a wall you may not have started climbing. Drawn
             rather than written, because a bar is read at a glance and costs
             one line instead of three. */
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-line-soft"
            title={`${badge.progress} of ${badge.target}`}
          >
            {/* Same as every other meter: the track clips, the fill scales.
                A 700ms `width` transition on a grid of ten badges is ten
                elements relaying out together, every frame. */}
            <div
              className="h-full w-full origin-left bg-brand/70 t-meter duration-700 ease-out"
              style={{ transform: `scaleX(${Math.min(1, badge.progress / badge.target)})` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
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

  if (!cells.length) return <Skeleton className="h-28 rounded-lg" />

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
            className="setcode flex items-center text-[11px] leading-none"
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
              style={{ gridColumnStart: m.col + 1 }}
              className="setcode overflow-visible whitespace-nowrap text-[11px] leading-none"
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

/** Whether "Where to focus" has anything real to say. Kept apart from the
 *  section's own JSX so the section can stay absent — not an empty shell
 *  with just a heading — the moment every one of its lists is empty. */
function hasFocusSignal(sm: StudentModel): boolean {
  return (
    (sm.top_misconceptions?.length ?? 0) > 0 ||
    (sm.root_causes?.length ?? 0) > 0 ||
    (sm.slipping?.length ?? 0) > 0 ||
    sm.weak_areas.length > 0
  )
}

/** "3d ago" / "just now" for a mix-up's `last_seen` — same grain as Home's
 *  own relative-time copy, kept local rather than shared since it's the only
 *  other place on the page that needs it. */
function relativeDays(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff)) return ''
  const days = Math.floor(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

/**
 * Recall vs application mastery, task 6's split — two thin meters rather
 * than a sentence, so "good at recall, shaky on application" reads at a
 * glance under the topic it belongs to. Only rendered when at least one side
 * has cleared the evidence floor (`recall_mastery`/`application_mastery` are
 * `null` until then) — see the call site.
 */
function MasterySplit({
  recall,
  application,
}: {
  recall?: number | null
  application?: number | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-0.5">
      {recall != null && <MasteryBar label="Recall" value={recall} tone="sky" />}
      {application != null && <MasteryBar label="Apply" value={application} tone="sun" />}
    </div>
  )
}

function MasteryBar({ label, value, tone }: { label: string; value: number; tone: 'sky' | 'sun' }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-faint">
      <span className="setcode">{label}</span>
      <span className="relative h-1 w-12 overflow-hidden rounded-full bg-line-soft">
        <span
          className={cn('absolute inset-0 origin-left', toneBar[tone])}
          style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }}
        />
      </span>
      <span className="tabular-nums text-ink-3">{value}%</span>
    </span>
  )
}
