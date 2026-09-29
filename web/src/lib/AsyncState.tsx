/**
 * A generic, time-aware wrapper around one `useAsync` resource.
 *
 * Render's free-tier backend cold-starts in ~30-60s and occasionally answers
 * slow, or with a 429 from the upstream AI. A loading state that looks
 * identical at 200ms and at 25s reads as broken, not slow, and an error with
 * no way out is a dead end. This is the one place that turns
 * `{data, loading, error, validating, refresh}` (what `useAsync` returns —
 * see its own doc comment) into copy a student would actually believe:
 *
 *   - under `SLOW_MS`: the caller's own `skeleton` — nothing looks different
 *     yet, because most loads never get here.
 *   - `SLOW_MS`..`STALLED_MS`: a calm "waking up the server" note — the
 *     likely cause on a free-tier host, not a scary error.
 *   - past `STALLED_MS`: reassurance plus a manual Retry, because at some
 *     point "just wait" stops being honest advice.
 *   - a hard failure with no data yet: `classifyError`'s bucket picks the
 *     headline (offline, slow, the AI is busy, a server problem, or "sign in
 *     again"), `error` supplies the already-friendly sentence, and Retry
 *     calls `onRetry`.
 *   - data present but a background refresh failed: the stale data stays on
 *     screen — `children` still renders — with a small inline notice rather
 *     than a wipe. See `useAsync`'s `validating`/`error` contract.
 *
 * Built for a screen that renders ONE resource in its own region. Home and
 * Profile interleave several `useAsync` calls into one bespoke, staggered
 * layout that this wrapper doesn't fit, so they call `useSlowState` directly
 * instead and slot its phase into their own per-section skeletons — this
 * component exists so a *simpler* screen (or one written later) gets the
 * same behaviour for free instead of reinventing it.
 */

import type { ReactNode } from 'react'
import type { ErrorKind } from '../api/errors'
import { Button } from '../components/ui/Button'
import { Icon, type IconName } from '../components/ui/Icon'
import { cn } from './cn'
import { useSlowState, type SlowPhase } from './useSlowState'

const KIND_ICON: Record<ErrorKind, IconName> = {
  offline: 'offline',
  timeout: 'clock',
  rate_limited: 'sparkle',
  auth: 'lock',
  server: 'alert',
  other: 'alert',
}

const KIND_TITLE: Record<ErrorKind, string> = {
  offline: "Can't reach the server",
  timeout: 'Taking longer than usual',
  rate_limited: 'The AI is busy',
  auth: 'Session expired',
  server: 'Something went wrong on our side',
  other: 'Something went wrong',
}

export function AsyncState<T>({
  data,
  error,
  errorKind,
  loading,
  validating = false,
  onRetry,
  skeleton,
  children,
  className,
}: {
  data: T | null
  error: string | null
  /** From the same `useAsync` result — see `errorKind` there. Defaults to
   *  `'other'` for a caller that built this by hand instead of spreading a
   *  `useAsync` result straight in. */
  errorKind?: ErrorKind | null
  loading: boolean
  /** Background revalidation in flight — shows a tiny corner indicator over
   *  `children` rather than any change to the loading/error handling. */
  validating?: boolean
  onRetry: () => void
  skeleton: ReactNode
  children: (data: T) => ReactNode
  className?: string
}) {
  const phase = useSlowState(loading)

  if (data !== null) {
    return (
      <div className={cn('relative', className)}>
        {children(data)}
        {/* Background revalidation, never a skeleton — the cache's whole
            point is that a revisit doesn't go blank. */}
        {validating && !error && (
          <span
            aria-hidden
            title="Refreshing…"
            className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-brand/70 motion-safe:animate-pulse"
          />
        )}
        {/* A background refresh failed — the stale data above is kept on
            purpose; this is a footnote, not a takeover. */}
        {validating === false && error && <StaleNotice onRetry={onRetry} />}
      </div>
    )
  }

  if (error) {
    return (
      <ErrorCard kind={errorKind ?? 'other'} message={error} onRetry={onRetry} className={className} />
    )
  }

  if (phase === 'stalled') {
    return (
      <div className={cn('flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-dash bg-well/40 px-6 py-10 text-center', className)}>
        <Icon name="clock" size={18} className="text-muted" />
        <div className="max-w-xs">
          <p className="text-[13.5px] font-bold text-ink">Still waking up</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            The free server can take a minute to start from cold. Worth one more try if it's
            been a while.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <Icon name="refresh" size={13} /> Retry
        </Button>
      </div>
    )
  }

  if (phase === 'slow') {
    return (
      <div className={cn('flex flex-col items-center gap-2 px-6 py-10 text-center', className)}>
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" aria-hidden />
        <p className="text-[12.5px] text-muted">Waking up the server — this can take a minute.</p>
      </div>
    )
  }

  return <>{skeleton}</>
}

function ErrorCard({
  kind,
  message,
  onRetry,
  className,
}: {
  kind: ErrorKind
  message: string
  onRetry: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-coral/30 bg-coral-soft px-6 py-10 text-center',
        className,
      )}
    >
      <Icon name={KIND_ICON[kind]} size={18} className="text-coral-deep" />
      <div className="max-w-xs">
        <p className="text-[13.5px] font-bold text-coral-deep">{KIND_TITLE[kind]}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-coral-deep/80">{message}</p>
      </div>
      {/* A dead session is already being ended by the 401 handler
          (`AuthProvider`) — a Retry button here would just repeat the same
          401 while the redirect it triggered is already in flight. */}
      {kind !== 'auth' && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <Icon name="refresh" size={13} /> Retry
        </Button>
      )}
    </div>
  )
}

/**
 * "A background refresh failed, but here's what we last had" — the inline
 * footnote half of stale-while-revalidate. Exported (not just used inside
 * `AsyncState` above) because Home and Profile read `useAsync` directly
 * rather than through the wrapper, for the same layout reasons noted at the
 * top of this file, and want the exact same footnote rather than a
 * hand-rolled one that could drift from it.
 */
export function StaleNotice({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <p className={cn('flex items-center gap-1.5 text-[11.5px] text-faint', className)}>
      <Icon name="alert" size={11} className="shrink-0" />
      Couldn't refresh — showing what we last had.{' '}
      <button
        type="button"
        onClick={onRetry}
        className="cursor-pointer font-bold text-muted underline-offset-2 hover:underline"
      >
        Try again
      </button>
    </p>
  )
}

/**
 * The inline half of the same time-aware copy `AsyncState` shows full-size —
 * for a screen (Home, Profile) that already has its own skeleton for a
 * section and just wants to append "still waking up" / "worth a retry" under
 * it rather than replace it outright. Silent for `'idle'`/`'fast'`, which is
 * most of the time.
 */
export function SlowCaption({
  phase,
  onRetry,
  className,
}: {
  phase: SlowPhase
  onRetry: () => void
  className?: string
}) {
  if (phase === 'idle' || phase === 'fast') return null
  return (
    <p className={cn('flex items-center gap-1.5 text-[11.5px] text-muted', className)}>
      <Icon name="clock" size={11} className="shrink-0" />
      {phase === 'stalled' ? 'Still waking up the server.' : 'Waking up the server…'}
      {phase === 'stalled' && (
        <button
          type="button"
          onClick={onRetry}
          className="cursor-pointer font-bold text-ink-3 underline-offset-2 hover:underline"
        >
          Retry
        </button>
      )}
    </p>
  )
}
