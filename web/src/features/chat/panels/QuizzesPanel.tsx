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
import { DockAction, DockEmpty, DockSectionHead } from '../dockParts'

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

  return (
    // `flex-1`, not `min-h-full`: a percentage min-height has to resolve against
    // an ancestor chain of definite heights, and one scroll container in that
    // chain is enough to collapse it. A flex item that grows needs nothing from
    // its ancestors.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <DockSectionHead id="quizzes-panel-label">{list.length > 0 ? `Quizzes · ${list.length}` : 'Quizzes'}</DockSectionHead>

      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {quizzes.loading ? (
          <Skeleton className="h-12 rounded-[10px]" />
        ) : quizzes.error ? (
          // A failed fetch used to fall through to `list.length === 0` and
          // read as "you've never generated a quiz here" — silently wrong.
          <p className="text-[12px] text-coral-deep">{quizzes.error}</p>
        ) : list.length === 0 ? (
          <DockEmpty icon="quiz" title="No quizzes yet">
            Make one from your files and it shows up here.
          </DockEmpty>
        ) : (
          <Stagger step={18} max={140}>
            {list.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => navigate(quizHref(base, q.id))}
                className="flex w-full items-center gap-2 rounded-[10px] border border-line bg-raised px-2.5 py-2 text-left transition-colors cursor-pointer hover:border-brand/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold leading-snug text-ink">
                    {q.topic || 'Quiz'}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted">{quizMeta(q)}</span>
                </span>
                <span className="setcode flex shrink-0 items-center gap-1 text-ink-3">
                  {typeof q.best_score === 'number' ? 'Retake' : 'Take'}
                  <Icon name="arrowRight" size={11} />
                </span>
              </button>
            ))}
          </Stagger>
        )}
      </div>

      <DockAction busy={generating} busyLabel="Writing questions…" onClick={generate}>
        Make a quiz
      </DockAction>
    </div>
  )
}

/** "5 questions · best 80%" — what a quiz is and how you did, not a bare "5q". */
function quizMeta(q: Quiz): string {
  const n = q.questions.length
  const parts = [`${n} question${n === 1 ? '' : 's'}`]
  if (typeof q.best_score === 'number') parts.push(`best ${Math.round(q.best_score)}%`)
  return parts.join(' · ')
}

/** Never taken first, then the ones you did worst on: what's worth another go leads. */
function weakestFirst(list: Quiz[]): Quiz[] {
  const rank = (q: Quiz) => (typeof q.best_score === 'number' ? q.best_score : -1)
  return [...list].sort((a, b) => rank(a) - rank(b))
}
