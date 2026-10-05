/**
 * The quiz library on a phone: one row per quiz, "New quiz" pinned in the
 * thumb zone, subjects as a chip row. Tapping a row starts it — everything
 * about taking it lives in the immersive stage (PhoneQuiz.tsx).
 */

import { useNavigate } from 'react-router-dom'
import type { Quiz, Tone } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Icon } from '../../components/ui/Icon'
import { Skeleton } from '../../components/ui/Skeleton'
import { SlowBot } from '../../components/mascot/SlowBot'
import { cn } from '../../lib/cn'
import { toneBar } from '../../lib/tone'
import { StickyActionBar } from '../../components/ui/StickyActionBar'
import { ChipRow, ListRow, PhoneTitle } from './phoneKit'

export function PhoneQuizzes({
  quizzes,
  loading,
  error,
  onRetry,
  subjects,
  subjectFilter,
  onSubjectFilter,
  toneOf,
  generating,
  addMaterialHref,
  onOpen,
  onGenerate,
}: {
  quizzes: Quiz[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  subjects: { id: string; name: string }[]
  subjectFilter: string
  onSubjectFilter: (id: string) => void
  toneOf: (q: Quiz) => Tone | undefined
  generating: boolean
  /** Set when the topic has no sources yet: where "Add a file" goes. */
  addMaterialHref: string | null
  onOpen: (id: string) => void
  onGenerate: () => void
}) {
  const navigate = useNavigate()
  const list = quizzes ?? []
  const empty = !loading && !error && list.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PhoneTitle
          title="Quizzes"
          hideTitle
          sub={list.length > 0 ? `${list.length} quiz${list.length === 1 ? '' : 'zes'}` : undefined}
        />

        {subjects.length > 1 && (
          <ChipRow
            label="Filter by subject"
            value={subjectFilter}
            onChange={onSubjectFilter}
            options={[
              { value: 'all', label: 'All' },
              ...subjects.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        )}

        {loading && (
          <div className="flex flex-col gap-px" aria-busy>
            <SlowBot pending agent="quiz" className="px-4 pb-3" />
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="mx-4 flex flex-col items-start gap-2 rounded-xl bg-coral-soft px-4 py-3 text-[15px] text-coral-deep">
            <p>{error}</p>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}

        {empty && (
          <div className="px-4 py-4">
            <EmptyState
              icon="quiz"
              title="No quizzes yet"
              bot={{ agent: 'quiz', say: 'emptyQuizzes', surface: 'phone' }}
              description={
                addMaterialHref
                  ? "This topic has no files yet. Add one and we'll write questions from it."
                  : "Get questions from your files in this topic and see what you remember."
              }
              action={
                addMaterialHref ? (
                  <Button size="xl" onClick={() => navigate(addMaterialHref)} className="w-full">
                    <Icon name="plus" size={16} /> Add a file
                  </Button>
                ) : (
                  <Button size="xl" onClick={onGenerate} className="w-full">
                    <Icon name="sparkle" size={16} /> Make a quiz
                  </Button>
                )
              }
            />
          </div>
        )}

        {!loading && list.length > 0 && (
          <ul className="border-t border-line-soft">
            {list.map((q) => (
              <ListRow
                key={q.id}
                onOpen={() => onOpen(q.id)}
                trailing={
                  q.best_score != null ? (
                    <span className="shrink-0 rounded-full bg-mint-soft px-2.5 py-1 text-[13px] font-bold tabular-nums text-mint-deep">
                      {q.best_score}%
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-line-soft px-2.5 py-1 text-[13px] font-semibold text-muted">
                      New
                    </span>
                  )
                }
              >
                <span className="truncate text-[16px] font-bold text-ink">{q.topic || 'Untitled topic'}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                  <span
                    aria-hidden
                    className={cn('h-3 w-[3px] shrink-0 rounded-full', toneBar[toneOf(q) ?? 'brand'])}
                  />
                  <span className="truncate">
                    {q.questions.length} question{q.questions.length === 1 ? '' : 's'} ·{' '}
                    {new Date(q.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {q.subject_name ? ` · ${q.subject_name}` : ''}
                  </span>
                </span>
              </ListRow>
            ))}
          </ul>
        )}

        {!empty && !error && (
          <StickyActionBar>
            <Button size="xl" className="min-h-14 flex-1" onClick={onGenerate} disabled={generating}>
              <Icon name="sparkle" size={16} />
              {generating ? 'Making your quiz…' : 'New quiz'}
            </Button>
          </StickyActionBar>
        )}
      </div>
    </div>
  )
}
