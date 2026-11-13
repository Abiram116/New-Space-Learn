/**
 * The free-tier limits, stated with their real numbers.
 *
 * Space Learn runs on free infrastructure, and that has a shape: a daily
 * allowance of answers, a pace, and size limits on what a file can be. A limit a
 * student meets as a refusal feels like a bug; one they can read here, with how
 * much of today's allowance is left, feels like a rule. Every figure comes from
 * `GET /me/limits`, which reads it from the code that enforces it.
 */

import { getLimits } from '../../api/me'
import { Skeleton } from '../../components/ui/Skeleton'
import { useAsync } from '../../lib/useAsync'
import { SettingsCard } from './parts'

export function LimitsCard() {
  const limits = useAsync(getLimits, [], 'me:limits')
  const l = limits.data

  return (
    <SettingsCard
      icon="clock"
      title="Free-tier limits"
      hint="Space Learn runs free, so there are a few limits. Here they are, with today’s use."
    >
      {limits.loading && !l ? (
        <div className="flex flex-col gap-2" aria-busy>
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="h-16 rounded-[10px]" />
        </div>
      ) : limits.error || !l ? (
        <p className="text-[13px] text-muted">
          Couldn’t load the limits.{' '}
          <button type="button" onClick={limits.refresh} className="cursor-pointer font-bold text-brand-deep hover:underline">
            Try again
          </button>
        </p>
      ) : (
        <div className="flex flex-col gap-4 text-[13.5px] leading-snug text-ink-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ink">Answers today</span>
              <span>
                <span className="nameplate text-[20px] text-ink">{Math.round(l.answers.left_today)}</span>
                <span className="text-muted"> of {l.answers.per_day} left</span>
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-line"
              role="img"
              aria-label={`${Math.round(l.answers.left_today)} of ${l.answers.per_day} answers left today`}
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${Math.max(0, Math.min(100, (l.answers.left_today / l.answers.per_day) * 100))}%` }}
              />
            </div>
            <p className="text-muted">
              A chat answer uses 1, a quiz uses {l.answers.quiz_costs}. Cards, notes and reviews use none. It refills over
              24 hours, not all at midnight.
            </p>
          </div>

          <Row label="Pace">
            Up to {l.answers.burst} questions in a burst, then about {l.answers.per_minute} a minute. The shared free model
            allows about 3 answers a minute across every student.
          </Row>
          <Row label="Files">
            Up to {l.files.max_mb} MB each. A text file is read as up to {l.files.max_passages.toLocaleString()} passages of
            about {l.files.passage_chars} characters, roughly 450 pages. A scan or photo PDF has its first{' '}
            {l.files.scan_pages} pages read.
          </Row>
          <Row label="Messages">
            Up to {l.messages.max_chars.toLocaleString()} characters and {l.messages.images_per_message} images per message.
          </Row>
          <Row label="Models">
            {modelName(l.models.chat)} writes answers and quizzes. {modelName(l.models.fast)} handles short jobs.
          </Row>
        </div>
      )}
    </SettingsCard>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[88px_1fr]">
      <span className="setcode pt-0.5">{label}</span>
      <p>{children}</p>
    </div>
  )
}

/** "openai/gpt-oss-120b" → "gpt-oss-120b". */
const modelName = (id: string) => id.split('/').pop() ?? id
