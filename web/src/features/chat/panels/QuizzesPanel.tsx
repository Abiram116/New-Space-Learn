/**
 * Quizzes, in the sidebar: what you have, and the way to take one.
 *
 * Taking a quiz opens it as a full page, not inside this narrow column: a
 * question, its choices and the explanations afterwards want room, and a quiz
 * is something you sit down to rather than glance at. The page's Back button
 * returns here, to this panel (see `lib/fromChat`).
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { generateQuiz, listQuizzes } from '../../../api/quizzes'
import type { Quiz } from '../../../api/types'
import { Icon } from '../../../components/ui/Icon'
import { Skeleton } from '../../../components/ui/Skeleton'
import { useToast } from '../../../components/ui/Toast'
import { Stagger } from '../../../components/ui/motion'
import { quizHref } from '../../../lib/fromChat'
import { useAsync } from '../../../lib/useAsync'
import { cn } from '../../../lib/cn'
import { SOLID_AT } from '../DockInsights'
import { DockAction, DockEmpty, DockFooter, DockMeter, DockSectionHead } from '../dockParts'

export function QuizzesPanel({ subspaceId, base }: { subspaceId: string; base: string }) {
  const navigate = useNavigate()
  const quizzes = useAsync(() => listQuizzes(subspaceId), [subspaceId], `quizzes:${subspaceId}`)
  const [generating, setGenerating] = useState(false)
  const { show, showError } = useToast()

  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      const quiz = await generateQuiz(subspaceId, { count: 5 })
      await quizzes.refresh()
      show('Quiz ready.', 'success')
      navigate(quizHref(base, quiz.id))
    } catch (err) {
      showError(err)
    } finally {
      setGenerating(false)
    }
  }, [subspaceId, base, navigate, quizzes, show, showError])

  const list = weakestFirst(quizzes.data ?? [])

  const taken = list.filter((q) => typeof q.best_score === 'number')
  const toRetry = list.filter((q) => typeof q.best_score !== 'number' || q.best_score < SOLID_AT).length
  const summary =
    list.length === 0
      ? undefined
      : [
          taken.length > 0
            ? `Average best ${Math.round(taken.reduce((n, q) => n + (q.best_score ?? 0), 0) / taken.length)}%`
            : 'None taken yet',
          toRetry > 0 && taken.length > 0 ? `${toRetry} worth a go` : null,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    // Sized by its content, not stretched: the main button follows the list
    // (see `DockFooter`) instead of waiting at the bottom of an empty column.
    <div className="flex flex-col gap-3">
      <DockSectionHead id="quizzes-panel-label" hint={summary}>
        {list.length > 0 ? `Quizzes · ${list.length}` : 'Quizzes'}
      </DockSectionHead>

      <div className="flex flex-col gap-2">
        {quizzes.loading ? (
          <Skeleton className="h-[4.5rem] rounded-[12px]" />
        ) : quizzes.error ? (
          // A failed fetch used to fall through to `list.length === 0` and
          // read as "you've never generated a quiz here" — silently wrong.
          <p className="text-[13.5px] text-coral-deep">{quizzes.error}</p>
        ) : list.length === 0 ? (
          <DockEmpty icon="quiz" title="No quizzes yet">
            Make one from your files and it shows up here.
          </DockEmpty>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((q) => {
              const best = typeof q.best_score === 'number' ? Math.round(q.best_score) : null
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => navigate(quizHref(base, q.id))}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-[12px] border border-line bg-raised px-3 py-3 text-left t-control duration-200 hover:border-sky/40 hover:bg-line-soft"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sky-soft text-sky-deep">
                    <Icon name="quiz" size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold leading-snug text-ink">
                      {q.topic || 'Quiz'}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-muted">{quizMeta(q)}</span>
                    {best !== null && (
                      <span className="mt-1.5 block">
                        <DockMeter value={best} tone={best >= SOLID_AT ? 'mint' : best >= 50 ? 'sun' : 'coral'} />
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      'inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-bold t-control duration-200',
                      best === null
                        ? 'bg-sky-soft text-sky-deep group-hover:brightness-125'
                        : 'border border-line text-ink-2 group-hover:border-ink-3/60 group-hover:text-ink',
                    )}
                  >
                    {best === null ? 'Take' : 'Retake'}
                    <Icon name="arrowRight" size={13} />
                  </span>
                </button>
              )
            })}
          </Stagger>
        )}
      </div>

      <DockFooter>
        <DockAction busy={generating} busyLabel="Writing questions…" onClick={generate}>
          Make a quiz
        </DockAction>
      </DockFooter>
    </div>
  )
}

/** "5 questions · best 80%" — what a quiz is and how you did, not a bare "5q". */
function quizMeta(q: Quiz): string {
  const n = q.questions.length
  const parts = [`${n} question${n === 1 ? '' : 's'}`]
  parts.push(typeof q.best_score === 'number' ? `best ${Math.round(q.best_score)}%` : 'not taken yet')
  return parts.join(' · ')
}

/** Never taken first, then the ones you did worst on: what's worth another go leads. */
function weakestFirst(list: Quiz[]): Quiz[] {
  const rank = (q: Quiz) => (typeof q.best_score === 'number' ? q.best_score : -1)
  return [...list].sort((a, b) => rank(a) - rank(b))
}
